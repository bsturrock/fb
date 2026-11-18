// Plan 10f (F9): the motor step, moved out of simulation.ts: per substep, from one snapshot, each proxy player's
// bounded drive and yaw, the rate-limited posture target and (balanced profile) the finite upright support torque, all
// scaled by the suspension's traction authority. A ragdoll gets no motors.
import type { Snapshot } from './contracts';
import { computeDrive, computeYaw } from './motors';
import { availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, leanScale, postureGravityHold } from './balance';
import { add, v3, vc, len, cross, norm, qFromAxisAngle, qRot, upOf, dot, clamp, forwardOf, UP } from './vec';
import type { Simulation, AppliedRecord } from './simulation';
import { bracePosture } from './brace';
import { hingeBalanceTorque } from './hinge';
import { baseCeiling, baseMoments, copBounds, limitToBase, SOLE_TOUCH_M, soleContacts, type BaseMoments } from './block-base';

/** What the motor step reads from the simulation. */
export type MotorHost = Pick<
  Simulation,
  | 'balanceProfile'
  | 'balanced'
  | 'coreBody'
  | 'def'
  | 'physics'
  | 'players'
  | 'suspension'
>;

export const EMPTY_APPLIED = (): AppliedRecord => ({
  requestedVelocity: v3(),
  drive: v3(),
  driveCap: 0,
  driveSaturated: false,
  yawTorque: 0,
  yawCap: 0,
  yawError: 0,
  balanceRequested: v3(),
  balanceCapped: v3(),
  balanceCap: 0,
  balanceSaturated: false,
  supportTorque: v3(),
  supportScale: 1,
  leanScale: 1,
});

