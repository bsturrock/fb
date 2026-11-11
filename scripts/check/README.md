# Full check

The repeatable check every rung of the contact-motion prerequisites ladder
(`docs/open/contact-motion/prerequisites-ladder.md`) is judged by. It runs the current tree and writes one result
directory; `compare.ts` diffs two of them.

## Run

```sh
npx vite-node scripts/check/full-check.ts <result dir>
npx vite-node scripts/check/compare.ts <before dir> <after dir>
```

Ladder results live outside git in the main checkout: `.scratch/ladder/<rung>/` (for example
`.scratch/ladder/r0-baseline`). A result directory is about 1 MB.

Order and load: typecheck, build, then the test suite **alone** (nothing else running, so no timeout is induced by the
check itself), then the fixture export and the matrices as shards in a bounded pool (`CHECK_JOBS`, default 6 on the
8-core machine; these runs have no timeouts and their results do not depend on load). Other heavy processes on the
machine during the suite still matter: run the check on an otherwise idle machine.

Environment: `CHECK_JOBS=<n>` pool size; `CHECK_SKIP=suite,legmx,...` skips parts (typecheck, build, suite, fixtures,
legmx, l4mx, energymx), recorded as skipped, for a quick look only (a rung is judged on a full run).

## Outputs

Compared files (deterministic: stable order, no timestamps):

| File | What |
| --- | --- |
| `status.json` | typecheck (ok, error count), build ok, suite exit code, fixture count, fixtures that threw, whether the export equals the tree's committed `evidence/summary.json`, matrix row counts, failed shards |
| `suite.json` | test counts; every failing test (and every file that failed outside a test) with its file, full name, kind (`TIMEOUT` when the first line says it timed out, else `REAL`), first message line and the message up to its stack |
| `summary.json` | the fixture export of every registered fixture: byte for byte what `npm run fixtures` writes to `evidence/summary.json` (run in shards through `scripts/fixture-runner.ts` and merged in registry order) |
| `traces.sha256` | sha256 of every fixture's trace file the export writes (`evidence/traces/<id>.json`; the traces themselves are not kept) |
| `legmx.jsonl` | leg matrix (`legmx.ts`): every fixture with a leg-guard profile, both body orders. Per row: fixture, order, leg-guard id, result; per player: conversion time, end mode, largest one-substep player-player contact impulse on the player and on its leg colliders (thigh, shin, shoe) with when, and the leg ledger (largest one-substep leg impulse and when, ungrounded impulse substeps, totals), `"absent"` on a tree without one |
| `l4mx.jsonl` | L4 matrix (`l4mx.ts`): every fixture with a fall-response profile, both body orders. Per player: conversion time, end mode and every scalar of its fall-response stats (`peakPositiveW` the peak audited power, `overPowerSubsteps` / `overWork` the ceiling breaches, `heldSubsteps` / `heldBodySubsteps` the impact guard, ...) |
| `energymx.jsonl` | passive-energy matrix (`energymx.ts`, `tests/passive-energy.ts`): every L3, L4 and HC fixture with a ragdoll profile, both body orders. Per player whose ragdoll ran: its solves; the solves no other player touches (no contact impulse, solved or raw, with one) that gain more than `INJECTION_J` (0.5 J) of kinetic plus potential energy beyond the work of every applied force and torque (drives, envelope, response), as `injecting` and their total `injectedJ`; the largest such gain `maxJ`, its solve `maxStep`, time `maxAt` and the segments touching static ground and one of the ragdoll's own shapes there (`maxPinch`, the self-trunk pinch); the largest gain of a solve with no contact at all (`quietMaxJ`, read to 0.01 J: gravity's integration reads under 0; a gain there is a segment moved off its velocity's path, mostly CCD holding it back before its first contact); every injecting solve as `[solve, J, pinch segments, largest loss of the tick before, 1 if any contact impulse else 0]` (`over`: a rebound follows an impact). `status.json` carries the headline per family (runs, runs and solves injecting, total J, largest) |
| `queries.jsonl` | shape-query budget (the leg matrix's runs, so every L3, L4 and HC fixture in both orders): the most Rapier shape queries in one tick (`worstTickQueries`, counted as plan 13a's budget test counts them) and when (`at`) |

Not compared: `meta.json` (commit, dirty file count, timings, pool size) and `logs/` (each step's output, the raw
vitest JSON report).

The matrices run each fixture with default options (ledgers off, as `npm run fixtures`) and `reverseOrder` for the
second order. They read later features defensively: a column whose feature the tree does not have is reported absent,
never a crash. `ONLY=<regex>` limits any matrix to some fixtures and `LEGV2=1` runs the leg matrix under
`LEG_GUARD_V2` (a tree that has it) when run by hand:
`ONLY='^L4-F10' npx vite-node scripts/check/legmx.ts 0 1 /path/out.jsonl`.

## Compare

`compare.ts` prints which compared files are byte-identical, then:

- typecheck and build status;
- suite failures matched by message (kind + first line), not by name: added (hard), changed message (same test, new
  first line), removed, and same message with different detail;
- fixture summaries and trace hashes changed per family (G, L1, L2, RH, L3, L4, HC), an explicit
  `G/L1/L2/RH byte-identical: PASS|FAIL` line (hard), and every result or end-representation change (who falls)
  listed per fixture;
- per matrix: rows that vanished or are new, new over-ceiling entries (a field named `over*` that rises), result,
  conversion-time and mode changes, peaks that rise (fields named `peak*`, `injJ`, `depth`), columns one side reports
  absent, and a count of rows that changed otherwise.
- shape queries: the rows whose worst tick is at or over the 4000-query budget (`SHAPE_QUERY_BUDGET`), those new
  against A, and the rows whose worst tick rises.
- passive energy (informational): per family the total injected energy, injecting solves and runs and the largest gain
  in A and B; the runs injecting in B that did not in A, and the runs whose largest gain rose (over the threshold).

It exits 1 only on the hard invariants: a new suite failure or a changed G/L1/L2/RH summary or trace. Everything else is
for judgement under the ladder's rules. `COMPARE_MAX=<n>` lists more than 60 lines per section.

Determinism: two full checks of the same tree compare with every file byte-identical.

Seeded regression tests: a test that must start from a fixed state of a fixture run (ladder rule 7) resumes a full-state
capture from `tests/data/state/` (`tests/state.ts`); how to capture one and when it must be regenerated:
`tests/README.md`.
