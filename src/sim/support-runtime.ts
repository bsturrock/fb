// Plan 10f (F9): the plan 06a suspension support runtime, moved out of simulation.ts: the support probes, the height
// target and the support force with its tip torque.
import { RAPIER } from './physics';
import { type SuspensionSupport } from './profiles';
import { advanceBraking, advanceStance, brakingDemand, classifyProbe, composeTarget, loadAuthority, runHeight, splitSupportForce, suspensionForce, type RunHeight } from './support';
import { type Vec3, v3, vc, horiz, len, add, cross, qRot, sub, clamp, clampLen, smooth } from './vec';
import type { Simulation, PlayerRuntime } from './simulation';
import { hingePivot } from './hinge';

/** What the suspension support runtime reads and writes on the simulation. */
export type SupportHost = Pick<
  Simulation,
  | 'def'
  | 'opts'
  | 'heightCalibration'
  | 'heightModels'
  | 'physics'
  | 'players'
  | 'probeTargets'
  | 'suspension'
  | 'turf'
>;

// ------------------------------------------------------------------ plan 06a: suspension support
/**
 * Probe every suspension proxy from its solved state: vertical ray from the proxy origin against static colliders
 * (turf and obstacles; players, including the player itself, are never probed). `initial`: reset-time classification
 * (no hysteresis). Grounded (support-eligible ground) = a valid probe.
 */
export function updateProbes(host: SupportHost, initial: boolean): void {
  for (const pl of host.players) {
    if (pl.rag || !pl.sus) continue;
    updateProbe1(host, pl, initial);
    pl.grounded = pl.sus.probe.valid;
  }
}

export function updateProbe1(host: SupportHost, pl: PlayerRuntime, initial: boolean): void {
  const S = host.suspension;
  if (!S || !pl.sus) return;
  const o = vc(pl.proxy.body.translation());
  // other players' live bodies (proxy compound or ragdoll segments) obstruct the probe; the player's own never do
  const others: RAPIER.Collider[] = [];
  for (const p2 of host.players) {
    if (p2 === pl) continue;
    if (p2.rag) for (const c of p2.rag.colliders) others.push(c.collider);
    else others.push(...p2.proxy.colliders);
  }
  const hit = host.physics.groundProbe(o, S.probeMaxM + 4, others.length ? [...host.probeTargets, ...others] : host.probeTargets);
  const player = !!hit && others.includes(hit.collider);
  const tag = hit ? host.physics.tags.get(hit.collider.handle) : undefined;
  pl.sus.probe = classifyProbe(
    S,
    hit
      ? { distM: hit.distM, groundY: hit.pointWorld.y, normalUpDot: hit.normal.y, turf: host.turf.has(hit.collider.handle), player, surface: player ? `player:${tag?.playerId ?? '?'}` : (tag?.key ?? 'static') }
      : null,
    initial || pl.sus.probe.valid,
  );
}

/** Stance request (filtered) and the clip-derived running height composed into host substep's height target. */
export function supportTargets(host: SupportHost, pl: PlayerRuntime, S: SuspensionSupport, dt: number): void {
  const st = pl.sus!;
  const req = pl.intent.locomotion.stance;
  st.requestM = req?.heightM ?? S.standingHeightM;
  advanceStance(st, S, clamp(st.requestM, S.targetRangeM[0], S.targetRangeM[1]), dt);
  // stagger is a pose request: rate-bounded so the feet never jump
  const sg = req?.staggerM ?? 0;
  st.staggerM += clamp(sg - st.staggerM, -S.stance.maxRateMps * dt, S.stance.maxRateMps * dt);
  let runM: RunHeight | null = null;
  const P = host.def.runClips;
  if (pl.run && P && host.heightModels && pl.run.w > 0) {
    const r = runHeight(S, P, host.heightModels, pl.run, host.heightCalibration(pl.body), host.def.solver.gravityY);
    runM = r;
    st.bobScale = r.bobScale;
  } else st.bobScale = 1;
  st.runM = runM?.heightM ?? NaN;
  // plan 07 item 4: braking demand from the intent and the solved travel (the drive's own velocity law and limit)
  const B = S.brakingStance;
  if (B) {
    const loco = pl.intent.locomotion;
    const reqH = clampLen(horiz(loco.desiredVelocityWorld), pl.motor.maximumRequestedSpeedMps);
    const supported = pl.controlMode === 'supported' && pl.grounded;
    // unsupported (airborne, falling): no braking state to derive; the blend holds
    const want = supported ? brakingDemand(B, reqH, horiz(vc(pl.proxy.body.linvel())), loco.effort, pl.motor.velocityResponseTimeS, pl.motor.braking?.maxDecelMps2) : null;
    advanceBraking(st, B, want, dt);
  }
  // contact motion M2: the carrier's brace drops the hips by its weight, on top of the preparation drop
  const dropM = host.def.brace && pl.brace && pl.brace.w > 0 ? prepDropM(host, pl) + host.def.brace.pose.dropM * pl.brace.w : prepDropM(host, pl);
  // contact motion polish 1.1: a striking tackler's hip hinge drops his hips too
  composeTarget(st, S, runM, pl.run?.w ?? 0, dt, pl.hinge ? dropM + pl.hinge.dropM : dropM);
}

