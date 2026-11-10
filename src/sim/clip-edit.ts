// Plan 14: keyframe edits of a supplied run clip, for the lab's run lab (src/lab/run-lab.ts). An edit turns one joint of
// one cycle frame about its pivot: the joint's child joints (positions) and their bones (rotation tracks) turn
// together, so every bone length is kept exactly. The edited data then goes through the same intake analysis and
// decoder as the committed clip (analyzeRunClip, decodeRunClip), so the simulation sees the edited clip's own nominal
// speed, stance intervals and flight, not the committed record's.
//
// Axes, in each frame's own pose: hip and shoulder turn in the pelvis (Hips) and chest (Spine2) frames, the frames the
// decoder reads (bind pose faces +Z, anatomical left +X); knee, elbow and ankle turn about their hinge, the normal of
// the plane of their two segments. A positive angle: hip and shoulder flex = forward, abduct = out from the midline;
// knee and elbow flex = more bend; ankle flex = toes up.
//
// Edits are indexed by cycle frame 0 .. cycleFrames - 1 (source frames); the closing source frame repeats frame 0's
// edit, so the loop stays closed. Pure: no DOM, no simulation state. The lab saves edits to
// models/animations/<clip>.edits.json; nothing else reads that file.
import type { ArmSide } from './contracts';
import { analyzeRunClip, decodeRunClip, RunClipError, validateRunClipSource, type RunClip, type RunClipAnalysis, type RunClipRecord, type RunClipSource } from './run-clip';
import { add, cross, len, norm, qFromAxisAngle, qFromYaw, qMul, qNormalize, qRot, rad, scale, sub, v3, type Quat, type Vec3 } from './vec';

export type EditJoint = 'hip' | 'knee' | 'ankle' | 'shoulder' | 'elbow';
export type EditChannel = 'flex' | 'abduct';

/** One edit: `deg` added to one channel of one joint on one cycle frame. */
export interface ClipEdit {
  frame: number;
  side: ArmSide;
  joint: EditJoint;
  channel: EditChannel;
  deg: number;
}

/** The edits file (models/animations/<clip>.edits.json). `baseDataSha256` is the record's hash of the data edited. */
export interface ClipEditsFile {
  version: 1;
  clip: string;
  baseDataSha256: string;
  edits: ClipEdit[];
}

/** Editable channels, proximal first (the order edits apply in on a frame), with what a positive angle does. */
export const EDIT_JOINTS: readonly { joint: EditJoint; label: string; channels: readonly { channel: EditChannel; positive: string }[] }[] = [
  { joint: 'hip', label: 'hip', channels: [{ channel: 'flex', positive: 'thigh forward' }, { channel: 'abduct', positive: 'leg out' }] },
  { joint: 'knee', label: 'knee', channels: [{ channel: 'flex', positive: 'more bend' }] },
  { joint: 'ankle', label: 'ankle', channels: [{ channel: 'flex', positive: 'toes up' }] },
  { joint: 'shoulder', label: 'shoulder', channels: [{ channel: 'flex', positive: 'arm forward' }, { channel: 'abduct', positive: 'arm out' }] },
  { joint: 'elbow', label: 'elbow', channels: [{ channel: 'flex', positive: 'more bend' }] },
];

/** Largest total edit of one channel on one frame (deg). */
export const EDIT_LIMIT_DEG = 45;

/** Spread weights by distance from the edited frame: 0 edits one frame; 1 adds half to each neighbour; 2 two-thirds, one-third. */
export const SPREAD_WEIGHTS: Readonly<Record<0 | 1 | 2, readonly number[]>> = { 0: [1], 1: [1, 0.5], 2: [1, 2 / 3, 1 / 3] };

const SIDES: ArmSide[] = ['left', 'right'];
const CAP: Record<ArmSide, 'Left' | 'Right'> = { left: 'Left', right: 'Right' };
const JOINT_ORDER = EDIT_JOINTS.map((j) => j.joint);
const CHANNEL_ORDER: EditChannel[] = ['flex', 'abduct'];

