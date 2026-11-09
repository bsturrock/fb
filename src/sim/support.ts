// Plan 06a: ground-probed suspension support (pure functions and per-player state). Locomotion requests a root height;
// this bounded support decides the force; the solver decides the motion. Nothing here sets a position or velocity.
//
// Order per physics substep (simulation.ts stepSubstep, suspension profile only):
//   1. control-mode transitions (loss of support disables the suspension before any falling force);
//   2. intents;
//   3. locomotion phase: the procedural gait and the run-clip playback advance once from the solved travel since the
//      previous substep (pose generation never advances them again);
//   4. height target: stance request (filtered) blended with the clip-derived running height at the playback weight,
//      clamped to the target range and slew-limited; target velocity = the slewed target's own rate; target
//      acceleration = the stance filter's and the truncated bob's exact accelerations at the weight (0 while the range
//      clamp or the slew limit holds the target);
//   5. support force from the probe of the last solved state (gravity compensation and target-acceleration feedforward
//      + spring/damper), clamped to [0, maxForceBW m g], then split (profile `application`): min(F, m g) vertically at
//      the turf point below the calibrated legacy pivot, the excess through the COM (lift without extra tipping torque);
//      the applied load bounds drive and yaw, the balance ceiling is the nominal-weight one while support is valid;
//   6. motors, arms, solve; 7. probe of the solved state; pose from the solved state and the step-3 phase.
import type { SuspensionSupport } from './profiles';
import type { RunClip, RunClipProfile, RunPlayback } from './run-clip';
import { clamp, v3, type Vec3 } from './vec';

/**
 * Probe classification. `obstructed`: the first thing below the root is another player's body (players are never
 * ground, and a leg cannot reach the turf through them).
 */
export type ProbeStatus = 'ok' | 'none' | 'beyondTravel' | 'invalidSurface' | 'invalidNormal' | 'obstructed';

/** Classified ground probe of one player (from the solved state). */
export interface ProbeState {
  status: ProbeStatus;
  /** Support available (status ok, with hysteresis at the travel limit). */
  valid: boolean;
  /** Probed root height above the hit (m); NaN without a hit. */
  heightM: number;
  groundY: number;
  normalUpDot: number;
  /** Probe hit key (turf, obstacle id) for traces. */
  surface: string | null;
}

/** Per-player suspension runtime (reset with the player). */
export interface SuspensionRuntime {
  probe: ProbeState;
  /** Filtered stance height (m) and its rate (m/s). */
  stanceH: number;
  stanceV: number;
  /** Acceleration the stance filter applied this substep (m/s^2). */
  stanceA: number;
  /** Raw request of this substep (before the range clamp), the composed target, its rate, and the stance stagger. */
  requestM: number;
  targetM: number;
  targetVMps: number;
  /** Feedforward acceleration of the target (m/s^2). */
  targetAMps2: number;
  staggerM: number;
  /** Clip-derived running height of this substep and its feasibility scale (NaN / 1 when no clip plays). */
  runM: number;
  bobScale: number;
  /** Force law output of this substep (N): unclamped command, applied (clamped) force, saturation side. */
  commandedN: number;
  appliedN: number;
  saturated: 'none' | 'zero' | 'max';
  /** Plan 07 recovery: the upward approach limit that bound the spring term this substep (m/s), NaN when inactive. */
  approachLimitMps: number;
  /** Load authority scale (applied / m g, clamped to 0..1) used for drive and yaw this substep. */
  authority: number;
  /** COM to pivot lever (m) of this substep (posture gravity hold). */
  leverM: number;
  /** Calibrated legacy pivot (body-local): the support capsule's lower hemisphere centre; set when the player is built. */
  pivotLocal: Vec3;
  /** Split of the applied force (N): at the pivot's turf point and through the COM; their sum is appliedN. */
  pivotN: number;
  comN: number;
  /** Turf point below the pivot (world) and the pivot force's torque about the COM (N m; the COM share adds none). */
  pivotPointWorld: Vec3;
  tipTorqueNm: Vec3;
  /** Cumulative work of the applied support force (J) and power of the last substep (W). */
  workJ: number;
  powerW: number;
  /** Cumulative vertical impulse of the applied support force (N s): with gravity, the only vertical force on a free proxy. */
  impulseNs: number;
  /** Guard (bump stop) touching static ground after the last solve. */
  bottomed: boolean;
  /** Support was applied this substep (supported control, valid probe). */
  active: boolean;
  /**
   * Plan 07 item 4 braking stance (profile `brakingStance`; 0 otherwise): this substep's braking demand (0..1) and the
   * filtered blend b with its rate and acceleration.
   */
  brakeWant: number;
  brakeB: number;
  brakeV: number;
  brakeA: number;
}

