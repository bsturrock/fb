import { describe, expect, it } from 'vitest';
import { labRun } from '../src/lab/lab-params';
import { preFallReact, preFlip } from './runs';
import { allFixtures } from '../src/sim/fixtures/index';
import { modelBody } from '../src/sim/model/profiles';
import type { PhysicalPose } from '../src/sim/pose';
import { JOINT_RANGE_V2, sideSignX, upperBodyCompound, type BodyProfile } from '../src/sim/profiles';
import { externalTwistRad, swingTwistOf } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { cross, qFromAxisAngle, qFromBasis, qFromUnitVectors, qMul, v3, type Quat } from '../src/sim/vec';
import { HUMAN_RANGES, hipAngles, idleBaseline, jointAngles, VisibleMeter } from './visible';

// Ladder rung 8c: the visible-quality measures (tests/visible.ts; definitions in scripts/check/README.md) read the angles a
// pose was built with, on both sides of both bodies, and the screenshot run's values as the visible audit read them.
const RAD = Math.PI / 180;
const SEGS = ['core', 'head', 'leftUpperArm', 'rightUpperArm', 'leftForearm', 'rightForearm', 'leftThigh', 'rightThigh', 'leftShin', 'rightShin'];
type Side = 'left' | 'right';

/** Core-to-thigh rotation of a thigh at flexion `flex`, abduction `abd` (+ away from the midline), rotation `rot` (+ external) on the side of sign `ss`. */
function thighRel(flex: number, abd: number, rot: number, ss: number): Quat {
  const dir = v3(ss * Math.sin(abd * RAD), -Math.cos(abd * RAD) * Math.cos(flex * RAD), Math.cos(abd * RAD) * Math.sin(flex * RAD));
  return qMul(qFromUnitVectors(v3(0, -1, 0), dir), qFromAxisAngle(v3(0, 1, 0), ss * rot * RAD));
}
/** A drawn pose with every segment at the core's world rotation but one thigh at `rel` from it. */
function poseWith(core: Quat, side: Side, rel: Quat): PhysicalPose {
  const segments = Object.fromEntries(SEGS.map((s) => [s, { originWorld: v3(), rotationWorld: core }]));
  segments[`${side}Thigh`] = { originWorld: v3(), rotationWorld: qMul(core, rel) };
  return { playerId: 'X', segments, jointLandmarksWorld: {}, hingeDeg: {}, straightFallback: [], limbClearance: {} } as unknown as PhysicalPose;
}
const mirror = (q: Quat): Quat => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });
const CASES: [number, number, number][] = [
  [0, 0, 0],
  [45, 0, 0],
  [120, 0, 0],
  [140, 10, 0],
  [-30, 0, 0],
  [0, 45, 0],
  [0, -30, 0],
  [0, 0, 45],
  [0, 0, -45],
  [90, 20, 30],
  [60, -25, -40],
  [-20, 30, 60],
];
const BODIES: [string, BodyProfile][] = [
  ['authored', upperBodyCompound()],
  ['model (right on -X)', modelBody()],
];

