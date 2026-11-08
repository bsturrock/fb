# 10a — Test gate and evidence integrity

Repository-aligned plan • 2026-11-08 • Not started. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first.

**Goal:** a test run that exits 0 when every test passes, a fixture runner that cannot damage committed evidence, exports that fully identify their profiles, and a reset that leaves nothing behind. No summary value should change; exports, trace row 0 after a reset and event tick numbers will.

## A1. The test gate exits 1 when every test passes (P1, Checked)

**Problem:** on 2026-11-08, `vitest run` reported 14 files and 675 tests passed, 1 unhandled error, exit 1. The error is `[vitest-worker]: Timeout calling "onTaskUpdate"`. Simulation runs loop synchronously; awaits on already-resolved promises yield only microtasks, so the worker cannot answer the main process's RPC. The plan 09 handoff records the same error intermittently and a later run that exited 0; that result is not reliable.

**Evidence:** file durations: `transitions.test.ts` 285 s (337 tests, one macrotask yield), `handoff-contact.test.ts` 122 s, `falls.test.ts` 67 s, `ball-carry.test.ts` 63 s, `gate4.test.ts` 59 s, `footwork.test.ts` 58 s. `falls.test.ts` and `handoff-contact.test.ts` already yield with a local `breathe()` between runs.

**Fix:**

- Make `run()` in `tests/helpers.ts` step in chunks and yield a macrotask (`await new Promise((r) => setImmediate(r))`) every N ticks. Route the test files' private run loops through it.
- Split `tests/transitions.test.ts` by `describe` block into several files.
- Within a file, share repeated fixture runs: memoize by fixture id and options, dispose in `afterAll`.

Do not raise vitest RPC timeouts or set `dangerouslyIgnoreUnhandledErrors`.

**Acceptance:** three consecutive full runs exit 0 with no unhandled error, one of them while `npm run fixtures` runs alongside. Report wall time before and after.

## A2. A filtered fixture run overwrites committed evidence (P2, Checked)

**Problem:** `scripts/run-fixtures.ts:21` writes `evidence/summary.json` unconditionally. `npm run fixtures L4` replaces the 411-entry file with 76 entries.

**Fix:** with a filter, write `evidence/summary.filtered.json` (ignored by git) or merge by `fixtureId` in registry order. Before running, assert fixture ids are unique. Dispose each simulation in `finally`, and exit non-zero if any fixture throws.

**Regression:** a filtered run leaves `evidence/summary.json` byte-identical.

## A3. Exports name the carry profile but omit its values (P2, Checked)

**Problem:** `exportFixture` puts `profileIds.carry = def.carry?.id` (`src/sim/simulation.ts:2359`) but its `profiles` block has no `carry` entry. 119 fixtures use a carry. This breaks the gate 4 rule that every export carries full profile values, and the 08a requirement to export the adopted identity and policy.

**Fix:** add `profiles.carry = def.carry`. While there, check that every other id in `profileIds` has its values in `profiles`.

**Regression:** for every fixture, each non-null key in `profileIds` has a `profiles` entry whose `id` matches.

## A4. One profile id stands for different values (P2, Reported)

**Problem:** `src/sim/fixtures/locomotion.ts:26` and `src/sim/fixtures/transitions.ts:27` spread `RULES_FOOTBALL` (`src/sim/profiles.ts:834-851`) with a new `ballSource` but keep its `id`. The review enumerated two rules ids and two ragdoll ids that each cover differing values. Evidence grouped by id cannot tell the variants apart, against the derived-id convention the `with*` helpers follow.

**Fix:** derive ids for spread variants, for example `${base.id}+ballSource=carryPose`, as `withBrakingLimit` does. Name the ragdoll case from the check below.

**Regression:** a harness test over `allFixtures()`: for every profile kind, equal ids mean deep-equal values. Summaries carry no profile ids, so only exports change.

## A5. Reset leaves per-tick scratch behind (P2, Checked)

**Problem:** `tickContactClasses` is cleared only at the start of `stepTick` (`src/sim/simulation.ts:827`). `reset()` (751–779) does not clear it, then records trace row 0, which copies it (2228). After a reset, `G1-F2-legacy` row 0 carries `{"D":["capsule>capsule"],"R":["capsule>capsule"]}` instead of empty lists.

