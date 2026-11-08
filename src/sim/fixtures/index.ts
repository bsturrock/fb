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
  ]);
  return registry.slice();
}
