# 13b — Test consolidation

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). Follows 13a. **Implemented** 2026-11-09 ([handoff](../handoff/plan13.md#13b--test-consolidation)): 226 tests in 13 files, every baseline test mapped. Changes tests only: no source file under `src/` changes, and every export stays byte-identical.

**Goal:** the suite checks the same contracts with about a third as many tests, and its count no longer grows with every fixture added.

## Why

The user (2026-11-09): approaching 1,000 tests is too many.

**Baseline** at `588d63b` (vitest JSON report, M2): **845 tests in 24 files, all pass, 281 s wall time**, 1,679 s of test time across workers.

| File | Tests | Test time (s) | Of which one per fixture |
| --- | --- | --- | --- |
| transitions-audit | 107 | 280 | 97: "transition-only pose discontinuity at most 1 cm …" per L3 fixture |
| foot-continuity | 102 | 203 | 97: "step targets within the acceleration limit …" per L3 fixture |
| transitions-feet | 99 | 166 | 97: "vertical target and offset recovery stay inside their limits …" per L3 fixture |
| transitions-modes | 93 | 106 | 63: four stop and brake contracts, each per fixture |
| falls | 84 | 140 | about 20 |
| footwork | 60 | 45 | about 8 |
| gate4 | 49 | 70 | about 10 |
| transitions-contact | 41 | 162 | 27: five contact contracts, each per fixture |
| handoff-contact | 22 | 224 | few |
| 15 other files | 188 | 283 | few |

- **503 of the 845 tests** carry a fixture id in their own title: the same check, copied once per fixture by the `each()` helper (tests/transitions-shared.ts) or a `for … it(…)` loop.
- **The same 97 L3 fixtures are simulated three times**, once each by the audit, continuity and foot-limit files, for 650 of the 1,679 test-seconds. The audit already proves it does not change the run ("the audit reads copies"), so one run can serve all three.
- Why one test per fixture: plan 10a (A1) found that a long synchronous loop starved vitest's worker messages and the run exited 1. The `each()` helper split the loops into tests to yield between fixtures. Yielding inside one test does the same.

## Rules for the consolidation

- **No contract is lost.** Every assertion of the baseline suite is still made, on the same fixtures, with the same limits, tolerances and known-case lists (`KNOWN_AUDIT` and the like). No threshold changes.
- **One test per contract, not per fixture.** A per-fixture contract becomes one test that checks every fixture and fails with the full list: each failing fixture, player, time and measured value, not only the first. One red run shows the whole picture.
- **Negative controls stay separate.** Every "fault put back" or "twin" test (a debug switch or a profile removed, the check shown to fail) stays its own test, because it proves its check bites.
- **Shared runs.** A fixture is simulated once per file for every contract that reads it, with all observers attached in one run.
- **Yield between fixtures** inside a shared run (`await new Promise((r) => setTimeout(r))`), so the A1 starvation cannot return. The suite must exit 0 with no unhandled errors, as 10a requires.
- **A map, not a promise.** The handoff carries a table from every baseline test title to the test that now holds its assertion. It is generated from the two vitest JSON reports and a mapping file, and the generator fails on any baseline title left unmapped.
- **New work follows the pattern.** A later per-fixture contract is added as a check in the shared contract pass, never as a generated test. `each()` is deleted.

## Design

**Per-fixture L3 contracts: one file, one run per fixture.** `tests/l3-contracts.test.ts` replaces the per-fixture parts of transitions-audit, foot-continuity, transitions-feet, transitions-modes and transitions-contact:
- A `Contract` is `{ name; fixtures: RegExp; observe?(sim, substep): void; finish(sim, def): Failure[] }`, where `Failure` is `{ fixture; player?; t?; detail }`.
- `beforeAll` runs every L3 fixture once with `transitionAudit: true` and every contract's observer, yielding between fixtures, and stores each contract's failures.
- One `it` per contract: `expect(failures[name]).toEqual([])`. The current per-fixture tests become 9 contracts: the transition audit; foot-target continuity; foot limits; never long off the ground; brake phases valid; a full stop settles; a stop lands one foot then the other; contact entry keeps its anchors; a mode's labelled conversion or loss of probe support is an audited fall.
- The scenario tests in those files (named reproductions, the audit's own self-tests, negative controls) stay as they are, moved into `tests/transitions.test.ts` (modes and contact) and `tests/l3-contracts.test.ts` (audit, continuity and foot-limit self-tests).

**Small loops become tables.** The `for (const id of […]) it(…)` loops in falls, gate4, footwork and handoff-contact become one test each that checks every row and lists every failing row.

**Files merged** (24 to 13):

| New file | From |
| --- | --- |
| harness | harness, debug-options, lab-render |
| gates | gate1, gate2, gate3 |
| gate4 | gate4, rules-revision (the referee and completion rules live here) |
| model | model |
| locomotion (L1) | locomotion |
| ride-height (RH) | ride-height |
| footwork (L2) | footwork |
| handoff-contact (HC) | handoff-contact |
| l3-contracts | the per-fixture parts of transitions-audit, foot-continuity, transitions-feet, transitions-modes, transitions-contact |
| transitions (L3) | the scenario parts of those five files |
| ball-carry | ball-carry, ball-carry-mesh, ball-carry-evidence |
| falls (L4) | falls |
| body-limits | self-clearance, joint-range |

**Duplicate checks merged.** Several files repeat the same kind of check for their own plan. Each becomes one table-driven test:
- "Only Lx fixtures carry the profile; earlier ids keep their paths" (plans 08, 09, 10e, 11, 12): one opt-in table in `harness`.
- "Exports report the profile ids and values" (plans 08a, 09, 10a, 11, 12): one export table in `harness`.
- "20 resets: the same run" and "same result over render rates and pause" (gate files, falls): one table over the fixtures each covered.

## Tasks

- [x] **Inventory.** Save the baseline vitest JSON report. Write `scripts/probe/p13-test-map.ts`: it reads a baseline report, a new report and `tests/test-map.json` (baseline title → new title), and fails on an unmapped or unknown title.
- [x] **Contract pass.** Write `tests/l3-contracts.test.ts` with the `Contract` runner and move the transition-audit contract first. Show it fails with the `KNOWN_AUDIT` entry removed, listing that boundary. Then move continuity, foot limits, and the modes and contact contracts, one commit-sized step each, deleting the generated tests as each lands.
- [x] **Scenario tests.** Move the remaining tests of the five L3 files into `tests/transitions.test.ts` and the contract file; delete the five old files and `each()`.
- [x] **Tables.** Convert the small loops in falls, gate4, footwork and handoff-contact.
- [x] **Merge files** as in the table; merge the duplicate opt-in, export and reset checks.
- [x] **Map.** Fill `tests/test-map.json`; the map script passes.
- [x] **Negative check.** Put back three recorded faults through their existing debug switches or profile removals (the 10b crossing heading, plan 11 without self-clearance, plan 12 without joint range): the consolidated suite fails on each, naming the fixtures.
- [x] **Close.** Suite exit 0 with no unhandled errors, typecheck, build; all exports byte-identical (no `src/` change). Handoff section with the counts, the wall time and the map.

## Acceptance

- **Count.** At most 300 tests in at most 13 test files.
- **Time.** Suite wall time at most half of what the 13a tip takes before 13b, on the same machine.
- **Coverage.** The map script passes: every baseline title maps to a test that exists. The three faults put back each fail the suite.
- **Stability.** `vitest run` exits 0 with no unhandled errors, three runs in a row.
- **No source change.** `git diff --stat` for 13b touches only `tests/`, `scripts/probe/` and docs; exports byte-identical.

## Known limits

- A contract test fails as one test for many fixtures, so the vitest summary shows fewer red lines; the failure message carries the list. To iterate on one fixture, the contract runner takes `L3_CONTRACTS=<regex>` from the environment to narrow its fixtures; a run filtered that way says so in its test name.
