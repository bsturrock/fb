# Plan 10 handoff — codebase review milestones

Implementation evidence for the [codebase review milestones](../open/10_Codebase_Review_Milestones.md), one section per milestone. Each milestone is its own commit on `model-integration`, after the checkpoint commit `02eba2a` (plans 08, 08a and 09 as they stood).

## User decisions (2026-11-08)

The user took every recommended option:

| ID | Ruling |
| --- | --- |
| U1 | One combined checkpoint commit of 08 + 08a + 09 (`02eba2a`), then one commit per milestone once its gate is green |
| U2 | No `trialEnd` on out-of-bounds stops; export a separate `stop` record instead |
| U3 | Coached-controller phase fix opt-in on L3 and later; committed summaries unchanged |
| U4 | Hold priority: grasp-first allocation within the shared owner budget |
| U5 | Drop `L4-F12-carryLeft`; derive the protect arm from the actual carry |
| U6 | Ground is the floor only |
| U7 | Natural-contact articulation is required in both player orders: trace and fix the candidate; if that needs loosened validation, stop and report before declaring a limit |
| U8 | Rules fixes only under a new rules profile opted in on L3/L4 |
| U9 | The stance request through the settle window only under the new rules profile |
| U10 | Archive unreferenced probes outside typecheck |
| U11 | No Git LFS |

## 10a — Test gate and evidence integrity

**Result:** three consecutive full runs exit 0 with no unhandled error (one alongside `npm run fixtures`); 18 files, 687 tests. All 411 summaries are byte-identical to `02eba2a` (`evidence/summary.json` unchanged) and every trace row is identical. Export differences are limited to the A3, A4, A7 and A8 fields listed below. Typecheck and build pass.

### Wall time (A1)

| Run | Files | Tests | Wall | Exit |
| --- | --- | --- | --- | --- |
| Before (`02eba2a`) | 14 | 675 | 282 s (`transitions.test.ts` alone 281 s) | 0 this time; 1 on 2026-11-08 (intermittent) |
| After, run 1 | 18 | 687 | 150 s | 0 |
| After, run 2, beside `npm run fixtures` | 18 | 687 | 144 s | 0 |
| After, run 3 | 18 | 687 | 131 s | 0 |

The longest file is now `handoff-contact.test.ts` (112 s); the four transition files take 59–95 s each.

### What changed