export function newSuspensionRuntime(h0: number): SuspensionRuntime {
  return {
    probe: { status: 'none', valid: false, heightM: NaN, groundY: 0, normalUpDot: 0, surface: null },
    stanceH: h0,
    stanceV: 0,
    stanceA: 0,
    requestM: h0,
    targetM: h0,
    targetVMps: 0,
    targetAMps2: 0,
    staggerM: 0,
    runM: NaN,
    bobScale: 1,
    commandedN: 0,
    appliedN: 0,
    saturated: 'none',
    approachLimitMps: NaN,
    authority: 0,
    leverM: 0,
    pivotLocal: v3(),
    pivotN: 0,
    comN: 0,
    pivotPointWorld: v3(),
    tipTorqueNm: v3(),
    workJ: 0,
    powerW: 0,
    impulseNs: 0,
    bottomed: false,
    active: false,
    brakeWant: 0,
    brakeB: 0,
    brakeV: 0,
    brakeA: 0,
  };
}

/**
 * Split of the clamped support force (after the [0, maxForceBW m g] clamp): the pivot carries at most the body weight,
 * the excess acts through the COM. Under `excess: 'atPivot'` (superseded) the pivot carries all of it.
 */
export function splitSupportForce(S: SuspensionSupport, appliedN: number, weightN: number): { pivotN: number; comN: number } {
  const pivotN = S.application.excess === 'throughCom' ? Math.min(appliedN, weightN) : appliedN;
  return { pivotN, comN: appliedN - pivotN };
}

/** Spring and damper gains for the measured mass (N/m, N s/m). */
export function suspensionGains(S: SuspensionSupport, massKg: number): { k: number; c: number } {
  const w = 2 * Math.PI * S.frequencyHz;
  return { k: massKg * w * w, c: 2 * S.dampingRatio * massKg * w };
}

/** Output of the force law for one substep. */
export interface SuspensionForce {
  commandedN: number;
  appliedN: number;
  saturated: 'none' | 'zero' | 'max';
  /**
   * Plan 07 recovery bound (profiles with `recovery`): the upward approach speed limit relative to the target
   * (v_t + sqrt(2 a_b e), m/s) when it bound the spring term this substep, else NaN (the unmodified law).
   */
  approachLimitMps: number;
}

/**
 * F = m (g + a_t) + k (h_t - h) + c (v_t - v), clamped to [0, maxForceBW m g]. `h`, `v`: probed root height and its
 * vertical velocity relative to the (static) ground; `at`: the target's feedforward acceleration.
 *
 * Written as F = m (g + a_t) + c (v_ref - v) with v_ref = v_t + (k / c) e and e = h_t - h, the spring term asks the body
 * to approach the target at v_ref. Plan 07 recovery (profile `recovery`): below the target (e > 0) that approach speed is
 * bounded by v_t + sqrt(2 a_b e), a_b = recovery.approachBrakeG g: the speed from which the body still reaches the target
 * while decelerating at a_b, which a push-only support can always produce (it can remove force, down to gravity alone,
 * but never pull). Stateless and derived from the solved compression and velocity only. The bound is inactive for
 * e <= 2 a_b (c / k)^2 (13 mm at 7 Hz, zeta 0.8, 0.5 g), where the original expression is evaluated unchanged.
 */
export function suspensionForce(
  S: SuspensionSupport,
  massKg: number,
  g: number,
  h: number,
  v: number,
  ht: number,
  vt: number,
  at = 0,
): SuspensionForce {
  const { k, c } = suspensionGains(S, massKg);
  const W = massKg * Math.abs(g);
  const e = ht - h;
  let cmd = W + massKg * at + k * e + c * (vt - v);
  let lim = NaN;
  if (S.recovery && e > 0) {
    const vLim = Math.sqrt(2 * S.recovery.approachBrakeG * Math.abs(g) * e);
    if ((k / c) * e > vLim) {
      lim = vt + vLim;
      cmd = W + massKg * at + c * (lim - v);
    }
  }
  const max = S.maxForceBW * W;
  if (!(cmd > 0)) return { commandedN: cmd, appliedN: 0, saturated: 'zero', approachLimitMps: lim };
  if (cmd > max) return { commandedN: cmd, appliedN: max, saturated: 'max', approachLimitMps: lim };
  return { commandedN: cmd, appliedN: cmd, saturated: 'none', approachLimitMps: lim };
}

