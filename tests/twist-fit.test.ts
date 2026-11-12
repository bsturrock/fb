// Ladder 12b: the supported pose's elbow fit moves the elbow at a bounded speed (`ShoulderTwistProfile.fitMaxMps`,
// JOINT_RANGE_V5, used by no fixture yet). M1's fit turns the elbow about the shoulder-to-palm line until the upper arm's
// twist is in its window, as far as that takes. On a folded arm the line is short and the elbow far from it, so a few
// degrees of twist cost a long swing of the elbow. Under the anatomical window (JOINT_RANGE_V4) a raised clip arm coming
// down past the shoulder needed such turns, and the upper arm turned up to 146 deg in one drawn frame (L3-F1, HC-F3: the
// new snaps that parked 11d ii's flip). Under V5 the fit's elbow moves at most 6 m/s, the fast continuity rate, and the
// twist is left outside the window by what that could not reach; the next pose's window starts from the shown twist.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { armAnatomicalTwistRad, fitElbowTwist } from '../src/sim/joint-cone';
import { JOINT_RANGE_V2, JOINT_RANGE_V4, JOINT_RANGE_V5, type JointRangeProfile } from '../src/sim/profiles';
import { add, cross, dist, norm, qAngleBetween, qConj, qInvRot, qMul, scale, sub, v3, vc, wrapPi, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX } from './runs';
import { loadState, resumeState } from './state';

const E = JOINT_RANGE_V2.shoulder;
const I = { x: 0, y: 0, z: 0, w: 1 };
const DEG = Math.PI / 180;
/** The visible meter's snap: a joint turning faster than this between drawn frames (rad/s). */
const SNAP_RADPS = 60;

describe('ladder 12b: the elbow fit at a bounded speed', () => {
  it('the profile: joint-range-anat-v4 with fitMaxMps 6, used by no fixture', () => {
    expect({ ...JOINT_RANGE_V5, id: JOINT_RANGE_V4.id, shoulderTwist: { ...JOINT_RANGE_V5.shoulderTwist!, fitMaxMps: undefined } }).toEqual({ ...JOINT_RANGE_V4, shoulderTwist: { ...JOINT_RANGE_V4.shoulderTwist!, fitMaxMps: undefined } });
    expect(JOINT_RANGE_V5.shoulderTwist!.fitMaxMps).toBe(6);
    for (const d of allFixtures()) expect(d.jointRange?.shoulderTwist?.fitMaxMps, d.id).toBeUndefined();
  });

  it('a folded arm: the fit moves the elbow at most the bound and toward the window; a fit within the bound is unchanged (unbounded, 20 deg of twist swing the elbow 28 cm)', () => {
    // the upper arm forward, out and down, the forearm folded 144 deg back toward the shoulder (the palm 22 cm from it)
    const sh = v3(0.2, 1.4, 0);
    const d = norm(v3(0.6, -0.3, 0.74), v3(0, 1, 0));
    const elbow = add(sh, scale(d, 0.36));
    const n = norm(cross(d, v3(0, 1, 0)), v3(1, 0, 0));
    const back = norm(cross(n, d), v3(0, 1, 0));
    const end = add(elbow, scale(norm(add(scale(d, Math.cos(144 * DEG)), scale(back, Math.sin(144 * DEG))), d), 0.359));
    const t0 = armAnatomicalTwistRad(E, I, sh, elbow, end, 1)!;
    const maxMoveM = 6 / 240;
    const fit = (shiftDeg: number, bound?: number): { moveM: number; errDeg: number } => {
      const mid = t0 + shiftDeg * DEG;
      const f = fitElbowTwist(E, I, sh, elbow, end, 1, { mid, lo: -0.01, hi: 0.01 }, armAnatomicalTwistRad, bound);
      return { moveM: dist(f.elbow, elbow), errDeg: wrapPi(f.twistRad! - mid) / DEG };
    };
    for (const s of [20, -20, 40, -40]) {
      const b = fit(s, maxMoveM);
      // the arc about the line is the bound (the chord a little shorter)
      expect(b.moveM).toBeLessThanOrEqual(maxMoveM + 1e-12);
      expect(b.moveM).toBeGreaterThan(0.99 * maxMoveM);
      expect(Math.abs(b.errDeg)).toBeLessThan(Math.abs(s) - 1);
    }
    // fault twin: the fit as before
    expect(fit(20).moveM).toBeGreaterThan(0.25);
    expect(Math.abs(fit(20).errDeg)).toBeLessThan(0.6);
    const small = fit(1, maxMoveM);
    expect(small.moveM).toBeLessThan(maxMoveM);
    expect(small).toEqual(fit(1));
  });

  it('L3-F1-phase3 from 1.15 s under joint-range-anat-v4: D\'s left shoulder turns at most 60 rad/s (the twin on V4 turns 113 deg in one frame, its elbow 51 cm in one substep)', async () => {
    // captured at the end of tick 69 (1.150 s) under V4 (`--joints=v4`), D's left arm on its clip coming down from the
    // raised alternative; resumed under each profile to 1.5 s, D's left shoulder (core to upper arm) every drawn frame
    // and its elbow (proxy body frame) every substep while D is supported. Measured: on, 7 deg in a frame at most, the
    // elbow 1.3 cm a substep; the twin 113 deg at 1.183 s, 51.5 cm; V2 from the same state 21 deg, 2.8 cm
    const cap = loadState('tests/data/state/L3-F1-phase3~jrv4@69.json.gz');
    const read = async (jointRange: JointRangeProfile): Promise<{ frames: number; worstRadPs: number; at: number; elbowM: number }> => {
      let pe: Vec3 | null = null;
      let elbowM = 0;
      const sim = await resumeState(cap, {
        def: { ...FIX('L3-F1-phase3'), jointRange },
        variant: ['jointRange', 'ragdoll'],
        opts: {
          onSubstep: (s) => {
            const p = s.players.find((x) => x.id === 'D')!;
            if (!p.pose || p.rag || p.controlMode !== 'supported') return void (pe = null);
            const e = qInvRot(p.proxy.body.rotation(), sub(p.pose.jointLandmarksWorld.leftElbow, vc(p.proxy.body.translation())));
            if (pe) elbowM = Math.max(elbowM, dist(pe, e));
            pe = e;
          },
        },
      });
      const dt = sim.def.solver.outerTickS;
      let prev: Quat | null = null;
      let frames = 0;
      let worstRadPs = 0;
      let at = 0;
      while (!sim.done && sim.t < 1.5) {
        sim.stepTick();
        const p = sim.players.find((x) => x.id === 'D')!;
        if (!p.pose || p.rag || p.controlMode !== 'supported') {
          prev = null;
          continue;
        }
        const seg = p.pose.segments;
        const q = qMul(qConj(seg.core.rotationWorld), seg.leftUpperArm.rotationWorld);
        if (prev) {
          frames++;
          const w = qAngleBetween(prev, q) / dt;
          if (w > worstRadPs) [worstRadPs, at] = [w, sim.t];
        }
        prev = q;
      }
      sim.dispose();
      return { frames, worstRadPs, at, elbowM };
    };
    const on = await read(JOINT_RANGE_V5);
    const twin = await read(JOINT_RANGE_V4);
    expect(on.frames).toBeGreaterThanOrEqual(3);
    expect(on.worstRadPs).toBeLessThanOrEqual(SNAP_RADPS);
    expect(on.elbowM).toBeLessThan(0.05);
    expect(twin.worstRadPs).toBeGreaterThan(SNAP_RADPS);
    expect(twin.elbowM).toBeGreaterThan(0.3);
  }, 60000);
});
