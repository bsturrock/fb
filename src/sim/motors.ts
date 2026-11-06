// Bounded locomotion and facing motors (pure functions). Forces are requests with finite caps; the engine decides motion.
import type { LocomotionIntent } from './contracts';
import type { MotorProfile } from './profiles';
import { clamp, clampLen, dot, forwardOf, horiz, len, scale, signedAngleY, sub, type Quat, type Vec3, v3 } from './vec';

export interface DriveResult {
  requestedVelocity: Vec3; // after the request-speed clamp
  force: Vec3; // horizontal, N (zero when unsupported)
  cap: number; // N actually available this substep
  saturated: boolean;
}

/**
 * vError = desired - actual (horizontal); F = m * vError / tau; |F| <= maxDrive * effort * leanScale.
 * One combined horizontal vector budget. No ground drive while unsupported.
 */
export function computeDrive(
  intent: LocomotionIntent,
  actualVelocity: Vec3,
  massKg: number,
  motor: MotorProfile,
  supported: boolean,
  leanScale = 1,
): DriveResult {
  const req = clampLen(horiz(intent.desiredVelocityWorld), motor.maximumRequestedSpeedMps);
  const effort = clamp(Number.isFinite(intent.effort) ? intent.effort : 0, 0, 1);
  const cap = supported ? motor.maximumDriveForceN * effort * clamp(leanScale, 0, 1) : 0;
  if (cap <= 0) return { requestedVelocity: req, force: v3(), cap: 0, saturated: false };
  const v = horiz(actualVelocity);
  const vErr = sub(req, v);
  const want = scale(vErr, massKg / motor.velocityResponseTimeS);
  let force = clampLen(want, cap);
  let saturated = len(want) > cap + 1e-9;
  // braking limit (profiles with `braking`): the component against the actual travel is at most m x maxDecel
  const sp = len(v);
  if (motor.braking && sp > 1e-6) {
    const u = scale(v, 1 / sp);
    const along = dot(force, u);
    const lim = massKg * motor.braking.maxDecelMps2;
    if (along < -lim) {
      force = sub(force, scale(u, along + lim));
      saturated = true;
    }
  }
  return { requestedVelocity: req, force, cap, saturated };
}

export interface YawResult {
  torqueY: number;
  angleError: number;
  cap: number;
  saturated: boolean;
}

/** Damped proportional yaw torque toward the requested horizontal facing, capped. */
export function computeYaw(
  intent: LocomotionIntent,
  rotation: Quat,
  angularVelocityY: number,
  motor: MotorProfile,
  supported: boolean,
  /** Support authority scale 0..1 (plan 06a load authority; 1 under the legacy support). */
  scale = 1,
): YawResult {
  const yawEffort = clamp(intent.yawEffort ?? 1, 0, 1);
  const cap = supported ? motor.maximumYawTorqueNm * yawEffort * clamp(scale, 0, 1) : 0;
  const fwd = horiz(forwardOf(rotation));
  const want = horiz(intent.desiredFacingWorld);
  if (cap <= 0 || len(want) < 1e-6 || len(fwd) < 1e-6) return { torqueY: 0, angleError: 0, cap, saturated: false };
  const err = signedAngleY(fwd, want);
  const raw = motor.yawKp * err - motor.yawKd * angularVelocityY;
  const torqueY = clamp(raw, -cap, cap);
  return { torqueY, angleError: err, cap, saturated: Math.abs(raw) > cap + 1e-9 };
}
