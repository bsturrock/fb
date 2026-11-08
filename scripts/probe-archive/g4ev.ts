// Condensed event list for a fixture (clamp chatter collapsed): wrap/grip/handoff/rule events and the result.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === (process.argv[2] ?? 'G4-F3-failed'))!);
while (!sim.done) sim.stepTick();
const skip = /clampBegin|clampEnd|contactBegin|contactEnd|groundTouch|progressWindow|grounded/;
for (const e of sim.events) if (!skip.test(e.type)) console.log(e.t.toFixed(3), e.type, e.playerId ?? '', JSON.stringify(e.data).slice(0, 140));
console.log('result', sim.result, 't', sim.t.toFixed(3), 'clampBegin x', sim.events.filter((e) => e.type === 'clampBegin').length);
sim.dispose();