/** Step 5: bounded motors for every proxy player (ragdolls get none): drive, yaw and the finite upright support torque. */
export function applyMotors(host: MotorHost, snap: Snapshot): void {
  const B = host.balanceProfile;
  for (const pl of host.players) {
    if (pl.rag) {
      pl.applied = EMPTY_APPLIED(); // passive ragdoll: no locomotion, yaw, balance or pose-following motors
      continue;
    }
    const b = snap.bodies[pl.id];
    const supported = pl.controlMode === 'supported' && pl.grounded;
    const bal = pl.balance;
    let ls = 1;
    if (host.balanced) {
      ls = leanScale(bal.theta, B);
      // posture request: desired up, rate-limited toward the requested lean (<= max posture lean); contact motion M2: the
      // carrier's brace leans him toward his travel by its weight
      const braced = host.def.brace && pl.brace && pl.brace.w > 0 ? host.def.brace.pose : null;
      const pr = braced ? bracePosture(braced, pl.brace!.w, pl.intent.posture, b.linearVelocity, forwardOf(b.rotation)) : pl.intent.posture;
      const target = pr ? desiredUpFrom(clamp(pr.leanRad, 0, B.maxPostureLeanRad), pr.leanDirWorld) : { ...UP };
      const ang = Math.acos(clamp(dot(bal.desiredUp, target), -1, 1));
      const maxStep = (braced?.leanRateDegPerS !== undefined ? (braced.leanRateDegPerS * Math.PI) / 180 : B.postureRateRadPerS) * host.physics.dt;
      if (ang <= maxStep || ang < 1e-9) bal.desiredUp = target;
      else {
        const ax = cross(bal.desiredUp, target);
        bal.desiredUp = len(ax) > 1e-12 ? norm(qRot(qFromAxisAngle(norm(ax), maxStep), bal.desiredUp)) : target;
      }
    }
    // plan 06a: the applied suspension load bounds traction (drive and yaw scale with it, never above the legacy caps)
    const auth = pl.sus ? pl.sus.authority : 1;
    // plan 13e: the idle sway joins the drive's request only
    const loco = pl.sway ? { ...pl.intent.locomotion, desiredVelocityWorld: add(pl.intent.locomotion.desiredVelocityWorld, pl.sway) } : pl.intent.locomotion;
    const drive = computeDrive(loco, b.linearVelocity, b.massKg, pl.motor, supported, ls * auth);
    const yaw = computeYaw(pl.intent.locomotion, b.rotation, b.angularVelocity.y, pl.motor, supported, auth);
    if (drive.cap > 0) pl.proxy.body.addForce(drive.force, true);
    let balReq = v3();
    let balCapped = v3();
    let balCap = 0;
    let balSat = false;
    let support = v3(0, yaw.cap > 0 ? yaw.torqueY : 0, 0);
    let supportScale = 1;
    if (host.balanced) {
      if (supported) {
        // plan 06a: under the suspension the upright torque ceiling follows the profile's balanceCeiling rule (nominal
        // body weight by default, 0 without valid support); the posture hold uses the applied load and the solved lever
        const g = host.def.solver.gravityY;
        const Sb = host.suspension;
        balCap = !pl.sus
          ? availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM)
          : !pl.sus.active
            ? 0
            : Sb?.balanceCeiling === 'appliedLoad'
              ? Math.min(B.maxBalanceTorqueNm, pl.sus.appliedN * pl.body.supportRadiusM)
              : availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM);
        // plan 16 (the base): an engaged blocker whose base resists holds what his planted feet give (block-base.ts)
        const base = baseOf(host, pl, b.massKg * Math.abs(g));
        if (base) balCap = baseCeiling(base.m);
        // contact motion M2 follow-up: a braced carrier short of his desired lean holds the lean he has reached
        // (CarrierBracePose.leanHold)
        const up = upOf(b.rotation);
        const reached = host.def.brace?.pose.leanHold === 'reached' && pl.brace && pl.brace.w > 0 && up.y > bal.desiredUp.y;
        const holdUp = reached ? up : bal.desiredUp;
        const hold = pl.sus ? postureGravityHold(holdUp, pl.sus.pivotN / Math.abs(g), g, pl.sus.leverM) : postureGravityHold(holdUp, b.massKg, g, bal.leverM);
        // contact motion polish 1.1: under a hip hinge, the legs' balance first, then the trunk's pitch (hinge.ts)
        const bt = pl.hinge ? hingeBalanceTorque(pl.hinge, b.rotation, b.angularVelocity, bal.desiredUp, B, balCap, hold, holdUp) : computeBalanceTorque(up, bal.desiredUp, b.angularVelocity, B, balCap, hold, holdUp);
        const held = base ? limitToBase(bt.capped, base.m, base.u) : null;
        balReq = bt.requested;
        balCapped = held ? held.torque : bt.capped;
        balSat = bt.saturated || !!held?.saturated;
        // (the yaw keeps its room above the balance: the combined ceiling rises with a base past the fixed one)
        const ceiling = base ? B.combinedCeilingNm + Math.max(0, balCap - B.maxBalanceTorqueNm) : B.combinedCeilingNm;
        const c = combineSupportTorque(balCapped, yaw.cap > 0 ? yaw.torqueY : 0, ceiling);
        support = c.torque;
        supportScale = c.scale;
      } else support = v3();
    }
    if (len(support) > 0) pl.proxy.body.addTorque(support, true);
    pl.applied = {
      requestedVelocity: drive.requestedVelocity,
      drive: drive.force,
      driveCap: drive.cap,
      driveSaturated: drive.saturated,
      yawTorque: yaw.torqueY,
      yawCap: yaw.cap,
      yawError: yaw.angleError,
      balanceRequested: balReq,
      balanceCapped: balCapped,
      balanceCap: balCap,
      balanceSaturated: balSat,
      supportTorque: support,
      supportScale,
      leanScale: ls,
    };
  }
}

/**
 * Plan 16: the base of a supported man engaged in a block whose profile's base resists (`BlockBase.resist`): what his
 * planted soles give about his support's ground point, along the line to his man (null otherwise: the ordinary ceiling).
 */
function baseOf(host: MotorHost, pl: MotorHost['players'][number], weightN: number): { m: BaseMoments; u: ReturnType<typeof v3> } | null {
  const blk = pl.block;
  if (!blk?.base?.resist || blk.phase !== 'engaged' || !pl.sus?.active || !pl.feet) return null;
  const him = host.players.find((o) => o.id === blk.target);
  if (!him) return null;
  const me = pl.proxy.body.translation();
  const to = host.coreBody(him).translation();
  const d = v3(to.x - me.x, 0, to.z - me.z);
  const u = len(d) > 1e-9 ? norm(d) : v3(0, 0, 1);
  // (p35, BASE_V3: read from the soles and his centre of mass, a heel within the limit bearing weight)
  const S = blk.base.soles;
  if (S) return { m: copBounds(soleContacts(pl.feet, SOLE_TOUCH_M, S), pl.sus.pivotPointWorld, vc(pl.proxy.body.worldCom()), u, weightN), u };
  return { m: baseMoments(soleContacts(pl.feet, SOLE_TOUCH_M), pl.sus.pivotPointWorld, u, weightN), u };
}
