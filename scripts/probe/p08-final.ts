// Plan 08 closeout probe: conversions, rejections and failed plants across L3.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

let conv = 0;
let plants = 0;
const rej: string[] = [];
const fail: string[] = [];
for (const def of allFixtures().filter((d) => d.id.startsWith('L3-'))) {
  const sim = await Simulation.create(def);
  sim.runToEnd();
  for (const e of sim.events) {
    if (e.type === 'representation') conv++;
    if (e.type === 'footPlant') plants++;
    if (e.type === 'handoffRejected') rej.push(`${def.id} ${e.t.toFixed(3)} ${e.playerId}`);
    if (e.type === 'footPlantFailed') fail.push(`${def.id} ${e.t.toFixed(3)} ${e.playerId} ${String(e.data?.side)} ${String(e.data?.reason)} ${String(e.data?.errM)}`);
  }
  sim.dispose();
}
console.log('conversions', conv, 'plants', plants);
console.log('rejected', rej.length, rej.join('; '));
console.log('failed plants', fail.length);
for (const l of fail) console.log(' ', l);
