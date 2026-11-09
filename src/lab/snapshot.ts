// Plan 13a: the lab's render snapshot. One `LabFrame` per tick holds everything the lab draws of that tick (poses,
// collider wireframes, markers, overlay inputs and the info panel text), as plain data taken from the simulation right
// after the tick. The lab draws only from frames, so the simulation can run ahead of what is shown (src/lab/playback.ts).
// No three.js and no DOM here: the tests capture frames headless.
import type { ArmSide } from '../sim/contracts';
import type { PhysicalPose } from '../sim/pose';
import { playbackLabel } from '../sim/run-clip';
import type { PlayerRuntime, Simulation } from '../sim/simulation';
import { forwardOf, horiz, len, qInvRot, qRot, round, toWorld, v3, vc, type Pose, type Quat, type Vec3 } from '../sim/vec';
import RAPIER from '@dimforge/rapier3d-compat';

/** A collider wireframe's shape (read once per collider set: the colliders themselves may be freed later). */
export interface ColliderDesc {
  kind: 'ball' | 'capsule' | 'cuboid' | 'other';
  radius: number;
  halfHeight: number;
  halfExtents: Vec3;
}

/** A point or direction in a player's frame: drawn re-expressed from that player's tick pose into its drawn pose. */
export interface Tagged {
  id: string;
  v: Vec3;
}

/** Arm overlay input of one arm (as `ArmOverlaySide`, its points tagged with the player whose frame carries them). */
export interface ArmFrame {
  palm: Tagged;
  requested: Tagged | null;
  phase: string;
  anchor: { p: Tagged; n: Tagged; tension: number; ceiling: number } | null;
  clamp: { p: Tagged; n: Tagged; normalN: number; tangent: Tagged } | null;
  azFrom: Tagged | null;
  azDeg: number | null;
  label: string;
}

export interface BalanceFrame {
  com: Vec3;
  desiredUp: Vec3;
  leanDeg: number;
  projectedDeg: number;
  envelopeDeg: number;
  falling: boolean;
  label: string;
}

export interface PlayerFrame {
  id: string;
  rep: string;
  core: Pose;
  /** The tick's solved pose (the simulation builds a new one every tick and never changes it after). */
  pose: PhysicalPose | null;
  com: Vec3;
  v: Vec3;
  grounded: boolean;
  requestedVelocity: Vec3;
  drive: Vec3;
  desiredFacing: Vec3;
  debug: { phase?: string; selectedShoulder?: 'left' | 'right'; predictedHip?: Vec3; aim?: Vec3; leverageLat?: Vec3 };
  /** Wireframe shapes (the same array while the active collider set is unchanged) and their poses this tick. */
  colliderSet: ColliderDesc[];
  colliderPoses: Pose[];
  arms: Partial<Record<ArmSide, ArmFrame>> | null;
  balance: BalanceFrame | null;
}

export interface LabFrame {
  tick: number;
  t: number;
  done: boolean;
  players: PlayerFrame[];
  /** Contact points between players (red) and foot anchors (green planted, amber step destination). */
  markers: { p: Vec3; color: number }[];
  rules: { runnerId: string; ballSpot: Vec3 | null } | null;
  /** The info panel's simulation lines, and whether they report a failure. */
  info: string[];
  bad: boolean;
}

const copyPose = (p: { p: Vec3; q: Quat }): Pose => ({ p: vc(p.p), q: { x: p.q.x, y: p.q.y, z: p.q.z, w: p.q.w } });

/** Keeps each player's collider set between captures, so an unchanged set is one shared array. */
export class FrameCapture {
  private sets = new Map<string, { key: string; set: ColliderDesc[] }>();

  constructor(private readonly sim: Simulation) {}

