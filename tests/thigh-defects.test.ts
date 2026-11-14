// Ladder 11b, the thigh-rotation flip (JOINT_RANGE_V3 registered on L3, L4 and HC), tracked defects (rule 5) its flip
// reached: mechanisms the flip's moved trajectories run into, each on a full-state capture a little before it
// (tests/data/state; how to capture: tests/README.md). Each test pins the defect present in its captured state and fails
// once the defect is gone from it (it then becomes the fix's test, with its fault twin). The twin shows the cause: the
// same state with the flip off (JOINT_RANGE_V2).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { JOINT_RANGE_V2, JOINT_RANGE_V3 } from '../src/sim/profiles';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';
import { heldBornBar } from './visible-bar';

/** The ladder 18 held-born-pair rule's breaches for `pid` over the resumed run, its handoff and its deepest pair. */
async function bornBar(cap: ReturnType<typeof loadState>, def: FixtureDef, pid: string, variant?: string[]) {
  const bar = heldBornBar();
  const sim = await resumeState(cap, { def, ...(variant ? { variant } : {}), opts: { ...cap.opts, onSubstep: bar.substep } });
  while (!sim.done) sim.stepTick();
  const P = sim.byId.get(pid)!;
  const out = { outcome: P.handoff?.outcome, t: P.handoff?.t ?? -1, breaches: bar.of(pid)?.breaches() ?? [], deepest: bar.of(pid)?.deepest() };
  sim.dispose();
  return out;
}

/** The held-born-pair mechanism: a ragdoll's right upper arm held in the other player's head (HC-F2-lowCarrier's A in B; tests/handoff-contact.test.ts excepts the same pair). */
const ARM_HELD_IN_HEAD = /^A rightUpperArm:upperArm in B:head /;

describe('ladder 11b, the thigh-rotation flip: tracked defects (rule 5)', () => {
  // (a) HC-F2-lowCarrier: the falling A converts at 0.692 s onto the low carrier B (his root held at 0.78 m), his right
  // forearm 7 cm in B's head at the switch: a born pair (BORN_OVERLAP_V2, pushed apart, capped). Registered (V3) his
  // right upper arm then stays over 5 cm in B's head for 0.23 s from 0.696 s, 10.9 cm at its deepest (0.758 s): the
  // ladder 18 rule's pass-through. B, supported, then goes down himself at 1.767 s (under V2 from the start he stays up,
  // and A's arm parts in under 0.1 s). Captured at 0.600 s under V3; twin, JOINT_RANGE_V2 from there: the same pair over
  // 5 cm for 0.10 s (from 0.683 s: 0.15 s): the born arm held in the head is reached by the moved trajectory (B's legs
  // in range under both, their placements ranked differently), present without the flip from the same state; its depth
  // and time vary with it. A fix is in the born separation (an arm in a head parted faster), its own step.
  it('ARM_HELD_IN_HEAD (HC-F2-lowCarrier, from 0.600 s): the falling A, converted with his right arm in the low carrier\'s head, keeps the upper arm over 5 cm in it for over 0.1 s, with the thigh-rotation flip and without it from the same state', async () => {
    const cap = loadState('tests/data/state/HC-F2-lowCarrier@36.json.gz');
    const def = asCaptured(cap);
    expect(def.jointRange).toBe(JOINT_RANGE_V3);
    expect(FIX(cap.fixture).jointRange).toBe(JOINT_RANGE_V3);
    const on = await bornBar(cap, def, 'A');
    const off = await bornBar(cap, { ...def, jointRange: JOINT_RANGE_V2 }, 'A', ['jointRange', 'ragdoll']);
    const said = JSON.stringify({ on, off });
    for (const r of [on, off]) {
      expect(r.outcome, said).toBe('accepted');
      expect(r.t, said).toBeCloseTo(0.692, 3);
      expect(r.breaches.length, said).toBeGreaterThan(0);
      expect(r.breaches.every((b) => ARM_HELD_IN_HEAD.test(b)), said).toBe(true);
      expect(r.breaches.some((b) => /over 5 cm deep for/.test(b)), said).toBe(true);
    }
  }, 120000);
});
