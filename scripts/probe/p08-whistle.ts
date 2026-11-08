// Plan 08 review probe: what the motor is asked for on the substeps after a referee ending in a walk: L3-F14-carrier walks +Z, a
// sideline plane at z = 0.8 m is the only rule that can end it. Usage: vite-node scripts/probe/p08-whistle.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { RULES_FOOTBALL } from '../../src/sim/profiles';
import { len, v3 } from '../../src/sim/vec';

const base = allFixtures().find((d) => d.id === 'L3-F14-carrier')!;
const def = { ...base, rules: RULES_FOOTBALL('R', { forwardAxis: v3(0, 0, 1), sidelineNormal: v3(0, 0, 1), sidelineOffsetM: 0.8, progress: false }) };
const sim = await Simulation.create(def);
const pl = sim.players[0];
while (!sim.done && !sim.rules?.ending) sim.stepTick();
console.log('ending', sim.t.toFixed(4), JSON.stringify(sim.rules?.ending?.kind), 'walk speed', len(pl.walkRequest!).toFixed(3));
for (let i = 0; i < 6; i++) {
  sim.stepTick();
  console.log(sim.t.toFixed(4), 'intent', len(pl.intent.locomotion.desiredVelocityWorld).toFixed(3), 'walkRequest', len(pl.walkRequest!).toFixed(3), 'want', len(pl.walkWant!).toFixed(3), 'vel', len({ ...pl.proxy.body.linvel(), y: 0 }).toFixed(3));
}
sim.dispose();
