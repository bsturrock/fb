// Plan 10f (F9): representation conversions, moved out of simulation.ts: one batch of proxy-to-ragdoll handoffs at a
// controlled boundary (candidate build and validation, the transfer and its audit, the handoff record and events).
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId } from './contracts';
import { newLocoState } from './locomotion';
import { buildCandidate, externalFromColliders, externalFromRagdoll, holdOverlappingSelfLegs, initEnvelope, ragdollPose, removeRagdoll, switchToRagdoll, validateCandidate, type BornPair, type CandidateEdit, type CandidateReport, type ExternalShape } from './ragdoll';
import { add, cross, dot, round, scale, sub, vc, type Vec3 } from './vec';
import { legsOffInsideConverted } from './pose-runtime';
import type { Simulation, HandoffRecord, PlayerRuntime } from './simulation';
import type { FixtureDef } from './fixture';
import type { FallResponseProfile } from './profiles';

/** What a conversion batch reads and writes on the simulation. */
export type ConversionHost = Pick<
  Simulation,
  | 'activeColliders'
  | 'arms'
  | 'bodyCount'
  | 'byId'
  | 'carrySide'
  | 'def'
  | 'emit'
  | 'fall'
  | 'invalidTransfer'
  | 'obstacleColliders'
  | 'opts'
  | 'physics'
  | 'players'
  | 'rules'
  | 'steps'
  | 't'
>;

/**
 * Contact motion M3 (WRAP_V3's `commit.hold`): the fall response a takedown conversion starts, on a fixture with a ragdoll
 * and no fall response of its own (one with a fall response starts that one for every accepted conversion); none
 * otherwise.
 */
export function takedownHold(def: FixtureDef): FallResponseProfile | undefined {
  return def.ragdoll && !def.fallResponse ? def.wrap?.commit?.hold : undefined;
}

/** Ladder 17 (`bornOverlap`): live colliders as external shapes with their handles and tags (pairs the solve can leave out). */
function tagged(host: ConversionHost, cs: RAPIER.Collider[], shapes: ExternalShape[]): ExternalShape[] {
  if (!host.def.ragdoll!.bornOverlap) return shapes;
  return shapes.map((e, i) => (i < cs.length ? { ...e, handle: cs[i].handle, tag: host.physics.tags.get(cs[i].handle) } : e));
}

/**
 * Ladder 17 (`bornOverlap`): a candidate refused only for external penetration (a trunk or head born in another, never an
 * obstacle past `floorBornM`) whose retry window has passed, or with no window: converted with every born pair left out
 * of the solve, rather than left a rigid falling proxy.
 */
function bornForced(host: ConversionHost, pl: PlayerRuntime, rep: CandidateReport): boolean {
  const R = host.def.ragdoll!;
  const BO = R.bornOverlap;
  if (!BO || !rep.born || rep.reasons.length !== 1 || rep.reasons[0] !== 'externalPenetration') return false;
  if (rep.born.some((p) => p.fixed)) {
    // (a fixed pair within floorBornM is tolerated in the solve; one past it, or with no collider, refuses)
    if (rep.born.some((p) => p.fixed && (p.otherHandle === undefined || p.newDepthM > BO.floorBornM))) return false;
  }
  const W = R.conversionRetry;
  return !W || host.t - (pl.deferred?.t ?? host.t) >= W.windowS - 1e-9;
}

// ------------------------------------------------------------------ Gate 4: representation transition
/**
 * One boundary operation for every player converting now: build all candidates (disabled), validate them together
 * (other converting players are checked as candidates, everyone else as active colliders), then switch the
 * accepted ones atomically and remap their relationships once. Rejected candidates are removed and the player
 * continues as the Gate 3 falling proxy with a recorded handoffRejected reason. Ladder rung 8j
 * (`RagdollProfile.conversionRetry`): a candidate rejected only for external penetration is deferred instead
 * (`handoffDeferred` at the first try, `PlayerRuntime.deferred`), tried again at the next boundary within the window.
 * Ladder 17 (`RagdollProfile.bornOverlap`): a candidate overlapping another player is accepted, its born pairs left out
 * of the solve until separated (`Ragdoll.born`, `releaseBornPairs`).
 */
