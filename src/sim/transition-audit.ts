// Plan 10f (F9): the plan 08 transition audit, moved out of simulation.ts. At every locomotion transition boundary it
// builds the previous composition's pose at the same solved root from copied memory and records the largest landmark
// difference (`Simulation.transitionDeltas`). Read-only: the copies never touch the live pose memory or foot plan.
import type { PlayerId } from './contracts';
import { shoulderLocal } from './profiles';
import { buildProxyPose, legRequestLocal, type PhysicalPose, type ProxyPoseInput } from './pose';
import { CARRY_ARM } from './carry';
import { advanceRunPlayback, followClipWeight, type RunClipProfile, type RunPlayback } from './run-clip';
import { continueOwners, type FootPlan, type FootPlanInput } from './footwork';
import type { ArmSide } from './contracts';
import { type Vec3, v3, vc, horiz, len, qRot, sub, qInvRot, scale, toWorld } from './vec';
import type { Simulation, PlayerRuntime } from './simulation';

/** What the transition audit reads from the simulation (and the audit state it keeps there). */
export type AuditHost = Pick<
  Simulation,
  | 'auditHist'
  | 'auditPrev'
  | 'auditRun'
  | 'def'
  | 'sampledLimbs'
  | 't'
  | 'transitionDeltas'
>;

/** The composition of one substep, kept for the next substep's audit. */
export interface AuditPrev {
  key: string;
  /** Per side foot and arm owner. */
  foot: Record<ArmSide, string>;
  arm: Record<ArmSide, string>;
  feet: NonNullable<ProxyPoseInput['feet']>;
  /** The foot plan after this substep's observation. */
  plan: FootPlan | null;
  /** Ordinary leg requests (body frame) of this substep and the one before. */
  reqL: Record<ArmSide, Vec3>;
  reqL2: Record<ArmSide, Vec3>;
  /** Substeps recorded: the request has a motion of its own from the second. */
  reqN: number;
  /** Achieved arms in the body frame, the free arm composition and the support state. */
  armsL: Partial<Record<ArmSide, { elbow: Vec3; wrist: Vec3; palm: Vec3 }>>;
  readyHands: boolean;
  contactW: number;
  supported: boolean;
  falling: boolean;
  mode: string;
}

/** The old composition's pose input at a boundary, and the reference feet (see TransitionDelta.deltaM). */
export type AuditOld = ProxyPoseInput & { from: string; to: string; reference: NonNullable<ProxyPoseInput['feet']>; requestJumpM: Record<ArmSide, number> };

/** One leg of an audited composition: its request kind, the solved request, ankle, candidate and blends. */
export interface AuditLeg {
  kind: string;
  request: Vec3;
  ankle: Vec3;
  variant: number;
  softM: number;
  liftM: number;
  soleO: number;
  poleW: number;
}

/** One audited transition boundary: same solved time and root, old versus new composition. */
export interface TransitionDelta {
  t: number;
  playerId: PlayerId;
  from: string;
  to: string;
  /**
   * Largest landmark difference against the reference (m), the measure the limit applies to. The reference is the old
   * composition with its own snaps taken out at their source: the ordinary request's jump of this substep from a following
   * foot (a collision turns the clip's heading with the travel in one substep; that jump belongs to the old path whether or
   * not ownership changes). Everything else about the old composition stands (plan 10b: a timed-out step no longer stops
   * dead, so its path is compared as it is; the `stepStopM` correction is gone).
   */
  deltaM: number;
  landmark: string;
  /** Every compared landmark's difference (m). */
  by: Record<string, number>;
  /** The same comparison against the old composition as it stands, with the request jump in it (m). */
  rawM: number;
  rawBy: Record<string, number>;
  /** Largest difference of any landmark from its own body-frame motion carried on one substep (its second difference, m); reported only, never part of `deltaM`. */
  continuedM: number;
  /** Size of the ordinary request's jump removed from each following foot (m); 0 for other owners. */
  requestJumpM: Record<ArmSide, number>;
  /** Both compositions' requests and solved legs at the boundary. */
  legs: Record<ArmSide, { old: AuditLeg; now: AuditLeg }>;
}

/**
 * Plan 08 audit: when host substep's composition differs from the last one, the pose input of the old composition at the
 * same solved state and time. Each owner that changed continues as if nothing had happened: the feet from a copy of the
 * plan (`continueOwners`), the arms from their last owner (an achieved arm kept in the body frame, the last ready and
 * contact state), the legs' support state. The phases have advanced once, for the live substep; the copies share them.
 * Null when nothing changed.
 */
