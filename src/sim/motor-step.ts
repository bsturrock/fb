// Plan 10f (F9): the motor step, moved out of simulation.ts: per substep, from one snapshot, each proxy player's
// bounded drive and yaw, the rate-limited posture target and (balanced profile) the finite upright support torque, all
// scaled by the suspension's traction authority. A ragdoll gets no motors.
import type { Snapshot } from './contracts';
import { computeDrive, computeYaw } from './motors';
import { availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, leanScale, postureGravityHold } from './balance';
import { add, v3, len, cross, norm, qFromAxisAngle, qRot, upOf, dot, clamp, forwardOf, UP } from './vec';
import type { Simulation, AppliedRecord } from './simulation';
import { bracePosture } from './brace';

/** What the motor step reads from the simulation. */
export type MotorHost = Pick<
  Simulation,
  | 'balanceProfile'
  | 'balanced'
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
        // contact motion M2 follow-up: a braced carrier short of his desired lean holds the lean he has reached
        // (CarrierBracePose.leanHold)
        const up = upOf(b.rotation);
        const reached = host.def.brace?.pose.leanHold === 'reached' && pl.brace && pl.brace.w > 0 && up.y > bal.desiredUp.y;
        const holdUp = reached ? up : bal.desiredUp;
        const hold = pl.sus ? postureGravityHold(holdUp, pl.sus.pivotN / Math.abs(g), g, pl.sus.leverM) : postureGravityHold(holdUp, b.massKg, g, bal.leverM);
        const bt = computeBalanceTorque(up, bal.desiredUp, b.angularVelocity, B, balCap, hold, holdUp);
        balReq = bt.requested;
        balCapped = bt.capped;
        balSat = bt.saturated;
        const c = combineSupportTorque(bt.capped, yaw.cap > 0 ? yaw.torqueY : 0, B.combinedCeilingNm);
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
