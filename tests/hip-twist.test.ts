// Ladder 11b: the supported thigh's axial rotation (`JointRangeProfile.hipTwist`, JOINT_RANGE_V3, used by no fixture yet).
// The supported leg places its knee from a pole, so the thigh's rotation was whatever the pole and the ankle target gave.
// When the target comes close beside or above the hip the knee turns sideways and then back: HC-F2-offset A's right foot
// is held up on B while its hip drops, the rotation runs from -48 deg at 0.467 s to the knee facing backwards (180 deg)
// at 0.65 s, 20 degrees a frame, and wraps there (the HC family's supported impossible time is almost all this; a ragdoll
// made from such a pose starts with its hip there). Under the profile the shin turns about the thigh (the thigh kept, the
// ankle off its target) into the ragdoll hip's twist range less the margin, read on the branch it left by, at most the
// rate from the last shown rotation while it is held. The twin is the same state on JOINT_RANGE_V2.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { HIP_TWIST_SWING_DEG, hingeChain } from '../src/sim/pose';
import { armTwistRad, fitThighTwist } from '../src/sim/joint-cone';
import { ENVELOPE_L4, JOINT_RANGE_V2, JOINT_RANGE_V3, sideSignX } from '../src/sim/profiles';
import { addScaled, dist, norm, qConj, qFromAxisAngle, qMul, v3, wrapPi, type Quat, type Vec3 } from '../src/sim/vec';
import { asCaptured } from './runs';
import { loadState, resumeState } from './state';
import { hipAngles } from './visible';

const DEG = 180 / Math.PI;
const HT = JOINT_RANGE_V3.hipTwist!;
const E = HT.envelope;
const I: Quat = { x: 0, y: 0, z: 0, w: 1 };
const rotDeg = (hip: Vec3, knee: Vec3, ankle: Vec3, sx: number, q: Quat = I): number => armTwistRad(E, q, hip, knee, ankle, sx)! * DEG;
const mirror = (p: Vec3): Vec3 => v3(-p.x, p.y, p.z);

