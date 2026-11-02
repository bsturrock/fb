// Run fixtures headless; write reproduction JSON + traces + event logs to evidence/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { allFixtures } from '../src/sim/fixtures/index';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const outDir = 'evidence/traces';
mkdirSync(outDir, { recursive: true });
const summaries: unknown[] = [];
for (const def of allFixtures()) {
  if (filter && !filter.test(def.id)) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const s = sim.summary();
  summaries.push(s);
  writeFileSync(`${outDir}/${def.id}.json`, JSON.stringify({ fixture: sim.exportFixture(), summary: s, events: sim.events, trace: sim.trace }));
  const ev = sim.events.filter((e) => !['grounded'].includes(e.type)).map((e) => `${e.t}:${e.type}${e.playerId ? '@' + e.playerId : ''}${e.data && 'own' in e.data ? `(${e.data.own}>${e.data.otherClass})` : ''}`);
  console.log(def.id.padEnd(40), String(s.result).padEnd(20), JSON.stringify(s.players), '\n   ', ev.slice(0, 14).join(' '));
  sim.dispose();
}
writeFileSync('evidence/summary.json', JSON.stringify(summaries, null, 1));