export function auditInput(host: AuditHost, pl: PlayerRuntime, inp: ProxyPoseInput, ftIn: FootPlanInput): AuditOld | null {
  const fp = pl.feet;
  if (!fp?.initialized || !inp.feet) return null;
  const SD: ArmSide[] = ['left', 'right'];
  // (with its reseed count: the pose takes a reseed as a new owner of the same kind)
  const foot = (s: ArmSide): string => `${fp.feet[s].mode}/${fp.feet[s].source}${fp.feet[s].mode === 'swing' && fp.feet[s].wait ? '+wait' : ''}#${fp.feet[s].seeds}`;
  const contactW = inp.loco?.contactW ?? 0;
  const arm = (s: ArmSide): string => (inp.arms?.[s] ? 'achieved' : inp.readyHands ? 'ready' : inp.carriesBall && s === CARRY_ARM ? 'carry' : 'free') + (contactW > 0 ? '+contact' : '');
  const supported = pl.controlMode === 'supported' && !!pl.sus?.probe.valid;
  const falling = pl.controlMode === 'falling';
  const footO = { left: foot('left'), right: foot('right') };
  const armO = { left: arm('left'), right: arm('right') };
  const key = [footO.left, footO.right, pl.loco?.mode ?? '', fp.brakeHeld ? 'held' : 'clip', armO.left, armO.right, falling ? 'falling' : supported ? 'supported' : 'unsupported'].join(' ');
  const prev = host.auditPrev.get(pl.id);
  const armsL: AuditPrev['armsL'] = {};
  for (const s of SD) {
    const a = inp.arms?.[s];
    if (a) armsL[s] = { elbow: qInvRot(inp.pose.q, sub(a.elbow, inp.pose.p)), wrist: qInvRot(inp.pose.q, sub(a.wrist ?? a.palm, inp.pose.p)), palm: qInvRot(inp.pose.q, sub(a.palm, inp.pose.p)) };
  }
  const reqNow = { left: legRequestLocal(inp, 'left'), right: legRequestLocal(inp, 'right') };
  host.auditPrev.set(pl.id, { key, foot: footO, arm: armO, feet: { ...inp.feet }, plan: null, reqL: reqNow, reqL2: prev?.reqL ?? reqNow, reqN: (prev?.reqN ?? 0) + 1, armsL, readyHands: !!inp.readyHands, contactW, supported, falling, mode: pl.loco?.mode ?? '' });
  if (!prev?.plan || prev.key === key) return null;
  const old: AuditOld = { ...inp, memory: structuredClone(pl.poseMemory), from: prev.key, to: key, reference: {}, requestJumpM: { left: 0, right: 0 } };
  // the legs' support composition: the ordinary request of the old state at host root
  const v = vc(pl.proxy.body.linvel());
  const seam = prev.supported !== supported || prev.falling !== falling;
  if (seam) {
    old.speed = prev.supported ? len(horiz(v)) : 0;
    old.ground = { ...inp.ground!, bodyRelative: prev.falling ? true : undefined };
  }
  const run = host.auditRun.get(pl.id);
  if (run) old.sampled = host.sampledLimbs(pl, run, inp.pose);
  const request = {} as FootPlanInput['request'];
  for (const s of SD) request[s] = toWorld(inp.pose, legRequestLocal(old, s));
  const { requests: cont, tookUp } = continueOwners(prev.plan, { ...ftIn, request }, prev.feet);
  const feet = { ...inp.feet };
  // a foot whose ownership did not change keeps host substep's request: only the handover is compared. Across a change of the
  // request's composition its offset is the old one: the live offset has taken the new request's seam up
  const kept = (s: ArmSide): boolean => prev.foot[s] === footO[s] && !seam;
  for (const s of SD) if (!kept(s)) feet[s] = cont[s];
  old.feet = feet;
  // the reference: the same composition with the old path's own snap taken out where it starts: a following foot's
  // ordinary request carried on in the body frame
  const ref = { ...feet };
  for (const s of SD) {
    const q = feet[s];
    // (a carried foot has the old path's request itself: nothing of it was corrected, its comparison is with that path as it is)
    if (kept(s) || inp.feet[s]?.carried) continue;
    // (a jump the old owner's offset took up is already out of its path)
    if (q?.kind === 'offset' && prev.reqN > 1 && !tookUp[s]) {
      const L = legRequestLocal(old, s);
      const jump = sub(L, sub(scale(prev.reqL[s], 2), prev.reqL2[s]));
      ref[s] = { ...q, offsetW: sub(q.offsetW, qRot(inp.pose.q, jump)) };
      old.requestJumpM[s] = len(jump);
    }
  }
  old.reference = ref;
  // an arm whose owner changed keeps the old owner
  const arms = { ...(inp.arms ?? {}) };
  for (const s of SD) {
    if (prev.arm[s].split('+')[0] === armO[s].split('+')[0]) continue;
    const q = prev.armsL[s];
    if (q) arms[s] = { shoulder: toWorld(inp.pose, shoulderLocal(pl.body, s)), elbow: toWorld(inp.pose, q.elbow), wrist: toWorld(inp.pose, q.wrist), palm: toWorld(inp.pose, q.palm) };
    else delete arms[s];
  }
  old.arms = inp.arms ? arms : undefined;
  old.readyHands = prev.readyHands;
  if (inp.loco && (prev.contactW > 0) !== (contactW > 0)) old.loco = { ...inp.loco, contactW: prev.contactW };
  return old;
}

