import type { FixtureDef } from '../fixture';
import { gate1Fixtures } from './gate1';
import { gate2Fixtures } from './gate2';
import { gate3Fixtures } from './gate3';
import { gate4Fixtures } from './gate4';
import { modelFixtures } from './model';
import { locomotionFixtures } from './locomotion';
import { rideHeightFixtures } from './ride-height';
import { footworkFixtures } from './footwork';
import { transitionFixtures } from './transitions';
import { fallFixtures } from './falls';
import { handoffContactFixtures } from './handoff-contact';
import { hipStopsFor, LEG_GUARD_V3, withAdditionalPgsIterations, withConversionRetry, withHipStops, withKneeStop, withSelfLegs } from '../profiles';
import { withHoldStill } from '../footwork';

/**
 * Ladder 8l, the visible flip: every L3, L4 and HC ragdoll runs the hip stops `hipStopsFor` gives (the 8d box with the
 * approach zone, HIP_STOPS_V2; on L4 too since rung 8k), 4 additional PGS iterations, the knee flexion stop at 140 deg
 * and the deferred conversion (rung 8j). G, L1, L2 and RH keep their profiles. The lab's
 * `hips=on&pgs=4&knees=140&retry=on` is the same profile on a fixture registered without it; tests/runs.ts `preFlip`
 * gives a definition as before the flip.
 */
const VISIBLE_FLIP = /^(L3|L4|HC)-/;
function visibleFlip(d: FixtureDef): FixtureDef {
  if (!d.ragdoll || !VISIBLE_FLIP.test(d.id)) return d;
  return { ...d, ragdoll: withConversionRetry(withKneeStop(withAdditionalPgsIterations(withHipStops(d.ragdoll, hipStopsFor(d.ragdoll)), 4), 140)) };
}

/**
 * Ladder 9, own-leg contact: every L3, L4 and HC ragdoll's legs meet each other, and its shins and shoes its own trunk
 * (SELF_LEGS_V1, rung 9a), on top of the visible flip. G, L1, L2 and RH keep their profiles. The lab's `selfleg=off` is
 * the view before it; tests/runs.ts `preOwnLegs` gives a definition as before it, `preFlip` as before both flips.
 */
function ownLegFlip(d: FixtureDef): FixtureDef {
  if (!d.ragdoll || !VISIBLE_FLIP.test(d.id)) return d;
  return { ...d, ragdoll: withSelfLegs(d.ragdoll) };
}

/**
 * Ladder 10, the leg-guard flip: every fixture with a leg guard (every L3, L4 and HC fixture; plan 13f's predictive
 * LEG_GUARD_V1 until then) runs LEG_GUARD_V3: the swept leg step and planted pose (V2, rungs 5 and 7) and physical
 * supported legs (rung 6). G, L1, L2 and RH have no leg guard. The lab's `legs=v1` is the view before it;
 * tests/runs.ts `preV3` gives a definition as before it.
 */
function legFlip(d: FixtureDef): FixtureDef {
  return d.legGuard ? { ...d, legGuard: LEG_GUARD_V3 } : d;
}

/**
 * Ladder 14a, the still-feet flip (the rule of rung 13b): every L3, L4 and HC fixture with a foot planner keeps its feet planted in a
 * stationary hold (HOLD_STILL_V1). L2's planner is unchanged. The lab's `holdstill=off` is the view before it;
 * tests/runs.ts `preHoldStill` gives a definition as before it.
 */
function holdStillFlip(d: FixtureDef): FixtureDef {
  return d.footwork && VISIBLE_FLIP.test(d.id) ? { ...d, footwork: withHoldStill(d.footwork) } : d;
}

/** Freeze an object graph in place (typed arrays are left as they are: they cannot be frozen). */
function deepFreeze<T>(o: T, seen = new Set<unknown>()): T {
  if (o === null || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return o;
  seen.add(o);
  for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v, seen);
  return Object.freeze(o);
}

let registry: readonly FixtureDef[] | null = null;

/**
 * Every registered fixture, in registry order. Built once per process; the definitions are deeply frozen and shared,
 * so callers derive variants by spreading (`{ ...def, id }`) or `structuredClone`, never by mutating them. Each call
 * returns a new array.
 */
export function allFixtures(): FixtureDef[] {
  registry ??= deepFreeze([
    ...gate1Fixtures(),
    ...gate2Fixtures(),
    ...gate3Fixtures(),
    ...gate4Fixtures(),
    ...modelFixtures(),
    ...locomotionFixtures(),
    ...rideHeightFixtures(),
    ...footworkFixtures(),
    ...handoffContactFixtures(),
    ...transitionFixtures(),
    ...fallFixtures(),
  ].map(visibleFlip).map(ownLegFlip).map(legFlip).map(holdStillFlip));
  return registry.slice();
}
