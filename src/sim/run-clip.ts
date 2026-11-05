// Supplied run clips (plan 06): intake analysis, decoding into immutable working samples, per-player playback and
// retargeting into the existing PhysicalPose limb requests. Pose only: nothing here reads or writes physics.
//
// Source format (models/animations/<id>.json, baked by models/scripts/blender/bake_clip.py): per frame, world joint
// positions (m, Y up, +Z forward, anatomical Left on +X) and per-bone world rotations relative to the bind pose; `rest`
// is the source skeleton's bind joints. Decoding is separate from simulation state: a decoded RunClip is shared,
// immutable data; each player owns only its RunPlayback (phase, weight). Ready clips are passed into simulation
// initialization through the fixture's RunClipProfile.
//
// Working samples (per unique frame of the closed cycle):
// - accumulated root travel and yaw drift are removed linearly over the cycle; positions are re-centred on the cycle
//   mean of the Hips (horizontal) and rotated so the mean facing is +Z;
// - legs stay in that ground frame (floor y = 0), in units of the clip's rest leg length (thigh + shin), heights
//   measured from the rest ankle height, so feet keep their floor relation on any calibrated player;
// - arms are unit segment directions in the clip's chest frame (Spine2 rotation), so the arm-to-trunk relation is
//   kept on the player's own (physical, rigid) core.
// The Hips bob, pelvis rotation and spine lean are not transferred: the physical core stays authoritative.
import type { ArmSide } from './contracts';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type RagdollProfile } from './profiles';
import {
  add, addScaled, clamp, closestOnSegment, headingOf, len, norm, qFromYaw, qInvRot, qNormalize, qRot, rad, scale, sub,
  type Pose, type Quat, type Vec3, v3,
} from './vec';

export class RunClipError extends Error {
  constructor(clip: string, message: string) {
    super(`run clip ${clip}: ${message}`);
    this.name = 'RunClipError';
  }
}