describe('visible quality: hip angles in the anatomical frame', () => {
  it('a constructed thigh reads the flexion, abduction and rotation it was built with, on both sides of both bodies, the body lying face-down; its mirror on the other side reads the same', () => {
    const faceDown = qFromAxisAngle(v3(1, 0, 0), 90 * RAD);
    for (const [, body] of BODIES)
      for (const side of ['left', 'right'] as Side[]) {
        const ss = sideSignX(body, side);
        const other: Side = side === 'left' ? 'right' : 'left';
        expect(sideSignX(body, other)).toBe(-ss);
        for (const [flex, abd, rot] of CASES) {
          const q = thighRel(flex, abd, rot, ss);
          const m = jointAngles(poseWith(faceDown, side, q), body)[`${side}Hip`];
          expect(m.flex).toBeCloseTo(flex, 6);
          expect(m.abd).toBeCloseTo(abd, 6);
          expect(m.rot).toBeCloseTo(rot, 6);
          // the same pose mirrored through the body's sagittal plane, on the other side
          const mm = jointAngles(poseWith(faceDown, other, mirror(q)), body)[`${other}Hip`];
          expect([mm.flex, mm.abd, mm.rot].map((x) => Number(x.toFixed(6)))).toEqual([m.flex, m.abd, m.rot].map((x) => Number(x.toFixed(6))));
        }
      }
  });

  it('fault twin: read without the side sign, the side on -X reads abduction as adduction and external rotation as internal', () => {
    for (const [, body] of BODIES) {
      const side: Side = sideSignX(body, 'left') < 0 ? 'left' : 'right';
      const ss = sideSignX(body, side);
      const unsigned = hipAngles(thighRel(10, 30, 40, ss), 1);
      expect(unsigned.abd).toBeCloseTo(-30, 6);
      expect(unsigned.rot).toBeCloseTo(-40, 6);
      expect(hipAngles(thighRel(10, 30, 40, ss), ss).abd).toBeCloseTo(30, 6);
    }
  });

  it('the range checks: past 150 deg of swing a thigh is a fold, impossible; flexion and extension are read below it', () => {
    const check = (dof: string, m: { flex: number; abd: number; rot: number; swing: number }): number => HUMAN_RANGES.find((r) => r.joint === 'Hip' && r.dof === dof)!.excess(m);
    const folded = hipAngles(thighRel(160, 0, 0, 1), 1);
    expect(folded.swing).toBeCloseTo(160, 6);
    expect(check('fold', folded)).toBeGreaterThan(30);
    expect(check('flexion', folded)).toBeLessThan(0);
    expect(check('rotation', folded)).toBeLessThan(0);
    const behind = hipAngles(thighRel(-123, 0, 0, 1), 1);
    expect(check('extension', behind)).toBeCloseTo(93, 6);
    expect(check('fold', behind)).toBeLessThan(0);
    expect(check('flexion', hipAngles(thighRel(135, 0, 0, 1), 1))).toBeCloseTo(15, 6);
  });
});

