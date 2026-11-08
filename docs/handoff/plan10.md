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

## 10b — Foot target continuity

**Result:** full suite exit 0, no unhandled error: 19 files, 795 tests, 176 s wall. Typecheck and build pass. The 238 committed summaries are unchanged: every non-L3/L4 summary is byte-identical to 10a. 74 of 97 L3 and 62 of 76 L4 summaries change (listed below). The L3 transition audit has 0 boundaries over 1 cm (2292 boundaries, largest 0.98 cm at `L3-F3-recover` R 0.671 s, then 0.92 cm at `L3-F7-phase75`; 10a had 2450, largest 0.89 cm. Boundaries over 1 cm before any reference correction: 50 at 10a, 6 now. The `requestJumpM` correction applies at 613 boundaries (10a 634); `stepStopM` applied at 165 and is gone), with the `stepStopM` reference correction gone (B1) and the `requestJumpM` correction kept (B3).

### What changed

- **B1, steps that stopped dead.** A composed step's path is replanned every substep over a horizon that never falls to one substep while the foot is moving: `boundedHorizon` lengthens the remaining time (never shortens it) until the minimum-jerk path to the destination stays within the step's acceleration limit, and a path with one substep left arrives only when that last substep is within the limit too (distance at most aMax·dt²/2, speed at most aMax·dt). Arrival is the same test as before (`lateS` armed or inside `arriveS`); `lateS` is no longer the only thing between a moving foot and a one-substep stop. At the speed cap the next path starts from the accepted motion and its acceleration (before, the cap zeroed it, so a capped foot could not slow below the cap: `L3-F16-runStop` R right ran 8 m/s past its destination at 3.35 s and was still swinging at the end). A continued clip step is timed with the time its acceleration limit needs (`√(10/√3 · L / aMax)`), so it lands on time on a free stop or start. Two consequences of no longer snapping, each with its own rule: the feet land one at a time, at least `landGapS` apart (`fitLanding`, the plan 08 stop contract), and a step out of time whose foot and target are settled within the plant tolerance lands where it is (before, the stop put it on a destination; without either, `L3-F4-twoArm` D, a leg held off by a tackler, chased a moving destination and planted nothing in contact; see Findings). The `stepStopM` reference correction in the transition audit stood in for the old dead stop; with the stop gone it is removed at its source (`continueOwners` compares the old path as it is).
- **B2, stale vertical rate.** Every composed step stores the published vertical rate, `(y − prev.y) / dt`, whatever set the height; its vertical acceleration is the path's own where a path set it (0 at the lift cap), else the change of the published rate. A chase's vertical path starts from that motion and stays within the declared lift acceleration (`endRateY`: the mean over the last substep, not its end rate).
- **B3, leg-request jump at contact.** The source was the sampled clip's travel heading, which took the travel direction in one substep, so a collision that turned the travel turned the leg request with it: up to 4.45 cm second difference in `L3-F8-recontact` (D2 left, 0.829 s), 116 substeps over 1 cm across L3. The heading now follows the travel direction, critically damped at the foot planner's own follow rate (`headingRadPerS = 18`, in the run-clip profile id). A composed heading at the clearance crossing takes the body heading the same way. The audit's `requestJumpM` correction stays, as the plan says.
- **B4, walk ramp.** `advanceLocoMode` now runs before `rampWalkRequest`, so the ramp reads this substep's mode. Plan 08's bypass is for contact and the run only (the closeout says so); prep and exit now ramp.
- **B5, stance width.** `LOCOMOTION_L3.idle.halfWidthM` is the fitted stance's half width (the clip's width scaled to the body's legs); `idleWidthAddM(P, body, s)` takes what it adds outside the body's own `|hipLocal(body, s).x|` at use, so a stock body (hip 0.13 m) gets the fitted width as bew-v6 does. `HIP_HALF_WIDTH_M` is gone. `idleStanceFade(speed)` is the one fade, shared by `pose.ts` and `simulation.ts`.
- **B6, brace rate.** A clamped `braceW` zeroes `braceV`.
- **B7, coached phase (U3).** `phaseFirst` on the coached entry spec updates the phase from this decision's observations before aiming; `asL3` opts every L3 coached entry in. Gate 1 fixtures keep the old order, so their summaries are unchanged.
- **B8, tests.** The shifted-anchor control now shifts a real anchor (`anchorLocal` by 0.02 m) and an elbow stretch, and runs them through the retention check; `held()` measures the published pose's shoulder, elbow, wrist and palm landmarks; the `L3-F1` entry test asserts entries happened and were kept; audit purity compares full trace rows, events and per-substep snapshots of the feet, run playback, pose memory, locomotion state and walk request on a stated sample (the first fixture of each L3 family plus five chosen ones); the reseed gap is bounded by the contract (one substep at the speed cap horizontally, the lift cap vertically) instead of 0.1 m. `trialOf` now copies both feet and the stats (hardening: identical foot events across 173 L3/L4 fixtures with and without it), and `chase` refreshes `moveV`.
- **B9, intake.** `clip-intake` throws a `RunClipError` naming the missing walk when the manifest has none (or more than one). `idle-intake` asserts its assumption: the rest skeleton faces +Z within 1° (measured 0.81°) and both rest legs agree within 1 mm; `restLegM` is the mean of both legs. The record is unchanged.
- **B10, plan 08 handoff.** Corrections added in place (dated, linked here): the 597/599 against 600/600 count, the `stepStopM` description, "lands on arrival … no timer" (twice), the 20.89 m/s peak, and the shifted-anchor control.

### Declared limits

From the swing limits, not from output (`stepAccelLimits`, asserted in `tests/foot-continuity.test.ts`). A minimum-jerk path over time T peaks at speed (15/8)·D/T and acceleration (10/√3)·D/T², so its peak acceleration is 80/(15√3) = 3.079 × its peak speed / T:

| Limit | Derivation | Value |
| --- | --- | --- |
| `stepAccelMps2` | 3.079 × `maxSpeedMps` 3.5 / `minS` 0.2 | 53.89 m/s² |
| `stepAccelPerTravel` | 3.079 × `travelSpeedK` 2.5 / `minS` 0.2 | 38.49 m/s² per m/s of travel |
| `liftAccelMps2` | 3.079 × `maxLiftRateMps` 1.5 / (`minS` / 2) (a step rises, then descends) | 46.19 m/s² |
| `landGapS` | `minS` / 2 | 0.1 s |