  capture(): LabFrame {
    const sim = this.sim;
    const players = sim.players.map((pl) => this.player(pl));
    const markers: { p: Vec3; color: number }[] = [];
    for (const c of sim.contacts) {
      if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) for (const p of c.points) markers.push({ p: vc(p.pointWorld), color: 0xff2020 });
    }
    for (const pl of sim.players) {
      if (!pl.feet || pl.rag) continue;
      for (const s of ['left', 'right'] as const) {
        const ft = pl.feet.feet[s];
        if (ft.mode === 'planted' && ft.anchorW) markers.push({ p: vc(ft.anchorW), color: 0x20e040 });
        else if (ft.mode === 'swing' && ft.source === 'step' && ft.dest) markers.push({ p: vc(ft.dest), color: 0xffb020 });
      }
    }
    const rules = sim.rules ? { runnerId: sim.rules.runnerId, ballSpot: sim.ending ? vc(sim.ending.ballSpot) : null } : null;
    return { tick: sim.tick, t: sim.t, done: sim.done, players, markers, rules, info: infoLines(sim), bad: sim.result === 'numericalFailure' };
  }

  private player(pl: PlayerRuntime): PlayerFrame {
    const sim = this.sim;
    const k = sim.bulk(pl);
    const cs = sim.activeColliders(pl);
    const key = cs.map((c) => c.handle).join(',');
    let s = this.sets.get(pl.id);
    if (!s || s.key !== key) {
      s = { key, set: cs.map(colliderDesc) };
      this.sets.set(pl.id, s);
    }
    const d = pl.intent.debug ?? {};
    const vec = (x: unknown): Vec3 | undefined => (x ? vc(x as Vec3) : undefined);
    return {
      id: pl.id,
      rep: pl.representation,
      core: copyPose(sim.poseOf(pl)),
      pose: pl.pose,
      com: vc(k.com),
      v: vc(k.v),
      grounded: pl.grounded,
      requestedVelocity: vc(pl.applied.requestedVelocity),
      drive: vc(pl.applied.drive),
      desiredFacing: vc(pl.intent.locomotion.desiredFacingWorld),
      debug: {
        phase: d.phase === undefined ? undefined : String(d.phase),
        selectedShoulder: d.selectedShoulder as 'left' | 'right' | undefined,
        predictedHip: vec(d.predictedHip),
        aim: vec(d.aim),
        leverageLat: vec(d.leverageLat),
      },
      colliderSet: s.set,
      colliderPoses: cs.map((c) => copyPose({ p: c.translation(), q: c.rotation() })),
      arms: armFrame(sim, pl.id),
      balance: balanceFrame(sim, pl),
    };
  }
}

function colliderDesc(c: RAPIER.Collider): ColliderDesc {
  const T = RAPIER.ShapeType;
  const t = c.shapeType();
  if (t === T.Ball) return { kind: 'ball', radius: c.radius(), halfHeight: 0, halfExtents: v3(0, 0, 0) };
  if (t === T.Capsule) return { kind: 'capsule', radius: c.radius(), halfHeight: c.halfHeight(), halfExtents: v3(0, 0, 0) };
  if (t === T.Cuboid) return { kind: 'cuboid', radius: 0, halfHeight: 0, halfExtents: vc(c.halfExtents() ?? v3(0.05, 0.05, 0.05)) };
  return { kind: 'other', radius: 0.05, halfHeight: 0, halfExtents: v3(0, 0, 0) };
}

function balanceFrame(sim: Simulation, pl: PlayerRuntime): BalanceFrame | null {
  if (!sim.balanced) return null;
  const B = sim.balanceProfile;
  const bal = pl.balance;
  const deg = (r: number): number => (r * 180) / Math.PI;
  return {
    com: vc(sim.bulk(pl).com),
    desiredUp: vc(bal.desiredUp),
    leanDeg: deg(bal.theta),
    projectedDeg: deg(bal.projected),
    envelopeDeg: deg(B.envelopeRad),
    falling: pl.controlMode === 'falling',
    label: `${pl.id} ${f2(deg(bal.theta), 1)}°  proj ${f2(deg(bal.projected), 1)}°${pl.controlMode === 'falling' ? '  FALLING' : ''}`,
  };
}