const t3 = (a: number[]): Vec3 => v3(a[0], a[1], a[2]);
const tq = (a: number[]): Quat => qNormalize({ x: a[0], y: a[1], z: a[2], w: a[3] });
const frac = (x: number): number => x - Math.floor(x);

interface Chain {
  /** Joint the turn is about. */
  pivot: string;
  /** Joints whose positions turn. */
  moved: string[];
  /** Bones whose rotation tracks turn. */
  bones: string[];
  /** Hinge joints: [proximal, pivot, distal] (turn about the normal of their plane). */
  hinge?: [string, string, string];
  /** Hinge fallback (a straight joint) or ball-joint frame: the rotation track and local axis. */
  frame: 'Hips' | 'Spine2';
}

function chain(side: ArmSide, joint: EditJoint): Chain {
  const S = CAP[side];
  const j = (n: string): string => `${S}${n}`;
  switch (joint) {
    case 'hip':
      return { pivot: j('UpLeg'), moved: ['Leg', 'Foot', 'ToeBase', 'Toe_End'].map(j), bones: ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'].map(j), frame: 'Hips' };
    case 'knee':
      return { pivot: j('Leg'), moved: ['Foot', 'ToeBase', 'Toe_End'].map(j), bones: ['Leg', 'Foot', 'ToeBase', 'Toe_End'].map(j), hinge: [j('UpLeg'), j('Leg'), j('Foot')], frame: 'Hips' };
    case 'ankle':
      return { pivot: j('Foot'), moved: ['ToeBase', 'Toe_End'].map(j), bones: ['Foot', 'ToeBase', 'Toe_End'].map(j), hinge: [j('Leg'), j('Foot'), j('ToeBase')], frame: 'Hips' };
    case 'shoulder':
      return { pivot: j('Arm'), moved: ['ForeArm', 'Hand', 'HandIndex1', 'HandThumb1'].map(j), bones: ['Arm', 'ForeArm', 'Hand', 'HandIndex1', 'HandThumb1'].map(j), frame: 'Spine2' };
    case 'elbow':
      return { pivot: j('ForeArm'), moved: ['Hand', 'HandIndex1', 'HandThumb1'].map(j), bones: ['ForeArm', 'Hand', 'HandIndex1', 'HandThumb1'].map(j), hinge: [j('Arm'), j('ForeArm'), j('Hand')], frame: 'Spine2' };
  }
}

/**
 * Local axis (bind frame) of a channel: flex turns about the right axis (-X: a hanging segment swings forward), abduct
 * about the forward axis, signed per side so positive is out. Hinge fallbacks for a straight joint: the knee bends the
 * heel back (+X), the elbow the hand forward (-X), the ankle the toes up (-X).
 */
function localAxis(side: ArmSide, joint: EditJoint, channel: EditChannel): Vec3 {
  if (channel === 'abduct') return v3(0, 0, side === 'left' ? 1 : -1);
  return joint === 'knee' ? v3(1, 0, 0) : v3(-1, 0, 0);
}

/** The turn axis of an edit in a frame's current pose (world, unit). */
function turnAxis(f: Record<string, number[]>, r: Record<string, number[]>, e: ClipEdit, c: Chain): Vec3 {
  const frameAxis = qRot(tq(r[c.frame]), localAxis(e.side, e.joint, e.channel));
  if (!c.hinge) return norm(frameAxis);
  const [a, p, b] = c.hinge.map((n) => t3(f[n]));
  const n = cross(norm(sub(p, a)), norm(sub(b, p)));
  // near straight (under about 1 degree) the plane is undefined: the frame's axis
  return len(n) < 0.02 ? norm(frameAxis) : norm(n);
}

const key = (e: Pick<ClipEdit, 'frame' | 'side' | 'joint' | 'channel'>): string => `${e.frame}|${e.side}|${e.joint}|${e.channel}`;
const order = (e: ClipEdit): number[] => [e.frame, SIDES.indexOf(e.side), JOINT_ORDER.indexOf(e.joint), CHANNEL_ORDER.indexOf(e.channel)];
const cmp = (a: ClipEdit, b: ClipEdit): number => {
  const x = order(a);
  const y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** One edit per channel (summed), clamped to ±EDIT_LIMIT_DEG, rounded to 0.01 deg, zeros dropped, in apply order. */
export function normalizeEdits(edits: readonly ClipEdit[]): ClipEdit[] {
  const m = new Map<string, ClipEdit>();
  for (const e of edits) {
    const k = key(e);
    const cur = m.get(k);
    m.set(k, { frame: e.frame, side: e.side, joint: e.joint, channel: e.channel, deg: (cur?.deg ?? 0) + e.deg });
  }
  return [...m.values()]
    .map((e) => ({ ...e, deg: Math.round(Math.max(-EDIT_LIMIT_DEG, Math.min(EDIT_LIMIT_DEG, e.deg)) * 100) / 100 }))
    .filter((e) => e.deg !== 0)
    .sort(cmp);
}

/** The edit of one channel on one frame (deg; 0 when none). */
export function editValue(edits: readonly ClipEdit[], at: Pick<ClipEdit, 'frame' | 'side' | 'joint' | 'channel'>): number {
  const k = key(at);
  return edits.find((e) => key(e) === k)?.deg ?? 0;
}

/**
 * Add `deltaDeg` to one channel at `at.frame` and, by SPREAD_WEIGHTS, to its neighbours on the closed cycle of
 * `cycleFrames` frames. Returns the normalized list.
 */
export function addEdit(edits: readonly ClipEdit[], at: Pick<ClipEdit, 'frame' | 'side' | 'joint' | 'channel'>, deltaDeg: number, spread: 0 | 1 | 2, cycleFrames: number): ClipEdit[] {
  const w = SPREAD_WEIGHTS[spread];
  const add: ClipEdit[] = [];
  const seen = new Set<number>();
  for (let d = -(w.length - 1); d < w.length; d++) {
    const frame = (((at.frame + d) % cycleFrames) + cycleFrames) % cycleFrames;
    // a spread wider than the cycle reaches a frame once, at its nearest distance
    if (seen.has(frame)) continue;
    seen.add(frame);
    add.push({ ...at, frame, deg: deltaDeg * w[Math.abs(d)] });
  }
  return normalizeEdits([...edits, ...add]);
}

/** Validate an edits file read from disk or the network (throws RunClipError naming the first problem). */
export function parseClipEdits(clip: string, raw: unknown): ClipEditsFile {
  if (!raw || typeof raw !== 'object') throw new RunClipError(clip, 'edits file is not an object');
  const f = raw as Partial<ClipEditsFile>;
  if (f.version !== 1) throw new RunClipError(clip, `edits file version ${String(f.version)} (expected 1)`);
  if (f.clip !== clip) throw new RunClipError(clip, `edits file is for clip ${String(f.clip)}`);
  if (typeof f.baseDataSha256 !== 'string') throw new RunClipError(clip, 'edits file has no baseDataSha256');
  if (!Array.isArray(f.edits)) throw new RunClipError(clip, 'edits file has no edit list');
  f.edits.forEach((e: Partial<ClipEdit>, i) => {
    const ok =
      Number.isInteger(e.frame) &&
      (e.frame as number) >= 0 &&
      SIDES.includes(e.side as ArmSide) &&
      EDIT_JOINTS.some((j) => j.joint === e.joint && j.channels.some((c) => c.channel === e.channel)) &&
      typeof e.deg === 'number' &&
      Number.isFinite(e.deg);
    if (!ok) throw new RunClipError(clip, `edit ${i} is not a valid edit (${JSON.stringify(e)})`);
  });
  return { version: 1, clip, baseDataSha256: f.baseDataSha256, edits: normalizeEdits(f.edits) };
}

/** Clip source data with the edits applied (a new object; the input is not changed). */
export function applyClipEdits(id: string, raw: unknown, edits: readonly ClipEdit[]): RunClipSource {
  const src = validateRunClipSource(id, raw);
  const N = src.frames.length - 1;
  const out: RunClipSource = { ...src, frames: src.frames.map((f) => ({ ...f })), rot: src.rot.map((r) => ({ ...r })) };
  for (const e of normalizeEdits(edits)) {
    if (e.frame >= N) throw new RunClipError(id, `edit frame ${e.frame} is outside the cycle (0 .. ${N - 1})`);
    const c = chain(e.side, e.joint);
    for (const i of e.frame === 0 ? [0, N] : [e.frame]) {
      const f = out.frames[i];
      const r = out.rot[i];
      const R = qFromAxisAngle(turnAxis(f, r, e, c), rad(e.deg));
      const p0 = t3(f[c.pivot]);
      for (const j of c.moved) {
        if (!f[j]) continue;
        const p = add(p0, qRot(R, sub(t3(f[j]), p0)));
        f[j] = [p.x, p.y, p.z];
      }
      for (const b of c.bones) {
        if (!r[b]) continue;
        const q = qNormalize(qMul(R, tq(r[b])));
        r[b] = [q.x, q.y, q.z, q.w];
      }
    }
  }
  return out;
}

/** 64-bit FNV-1a of the normalized edits (16 hex digits): the edited clip's data identity. */
export function hashEdits(edits: readonly ClipEdit[]): string {
  const s = JSON.stringify(normalizeEdits(edits));
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export interface EditedClip {
  clip: RunClip;
  analysis: RunClipAnalysis;
  data: RunClipSource;
}

/**
 * The clip with the edits applied, re-analysed and decoded: the committed record's identity and policy fields with the
 * edited data's analysis, and the edit hash as its data hash. Throws RunClipError if the edited data fails intake
 * (bone lengths, the loop seam, one stance per foot, a planted toe moving backward).
 */
export function editedRunClip(base: RunClipRecord, raw: unknown, edits: readonly ClipEdit[]): EditedClip {
  const data = applyClipEdits(base.id, raw, edits);
  const analysis = analyzeRunClip(base.id, data);
  const rec: RunClipRecord = { ...base, ...analysis, dataSha256: edits.length ? hashEdits(edits) : base.dataSha256 };
  return { clip: decodeRunClip(rec, data), analysis, data };
}

/** Whether each foot is in its stance interval at cycle frame `i` (analysis phases: 0 = left touchdown). */
export function frameStance(a: RunClipAnalysis, i: number): Record<ArmSide, boolean> {
  const u = frac(i / a.cycleFrames - a.sourcePhaseOfZero);
  const inside = ([lo, hi]: [number, number]): boolean => (lo <= hi ? u >= lo && u < hi : u >= lo || u < hi);
  return { left: inside(a.stance.left), right: inside(a.stance.right) };
}

/** The cycle frame at or before playback phase `u` (0 = left touchdown). */
export function frameOfPhase(a: RunClipAnalysis, u: number): number {
  return Math.floor(frac(u + a.sourcePhaseOfZero) * a.cycleFrames + 1e-9) % a.cycleFrames;
}

/**
 * Joint positions of cycle frame `i` in place, for drawing: centred on the cycle's mean Hips (horizontal) and turned so
 * the clip's travel is +Z, as the decoder normalizes them (m).
 */
export function inPlaceFrame(data: RunClipSource, a: RunClipAnalysis, i: number): Record<string, Vec3> {
  const N = a.cycleFrames;
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < N; k++) {
    cx += data.frames[k].Hips[0];
    cz += data.frames[k].Hips[2];
  }
  const centre = v3(cx / N, 0, cz / N);
  const face = qFromYaw(-rad(a.travelHeadingDeg));
  const out: Record<string, Vec3> = {};
  for (const [j, p] of Object.entries(data.frames[i])) out[j] = qRot(face, sub(t3(p), centre));
  return out;
}

/** Scale a drawn frame (m) by `s` about the floor point under the origin. */
export const scaleFrame = (f: Record<string, Vec3>, s: number): Record<string, Vec3> => Object.fromEntries(Object.entries(f).map(([j, p]) => [j, scale(p, s)]));
