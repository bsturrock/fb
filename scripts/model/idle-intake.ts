// Idle intake (plan 08): the supplied Idle.fbx is a long, nearly static standing cycle. It is not a run clip (no stance
// intervals, no planted-toe speed): this intake checks the source, measures its seam and root drift, chooses the
// representative frame and records the arm directions (chest frame, as the run clips) and the foot stance the fitted
// posture uses. Plan 13e: it also records the whole cycle the standing player plays (every frame's arm directions in that
// frame's chest frame, the head's rotation in the chest relative to the representative frame, the hips' horizontal
// offset from the loop mean) and its measured bounds. Output: src/sim/model/idle-pose.record.json (tests/transitions.test.ts
// checks it reproduces).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { add, dist, norm, qAngle, qConj, qInvRot, qMul, qNormalize, scale, sub, v3, type Quat, type Vec3 } from '../../src/sim/vec';
import type { IdlePoseRecord } from '../../src/sim/locomotion';
import CAL from '../../src/sim/model/bew-v6.calibration.json';

const DIR = 'models/animations';
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const r3v = (p: Vec3): [number, number, number] => [r6(p.x), r6(p.y), r6(p.z)];
const t3 = (a: number[]): Vec3 => v3(a[0], a[1], a[2]);
const q4 = (a: number[]): Quat => qNormalize({ x: a[0], y: a[1], z: a[2], w: a[3] });

/** Plan 10b: how far the idle's rest skeleton may face off +Z (deg) and its two rest legs may differ (m) for the record to hold. */
export const IDLE_REST_YAW_TOL_DEG = 1;
export const IDLE_REST_LEG_TOL_M = 1e-3;

interface IdleSource {
  name: string;
  fps: number;
  frames: Record<string, number[]>[];
  rest: Record<string, number[]>;
  rot: Record<string, number[]>[];
}

