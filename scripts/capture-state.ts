// Full-state capture of a registered fixture at a tick boundary (tests/state.ts), for a test to resume from:
//   npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit]
// Runs the fixture with the fixture export's defaults (ledgers off, as `npm run fixtures`; `--ledgers` keeps them, for a
// test that reads them, at about twice the size) to the end of tick <tick>, writes the
// capture (default tests/data/state/<fixture>@<tick>.json.gz) and checks it: the run resumed from the file reproduces
// the uninterrupted run's export (summary, events and trace) to the end, byte for byte. `--v3`: the fixture under
// LEG_GUARD_V3 (the physical supported legs, which no registered fixture runs yet), written as <fixture>~v3@<tick>; a
// test resumes it with the same definition (`{ def: { ...FIX(id), legGuard: LEG_GUARD_V3 } }`). `--audit`: with the
// plan 08 transition audit on (`SimOptions.transitionAudit`, kept in the capture's options), suffix `-audit`. `--rev`:
// the reversed body order (`SimOptions.reverseOrder`, kept in the capture's options), suffix `rev`
// (<fixture>~v3-rev@<tick>). See tests/README.md.
import { statSync } from 'node:fs';
import { LEG_GUARD_V3 } from '../src/sim/profiles';
import { SIM_DEFAULTS, Simulation } from '../src/sim/simulation';
import { FIX } from '../tests/runs';
import { captureState, loadState, resumeState, saveState } from '../tests/state';

const FLAGS = ['--ledgers', '--v3', '--rev', '--audit'];
const args = process.argv.slice(2).filter((a) => !FLAGS.includes(a));
const [id, tickArg, outArg] = args;
const tick = Number(tickArg);
if (!id || !Number.isInteger(tick) || tick < 1) throw new Error('usage: capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit]');
SIM_DEFAULTS.ledgers = process.argv.includes('--ledgers');
const v3 = process.argv.includes('--v3');
const audit = process.argv.includes('--audit');
const rev = process.argv.includes('--rev');
const opts = { ...(audit ? { transitionAudit: true } : {}), ...(rev ? { reverseOrder: true } : {}) };
const def = v3 ? { ...FIX(id), legGuard: LEG_GUARD_V3 } : FIX(id);
const suffix = [v3 && 'v3', rev && 'rev', audit && 'audit'].filter(Boolean).join('-');
const out = outArg ?? `tests/data/state/${id}${suffix ? `~${suffix}` : ''}@${tick}.json.gz`;
const exportOf = (s: Simulation): string => JSON.stringify({ fixture: s.exportFixture(), summary: s.summary(), events: s.events, trace: s.trace, ...(audit ? { audit: s.transitionDeltas } : {}) });

const sim = await Simulation.create(def, opts);
sim.runToEnd(tick);
if (sim.tick !== tick) throw new Error(`${id} ended at tick ${sim.tick}, before ${tick}`);
saveState(out, captureState(sim));
sim.runToEnd();
const whole = exportOf(sim);
sim.dispose();
const back = await resumeState(loadState(out), { def });
back.runToEnd();
const same = exportOf(back) === whole;
back.dispose();
console.log(`${out}: ${id}${v3 ? ' (V3)' : ''}${rev ? ' (reversed)' : ''}${audit ? ' (audit)' : ''} tick ${tick} (t ${(tick * def.solver.outerTickS).toFixed(3)} s), ${(statSync(out).size / 1024).toFixed(0)} KB; resumed run ${same ? 'identical' : 'DIFFERS'} to the end`);
if (!same) process.exit(1);
