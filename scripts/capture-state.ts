// Full-state capture of a registered fixture at a tick boundary (tests/state.ts), for a test to resume from:
//   npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit] [--hips=v1|v2] [--flip8i] [--joints=v4] [--brace=v1] [--wrap=v6|v7|v8|v9|v10|v11]
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
// JOINT_RANGE_V4 } }`. `--brace=v1`: the fixture as before the M2 lean flip (tests/runs.ts `preBraceV2`, its carrier's brace
// CARRIER_BRACE_V1), suffix `bracev1`; a test resumes it with `{ def: asCaptured(cap) }`. `--wrap=v7`: the fixture's
// defender under WRAP_V7 (polish 1.2, the ride-down; registered on L3, L4 and HC since its flip), suffix `wrapv7`; a test resumes
// it with `{ def: asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V7 })) }`; `--wrap=v8` (WRAP_V8, the bound-legs fall,
// registered on L3, L4 and HC from its flip to the hold flip's WRAP_V9) and `--wrap=v6` (tests/runs.ts WRAP_V6_PRE_V10, the low strike on it: the lab's `wrap=v6` until the drag-down put it on WRAP_V10; a test resumes such a capture under today's WRAP_V6 as a `wrap` variant, the two running alike until the tackler's drive), the same way (suffix `wrapv8`, `wrapv6`); `--wrap=v9` (WRAP_V9, the fall
// link, registered on L3, L4 and HC from the hold flip to the behind flip's WRAP_V10), suffix `wrapv9`; `--wrap=v10`
// (WRAP_V10, the drive from behind on WRAP_V9, registered on L3, L4 and HC from the behind flip to the stay-on flip's
// WRAP_V11), suffix `wrapv10`; `--wrap=v11` (WRAP_V11, staying on from behind on WRAP_V10, registered since the stay-on
// flip), suffix `wrapv11`. See tests/README.md.
import { statSync } from 'node:fs';
import { WRAP_V10, WRAP_V11, WRAP_V7, WRAP_V8, WRAP_V9 } from '../src/sim/controllers/wrap';
import { HIP_STOPS_V1, HIP_STOPS_V2, JOINT_RANGE_V4, LEG_GUARD_V3, withHipStops } from '../src/sim/profiles';
import { SIM_DEFAULTS, Simulation } from '../src/sim/simulation';
import { FIX, flip8i, preBraceV2, WRAP_V6_PRE_V10 } from '../tests/runs';
import { captureState, loadState, resumeState, saveState } from '../tests/state';

const FLAGS = ['--ledgers', '--v3', '--rev', '--audit', '--flip8i'];
const HIPS = { v1: HIP_STOPS_V1, v2: HIP_STOPS_V2 } as const;
const JOINTS = { v4: JOINT_RANGE_V4 } as const;
const hipsArg = process.argv.find((a) => a.startsWith('--hips='))?.slice('--hips='.length);
if (hipsArg !== undefined && !(hipsArg in HIPS)) throw new Error(`--hips=${hipsArg}: expected v1 or v2`);
const jointsArg = process.argv.find((a) => a.startsWith('--joints='))?.slice('--joints='.length);
if (jointsArg !== undefined && !(jointsArg in JOINTS)) throw new Error(`--joints=${jointsArg}: expected v4`);
const braceArg = process.argv.find((a) => a.startsWith('--brace='))?.slice('--brace='.length);
if (braceArg !== undefined && braceArg !== 'v1') throw new Error(`--brace=${braceArg}: expected v1`);
const wrapArg = process.argv.find((a) => a.startsWith('--wrap='))?.slice('--wrap='.length);
const WRAPS = { v6: WRAP_V6_PRE_V10, v7: WRAP_V7, v8: WRAP_V8, v9: WRAP_V9, v10: WRAP_V10, v11: WRAP_V11 } as const;
if (wrapArg !== undefined && !(wrapArg in WRAPS)) throw new Error(`--wrap=${wrapArg}: expected v6, v7, v8, v9, v10 or v11`);
const wrap = wrapArg ? WRAPS[wrapArg as keyof typeof WRAPS] : undefined;
const args = process.argv.slice(2).filter((a) => !FLAGS.includes(a) && !a.startsWith('--hips=') && !a.startsWith('--joints=') && !a.startsWith('--brace=') && !a.startsWith('--wrap='));
const [id, tickArg, outArg] = args;
const tick = Number(tickArg);
if (!id || !Number.isInteger(tick) || tick < 1) throw new Error('usage: capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit] [--hips=v1|v2] [--flip8i] [--joints=v4] [--brace=v1] [--wrap=v6|v7|v8|v9|v10|v11]');
SIM_DEFAULTS.ledgers = process.argv.includes('--ledgers');
const v3 = process.argv.includes('--v3');
const audit = process.argv.includes('--audit');
const rev = process.argv.includes('--rev');
const flip = process.argv.includes('--flip8i');
const opts = { ...(audit ? { transitionAudit: true } : {}), ...(rev ? { reverseOrder: true } : {}) };
const joints = jointsArg ? JOINTS[jointsArg as keyof typeof JOINTS] : undefined;
if (joints && !FIX(id).jointRange) throw new Error(`${id} has no joint range profile for --joints`);
const fix = braceArg ? preBraceV2(FIX(id)) : FIX(id);
if (braceArg && fix.brace?.id === FIX(id).brace?.id) throw new Error(`${id} has no CARRIER_BRACE_V2 for --brace=v1`);
const base = { ...(v3 ? { ...fix, legGuard: LEG_GUARD_V3 } : fix), ...(joints ? { jointRange: joints } : {}), ...(wrap ? { wrap } : {}) };
const hips = hipsArg ? HIPS[hipsArg as keyof typeof HIPS] : undefined;
if ((hips || flip) && !base.ragdoll) throw new Error(`${id} has no ragdoll profile for --hips or --flip8i`);
if (hips && flip) throw new Error('--hips and --flip8i: one ragdoll variant at a time');
const def = hips ? { ...base, ragdoll: withHipStops(base.ragdoll!, hips) } : flip ? flip8i(base) : base;
const suffix = [wrapArg && `wrap${wrapArg}`, braceArg && 'bracev1', v3 && 'v3', joints && `jr${jointsArg}`, hips && `hips${hipsArg}`, flip && 'flip8i', rev && 'rev', audit && 'audit'].filter(Boolean).join('-');
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
console.log(`${out}: ${id}${v3 ? ' (V3)' : ''}${joints ? ` (${joints.id})` : ''}${hips ? ` (${hips.id})` : ''}${flip ? ' (8i flip)' : ''}${braceArg ? ' (brace V1)' : ''}${wrapArg ? ` (WRAP_${wrapArg.toUpperCase()})` : ''}${rev ? ' (reversed)' : ''}${audit ? ' (audit)' : ''} tick ${tick} (t ${(tick * def.solver.outerTickS).toFixed(3)} s), ${(statSync(out).size / 1024).toFixed(0)} KB; resumed run ${same ? 'identical' : 'DIFFERS'} to the end`);
if (!same) process.exit(1);