/**
 * Classify a probe hit. Support needs a turf surface with an acceptable normal within travel, not under another player;
 * once lost it re-acquires only below probeMaxM - probeHysteresisM.
 */
export function classifyProbe(
  S: SuspensionSupport,
  hit: { distM: number; groundY: number; normalUpDot: number; turf: boolean; player?: boolean; surface: string } | null,
  wasValid: boolean,
): ProbeState {
  if (!hit) return { status: 'none', valid: false, heightM: NaN, groundY: 0, normalUpDot: 0, surface: null };
  let status: ProbeStatus = 'ok';
  const limit = wasValid ? S.probeMaxM : S.probeMaxM - S.probeHysteresisM;
  if (hit.player) status = 'obstructed';
  else if (!hit.turf) status = 'invalidSurface';
  else if (hit.normalUpDot < S.normalMinDotUp) status = 'invalidNormal';
  else if (hit.distM > limit) status = 'beyondTravel';
  return { status, valid: status === 'ok', heightM: hit.distM, groundY: hit.groundY, normalUpDot: hit.normalUpDot, surface: hit.surface };
}

/** Stance request filter: critically damped second order toward `request`, acceleration- and rate-bounded; one substep. */
export function advanceStance(st: SuspensionRuntime, S: SuspensionSupport, request: number, dt: number): void {
  const w = 2 * Math.PI * S.stance.frequencyHz;
  const a = clamp(w * w * (request - st.stanceH) - 2 * w * st.stanceV, -S.stance.maxAccelMps2, S.stance.maxAccelMps2);
  const v = clamp(st.stanceV + a * dt, -S.stance.maxRateMps, S.stance.maxRateMps);
  st.stanceA = dt > 0 ? (v - st.stanceV) / dt : 0;
  st.stanceV = v;
  st.stanceH += st.stanceV * dt;
}

// ------------------------------------------------------------------------------------------- braking stance
type BrakingStance = NonNullable<SuspensionSupport['brakingStance']>;

/**
 * Braking demand (0..1) of one substep from the locomotion intent and the solved travel: the deceleration the drive's
 * velocity law asks for against the actual horizontal travel, effort x max(0, |v| - req . v/|v|) / tauS, over the
 * motor's braking limit, times smoothstep(|v| / fullSpeedMps). 0 without a braking limit or at rest.
 */
export function brakingDemand(B: BrakingStance, reqH: Vec3, velH: Vec3, effort: number, tauS: number, maxDecelMps2: number | undefined): number {
  if (!(maxDecelMps2 && maxDecelMps2 > 0) || !(tauS > 0)) return 0;
  const sp = Math.hypot(velH.x, velH.z);
  if (sp < 1e-6) return 0;
  const along = (reqH.x * velH.x + reqH.z * velH.z) / sp;
  const decel = (clamp(Number.isFinite(effort) ? effort : 0, 0, 1) * Math.max(0, sp - along)) / tauS;
  const x = clamp(sp / B.fullSpeedMps, 0, 1);
  return clamp(decel / maxDecelMps2, 0, 1) * x * x * (3 - 2 * x);
}

/**
 * Braking blend filter: critically damped toward the demand, rate and acceleration bounded, b kept in [0, 1]. `want`
 * null (unsupported: there is no braking state to derive) holds b with zero rate, so a landing meets the held stance.
 */
export function advanceBraking(st: SuspensionRuntime, B: BrakingStance, want: number | null, dt: number): void {
  if (want === null) {
    st.brakeWant = NaN;
    st.brakeV = 0;
    st.brakeA = 0;
    return;
  }
  st.brakeWant = want;
  if (!(dt > 0)) return;
  const w = 2 * Math.PI * B.frequencyHz;
  const a = clamp(w * w * (want - st.brakeB) - 2 * w * st.brakeV, -B.maxAccelPerS2, B.maxAccelPerS2);
  let v = clamp(st.brakeV + a * dt, -B.maxRatePerS, B.maxRatePerS);
  let b = st.brakeB + v * dt;
  if (b <= 0 || b >= 1) {
    b = clamp(b, 0, 1);
    v = (b - st.brakeB) / dt;
  }
  st.brakeA = (v - st.brakeV) / dt;
  st.brakeV = v;
  st.brakeB = b;
}

// ------------------------------------------------------------------------------------------- running height
/**
 * Clip pelvis-to-ground model: the hip-joint (UpLeg) midpoint height above the floor of the clip's working frames, in
 * clip leg units above its rest ankle height, as a truncated Fourier series in playback phase u (0 = left touchdown).
 */