The step's horizontal limit is `stepAccelMps2 + stepAccelPerTravel × travel speed`, the same form as the speed cap.

### Regressions, each shown failing with its fault restored

`tests/foot-continuity.test.ts` checks, at every substep of every L3 fixture: a step target's horizontal second difference within its acceleration limit; a step's stored vertical rate equal to the published one; a chase's vertical rate change within the lift acceleration; the clip's leg request second difference within 1 cm on a supported body at full clip weight. It also counts what it saw (over 30000 step substeps), and adds the reproductions and the timing check below.

| Fault put back | Failing check |
| --- | --- |
| B1: horizon not bounded (a stop in one substep) | 257 breaches in `L3-F3-side` |
| B1: acceleration zeroed at the speed cap | 8 stop tests (feet still swinging, short rest) |
| B1: no landing gap | 4 stop-landing tests (landings 0.04–0.06 s apart) |
| B1: settled out-of-time steps never land | `L3-F4-twoArm` contact stepping |
| B1: continued step timed without its acceleration term | `L3-F16-stop1.7` 9 substeps overdue (limit 2) |
| B2: stale stored vertical rate | 778 breaches in `L3-F1-phase6` |
| B2: chase replanned from the full mean rate | 5 `L3-F7` airborne tests |
| B3: clip heading snaps to the travel | leg request jump over 3 cm (the test runs it) |
| B3: composed heading snapped at the crossing | audit `L3-F7-loadRelease` raw 1.30 cm |
| B4: ramp reads last substep's mode | mode `free` instead of `prep` |
| B5: fixed 0.1125 m hip | stock-body stance 0.3546 m against 0.3196 m |
| B6: rate kept after the clamp | rate 4.0024 left after the clamp |
| B7: old order | the aim lags the phase exactly once (asserted) |
| B8: live pose memory read by the audit | purity: `L3-F1-phase0` row 1 `players.D.ft` |
| B8: held arm displaced on the pose side | the tamper runs exceed the tolerance |
| B9 | the tests run the bad inputs |

The reproductions: before 10b, `L3-F3-side` D left at 0.0583 s went from 20.51 m/s to 0 in one substep (8.55 cm second difference), and the same at R 0.2708 s, D left 0.3333 s and `L3-F1-phase0` 0.6708 s. Those runs have changed; the test asserts that every step running out of time above 1 m/s in both fixtures slows by at most aMax·dt over the next substep.

### Stops

`L3-F16` and `L3-F14` stops, 10a against 10b (brake time, speed at the brake, rest time, stopping distance and peak support load unchanged everywhere; 0 failed plants everywhere; coverage within ±0.4%):

| Fixture | Last step 10a (s) | Last step 10b (s) | Attempts 10a / 10b |
| --- | --- | --- | --- |
| `L3-F16-runStop` (and Free, Ready) | 4.500 | 4.417 | 17 / 16 |
| `L3-F16-runStopHard` | 4.208 | 3.983 | 16 / 16 |
| `L3-F16-stop1.7` | 3.067 | 3.279 | 12 / 12 |
| `L3-F16-stop1.9` | 3.217 | 3.483 | 13 / 13 |
| `L3-F16-stop2.1` | 3.888 | 3.721 | 15 / 14 |
| `L3-F16-stop2.3` | 4.254 | 3.517 | 15 / 14 |
| `L3-F16-stop2.45` | 4.529 | 4.037 | 16 / 15 |
| `L3-F16-stop2.55` | 3.842 | 3.829 | 15 / 15 |
| `L3-F16-stop2.75` | 4.121 | 4.338 | 16 / 16 |
| `L3-F16-stop2.9` | 4.688 | 4.525 | 18 / 17 |
| `L3-F16-stop3.05` | 4.371 | 4.354 | 17 / 17 |
| `L3-F16-reaccel` | 4.554 | 4.379 | 17 / 16 |
| `L3-F16-kick` | 4.025 | 4.121 | 14 / 14 |
| `L3-F16-contactStop` | 1.817 | 1.758 | 6 / 6 |
| `L3-F14-walkRunStop` (and Carrier) | 4.875 | 5.192 | 13 / 14 |