export function keepLandmarks(host: AuditHost, pl: PlayerRuntime, inp: ProxyPoseInput, pose: PhysicalPose): void {
  const local: Record<string, Vec3> = {};
  for (const [n, p] of Object.entries(pose.jointLandmarksWorld)) local[n] = qInvRot(inp.pose.q, sub(p, inp.pose.p));
  const h = host.auditHist.get(pl.id) ?? [];
  h.push(local);
  if (h.length > 2) h.shift();
  host.auditHist.set(pl.id, h);
}

export function recordTransition(host: AuditHost, pl: PlayerRuntime, oldIn: AuditOld, nowIn: ProxyPoseInput, now: PhysicalPose): void {
  const diff = (o: PhysicalPose): { m: number; k: string; by: Record<string, number> } => {
    const by: Record<string, number> = {};
    let m = 0;
    let k = '';
    for (const [n, p] of Object.entries(now.jointLandmarksWorld)) {
      const q = o.jointLandmarksWorld[n];
      if (!q) continue;
      const d = len(sub(p, q));
      by[n] = d;
      if (d > m) [m, k] = [d, n];
    }
    return { m, k, by };
  };
  const old = buildProxyPose({ ...oldIn, memory: structuredClone(oldIn.memory) });
  const reference = buildProxyPose({ ...oldIn, feet: oldIn.reference, memory: structuredClone(oldIn.memory) });
  const raw = diff(old);
  const rf = diff(reference);
  // reported beside the limit, never part of it: the largest landmark departure from its own body-frame motion carried on
  const h = host.auditHist.get(pl.id);
  let continuedM = 0;
  if (h?.length === 2)
    for (const n of Object.keys(rf.by)) {
      if (!h[0][n] || !h[1][n]) continue;
      continuedM = Math.max(continuedM, len(sub(qInvRot(nowIn.pose.q, sub(now.jointLandmarksWorld[n], nowIn.pose.p)), sub(scale(h[1][n], 2), h[0][n]))));
    }
  const leg = (i: ProxyPoseInput, o: PhysicalPose, s: ArmSide): AuditLeg => {
    const r = i.feet?.[s];
    const n = o.legInfo?.[s];
    return { kind: r?.kind ?? 'none', request: n?.request ?? v3(), ankle: o.jointLandmarksWorld[`${s}Ankle`], variant: n?.variant ?? 0, softM: n?.softM ?? 0, liftM: n?.liftM ?? 0, soleO: r?.soleO ?? 0, poleW: r?.poleW ?? 0 };
  };
  const legs = { left: { old: leg(oldIn, old, 'left'), now: leg(nowIn, now, 'left') }, right: { old: leg(oldIn, old, 'right'), now: leg(nowIn, now, 'right') } };
  host.transitionDeltas.push({ t: host.t, playerId: pl.id, from: oldIn.from, to: oldIn.to, deltaM: rf.m, landmark: rf.k, by: rf.by, rawM: raw.m, rawBy: raw.by, continuedM, requestJumpM: oldIn.requestJumpM, legs });
}

/**
 * The old composition's run-clip playback at a change of support mode: a copy of the live playback advanced as the old
 * mode would have (the mode changes the clip's weight target), kept in `auditRun` for this substep's old pose.
 */
export function auditPlayback(host: AuditHost, pl: PlayerRuntime, st: RunPlayback, P: RunClipProfile, input: Parameters<typeof advanceRunPlayback>[2], dt: number): void {
  const pv = host.auditPrev.get(pl.id);
  const was = pv ? pv.supported && pv.mode !== 'contact' : input.supported;
  host.auditRun.delete(pl.id);
  if (was !== input.supported) {
    const copy = structuredClone(st);
    advanceRunPlayback(copy, P, { ...input, supported: was });
    if (pl.feet?.profile.compose) followClipWeight(copy, dt, host.def.locomotion!.contact.clipWeightRadPerS);
    host.auditRun.set(pl.id, copy);
  }
}