export interface ClipHeightModel {
  clipId: string;
  meanLegU: number;
  /** Cosine and sine coefficients of harmonics 1..K (leg units), in playback phase. */
  a: number[];
  b: number[];
  /** Max downward second derivative of the truncated bob over u (leg units per unit phase^2). */
  peakDownLegU: number;
  /** Raw (untruncated) frame extrema (leg units) for reports. */
  rawMinLegU: number;
  rawMaxLegU: number;
}

/** Build the truncated model of a decoded clip (from its unique frames; the seam frame is not repeated). */
export function clipHeightModel(clip: RunClip, K: number): ClipHeightModel {
  const F = clip.frames;
  const N = F.length;
  const z0 = clip.record.sourcePhaseOfZero;
  const y = F.map((f) => 0.5 * (f.leg.left.hip.y + f.leg.right.hip.y));
  const mean = y.reduce((s, x) => s + x, 0) / N;
  const a: number[] = [];
  const b: number[] = [];
  for (let k = 1; k <= K; k++) {
    // frame i sits at source phase i / N = playback phase u + z0
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const th = 2 * Math.PI * k * (i / N - z0);
      re += (y[i] - mean) * Math.cos(th);
      im += (y[i] - mean) * Math.sin(th);
    }
    a.push((2 * re) / N);
    b.push((2 * im) / N);
  }
  let peak = 0;
  for (let j = 0; j < 512; j++) peak = Math.max(peak, -bobAccel(a, b, j / 512));
  return { clipId: clip.id, meanLegU: mean, a, b, peakDownLegU: peak, rawMinLegU: Math.min(...y), rawMaxLegU: Math.max(...y) };
}

/** Truncated bob (leg units) at playback phase u. */
export function bobAt(a: number[], b: number[], u: number): number {
  let s = 0;
  for (let k = 1; k <= a.length; k++) s += a[k - 1] * Math.cos(2 * Math.PI * k * u) + b[k - 1] * Math.sin(2 * Math.PI * k * u);
  return s;
}
/** First derivative of the truncated bob in u (leg units per unit phase). */
export function bobRate(a: number[], b: number[], u: number): number {
  let s = 0;
  for (let k = 1; k <= a.length; k++) {
    const w = 2 * Math.PI * k;
    s += w * (-a[k - 1] * Math.sin(w * u) + b[k - 1] * Math.cos(w * u));
  }
  return s;
}
/** Second derivative of the truncated bob in u (leg units per unit phase^2). */
export function bobAccel(a: number[], b: number[], u: number): number {
  let s = 0;
  for (let k = 1; k <= a.length; k++) {
    const w = 2 * Math.PI * k;
    s -= w * w * (a[k - 1] * Math.cos(w * u) + b[k - 1] * Math.sin(w * u));
  }
  return s;
}

/** Player conversion of the clip heights: leg length, flat-shoe ankle height and the hip landmark's body-local Y. */
export interface HeightCalibration {
  legM: number;
  soleM: number;
  hipLocalY: number;
}

/** Root height (m) of a clip model at phase u with bob scale s. */
export function clipRootHeight(m: ClipHeightModel, cal: HeightCalibration, u: number, s: number): number {
  return cal.soleM + (m.meanLegU + s * bobAt(m.a, m.b, u)) * cal.legM - cal.hipLocalY;
}

export interface RunHeight {
  heightM: number;
  /** Analytic rate and acceleration of the scaled bob at the current phase rate (m/s, m/s^2). */
  velMps: number;
  accelMps2: number;
  bobScale: number;
  peakDownMps2: number;
}

/**
 * Running root height of a playback: the clip blend's heights at the shared phase, with the bob scaled so that the
 * downward acceleration it asks for at the current playback rate stays within maxDownAccelG g.
 */
