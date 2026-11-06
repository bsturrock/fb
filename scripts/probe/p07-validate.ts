// Plan 07 review closeout probe: the review's invalid tuning values are rejected before physics (exact messages).
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { DEFAULT_MOTOR, withBrakingLimit } from '../../src/sim/profiles';

try {
  withBrakingLimit(DEFAULT_MOTOR, -5.5);
  console.log('withBrakingLimit(-5.5): accepted');
} catch (e) {
  console.log(`withBrakingLimit(-5.5): ${(e as Error).message}`);
}
const sprint = allFixtures().find((d) => d.id === 'L2-F11-sprint')!;
try {
  await Simulation.create({ ...sprint, runClips: { ...sprint.runClips!, stanceWidthAddM: { sprint: Infinity } } });
  console.log('stanceWidthAddM sprint Infinity: accepted');
} catch (e) {
  console.log(`stanceWidthAddM sprint Infinity: ${(e as Error).message}`);
}
const stop = allFixtures().find((d) => d.id === 'L2-F3-runStop')!;
try {
  await Simulation.create({ ...stop, players: stop.players.map((p) => ({ ...p, motor: { ...DEFAULT_MOTOR, braking: { maxDecelMps2: 0 } } })) });
  console.log('player override braking 0: accepted');
} catch (e) {
  console.log(`player override braking 0: ${(e as Error).message}`);
}
