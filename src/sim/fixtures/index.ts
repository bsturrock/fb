import type { FixtureDef } from '../fixture';
import { gate1Fixtures } from './gate1';
import { gate2Fixtures } from './gate2';
import { gate3Fixtures } from './gate3';
import { gate4Fixtures } from './gate4';
import { modelFixtures } from './model';
import { locomotionFixtures } from './locomotion';

export function allFixtures(): FixtureDef[] {
  return [...gate1Fixtures(), ...gate2Fixtures(), ...gate3Fixtures(), ...gate4Fixtures(), ...modelFixtures(), ...locomotionFixtures()];
}