export function runHeight(
  S: SuspensionSupport,
  P: RunClipProfile,
  models: readonly ClipHeightModel[],
  st: RunPlayback,
  cal: HeightCalibration,
  g: number,
): RunHeight {
  const A = models[st.k];
  const B = models[st.k + 1];
  const t = B && st.blend > 0 ? st.blend : 0;
  const cycleS = B ? P.clips[st.k].record.cycleS + (P.clips[st.k + 1].record.cycleS - P.clips[st.k].record.cycleS) * t : P.clips[st.k].record.cycleS;
  const peakLegU = A.peakDownLegU + ((B?.peakDownLegU ?? A.peakDownLegU) - A.peakDownLegU) * t;
  const uRate = st.rate / cycleS;
  const peak = peakLegU * cal.legM * uRate * uRate;
  // plan 08: a walk's shorter stride bobs less and it walks lower, so the stance leg reaches the ground
  const walkW = P.walk ? Math.max(0, 1 - st.pos) : 0;
  const s0 = peak > 0 ? Math.min(1, (S.run.maxDownAccelG * Math.abs(g)) / peak) : 1;
  const sw = walkW > 0 ? s0 * (1 - walkW * (1 - (st.stride ?? 1))) : s0;
  // plan 13d: the jog bobs less (its lift scale; absent, unchanged)
  const s = st.lift === undefined ? sw : sw * st.lift;
  const hA = clipRootHeight(A, cal, st.u, s);
  const h = (B && t > 0 ? hA + (clipRootHeight(B, cal, st.u, s) - hA) * t : hA) - (walkW > 0 ? walkW * P.walk!.dropM : 0);
  // exact time derivatives of the scaled bob at a constant phase rate (rate and blend changes are not fed forward)
  const mix = (f: (a: number[], b: number[], u: number) => number): number => {
    const x = f(A.a, A.b, st.u);
    return B && t > 0 ? x + (f(B.a, B.b, st.u) - x) * t : x;
  };
  return { heightM: h, velMps: s * mix(bobRate) * cal.legM * uRate, accelMps2: s * mix(bobAccel) * cal.legM * uRate * uRate, bobScale: s, peakDownMps2: peak };
}

/**
 * Compose this substep's height target: (1 - w) stance + w running, clamped to the target range, slew-limited against
 * the previous target; the target velocity is the slewed change over the substep (at reset: the bob's analytic rate at
 * the reset phase, which is also the reset vertical velocity of the body). The feedforward
 * acceleration is the weighted stance-filter and bob acceleration, 0 while the range clamp or the slew limit holds.
 */
export function composeTarget(st: SuspensionRuntime, S: SuspensionSupport, run: Pick<RunHeight, 'heightM' | 'velMps' | 'accelMps2'> | null, weight: number, dt: number, dropM = 0): void {
  const w = run === null || !(weight > 0) ? 0 : clamp(weight, 0, 1);
  const raw0 = run === null || w === 0 ? st.stanceH : st.stanceH + (run.heightM - st.stanceH) * w;
  // plan 07 item 4: the braking stance blends the whole composition (stance and running height/bob) toward the braking
  // height (or a lower filtered stance request); b = 0 leaves the expression untouched
  const B = S.brakingStance;
  const b = B ? st.brakeB : 0;
  const low = B ? Math.min(B.heightM, st.stanceH) : 0;
  // plan 08: a bounded, continuous drop requested by locomotion preparation (0 leaves the expression untouched)
  const raw = (b > 0 ? raw0 + (low - raw0) * b : raw0) - dropM;
  const want = clamp(raw, S.targetRangeM[0], S.targetRangeM[1]);
  if (!(dt > 0)) {
    // reset: the steady-state rate and acceleration of the target at the reset phase (a playing clip's bob)
    st.targetM = want;
    st.targetVMps = run && want === raw ? w * run.velMps : 0;
    st.targetAMps2 = run && want === raw ? w * run.accelMps2 : 0;
    return;
  }
  const step = S.targetSlewMps * dt;
  const held = want !== raw || Math.abs(want - st.targetM) > step;
  const next = st.targetM + clamp(want - st.targetM, -step, step);
  st.targetVMps = (next - st.targetM) / dt;
  st.targetM = next;
  const a0 = (1 - w) * st.stanceA + (run ? w * run.accelMps2 : 0);
  if (!(b > 0) && !(B && st.brakeV !== 0)) {
    st.targetAMps2 = held ? 0 : a0;
    return;
  }
  // the blend's own terms: raw = (1 - b) raw0 + b low (clip weight and phase-rate changes stay unfed, as above)
  const v0 = (1 - w) * st.stanceV + (run ? w * run.velMps : 0);
  const lowLow = B!.heightM <= st.stanceH;
  const vl = lowLow ? 0 : st.stanceV;
  const al = lowLow ? 0 : st.stanceA;
  st.targetAMps2 = held ? 0 : (1 - b) * a0 + st.brakeA * (low - raw0) + 2 * st.brakeV * (vl - v0) + b * al;
}

/** Load authority: applied support force over body weight, clamped to 0..1 (never more than the legacy caps). */
export const loadAuthority = (appliedN: number, massKg: number, g: number): number => clamp(appliedN / (massKg * Math.abs(g)), 0, 1);
