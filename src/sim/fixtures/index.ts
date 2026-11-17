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
import { FALL_L4, FALL_L4_V2, FALL_REACT_V3, hipStopsFor, JOINT_RANGE_V2, JOINT_RANGE_V3, LEG_GUARD_V3, withAdditionalPgsIterations, withBornOverlap, withBornSeparation, withClipArmSwing, withConversionRetry, withHipStops, withKneeStop, withMetArmStay, withSelfLegs, withBalancedClear, withShoulderTwistLimit, SHOULDER_TWIST_ANAT_V2 } from '../profiles';
import { withHoldStill } from '../footwork';
import { withSteps } from '../contact-steps';
import { CARRIER_BRACE_V2 } from '../brace';
import { WRAP_V13 } from '../controllers/wrap';

/**
 * What a registered id gets on top of what its fixture file registers. Each fixture file registers its family's base
 * profiles (L3, L4 and HC: JOINT_RANGE_V2, LEG_GUARD_V1, SELF_CLEARANCE_V1, L4's FALL_L4 responses); the layers below
 * were each turned on for fixtures in a step of its own (a "flip") after landing flag off, and `registered` puts them all
 * on in the order they were turned on, which the ragdoll's composed id and the definitions' key order record.
 *
 * G, L1 and RH get nothing here; L2 gets the contact stepping model alone. L3, L4 and HC get every layer below. A new
 * family gets nothing unless it is added here: a new layer is opt-in per family (CLAUDE.md).
 *
 * Every L3, L4 and HC fixture:
 * - ragdoll (if any): the visible flip (ladder 8l: hip stops `hipStopsFor`, 4 additional PGS iterations, the knee
 *   flexion stop at 140 deg, the deferred conversion), own-leg contact (ladder 9, SELF_LEGS_V1), the born overlap
 *   (ladder 17b: a candidate born inside another player converts with its born pairs out of the solve) and its capped
 *   separation (ladder 18c, BORN_OVERLAP_V2), and the anatomical shoulder twist limit stepped on the arm's inertia
 *   (ladder 13a-iii, SHOULDER_TWIST_ANAT_V2; G, L1, L2 and RH have no envelope);
 * - leg guard (if any): LEG_GUARD_V3 (ladder 10: swept leg step, planted pose, physical supported legs);
 * - foot planner (if any): the still feet of a stationary hold (ladder 14a, HOLD_STILL_V1), then, if it composes, the
 *   contact stepping model (plan 15 step 4, STEPS_V2);
 * - self clearance (if any): met arms keep their natural pose (ladder 18e, `metArmStay`, with 14b's `clipArmSwing`,
 *   which it makes inert);
 * - a composed ball carrier (`locomotion` and a runner): the brace for a hit he sees coming (contact motion M2,
 *   CARRIER_BRACE_V2);
 * - the football rules: the defensive influence clears only once the runner has regained his balance (M2 follow-up,
 *   `balancedClear`);
 * - a tackling defender (a `wrapAttempt` that pursues to the end; a `standAfterS` hold keeps the Gate 2 hands): the wrap
 *   (contact motion M3 and polish 1 to 4: cradle, strike, drive, ride-down, bound legs, fall link, the drive from behind,
 *   staying on, the hit's aim), WRAP_V13; the five full-sprint crossing tackles the user called hits (`HIT_FIXTURES`, by
 *   id) ask their tackler for a hit (`WrapSpec.tackle`), every other tackle for nothing;
 * - L3 and HC with a ragdoll: every player who converts reacts as he falls, with the landed palm bearing load and the
 *   forward-fall body plan (contact motion M4 and polish 4, FALL_REACT_V3); L4's FALL_L4 responses take the forward fall
 *   (FALL_L4_V2), its other responses (knee-only, zero-cap, low-work twins) stay as registered;
 * - JOINT_RANGE_V2 becomes JOINT_RANGE_V3 (ladder 11b, the supported thigh's rotation kept in the hip's twist range).
 *
 * The lab's switches (src/lab/lab-params.ts) give the views before each layer; tests/runs.ts `BEFORE_FLIPS` gives the
 * definitions as before each flip, for state captures taken under them.
 */
export const HIT_FIXTURES: readonly string[] = ['L3-F4-twoArm', 'L4-F10-wrap-on', 'L3-F1-low', 'HC-F3-lowRunner', 'HC-F3-phase0'];
const OPT_IN = /^(L3|L4|HC)-/;
const FALLS = /^(L3|HC)-/;

function registered(d: FixtureDef): FixtureDef {
  if (/^L2-/.test(d.id)) return d.footwork ? { ...d, footwork: withSteps(d.footwork) } : d;
  if (!OPT_IN.test(d.id)) return d;
  const r = d.ragdoll;
  const ragdoll = r && withShoulderTwistLimit(withBornSeparation(withBornOverlap(withSelfLegs(withConversionRetry(withKneeStop(withAdditionalPgsIterations(withHipStops(r, hipStopsFor(r)), 4), 140))))), SHOULDER_TWIST_ANAT_V2);
  const still = d.footwork && withHoldStill(d.footwork);
  const footwork = still?.compose ? withSteps(still) : still;
  const tackles = d.players.some((p) => p.controller.kind === 'wrapAttempt' && p.controller.standAfterS === undefined);
  const hit = tackles && HIT_FIXTURES.includes(d.id);
  const fallResponse = r && FALLS.test(d.id) ? FALL_REACT_V3 : d.fallResponse === FALL_L4 ? FALL_L4_V2 : d.fallResponse;
  // (keys absent from the file's definition are added in the order the flips added them: brace, wrap, fallResponse)
  return {
    ...d,
    ...(ragdoll ? { ragdoll } : {}),
    ...(d.legGuard ? { legGuard: LEG_GUARD_V3 } : {}),
    ...(footwork ? { footwork } : {}),
    ...(d.selfClearance ? { selfClearance: withMetArmStay(withClipArmSwing(d.selfClearance)) } : {}),
    ...(d.locomotion && d.players.some((p) => p.role === 'runner') ? { brace: CARRIER_BRACE_V2 } : {}),
    ...(d.rules?.kind === 'footballTackleSubset' ? { rules: withBalancedClear(d.rules) } : {}),
    ...(tackles ? { wrap: WRAP_V13 } : {}),
    ...(fallResponse !== d.fallResponse ? { fallResponse } : {}),
    ...(d.jointRange === JOINT_RANGE_V2 ? { jointRange: JOINT_RANGE_V3 } : {}),
    ...(hit ? { players: d.players.map((p) => (p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, tackle: 'hit' as const } } : p)) } : {}),
  };
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
  ].map(registered));
  return registry.slice();
}