/** Arm overlay input in tick world space, each point tagged with the player whose drawn pose carries it. */
function armFrame(sim: Simulation, id: string): Partial<Record<ArmSide, ArmFrame>> | null {
  const A = sim.arms;
  const o = A?.obs(id);
  if (!A || !o) return null;
  const tag = (pid: string, v: Vec3): Tagged => ({ id: pid, v: vc(v) });
  const out: Partial<Record<ArmSide, ArmFrame>> = {};
  const w = A.wrap.get(id);
  for (const s of ['left', 'right'] as ArmSide[]) {
    const a = o[s]!;
    if (!a.enabled) continue;
    const f = A.lastForce.get(`${id}:${s}`);
    let anchor: ArmFrame['anchor'] = null;
    if (a.gripId) {
      const g = A.grips.get(a.gripId);
      const tgt = g ? sim.byId.get(g.targetId) : undefined;
      if (g && tgt) {
        const tp = sim.poseOf(tgt);
        anchor = { p: tag(g.targetId, toWorld(tp, g.targetPointLocal)), n: tag(g.targetId, qRot(tp.q, g.targetNormalLocal)), tension: f?.actual ?? 0, ceiling: A.profile.hold.perArmCeilingN };
      }
    }
    const c = A.clampOf(id, s);
    const clamp = c ? { p: tag(c.targetId, c.pointWorld), n: tag(c.targetId, c.outwardNormalWorld), normalN: c.normalForceN, tangent: tag(c.targetId, c.tangentForceN) } : null;
    const tgtId = w?.target ?? null;
    const az = w?.azimuthDeg[s];
    const tgtPl = tgtId ? sim.byId.get(tgtId) : undefined;
    const azFrom = tgtPl && az !== undefined ? tag(tgtPl.id, toWorld(sim.poseOf(tgtPl), v3(0, 0.22, 0))) : null;
    const force = f ? ` ${Math.round(f.actual)}N` : '';
    out[s] = {
      palm: tag(id, a.palmContactWorld),
      requested: a.requestedWorld && sim.byId.get(id)?.controlMode !== 'falling' ? tag(id, a.requestedWorld) : null, // falling: no voluntary request
      phase: a.phase,
      anchor,
      clamp,
      azFrom,
      azDeg: az ?? null,
      label: `${s[0].toUpperCase()} ${a.phase}${a.gripId ? ' grip' : ''}${c ? ' clamp' : ''}${force}${a.poseValid ? '' : ' INVALID'}`,
    };
  }
  return out;
}

// ---------------------------------------------------------------- info panel (simulation lines)
export const f2 = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const yawDeg = (q: Quat): number => (Math.atan2(forwardOf(q).x, forwardOf(q).z) * 180) / Math.PI;
const headDeg = (v: Vec3): number => (Math.atan2(v.x, v.z) * 180) / Math.PI;