- **A1, test gate.** `tests/helpers.ts` has `pace()`, a wall-time based macrotask yield (`setImmediate` every 50 ms of synchronous work), and `runSim`/`stepWhile`, which step a simulation and pace between ticks. `run()` uses them. Every private run loop in the test files (`runToEnd()`, `while (...) stepTick()`, driver loops) now goes through them or awaits `pace()` per tick. The yield is wall-time based, so it never changes what a run computes. `tests/transitions.test.ts` is split by `describe` into `transitions-modes`, `transitions-contact`, `transitions-audit` and `transitions-feet`, with the shared helpers in `tests/transitions-shared.ts`; the 337 tests are unchanged. `sharedRuns()` is available for files that want to share read-only runs. No RPC timeout was raised and no unhandled error is ignored.
- **A2, fixture runner.** `scripts/fixture-runner.ts` holds the runner; `scripts/run-fixtures.ts` calls it. With a filter it writes `evidence/summary.filtered.json` (git-ignored) and never touches `evidence/summary.json`. It asserts that fixture ids are unique, disposes each simulation in `finally`, and if any fixture throws it writes no summary and exits 1.
- **A3, carry export.** `profiles.carry = def.carry`. Every non-null id in `profileIds` now has a `profiles` entry with that id, for all 411 fixtures (119 carry).
- **A4, one id per value set.** `RULES_FOOTBALL` names every non-default option in its id (`+fwd=0,0,-1`, `+sideline=off`, `+progress=off`, ...). Spread variants use `ruleVariant(base, label, patch)`, which appends `+label`: `+ballSource=carryPalm` (L1), `+ballSource=carryPose` (L3), `+mirror` (HC mirror). The two ragdoll variants are `+energyGain=0` (`HC-F5-strictTransfer`) and `+energyGainFraction=0.01` (`L4-F9-transferFailed`). Before the fix, two rules ids each stood for five and six different value sets, and two ragdoll ids for two each.
- **A5, reset.** `clearTickScratch()` clears the per-tick contact classes; `stepTick` and `reset()` both call it, so trace row 0 after a reset equals a fresh row 0. No other runtime field leaked: every other field is reset in `reset()` or rebuilt by `build()`. The reset-cycle tests in gates 1–4 and plan 08 compare every field of every trace row (`traceRowsDiff`), not only position, velocity and yaw.
- **A6, numerical failure.** The health check runs right after the solve (`numericallyHealthy()`); on a non-finite body it sets the result and the stop record, emits `numericalFailure` once, and returns, so envelope audits, arms, balance, pose and rules never run on that state, and the tick stops.
- **A7, event stamps.** `Simulation.stampTick` is the trace row being built: `tick + 1` inside `stepTick`, `tick` outside it. Events, arm ledgers (`ArmHost.tick`) and rule frames use it, so `event.tick` equals the `tick` of the row that carries its state. The global substep counter is renamed `step` on events, rule frames, `RuleEnding` and the event data that carried it (`influenceBegin`, `influenceCleared`, `ruleEnding`, `lossOfSupport`). Controllers still receive the completed-tick count. Tests that joined by tick were updated (`gate3` loss tick; `gate4` clamp counts entering the conversion tick read the previous row; the post-ending drive filter). The lab and the two probes that read `substep` (`p07-stop`, `p09-over`) read `step`.
- **A8, stops.** `result` keeps its labels. The export has a new `stop` record: `reason` (`ruleEnding`, `practiceOutOfBounds`, `duration`, `numericalFailure`), the `result`, tick and time, the ending kind or the player, and `flags` (`invalidTransfer`, `invalidHandoff`): the conditions `result` folds in. Per U2, out-of-bounds stops still emit no `trialEnd`, so no event count changes.
- **A9, lifecycle.** `PhysicsWorld.dispose()` (and so `Simulation.dispose()`) is idempotent. `FixedStepDriver` keeps the sub-tick remainder when a frame overflows (at most one tick), validates `tickS`, `maxTicksPerFrame` and speed (`setSpeed`, which the lab now uses), and runs no ticks for non-finite or negative frames. Gate 1–3 tests create simulations through the tracked `create()` helper and dispose them after each test; `tests/setup.ts` disposes anything a file left alive.
- **A10, vacuous loops.** `nonEmpty(xs, what)` asserts at least one item before per-item expectations. Applied to 20 loops and `.every` checks over filtered or derived lists in the gate 1–4 tests; all of them have items.
- **A11, registry.** `allFixtures()` builds once per process, deep-freezes the definitions and returns a new array each call (under 1 ms against about 230 ms). No caller mutated a definition.
- **A12, engine version.** The export's engine version is `RAPIER.version()` at runtime (`0.21.0`).

### Regressions (`tests/harness.test.ts`), each shown failing with its fault restored

| Fault put back | Failing check |
| --- | --- |
| A2: filtered run writes `summary.json` | sentinel `summary.json` changes |
| A3: no `profiles.carry` | `L3-F1-phase0: profiles.carry` undefined |
| A4: `carryPose` variant keeps the base id | 26 id clashes |
| A5: reset keeps the tick scratch | `G1-F2-legacy` row 0 differs from a fresh row 0 |
| A6: substep continues after the NaN | events follow `numericalFailure` |
| A7: events stamped with completed ticks | an event at 0.475 s outside its row (0.4667 s) |
| A9: dispose not idempotent | second `dispose()` throws |
| A9: driver drops the remainder | alpha 0 instead of 0.5 |
| A11: registry rebuilt per call | 230 ms per call |

A8 adds a field, so its test fails without it by construction.

### Export differences against `02eba2a` (all 411 fixtures)

| Field | Fixtures |
| --- | --- |
| `stop` (new) | 411 |
| event `substep` renamed `step` (and in event data) | 411 (data: 101) |
| event `tick` (+1 inside a tick) | 376 |
| `profiles.carry` (new) | 119 |
| `profileIds.rule`, `profiles.rule.id` | 59 |
| `ruleEnding.tick` (+1), `substep` renamed `step` | 54 |
| `ruleEnding.profile` and event data `profile` (derived rules id) | 47–49 |
| `profileIds.ragdoll`, `profiles.ragdoll.id` | 2 |

No summary, trace row or other export field changed.
