// Ground-touch order for candidate F7 scenarios (football subset observer on modified Gate 4 fixtures).
import { Simulation } from '../../src/sim/simulation';
import * as G4 from '../../src/sim/fixtures/gate4';
import { RULES_FOOTBALL, RULES_LAB_CORE } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
const cases: [string, FixtureDef][] = [
  ['F4target+rules', { ...G4.g4f4('targetOnly'), rules: RULES_FOOTBALL('R', { forwardAxis: { x: 0, y: 0, z: -1 }, sideline: false }), durationS: 4 }],
  ['F4simul+rules', { ...G4.g4f4('simultaneous'), rules: RULES_FOOTBALL('R', { forwardAxis: { x: 0, y: 0, z: -1 }, sideline: false }), durationS: 4 }],
  ['F10target+rules', { ...G4.g4f10('targetOnly'), rules: RULES_FOOTBALL('R', { sideline: false }), durationS: 4 }],
  ['F1+football', { ...G4.g4f1(), rules: RULES_FOOTBALL('R', { sideline: false }), durationS: 3 }],
  ['F1+labCore', { ...G4.g4f1(), rules: RULES_LAB_CORE('R'), durationS: 3 }],
];
for (const [name, def] of cases) {
  const sim = await Simulation.create(def);
  sim.runToEnd();
  console.log('==', name, sim.result, sim.t.toFixed(3));
  for (const e of sim.events.filter((e) => ['influenceBegin', 'influenceCleared', 'groundTouch', 'groundWithoutInfluence', 'ruleEnding', 'gripRelease'].includes(e.type)))
    console.log('   ', e.t.toFixed(3), e.type, JSON.stringify(e.data).slice(0, 220));
  sim.dispose();
}