/** The info panel's simulation lines for the current tick. */
export function infoLines(sim: Simulation): string[] {
  const lines: string[] = [];
  const bad = sim.result === 'numericalFailure';
  lines.push(`t ${f2(sim.t, 3)} s  tick ${sim.tick}  substeps/tick ${sim.def.solver.substeps}  dt ${f2(sim.dt * 1000, 2)} ms`);
  lines.push(`result ${sim.result}${bad ? '  << NUMERICAL FAILURE (not a stop)' : ''}`);
  lines.push(`solver ${sim.def.solver.id}  stance ${sim.def.stance.id}`);
  const gaps = Object.entries(sim.pairGap).map(([k, g]) => `${k} gap ${f2(g, 3)}`);
  if (gaps.length) lines.push(gaps.join('  ') + `  min ${Number.isFinite(sim.minPairGap) ? f2(sim.minPairGap, 3) : '-'}`);
  const cn = sim.counts();
  lines.push(`engine bodies ${cn.bodies}  joints ${cn.joints}  colliders ${cn.colliders}  grips ${cn.grips}  clamps ${cn.clamps}${sim.def.ragdoll ? `  ragdoll ${sim.def.ragdoll.id}` : ''}`);
  for (const pl of sim.players) {
    const k = sim.bulk(pl);
    const v = k.v;
    const a = pl.applied;
    const q = sim.poseOf(pl).q;
    lines.push('');
    lines.push(`${pl.id} (${pl.setup.role}) ${pl.body.id}  ${f2(k.massKg, 1)} kg  ${pl.representation}${pl.rag ? ` (${sim.bodyCount(pl.id)} bodies)` : ''}`);
    if (pl.handoff) {
      const h = pl.handoff;
      if (h.audit)
        lines.push(`  HANDOFF${h.outcome === 'transferFailed' ? ' TRANSFER FAILED' : ''} @${f2(h.t, 3)} ${h.reason}  P err ${h.audit.linearRelErr.toExponential(1)}  L err ${h.audit.angularRelErr.toExponential(1)}  ΔKE ${f2(h.audit.energyDeltaJ, 1)} / ${f2(h.audit.energyGainLimitJ, 1)} J  anchors ${f2(h.report.maxAnchorErrM * 1000, 2)} mm  pen ${f2(h.report.maxNewExternalPenetrationM * 1000, 1)} mm${h.audit.ok ? '' : `  (${h.audit.reasons.join(',')}: diagnostic state, no completion)`}`);
      else lines.push(`  HANDOFF REJECTED @${f2(h.t, 3)} ${h.report.reasons.join(',')} — falling proxy kept`);
    }
    if (pl.ragStats) lines.push(`  ragdoll max joint sep ${f2(pl.ragStats.maxAnchorErrM * 1000, 1)} mm  max floor pen ${f2(pl.ragStats.maxFloorPenM * 1000, 1)} mm  hinge ${Object.entries(pl.pose?.hingeDeg ?? {}).filter(([kk]) => kk !== 'neck').map(([kk, vv]) => `${kk.replace('left', 'L').replace('right', 'R')} ${f2(vv, 0)}°`).join(' ')}`);
    if (pl.fall) {
      const fe = pl.fall;
      const armText = (arm: typeof fe.arms.left): string => `${arm.task}${arm.brace === 'none' ? '' : `/${arm.brace}`}`;
      const st = fe.stats;
      lines.push(`  FALL effort ${f2(fe.effort, 2)}${fe.done ? ' done' : fe.exhausted ? ' exhausted' : ''}  L ${armText(fe.arms.left)}  R ${armText(fe.arms.right)}  work +${f2(st.positiveWorkJ, 1)} / -${f2(st.negativeWorkJ, 1)} J  peak ${f2(st.peakPositiveW, 0)} W${st.overPowerSubsteps || st.overWork ? '  OVER CAP' : ''}`);
      const torques = fe.applied.filter((c) => c.entry.appliedNm > 0.05).map((c) => `${c.entry.joint.replace('left', 'L').replace('right', 'R')} ${f2(c.entry.appliedNm, 1)}`);
      if (torques.length) lines.push(`  effort N·m ${torques.join(' ')}`);
    }
    if (pl.rag?.envelope) {
      const past = pl.rag.envelope.filter((e) => e.overDeg > 0.05).map((e) => `${e.jointId.replace('left', 'L').replace('right', 'R')} ${f2(e.overDeg, 1)}°`);
      lines.push(`  limits max past ${f2(Math.max(0, ...pl.rag.envelope.map((e) => e.maxOverDeg)), 1)}°${past.length ? `  now ${past.join(' ')}` : ''}`);
    }
    lines.push(`  v ${f2(Math.hypot(v.x, v.z))} m/s  req ${f2(len(horiz(a.requestedVelocity)))}  ${pl.grounded ? 'grounded' : 'AIRBORNE'}  ${pl.controlMode}`);
    lines.push(`  drive ${f2(len(a.drive), 0)} / ${f2(a.driveCap, 0)} N${a.driveSaturated ? ' SAT' : ''}  yawT ${f2(a.yawTorque, 0)} / ${f2(a.yawCap, 0)} N·m`);
    lines.push(`  facing ${f2(yawDeg(q), 1)}°  req ${f2(headDeg(pl.intent.locomotion.desiredFacingWorld), 1)}°  ωy ${f2(k.w.y)}`);
    const obs = sim.contactObs[pl.id] ?? [];
    if (obs.length) lines.push(`  contact ${[...new Set(obs.map((o) => `${o.ownClass}>${o.other}:${o.otherClass}`))].join(' ')}`);
    if (pl.run && sim.def.runClips && !pl.rag) {
      const st = pl.run;
      const res = Object.entries(pl.pose?.targetResidualM ?? {}).map(([kk, vv]) => `${kk.replace('left', 'L').replace('right', 'R')} ${f2(vv, 3)}`);
      lines.push(`  run ${st.w > 0 ? playbackLabel(st, sim.def.runClips) : 'procedural gait'}  u ${f2(st.u, 3)}  w ${f2(st.w, 2)} (→${f2(st.wTarget, 2)})  rate ${f2(st.rate, 3)}  v ${f2(st.speed, 2)}${res.length ? `  res ${res.join(' ')} m` : ''}`);
    }
    if (pl.sus && !pl.rag) {
      // plan 06a suspension: requested vs achieved root height, force (commanded / applied / ceiling), authority, probe
      const u = pl.sus;
      const W = k.massKg * Math.abs(sim.def.solver.gravityY);
      const S = sim.suspension!;
      const sat = u.saturated === 'max' ? ' SAT-MAX' : u.saturated === 'zero' && u.active ? ' at 0' : '';
      lines.push(
        `  support h ${Number.isFinite(u.probe.heightM) ? f2(u.probe.heightM, 3) : '-'} / target ${f2(u.targetM, 3)} m (req ${f2(u.requestM, 2)}${Number.isFinite(u.runM) ? `  clip ${f2(u.runM, 3)} ×${f2(u.bobScale, 2)}` : ''})  ` +
          `F ${f2(u.appliedN / W, 2)} BW (cmd ${f2(u.commandedN / W, 2)}, max ${S.maxForceBW}; pivot ${f2(u.pivotN / W, 2)} + COM ${f2(u.comN / W, 2)}, tip ${f2(Math.hypot(u.tipTorqueNm.x, u.tipTorqueNm.z), 0)} N m)${sat}  auth ${f2(u.authority, 2)}  probe ${u.probe.status}${u.bottomed ? '  GUARD DOWN' : ''}${u.active ? '' : '  (off)'}`,
      );
    }
    if (pl.feet && !pl.rag) {
      // plan 07 foot planner: mode (planted / step swing / follow swing / airborne), contact-feature error and drift while
      // planted, swing progress and commanded speed, last release reason
      const one = (s: ArmSide): string => {
        const ft = pl.feet!.feet[s];
        const m = ft.mode === 'planted' ? 'planted' : ft.mode === 'airborne' ? 'airborne' : ft.source === 'step' ? 'step' : 'follow';
        const body =
          ft.mode === 'planted'
            ? `err ${f2(ft.featureErrM * 100, 2)} cm drift ${f2(ft.driftM * 100, 2)} cm`
            : ft.mode === 'swing' && ft.source === 'step'
              ? `${f2(ft.durS > 0 ? Math.min(1, ft.elapsedS / ft.durS) : 0, 2)} of ${f2(ft.durS, 2)} s  ${f2(ft.speedMps, 2)} m/s`
              : `${f2(ft.speedMps, 2)} m/s`;
        return `${s === 'left' ? 'L' : 'R'} ${m}${ft.mode === 'planted' && ft.tentative ? ' (proposed)' : ''} ${body}  res ${f2(ft.residualM * 100, 1)} cm${ft.releaseReason ? `  (released: ${ft.releaseReason})` : ''}${ft.fails ? `  failed ${ft.fails}/${ft.attempts} (last: ${ft.failReason})` : ''}`;
      };
      const st = pl.feet.stats;
      const cov = (s: ArmSide): string => (st.cover[s].eligibleS > 0 ? `${f2((100 * st.cover[s].plantedS) / st.cover[s].eligibleS, 0)}%` : '-');
      lines.push(`  feet ${pl.feet.profile.id}  ${one('left')}  |  ${one('right')}`);
      lines.push(`  plants confirmed ${st.confirmed}/${st.attempts} proposed, failed ${st.failed}, sustained ${st.sustained}; eligible stance planted L ${cov('left')} R ${cov('right')}`);
    }
    if (pl.loco && !pl.rag) lines.push(`  locomotion ${pl.loco.mode} (${pl.loco.reason})  prep ${f2(pl.loco.prepW, 2)}  contact ${f2(pl.loco.contactW, 2)}  arm swing ${f2(pl.loco.swing, 2)}${pl.feet?.brakeHeld ? '  planner holds legs (braking)' : ''}`);
    balanceInfo(sim, pl, lines);
    armInfo(sim, pl.id, lines);
    const d = pl.intent.debug;
    if (d && d.phase && d.selectedShoulder) {
      const lev = d.leverageLat as Vec3 | undefined;
      const levLocal = lev ? qInvRot(q, lev) : null;
      lines.push(`  phase ${d.phase}  shoulder ${d.selectedShoulder} (strike surface)  fit ${d.fitCompatible ? 'ok' : 'NO'}`);
      lines.push(`  gap ${f2(Number(d.gap), 2)}  horizon ${f2(Number(d.horizon), 2)} s  ceiling ${f2(Number(d.entryCeiling), 2)}  headClear ${f2(Number(d.headClearance), 3)}`);
      if (lev) lines.push(`  leverage (${f2(lev.x, 2)}, ${f2(lev.z, 2)}) world  ${levLocal && levLocal.x > 0 ? 'own-left' : 'own-right'}`);
    }
  }
  if (sim.rules) {
    const R = sim.rules;
    const row = R.lastRow;
    lines.push('');
    lines.push(`rules ${R.profile.id}  runner ${R.runnerId}${R.disabledReason ? `  DISABLED (${R.disabledReason})` : ''}`);
    if (row) {
      lines.push(`  influence ${row.infl ? 'ACTIVE' : 'none'}  ground ${row.gnd.length ? row.gnd.join(' ') : '-'}  (? = achieved-pose probe)`);
      if (row.prog) lines.push(`  progress window ${f2(row.prog.win, 2)} / ${R.profile.progress.windowS} s  advance ${f2(row.prog.adv, 3)} m  request ${f2(row.prog.req, 1)} m/s  restraint ${f2(row.prog.res, 0)} N`);
    }
    const e = sim.ending;
    if (e) lines.push(`  ENDING ${e.kind} @${f2(e.t, 3)} s (step ${e.step})  spot (${f2(e.ballSpot.x, 2)}, ${f2(e.ballSpot.z, 2)})  ${String(e.evidence.region ?? '')}`);
  }
  const recent: typeof sim.events = [];
  for (let i = sim.events.length - 1; i >= 0 && recent.length < 6; i--) if (sim.events[i].type !== 'grounded') recent.unshift(sim.events[i]);
  if (recent.length) {
    lines.push('');
    for (const e of recent) lines.push(`${f2(e.t, 3)} ${e.type} ${e.playerId ?? ''} ${compact(e.data)}`);
  }
  return lines;
}

