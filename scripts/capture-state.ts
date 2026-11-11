// Full-state capture of a registered fixture at a tick boundary (tests/state.ts), for a test to resume from:
//   npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers]
// Runs the fixture with the fixture export's defaults (ledgers off, as `npm run fixtures`; `--ledgers` keeps them, for a
// test that reads them, at about twice the size) to the end of tick <tick>, writes the
// capture (default tests/data/state/<fixture>@<tick>.json.gz) and checks it: the run resumed from the file reproduces
// the uninterrupted run's export (summary, events and trace) to the end, byte for byte. See tests/README.md.
import { statSync } from 'node:fs';
import { SIM_DEFAULTS, Simulation } from '../src/sim/simulation';
import { FIX } from '../tests/runs';
import { captureState, loadState, resumeState, saveState } from '../tests/state';

const args = process.argv.slice(2).filter((a) => a !== '--ledgers');
const [id, tickArg, outArg] = args;
const tick = Number(tickArg);
if (!id || !Number.isInteger(tick) || tick < 1) throw new Error('usage: capture-state.ts <fixture> <tick> [out] [--ledgers]');
SIM_DEFAULTS.ledgers = process.argv.includes('--ledgers');
const out = outArg ?? `tests/data/state/${id}@${tick}.json.gz`;
const exportOf = (s: Simulation): string => JSON.stringify({ fixture: s.exportFixture(), summary: s.summary(), events: s.events, trace: s.trace });

const sim = await Simulation.create(FIX(id));
sim.runToEnd(tick);
if (sim.tick !== tick) throw new Error(`${id} ended at tick ${sim.tick}, before ${tick}`);
saveState(out, captureState(sim));
sim.runToEnd();
const whole = exportOf(sim);
sim.dispose();
const back = await resumeState(loadState(out));
back.runToEnd();
const same = exportOf(back) === whole;
back.dispose();
console.log(`${out}: ${id} tick ${tick} (t ${(tick * FIX(id).solver.outerTickS).toFixed(3)} s), ${(statSync(out).size / 1024).toFixed(0)} KB; resumed run ${same ? 'identical' : 'DIFFERS'} to the end`);
if (!same) process.exit(1);
