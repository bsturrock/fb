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
import { hipStopsFor, LEG_GUARD_V3, withAdditionalPgsIterations, withBornOverlap, withBornSeparation, withClipArmSwing, withConversionRetry, withHipStops, withKneeStop, withMetArmStay, withSelfLegs, withBalancedClear } from '../profiles';
import { withHoldStill } from '../footwork';
import { CARRIER_BRACE_V2 } from '../brace';
import { WRAP_V1 } from '../controllers/wrap';

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

/**
 * Ladder 17b, the born-overlap flip: every L3, L4 and HC ragdoll converts a candidate born inside another player, its
 * born pairs out of the solve until they separate (BORN_OVERLAP_V1, rung 17a), rather than leave a rigid falling figure.
 * G, L1, L2 and RH keep their profiles. The lab's `born=off` is the view before it; tests/runs.ts `preBornOverlap` gives a
 * definition as before it.
 */
function bornFlip(d: FixtureDef): FixtureDef {
  return d.ragdoll && VISIBLE_FLIP.test(d.id) ? { ...d, ragdoll: withBornOverlap(d.ragdoll) } : d;
}

/**
 * Ladder 18c, the born-separation flip: every L3, L4 and HC ragdoll's held born pairs are pushed apart, capped
 * (BORN_OVERLAP_V2 in V1's place, rung 18b), rather than left to part as the bodies move: none goes deeper than it was
 * born. G, L1, L2 and RH keep their profiles. The lab's `bornsep=off` is the view before it; tests/runs.ts
 * `preBornSeparation` gives a definition as before it.
 */
function bornSepFlip(d: FixtureDef): FixtureDef {
  return d.ragdoll?.bornOverlap && VISIBLE_FLIP.test(d.id) ? { ...d, ragdoll: withBornSeparation(d.ragdoll) } : d;
}

/**
 * Ladder 18e (16c's and 17c's parked flip), the met-arm flip: every L3, L4 and HC fixture's supported arms keep their
 * natural pose when another body meets them (`metArmStay`, rung 16b, with 14b's `clipArmSwing`, which it makes inert):
 * pressing a little into the other body, at most hanging at the side, never a raised or forward alternative. A met arm
 * pressed into the other player when he converts is a born pair (17b), pushed apart (18c). G, L1, L2 and RH keep their
 * profiles. The lab's `armstay=off&armswing=off` is the view before it; tests/runs.ts `preMetArmStay` gives a definition
 * as before it.
 */
function metArmStayFlip(d: FixtureDef): FixtureDef {
  return d.selfClearance && VISIBLE_FLIP.test(d.id) ? { ...d, selfClearance: withMetArmStay(withClipArmSwing(d.selfClearance)) } : d;
}

/**
 * Contact motion M2, the brace flip: on every L3, L4 and HC fixture with a composed ball carrier, the carrier braces for
 * a hit he sees coming (CARRIER_BRACE_V1: hips lower, chest forward, the ball held high and tight under the free hand;
 * since the M2 follow-up CARRIER_BRACE_V2, the same pose with the chest's lean formed in time for the hit).
 * G, L1, L2 and RH keep their definitions. The lab's `brace=off` is the view before it; tests/runs.ts `preBrace` gives a
 * definition as before it.
 */
function braceFlip(d: FixtureDef): FixtureDef {
  return d.locomotion && VISIBLE_FLIP.test(d.id) && d.players.some((p) => p.role === 'runner') ? { ...d, brace: CARRIER_BRACE_V2 } : d;
}

/**
 * Contact motion M2 follow-up, the balanced-clear flip: on every L3, L4 and HC fixture refereed by the football rules,
 * the defensive influence clears only once the runner has regained his balance (`balancedClear`): a carrier hit off
 * balance who topples a moment later is down by contact. G, L1, L2 and RH keep their profiles. The lab's `balclear=off`
 * is the view before it; tests/runs.ts `preBalancedClear` gives a definition as before it.
 */
function balancedClearFlip(d: FixtureDef): FixtureDef {
  return d.rules?.kind === 'footballTackleSubset' && VISIBLE_FLIP.test(d.id) ? { ...d, rules: withBalancedClear(d.rules) } : d;
}

/**
 * Contact motion M3, the wrap flip: on every L3, L4 and HC fixture with a tackling defender (a `wrapAttempt`
 * controller that pursues to the end), his arms ride ahead of his chest, open into a cradle wider than the carrier ahead
 * of contact and close on the first valid touch (WRAP_V1). A defender who stops pursuing to stand in a hold
 * (`standAfterS`: the L3-F6 stationary holds, which register the hold's still feet) keeps the Gate 2 hands: the cradle
 * is the tackle's, and under it the hold's wrap is retained at the touch, after the carrier's prep has unwound
 * (docs/handoff/contact-motion-m3.md). G, L1, L2 and RH keep their definitions. The lab's `wrap=off` is the view before
 * it; tests/runs.ts `preWrap` gives a definition as before it.
 */
function wrapFlip(d: FixtureDef): FixtureDef {
  const tackles = d.players.some((p) => p.controller.kind === 'wrapAttempt' && p.controller.standAfterS === undefined);
  return VISIBLE_FLIP.test(d.id) && tackles ? { ...d, wrap: WRAP_V1 } : d;
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
  ].map(visibleFlip).map(ownLegFlip).map(legFlip).map(holdStillFlip).map(bornFlip).map(bornSepFlip).map(metArmStayFlip).map(braceFlip).map(balancedClearFlip).map(wrapFlip));
  return registry.slice();
}