function balanceInfo(sim: Simulation, pl: PlayerRuntime, lines: string[]): void {
  if (!sim.balanced) return;
  const B = sim.balanceProfile;
  const b = pl.balance;
  const a = pl.applied;
  const dg = (r: number): string => f2((r * 180) / Math.PI, 1);
  const st = sim.balanceState(pl);
  lines.push(`  lean ${dg(b.theta)}°  out rate ${f2(b.outwardRate, 2)} rad/s  proj ${dg(b.projected)}°  [min ${dg(B.minLeanRad)} env ${dg(B.envelopeRad)} hard ${dg(B.hardLeanRad)}]  cnt ${b.counter}/${B.confirmSubsteps}`);
  lines.push(`  support ${st.supportingContact ? 'contact' : 'NONE'}  mode ${pl.controlMode}  posture ${dg(Math.acos(Math.min(1, b.desiredUp.y)))}° (max ${dg(B.maxPostureLeanRad)})`);
  lines.push(`  balance τ req ${f2(len(a.balanceRequested), 0)} → ${f2(len(a.balanceCapped), 0)} / ${f2(a.balanceCap, 0)} N·m${a.balanceSaturated ? ' SAT' : ''}  yaw ${f2(a.yawTorque, 0)}  support |τ| ${f2(len(a.supportTorque), 0)} / ${B.combinedCeilingNm} ×${f2(a.supportScale, 2)}`);
  lines.push(`  drive lean scale ×${f2(a.leanScale, 2)}`);
  const loss = sim.events.find((e) => e.type === 'lossOfSupport' && e.playerId === pl.id);
  if (loss) lines.push(`  LOSS @${f2(loss.t, 3)} s  ${loss.data!.reason}  lean ${f2(Number(loss.data!.leanDeg), 1)}°  proj ${f2(Number(loss.data!.projectedLeanDeg), 1)}°`);
}

