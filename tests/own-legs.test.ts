// Ladder 11c: a supported leg's knee-pole placement kept off the other leg (`LegGuardProfile.ownLegs`, LEG_GUARD_V4, used
// by no fixture yet). Rung 7's planted pose and the sweep take the primary placement at another knee pole when the
// primary is obstructed, the inward pole first; nothing read the other leg, so a held player's knee went in behind the
// other knee: L3-F6-hold R's left foot is planted near the midline at 3.70 s, its primary meets D from 3.90 s, and the
// inward pole puts its knee behind the right knee (the thighs' axes 13.5 cm apart, under their 15 cm radii) to the end of
// the run. Under the profile a knee-pole placement whose bone axes come nearer the other leg's (as last shown) than the
// primary's do is not taken. The twin is the same state on LEG_GUARD_V3.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { poseProbe } from '../src/sim/debug';
import { LEG_GUARD_V3, LEG_GUARD_V4, type LegGuardProfile } from '../src/sim/profiles';
import { addScaled, sub, type Vec3 } from '../src/sim/vec';
import { FIX } from './runs';
import { loadState, resumeState } from './state';
import { segDist } from './visible';

/** The visible meter's own-leg axes (tests/visible.ts boneAxes): distal half thigh, shin, ankle to shoe. */
const axes = (lm: Record<string, Vec3>, s: 'left' | 'right'): [Vec3, Vec3, number][] => [
  [addScaled(lm[`${s}Hip`], sub(lm[`${s}Knee`], lm[`${s}Hip`]), 0.5), lm[`${s}Knee`], 0.075],
  [lm[`${s}Knee`], lm[`${s}Ankle`], 0.05],
  [lm[`${s}Ankle`], lm[`${s}Shoe`], 0.04],
];
/** How far (m) the two legs' axes come inside their radii's sum (positive: crossing). */
const legsNear = (lm: Record<string, Vec3>): number => {
  let m = -Infinity;
  for (const [a, b, r] of axes(lm, 'left')) for (const [c, d, t] of axes(lm, 'right')) m = Math.max(m, r + t - segDist(a, b, c, d));
  return m;
};

describe('ladder 11c: knee poles kept off the other leg', () => {
  it('the profile: leg-guard-v3 with the visible meter\'s own-leg radii, used by no fixture', () => {
    expect({ ...LEG_GUARD_V4, id: LEG_GUARD_V3.id, ownLegs: undefined }).toEqual({ ...LEG_GUARD_V3, ownLegs: undefined });
    expect(LEG_GUARD_V4.ownLegs).toEqual({ thighRadiusM: 0.075, shinRadiusM: 0.05, footRadiusM: 0.04 });
    for (const d of allFixtures()) expect(d.legGuard?.ownLegs, d.id).toBeUndefined();
  });

  it('L3-F6-hold from 3.85 s: no shown knee-pole placement crosses the other leg (the twin on leg-guard-v3 holds R\'s left knee behind the right)', async () => {
    // captured at the end of tick 231 (3.850 s) under the registered profile, before R's left leg first takes the inward
    // pole (3.900 s); resumed under each guard to the end, every drawn frame of a supported player. Measured: on, 83 of 138
    // frames at a knee pole, none crossing (R's left foot steps out at 4.02-4.33 s instead); the twin, 60 crossing, all R's left
    const cap = loadState('tests/data/state/L3-F6-hold@231.json.gz');
    const read = async (legGuard: LegGuardProfile): Promise<{ frames: number; poleFrames: number; poleCross: number; rLeftPoleCross: number }> => {
      const v: Record<string, number> = {};
      const trace = (key: string, r: Record<string, unknown>) => {
        if (typeof r.v === 'number') v[key] = r.v;
      };
      const sim = await resumeState(cap, { def: { ...FIX('L3-F6-hold'), legGuard }, variant: ['legGuard'], faults: { poseProbe: poseProbe({ trace }) } });
      let frames = 0;
      let poleFrames = 0;
      let poleCross = 0;
      let rLeftPoleCross = 0;
      while (!sim.done) {
        sim.stepTick();
        for (const p of sim.players) {
          if (!p.pose || p.rag) continue;
          frames++;
          // index >= 10 (LEG_ALTS' length): the primary placement at a knee pole
          const onPole = (['left', 'right'] as const).filter((s) => (v[`${p.id}:${s}Leg`] ?? 0) >= 10);
          if (!onPole.length) continue;
          poleFrames++;
          if (legsNear(p.pose.jointLandmarksWorld) <= 0) continue;
          poleCross++;
          if (p.id === 'R' && onPole.includes('left')) rLeftPoleCross++;
        }
      }
      sim.dispose();
      return { frames, poleFrames, poleCross, rLeftPoleCross };
    };
    const on = await read(LEG_GUARD_V4);
    const twin = await read(LEG_GUARD_V3);
    expect(on.frames).toBeGreaterThan(100);
    expect(on.poleFrames).toBeGreaterThan(0);
    expect(on.poleCross).toBe(0);
    expect(twin.rLeftPoleCross).toBeGreaterThan(30);
  }, 120000);
});