export function idleIntake(dir = DIR): IdlePoseRecord {
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as { id: string; kind?: string; source: string; sourceSha256: string; data: string; fps: number; frames: number; posePolicy: string }[];
  const m = manifest.find((e) => e.kind === 'idle');
  if (!m) throw new Error('no idle entry in the manifest');
  const srcPath = `${dir}/${m.source}`;
  const got = sha(srcPath);
  if (got !== m.sourceSha256) throw new Error(`idle source sha256 ${got} differs from the manifest ${m.sourceSha256}`);
  const dataPath = `${dir}/${m.data}`;
  const raw = JSON.parse(readFileSync(dataPath, 'utf8')) as IdleSource;
  if (raw.frames.length !== m.frames || raw.fps !== m.fps) throw new Error('idle manifest frames/fps differ from the data');
  const joints = ['Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'];
  const rel = (i: number, j: string): Vec3 => sub(t3(raw.frames[i][j]), t3(raw.frames[i].Hips));
  // the mean posture relative to the hips; the representative frame is the closest to it (deterministic: the first such)
  const mean: Record<string, Vec3> = {};
  for (const j of joints) mean[j] = scale(raw.frames.reduce((a, _f, i) => add(a, rel(i, j)), v3()), 1 / raw.frames.length);
  let frame = 0;
  let bestE = Infinity;
  raw.frames.forEach((_f, i) => {
    const e = joints.reduce((a, j) => a + dist(rel(i, j), mean[j]), 0);
    if (e < bestE - 1e-9) {
      bestE = e;
      frame = i;
    }
  });
  const f = raw.frames[frame];
  // one frame's chest-frame direction from joint a to joint b (unit; the fallback is never taken on the supplied idle)
  const dirAt = (i: number, a: string, b: string): Vec3 => norm(qInvRot(q4(raw.rot[i].Spine2), sub(t3(raw.frames[i][b]), t3(raw.frames[i][a]))), v3(0, -1, 0));
  const dir3 = (a: string, b: string): Vec3 => dirAt(frame, a, b);
  const hipsY = raw.frames.map((x) => x.Hips[1]);
  const drift = Math.max(...raw.frames.map((x) => Math.hypot(x.Hips[0] - raw.frames[0].Hips[0], x.Hips[2] - raw.frames[0].Hips[2])));
  const seam = Math.max(...Object.keys(raw.frames[0]).map((j) => dist(t3(raw.frames[0][j]), t3(raw.frames[raw.frames.length - 1][j]))));
  const footMove = Math.max(...raw.frames.flatMap((x) => ['LeftFoot', 'RightFoot'].map((j) => dist(t3(x[j]), t3(raw.frames[0][j])))));
  // plan 10b: the stance is measured on the bake's axes, which are the clip root's only if the rest skeleton faces +Z
  // (hips across +X, no yaw): check it (the supplied idle: 0.81 degrees, from a 3 mm bind asymmetry). The rest leg is
  // both legs', which must agree
  const hipAxis = sub(t3(raw.rest.LeftUpLeg), t3(raw.rest.RightUpLeg));
  const restYawDeg = (Math.atan2(hipAxis.z, hipAxis.x) * 180) / Math.PI;
  if (Math.abs(restYawDeg) > IDLE_REST_YAW_TOL_DEG) throw new Error(`idle rest skeleton is turned ${restYawDeg.toFixed(2)} degrees from +Z: the stance would be measured off the root frame`);
  const legs = [raw.rest.LeftUpLeg[1] - raw.rest.LeftFoot[1], raw.rest.RightUpLeg[1] - raw.rest.RightFoot[1]];
  if (Math.abs(legs[0] - legs[1]) > IDLE_REST_LEG_TOL_M) throw new Error(`idle rest legs differ: left ${legs[0]} m, right ${legs[1]} m`);
  const restLegM = (legs[0] + legs[1]) / 2;
  const legScale = (CAL.lengths.thigh + CAL.lengths.shin) / restLegM;
  // plan 13e: the cycle. The loop is the frames before the last, which repeats the first (seam 0): its mean is over them
  const n = raw.frames.length;
  const loop = seam < 1e-6 ? n - 1 : n;
  const headIn = (i: number): Quat => qMul(qConj(q4(raw.rot[i].Spine2)), q4(raw.rot[i].Head));
  const head0 = qConj(headIn(frame));
  const head = raw.frames.map((_x, i) => {
    const d = qNormalize(qMul(headIn(i), head0));
    return d.w < 0 ? { x: -d.x, y: -d.y, z: -d.z, w: -d.w } : d;
  });
  const hx = raw.frames.slice(0, loop).reduce((a, x) => a + x.Hips[0], 0) / loop;
  const hz = raw.frames.slice(0, loop).reduce((a, x) => a + x.Hips[2], 0) / loop;
  const hips = raw.frames.map((x) => [x.Hips[0] - hx, x.Hips[2] - hz]);
  const arm = (a: string, b: string): [number, number, number][] => raw.frames.map((_x, i) => r3v(dirAt(i, a, b)));
  return {
    note: 'Generated by npm run intake-clips (scripts/model/idle-intake.ts). The representative frame gives the stance (width, stagger) and the arms a standing player blends from; the cycle is played (plan 13e): arms and head drawn, the hips offset as a physical sway. Arm directions are unit shoulder-to-elbow and elbow-to-wrist vectors in the chest (Spine2) frame; head rotations are in the chest frame, relative to the representative frame, as (x, y, z, w); hips offsets are metres (x, z) in the clip root frame from the loop mean, before the leg scale; anatomical left +X, forward +Z.',
    id: m.id,
    source: srcPath,
    sourceSha256: m.sourceSha256,
    data: dataPath,
    dataSha256: sha(dataPath),
    fps: raw.fps,
    frames: raw.frames.length,
    seamM: r6(seam),
    rootDriftM: r6(drift),
    rootBobM: r6(Math.max(...hipsY) - Math.min(...hipsY)),
    footMoveM: r6(footMove),
    posePolicy: m.posePolicy,
    frame,
    arms: {
      left: { upper: r3v(dir3('LeftArm', 'LeftForeArm')), fore: r3v(dir3('LeftForeArm', 'LeftHand')) },
      right: { upper: r3v(dir3('RightArm', 'RightForeArm')), fore: r3v(dir3('RightForeArm', 'RightHand')) },
    },
    stance: {
      widthM: r6(Math.abs(f.LeftFoot[0] - f.RightFoot[0])),
      leftForwardM: r6(f.LeftFoot[2] - f.RightFoot[2]),
      legScale: r6(legScale),
    },
    cycle: {
      frames: n,
      periodS: r6((n - 1) / raw.fps),
      upper: { left: arm('LeftArm', 'LeftForeArm'), right: arm('RightArm', 'RightForeArm') },
      fore: { left: arm('LeftForeArm', 'LeftHand'), right: arm('RightForeArm', 'RightHand') },
      head: head.map((d) => [r6(d.x), r6(d.y), r6(d.z), r6(d.w)]),
      hips: hips.map((h) => [r6(h[0]), r6(h[1])]),
      headMaxDeg: r6(Math.max(...head.map((d) => (qAngle(d) * 180) / Math.PI))),
      hipsMaxM: r6(Math.max(...hips.map((h) => Math.hypot(h[0], h[1])))),
    },
  };
}