function armInfo(sim: Simulation, id: string, lines: string[]): void {
  const A = sim.arms;
  const o = A?.obs(id);
  if (!A || !o) return;
  for (const s of ['left', 'right'] as ArmSide[]) {
    const a = o[s]!;
    if (!a.enabled) continue;
    const f = A.lastForce.get(`${id}:${s}`);
    const head = `  arm ${s[0].toUpperCase()} ${a.mode} ${a.phase}/${a.action}${a.poseValid ? '' : ' POSE INVALID'}${a.obstructed ? ' obstructed' : ''}${a.armedForFreshContact ? ' armed' : ''}`;
    lines.push(head);
    if (a.gripId) {
      const g = A.grips.get(a.gripId)!;
      lines.push(`    grip ${a.gripId} on ${g.targetId}:${g.targetPart}  T raw ${f ? f2(f.raw, 0) : '-'} act ${f ? f2(f.actual, 0) : '-'} alloc ${f ? f2(f.allocated, 0) : '-'} N  exp ${f2(g.overloadExposureS, 3)} s`);
    }
    if (a.clampContactId) {
      const c = A.clampOf(id, s)!;
      lines.push(`    clamp ${c.id} on ${c.targetId}:${c.targetPart}  N ${f2(c.normalForceN, 0)}  Ft ${f ? f2(f.tangentActual, 0) : '-'}/${f ? f2(f.frictionCap, 0) : '-'}  alloc ${f ? f2(f.allocated, 0) : '-'}  xT ${f ? f2(f.xT, 4) : '-'}`);
    }
    if (a.lastRelease) lines.push(`    last release ${a.lastRelease.reason} @ ${f2(a.lastRelease.t, 3)} s`);
  }
  const al = A.lastAllocation.get(id);
  if (al && al.sumDemand > 0) lines.push(`  arm budget demand ${f2(al.sumDemand, 0)} N  scale ${f2(al.scale, 3)}  actual ${f2(al.sumActual, 0)} / ${A.profile.hold.ownerBudgetN} N`);
  const w = A.wrap.get(id);
  if (w) {
    const az = Object.entries(w.azimuthDeg).map(([k, v]) => `${k[0].toUpperCase()} ${f2(v as number, 0)}°`).join(' ');
    lines.push(`  wrap ${w.status}${w.target ? ` on ${w.target}` : ''}${az ? `  az ${az}` : ''}${w.reasons.length ? `  (${w.reasons.join(',')})` : ''}`);
  }
}

function compact(d: Record<string, unknown> | undefined): string {
  return Object.entries(d ?? {})
    .filter(([k]) => k !== 'point')
    .map(([k, v]) => `${k}=${typeof v === 'number' ? round(v, 3) : Array.isArray(v) ? compactArray(v) : v && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}

/** Vectors as rounded tuples; id lists shortened to the first few entries. */
function compactArray(v: unknown[]): string {
  if (v.every((x) => typeof x === 'number')) return `(${v.map((x) => round(x as number, 2)).join(', ')})`;
  const head = v.slice(0, 3).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
  return `[${head.join(',')}${v.length > 3 ? `,+${v.length - 3}` : ''}]`;
}