describe('ladder 11b: the supported thigh rotation', () => {
  it('the profile: joint-range-v2 with the hip envelope\'s twist range less 5 deg, used by no fixture; the measure is the visible meter\'s', () => {
    expect({ ...JOINT_RANGE_V3, id: JOINT_RANGE_V2.id, hipTwist: undefined }).toEqual({ ...JOINT_RANGE_V2, hipTwist: undefined });
    expect(HT).toEqual({ envelope: ENVELOPE_L4.hip, marginDeg: 5, maxRateRadPs: 12 });
    expect(E.twistDeg).toEqual([-50, 50]);
    for (const d of allFixtures()) expect(d.jointRange?.hipTwist, d.id).toBeUndefined();
    // armTwistRad on a leg chain (thigh frame as the pose builds it) is tests/visible.ts's hip rotation, in turned cores
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const core = qFromAxisAngle(norm(v3(rnd(), rnd(), rnd()), v3(0, 1, 0)), 3 * rnd());
      const hip = v3(rnd(), 1 + rnd(), rnd());
      const knee = addScaled(hip, norm(v3(rnd(), rnd(), rnd()), v3(0, -1, 0)), 0.45);
      const ankle = addScaled(knee, norm(v3(rnd(), rnd(), rnd()), v3(0, -1, 0)), 0.45);
      const ch = hingeChain(hip, knee, [ankle], [v3(0, 0, 1)], 0.01);
      if (ch.fallback) continue;
      for (const sx of [1, -1]) {
        const h = hipAngles(qMul(qConj(core), ch.frameA), sx);
        if (h.swing > HIP_TWIST_SWING_DEG) continue;
        n++;
        expect(Math.abs(wrapPi((rotDeg(hip, knee, ankle, sx, core) - h.rot) / DEG) * DEG)).toBeLessThan(1e-6);
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it('a knee facing back is turned to the range edge it left by, the thigh and the shin length kept; inside the range a leg is untouched', () => {
    const dt = 1 / 240;
    const step = HT.maxRateRadPs * dt * DEG;
    for (const sx of [1, -1]) {
      const m = (p: Vec3): Vec3 => (sx === 1 ? p : mirror(p));
      // the thigh forward (90 deg flexion), the shin folded down: rotation 0; folded up toward the head: 180 (the knee back)
      const hip = m(v3(0.1, 1, 0));
      const knee = m(v3(0.1, 1, 0.45));
      const down = m(v3(0.1, 0.55, 0.45));
      const up = m(v3(0.1, 1.45, 0.45));
      expect(rotDeg(hip, knee, down, sx)).toBeCloseTo(0, 9);
      expect(Math.abs(rotDeg(hip, knee, up, sx))).toBeCloseTo(180, 9);
      const inside = fitThighTwist(E, HT, I, hip, knee, down, sx, 10 / DEG, false, dt);
      expect(inside.held).toBe(false);
      expect(inside.ankle).toBe(down);
      // from a shown -40 deg the knee-back request is read as -180 (through internal rotation), from +40 as +180: each
      // goes toward its own edge, one rate step a call
      for (const prev of [-40, 40]) {
        const f = fitThighTwist(E, HT, I, hip, knee, up, sx, prev / DEG, false, dt);
        expect(f.held).toBe(true);
        expect(rotDeg(hip, knee, f.ankle, sx)).toBeCloseTo(prev + Math.sign(prev) * step, 6);
        expect(dist(f.ankle, knee)).toBeCloseTo(0.45, 9);
      }
      // with no shown rotation (the first pose) it goes to the nearer edge at once
      const first = fitThighTwist(E, HT, I, hip, knee, up, sx, null, false, dt);
      expect(Math.abs(rotDeg(hip, knee, first.ankle, sx))).toBeCloseTo(45, 6);
      // a leg let go by the range turns back at the rate: held at -45, a request inside at 0 is reached one step a call
      const back = fitThighTwist(E, HT, I, hip, knee, down, sx, -45 / DEG, true, dt);
      expect(back.held).toBe(true);
      expect(rotDeg(hip, knee, back.ankle, sx)).toBeCloseTo(-45 + step, 6);
      const near = fitThighTwist(E, HT, I, hip, knee, down, sx, -1 / DEG, true, dt);
      expect(near.held).toBe(false);
      expect(near.ankle).toBe(down);
    }
    // fault twin of the branch: read by its sign alone (as `turnForearmTwist` reads the arm), a request jittering across
    // the half turn (179 and -179 deg) goes to opposite edges on consecutive calls; read on the shown branch it holds
    const hip = v3(0.1, 1, 0);
    const knee = v3(0.1, 1, 0.45);
    // the shin turned about the thigh (+Z) from hanging below the knee: toward -X (the left side's midline) is external
    const at = (deg: number): Vec3 => addScaled(knee, v3(-Math.sin(deg / DEG), -Math.cos(deg / DEG), 0), 0.45);
    expect(rotDeg(hip, knee, at(0), 1)).toBeCloseTo(0, 6);
    expect(rotDeg(hip, knee, at(30), 1)).toBeCloseTo(30, 6);
    expect(rotDeg(hip, knee, at(179), 1)).toBeCloseTo(179, 6);
    expect(rotDeg(hip, knee, at(-179), 1)).toBeCloseTo(-179, 6);
    const shown = [179, -179].map((r) => rotDeg(hip, knee, fitThighTwist(E, HT, I, hip, knee, at(r), 1, -45 / DEG, true, 0).ankle, 1));
    expect(shown).toEqual([expect.closeTo(-45, 6), expect.closeTo(-45, 6)]);
    const bySign = [179, -179].map((r) => rotDeg(hip, knee, fitThighTwist(E, HT, I, hip, knee, at(r), 1, null, false, 0).ankle, 1));
    expect(bySign).toEqual([expect.closeTo(45, 6), expect.closeTo(-45, 6)]);
  });

  it('HC-F2-offset from 0.40 s: every supported thigh stays in the range (the twin on joint-range-v2 turns A\'s right knee to face back)', async () => {
    // captured at the end of tick 24 (0.400 s) under the registered profile, A's right hip rotation -13 deg and leaving
    // the range at 0.467 s; resumed under each profile to 1.2 s, every drawn frame of a supported player read as the
    // visible meter reads it (below HIP_TWIST_SWING_DEG of swing)
    const cap = loadState('tests/data/state/HC-F2-offset@24.json.gz');
    const read = async (jointRange: typeof JOINT_RANGE_V3): Promise<{ maxDeg: number; aRightMaxDeg: number; frames: number }> => {
      const sim = await resumeState(cap, { def: { ...asCaptured(cap), jointRange }, variant: ['jointRange', 'ragdoll'] });
      let maxDeg = 0;
      let aRightMaxDeg = 0;
      let frames = 0;
      while (!sim.done && sim.t < 1.2) {
        sim.stepTick();
        for (const p of sim.players) {
          if (!p.pose || p.rag) continue;
          for (const s of ['left', 'right'] as const) {
            const seg = p.pose.segments;
            const h = hipAngles(qMul(qConj(seg.core.rotationWorld), seg[`${s}Thigh`].rotationWorld), sideSignX(p.body, s));
            if (h.swing > HIP_TWIST_SWING_DEG) continue;
            frames++;
            maxDeg = Math.max(maxDeg, Math.abs(h.rot));
            if (p.id === 'A' && s === 'right') aRightMaxDeg = Math.max(aRightMaxDeg, Math.abs(h.rot));
          }
        }
      }
      sim.dispose();
      return { maxDeg, aRightMaxDeg, frames };
    };
    const on = await read(JOINT_RANGE_V3);
    const twin = await read(JOINT_RANGE_V2);
    expect(on.frames).toBeGreaterThan(150);
    expect(on.maxDeg).toBeLessThanOrEqual(45 + 1e-6);
    expect(twin.aRightMaxDeg).toBeGreaterThan(170);
  }, 60000);
});