The reset-cycle test (`tests/gate4.test.ts:826-862`) misses this because `traceDiff` (`tests/helpers.ts`) compares only position, velocity and yaw.

**Fix:** one `clearTickScratch()` called by both `reset()` and `stepTick`. Audit the other per-tick fields for the same leak.

**Regression:** extend `traceDiff` to every trace field (or compare serialized rows), and use it in the reset-cycle tests.

## A6. A numerical failure still runs the rest of the substep (P3, Checked)

**Problem:** the NaN check at `src/sim/simulation.ts:1524-1532` sets `result`, emits `numericalFailure` and returns from `postStep` only. Arms, balance, pose and rules then run on the NaN state in the same substep.

**Fix:** return a flag, stop the substep and the tick, emit once.

**Regression:** a test-only injection of a non-finite velocity; assert that no pose update or rules event follows the failure.

## A7. Event tick is one behind its trace row (P3, Reported)

**Problem:** `emit` stamps `tick: this.tick` during the tick, before the increment; the trace row is recorded after it. A `contactBegin` stamped tick 55 at t 0.93333 matches trace row 56. `tests/gate4.test.ts:755` joins the trace by event tick and so reads the previous row. The event field `substep: this.steps` is a global substep counter, not an index within the tick.

**Fix:** stamp the tick being built so `event.tick` equals its row's `tick`, or document the convention and fix every join. Rename `substep` to `step`, or emit the index within the tick. Update the tests, the lab and handoff-cited probes that read these fields.

## A8. Stop reasons are relabelled (P3, Checked; decision U2)

**Problem:** `checkStop` (`src/sim/simulation.ts:1584-1597`) sets an out-of-bounds stop's result to `invalidTransfer` whenever a transfer failed earlier, which hides the out-of-bounds cause. Out-of-bounds stops emit `practiceOutOfBounds` but no `trialEnd`; 8 current traces end that way. The duration branch also folds in `invalidHandoff`. No current fixture hits the masked combination.

**Fix:** keep the `result` semantics, and export a separate `stop: { reason, flags }`. Adding a `trialEnd` event to out-of-bounds stops would change the `events` count in their summaries, so do that only on the user's ruling (U2).

## A9. Resource lifecycle (P3)

- **`physics.dispose()` is not idempotent (Checked):** `src/sim/physics.ts:109-114` calls `world.free()`, which throws on a second call. Add a `disposed` guard and drop the references.
- **The fixed-step driver drops time (Reported):** in `src/sim/driver.ts`, when `maxTicksPerFrame` overflows, the whole accumulator is discarded rather than clamped. Speed and dt are not validated. Clamp the remainder to one tick; reject negative or non-finite speed and dt.
- **Gate tests leak worlds (Reported):** gate 1–3 tests create simulations without `dispose()`, so Rapier WASM memory grows in the worker. Dispose through the shared helper or `afterEach`.

## A10. Vacuous loops in gate tests (P3, Reported)

`tests/gate4.test.ts:407` can pass with zero matching items. Assert a non-zero count before the per-item expectations. Sweep the gate tests for `for (...) expect(...)` over filtered lists without a length assertion. The fall-test cases are in [10c C8](10c_Active_Fall_Contract_Repairs.md#c8-fall-tests-that-do-not-establish-their-claims-p3-reported).

## A11. `allFixtures()` is rebuilt on every call (Polish, Reported)

It costs about 213 ms per call and is called repeatedly by tests and scripts. Memoize it; return frozen definitions or fresh clones, since tests spread and alter them.

## A12. `RAPIER_VERSION` is hard-coded (Polish, Reported)

`src/sim/physics.ts` hard-codes it; `RAPIER.version()` returns `0.21.0` at runtime. Export the runtime value.

## Acceptance

- A1's three clean runs.
- All 411 summaries unchanged (A8's `trialEnd` only by ruling).
- Export diffs limited to A3/A4/A7/A8 fields.
- A regression for each fix that fails with the fault restored.
