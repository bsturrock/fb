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