After the brake no two landings of opposite feet fall within `landGapS`, no plant fails and both feet end planted; the longest flight with no foot planted at run speed outside contact is 0.133 s (`L3-F7-phase25`). `L3-F14-walkRunStop` is the one stop whose distance and load move: 3.41 → 3.44 m and 1854 → 1766 N. Bisected to B3 (the clip's heading feeds the support).

### Envelope stiffness exposed by 10b

The first gate run failed one test: in `L4-F3-run-on` (and its source copy `L4-F9-free`), whose pre-fall run changed with 10b, the runner comes to rest with its right hip 7.2° past its twist range (twist −58° against −50°) from 1.85 s to the end of the trial, 0.65 s against the 0.25 s persistence limit. The shoe, carrying about 216 N, holds it by friction against about 100 N·m of twist spring. Plan 09's 800 N·m/rad twist cannot hold that inside the 5° tolerance; the passive limit was soft where plan 09 had only measured folded swing (its 2500 → 3500 change). The tolerance and persistence limit are unchanged. The hip twist is now 1600 N·m/rad (that load at 3.6°), with damping 3 → 4 N·m·s/rad for the same damping ratio, under new ids `envelope-l4-v2` and `ragdoll-l4-v2`. The longest run past tolerance across L4 falls is now 0.175 s (`L4-F3-run-off`, right hip) (10a: 0.188 s, `L4-F3-run-off` and `L4-F5-twoClamp-off`). The stated-load test derives its expected settled means from the profile (hip twist 30 N·m now settles at 1.07° instead of 2.15°). The persistence test is the regression: with 800 put back it fails on `L4-F3-run-on`. The plan 09 handoff has two dated corrections for this (the stated-load table and the natural-fall figures).

### Profile ids

| Profile | 10a | 10b |
| --- | --- | --- |
| Footwork (L3) | `footwork-l3-v2` | `footwork-l3-v3` |
| Locomotion (L3) | `locomotion-l3-v2` | `locomotion-l3-v3` |
| Run clips (L3) | `...+l3` | `...+l3+headingRadPerS=18` |
| Envelope / ragdoll (L4) | `envelope-l4-v1`, `ragdoll-l4-v1` | `envelope-l4-v2`, `ragdoll-l4-v2` |
| Coached entry (L3) | — | `phaseFirst: true` in the fixture definition |

### Changed summaries

All changed summaries, by family (suffixes after the family id):

| Family | Changed |
| --- | --- |
| `L3-F1` | falling, low, mirror0, mirror4, phase0, phase1, phase2, phase3, phase4, phase5, phase6, phase7, rising |
| `L3-F10` | both, bothLow, bothMirror, defender, falling, rising |
| `L3-F11` | invalid |
| `L3-F14` | handoff, walkRunStop, walkRunStopCarrier |
| `L3-F15` | handoff |
| `L3-F16` | contactStop, handoff, reaccel, runStop, runStopFree, runStopReady, stop1.9, stop2.1, stop2.3, stop2.45, stop2.9 |
| `L3-F2` | missMirror |
| `L3-F3` | collision, recover, side, sideMirror |
| `L3-F4` | gripBoth, gripOwner, gripTarget, oneArm, twoArm |
| `L3-F5` | drag, dragMirror |
| `L3-F6` | hold, holdMirror, saturated |
| `L3-F7` | loadRelease, mirror0, mirror50, phase0, phase25, phase50, phase75 |
| `L3-F8` | recontact |
| `L3-F9` | convert-contact, convert-exit, convert-free, convert-prep, defenderFalling, defenderRising, lift-contact, lift-exit, lift-free, lift-prep, low, noProbe-contact, noProbe-exit, noProbe-free, noProbe-prep, playerBelow |
| `L4-F1` | hipSwing, hipTwist |
| `L4-F10` | elbow-off, elbow-on, knee-off, knee-on, palm-off, palm-on, wrap-off, wrap-on |
| `L4-F11` | disturbed, exhausted |
| `L4-F12` | base, carryLeft, mirror |
| `L4-F2` | forward-off, forward-on, model-forward-on, model-side-off, model-side-on, side-off, side-on |
| `L4-F3` | forward-off, forward-on, model-forward-on, model-oblique-off, model-oblique-on, model-side-off, model-side-on, oblique-off, oblique-on, run-off, run-on, side-off, side-on |
| `L4-F4` | fast, late, obstructed, occupied, tooFar |
| `L4-F5` | oneClamp-off, oneClamp-on, onePalm-off, onePalm-on, twoClamp-off, twoClamp-on, twoPalm-off, twoPalm-on |
| `L4-F6` | break |
| `L4-F7` | overcome, passive, zeroCap |
| `L4-F9` | both, contact, crowded, defenderFalling, defenderRising, exit, free, low, prep, transferFailed |

Every result label and ending kind is unchanged. Endings that moved (time 10a → 10b, ball spot shift):

| Fixture | Ending | Time (s) | Spot shift |
| --- | --- | --- | --- |
| `L3-F1-falling` | groundDown | 1.0958 → 1.0875 | 0.04 m |
| `L3-F1-low` | groundDown | 1.3708 → 1.3708 | 0.01 m |
| `L3-F1-mirror0` | groundDown | 1.1667 → 1.1667 | 0.03 m |
| `L3-F1-mirror4` | groundDown | 1.1917 → 1.2417 | 0.30 m |
| `L3-F1-phase0` | groundDown | 1.125 → 1.1125 | 0.06 m |
| `L3-F1-phase1` | groundDown | 1.1875 → 1.175 | 0.06 m |
| `L3-F1-phase2` | groundDown | 1.1 → 1.0875 | 0.05 m |
| `L3-F1-phase3` | groundDown | 1.1583 → 1.1625 | 0.05 m |
| `L3-F1-phase4` | groundDown | 1.1292 → 1.1333 | 0.02 m |
| `L3-F1-phase5` | groundDown | 1.15 → 1.1667 | 0.09 m |
| `L3-F1-phase6` | groundDown | 1.0875 → 1.0875 | 0.01 m |
| `L3-F1-phase7` | groundDown | 1.0917 → 1.1 | 0.05 m |
| `L3-F1-rising` | groundDown | 1.1 → 1.0875 | 0.06 m |
| `L3-F10-defender` | groundDown | 1.1 → 1.0875 | 0.06 m |
| `L3-F4-oneArm` | groundDown | 1.1 → 1.0875 | 0.05 m |
| `L3-F4-twoArm` | groundDown | 1.1583 → 1.1625 | 0.03 m |
| `L3-F9-defenderFalling` | groundDown | 1.0958 → 1.0875 | 0.04 m |
| `L3-F9-defenderRising` | groundDown | 1.1 → 1.0875 | 0.06 m |
| `L4-F10-wrap-off` | groundDown | 1.1583 → 1.1667 | 0.05 m |
| `L4-F10-wrap-on` | groundDown | 1.1792 → 1.1875 | 0.06 m |
| `L4-F5-oneClamp-off` | groundDown | 1.1 → 1.0875 | 0.06 m |
| `L4-F5-oneClamp-on` | groundDown | 1.1167 → 1.1125 | 0.02 m |
| `L4-F9-defenderFalling` | groundDown | 1.1208 → 1.1125 | 0.04 m |
| `L4-F9-defenderRising` | groundDown | 1.1167 → 1.1125 | 0.02 m |

Other changes:

- `L3-F1-phase3`: conversions [(0.842, 'R')] -> [(0.842, 'R'), (1.517, 'D')]
- `L3-F9-convert-free`: conversions [(0.2, 'R'), (1.125, 'D')] -> [(0.2, 'R')]
- `L4-F9-transferFailed`: handoff [('handoffAuditFailure', 0.904, 'R'), ('handoffAuditFailure', 1.45, 'D')] -> [('handoffAuditFailure', 0.904, 'R'), ('handoffAuditFailure', 1.433, 'D')]

Final positions moved by up to 2.76 m (`L3-F9-convert-free`, where D no longer falls). Before the hip twist change, 22 L4 summaries had changed with the L3 changes (`L4-F3-run`, `L4-F4-occupied`, `L4-F5`, `L4-F6-break`, `L4-F9`, `L4-F10-wrap`); the other 40 changed with the hip twist stiffness alone.

### Findings

- `L3-F1-phase5` D right: slide plants at 0.029–0.050 s drop the target 2.4–5.6 cm vertically at the reseed. Pre-existing; it passes the audit, and it is a reseed onto the achieved foot, not a planner path.
- The reseed level gap's worst case sits exactly at its cap (one substep at the speed cap).
- **Overdue steps still hover in contact** (the plan 08 open item, not fixed here). In `L3-F4-twoArm` D's left foot swings from 0.479 s until D falls at 1.40 s, and the right plants once, at 1.375 s; at 10a the dead stop put both down (left 0.896 s, right 1.012 s). Without the settled-landing rule D plants nothing in contact and the contact-stepping test fails; with it the test passes on that one plant, as narrowly as plan 08 reported.

## 10c — Active fall contract repairs

**Result:** full suite exit 0, no unhandled error: 19 files, 805 tests, 171 s wall. Typecheck and build pass. 410 fixtures export (`L4-F12-carryLeft` removed, U5). Eight summaries change: five committed HC summaries (C6, the change the item names, under U7) and three L4. Every other summary is byte-identical to 10b, and so is every other export, except the ragdoll `grounded` observation in six obstacle fixtures (C3, U6; their summaries are byte-identical). Brace outcomes across L4: 31 palm contacts and 23 misses (13 late, 5 too far, 4 obstructed, 1 expired); 10b had 31 and 24 (13, 5, 5, 1).

### What changed

- **C1, a hold's own effort broke it (U4, grasp first).** `ArmSystem` shares the owner budget among the grasps first (`shared` from grasp demand alone), then gives arm effort only what is left: per arm the room under `perArmN` after its grasp, then the owner room after both grasps. Effort scaling no longer reaches a grasp's tension or its overload exposure. The effort ledger records `graspN`, `armFactor`, the effort's own `sharedScale` and `allocatedN` = grasp + effort. At 10b the fault was still live in `L4-F5-twoPalm-on` (194 hold entries scaled below demand, 0.08 s of overload exposure), although it no longer reached the `overload` release that the review reproduced at 1.717 s; the 10b changes upstream had moved the fall. Now no hold entry in any L4 fixture is allocated less than its grasp alone gets, and `L4-F5-twoPalm-on` keeps both holds to the end of the window (exposure 0), as its off twin does.
- **C2, the carry arm (U5).** `CARRY_ARM` (`src/sim/carry.ts`) is the one place the carry side is named: the pose's carry palm, the ragdoll's `carriedBall` landmark, the rules' ball reference and the simulation's arm label read it. The fall response's protect arm is the arm the ball is actually on (`carriedBall.seg` after the conversion; `CARRY_ARM` for a runner with no carry seat), and `begin` throws when the profile's declared `arms.carryArm` disagrees. `L4-F12-carryLeft` (declared left while the ball stayed on the right forearm) is removed: 410 fixtures.
- **C3, ground (U6).** `isGround(tag)` (`contracts.ts`): the floor collider only (`playerId === null && key === 'floor'`). Ragdoll grounding, the fall response's floor contacts and the rules' ground touches all use it. Ragdoll grounding took any collider with the floor region, obstacles included. No committed fixture changes (the obstacle fixtures `G4-F7-wallNoOpponent`, `RH-F5-invalidNormal`, `RH-F5-obstacle`, `L3-F9-noProbe-*`, `L4-F4-obstructed` are byte-identical).
- **C4, obstruction.** A miss is `obstructed` only when the arm was a seeking brace and its forearm or palm touched an opponent or an obstacle within the brace's shortest prediction horizon (`horizonS[0]`, 0.1 s) before the miss, and that contact was not a hold the arm system retains (the arm's own, or an opponent's palm or forearm). Before, one touch at any time, by any task, set a flag that never cleared.
- **C5, brace direction.** `rotateToward` turns opposite vectors about an axis perpendicular to the start (its cross product with the least-aligned basis axis) at the rate limit, instead of returning the target at once.
- **C6, player order (U7).** Traced: in reversed order `HC-F2-bothFallL2` A loses support at 0.9417 s (step 226) while B's ragdoll lies against it. A's published pose had its right leg in B's ragdoll for 11 substeps (thigh up to 8.1 cm into B's left forearm), because the shown leg's continuity push stops at 5 cm in 4 iterations and B's forearm moves into the pose-only leg faster than that; at the conversion the shin was 1.86 cm into B's left shoe, over the 1.5 cm tolerance, so the candidate was rejected and A fell as a rigid proxy. Validation is unchanged. The fix is to the candidate's source, the published pose. The thigh was the part in B's forearm, near the hip, where moving the ankle target moves the thigh little, so 4 push iterations did not get it out. A convertible player's shown leg that the ordinary push leaves past the pose's validity depth (`HARD_OK`, 1.2 cm) now takes 12 iterations within the same 5 cm per-substep cap (`RagdollProfile.poseGuard`, `poseGuard-v1`). A leg that was valid is unchanged. A first try with a 0.2 m cap also fixed the rejection but failed two HC continuity tests (a 12.5 cm knee move in one substep in `HC-F2-offset` against its 8.5 cm budget, a 0.327 m ankle move in one tick in `HC-F2-lowCarrier` against 0.3 m); with the ordinary cap both pass. Reversed, A's leg is still up to 3.6 cm into B's forearm at 0.892–0.900 s and clear from 0.904 s; A converts at the same substep as before (0.9417 s) with 1.05 cm worst penetration (its right upper arm against B's shoe). The guard is a profile behaviour under its own id: every registered HC variant carries it (`+poseGuard-v1` on the ragdoll id), and the base cases keep their historical profiles. The HC variant test now asserts "nobody ends as a rigid falling proxy" in both player orders.
- **C7, bookkeeping.** `pairSum` is removed from both ledgers and from the tests: it summed the commanded vector and its negation (always 0). Measuring what the bodies received instead (their Rapier user-force change) was tried: it is f32 and carries the rounding of every other force on the body, up to 6.8e-5 N in `G2-F7-balanced` against the gate 2 bound of 1e-6, so keeping it would have meant raising that bound. Equal and opposite torque pairs stay established by the L4-F8 zero-gravity momentum test; grasp force pairs rest on the construction (the owner receives the target's force negated in the same call), with no zero-gravity grasp test. `activeSubsteps` counts only substeps that applied torque. The force, effort and joint ledgers are off by default (`SimOptions.ledgers`, default `SIM_DEFAULTS.ledgers`, which `tests/setup.ts` turns on for every test file; the eight probes that read ledgers turn it on too); the running totals stay in the stats. The twist measures are labelled: `startOutsideDeg` is the slack's measure (twist unscaled), `maxOverDeg` and `maxNominalOverDeg` scale the twist excess by cos(swing / 2), and the export's `jointLimits.*.envelope.measures` says so. Twist overshoot is the scaled measure.
- **C8, tests.** The 20-reset test compares each cycle at the same tick in the fall (episode count, ledger lengths, event count, a SHA-256 of the trace so far) and over the whole run; the checks straight after a reset, always true because `reset()` builds a new fall response and arm system, are gone. "The arm yields once it lands" measures the palm against the point where it landed (0.31 m) and the elbow's bend after contact (24.8°), not the forearm's world translation. Per-item loops in `tests/falls.test.ts` that could run over nothing assert at least one item (`L4-F4-occupied` tasked effort entries, `L4-F7-zeroCap` ledger entries, and at least one release and one lost hold across the hold-ending fixtures).
- **C9, plan 09 handoff.** Dated corrections in place, linked here: the clean exit, `pairSum` as evidence, the brace counts, the twoPalm hold loss, the left carry and the 20 resets.
- **Profile.** `FALL_L4` is `fall-response-l4-v2` (same numbers; C1–C5 and the C7 count change its behaviour or its evidence).

### Profile ids

| Profile | 10b | 10c |
| --- | --- | --- |
| Fall response (L4) | `fall-response-l4-v1` | `fall-response-l4-v2` |
| Ragdoll (HC variants) | `ragdoll-g4-v1+...` | `...+poseGuard-v1` (`RagdollProfile.poseGuard`) |

### Regressions, each shown failing with its fault restored

| Fault put back | Failing check |
| --- | --- |
| C1: effort added to the grasp demand before sharing | allocation mismatch in `L4-F4-occupied`; `L4-F5-twoPalm-on` exposure 0.0799 s |
| C2: protect arm from the declared profile arm, no agreement check | the declared-left profile converts instead of failing |
| C3: ragdoll grounding by region | the raised-deck fall is grounded (0.317 s) |
| C4: obstruction flag kept for the whole fall, any task | `L4-F6-break` D left reads `obstructed` at 1.4375 s |
| C5: opposite vectors return the target | a 3.14 rad step against the 0.3 rad limit |
| C6: no longer push | reversed `HC-F2-bothFallL2` A rejected |
| C7: every commanded substep counted active | `L4-F2-forward-on` R 213 against 46 |
| C7: ledgers always kept | ledgers-off run keeps 1772 / 840 / 450 entries |

### Brace contacts and misses (all L4 fixtures)

| Count | Plan 09 | 10b | 10c |
| --- | --- | --- | --- |
| Palm contacts | 30 | 31 | 31 |
| Misses: late | 9 | 13 | 13 |
| Misses: too far | 7 | 5 | 5 |
| Misses: obstructed | 7 | 5 | 4 |
| Misses: expired | 1 | 1 | 1 |

Plan 09 to 10b is the L3 changes feeding the L4 falls. 10b to 10c: `L4-F12-carryLeft`'s late miss (R right, 0.354 s) is gone with the fixture, and `L4-F6-break` D left goes from `obstructed` (1.417 s) to `late` (1.438 s): its only arm contact was its own hold, which C4 no longer counts. The four remaining obstructions (`L4-F4-obstructed`, `L4-F5-oneClamp-on`, `L4-F9-defenderFalling`, `L4-F9-defenderRising`) touched the box or the opponent 0.033–0.079 s before the miss. C3 changes no brace outcome: these two are the only per-fixture differences in contacts and misses.

### Changed summaries

| Fixture | Change | Cause |
| --- | --- | --- |
| `HC-F2-bothFall` | Final positions up to 0.63 m; contact events 29 → 20, `grounded` 33 → 47; conversions unchanged | C6 guard (A's leg out of B before both convert) |
| `HC-F2-bothFallL2` | Final positions up to 0.17 m; contact events 26 → 20, `techniqueFailure` 17 → 13; conversions unchanged | C6 guard |
| `HC-F2-lift3.0` | Final position 0.01 m; `grounded` 21 → 17 | C6 guard |
| `HC-F3-phase50` | Final positions 0.01 m; `minPairGap` −0.0096 → −0.0088 m; `groundDown` still at 1.1792 s, spot unchanged | C6 guard |
| `HC-F5-strictTransfer` | Final positions 0.04 m; `contactRegion` 22 → 24; both transfers still fail their strict audit at the same substeps | C6 guard |
| `L4-F4-occupied` | D final position 1 mm | C1 |
| `L4-F5-twoPalm-on` | Final positions 4 mm; contact events 5 → 4 | C1 (no effort scaling on the holds; exposure 0.08 s → 0) |
| `L4-F6-break` | Final positions 3 cm; the overload release 1.175 → 1.179 s (from grasp alone); D left miss `obstructed` → `late` | C1, C4 |
| `L4-F12-carryLeft` | Removed | C2 (U5) |

Every result label is unchanged, every handoff is at the same substep with the same outcome, and the one ending among these (`HC-F3-phase50`) is unchanged in kind, time and spot.

The six obstacle fixtures whose exports change under C3 (summaries byte-identical, only the trace's `g` field and `grounded` events): `L3-F9-noProbe-contact` (`grounded` events 70 → 26, 60 rows), `-exit` (76 → 40, 22 rows), `-free` (58 → 48, 3 rows), `-prep` (56 → 26, 30 rows), `RH-F5-invalidNormal` (15 → 19, 4 rows) and `RH-F5-obstacle` (1 → 0, 138 rows: the ragdoll lying on the box no longer reads grounded). This is U6 applied to committed fixtures without a new profile id: the `grounded` flag of a ragdoll is observation only and feeds nothing, so no summary moves. If the user wants historical exports byte-identical, it can go behind a profile flag.

### Findings

- **The guard's deficit exists outside HC, under historical profiles.** Counted with the guard off: in 62 non-HC fixtures some convertible player's shown leg sits past `HARD_OK` after the ordinary push, from 1 to 101 substeps per fixture, deepest 8.9 cm (`L3-F9-playerBelow`), 6.0 cm (`RH-F5-playerBelow`), 5.0 cm (`L3-F1-phase3`), 4.6 cm (`L2-F15-playerBelow`, `-overload`). None of these conversions is rejected in the fixture's order, so no test fails; the published pose is invalid there for those substeps. Adopting `poseGuard-v1` for RH, L2, L3 or L4 would change their summaries (an unconditional trial, with a 0.2 m cap, changed `RH-F5-playerBelow` and both `L2-F15` summaries) and is the user's call.
- **Reversed-order deviations of natural falls remain** and are recorded by the reversed-order test, as before. Most are conversion timing (`HC-F2-lift1.4`, `-lift3.0`, `-bothFall`, `-bothFallL2`, `HC-F3-phase50`, `-phase75`, `-rising`, `-falling`, `-lowRunner`, `HC-F5-strictTransfer`); in two the fall itself depends on the order: `HC-F2-lowCarrier` A and `HC-F3-mirror` D fall and convert only in reversed order. Each fall that happens is an audited ragdoll in both orders, and nobody ends as a rigid proxy.
- **10b's open item stands:** overdue steps still hover in contact (`L3-F4-twoArm`).

## 10d — Ball carry evidence and presentation

**Result:** full suite exit 0, no unhandled error: 20 files, 812 tests, 186 s wall. Typecheck and build pass. 410 fixtures export. All 238 historical summaries are as 10c left them (233 byte-identical to `736d90a`, the five HC summaries 10c changed unchanged since). 21 L3/L4 summaries change, all through the runner's carry arm at or before a conversion or contact; every result label, rule ending (kind, time and spot) and handoff is unchanged. Two D conversions change (one appears, one disappears) and two late brace misses become contacts. Carry profile `carry-sim6-v2`. The lab loads `L3-F1-phase0` (rules) and `L3-F16-sprint` (no rules) and runs them with no console errors; that is a load check, not the 08a visual review, which stays with the user.

### What changed

- **D1, carry tests with an independent reference.** (a) The lab's ball choice is one pure function, `drawnBall` (`src/lab/render-pose.ts`), used by the rule overlay and the player view. `tests/ball-carry-evidence.test.ts` runs all 20 L3 rule fixtures tick by tick and checks that the lab's drawn ball at alpha 1 (through its own interpolation) equals the rules' `ballRef` and the seated ball within 1e-9, that the trace's `rule.ball` read back through JSON matches within its 4-decimal rounding, and that at the ending the drawn ball at the ending substep equals `ending.ballSpot` and the export's `ruleEnding.ballSpot` within 1e-12 and the event's within rounding; the spot stays frozen after it. (b) The blocked-arm test rebuilds the requested ball from `carryRequest`, the published shoulder and the body's segment lengths: the residual is measured from that request (within 1e-6), the drawn ball is 0.3 to 1.3 residuals from the requested ball, and it sits on the achieved forearm measured on the landmarks (along, out and on the chest side, 1e-6), not through `seatBallLocal`. (c) The lab's `lerpPose` is exported (`render-pose.ts`) and tested between two ticks where the forearm turns fastest, at t = 0.25, 0.5 and 0.75: the drawn wrist and the model's hand stay rigid on the blended forearm, the palm and ball sit at their blended places on it, and a world-space blend of the wrist would leave it by more than 0.1 mm. (d) The reset test runs to the end, calls `reset()`, runs again and compares t, seat and ball on every row. (e) The historical test covers every G, L1, L2, RH and HC fixture (238, no slice), and separately asserts that the 22 L4 falls built from L3 fixtures inherit `CARRY_L3` on purpose and name it in their notes.
- **D2, mesh controls.** `tests/ball-carry-mesh.test.ts` tightens the forearm to −0.035…0 and the front to < 0 and adds the hand (−0.02…0), the elbow end against the upper arm (< 0), the ball's axis against the drawn forearm (within ±0.02 rad of the seat's tilt, the donor's check made two-sided), the laces' azimuth from the forearm (< 0.1 rad) and the palm normal, the hand vertices' thinnest axis, against the ball's radial direction (< 1.0 rad). The donor's torso, upper-arm and tip tolerances are unchanged. 27 controls each fail at every one of 78 poses (Sprint, Fast Run, stand, walk), none on the tip alone; the ball roll must fail on the laces, the hand rolls and the legacy rig on the palm, the out-of-plane tilts on the axis. The donor's blend-against-rise correlation is back on the drawn forearm.
- **D3, the achieved arm's hand.** `CarrySeat.handW` is the hand's share of the carry's roll and flex. It steps toward 0 while an arm task owns the right arm and toward 1 while the carry does, over `CarryProfile.handBlendS` (0.15 s, `stepHandW`). The sim's palm (`seatPalmLocal` through `seatHand`) and `RigAdapter` (forearm roll and hand flex) both scale by it, so an achieved arm's hand is drawn as without a carry once the blend is over. The ball stays seated on the achieved forearm.
- **D4, the seat on the achieved arm.** `seatOn` sets the seat side on each candidate's achieved forearm frame from the request's chest-frame inside direction taken perpendicular to that forearm, so an alternative arm or the near-straight hinge fallback keeps the ball on the chest side. The ball is one of the carry arm's clearance shapes: its capsule (the football's tips and radius, `CarryProfile.ball`) adds to the arm's depth (external and floor), and its centre inside the player's own torso or pelvis is a soft ranking cost. The pose publishes `limbClearance.carriedBall` (the ball's depth) and `limbClearance.carriedBallTorso`.
- **D5, lab hot paths.** `RigAdapter` keeps per-bone world matrices and scratch vectors; the lab keeps one reusable previous pose per player (`capturePose`) in place of a `structuredClone` per tick; `lerpV`, `slerpQ` and the three.js quaternions are gone (`qSlerp` moved to `vec.ts`, unchanged; the core frame blends with it too); `lerpPose` places every landmark on its blended segment, so the drawn hand, palm, ball and model agree mid-frame; shared football geometry and materials are disposed once.
- **D6, plan 08a handoff.** Dated corrections in place in [plan08.md](plan08.md#plan-08a-ball-carry): the achieved-arm hand, the drawn ball and evidence, the exported carry profile, the mesh controls and the four other circular tests.

### Profile ids

| Profile | 10c | 10d |
| --- | --- | --- |
| Carry (L3, and L4 falls built from L3) | `carry-sim6-v1` | `carry-sim6-v2` (same keys and swing; adds `handBlendS` 0.15 s and `ball` 0.14 / 0.085 m) |

### Regressions, each shown failing with its fault restored

| Fault put back | Test | Failing check |
| --- | --- | --- |
| D1(a): the lab draws the palm for a `carryPose` rule | evidence, every tick | `L3-F1-phase0` t = 0.0167: drawn ball 0.123 m from `ballRef` (limit 1e-9) |
| D1(b): the ball placed on the requested forearm, not the achieved one | blocked arm | `L3-F7-phase0` t = 0.521: ball 1.17 cm from the requested ball, needs over 0.3 residuals (2.47 cm) |
| D1(c): the old blend, landmarks lerped in world space | render blend | t = 0.25: wrist 0.34 mm off the blended forearm (limit 1e-9) |
| D1(d): `reset()` keeps the previous players' pose memory | reset | row 177: seat differs from the fresh run |
| D1(e): the last RH fixture given the carry | historical fixtures | `RH-F7-both`: carry `carry-sim6-v2` present |
| D2: the 08a mesh criteria | mesh controls | 3 cm sideways: passes at Sprint pose 0 |
| D3: the hand's share switched in one substep | owner change | palm step 12.3 cm (limit 1 cm) |
| D3: the rig rolls an achieved forearm by the full seat roll | achieved arm | forearm bone 1.26 rad from the rig without a carry (limit 1e-6) |
| D4: the seat roll from the request frame | near-straight, alternatives | ball on the far side of the forearm (side error 2.0, limit 1e-6) |
| D4: no torso cost for the ball's centre | blocked carry arm | `carriedBallTorso` 0.034 m (expected 0) |
| D4: the ball left out of the arm's clearance | infeasible ball | `rightArm` 0 (expected 0.03) |

The D1(d) fault first tried (not resetting the tick counter) passes: time comes from the substep counter, which `reset()` zeroes, and the tick numbers are not compared. The pose-memory leak is the fault kept. The 11 demonstrations run from `.scratch/d10/faults.py`, which restores every file it patches.

### Changed summaries

Each change starts on the runner's carry arm. In 20 fixtures the runner's achieved arm at its conversion is the same as at 10c (the wrist identical, at the same substep), and the seat roll is now read on that forearm (D4), so the carried palm starts the ragdoll's hand elsewhere: under 0.1 mm in `L3-F16-handoff` and `L3-F9-noProbe-free`; 3.5 to 10.4 mm in eleven (`L3-F9-convert-free`, `-prep`, `-contact`, `L3-F9-low`, `L3-F9-noProbe-contact`, `L4-F3-run-on`, `-off`, `L4-F9-free`, `-prep`, `-contact`, `-low`; roll −1.32 to −1.36 rad in `L3-F9-convert-free`); 2.3 to 2.9 cm in `L3-F9-convert-exit`, `L3-F9-noProbe-exit` and `L4-F9-exit`; 2.5 cm in the three grips (`L3-F4-gripTarget`, `-gripBoth`, `L4-F4-occupied`; roll −1.834 to −1.234 rad, the request's roll far from the pushed forearm); 6.7 cm in `L3-F10-bothMirror` (−1.307 to −0.673 rad). In `L3-F3-collision` the ball's clearance chooses another arm before the contact: at the conversion (0.8125 s, unchanged) the wrist is 0.32 m elsewhere.

| Fixture | First difference | Final positions | Events |
| --- | --- | --- | --- |
| `L3-F3-collision` | R 0.583 s | 0.36 m | `grounded` 54 → 34 |
| `L3-F4-gripTarget` | R 0.917 s | 0.01 m | `contactBegin` 11 → 10, `contactRegion` 26 → 24, `grounded` 6 → 8 |
| `L3-F4-gripBoth` | R, D 0.917 s | 0.04 m | `techniqueFailure` 5 → 6 |
| `L3-F9-convert-free` | R 0.217 s | 1.21 m | D now converts at 1.658 s (loss of support); `contactBegin` 6 → 5, `grounded` 44 → 60 |
| `L3-F9-convert-prep` | R 0.467 s | 0.69 m | `grounded` 42 → 32 |
| `L3-F9-convert-contact` | R 0.667 s | 0.34 m | `grounded` 34 → 36 |
| `L3-F9-convert-exit` | R 0.833 s | 0.41 m | `grounded` 34 → 38 |
| `L3-F9-noProbe-free` | R 0.250 s | 6.40 m | D's conversion at 0.771 s is gone (D keeps running); `contactBegin` 14 → 4, `minPairGap` −0.0011 → 0 |
| `L3-F9-noProbe-contact` | R 0.650 s | 0.56 m | `contactBegin` 17 → 11, `techniqueFailure` 1 → 0, `minPairGap` −0.0074 → −0.0124 |
| `L3-F9-noProbe-exit` | R 0.833 s | 0.36 m | `grounded` 40 → 22 |
| `L3-F9-low` | R 0.667 s | 0.08 m | `grounded` 36 → 24 |
| `L3-F10-bothMirror` | R, D 1.217 s | 0.32 m | `contactBegin` 16 → 13, `wrapStatus` 12 → 10, `grounded` 30 → 36 |
| `L3-F16-handoff` | R 2.617 s | 0.82 m | `grounded` 30 → 36 |
| `L4-F3-run-on` | R 0.217 s | 0.25 m | D converts at 0.971 s (was 0.933); D's right brace contacts at 1.371 s (was a late miss at 1.383); `minPairGap` −0.0115 → −0.0066 |
| `L4-F3-run-off` | R 0.217 s | 0.78 m | foot plants 6 → 8 |
| `L4-F4-occupied` | R, D 0.917 s | 0.01 m | `contactBegin` 5 → 6, `grounded` 4 → 10 |
| `L4-F9-free` | R 0.217 s | 0.25 m | as `L4-F3-run-on` (same fall) |
| `L4-F9-prep` | R 0.467 s | 0.42 m | `grounded` 26 → 24 |
| `L4-F9-contact` | R 0.667 s | 0.16 m | `grounded` 30 → 50 |
| `L4-F9-exit` | R 0.833 s | 0.38 m | `grounded` 24 → 22 |
| `L4-F9-low` | R 0.667 s | 0.99 m | `grounded` 18 → 20 |

Brace outcomes across L4: 33 palm contacts and 21 misses (11 late, 5 too far, 4 obstructed, 1 expired); 10c had 31 and 23 (13, 5, 4, 1). The two changes are D's right arm in `L4-F3-run-on` and `L4-F9-free`.

**Rules ball.** No rule ending in L3 or L4 changes kind, time or spot. The per-tick rule ball moves where the seat roll now follows the achieved forearm: 3.5 mm at most in 22 L3/L4 rule fixtures (about 35 ticks each, around 0.23 s), 2.8 and 2.9 cm in `L3-F1-mirror4` and `-mirror0`, 11 cm in `L3-F5-drag` and 65 cm in `L3-F5-dragMirror` (156 ticks, see the findings).

### Findings

- **D3 is latent in the fixtures.** No fixture gives the carrying arm to an arm task, so no summary moves with it; the regressions build the poses through `buildProxyPose` with the pose memory.
- **A drag fixture carries an infeasible fit.** In `L3-F5-dragMirror` the carry arm sits in alternatives with about 0.7 m residual before and after 10d, and the ball crosses behind the back in both. The fit is now reported (`limbClearance.carriedBall`, `carriedBallTorso`) rather than hidden in the residual.
- **The proxy torso is coarse for the ball.** The authored carry presses the ball centre up to 1.6 cm into the proxy torso box at the Sprint back key, while the mesh's worst torso gap through the Sprint is −0.047 m (inside the donor's −0.08). The torso is therefore a soft ranking cost on the ball's centre, not a validity limit.

## 10e — Rules and referee correctness

**Result:** full suite exit 0, no unhandled error: 21 files, 817 tests, 200 s wall. Typecheck and build pass. 410 fixtures export. Every historical export (G, L1, L2, RH, HC) is byte-identical to 10d, so the 238 committed summaries stand as 10c left them (233 identical to `736d90a`, the five HC changed by 10c). 33 L3/L4 exports change: all carry the new rules id, and the only behavioural difference in them is E3's progress measure. Two summaries change (`L3-F5-drag`, `-dragMirror`: progress-window events only). No result, ending, spot, influence event or physical trace value changes.

### What changed

- **Revision 2 (U8).** `RuleProfile.revision` (absent on every historical profile) and `rulesRevision2` (`+revision=2` on the id; a profile already on it is returned as it is). `asL3` puts every L3 rule profile on it after its `ballSource=carryPose` variant, and `asL4` every L4 one (an L3-derived fixture's rules are on it already; the tipped falls' own profiles join here). The exported profile carries `revision: 2`; historical exports have no such key. The official spot stays frozen at the ending and `ballRef` is unchanged.
- **E1, the settle window (U9).** After a referee ending the override still drops arm requests, posture lean and drive, and brakes facing the current heading with effort 1. On revision 2 it keeps each player's `locomotion.stance` (ride height and stagger) and its `yawEffort` when one was requested: how the player stands and turns, not a tackle action. The ending substep itself runs on the intent decided before it; the override starts with the next substep.
- **E2, influence with a zero request.** On revision 2 influence can clear only on a substep with no opponent contact at all (a touch under the source impulse included) and no retention relationship (an unloaded clamp or grip included), in addition to supported, grounded, unrestrained movement. A zero request out of contact still counts as unopposed (the defender has gone). Before, `along` was the request itself when the request was zero, so `along >= 0.5 x 0` held and influence cleared after 0.2 s whatever held the runner.
- **E3, progress retention.** On revision 2 the summed retention force counts only along −`forwardAxis` (the force opposing progress, as the body contacts already were), so a sideways or forward grip is not progress retained. `retentionN` in the progress events and ending evidence is that component.
- **E4, ground touch.** Rule ground is the floor only since 10c C3 (`isGround`, U6): obstacles never end a play, which is the ruling, not a defect. `EXCLUDED_GROUND_REGIONS` is now enforced: a rule profile that lists wrist, hand, ankle, foot or the foot support as eligible is refused when the observer is built. Every registered profile passes.

### Regressions (`tests/rules-revision.test.ts`), each shown failing with its fault restored

| Fault put back | Failing check |
| --- | --- |
| E1: the override drops stance and yaw effort on revision 2 | the defender's stance during settling is `null`, not 0.78 m |
| E2: a zero request reads as free in contact | an unloaded clamp with a zero request clears influence |
| E3: retention counted by its magnitude | a sideways 100 N grip stops progress |
| E4: the exclusion list not enforced | a profile with `hand` eligible is accepted |
| L4 built without the revision | `L4-F9-transferFailed` referees on the historical profile |

The E2 and E3 checks feed `RuleObserver` frames directly and run both profiles side by side; the historical profile keeps the old behaviour in every case (the test asserts it). E1 runs `L3-F1-phase0` with the defender wrapping at a 0.78 m stance under both profiles: they end at the same substep, the defender stays a supported proxy for 0.15 s after it, keeps 0.78 m on revision 2 and drops it on the historical profile, where its core rises more.

### Changed summaries

Every L3 and L4 fixture with rules (33) exports `profiles.rule` with `revision: 2` and the `+revision=2` id, which the events' and the ending's `profile` field repeat. Beyond that, only the progress measure differs:

| Fixtures | Difference |
| --- | --- |
| `L3-F5-drag`, `L3-F5-dragMirror` | Summary: `progressWindow` events 3 → 7 and 2 → 6. The defender's grip drags the runner, so it no longer counts as progress retained (`retentionN` 72.8 and 121.3 N → 0 at the first window); each window now lasts only while the body contact opposes progress, and ends (`restraintLost`) when it stops. Result (`practiceOutOfBounds`), times and positions unchanged. |
| `L3-F4-twoArm`, `L4-F10-wrap-on`, `-off`, `L4-F9-transferFailed` | `progressWindow` event values (`retentionN`, phase timing); counts unchanged; summary unchanged. |
| 21 more L3/L4 rule fixtures | The trace's per-substep progress row (`rule.prog`: window time, advance) on 2 to 9 rows each. |

Revision 2's E1 and E2 change nothing in the registered fixtures: no player with a stance request is still a supported proxy after an L3/L4 ending (`L3-F1-low`'s runner, the one rule fixture with a stance request, is a ragdoll by then), every scripted player's kept yaw effort is the default 1, and no influence begins or clears at a different time. Both are established by their regressions.

### Findings

- **E1 and E2 are latent in the fixtures** (above). They will act in any L3/L4 fixture where a lowered defender is still supported at the ending, or a runner stands held after a contact.
- **L4 rule fixtures not built from an L3 fixture join revision 2 through `asL4`.** The shoved and tipped falls (`L4-F10-knee`, `-elbow`, `-palm`) and `L4-F9-transferFailed` take `RULES_FOOTBALL` or `RULES_LAB_CORE` directly; the opt-in sits in `asL4`, so no L4 rule profile is missed (the profile test fails with it removed).