export function convertPlayers(host: ConversionHost, list: { pl: PlayerRuntime; reason: HandoffRecord['reason']; edit?: CandidateEdit }[]): void {
  const R = host.def.ragdoll!;
  const BO = R.bornOverlap;
  const cands = list.map((c) => ({
    ...c,
    rag: buildCandidate(host.physics, c.pl.id, c.pl.body, c.pl.pose!, R, c.pl.proxy.body.mass(), c.edit, host.def.selfClearance, host.def.jointRange),
    report: null as CandidateReport | null,
    forced: false,
  }));
  let accepted = [...cands];
  for (let pass = 0; pass < cands.length + 1; pass++) {
    for (const c of accepted) {
      const ext: ExternalShape[] = externalFromColliders([], () => '', host.physics.floorCollider);
      ext.push(...tagged(host, host.obstacleColliders, externalFromColliders(host.obstacleColliders, (cc) => host.physics.tags.get(cc.handle)?.key ?? 'obstacle')));
      for (const o of host.players) {
        if (o === c.pl) continue;
        const oc = accepted.find((x) => x.pl === o);
        if (oc) {
          const cs = oc.rag.colliders.map((x) => x.collider);
          ext.push(...tagged(host, cs, externalFromRagdoll(oc.rag)));
        } else {
          const cs = host.activeColliders(o);
          ext.push(...tagged(host, cs, externalFromColliders(cs, (cc) => `${o.id}:${host.physics.tags.get(cc.handle)?.key ?? '?'}`)));
          // contact motion (`LegGuardProfile.physicalLegs`): another supported player's physical legs in the solve are
          // bodies the candidate must clear (a leg kept off is inside a body the solver never sees it against)
          if (o.legs?.enabled) {
            const on = o.legs.colliders.filter((_, i) => o.legs!.on[i]);
            ext.push(...tagged(host, on, externalFromColliders(on, (cc) => `${o.id}:${host.physics.tags.get(cc.handle)?.key ?? '?'}`)));
          }
        }
      }
      const cp: Parameters<typeof validateCandidate>[3] = {};
      for (const pc of c.pl.proxy.colliders) {
        const t = host.physics.tags.get(pc.handle);
        if (t && (t.region === 'torso' || t.region === 'pelvis' || t.region === 'head')) cp[t.region] = { shape: pc.shape, pose: { p: vc(pc.translation()), q: { ...pc.rotation() } } };
      }
      c.report = validateCandidate(c.rag, c.pl.pose!, ext, cp, c.pl.proxy.body.mass());
      // ladder 17: refused only for a trunk born in another past its window: converted with every born pair left out
      c.forced = bornForced(host, c.pl, c.report);
    }
    const still = accepted.filter((c) => c.report!.ok || c.forced);
    if (still.length === accepted.length) break;
    accepted = still;
  }
  for (const c of cands) {
    if (accepted.includes(c)) continue;
    removeRagdoll(host.physics, c.rag);
    const rep = c.report!;
    const prior = c.pl.deferred;
    // ladder rung 8j (`RagdollProfile.conversionRetry`): a candidate rejected only for the profile's reasons (overlapping
    // another body) is tried again at the next substep boundary, within the window from the first rejected try; the
    // player stays the falling proxy meanwhile, its shown pose guarded for validity (no handoff yet: it can still convert)
    const W = R.conversionRetry;
    if (W && rep.reasons.every((r) => W.reasons.includes(r)) && host.t - (prior?.t ?? host.t) < W.windowS - 1e-9) {
      if (prior) prior.tries++;
      else {
        c.pl.deferred = { reason: c.reason, ...(c.edit ? { edit: c.edit } : {}), t: host.t, step: host.steps, tries: 1 };
        host.emit('handoffDeferred', c.pl.id, {
          reasons: rep.reasons.join(','),
          trigger: c.reason,
          windowS: W.windowS,
          maxNewExternalPenetrationM: round(rep.maxNewExternalPenetrationM, 5),
          worstExternal: rep.worstExternal,
        });
      }
      continue;
    }
    const deferred = prior ? { t: prior.t, step: prior.step, tries: prior.tries } : undefined;
    if (prior) delete c.pl.deferred;
    c.pl.handoff = { accepted: false, outcome: 'rejected', t: host.t, step: host.steps, reason: c.reason, report: rep, ...(deferred ? { deferred } : {}) };
    if (host.rules && c.pl.id === host.rules.runnerId) host.rules.disable('invalidHandoff', { reasons: rep.reasons.join(',') });
    host.emit('handoffRejected', c.pl.id, {
      reasons: rep.reasons.join(','),
      trigger: c.reason,
      edit: c.edit ?? null,
      maxAnchorErrM: round(rep.maxAnchorErrM, 5),
      maxNewExternalPenetrationM: round(rep.maxNewExternalPenetrationM, 5),
      worstExternal: rep.worstExternal,
      proxyCoreDepthM: round(rep.proxyCoreDepthM, 5),
      floorPenetrationM: round(rep.floorPenetrationM, 5),
      hingeDeg: Object.fromEntries(Object.entries(rep.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
      maxLandmarkErrM: round(rep.maxLandmarkErrM, 5),
      fallback: 'fallingProxy',
      ...(deferred ? { deferred } : {}),
    });
  }
  // ladder 17: a candidate converted past its window is accepted with what refused it tolerated (its born pairs left out)
  for (const c of accepted) if (c.forced) c.report = { ...c.report!, ok: true, reasons: [], tolerated: [...(c.report!.tolerated ?? []), ...c.report!.reasons] };
  const captured = host.arms?.captureRelations(accepted.map((c) => c.pl.id)) ?? new Map();
  const switched: PlayerId[] = [];
  // ladder 17: the pairs left out in this batch (engine handles, either order), so a pair two candidates were born in is
  // held once
  const heldPairs = new Set<string>();
  for (const c of accepted) {
    const pl = c.pl;
    const before = host.bodyCount(pl.id);
    const oldHandle = pl.proxy.body.handle;
    // ladder 17: the proxy colliders other ragdolls' born pairs may hold, by region, before the switch removes them
    const proxyRegions = BO ? new Map(pl.proxy.colliders.map((pc) => [pc.handle, host.physics.tags.get(pc.handle)?.region])) : null;
    const audit = switchToRagdoll(host.physics, pl.proxy.body, c.rag);
    // contact motion: the physical legs left with the proxy body (removed with its colliders and their tags)
    pl.legs = undefined;
    pl.rag = c.rag;
    // plan 08: an accepted conversion ends the locomotion composition (a rejected one keeps it: falling already cleared it)
    if (pl.loco) {
      if (pl.loco.mode !== 'free') host.emit('locoMode', pl.id, { from: pl.loco.mode, to: 'free', reason: 'conversion' });
      pl.loco = newLocoState();
    }
    pl.representation = 'ragdoll';
    const after = host.bodyCount(pl.id);
    const proxyRemoved = !host.physics.world.bodies.contains(oldHandle) || !host.physics.world.getRigidBody(oldHandle)?.isEnabled();
    const prior = pl.deferred;
    const deferred = prior ? { t: prior.t, step: prior.step, tries: prior.tries } : undefined;
    if (prior) delete pl.deferred;
    if (BO && proxyRegions) {
      carryBornPairs(host, pl, proxyRegions);
      holdBornPairs(host, pl, c.report!, heldPairs);
    }
    pl.handoff = {
      accepted: audit.ok,
      outcome: audit.ok ? 'accepted' : 'transferFailed',
      t: host.t,
      step: host.steps,
      reason: c.reason,
      report: c.report!,
      audit,
      activeBodies: { before, after, proxyRemoved },
      ...(deferred ? { deferred } : {}),
    };
    pl.ragStats = { maxAnchorErrM: c.report!.maxAnchorErrM, maxFloorPenM: 0, maxSpeed: 0, maxHingeOverDeg: 0, hingeOverJoint: null, maxHingeReverseDeg: 0, hingeReverseJoint: null };
    switched.push(pl.id);
    host.emit('representation', pl.id, {
      from: 'proxy',
      to: 'ragdoll',
      trigger: c.reason,
      profile: host.def.ragdoll!.id,
      activeBodies: { before, after, proxyRemoved },
      audit: { ...audit, massDiffKg: round(audit.massDiffKg, 8), linearRelErr: round(audit.linearRelErr, 9), angularRelErr: round(audit.angularRelErr, 9) },
      candidate: {
        maxAnchorErrM: round(c.report!.maxAnchorErrM, 6),
        maxNewExternalPenetrationM: round(c.report!.maxNewExternalPenetrationM, 5),
        worstExternal: c.report!.worstExternal,
        floorPenetrationM: round(c.report!.floorPenetrationM, 5),
        maxLandmarkErrM: round(c.report!.maxLandmarkErrM, 6),
        hingeDeg: Object.fromEntries(Object.entries(c.report!.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
        straightFallback: pl.pose?.straightFallback ?? [],
        ...(c.report!.tolerated ? { tolerated: c.report!.tolerated } : {}),
        ...(pl.rag.born?.length ? { born: pl.rag.born.map((p) => ({ own: p.ownKey, other: p.otherKey, depthM: round(p.depth0M, 5), gross: p.gross })) } : {}),
      },
      ...(deferred ? { deferred } : {}),
    });
    if (!audit.ok) {
      // The proxy is already gone (the audit reads the switched engine state); the assembly remains as diagnostic
      // state. A failed transfer invalidates the trial's physical evidence: no referee completion can follow.
      host.invalidTransfer = { playerId: pl.id, reasons: audit.reasons, t: host.t };
      host.emit('handoffAuditFailure', pl.id, { reasons: audit.reasons.join(','), energyDeltaJ: audit.energyDeltaJ, energyGainLimitJ: audit.energyGainLimitJ, outcome: 'transferFailed' });
      host.rules?.disable('invalidTransfer', { playerId: pl.id, reasons: audit.reasons.join(',') });
    }
  }
  if (switched.length) {
    // contact motion (`LegGuardProfile.physicalLegs`): another player's physical leg inside a new ragdoll leaves the solve
    // until clear
    if (host.def.legGuard?.physicalLegs) legsOffInsideConverted(host, switched.map((id) => host.byId.get(id)!));
    host.arms?.onRepresentationChange(switched, captured);
    // contact motion M3: under a takedown's hold (no fall response of the fixture's own), only a takedown starts one;
    // polish 1.2 (the wrap's drive): a loss of support too, while an arm of his holds (he tripped, he does not let go)
    const takedownOnly = !!takedownHold(host.def);
    const lossHolds = !!host.def.wrap?.drive && !host.opts.debug?.wrap?.noLossHold;
    const starts = (pl: PlayerRuntime): boolean =>
      !takedownOnly || pl.handoff!.reason === 'takedown' || (lossHolds && pl.handoff!.reason === 'lossOfSupport' && (['left', 'right'] as const).some((s) => !!host.arms?.retained(pl.id, s)));
    for (const id of switched) {
      const pl = host.byId.get(id)!;
      pl.pose = ragdollPose(pl.rag!);
      // plan 09: the anatomical range starts with the ragdoll; the effort layer only after an accepted transfer
      initEnvelope(pl.rag!);
      // ladder rung 9a: own-leg groups that start deeper inside each other than the skin stay out of the solve
      holdOverlappingSelfLegs(host.physics, pl.rag!);
      if (host.fall && pl.handoff?.accepted && starts(pl)) pl.fall = host.fall.begin(pl.id, pl.rag!, pl.setup.role, host.arms, host.carrySide(pl));
    }
  }
}

// ------------------------------------------------------------------ ladder 17: born pairs
/** The ragdoll collider with the geometry of a proxy's trunk, pelvis or head collider (`buildCandidate` builds them alike). */
const PROXY_TWIN: Partial<Record<string, { segment: string; region: string }>> = {
  torso: { segment: 'core', region: 'torso' },
  pelvis: { segment: 'core', region: 'pelvis' },
  head: { segment: 'head', region: 'head' },
};

/**
 * Ladder 17: the switched player's born pairs: every pair of its accepted report deeper than the tolerance against another
 * player's collider (not a physical leg, which leaves the solve by its own rule, `legsOffInsideConverted`; not the floor
 * or an obstacle, which stay in it), left out of the solve. Under the fault `debug.conversion.bornInSolve` none is (the
 * pairs are switched in overlapping, as without the profile).
 */
function holdBornPairs(host: ConversionHost, pl: PlayerRuntime, rep: CandidateReport, held: Set<string>): void {
  const rag = pl.rag!;
  if (host.opts.debug?.conversion?.bornInSolve) return;
  const out: BornPair[] = rag.born ?? [];
  for (const p of rep.born ?? []) {
    if (p.fixed || p.leg || p.otherHandle === undefined) continue;
    const k = p.ownHandle < p.otherHandle ? `${p.ownHandle}~${p.otherHandle}` : `${p.otherHandle}~${p.ownHandle}`;
    if (held.has(k)) continue;
    held.add(k);
    out.push({ own: p.ownHandle, other: p.otherHandle, ownKey: p.own, otherKey: p.other, t0: host.t, depth0M: p.newDepthM, maxDepthM: p.newDepthM, gross: p.gross });
  }
  if (out.length) rag.born = out;
}

/**
 * Ladder 17: at a player's switch, another ragdoll's born pair held against one of its proxy colliders goes over to its
 * new ragdoll's collider of the same geometry (trunk, pelvis, head: the new collider starts exactly where the old one was,
 * the same overlap the new candidate's validation reads as not new). A pair held against its support capsule ends (its
 * legs, which replace it, are the new candidate's own pairs).
 */
function carryBornPairs(host: ConversionHost, pl: PlayerRuntime, proxyRegions: Map<number, string | undefined>): void {
  for (const o of host.players) {
    const B = o.rag?.born;
    if (o === pl || !B?.length) continue;
    o.rag!.born = B.flatMap((p) => {
      if (!proxyRegions.has(p.other)) return [p];
      const twin = PROXY_TWIN[proxyRegions.get(p.other) ?? ''];
      const nc = twin && pl.rag!.colliders.find((x) => x.segment === twin.segment && x.region === twin.region);
      if (!nc) {
        host.emit('bornOverlapReleased', o.id, { ...released(host, p), why: 'replaced' });
        return [];
      }
      return [{ ...p, other: nc.collider.handle, otherKey: `${pl.id}:${twin.segment}:${twin.region}` }];
    });
  }
}

/**
 * Ladder 17: before each solve, a born pair takes part again once its shapes are no deeper than the profile's `releaseM`
 * in each other (`bornOverlapReleased`, with how long it was held and its deepest); a pair whose collider has left the
 * world ends with it.
 */
export function releaseBornPairs(host: Pick<Simulation, 'physics' | 'emit' | 't'>, pl: PlayerRuntime): void {
  const rag = pl.rag;
  const B = rag?.born;
  if (!rag || !B?.length) return;
  const releaseM = rag.profile.bornOverlap!.releaseM;
  const w = host.physics.world;
  rag.born = B.filter((p) => {
    const a = w.getCollider(p.own);
    const b = w.getCollider(p.other);
    const gone = !a || !b || !host.physics.tags.has(p.own) || !host.physics.tags.has(p.other);
    let depth = 0;
    if (!gone) {
      const r = a.contactCollider(b, 0);
      depth = r ? Math.max(0, -r.distance) : 0;
      p.maxDepthM = Math.max(p.maxDepthM, depth);
      if (depth > releaseM) return true;
    }
    host.emit('bornOverlapReleased', pl.id, { ...released(host, p), ...(gone ? { why: 'gone' } : {}) });
    return false;
  });
}

/** Ladder 17: a released pair's event data (ladder 18: with the separation's work, under one). */
const released = (host: Pick<Simulation, 't'>, p: BornPair): Record<string, unknown> => ({
  own: p.ownKey,
  other: p.otherKey,
  heldS: round(host.t - p.t0, 5),
  depth0M: round(p.depth0M, 5),
  maxDepthM: round(p.maxDepthM, 5),
  ...(p.workJ !== undefined ? { workJ: round(p.workJ, 4) } : {}),
});

/** The inverse effective mass of a body along `n` at `at` (0 for a body that is not dynamic; its joints not counted). */
function invMassAlong(b: RAPIER.RigidBody, at: Vec3, n: Vec3): number {
  if (!b.isDynamic()) return 0;
  const im = b.effectiveInvMass();
  const lin = n.x * n.x * im.x + n.y * n.y * im.y + n.z * n.z * im.z;
  const u = cross(sub(at, vc(b.worldCom())), n);
  // (the inertia view is shared scratch: read at once)
  const I = b.effectiveWorldInvInertia();
  const [a, bb, c, d, e, f] = [I.m11, I.m12, I.m13, I.m22, I.m23, I.m33];
  return lin + u.x * (a * u.x + bb * u.y + c * u.z) + u.y * (bb * u.x + d * u.y + e * u.z) + u.z * (c * u.x + e * u.y + f * u.z);
}

/**
 * Ladder 18 (`BornOverlapProfile.separation`, the profile's comment): before each solve, every ragdoll's held born pairs
 * at once, ordered by their keys (the lower of the two first), so that no player order changes what is applied or the
 * order forces add on a body: a pair whose shapes have separated (no deeper than `releaseM`) or whose collider has left
 * the world is released (`bornOverlapReleased`, with the separation's work); every other one is pushed apart under the
 * profile's caps.
 */
export function separateBornPairs(host: Pick<Simulation, 'physics' | 'emit' | 't' | 'players' | 'opts' | 'def'>): void {
  const S = host.def.ragdoll!.bornOverlap!.separation!;
  const releaseM = host.def.ragdoll!.bornOverlap!.releaseM;
  const w = host.physics.world;
  const dt = host.physics.dt;
  const uncapped = !!host.opts.debug?.conversion?.bornSeparationUncapped;
  const probe = host.opts.debug?.bornForce;
  const all: { pl: PlayerRuntime; p: BornPair; key: string; flip: boolean }[] = [];
  for (const pl of host.players) {
    for (const p of pl.rag?.born ?? []) {
      const own = `${pl.id}:${p.ownKey}`;
      const flip = p.otherKey < own;
      all.push({ pl, p, key: flip ? `${p.otherKey}~${own}` : `${own}~${p.otherKey}`, flip });
    }
  }
  if (!all.length) return;
  all.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.p.t0 - y.p.t0));
  const gone = new Set<BornPair>();
  for (const { pl, p, key, flip } of all) {
    const lo = w.getCollider(flip ? p.other : p.own);
    const hi = w.getCollider(flip ? p.own : p.other);
    const left = !lo || !hi || !host.physics.tags.has(p.own) || !host.physics.tags.has(p.other);
    const r = left ? null : lo.contactCollider(hi, 0);
    const depth = r ? Math.max(0, -r.distance) : 0;
    if (!left) p.maxDepthM = Math.max(p.maxDepthM, depth);
    if (left || !r || depth <= releaseM) {
      gone.add(p);
      host.emit('bornOverlapReleased', pl.id, { ...released(host, { ...p, workJ: p.workJ ?? 0 }), ...(left ? { why: 'gone' } : {}) });
      continue;
    }
    const bl = lo.parent()!;
    const bh = hi.parent()!;
    const n = vc(r.normal1);
    const m = scale(add(vc(r.point1), vc(r.point2)), 0.5);
    // the relative normal speed at the midpoint (positive: parting) and the impulse that brings it to the target
    const vn = dot(sub(vc(bh.velocityAtPoint(m)), vc(bl.velocityAtPoint(m))), n);
    const K = invMassAlong(bl, m, n) + invMassAlong(bh, m, n);
    if (K <= 0) continue;
    const spent = !uncapped && (p.workJ ?? 0) >= S.workJ;
    const target = uncapped ? depth / dt : spent ? 0 : Math.min(S.maxMps, Math.max(S.minMps, Math.max(p.depth0M, depth) / S.partS));
    let j = Math.min(uncapped ? Infinity : S.maxN * dt, Math.max(0, (target - vn) / K));
    if (j <= 0) continue;
    // the work it would do on the pair (the impulse times its mean normal speed over the change, j vn + K j^2 / 2): the
    // positive part counted, and the impulse cut to what the budget has left (the root of that work = what is left)
    const rest = Math.max(0, S.workJ - (p.workJ ?? 0));
    if (!uncapped && j * vn + 0.5 * K * j * j > rest) j = Math.min(j, (-vn + Math.sqrt(vn * vn + 2 * K * rest)) / K);
    p.workJ = (p.workJ ?? 0) + Math.max(0, j * vn + 0.5 * K * j * j);
    const F = scale(n, j / dt);
    bl.addForceAtPoint(scale(F, -1), m, true);
    bh.addForceAtPoint(F, m, true);
    probe?.({ key, lo: bl, hi: bh, force: scale(F, -1), point: m, depthM: depth });
  }
  if (!gone.size) return;
  for (const pl of host.players) if (pl.rag?.born?.some((p) => gone.has(p))) pl.rag.born = pl.rag.born.filter((p) => !gone.has(p));
}

/** Ladder 17: whether the contact pair (engine handles) is a born pair held out of the solve on either player's ragdoll. */
export function bornHeld(host: Pick<Simulation, 'byId'>, pa: PlayerId | null, pb: PlayerId | null, h1: number, h2: number): boolean {
  const has = (pid: PlayerId | null): boolean => {
    const B = pid === null ? undefined : host.byId.get(pid)?.rag?.born;
    return !!B && B.some((p) => (p.own === h1 && p.other === h2) || (p.own === h2 && p.other === h1));
  };
  return has(pa) || has(pb);
}