const SIDES: ArmSide[] = ['left', 'right'];
const CAP: Record<ArmSide, 'Left' | 'Right'> = { left: 'Left', right: 'Right' };
/** Joints the decoder requires on every frame and in the rest pose. */
export const RUN_CLIP_JOINTS = ['Hips', 'Spine2', ...['Left', 'Right'].flatMap((S) => ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Arm', 'ForeArm', 'Hand'].map((j) => S + j))];
/** Rotation tracks the decoder requires (facing and chest frame). */
export const RUN_CLIP_ROTATIONS = ['Hips', 'Spine2'];

/** Intake policy (chosen, not derived): contact threshold, loop-seam and length tolerances, playback bounds. */
export const RUN_CLIP_POLICY = {
  /** A foot is in contact while its heel (ankle) or toe is within this height of its rest (flat-foot) height (m). */
  contactHeightM: 0.02,
  /** A toe is planted (nominal speed and travel direction) while within this height of its rest height (m). */
  plantedToeHeightM: 0.005,
  /** Max joint distance between the last frame and the first (after travel/yaw removal) for a closed loop (m). */
  seamTolM: 0.01,
  /** Max relative change of a bone length over the frames (a larger change is a scale change). */
  lengthTol: 0.01,
  /** Playback rate bounds relative to the clip's nominal speed. */
  playback: { minRate: 0.7, maxRate: 1.3 },
  phaseZero: 'leftTouchdown' as const,
};

// ------------------------------------------------------------------------------------------- source validation
export interface RunClipSource {
  name: string;
  fps: number;
  frames: Record<string, number[]>[];
  rest: Record<string, number[]>;
  rot: Record<string, number[]>[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isTuple = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(isNum);

/** Structural validation of raw clip data (throws RunClipError naming the first problem). */
export function validateRunClipSource(id: string, raw: unknown): RunClipSource {
  if (raw === undefined || raw === null) throw new RunClipError(id, 'data missing');
  if (typeof raw !== 'object') throw new RunClipError(id, 'data is not an object');
  const s = raw as Partial<RunClipSource>;
  if (!isNum(s.fps) || s.fps <= 0) throw new RunClipError(id, `invalid fps ${String(s.fps)}`);
  if (!Array.isArray(s.frames) || s.frames.length < 3) throw new RunClipError(id, 'needs at least 3 frames');
  if (!Array.isArray(s.rot) || s.rot.length !== s.frames.length) throw new RunClipError(id, 'rotation track count differs from the frame count');
  if (!s.rest || typeof s.rest !== 'object') throw new RunClipError(id, 'rest pose missing');
  for (const j of RUN_CLIP_JOINTS) if (!isTuple(s.rest[j], 3)) throw new RunClipError(id, `rest joint ${j} missing or not finite`);
  s.frames.forEach((f, i) => {
    for (const j of RUN_CLIP_JOINTS) if (!f || !isTuple(f[j], 3)) throw new RunClipError(id, `frame ${i}: joint ${j} missing or not finite`);
  });
  s.rot.forEach((r, i) => {
    for (const j of RUN_CLIP_ROTATIONS) {
      if (!r || !isTuple(r[j], 4)) throw new RunClipError(id, `frame ${i}: rotation ${j} missing or not finite`);
      if (Math.abs(Math.hypot(...r[j]) - 1) > 1e-3) throw new RunClipError(id, `frame ${i}: rotation ${j} is not a unit quaternion`);
    }
  });
  return s as RunClipSource;
}

// ------------------------------------------------------------------------------------------- analysis
const t3 = (a: number[]): Vec3 => v3(a[0], a[1], a[2]);
const tq = (a: number[]): Quat => qNormalize({ x: a[0], y: a[1], z: a[2], w: a[3] });
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const frac = (x: number): number => x - Math.floor(x);
const hz = (a: Vec3): Vec3 => v3(a.x, 0, a.z);

/** Working-frame positions of one cycle (travel/yaw drift removed, centred, mean facing +Z). */
interface Normalized {
  cycleFrames: number;
  frames: Record<string, Vec3>[];
  seamM: number;
  residualTravelM: [number, number, number];
  residualYawDeg: number;
  /** Rotation applied so the planted-toe travel direction is +Z, and the mean pelvis facing relative to it (deg). */
  travelHeadingDeg: number;
  facingVsTravelDeg: number;
  maxLengthChange: number;
}

function boneLen(f: Record<string, number[]>, a: string, b: string): number {
  return len(sub(t3(f[b]), t3(f[a])));
}

function normalizeCycle(id: string, src: RunClipSource): Normalized {
  const F = src.frames;
  const last = F.length - 1;
  const N = last; // the last frame closes the loop (checked below)
  // scale changes: bone lengths must stay those of the rest pose
  let maxLengthChange = 0;
  for (const S of ['Left', 'Right'])
    for (const [a, b] of [['UpLeg', 'Leg'], ['Leg', 'Foot'], ['Arm', 'ForeArm'], ['ForeArm', 'Hand']]) {
      const rest = boneLen(src.rest, S + a, S + b);
      for (const f of F) maxLengthChange = Math.max(maxLengthChange, Math.abs(boneLen(f, S + a, S + b) - rest) / rest);
    }
  if (maxLengthChange > RUN_CLIP_POLICY.lengthTol) throw new RunClipError(id, `bone lengths change by ${(maxLengthChange * 100).toFixed(2)}% (scale change)`);
  const travel = hz(sub(t3(F[last].Hips), t3(F[0].Hips)));
  const yawOfFrame = (i: number): number => headingOf(qRot(tq(src.rot[i].Hips), v3(0, 0, 1)));
  const dYaw = wrapPi(yawOfFrame(last) - yawOfFrame(0));
  // remove linear travel and yaw drift (rotation about the travel-free Hips vertical)
  const drift = (i: number): { t: Vec3; yaw: number } => ({ t: scale(travel, i / N), yaw: (i / N) * dYaw });
  const hipsFree = F.map((f, i) => sub(t3(f.Hips), drift(i).t));
  const undrift = (i: number, p: Vec3): Vec3 => {
    const d = drift(i);
    const c = hz(hipsFree[i]);
    return add(c, qRot(qFromYaw(-d.yaw), sub(sub(p, d.t), c)));
  };
  // mean Hips position over the unique frames; mean pelvis facing (circular mean of the drift-free yaw)
  let sx = 0;
  let sz = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < N; i++) {
    const y = yawOfFrame(i) - drift(i).yaw;
    sx += Math.sin(y);
    sz += Math.cos(y);
    cx += hipsFree[i].x;
    cz += hipsFree[i].z;
  }
  const meanFacing = Math.atan2(sx, sz);
  const centre = v3(cx / N, 0, cz / N);
  const free = F.map((f, i) => {
    const o: Record<string, Vec3> = {};
    for (const j of RUN_CLIP_JOINTS) o[j] = sub(undrift(i, t3(f[j])), centre);
    return o;
  });
  // travel direction: opposite to the planted toes' mean displacement (the clip frame's +Z); not the pelvis facing
  const restToeY = 0.5 * (src.rest.LeftToeBase[1] + src.rest.RightToeBase[1]);
  let back = v3();
  for (const S of ['Left', 'Right'])
    for (let i = 0; i < N; i++) {
      const planted = (k: number): boolean => free[k][`${S}ToeBase`].y - restToeY <= RUN_CLIP_POLICY.plantedToeHeightM;
      if (planted(i) && planted((i + 1) % N)) back = add(back, hz(sub(free[(i + 1) % N][`${S}ToeBase`], free[i][`${S}ToeBase`])));
    }
  if (len(back) < 1e-6) throw new RunClipError(id, 'no planted toe motion: travel direction cannot be calibrated');
  const travelHeading = headingOf(scale(back, -1));
  const face = qFromYaw(-travelHeading);
  const frames = free.map((f) => {
    const o: Record<string, Vec3> = {};
    for (const j of RUN_CLIP_JOINTS) o[j] = qRot(face, f[j]);
    return o;
  });
  let seamM = 0;
  for (const j of RUN_CLIP_JOINTS) seamM = Math.max(seamM, len(sub(frames[last][j], frames[0][j])));
  if (seamM > RUN_CLIP_POLICY.seamTolM) throw new RunClipError(id, `last frame differs from the first by ${seamM.toFixed(4)} m (not a closed cycle)`);
  return {
    cycleFrames: N,
    frames: frames.slice(0, N),
    seamM,
    residualTravelM: [travel.x, 0, travel.z],
    residualYawDeg: (dYaw * 180) / Math.PI,
    travelHeadingDeg: (travelHeading * 180) / Math.PI,
    facingVsTravelDeg: (wrapPi(meanFacing - travelHeading) * 180) / Math.PI,
    maxLengthChange,
  };
}

/** Intake analysis of one clip: everything the record stores that is derived from the samples. */
export interface RunClipAnalysis {
  fps: number;
  sourceFrames: number;
  cycleFrames: number;
  cycleS: number;
  joints: number;
  rotationTracks: number;
  seamM: number;
  residualTravelM: [number, number, number];
  residualYawDeg: number;
  travelHeadingDeg: number;
  facingVsTravelDeg: number;
  maxLengthChange: number;
  /** Rest leg (thigh + shin, mean of both sides), rest ankle and toe heights (m). */
  restLegM: number;
  restAnkleY: number;
  restToeY: number;
  /** Source normalized phase (of the closed cycle) that becomes playback phase 0. */
  sourcePhaseOfZero: number;
  /** Half-open normalized playback phases [touchdown, liftoff) of each foot (phase 0 = left touchdown). */
  stance: Record<ArmSide, [number, number]>;
  /** Fraction of the cycle with neither foot in contact. */
  flightFraction: number;
  /** In-place speed: mean backward speed of the planted toe over planted frame pairs (m/s). */
  nominalSpeedMps: number;
  nominalSpeedSpreadMps: number;
  nominalSpeedPairs: number;
  strideM: number;
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export function analyzeRunClip(id: string, raw: unknown): RunClipAnalysis {
  const src = validateRunClipSource(id, raw);
  const n = normalizeCycle(id, src);
  const N = n.cycleFrames;
  const rest = src.rest;
  const restLegM = 0.5 * SIDES.reduce((s, sd) => s + boneLen(rest, `${CAP[sd]}UpLeg`, `${CAP[sd]}Leg`) + boneLen(rest, `${CAP[sd]}Leg`, `${CAP[sd]}Foot`), 0);
  const restAnkleY = 0.5 * (rest.LeftFoot[1] + rest.RightFoot[1]);
  const restToeY = 0.5 * (rest.LeftToeBase[1] + rest.RightToeBase[1]);
  const th = RUN_CLIP_POLICY.contactHeightM;
  const sole = (i: number, S: string): number => Math.min(n.frames[i][`${S}Foot`].y - restAnkleY, n.frames[i][`${S}ToeBase`].y - restToeY);
  // one stance interval per foot: threshold crossings, linearly interpolated between frames (cyclic)
  const crossings = (S: string): { down: number; up: number } => {
    const down: number[] = [];
    const up: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = sole(i, S) - th;
      const b = sole((i + 1) % N, S) - th;
      if (a > 0 && b <= 0) down.push((i + a / (a - b)) / N);
      if (a <= 0 && b > 0) up.push((i + a / (a - b)) / N);
    }
    if (down.length !== 1 || up.length !== 1) throw new RunClipError(id, `${S} foot: expected one stance interval per cycle, found ${down.length} touchdowns and ${up.length} liftoffs`);
    return { down: down[0], up: up[0] };
  };
  const L = crossings('Left');
  const R = crossings('Right');
  const z0 = L.down;
  const ph = (x: number): number => frac(x - z0);
  const stance = { left: [0, ph(L.up)] as [number, number], right: [ph(R.down), ph(R.up)] as [number, number] };
  const inStance = (u: number, [a, b]: [number, number]): boolean => (a <= b ? u >= a && u < b : u >= a || u < b);
  let flight = 0;
  const M = 4000;
  for (let k = 0; k < M; k++) {
    const u = (k + 0.5) / M;
    if (!inStance(u, stance.left) && !inStance(u, stance.right)) flight++;
  }
  // nominal in-place speed: the planted toe moves backward at the travel speed
  const speeds: number[] = [];
  for (const S of ['Left', 'Right'])
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const contact = (k: number): boolean => n.frames[k][`${S}ToeBase`].y - restToeY <= RUN_CLIP_POLICY.plantedToeHeightM;
      if (!contact(i) || !contact(j)) continue;
      const dz = n.frames[j][`${S}ToeBase`].z - n.frames[i][`${S}ToeBase`].z;
      speeds.push(-dz * src.fps);
    }
  if (!speeds.length) throw new RunClipError(id, 'no planted toe frame pairs: nominal speed cannot be calibrated');
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  if (!(mean > 0.5)) throw new RunClipError(id, `planted toe speed ${mean.toFixed(3)} m/s: not an in-place forward run`);
  const spread = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  const cycleS = N / src.fps;
  return {
    fps: src.fps,
    sourceFrames: src.frames.length,
    cycleFrames: N,
    cycleS: r6(cycleS),
    joints: Object.keys(src.frames[0]).length,
    rotationTracks: Object.keys(src.rot[0]).length,
    seamM: r6(n.seamM),
    residualTravelM: n.residualTravelM.map(r6) as [number, number, number],
    residualYawDeg: r6(n.residualYawDeg),
    travelHeadingDeg: r6(n.travelHeadingDeg),
    facingVsTravelDeg: r6(n.facingVsTravelDeg),
    maxLengthChange: r6(n.maxLengthChange),
    restLegM: r6(restLegM),
    restAnkleY: r6(restAnkleY),
    restToeY: r6(restToeY),
    sourcePhaseOfZero: r6(z0),
    stance: { left: [0, r6(stance.left[1])], right: [r6(stance.right[0]), r6(stance.right[1])] },
    flightFraction: r6(flight / M),
    nominalSpeedMps: r6(mean),
    nominalSpeedSpreadMps: r6(spread),
    nominalSpeedPairs: speeds.length,
    strideM: r6(mean * cycleS),
  };
}

// ------------------------------------------------------------------------------------------- decoded clip
/** Intake record of one clip (src/sim/model/run-clips.record.json). */
export interface RunClipRecord extends RunClipAnalysis {
  id: string;
  name: string;
  source: string;
  sourceSha256: string;
  data: string;
  dataSha256: string;
  rootMotion: { policy: string; removedAtBakeM: [number, number, number] };
  phaseZero: typeof RUN_CLIP_POLICY.phaseZero;
  playback: { minRate: number; maxRate: number };
  /** Max distance (m) between the clip rest joints and the calibrated player's rest joints (same proportions). */
  restVsCalibrationM: number;
  /** Average travel speed the bake removed (cross-check of the in-place calibration; null for a supplied in-place clip). */
  bakeTravelSpeedMps: number | null;
  /** Player rest leg / clip rest leg for the calibrated player. */
  playerLegScale: number;
}

interface WorkFrame {
  /**
   * Ground frame, leg units, y from the rest ankle height: hip (UpLeg), knee (Leg), ankle (Foot), toe (ToeBase); heel
   * and toe heights above their rest (flat-foot) heights (leg units).
   */
  leg: Record<ArmSide, { hip: Vec3; knee: Vec3; ankle: Vec3; toe: Vec3; heelH: number; toeH: number }>;
  /** Unit directions in the chest (Spine2) frame: upper arm (shoulder to elbow), forearm (elbow to wrist). */
  arm: Record<ArmSide, { upper: Vec3; fore: Vec3 }>;
}

/** Decoded clip: immutable working samples plus the record's stored calibration. Shared by every player. */
export interface RunClip {
  readonly id: string;
  /** Clip identity for traces and exports (id @ derivative data hash). */
  readonly identity: string;
  readonly record: Readonly<RunClipRecord>;
  readonly frames: ReadonlyArray<Readonly<WorkFrame>>;
  /** Rest ankle-to-toe (ToeBase) offset of each side, leg units (clip axes). */
  readonly restToe: Readonly<Record<ArmSide, Vec3>>;
  /** Cycle mean of the arm segment directions (not renormalized: the mean hand is linear in them). */
  readonly meanArm: Readonly<Record<ArmSide, { upper: Vec3; fore: Vec3 }>>;
}

const RECORD_KEYS: (keyof RunClipAnalysis)[] = [
  'fps', 'sourceFrames', 'cycleFrames', 'cycleS', 'joints', 'rotationTracks', 'seamM', 'residualYawDeg', 'travelHeadingDeg', 'facingVsTravelDeg', 'maxLengthChange', 'restLegM',
  'restAnkleY', 'restToeY', 'sourcePhaseOfZero', 'flightFraction', 'nominalSpeedMps', 'nominalSpeedSpreadMps', 'nominalSpeedPairs', 'strideM',
];

/**
 * Decode one clip against its intake record. The samples are re-analysed and must reproduce the stored record (a stale
 * or mismatched record is an error, not a silent re-calibration). Pure: no DOM, no simulation state.
 */
export function decodeRunClip(rec: RunClipRecord, raw: unknown): RunClip {
  const id = rec.id;
  const a = analyzeRunClip(id, raw);
  for (const k of RECORD_KEYS) {
    const x = a[k] as number;
    const y = rec[k] as number;
    if (!(Math.abs(x - y) <= 1e-6)) throw new RunClipError(id, `record ${k} ${y} does not match the samples (${x}); re-run npm run intake-clips`);
  }
  for (const s of SIDES) for (const i of [0, 1]) if (Math.abs(a.stance[s][i] - rec.stance[s][i]) > 1e-6) throw new RunClipError(id, `record stance.${s} does not match the samples`);
  if (!(rec.playback.minRate > 0 && rec.playback.maxRate >= rec.playback.minRate)) throw new RunClipError(id, 'invalid playback bounds');
  const src = raw as RunClipSource;
  const n = normalizeCycle(id, src);
  const L = a.restLegM;
  const frames: WorkFrame[] = n.frames.map((f, i) => {
    const g = (p: Vec3): Vec3 => v3(p.x / L, (p.y - a.restAnkleY) / L, p.z / L);
    const chest = tq(src.rot[i].Spine2);
    const dirIn = (from: string, to: string): Vec3 => norm(qInvRot(chest, sub(t3(src.frames[i][to]), t3(src.frames[i][from]))), v3(0, -1, 0));
    const leg = {} as WorkFrame['leg'];
    const arm = {} as WorkFrame['arm'];
    for (const s of SIDES) {
      const S = CAP[s];
      leg[s] = {
        hip: g(f[`${S}UpLeg`]),
        knee: g(f[`${S}Leg`]),
        ankle: g(f[`${S}Foot`]),
        toe: g(f[`${S}ToeBase`]),
        heelH: (f[`${S}Foot`].y - a.restAnkleY) / L,
        toeH: (f[`${S}ToeBase`].y - a.restToeY) / L,
      };
      arm[s] = { upper: dirIn(`${S}Arm`, `${S}ForeArm`), fore: dirIn(`${S}ForeArm`, `${S}Hand`) };
    }
    return { leg, arm };
  });
  const restToe = {} as Record<ArmSide, Vec3>;
  const meanArm = {} as Record<ArmSide, { upper: Vec3; fore: Vec3 }>;
  for (const s of SIDES) {
    restToe[s] = scale(sub(t3(src.rest[`${CAP[s]}ToeBase`]), t3(src.rest[`${CAP[s]}Foot`])), 1 / L);
    let up = v3();
    let fo = v3();
    for (const f of frames) {
      up = add(up, f.arm[s].upper);
      fo = add(fo, f.arm[s].fore);
    }
    meanArm[s] = { upper: scale(up, 1 / frames.length), fore: scale(fo, 1 / frames.length) };
  }
  return deepFreeze({ id, identity: `${id}@${rec.dataSha256.slice(0, 12)}`, record: JSON.parse(JSON.stringify(rec)) as RunClipRecord, frames, restToe, meanArm });
}

/** Freeze a plain data tree (decoded clips are shared by every player and fixture). */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// ------------------------------------------------------------------------------------------- sampling
/** Uniform Catmull-Rom on a closed loop (C1 across the seam). */
function cr(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3_ = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3_);
  return v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

export type ClipSample = WorkFrame;

/** Sample a clip at playback phase u (0 = left touchdown; any real u wraps). Deterministic. */
export function sampleRunClip(clip: RunClip, u: number): ClipSample {
  const N = clip.frames.length;
  const s = frac(frac(u) + clip.record.sourcePhaseOfZero) * N;
  const i1 = Math.floor(s) % N;
  const t = s - Math.floor(s);
  const at = (k: number): WorkFrame => clip.frames[(i1 + k + N) % N];
  const [a, b, c, d] = [at(-1), at(0), at(1), at(2)];
  const leg = {} as WorkFrame['leg'];
  const arm = {} as WorkFrame['arm'];
  for (const sd of SIDES) {
    const P = (k: 'hip' | 'knee' | 'ankle' | 'toe'): Vec3 => cr(a.leg[sd][k], b.leg[sd][k], c.leg[sd][k], d.leg[sd][k], t);
    const H = (k: 'heelH' | 'toeH'): number => cr(v3(a.leg[sd][k]), v3(b.leg[sd][k]), v3(c.leg[sd][k]), v3(d.leg[sd][k]), t).x;
    leg[sd] = { hip: P('hip'), knee: P('knee'), ankle: P('ankle'), toe: P('toe'), heelH: H('heelH'), toeH: H('toeH') };
    const D = (k: 'upper' | 'fore'): Vec3 => norm(cr(a.arm[sd][k], b.arm[sd][k], c.arm[sd][k], d.arm[sd][k], t), b.arm[sd][k]);
    arm[sd] = { upper: D('upper'), fore: D('fore') };
  }
  return { leg, arm };
}

function lerpSample(a: ClipSample, b: ClipSample, t: number): ClipSample {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const L = (x: Vec3, y: Vec3): Vec3 => addScaled(x, sub(y, x), t);
  const leg = {} as WorkFrame['leg'];
  const arm = {} as WorkFrame['arm'];
  for (const s of SIDES) {
    const n = (x: number, y: number): number => x + (y - x) * t;
    leg[s] = {
      hip: L(a.leg[s].hip, b.leg[s].hip),
      knee: L(a.leg[s].knee, b.leg[s].knee),
      ankle: L(a.leg[s].ankle, b.leg[s].ankle),
      toe: L(a.leg[s].toe, b.leg[s].toe),
      heelH: n(a.leg[s].heelH, b.leg[s].heelH),
      toeH: n(a.leg[s].toeH, b.leg[s].toeH),
    };
    arm[s] = { upper: norm(L(a.arm[s].upper, b.arm[s].upper), a.arm[s].upper), fore: norm(L(a.arm[s].fore, b.arm[s].fore), a.arm[s].fore) };
  }
  return { leg, arm };
}

// ------------------------------------------------------------------------------------------- profile + playback
/** Run-clip locomotion profile: the decoded clips (ascending nominal speed) and the playback policy. */
export interface RunClipProfile {
  id: string;
  clips: readonly RunClip[];
  /** Clip weight target ramps 0 -> 1 (smoothstep) over this actual-speed band (m/s); below it the procedural gait. */
  fadeMps: [number, number];
  /** Travel heading follows the actual travel direction within this offset of the body forward (deg). */
  headingMaxDeg: number;
  /** Beyond headingMaxDeg the clip weight target fades to 0 over this many degrees (procedural gait). */
  headingFadeDeg: number;
  /** Max rate of change of the applied clip weight (1/s): the bounded clip <-> procedural transition. */
  weightRatePerS: number;
  /**
   * Max rate of the clip blend position (clips per s; position k + blend between neighbouring clips): a speed change
   * faster than the clips' nominal speed spacing (hard braking) crosses the blend over time instead of in a tick.
   */
  blendRatePerS: number;
  /** Free (unreached, non-carry) arms take the clip arm swing. */
  armSwing: boolean;
  /**
   * Ball-carry arm: share (0..1) of the clip hand's swing about its cycle mean added to the carry hold (0 = a still
   * carry, 1 = the clip's full hand excursion). The ball stays in the carry hand.
   */
  carrySwing: number;
}

/** Profile export without sample data (identity, nominal speeds, bounds and policy). */
export function runClipProfileExport(p: RunClipProfile): Record<string, unknown> {
  return {
    id: p.id,
    clips: p.clips.map((c) => ({
      id: c.id,
      identity: c.identity,
      sourceSha256: c.record.sourceSha256,
      cycleS: c.record.cycleS,
      nominalSpeedMps: c.record.nominalSpeedMps,
      strideM: c.record.strideM,
      playback: c.record.playback,
      stance: c.record.stance,
      phaseZero: c.record.phaseZero,
      rootMotion: c.record.rootMotion.policy,
    })),
    fadeMps: p.fadeMps,
    headingMaxDeg: p.headingMaxDeg,
    headingFadeDeg: p.headingFadeDeg,
    weightRatePerS: p.weightRatePerS,
    blendRatePerS: p.blendRatePerS,
    armSwing: p.armSwing,
    carrySwing: p.carrySwing,
  };
}

/** Checks a profile against the limb geometry it will drive (throws with the reason). */
export function validateRunClipProfile(p: RunClipProfile, R: RagdollProfile): void {
  if (!p.clips.length) throw new RunClipError(p.id, 'profile has no clips');
  for (let i = 1; i < p.clips.length; i++)
    if (!(p.clips[i].record.nominalSpeedMps > p.clips[i - 1].record.nominalSpeedMps)) throw new RunClipError(p.id, 'profile clips must be in ascending nominal speed');
  if (!(p.fadeMps[0] >= 0 && p.fadeMps[1] > p.fadeMps[0])) throw new RunClipError(p.id, 'invalid fade band');
  if (!(p.weightRatePerS > 0)) throw new RunClipError(p.id, 'invalid weight rate');
  if (!(p.blendRatePerS > 0)) throw new RunClipError(p.id, 'invalid blend rate');
  if (!(p.carrySwing >= 0 && p.carrySwing <= 1)) throw new RunClipError(p.id, 'carrySwing must be within 0..1');
  const leg = R.lengths.thigh + R.lengths.shin;
  for (const c of p.clips) {
    const s = leg / c.record.restLegM;
    if (!(s > 0.75 && s < 1.33)) throw new RunClipError(c.id, `leg scale ${s.toFixed(3)} for ragdoll ${R.id} is outside 0.75..1.33`);
  }
}

/** Per-player playback state (owned by the player; reset with it). */
export interface RunPlayback {
  /** Playback phase (0 = left touchdown), [0, 1). */
  u: number;
  /** Applied clip weight (0 = procedural gait only). */
  w: number;
  /** Weight target of the last update. */
  wTarget: number;
  /** Playback rate relative to the blended nominal speed (bounded). */
  rate: number;
  /** Blend between neighbouring clips (0 = clips[k], 1 = clips[k + 1]). */
  blend: number;
  /** Index k of the lower clip of the blend. */
  k: number;
  /** Blend position k + blend (rate-limited toward the speed-selected position). */
  pos: number;
  /** Actual horizontal speed from solved travel (m/s). */
  speed: number;
  /** World travel heading used for the clip frame (rad, as headingOf). */
  heading: number;
  /** Core translation at the previous update (solved travel source). */
  prevP: Vec3 | null;
}

export function newRunPlayback(u0: number): RunPlayback {
  return { u: frac(u0), w: 0, wTarget: 0, rate: 1, blend: 0, k: 0, pos: 0, speed: 0, heading: 0, prevP: null };
}

const smooth = (x: number): number => {
  const s = clamp(x, 0, 1);
  return s * s * (3 - 2 * s);
};

/** Speed-selected blend position k + blend (0 .. clips - 1) at speed v. */
function clipPosition(p: RunClipProfile, v: number): number {
  const C = p.clips;
  if (C.length < 2) return 0;
  let k = 0;
  while (k < C.length - 2 && v > C[k + 1].record.nominalSpeedMps) k++;
  const a = C[k].record;
  const b = C[k + 1].record;
  return k + clamp((v - a.nominalSpeedMps) / (b.nominalSpeedMps - a.nominalSpeedMps), 0, 1);
}

/** Clip pair, blend and the blended stride/cycle/rate bounds at a blend position. */
function selectClips(p: RunClipProfile, pos: number): { k: number; blend: number; strideM: number; cycleS: number; minRate: number; maxRate: number } {
  const C = p.clips;
  const k = Math.max(0, Math.min(C.length - 2, Math.floor(pos)));
  const a = C[k].record;
  const b = (C[k + 1] ?? C[k]).record;
  const blend = C.length > 1 ? clamp(pos - k, 0, 1) : 0;
  const L = (x: number, y: number): number => x + (y - x) * blend;
  return { k, blend, strideM: L(a.strideM, b.strideM), cycleS: L(a.cycleS, b.cycleS), minRate: L(a.playback.minRate, b.playback.minRate), maxRate: L(a.playback.maxRate, b.playback.maxRate) };
}

export interface RunPlaybackInput {
  /** Solved core translation this update. */
  coreP: Vec3;
  /** Body forward (world, any length). */
  forward: Vec3;
  /** Supported and grounded: the clip may play; otherwise the bounded fallback fades to the procedural gait. */
  supported: boolean;
  /** Substep length (s); 0 = initialization (no travel, weight set to its target). */
  dt: number;
  /** Speed used at initialization (solved linear velocity), when there is no travel yet. */
  initSpeed?: number;
  /** Travel direction at initialization (world). */
  initDir?: Vec3;
  /** Player leg length (thigh + shin) and the clip rest leg scale it implies. */
  legM: number;
}

/**
 * Advance one player's playback once per simulation substep from its solved horizontal travel: phase rate is the
 * actual speed over the (scaled) blended stride, bounded by the clips' playback rates. The clip blend position follows
 * the speed-selected one at blendRatePerS. The weight target is the speed band x heading alignment x support; the
 * applied weight moves toward it at weightRatePerS.
 */
export function advanceRunPlayback(st: RunPlayback, p: RunClipProfile, inp: RunPlaybackInput): void {
  const init = inp.dt <= 0 || !st.prevP;
  let travel = v3();
  if (!init) travel = hz(sub(inp.coreP, st.prevP!));
  st.prevP = { ...inp.coreP };
  const speed = init ? (inp.initSpeed ?? 0) : len(travel) / inp.dt;
  const dir = init ? norm(hz(inp.initDir ?? v3()), v3()) : norm(travel, v3());
  const fwd = norm(hz(inp.forward), v3(0, 0, 1));
  const hf = headingOf(fwd);
  let off = 0;
  if (speed > 0.5 && len(dir) > 0.5) off = wrapPi(headingOf(dir) - hf);
  const maxO = rad(p.headingMaxDeg);
  st.heading = hf + clamp(off, -maxO, maxO);
  st.speed = speed;
  const headingW = 1 - smooth((Math.abs(off) - maxO) / rad(Math.max(1e-6, p.headingFadeDeg)));
  st.wTarget = inp.supported ? smooth((speed - p.fadeMps[0]) / (p.fadeMps[1] - p.fadeMps[0])) * headingW : 0;
  const scaleLeg = inp.legM / p.clips[0].record.restLegM;
  const posTarget = clipPosition(p, speed / scaleLeg);
  if (init) st.pos = posTarget;
  else st.pos += clamp(posTarget - st.pos, -p.blendRatePerS * inp.dt, p.blendRatePerS * inp.dt);
  const sel = selectClips(p, st.pos);
  st.k = sel.k;
  st.blend = sel.blend;
  const nominalScaled = (sel.strideM * scaleLeg) / sel.cycleS;
  st.rate = clamp(speed / nominalScaled, sel.minRate, sel.maxRate);
  if (init) {
    st.w = st.wTarget;
    return;
  }
  const step = p.weightRatePerS * inp.dt;
  st.w = st.w + clamp(st.wTarget - st.w, -step, step);
  if (st.w > 0) st.u = frac(st.u + (st.rate * inp.dt) / sel.cycleS);
}

/** Current blended clip sample of a playback (null when the clip weight is 0). */
export function playbackSample(st: RunPlayback, p: RunClipProfile): ClipSample | null {
  if (st.w <= 0) return null;
  const a = sampleRunClip(p.clips[st.k], st.u);
  const b = p.clips[st.k + 1];
  return b && st.blend > 0 ? lerpSample(a, sampleRunClip(b, st.u), st.blend) : a;
}

/** Cycle-mean arm directions of the current clip blend (the reference the carry swing is measured from). */
export function playbackArmMean(st: RunPlayback, p: RunClipProfile): Record<ArmSide, { upper: Vec3; fore: Vec3 }> {
  const a = p.clips[st.k].meanArm;
  const b = p.clips[st.k + 1]?.meanArm;
  const t = b && st.blend > 0 ? st.blend : 0;
  const out = {} as Record<ArmSide, { upper: Vec3; fore: Vec3 }>;
  for (const s of SIDES) out[s] = b ? { upper: lerp3(a[s].upper, b[s].upper, t), fore: lerp3(a[s].fore, b[s].fore, t) } : { ...a[s] };
  return out;
}
const lerp3 = (x: Vec3, y: Vec3, t: number): Vec3 => addScaled(x, sub(y, x), t);

/** Clip label for traces: the clip id, or "lower+upper" while blending. */
export function playbackLabel(st: RunPlayback, p: RunClipProfile): string {
  const b = p.clips[st.k + 1];
  return b && st.blend > 0 ? `${p.clips[st.k].id}+${b.id}` : p.clips[st.k].id;
}

// ------------------------------------------------------------------------------------------- retargeting
/**
 * Stance contact of a sampled leg (foot IK): while the clip foot is on the floor, the ankle is solved so that the
 * shoe's sole point `soleFoot` (shoe frame, from the ankle) lands on `pointWorld` (on the floor), the clip's planted
 * heel/toe mapped into the world. `weight` blends the solved ankle in (1 = in contact in the clip).
 */
export interface SampledContact {
  weight: number;
  pointWorld: Vec3;
  soleFoot: Vec3;
}

/** Clip foot contact: full at or below fullM of heel/toe height, none above offM; heel-to-toe roll over rollM (m). */
const CONTACT = { fullM: 0.005, offM: 0.025, rollM: 0.03 };

/** Body-local limb requests from a clip sample (fed through the existing pose path in pose.ts). */
export interface SampledLimbs {
  /** Applied clip weight (0..1); the procedural requests take the rest. */
  weight: number;
  /**
   * Ankle target and knee pole (body-local); the clip foot's sagittal angle to the floor relative to its rest (flat)
   * angle (rad, toe up positive); stance contact (foot IK) while the clip foot is planted.
   */
  legs: Record<ArmSide, { ankleLocal: Vec3; poleLocal: Vec3; footPitch: number; contact: SampledContact | null }>;
  /**
   * Arm swing (body-local): palm target and elbow pole for a free arm, and the hand's excursion from its cycle mean
   * (`swingLocal`) for the carry arm. Absent when the profile has no arm swing.
   */
  arms?: Record<ArmSide, { palmLocal: Vec3; poleLocal: Vec3; swingLocal: Vec3 }>;
  /** Carry-arm share of the clip hand excursion (profile carrySwing). */
  carrySwing: number;
}

/** Options of retargetSample (profile and clip data of the current playback). */
export interface RetargetOptions {
  armSwing: boolean;
  carrySwing: number;
  restToe: Readonly<Record<ArmSide, Vec3>>;
  armMean: Readonly<Record<ArmSide, { upper: Vec3; fore: Vec3 }>>;
}

/**
 * Retarget a clip sample onto a player. Legs: the ankle target is the clip ankle in the travel frame around the
 * player's hip midpoint, scaled by its leg length, at the clip ankle's height above the floor (the player's flat-shoe
 * ankle height plus the clip's lift), so a planted clip foot is planted at the clip's nominal travel. The knee bends
 * toward the travel direction (a fixed pole: the clip's own knee offset is unreliable near a straight leg). Arms: the
 * clip's chest-frame segment directions from the player's shoulders with its own segment lengths, and each hand's
 * excursion from its cycle mean (the carry swing). The clip's anatomical Left (+X) maps to the body's anatomical left
 * (sideSignX), mirroring when that is -X.
 */
export function retargetSample(sample: ClipSample, weight: number, body: BodyProfile, R: RagdollProfile, core: Pose, heading: number, o: RetargetOptions): SampledLimbs {
  const mx = sideSignX(body, 'left') > 0 ? 1 : -1;
  const M = (p: Vec3): Vec3 => v3(p.x * mx, p.y, p.z);
  const leg = R.lengths.thigh + R.lengths.shin;
  const yawQ = qFromYaw(heading);
  const W = (l: Vec3): Vec3 => add(core.p, qRot(core.q, l));
  const L = (w: Vec3): Vec3 => qInvRot(core.q, sub(w, core.p));
  const Ld = (d: Vec3): Vec3 => qInvRot(core.q, d);
  const hipW = { left: W(hipLocal(body, 'left')), right: W(hipLocal(body, 'right')) };
  const g = v3(0.5 * (hipW.left.x + hipW.right.x), 0, 0.5 * (hipW.left.z + hipW.right.z));
  const sole = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
  const pole = norm(Ld(qRot(yawQ, v3(0, 0, 1))), v3(0, 0, 1));
  const legs = {} as SampledLimbs['legs'];
  for (const s of SIDES) {
    const c = sample.leg[s];
    const a = M(c.ankle);
    const off = qRot(yawQ, v3(a.x * leg, 0, a.z * leg));
    const ankleW = v3(g.x + off.x, sole + c.ankle.y * leg, g.z + off.z);
    // stance contact: the clip's lower of heel and toe (blended over 3 cm of height difference) is the planted point
    const heelM = c.heelH * leg;
    const toeM = c.toeH * leg;
    const cw = 1 - smooth((Math.min(heelM, toeM) - CONTACT.fullM) / (CONTACT.offM - CONTACT.fullM));
    let contact: SampledContact | null = null;
    if (cw > 0) {
      const f = smooth((heelM - toeM) / CONTACT.rollM + 0.5);
      const pc = M(addScaled(c.ankle, sub(c.toe, c.ankle), f));
      const po = qRot(yawQ, v3(pc.x * leg, 0, pc.z * leg));
      // the planted sole point in the shin frame: below the ankle (heel) to below the toe base, inside the shoe box
      const toeZ = Math.min(M(o.restToe[s]).z * leg, R.shoe.forwardM + R.shoe.halfExtents.z);
      contact = { weight: cw, pointWorld: v3(g.x + po.x, 0, g.z + po.z), soleFoot: v3(0, -sole, toeZ * f) };
    }
    // foot angle in the travel plane (clip +Z) relative to the rest foot's angle below the horizontal (the shoe's flat)
    const fv = sub(c.toe, c.ankle);
    const rv = o.restToe[s];
    const footPitch = wrapPi(Math.atan2(fv.y, fv.z) - Math.atan2(rv.y, Math.hypot(rv.x, rv.z)));
    legs[s] = { ankleLocal: L(ankleW), poleLocal: pole, footPitch, contact };
  }
  let arms: SampledLimbs['arms'];
  if (o.armSwing) {
    arms = {} as NonNullable<SampledLimbs['arms']>;
    const Lu = R.lengths.upperArm;
    const Lf = R.lengths.forearm + R.lengths.palmExtension;
    for (const s of SIDES) {
      const sh = shoulderLocal(body, s);
      const u = M(sample.arm[s].upper);
      const f = M(sample.arm[s].fore);
      const elbow = addScaled(sh, u, Lu);
      const palm = addScaled(elbow, f, Lf);
      const k = closestOnSegment(elbow, sh, palm).point;
      // a straight arm has no bend plane: elbow points back and out (the procedural arm's pole)
      const fallback = v3(0.6 * sideSignX(body, s), -0.5, -0.6);
      const swing = add(scale(sub(u, M(o.armMean[s].upper)), Lu), scale(sub(f, M(o.armMean[s].fore)), Lf));
      arms[s] = { palmLocal: palm, poleLocal: norm(sub(elbow, k), fallback), swingLocal: swing };
    }
  }
  return { weight, legs, arms, carrySwing: o.carrySwing };
}