describe('visible quality: shoulder rotation in the anatomical measure (ladder 13a)', () => {
  // A right or left upper arm at direction `dir` (core frame) with the forearm bent 90 deg toward `fore`: the upper arm's
  // frame has -Y along the arm and X its elbow axis, flexion taking the forearm to the frame's -Z.
  const armRel = (dir: [number, number, number], fore: [number, number, number], ss: number): Quat => {
    const y = v3(-dir[0] * ss, -dir[1], -dir[2]);
    const z = v3(-fore[0] * ss, -fore[1], -fore[2]);
    return qFromBasis(cross(y, z), y, z);
  };
  // [direction, forearm] with x outward (mirrored per side), and the rotation each must read (external positive)
  const ARMS: [string, [number, number, number], [number, number, number], number][] = [
    ['hanging, forearm forward', [0, -1, 0], [0, 0, 1], 0],
    ['hanging, forearm out', [0, -1, 0], [1, 0, 0], 90],
    ['hanging, forearm across the belly', [0, -1, 0], [-1, 0, 0], -90],
    ['out to the side, forearm up (throwing)', [1, 0, 0], [0, 1, 0], 90],
    ['overhead, forearm behind the head', [0, 1, 0], [0, 0, -1], 0],
    ['overhead, forearm over the head', [0, 1, 0], [-1, 0, 0], -90],
    ['overhead, forearm out', [0, 1, 0], [1, 0, 0], 90],
    ['overhead, forearm bent to the face', [0, 1, 0], [0, 0, 1], 180],
  ];
  const rotOf = (q: Quat, side: Side, body: BodyProfile): number => {
    const segments = Object.fromEntries(SEGS.map((s) => [s, { originWorld: v3(), rotationWorld: qFromAxisAngle(v3(0, 0, 1), 80 * RAD) }]));
    segments[`${side}UpperArm`] = { originWorld: v3(), rotationWorld: qMul(segments.core.rotationWorld, q) };
    const pose = { playerId: 'X', segments, jointLandmarksWorld: {}, hingeDeg: {}, straightFallback: [], limbClearance: {} } as unknown as PhysicalPose;
    return jointAngles(pose, body)[`${side}Shoulder`].rot;
  };
  const ROT = HUMAN_RANGES.find((r) => r.joint === 'Shoulder' && r.dof === 'rotation')!;

  it('a constructed arm reads the rotation it was built with, on both sides of both bodies, the body lying on its side; an arm overhead bent to the face is past the impossible margin, behind the head neutral', () => {
    for (const [, body] of BODIES)
      for (const side of ['left', 'right'] as Side[]) {
        const ss = sideSignX(body, side);
        for (const [, dir, fore, rot] of ARMS) {
          const r = rotOf(armRel(dir, fore, ss), side, body);
          expect(Math.abs(((r - rot + 540) % 360) - 180)).toBeLessThan(1e-6);
        }
        expect(ROT.excess({ rot: rotOf(armRel([0, 1, 0], [0, 0, 1], ss), side, body) })).toBeGreaterThan(ROT.impossible);
        expect(ROT.excess({ rot: rotOf(armRel([0, 1, 0], [0, 0, -1], ss), side, body) })).toBeLessThan(0);
      }
  });

  it("fault twin: plan 09's twist from the hanging arm (the meter's measure before 13a) reads an arm 5 deg out from overhead bent to the face as neutral, inside the range, and the same arm with the forearm behind the head as half a turn, past the impossible margin", () => {
    for (const [, body] of BODIES)
      for (const side of ['left', 'right'] as Side[]) {
        const ss = sideSignX(body, side);
        const plan09 = (q: Quat): number => externalTwistRad(JOINT_RANGE_V2.shoulder, swingTwistOf(q).twistRad, ss) / RAD;
        // tilted outward in the core frame (about Z), off plan 09's pole, where its swing axis is undefined
        const out = (q: Quat): Quat => qMul(qFromAxisAngle(v3(0, 0, 1), -ss * 5 * RAD), q);
        const face = out(armRel([0, 1, 0], [0, 0, 1], ss));
        expect(ROT.excess({ rot: plan09(face) })).toBeLessThan(0);
        expect(ROT.excess({ rot: rotOf(face, side, body) })).toBeGreaterThan(ROT.impossible);
        const behind = out(armRel([0, 1, 0], [0, 0, -1], ss));
        expect(ROT.excess({ rot: plan09(behind) })).toBeGreaterThan(ROT.impossible);
        expect(ROT.excess({ rot: rotOf(behind, side, body) })).toBeLessThan(0);
        // below horizontal the two are the same measure
        expect(plan09(armRel([0, -1, 0], [1, 0, 0], ss))).toBeCloseTo(rotOf(armRel([0, -1, 0], [1, 0, 0], ss), side, body), 6);
      }
  });
});

