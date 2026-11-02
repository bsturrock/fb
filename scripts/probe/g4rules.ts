// Print the rule-observer story (influence, ground touches, progress windows, ending) of matching Gate 4 fixtures.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const only = process.argv[2] ?? '';
for (const def of gate4Fixtures().filter((d) => d.rules && d.id.includes(only))) {
  const sim = await Simulation.create(def);
  sim.runToEnd();
  console.log('==', def.id, sim.result, 't', sim.t.toFixed(3));
  for (const e of sim.events.filter((e) => ['influenceBegin', 'influenceCleared', 'groundTouch', 'groundWithoutInfluence', 'progressWindow', 'ruleEnding', 'ruleObserverDisabled', 'representation', 'handoffRejected', 'lossOfSupport', 'trialEnd', 'practiceOutOfBounds'].includes(e.type)))
    console.log('   ', e.t.toFixed(3), e.type, e.playerId ?? '', JSON.stringify(e.type === 'representation' ? { trigger: e.data!.trigger } : e.data ?? {}).slice(0, 330));
  sim.dispose();
}