/** Plan 08: the bounded height drop preparation requests (m), continuous with its weight; 0 without a locomotion profile. */
export function prepDropM(host: SupportHost, pl: PlayerRuntime): number {
  return pl.loco ? host.def.locomotion!.contact.prepDropM * smooth(pl.loco.prepW) : 0;
}

/**
 * Suspension force from the probe of the last solved state: gravity compensation plus spring/damper about the target,
 * clamped to [0, maxForceBW m g], then split (profile application): min(F, m g) vertically at the turf point below the
 * calibrated legacy pivot, the excess vertically through the COM. Only while supported (control mode) with a valid
 * probe; nothing otherwise. Records the load authority, split, pivot torque, lever, power and work. `settle`: reset
 * settling (target constant, no motors).
 */
export function applySupport(host: SupportHost, pl: PlayerRuntime, S: SuspensionSupport, dt: number, settle: boolean): void {
  const st = pl.sus!;
  const b = pl.proxy.body;
  const pr = st.probe;
  st.active = pl.controlMode === 'supported' && pr.valid;
  if (!st.active) {
    st.commandedN = 0;
    st.appliedN = 0;
    st.pivotN = 0;
    st.comN = 0;
    st.tipTorqueNm = v3();
    st.saturated = 'none';
    st.approachLimitMps = NaN;
    st.authority = 0;
    st.powerW = 0;
    return;
  }
  const m = b.mass();
  const g = host.def.solver.gravityY;
  const o = vc(b.translation());
  const q = { ...b.rotation() };
  const com = vc(b.worldCom());
  const v = vc(b.linvel());
  const w = vc(b.angvel());
  const vAt = (p: Vec3): Vec3 => add(v, cross(w, sub(p, com)));
  const h = pr.heightM;
  const f = suspensionForce(S, m, g, h, vAt(o).y, st.targetM, settle ? 0 : st.targetVMps, settle ? 0 : st.targetAMps2);
  st.commandedN = f.commandedN;
  st.appliedN = f.appliedN;
  st.saturated = f.saturated;
  st.approachLimitMps = f.approachLimitMps;
  st.authority = loadAuthority(f.appliedN, m, g);
  // split after the clamp (profile application): min(F, m g) at the turf point below the pivot, the excess through
  // the COM (lift without additional tipping torque); the total vertical force is unchanged
  // contact motion polish 1.1: under a hip hinge the pivot hangs below the centre of mass in the legs' frame
  const pivotLocal = S.application.pivot === 'legacyHemisphere' ? st.pivotLocal : v3(0, -h, 0);
  // (polish 1.2, the ride-down's come-down: his weight forward, the pivot under his body's own frame: `WrapRideDown`)
  const pivot = pl.hinge && !pl.hinge.bodyPivot && !host.opts.debug?.wrap?.trunkBalance ? hingePivot(pl.hinge, q, o, com, pivotLocal, pl.balance.desiredUp) : add(o, qRot(q, pivotLocal));
  st.leverM = len(sub(pivot, com));
  const sp = v3(pivot.x, pr.groundY, pivot.z);
  const split = splitSupportForce(S, f.appliedN, m * Math.abs(g));
  st.pivotN = split.pivotN;
  st.comN = split.comN;
  st.pivotPointWorld = sp;
  st.tipTorqueNm = cross(sub(sp, com), v3(0, split.pivotN, 0));
  st.powerW = split.pivotN * vAt(sp).y + split.comN * v.y;
  st.workJ += st.powerW * dt;
  st.impulseNs += f.appliedN * dt;
  if (split.pivotN > 0) b.addForceAtPoint(v3(0, split.pivotN, 0), sp, true);
  if (split.comN > 0) b.addForceAtPoint(v3(0, split.comN, 0), com, true);
}