describe('visible quality: the screenshot run (L3-F9-convert-free, legs=v3, forward)', () => {
  it('reads the visible audit\'s values: red\'s left hip rotation -94 at 0.90 s, blue\'s right thigh folded forward past 180 (unwrapped 221) at 1.13-1.35 s, then 123 deg behind at 1.45 s, each past the impossible margin; read in world axes instead (fault twin) they read otherwise', async () => {
    // (the audited run: the profile before the visible flip, which removes these poses)
    // (and before the contact motion M4 fall flip, whose response needs the visible flip's hip stops)
    const base = preFlip(preFallReact(allFixtures().find((d) => d.id === 'L3-F9-convert-free')!));
    const { def, opts } = labRun(base, new URLSearchParams('legs=v3'));
    const sim = await Simulation.create(def, opts);
    type World = ReturnType<typeof hipAngles>;
    const fr = new Map<number, { R: Record<string, Record<string, number>>; D: Record<string, Record<string, number>>; rep: Record<string, string>; rWorld: World; dWorld: World }>();
    while (!sim.done) {
      sim.stepTick();
      const by = Object.fromEntries(sim.players.map((p) => [p.id, p]));
      // the twin: the thigh's rotation in world axes, not relative to the core
      const world = (id: string, side: Side): World => hipAngles(by[id].pose!.segments[`${side}Thigh`].rotationWorld, sideSignX(by[id].body, side));
      fr.set(Math.round(sim.t * 60), {
        R: jointAngles(by.R.pose!, by.R.body),
        D: jointAngles(by.D.pose!, by.D.body),
        rep: { R: by.R.representation, D: by.D.representation },
        rWorld: world('R', 'left'),
        dWorld: world('D', 'right'),
      });
    }
    sim.dispose();
    const at = (s: number) => fr.get(Math.round(s * 60))!;
    const hip = (dof: string, m: Record<string, number>): number => HUMAN_RANGES.find((r) => r.joint === 'Hip' && r.dof === dof)!.excess(m as never);
    const impossible = (m: Record<string, number>): boolean => ['flexion', 'extension', 'fold', 'abduction', 'adduction', 'rotation'].some((dof) => hip(dof, m) > 30);
    // the same run as the screenshots: R a ragdoll from 0.217 s, D from 0.85 s
    expect([at(0.2).rep.R, at(0.217).rep.R, at(0.833).rep.D, at(0.85).rep.D]).toEqual(['proxy', 'ragdoll', 'proxy', 'ragdoll']);
    // red's left hip rotation (the shots at 0.67-0.98 s, best fit 0.80-0.90)
    expect(at(0.9).R.leftHip.rot).toBeCloseTo(-94.3, 1);
    expect(hip('rotation', at(0.9).R.leftHip)).toBeGreaterThan(30);
    // blue's right thigh: through the trunk, unwrapped flexion 221 at its peak, impossible in every frame of 1.13-1.35 s
    let prev = at(1.1).D.rightHip.flex;
    let peak = -Infinity;
    for (let f = Math.round(1.133 * 60); f <= Math.round(1.35 * 60); f++) {
      const m = fr.get(f)!.D.rightHip;
      let x = m.flex;
      while (Math.abs(x - prev) > 180) x += x < prev ? 360 : -360;
      prev = x;
      peak = Math.max(peak, x);
      expect(impossible(m)).toBe(true);
    }
    expect(peak).toBeCloseTo(221.5, 0);
    // and 123 deg behind the body at 1.45 s (the front-back split)
    expect(at(1.45).D.rightHip.flex).toBeCloseTo(-122.6, 0);
    expect(hip('extension', at(1.45).D.rightHip)).toBeGreaterThan(30);
    // fault twin: in world axes (the lying bodies' core frames ignored) red's rotation reads +89 and blue's folded thigh
    // reads an unfolded 99 deg of swing
    expect(Math.abs(at(0.9).rWorld.rot - at(0.9).R.leftHip.rot)).toBeGreaterThan(30);
    expect(at(1.2).D.rightHip.swing).toBeGreaterThan(150);
    expect(at(1.2).dWorld.swing).toBeLessThan(150);
  });
});

describe('visible quality: the meter', () => {
  it('the idle run reads clean against its own baseline: no joint past the implausible margin, no own overlap or crossing; without the baseline (fault twin) its drawn inner thighs read overlapping', async () => {
    const idle = allFixtures().find((d) => d.id === 'L3-F13-free')!;
    const base = await idleBaseline(idle);
    expect(base.fat['leftThighD~rightThighD']).toBeGreaterThan(0.03);
    const read = async (b: typeof base) => {
      const sim = await Simulation.create(idle, {});
      const meter = new VisibleMeter(sim, b);
      while (!sim.done) {
        sim.stepTick();
        meter.frame();
      }
      sim.dispose();
      return meter.finish();
    };
    const run = await read(base);
    expect(run.supS).toBeGreaterThan(1);
    expect([run.sup.impl, run.sup.self, run.sup.selfAx, run.sup.snap60, run.ragS]).toEqual([{}, {}, {}, 0, 0]);
    expect(run.worst).toEqual({});
    const raw = await read({ fat: {}, axis: {} });
    expect(raw.sup.self.legLeg).toBeGreaterThan(1);
  });
});
