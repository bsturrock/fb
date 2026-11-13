import { describe, expect, it } from 'vitest';
import type { PoseDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { withClipArmSwing } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { armProbe, firstDifference, watch, type Seen, type Watched } from './arm-watch';
import { asCaptured, FIX, preMetArmStay } from './runs';
import { loadState, resumeState } from './state';
import { DEEP_M, SNAP_RADPS } from './visible';

// Ladder 14b: a composed arm another body has met keeps its swing (SelfClearanceProfile.clipArmSwing,
// CLIP_ARM_HELD_DEPARTURE). As registered, a clip arm whose swing-out found nothing clear took a body-fixed
// alternative, and the continuity step toward it was a departure from the swinging clip target, carried with that target
// across the chest (L3-F16-contactStop D's left forearm through its own trunk at 0.55 s, the user's screenshot), then kept
// for the rest of the run as pushes it could not follow walked the target on (past 1 m). Judged by gross pass-through
// (the user's bar: an arm through the body, not a shallow brush): the drawn forearm or palm past the meter's DEEP_M in the
// player's own measured trunk (past the idle baseline), or the forearm's or hand's bone axis inside the trunk.

const withSwing = (d: FixtureDef): FixtureDef => ({ ...d, selfClearance: withClipArmSwing(d.selfClearance!) });
/** Fixture `id` as before ladder 18e registered `metArmStay` with `clipArmSwing` (under it `clipArmSwing` changes nothing). */
const PRE = (id: string): FixtureDef => preMetArmStay(FIX(id));

/** L3-F16-contactStop resumed from 0.30 s (before D's left arm meets the runner's carry arm and ball at 0.35 s), as captured or with `variant` applied to its self-clearance. */
async function contactStop(variant?: (d: FixtureDef) => FixtureDef, pose?: PoseDebug): Promise<Watched> {
  const seen: Seen = {};
  const probe = armProbe(seen);
  const cap = loadState('tests/data/state/L3-F16-contactStop@18.json.gz');
  const d0 = asCaptured(cap);
  const sim = await resumeState(cap, { def: variant ? variant(d0) : d0, ...(variant ? { variant: ['selfClearance'] } : {}), faults: { poseProbe: probe, ...(pose ? { pose } : {}) } });
  const w = await watch(sim, seen);
  sim.dispose();
  return w;
}

describe('ladder 14b: a composed arm another body has met keeps its swing (clipArmSwing)', () => {
  it('L3-F16-contactStop from 0.30 s, the user\'s screenshot (0.55 s): as registered (the fault twin) the defender\'s left forearm, in a body-fixed alternative 0.67 m off its clip target, passes 10 cm into its own trunk at 0.567 s (4 ms before the first contact), its bone axis inside the trunk; with clipArmSwing no forearm or palm of either player passes through its own trunk (none past DEEP_M, no forearm or hand axis inside it), the defender\'s left not past 2 cm', async () => {
    const reg = await contactStop();
    expect(reg.firstContact).toBeCloseTo(0.5708, 3);
    const dl = reg.arms['D:left'];
    expect(dl.peak).toBeGreaterThan(DEEP_M);
    expect(dl.peakT).toBeCloseTo(0.5667, 3);
    expect(dl.peakT).toBeLessThan(reg.firstContact);
    expect(dl.variant).toBeGreaterThan(0);
    expect(dl.departure).toBeGreaterThan(0.5);
    expect(dl.axis).toBeGreaterThan(0.03);
    const on = await contactStop(withSwing);
    for (const a of Object.values(on.arms)) {
      expect(a.peak).toBeLessThan(DEEP_M);
      expect(a.axis).toBeLessThanOrEqual(0.01);
    }
    expect(on.arms['D:left'].peak).toBeLessThanOrEqual(0.02);
    expect(on.arms['D:left'].axis).toBe(0);
  }, 120000);

  it('no snap: with clipArmSwing, in L3-F7-mirror0 (the defender\'s right arm let go of the runner from 0.55 s) no supported shoulder or elbow turns faster than 60 rad/s between frames, the departure let go as fast as the clip moves; the fault twin, the departure let go at once, snaps (the defender\'s right shoulder at 0.567 s)', async () => {
    const run = async (pose?: PoseDebug): Promise<Watched> => {
      const seen: Seen = {};
      const probe = armProbe(seen);
      const sim = await Simulation.create(withSwing(PRE('L3-F7-mirror0')), { debug: { poseProbe: probe, ...(pose ? { pose } : {}) } });
      const w = await watch(sim, seen);
      sim.dispose();
      return w;
    };
    expect((await run()).snap.w).toBeLessThanOrEqual(SNAP_RADPS);
    const twin = await run({ clipArmSwingAtOnce: true });
    expect(twin.snap.w).toBeGreaterThan(SNAP_RADPS);
    expect(twin.snap.at).toBe('D rightShoulder 0.567');
  }, 120000);

  it('what nothing has met is unchanged: the free run\'s carry tuck (L3-F18-runLab), the grips (L3-F4-gripBoth) and the two-palm hold (L4-F5-twoPalm-on) run identically with clipArmSwing; in the wrap (L4-F10-wrap-on) and the hold (L3-F6-hold) the first difference is a composed arm, not an arm task. The fault twin, the rules on for every composed arm (not only one another body has met), changes the carry tuck', async () => {
    for (const id of ['L3-F18-runLab', 'L3-F4-gripBoth', 'L4-F5-twoPalm-on']) expect(await firstDifference(PRE(id), withSwing(PRE(id)))).toBeNull();
    for (const id of ['L4-F10-wrap-on', 'L3-F6-hold']) {
      const d = await firstDifference(PRE(id), withSwing(PRE(id)));
      expect(d).not.toBeNull();
      expect(d!.task).toBe(false);
    }
    const twin = await firstDifference(PRE('L3-F18-runLab'), withSwing(PRE('L3-F18-runLab')), { clipArmSwingUngated: true });
    expect(twin).toMatchObject({ player: 'R', arm: 'right', task: false });
  }, 240000);
});
