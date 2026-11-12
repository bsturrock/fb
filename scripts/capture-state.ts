// Full-state capture of a registered fixture at a tick boundary (tests/state.ts), for a test to resume from:
//   npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit] [--hips=v1|v2] [--flip8i] [--joints=v4]
// Runs the fixture with the fixture export's defaults (ledgers off, as `npm run fixtures`; `--ledgers` keeps them, for a
// test that reads them, at about twice the size) to the end of tick <tick>, writes the
// capture (default tests/data/state/<fixture>@<tick>.json.gz) and checks it: the run resumed from the file reproduces
// the uninterrupted run's export (summary, events and trace) to the end, byte for byte. `--v3`: the fixture under
// LEG_GUARD_V3 (the physical supported legs, which no registered fixture runs yet), written as <fixture>~v3@<tick>; a
// test resumes it with the same definition (`{ def: { ...FIX(id), legGuard: LEG_GUARD_V3 } }`). `--audit`: with the
// plan 08 transition audit on (`SimOptions.transitionAudit`, kept in the capture's options), suffix `-audit`. `--rev`:
// the reversed body order (`SimOptions.reverseOrder`, kept in the capture's options), suffix `rev`
// (<fixture>~v3-rev@<tick>). `--hips=v1|v2`: the fixture's ragdoll with the hip stops HIP_STOPS_V1 (ladder 8d) or
// HIP_STOPS_V2 (8g, with the approach zone), which no registered fixture runs yet, suffix `hipsv1` / `hipsv2`; a test
// resumes it with `{ def: { ...FIX(id), ragdoll: withHipStops(FIX(id).ragdoll!, HIP_STOPS_V2) } }`. `--flip8i`: the
// fixture under the ladder 8i visible flip (tests/runs.ts `flip8i`), suffix `flip8i`; a test resumes it with
// `{ def: flip8i(FIX(id)) }`. `--joints=v4`: the fixture under JOINT_RANGE_V4 (ladder 11d, the anatomical twist window,
// which no registered fixture runs yet), suffix `jrv4`; a test resumes it with `{ def: { ...FIX(id), jointRange:
// JOINT_RANGE_V4 } }`. See tests/README.md.
import { statSync } from 'node:fs';
import { HIP_STOPS_V1, HIP_STOPS_V2, JOINT_RANGE_V4, LEG_GUARD_V3, withHipStops } from '../src/sim/profiles';
import { SIM_DEFAULTS, Simulation } from '../src/sim/simulation';
import { FIX, flip8i } from '../tests/runs';
import { captureState, loadState, resumeState, saveState } from '../tests/state';

const FLAGS = ['--ledgers', '--v3', '--rev', '--audit', '--flip8i'];
const HIPS = { v1: HIP_STOPS_V1, v2: HIP_STOPS_V2 } as const;
const JOINTS = { v4: JOINT_RANGE_V4 } as const;
const hipsArg = process.argv.find((a) => a.startsWith('--hips='))?.slice('--hips='.length);
if (hipsArg !== undefined && !(hipsArg in HIPS)) throw new Error(`--hips=${hipsArg}: expected v1 or v2`);
const jointsArg = process.argv.find((a) => a.startsWith('--joints='))?.slice('--joints='.length);
if (jointsArg !== undefined && !(jointsArg in JOINTS)) throw new Error(`--joints=${jointsArg}: expected v4`);
const args = process.argv.slice(2).filter((a) => !FLAGS.includes(a) && !a.startsWith('--hips=') && !a.startsWith('--joints='));
const [id, tickArg, outArg] = args;
const tick = Number(tickArg);
if (!id || !Number.isInteger(tick) || tick < 1) throw new Error('usage: capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit] [--hips=v1|v2] [--flip8i] [--joints=v4]');
SIM_DEFAULTS.ledgers = process.argv.includes('--ledgers');
const v3 = process.argv.includes('--v3');
const audit = process.argv.includes('--audit');
const rev = process.argv.includes('--rev');
const flip = process.argv.includes('--flip8i');
const opts = { ...(audit ? { transitionAudit: true } : {}), ...(rev ? { reverseOrder: true } : {}) };
const joints = jointsArg ? JOINTS[jointsArg as keyof typeof JOINTS] : undefined;
if (joints && !FIX(id).jointRange) throw new Error(`${id} has no joint range profile for --joints`);
const base = { ...(v3 ? { ...FIX(id), legGuard: LEG_GUARD_V3 } : FIX(id)), ...(joints ? { jointRange: joints } : {}) };
const hips = hipsArg ? HIPS[hipsArg as keyof typeof HIPS] : undefined;
if ((hips || flip) && !base.ragdoll) throw new Error(`${id} has no ragdoll profile for --hips or --flip8i`);
if (hips && flip) throw new Error('--hips and --flip8i: one ragdoll variant at a time');
const def = hips ? { ...base, ragdoll: withHipStops(base.ragdoll!, hips) } : flip ? flip8i(base) : base;
const suffix = [v3 && 'v3', joints && `jr${jointsArg}`, hips && `hips${hipsArg}`, flip && 'flip8i', rev && 'rev', audit && 'audit'].filter(Boolean).join('-');
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
console.log(`${out}: ${id}${v3 ? ' (V3)' : ''}${joints ? ` (${joints.id})` : ''}${hips ? ` (${hips.id})` : ''}${flip ? ' (8i flip)' : ''}${rev ? ' (reversed)' : ''}${audit ? ' (audit)' : ''} tick ${tick} (t ${(tick * def.solver.outerTickS).toFixed(3)} s), ${(statSync(out).size / 1024).toFixed(0)} KB; resumed run ${same ? 'identical' : 'DIFFERS'} to the end`);
if (!same) process.exit(1);
