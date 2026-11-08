# Plan 08 handoff: locomotion transitions and tackle integration

**Date:** 2026-11-05, review closeout and independent review repairs 2026-11-06, second review repairs and plan 08a 2026-11-07.
**Status:** all three passes, the review closeout and the [independent review fix plan](../open/08_Review_Closeout.md#current-fix-plan--independent-review-2026-11-06) are implemented, uncommitted on `model-integration`. Incoming checkpoint: `736d90a`. The user declared 08 finished on 2026-11-07. Plan 09 has not started.

**Result at 08's close: 576 tests, all pass.** 0 of 2413 L3 boundaries were over 1 cm against the single reference, peak 0.98 cm; 54 were over on the raw difference and each of those names a demonstrated artifact.

**Current result with [plan 08a](#plan-08a-ball-carry): 599 tests, 597 pass, 2 fail.** Both failures are the transition audit: 3 of 2412 L3 boundaries are over 1 cm, peak 1.50 cm. 53 are over on the raw difference. Typecheck and build pass. 335 fixtures export. All 238 committed summaries are identical. The supplied walk is on the L3 path; see [Walk, start and stop](#walk-start-and-stop-2026-11-06).

**Plan:** [08 — Locomotion transitions and tackle integration](../open/08_Locomotion_Transitions_and_Tackle_Integration.md). **Previous:** [plan 07a handoff](plan07a.md). **Next:** [09 — Active falls](../open/09_Active_Falls_Joint_Limits_and_Role_Responses.md).

**Independent review disposition (2026-11-05):** 347 tests/build and all 330 summaries reproduced, with every earlier summary unchanged. Acceptance is held for three repairs: contact/airborne transition continuity, declared foot-motion caps and integration assertions that establish their scenarios/geometry. Execute [08 review closeout](../open/08_Review_Closeout.md) from this working tree before visual acceptance and 09. The measurements below remain incoming implementation evidence.

## Review closeout (2026-11-06)

Implements [08 review closeout](../open/08_Review_Closeout.md), including its 2026-11-06 fix plan. The sections after this one are the incoming implementation's measurements unless marked. Where they disagree, this section is current, and within it the [independent review repairs](#independent-review-repairs-2026-11-06) are newest. Dated notes further down that say a test fails or a boundary is open describe the tree at that date.

### Independent review repairs (2026-11-06)

The three fixes of the [fix plan](../open/08_Review_Closeout.md#current-fix-plan--independent-review-2026-11-06), composed path only.

1. **Audit.** `recordTransition` no longer takes a per-landmark minimum. `deltaM` is the difference from one reference: the old composition at the same solved state and time, from copied planner, sampler and pose memory, with its own demonstrated snaps removed at source (`requestJumpM`, `stepStopM`). `rawM`, `rawBy`, `continuedM`, `requestJumpM` and `stepStopM` stay on every boundary, and the achieved motion takes no part in the limit. All landmarks, 0.01 m.
2. **Handovers.** The rerun audit's boundaries were traced at substeps and repaired in the shared foot and arm path. See [What was repaired](#what-was-repaired).
3. **Walk ramp.** `rampWalkRequest` keeps the controller's request as its destination (`walkWant`) and advances `walkRequest` toward it every substep, so a 0.05 s decision interval reaches 1.20 m/s by 1.5 s. A referee ending stops the request at once between decisions, reset clears both, and contact and run requests still pass through unramped.

### Second review repairs (2026-11-07)

A second review named three defects, all reproduced before any change. Each regression failed on the unrepaired code.

| Finding | Reproduced | Repair | Result |
| --- | --- | --- | --- |
| P1: a carried handover bypassed the vertical limit | 21 first updates over 1.5 m/s, worst 3.254 m/s (`L3-F1-phase3` D right, 0.475 s). Neither the counter nor the rate test saw that substep | `carryPath` publishes through `publishStep`, the update `chase` already used: speed and lift caps, the planner's records, and the accepted motion stored where a cap took over | 0 over, peak 1.5000 m/s |
| P2: the walking ramp overrode a referee ending | `L3-F14-carrier` with a sideline at z = 0.8 m: the next tick still asked for 1.165 m/s and the player sped up from 1.040 m/s | `rampWalkRequest` passes the zero request through once the rules have ended the play | Motor request 0 and no forward drive from the first substep after the call |
| P2: the audit missed reseeds with the same mode and source | 3 D right reseeds in `L3-F1-phase5` at 0.029167, 0.041667 and 0.050000 s | The audit's foot identity carries the reseed count, for boundary detection and for the old-owner comparison | All 3 audited, 0 over. Every L3 reseed now has a boundary, tested |

**Also found, same path.** The probe for the first finding showed one first carried update over the horizontal cap: 14.39 m/s against 13.49 m/s, `L3-F16-contactStop` R right, 0.575 s. `publishStep` caps that too. The review did not list it.

**One change the review did not ask for: the audit's step-stop correction.** Bounding the carried update moved `L3-F1-low`, and its boundary at 1.504 s then read 1.03 cm, with 0.43 cm raw. The correction had fired on a step that sped up: it moved 3.74 cm, then 4.89 cm. The reference therefore sat behind both the old path and the live one. `stopped` tested any change of motion, and now requires a loss of speed. A step that keeps or gains speed is compared with the old path as it is. This narrows what the audit may set aside, so that boundary now reads its raw 0.43 cm. Raw over 1 cm stays 54: 41 request jump, 13 step stop, 0 neither. The correction still fires at 173 boundaries.

**The two checks that had to change, and why.**

- The held-leg test required old and new to agree within 1 mm at a carried foot on the ground. The lift bound makes that false wherever the old path was moving faster than 1.5 m/s. The limit is now 1 mm plus what the cap removes. The largest gap across L3 is 0.78 cm (`L3-F1-phase3`). The horizontal cap adds 0.38 cm at `L3-F16-contactStop`, outside that test's fixtures.
- The overdue-step test compared the first airborne speed with `moveV` to within 2 m/s. `moveV` is the mean of the last substep, so it lags a step still gathering speed: in `L3-F1-low` it reads 8.98 m/s, the step ended that substep at 11.58 m/s, and the foot goes on at 11.27 m/s. The upper bound now takes the larger of the two. The lower bound is tighter than before, because 2 m/s bound nothing at walking speeds, and the test now covers `L3-F11-invalid`.

**Mutation check.** With the regressions in place, removing each of these on the working tree failed a test: vertical cap, horizontal cap, lift record, speed record, the narrowed stop test and the overdue velocity reset. The overdue reset was caught only after the tightened lower bound was added.

**Changed results.** 238 of 238 committed summaries identical. 17 of 97 L3 summaries changed against the previous evidence, in `L3-F1`, `L3-F3-collision`, `L3-F4`, `L3-F9-defender*` and `L3-F10-defender`. No result label or end time changed. D ended in proxy rather than ragdoll in `L3-F1-phase2` and `L3-F4-oneArm`, which is the end state the incoming tree had. `L3-F1-low` still ends at 1.88 s. Referee endings in L3: 18, and the ramp would have held no player in any of them, so these changes come from the carried update. The ramp fix shows only in its new regression.

### Transition limit

Boundaries over 1 cm against the single reference, all landmarks, same solved time and root:

| Scenario | Incoming | Now | Largest now | Raw over 1 cm |
| --- | --- | --- | --- | --- |
| F1 entry, every phase | 100/347 | **0/276** | 0.98 cm | 7 |
| F2 miss | 0/85 | 0/90 | 0.86 cm | 0 |
| F3 side contact | 61/228 | **0/177** | 0.86 cm | 6 |
| F4 tackles and holds | 10/42 | 0/46 | 0.97 cm | 0 |
| F5 drag | 37/155 | 0/92 | 0.83 cm | 4 |
| F6 hold | 4/118 | 0/84 | 0.52 cm | 0 |
| F7 clears | 21/266 | 0/306 | 0.95 cm | 14 |
| F8 recontact | 4/61 | 0/63 | 0.84 cm | 4 |
| F9 falls and airborne recovery | 35/353 | **0/399** | 0.97 cm | 17 |
| F10 both and defender | 2/127 | 0/115 | 0.97 cm | 0 |
| F11 invalid | 0/25 | 0/25 | 0.35 cm | 0 |
| F13 idle | 0/96 | 0/48 | 0.45 cm | 0 |
| F14 walk | 0/220 | 0/145 | 0.78 cm | 0 |
| F16 start, brake, kick | 5/478 | 0/501 | 0.73 cm | 2 |
| F17 run start | | 0/46 | 0.83 cm | 0 |
| **All L3** | **279/2601** | **0/2413** | **0.98 cm** | **54** |

`L3-F15` has no boundaries. The incoming column had no corrected reference, so raw is its nearest companion. The audit the independent review rejected read 7 of 2468.

By kind, now then incoming where it was listed: landing `swing/step>planted/step` 0/389, 110/576; `swing/follow>planted/step` 0/525; lift-off `planted/step>swing/step` 0/498, 35/605; `planted/step>swing/follow` 0/411, 21/443; palm `ready+contact>free+contact` 0/12, largest 0.8 cm.

**The 54 raw boundaries pass on a corrected reference, not on the raw difference.** Each is one of two demonstrated artifacts of the old path:

| Correction at source | Raw over 1 cm | Regression |
| --- | --- | --- |
| The old owner's request jumps at that substep (`requestJumpM`) | 41 | `the audit keeps the raw difference and what it set aside`, `a jump the old owner's offset already took up is not corrected a second time` |
| The old step would run on past its landing (`stepStopM`) | 13 | `an old path that was about to run on past the landing is the artifact` |
| Neither | 0 | |

The landing reproduction is `L3-F3-side` R at 0.320833 s: raw 5.15 cm, no request jump, 0.44 cm once the reference stops the step at its landing. That correction comes from the plan's stored step motion, not from achieved motion. The negative control `negative control: a known old/new pose difference over 1 cm still fails with the achieved motion smooth` reopens a real handover on `L3-F7-phase25` (`FOOT_DEBUG.noJoinCheck`) and fails. `the audit reads copies` compares five fixtures with the audit on and off.

**Achieved substep motion stays a separate number.** `continuedM` exceeds 1 cm at 353 of 2413 boundaries. These pass because the limit compares old and new at the same time, and both carry that motion. Limb second differences in contact are therefore still not within 1 cm.

### The boundaries the reviews named

| Boundary | Then | Now, largest landmark | Raw now | Outcome |
| --- | --- | --- | --- | --- |
| `L3-F1-phase0` 0.479 s D left ankle | 2.57 | 0.33 | 0.95 | Repaired |
| `L3-F1-phase1` 0.483 s D left knee | 1.35 | No boundary at this time; 0.41 at 0.479 s | 1.10 | Repaired |
| `L3-F1-phase1` 0.492 s D left knee | 1.39 | No boundary at this time | | Repaired |
| `L3-F1-phase6` 0.479 s D left knee | 1.12 | 0.03 | 0.03 | Repaired |
| `L3-F1-phase7` 1.121 s D left palm | 1.17 | Handover now at 1.108 s, 0.76 | 0.76 | Repaired |
| `L3-F3-side` 0.467 s D left shoe | 1.96 | 0.56 | **1.96** | **Comparison artifact**, not a repair |
| `L3-F4-twoArm` 0.475 s D right knee | 1.49 | 0.04 | 0.04 | Repaired |
| `L3-F1-phase5` 0.479 s D right knee | 2.14 | 0.33 | 1.68 | Repaired, one request jump corrected |
| `L3-F1-phase5` 0.488 s D right ankle | 2.17 | No boundary at this time | | Repaired |
| `L3-F9-noProbe-contact` 0.550 s D left ankle | 1.62 | 0.05 | 0.07 | Repaired |

All in cm. A landmark's own difference can be smaller than the largest shown.

`L3-F3-side` at 0.467 s is D's step landing: the old step moves 5.7 cm that substep and has no jump, so raw 1.96 cm is the same run-on as R's reproduction, and the regression now covers it. The landing is not excused: that plant still fails on 1.96 cm of slide (`footPlantFailed`, tested).

**The earlier "infeasible contact" classification did not hold.** The closeout classed `L3-F3-side` 0.467 s and both `L3-F1-phase5` boundaries as contact the limit cannot hold, and the user decided they stay failing. None is over now, and no collision, force or clearance rule changed. The guard still pushes the limb out: on `L3-F3-side` the push is 2.1 to 2.6 cm with 0.2 to 0.5 cm of depth left at 0.467 to 0.475 s. No boundary in this audit is classed as infeasible, so the plan's explicit-failure case is not in use.

### What was repaired

All in the shared composed path. Thresholds and budgets are unchanged except the new `HANDOVER_M`, a gate on when an owner may change.

- **Handover only where both owners agree.** A foot joins the follower, or a clip plant is taken, only where the two owners' next foot positions are within `HANDOVER_M` (8 mm), checked on copies before the change (`joinsRequest`, `followNext`). Otherwise the foot stays on its step.
- **A held leg keeps the old owner's path.** A leg on a clearance variant, or shown more than `plantTolM` off its target (`heldOff`), is handed to a step without a reseed: the step's first target is the old target and the pose keeps its ownership and departure (`carryPath`, `carried`).
- **A step keeps its path** through a support loss, and into the settle step when support returns.
- **Request seams and jumps are taken up by the offset.** At a support change or a jump over 15 m/s, a following foot carries on and the offset absorbs the exact difference (`seamOffset`). A held leg stays where it is.
- **A fresh plant is not stepped from** the moment it lands by the `leaving` trigger.
- **A fast foot at a crossing continues its swing** instead of waiting (`settled`).
- **The audit itself:** a jump the old offset already took up is not subtracted again (`tookUp`), and a foot whose owner did not change is compared on the same request at a support seam (`kept`).
- **The palm** ready-to-free handover carries the arm's own motion on (`handed`, `last2`).

**Each gate was checked by removing it** on a copy and rerunning the audit, the footwork and transition tests, and a fingerprint of every L3 fixture.

| Gate removed | Over 1 cm without it | Also caught by |
| --- | --- | --- |
| Crossing keeps a held leg's path | 13 | Tests |
| Rejoin steps when it cannot follow | 10 | Tests |
| `joinsRequest` | 4 | Tests |
| Clip plant agreement | 3 | Tests |
| Step keeps its path, `settled`, `handsOn` (either site), `ownN`, settle path | 1 each | Tests |
| Fast foot at a crossing | 0 | `brake phases`, `a full stop` on `L3-F16-stop2.45` |
| Request seam | 0 | `a request seam at a support change` |
| Held leg stays at a seam | 0 | `L3-F9 player below stays a support-budget regression` |
| Fresh plant, held leg at a support loss, overdue step's motion | 0 | Their regressions, which I strengthened after this check showed they did not fail |

Two call sites of the carried path changed no L3 fixture, so I removed them. **One gate has no regression:** a following foot's one substep of carried motion at a seam (`was * dt` in `takeRequests`) changes only `L3-F9-playerBelow`, with the audit counts unchanged. I kept it because it preserves achieved motion, and my attempt at a test could not tell it apart, so that test no longer claims it.

### Where the repair differs from the plan's wording

The plan says to repair handovers "starting from the achieved pose and motion". For held legs this repair does not do that: starting from the achieved foot is what opened the difference, so the step takes the old owner's path and departure, and the correction happens over the following substeps instead of at the boundary.

- 110 of 2413 boundaries have a carried foot. The largest difference at them is 0.84 cm, 7 are over 1 cm raw, on the other leg, and 66 have achieved motion over 1 cm (largest 5.13 cm).
- On the ground old and new agree at a carried foot's first substep to under 1 mm, plus what the step's caps take off the old path's motion, at most 0.78 cm (tested, see [Second review repairs](#second-review-repairs-2026-11-07)). A support loss adds the request's seam, 0.4 cm in `L3-F9-noProbe-free` at 0.0125 s. The reference takes no correction for a carried foot, so its delta is its raw difference.
- The change is spread under the pose's existing continuity limits and the planner's rate caps. The same-time audit does not see that spread. This is the main thing the visual review needs to judge.

Root causes repaired by the earlier closeout, all in the shared composed path:

- A step's landing ran on a timer and could plant a moving foot short of its target, or snap out of a clearance variant. It now lands on arrival, on the primary leg, with the foot on the ground.
- A follower was carried through request jumps, and a released plant followed a request already running away from it. It now keeps the foot, or steps.

- A clip that fades out and is rejoined jumped phase while still shown (1.4 cm palm steps). The shown phase now slides (`uSlip`). This was most of the remaining palm and elbow excess.
- Reseeding to the same owner kind added the old floor lift or clearance twice. Foot requests now carry a reseed count (`seed`).
- A planner step kept the clip's toes-down angle on the floor and hovered 13 cm up (`soleW` flattens it).
- Shortening a step moved its landing point behind the foot, which ran back and missed a stance.
- A step blocked by another body never landed. It now lands where the leg has got to. Without this `L3-F4-twoArm`'s defender planted nothing from contact to conversion.
- Plant, fade and pole continuity at L3 are bounded more tightly: 2.1 m/s and 3 rad/s, 1 m/s into a plant. Clip weight and brace weight no longer step in rate at a reversal.

### Foot rates at every actual substep

| Case | Lift incoming | Offset incoming | Lift now | Offset now |
| --- | --- | --- | --- | --- |
| `L3-F16-runStop` | 2.57 | 2.94 | within 1.5 | within 1.5 |
| `L3-F14-walkRunStop` | 3.75 | 2.83 | within 1.5 | within 1.5 |
| `L3-F7-phase0` D | 2.60 | 8.53 | within 1.5 | within 1.5 |
| All 97 L3 fixtures, worst | | | **1.5000** | **1.5000** |

Measured inside the planner (`stats`) and independently from outside between two substeps of one owner, with zero fixtures over. Limits and tolerances are unchanged. The outside measure no longer infers a seam from request speed: the planner records the exact amount the offset took up (`seamOffset`) and the measure removes that amount.

On a reseed the world target moves up to 67.15 m/s (`L3-F13-settle2.1`). That is the coordinate change, not the foot: the test bounds the new target to under 10 cm from the achieved foot. The achieved ankle peak is 20.89 m/s, D's left foot in `L3-F3-side` and its copies at 0.0167 s. This is a planner step in the fixture's first substeps, with the root at 6.9 m/s and the clip's own swing at 11.6 m/s. It is within the caps, and I have not established why that step is so fast. The previous peak, 23.96 m/s on the struck shoe in `L3-F1-phase5`, is gone.

### Stops

| Fixture | Brake | At rest | Distance | Last step | Plants tried, failed | Coverage | Peak support |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runStop | 2.60 s | 4.28 s | 3.49 m | 4.50 s | 17, 0 | 94.3% | 2295 N |
| runStopHard | 2.60 s | 3.87 s | 1.81 m | 4.21 s | 16, 0 | 93.5% | 2295 N |
| stop1.7 | 1.70 s | 3.37 s | 3.36 m | 3.07 s | 12, 0 | 96.1% | 2295 N |
| stop1.9 | 1.90 s | 3.57 s | 3.40 m | 3.22 s | 13, 0 | 96.3% | 2295 N |
| stop2.1 | 2.10 s | 3.77 s | 3.43 m | 3.89 s | 15, 0 | 95.5% | 2295 N |
| stop2.3 | 2.30 s | 3.97 s | 3.42 m | 4.25 s | 15, 0 | 95.3% | 2295 N |
| stop2.45 | 2.45 s | 4.12 s | 3.42 m | 4.53 s | 16, 0 | 95.1% | 2295 N |
| stop2.55 | 2.55 s | 4.22 s | 3.43 m | 3.84 s | 15, 0 | 94.7% | 2295 N |
| stop2.75 | 2.75 s | 4.42 s | 3.42 m | 4.12 s | 16, 0 | 94.0% | 2295 N |
| stop2.9 | 2.90 s | 4.57 s | 3.43 m | 4.69 s | 18, 0 | 93.8% | 2295 N |
| stop3.05 | 3.05 s | 4.72 s | 3.42 m | 4.37 s | 17, 0 | 93.4% | 2295 N |
| walkRunStop | 3.60 s | 5.27 s | 3.41 m | 4.88 s | 13, 0 | 96.7% | 1854 N |
| reaccel | 2.80 s | 4.47 s | 3.38 m | 4.55 s | 17, 0 | 92.4% | 2295 N |
| kick | 2.00 s | 4.20 s | 4.82 m | 4.03 s | 14, 0 | 95.1% | 3434 N |
| contactStop | 0.42 s | 1.68 s | 1.76 m | 1.71 s | 6, 0 | 97.1% | 1721 N |

Every full stop ends at rest with both feet held, with no failed plant (tested). Where the last step falls after rest, the settle runs on past it. Coverage is at most 1.0% below the closeout figures. Brake distance matches the 5.5 m/s² motor, which is unchanged. Hard, late and reacceleration stops are all covered by the rate test.

`stop2.9` and `stop3.05` now finish because their fixture area widened to `halfX` 12, not because the stop shortened. **One plant moved:** the first plant of the runStop handover is 3.13 s, before 3.1 s incoming, because a composed step lands when the foot arrives, not on a timer. The test's window now starts at that plant and pins it under 3.15 s.

### Scenario coverage

Tests prove these occurred, not only that assertions ran. 97 L3 fixtures, 576 tests overall.

| Scenario | What the run shows |
| --- | --- |
| `L3-F8-recontact` | contact 0.571, exit 0.733, **recontact 0.817** (D2), exit 1.021, free 1.221 s; no chatter, feet, arms and landmarks audited at the boundary |
| `L3-F9-lift-*` | Support lost in the named mode at 0.300, 0.412, 0.646 and 0.779 s, regained at 0.792, 0.800, 0.925 and 1.125 s, explicit lift intent, R stays on the proxy |
| Falls | Conversion and no-probe falls in every mode, audited, irreversible, intended player's mode read at the trigger, support and motors off |
| `L3-F9-defenderRising/Falling` | D inspected, measured vertical-velocity sign asserted |
| Real grips (new `L3-F4-gripTarget`, `gripOwner`, `gripBoth`) | 6 `gripBegin`, real `gripRelease`, `gripRemap` and `gripPassive`, 216 held substeps each. L3 had no real grip before |
| Real clamps (`L3-F4-twoArm`, `L3-F6-hold`, `L3-F10-both`) | 35, 739 and 1 `clampBegin`, 136, 1274 and 139 held substeps |
| Conversions | 67 proxy-to-ragdoll changes across L3, 1 genuine rejection (`L3-F11-invalid`, the safe fallback) |
| Plants | 1044 across L3, 30 honest failures: 25 slide, 4 clearance, 1 reach (`scripts/probe/p08-final.ts`) |

Geometry: achieved arm segment lengths 0.00 mm from profile (tolerance 2 mm), palm to anchor 0.00 mm (15 mm), remap anchor error 0.00 mm (2 mm). Negative controls fail a stretched limb, a shifted anchor and the wrong player. These figures are for the six fixtures above. Candidate and first-solve checks pass, including the added `L3-F4-twoArm`, conversion in contact, no-probe in contact, `L3-F9-defenderRising`, `L3-F10-both` and `L3-F10-defender`.

### Changed results

All 238 committed summaries are identical. 335 fixtures export, 97 of them L3.

**Against the tree the independent review read:** 71 of 97 L3 summaries changed and 26 did not. No result label changed. Changed of total by group: F1 13/13, F2 1/2, F3 4/4, F4 2/5, F5 2/2, F6 0/3, F7 7/7, F8 1/1, F9 16/16, F10 5/6, F11 0/1, F13 0/7, F14 2/8, F15 0/2, F16 18/18, F17 0/2. Event totals moved in 67, player end states in 49, `minPairGap` in 21, end time in 3.

| Fixture | Result, review | Result, now | D, review | D, now |
| --- | --- | --- | --- | --- |
| `L3-F1-phase1` | groundDown 1.72 | groundDown 1.70 | ragdoll | ragdoll |
| `L3-F1-mirror0` | groundDown 1.70 | groundDown 1.67 | ragdoll | **proxy** |
| `L3-F1-mirror4` | groundDown 1.72 | groundDown 1.70 | ragdoll | **proxy** |
| `L3-F1-phase2` | groundDown 1.60 | groundDown 1.60 | proxy | **ragdoll** |
| `L3-F4-oneArm` | groundDown 1.60 | groundDown 1.60 | proxy | **ragdoll** |
| `L3-F9-noProbe-free` | duration 2.40 | duration 2.40 | ragdoll | **proxy** |

R ends as a ragdoll in all six, as before. No force or threshold changed. These are outcomes of D's feet landing differently in contact; I have not traced them fixture by fixture.

Event totals, review then now: F1 2252 to 2117, F2 124 to 126, F3 494 to 518, F4 594 to 603, F5 1262 to 1247, F7 510 to 491, F8 127 to 109, F9 1320 to 1272, F10 648 to 739, F14 222 to 218, F16 804 to 792. F6, F11, F13, F15 and F17 are unchanged. The summary keeps only totals, so these are not explained per event type.

`minPairGap` moved most in `L3-F1-phase4` (-0.29 to -1.27 cm), `L3-F9-noProbe-exit` (0.01 to -1.17 cm), `L3-F1-low` (-0.46 to -1.05 cm) and, for the better, `L3-F9-noProbe-free` (-1.08 to -0.06 cm). This is the proxy pair gap, not a limb, and it is not traced.

**At the closeout, against the incoming tree.** Of 92 incoming L3 summaries, 78 changed and 14 did not (F13, F15, five of F14). 3 fixtures were new. No result type changed except the two stops above. The table below is that comparison; the rows above supersede it where they overlap.

Handoffs moved in 8 fixtures. All still ended the same way for R. No force or threshold changed.

| Fixture | Result, incoming | Result, now | D, incoming | D, now |
| --- | --- | --- | --- | --- |
| `L3-F1-phase0` | groundDown 1.72 | groundDown 1.63 | ragdoll | **proxy** |
| `L3-F1-phase2` | groundDown 1.65 | groundDown 1.60 | ragdoll | **proxy** |
| `L3-F1-phase5` | groundDown 1.65 | groundDown 1.67 | ragdoll | **proxy** |
| `L3-F1-phase6` | groundDown 1.65 | groundDown 1.60 | ragdoll | **proxy** |
| `L3-F1-phase7` | groundDown 1.62 | groundDown 1.62 | proxy | **ragdoll** |
| `L3-F1-low` | groundDown 2.38 | groundDown 1.87 | proxy | **ragdoll** |
| `L3-F4-oneArm` | groundDown 1.65 | groundDown 1.60 | ragdoll | **proxy** |
| `L3-F9-noProbe-free` | duration 2.40 | duration 2.40 | ragdoll | **proxy** |

`L3-F1-low` falling 0.52 s sooner is the largest shift and needs a look. Clamp pairs improved: twoArm 39 to 35, oneArm 41 to 26, phase0 25 to 21, drag unchanged at 187/186. Fixture ends moved in 19 fixtures: 17 are `groundDown` at a different time, 2 are the stops above.

Event totals by group, incoming then now: F1 2602 to 2134, F2 120 to 124, F3 557 to 476, F4 447 to 342, F5 1344 to 1261, F6 4623 to 4570, F7 461 to 467, F8 112 to 120, F9 1254 to 1289, F10 761 to 648, F11 73 to 93, F14 370 to 368, F16 761 to 782. **These are not explained per event type.** The incoming tree was not snapshotted and its summary keeps only a total, so a type-by-type comparison cannot be rebuilt. F8 and F9 also changed scenario on purpose: the second defender's start and the lift times.

Profile identities: `footwork-l3-v2` and `locomotion-l3-v2`, for the composed path changes above. Nothing else changed identity.

### Visual review, recorded separately as user acceptance

At normal speed and 0.25×, side and oblique: `runStop` and free-arm stop, late brake through rest, run start, walk to run, idle and walking, recontact, low-runner contact, kick recovery, conversion during contact, and the 07a offset, stacked, simultaneous and one-arm regressions. Foot-flattening on planner steps and the phase slide are new and have not been seen in motion.

**Not yet seen by the user: the repairs in [Independent review repairs](#independent-review-repairs-2026-11-06).** Please watch these at normal speed and 0.25×, side and oblique, for how the carried legs resolve after the handover: `L3-F1-phase0`, `L3-F1-phase1`, `L3-F1-phase6`, `L3-F1-phase7` (palm), `L3-F3-side`, `L3-F4-twoArm`, and the changed endings `L3-F1-mirror0`, `L3-F1-mirror4`, `L3-F1-phase2`, `L3-F4-oneArm`, `L3-F9-noProbe-free`. Also `L3-F14-forward`, which now ramps at every decision interval.

**User review (2026-11-06), complete, before the fixes below:**

| Fixture | User's result |
| --- | --- |
| `L3-F16-runStop` | Good |
| `L3-F1-low` | Pretty good |
| `L3-F16-reaccel` | **Fails: skips through the air** |
| `L3-F7-phase0` | **Fails: skip after contact** |
| `L3-F16-runStopFree` | Pretty good, but **both legs reach out to slow down; it should be one then the other** |
| `L3-F16-stop2.75` | **Same leg issue** |
| `L3-F14-walkRunStop` | **Walk needs lots of work.** The user can supply a walk animation |
| `L3-F13-settle2.5`, `L3-F14-forward`, `-lateral`, `-backward` | OK; walk animation needs work |
| `L3-F8-recontact` | Not bad, except **arms pass through bodies** |
| `L3-F16-kick` | **Not good: same stop, plus a hop after** |
| `L3-F9-convert-contact`, `L3-F10-both` | Good |
| `L3-F3-collision`, `L3-F4-twoArm` | Not bad for now |
| `HC-F2-offset`, `HC-F2-lift1.4`, `HC-F2-lift3.0`, `L3-F4-oneArm` | A lot better |
| `L3-F3-side`, `L3-F1-phase5`, `L3-F9-noProbe-contact` | Leg pathing needs work, overall smooth: the failing boundaries do not read as pops |

This is not acceptance. Plan 08 stays open.

Measured: no foot planted for 0.38 s from 2.15 s and again from 2.70 s, against 0.12 s in steady running and at most 0.17 s in `L2-F3-runStopReaccel`. Cause of the first gap, traced: the left foot's `continue` step at 1.89 s took 0.61 s for 3.47 m, because this closeout times the descent at the 1.5 m/s lift cap and removed the `swing.maxS` cap (incoming: `compose.descentMps`, capped at 0.34 s). The clip wanted left stance near 2.25 s, the foot was still 0.44 m up, and at 2.40 s it joined the clip at 0.29 m with a 1.01 m offset and rose again. The stance was skipped. This is a closeout regression. No test caught it: no plant was proposed, so failed plants stayed 0. The second gap is not traced.

A sweep of the 95 L3 fixtures for gaps of at least 0.25 s at 3 m/s or more found 55, most in contact and not judged. Outside contact: 8 fixtures (`L3-F7-*`, `L3-F8-recontact`) with R 0.25 to 0.37 s at 5.8 m/s after contact, and 9 stops at 3 to 4 m/s. Only reaccel is traced, so a shared cause is not established. The kick's gap is real flight.

**Fast Run legs pass through each other (user, front view, 2026-11-06).** The cause is in the supplied clip: at its lowest point each Fast Run ankle sits 0.9 cm and 0.0 cm from the hip centre (Sprint 3.5 and 4.1 cm), ankle separation reaches -3.4 cm and toe separation -10.1 cm, so the feet land on one line and cross it. In `L2-F11-fastRun`, the steady clip fixture with feet, the ankle gap at passing is 7.2 cm against a 16 cm shoe and the knee gap reaches 3.4 cm. L3-F16-sprint has 10.6 and 11.9 cm.

The existing `stanceWidthAddM` profile setting and its lab slider address this. Trial on `L2-F11-fastRun` with `'fast-run'` at 0.03, 0.045 and 0.06: passing gap 12.9, 15.8 and 18.7 cm, knee gap 8.1, 10.3 and 12.6 cm, 9 plants and 0 failed in each. It must stay on the L3 path, since the base profile would change committed summaries.

**User's chosen widths (2026-11-06): `stanceWidthAddM: { 'fast-run': 0.065, sprint: 0.025 }`.** Picked by eye on the lab slider. Applied in `asL3` only (profile id `+l3-width`); the base profile has none.

**Arm timing (measured, not reviewed by eye).** Each hand pairs with the opposite leg. Lead of the hand over the opposite knee, steady run: Fast Run 17 to 50 ms in the sim, 0 ms in the source clip; Sprint 83 to 100 ms in the sim, 67 ms in the source. The cycle is 533 ms. The extra lead is not traced. In the brake (2.6 to 3.3 s) the free left hand has zero-lag correlation -0.17 with the right foot and its best lag hits the 200 ms search bound, while the arm fades into its brace, so that window is not a clean phase measure. In the reaccel window the right hand to left knee correlation is 0.05, inside the skipped stance; recheck after that fix.

### Fixes after the user review (2026-11-06)

All are composed-path only. The review table above is from before them. The audit figures in this section are from the audit the independent review rejected. **User's second look (2026-11-06): "looks good".** This was a general response to the rewatch list, not a per-fixture result, and not acceptance of 08. The six audit fixtures still fail and the new boundaries are still unclassified.

- **Both legs reaching out, and the reaccel skip:** one cause. The brake handed the legs to the planner with the other foot high. That foot needs up to 0.6 s to land under the 1.5 m/s cap, so the held foot ran out of reach and was released with it still up, and both landed together. The planner now takes the legs only when the foot in the air can land before the held foot runs out of reach (`handsOver`, `descentS`). The cap is unchanged.
- **Skip after contact:** a clip that kept playing through a planner hold kept its old phase, so the feet landed out of stance. When the planner gives the legs back, the clip now rejoins the achieved feet (`legsHeld`, `clipBack`), and with two steps in the air it joins the later landing. While the clip comes in, a step too far from the request to recover (over 0.375 m) lands instead of joining.
- **Stance widths** as above.
- **Tests:** two regressions added: consecutive landings of different feet at least 0.1 s apart in full stops, and no span over 0.25 s off the ground outside contact at 3 m/s or more. The skip this guards against was 0.37 s; the worst case left is `L3-F7-phase75` at 0.22 s. Changed expectations: the handover plant pin moved from under 3.15 s to under 3.3 s (it is now 3.28 s), and the stop's failed-plant check now counts only the stopping player, because `L3-F16-contactStop`'s defender honestly fails one plant in contact by 1.8 cm of reach.
- **Results:** 555 tests, 549 pass, 6 fail, all the 1 cm audit. Typecheck and build pass. 333 fixtures, all 238 committed summaries identical. Lift and offset 1.5000 m/s, 0 fixtures over. Reaccel coverage 89.3% to 93.2%. All full stops at rest with 0 failed plants. `L3-F16-handoff` and the run-start double landing (0.68 s, 71 ms apart) were not touched.
- **The 1 cm boundaries changed.** `L3-F1-phase5` (both) and `L3-F9-noProbe-contact`, the unexplained one, now pass. `L3-F3-side` 0.467 s remains. New: `L3-F1-phase0` 0.479 s left ankle 2.6 cm, `L3-F4-twoArm` 0.475 s right knee 1.5 cm, `L3-F1-phase1` 0.483 and 0.492 s left knee 1.4 cm, `L3-F1-phase7` 1.121 s left palm 1.2 cm, `L3-F1-phase6` 0.479 s left knee 1.1 cm. All are D; five are at contact entry. 7 of 2546 boundaries are over, 87 raw. The same code with the widths off has 5 over, 77 raw: `L3-F1-phase5` twice, `L3-F3-side`, `L3-F9-noProbe-contact` and `L3-F1-low` 1.500 s left shoe 1.3 cm. So the widths swap which boundaries fail rather than add a new kind. **None of the new ones is classified yet.** The tests stay strict.
- **D's result changed again:** `L3-F1-phase5` and `L3-F9-noProbe-free` are now ragdoll, not proxy, and `L3-F1-low` falls at 1.88 s.

### Supplied clips for walking and starting (2026-11-06)

| File | Length | Root travel | Use |
| --- | --- | --- | --- |
| `Standard Walk.fbx` | 36 frames, 1.17 s | In place | **Intaken and played.** Closed cycle, seam 0, ankle separation 13.1 to 16.8 cm: no leg crossing |
| `Start Walking (1).fbx` | 89 frames, 2.93 s | 2.08 m | Template only, not in the repo. Speed curve about 1.2 m/s^2, hips lead the first step by about 0.4 s |
| `Idle To Sprint (1).fbx` | 25 frames, 0.80 s | 1.74 m | Template only, not in the repo. Speed curve about 5 to 6 m/s^2 |

Same 29 joints at 30 FPS as the other clips. The two one-shots are not played. Their speed curves set the ramps below; the limb motion comes from the walk and run cycles. Not modelled from them: the 5 cm sideways shift over the stance foot before the first step, and Idle To Sprint's hip drop and lean.

### Walk, start and stop (2026-11-06)

Opt-in through `runClipsL3`, on every L3 fixture with run clips. `L3-F14-forward`, `-carrier`, `-ready` and `L3-F13-settle*` now have clips; `L3-F14-lateral` and `-backward` stay procedural.

- **Walk clip:** first in the profile, played only for a walking request (0.05 to 2.1 m/s), faded in over 0.15 to 0.5 m/s of achieved speed. A walk speeding up blends into the run clips.
- **Stride, not cadence, follows speed** below the clip's 1.59 m/s, down to half. At the old fixed stride the feet never reached stance: no plants for 1.9 s at 1.2 m/s. The walk also rides 2.5 cm lower and bobs with the stride.
- **Walking requests ramp at 1.2 m/s^2** (`rampWalkRequest`), Start Walking's curve. This is what makes the start and stop: the hips lead, the first step is short, and a stop shortens its steps on the clip. No motor budget changed; only the request is shaped, and only while free.
- **A ball stays tucked:** the carry arm's share of the clip swing goes to 0 on the walk.
- **The walk changes nothing else.** Run, stop and contact match the two-clip profile tick for tick (tested on `L3-F16-runStop` and `L3-F4-twoArm`). A first version held the blend through every fade, and a 0.07 mm shift was enough to lose `L3-F4-twoArm` its only plant in contact.
- **Run start, `L3-F17-runStart` and `-runStartFree` only (opt-in `startMps2: 6`):** the request rises at Idle To Sprint's curve, so a start from rest goes through the walk into the run. It stays opt-in because the contact and stop copies depend on their source timing: with it on everywhere, 17 scenario tests failed.

| | Before | After |
| --- | --- | --- |
| Walk footfalls, `L3-F14-forward` | None for 1.9 s | Left, right, left, right, left, 0.5 to 0.6 s apart, then a right settle step 0.28 s later |
| Walk stop | 1.2 to 0.24 m/s in 0.3 s | 1.2 to 0.29 m/s in 0.9 s, with the last steps on the clip |
| Run start from rest | L, R, R, L, landings 71 ms apart, 13.8 m/s^2 | R, L, R, L, steps 0.74, 1.17, 1.57, 1.54 m |
| 5.4 m/s after the request | 0.62 s | 1.2 s |

- **Tests:** 563, 557 pass, 6 fail, the same six 1 cm fixtures. Added: walk start and stop, the tick-for-tick check, and L3-F17. The asL3 width test now includes `walk: 0`. The L3-F14 arm test window moved from 1.0 to 2.2 s to 1.4 to 2.5 s, because the ramped start reaches steady walking later; its limits did not change.
- **Limits:** lift and offset 1.5000 m/s, 0 fixtures over. 7 of 2468 boundaries over 1 cm (raw 87). No gaps or double landings in `L3-F13`, `L3-F14` or `L3-F17`.
- **Not reviewed visually by the user yet.** I checked stills of the walk and the run start in the lab.
- **Not fixed:** the default `L3-F16` run start keeps its L, R, R, L opening. In contact, overdue steps can hover: in `L3-F4-twoArm` D goes 0.9 s with one plant, so that test passes narrowly. Samples show clearance variants and large ankle errors there; the cause is not proven. Plant confirmation is unchanged.

## What changed

Every behaviour change is opt-in through the L3 fixtures. L1, L2, RH and HC fixtures keep their paths and results.

### Pass 1: start, brake, stop

- The foot planner has a composed path (`compose` in `footwork-l3-v2`). Each foot follows the run clip through a critically damped offset, seeded from the request the leg solve actually used and the achieved ankle velocity, so a takeover or release starts where the foot is.
- Swing steps in composed mode are receding-horizon quintics. A foot lands on its achieved lowest shoe corner, and landing waits on the achieved foot gap and on arrival, with no timer (closeout).
- Foot owner changes keep the achieved sole angle and knee pole, and decay them (`soleO`, `poleW`). The pose rebases its continuity guard when the owner kind changes.
- The clip brake handover and the clip join phase (`joinPhase`) pick a compatible phase. Free arms brace while braking; carry and ready hands keep their assignment.
- Motor, 5.5 m/s² braking limit, force budgets and the 0.80 m stance are unchanged. Nothing is a render-only offset.

### Pass 2: idle and walking

- `models/animations/source/idle.fbx` is intaken (`scripts/model/idle-intake.ts`, `npm run intake-clips`). 251 frames at 30 FPS, 8.33 s, in place, measured seam 0. Frame 71 is fitted through the pose path; the cycle is not played. The plan allows the cycle only if it adds value once the posture fits. I kept the static policy and did not review a played cycle. Spine and head animation stay out of scope.
- A settling player keeps existing plants and takes the fitted stance only through normal steps.
- Walking arms follow the achieved feet's fore-aft spread, fade in with travel speed and fade out into idle and run. Carry, ready and held arms keep their assignment.
- Diagnosis of the near-absent plan 07 walking swing: the swing was scaled by `min(1, speed / 4)`, 25% at 1 m/s, and the standing arm's 5–7 mm of padded self-overlap sat it on a sticky raised alternative.

### Pass 3: automatic contact integration

- `src/sim/locomotion.ts` adds a per-player locomotion mode (`free`, `prep`, `contact`, `exit`), separate from control mode and representation. It reads observations only: closing speed and gap, contacts, retention, clip settle, support. It sets no transform, grants no grounding and changes no budget or completion predicate.
- Falling interrupts every mode at once. Reset and accepted conversion clear the state.
- Preparation requests a bounded height drop through `composeTarget(..., dropM)`. Exit picks a compatible clip phase. Feet and arms stay independent, so misses, recontact and falls have no shared stance reset.
- In contact a free limb keeps the clearance alternatives, because another body is a real obstacle. Outside contact a composed arm is judged like a sampled arm, using the continuous radial clearance from plan 06.

### Lab and exports

The lab has an L3 group and shows `locomotion <mode> (<reason>) prep contact arm swing` plus per-foot ownership. Traces carry `loco {m, why, p, c, s, d}`, and each fixture export names the locomotion and footwork profiles.

## Profile identities

| Item | Identity |
| --- | --- |
| Locomotion | `locomotion-l3-v2` (new) |
| Footwork | `footwork-l3-v2` (new, extends `footwork-l2-v2`) |
| Support | `support-suspension-rh-v3` for braking stops, `support-suspension-rh-v2` otherwise (both unchanged) |
| Motor | the plan 07 braking motor, 5.5 m/s² (unchanged); the labelled hard stop keeps the original motor |
| Solver, stance | `solver-g4-4x60`, `stance-g3-free` (unchanged) |
| Model calibration | `bew-v6:5aaab36942e3` (unchanged) |
| Idle source | sha256 `662267cccb15fb8ea1c74de8fa85637628b65689f4436b05168d82932bc4341c`, frame 71, static policy |

## Measured deltas

Incoming implementation unless marked. Current figures are in [Review closeout](#review-closeout-2026-11-06).

### Start, brake, stop

Peak one-tick second difference of a limb landmark in the body frame, so lower is smoother.

| Case | Plan 07 (L2) | Plan 08 (L3) |
| --- | --- | --- |
| Run stop after 2.4 s (toe-off release) | 11.8 cm at 3.08 s | **4.3 cm** at 3.33 s |
| 2.55 s brake variant | 14.4 cm | **4.5 cm** at 3.07 s |
| Stop, then reaccelerate, after 2.4 s | 10.0 cm at 3.37 s | **8.2 cm** at 3.23 s |
| Stop into a labelled handoff, after 2.4 s | 12.4 cm at 2.60 s | **4.0 cm** at 2.47 s |
| Stop with a kick, after 2.4 s | 12.4 cm at 2.68 s | **6.7 cm** at 2.67 s |
| Hard stop comparison, after 2.4 s | 8.5 cm at 2.97 s | 9.7 cm at 2.98 s (**worse**) |
| Run-start takeover near 0.75 s | 12.0 cm | 11.0 cm (**barely changed**) |
| Last foot event, runStop | 4.39 s | 3.91 s |

Plants proposed and failed: 0 failures in every stop except the kick (1, airborne). The latest settles are 4.34 s (stop2.55) and 4.88 s (stop2.75, the worst case). **stop2.9 and stop3.05 leave the practice area at 8 m while still moving (2.7 and 4.1 m/s), so those two phase variants prove the brake but not the settle.** The 3.067–3.10 s velocity reversal no longer shows as a spike in the stop. `reach` still ends most plants in a stop (L3 runStop 10 reach, 1 liftoff, 3 step; L2 9, 2, 2 and 2 settle); that was already the case and is reported here as a plant-length limit, not fixed.

### Idle and walking

| Case | Result |
| --- | --- |
| Static idle, L3-F13 and L3-F15 | 0.0 cm peak; no stepping, no root offset, no arm chatter |
| Walk into idle, L3-F13-settle2.5 | 2.3 cm peak; settled by 3.21 s on existing plants |
| Walk to run, L3-F14-walkRunStop | 11.7 cm at 2.18 s, right ankle (**remaining limit**, same size as the run start) |
| Reaccelerate, L3-F16-reaccel, whole run | 12.0 cm at 2.22 s, right knee |

### Contact fixtures

| Fixture | Measured |
| --- | --- |
| L3-F1 | 8 phases plus low stance, rising and falling bob: every anchor held at entry stays; no shared stance reset |
| L3-F2 | Preparation unwinds with no contact, no grip; the run carries on |
| L3-F3 | Mode follows the first observed contact within one tick; the blend does not delay the body |
| L3-F5-drag | Runner drags the defender; same result and time as RH-F6-failed |
| L3-F6-hold | Settles by about 3.2 s, zero speed, mode stays `contact`, no fall, no conversion, no marching. After 3.5 s at most one plant per player |
| L3-F7 | Every phase and side: prep 0.32, contact 0.57, exit 0.74, free 0.91 s; run resumes on the clip, no fall |
| L3-F8-recontact | Contact held through the second bump; exit 0.95 s, free 1.15 s, one resumption, no chatter |
| L3-F9 | Loss of support in free, prep, contact and exit, by lift and by lost probe, in low stance, on the rising and falling bob, and with a player below: exact candidate, audits pass, nothing restored |
| L3-F10 | Either or both convert with retention; no duplicated bodies; one-arm defender and low stance covered |
| L3-F11-invalid | Labelled bad candidate rejected (`jointAnchor,landmarkDiscontinuity`), safe fallback |
| L3-F12 | 30, 60 and 144 render rates, pause and reset give matching traces. The sim has no renderer in its loop, so a hidden player cannot change it; this is proven by construction, not by rendering a hidden player |

**The single handoff rejection across all 92 L3 fixtures is the labelled L3-F11-invalid** (`scripts/probe/p08-handoffs.ts`). Held hand anchors and arm lengths stay within their limits through composition in every contact fixture (test `every contact fixture keeps held hand anchors and arm lengths`).

## Tackle outcomes against the model baseline

Incoming figures. Closeout changes are under [Changed results](#changed-results).

The baseline's three rejected handoffs still reproduce on their committed fixtures, at the same time and depth as [gate 4](gate4.md). L3 runs the same situation with no rejection. Note that gate 4's ending time for G4-F3-twoArm-M (1.058 s) predates later plans; the current committed value is 1.57 s, and that summary is unchanged by this plan.

| Baseline (G4 model) | Support baseline (RH or L2) | Plan 08 (L3) |
| --- | --- | --- |
| G4-F3-twoArm-M: groundDown 1.57, **D rejected 1.13 s, 30 mm**, clamps 39/39 | RH-F6-twoArm: groundDown 1.65, 33/31 | L3-F4-twoArm: groundDown 1.72, 39/39, no rejection |
| G4-F3-oneArm-M: groundDown 1.43, 17/17 | RH-F6-oneArm: groundDown 1.63, 39/39 | L3-F4-oneArm: groundDown 1.65, 41/41 |
| G4-F3-failed-M: invalidHandoff, **R rejected 0.90 s, 102 mm**, 7/7 | RH-F6-failed: out of bounds 2.67, 178/177 | L3-F5-drag: out of bounds 2.67, 187/186 |
| G4-F10-simultaneous-M: duration 2.60, **both rejected 1.20 s, 125 mm**, 1/1 | RH-F6-simultaneous: duration 2.60, 1/1 | L3-F10-both: duration 2.60, 1/1 |
| | RH-F6-sideLoss: out of bounds 1.75 | L3-F3-side: out of bounds 1.73 |
| | RH-F6-sideRecover: duration 1.75 | L3-F3-recover: duration 1.75 |
| | L2-F14-oneArmFeet: groundDown 1.63, 39/39 | L3-F1-phase0: groundDown 1.72, 25/25 |

Clamp pairs are begin/end counts. **Changed tackle outcomes:** no result type changes between the RH or L2 row and its L3 copy. Falls land 0.02–0.09 s later and the side loss 0.02 s earlier.

**Clamp churn is not improved.** It is worse in three rows (twoArm 33 to 39, oneArm 39 to 41, drag 178 to 187) and better in one (one-arm feet 39 to 25). G2-F5-M stays at 310/308 and has no L3 copy. It remains the pre-existing issue in gate 4 Limitations 6.

## Transition audit

Incoming audit, kept as the before column of [Review closeout](#review-closeout-2026-11-06).

Each substep with a mode or foot ownership change solves the old pose path against a copied pose memory at the same solved time and root, and compares landmarks with the new path. Live state is never mutated (a test runs with and without the audit and compares). Target: at most 1 cm.

| Group | Boundaries | Over 1 cm | Largest |
| --- | --- | --- | --- |
| Free locomotion, L3-F13, F14, F16 | 735 | **0** | 0.9 cm |
| Kick (airborne) and braking into contact | 59 | 5 | 5.1 cm |
| Contact, L3-F1 to F11 | 1807 | **274** | 5.8 cm, L3-F1-low at 1.158 s |

Contact by fixture group (over 1 cm / boundaries, largest): F1 100/347, 5.8; F2 0/85, 0.6; F3 61/228, 5.7; F4 10/42, 3.9; F5 37/155, 5.1; F6 4/118, 2.0; F7 21/266, 2.6; F8 4/61, 3.4; F9 35/353, 5.7; F10 2/127, 2.5; F11 0/25, 0.6.

Largest transition kinds: landing (`swing/step>planted/step`) 110/576, 5.7 cm; preparation into contact with a follow-to-step 49/62, 2.6 cm; lift-off (`planted/step>swing/step`) 35/605, 4.5 cm; `planted/step>swing/follow` 21/434, 4.9 cm; exit back to contact 9/9, 4.7 cm.

Sampled explanation, which is not proof for all 274: at a body hit the old offset path follows a jolted request while the new path keeps foot inertia. In L3-F7-phase0 at 0.575 s a landmark's z was 1.66 cm the tick before, the new path gives 2.02 cm and the old path 3.46 cm, so the new path is the continuous one and the audit difference measures the old path's jump. Other cases are landings held up by clearance. A contact fixture can still contain real pops of up to this size; these remain open.

The kick's excess is airborne (largest 4.5 cm), where the plant-free path changes owner in the air.

## Height and lean

Height requests stay within the 1.5 m/s slew limit across every mode change. L3 adds no lean request: the plan allows preparation to request one, and I did not need it. The existing posture lean path and its limits are unchanged, so lean is not measured here.

| Fixture | Rate (m/s) | Tracking | Saturated ticks |
| --- | --- | --- | --- |
| L3-F1-phase0 | 0.370 | 1.8 cm | 12/145 |
| L3-F1-low | 0.929 | 7.2 cm | 48/235 |
| L3-F4-twoArm | 0.646 | 7.1 cm | 10/144 |
| L3-F5-drag | 0.456 | 0.3 cm | 0/320 |
| L3-F6-hold | 0.373 | 0.3 cm | 0/600 |
| L3-F6-saturated | 0.373 | 22.3 cm | 61/600 |
| L3-F7-phase25 | 0.452 | 0.3 cm | 0/288 |
| L3-F7-loadRelease | 0.579 | 25.5 cm | 33/288 |
| L3-F8-recontact | 0.579 | 0.3 cm | 0/432 |
| L3-F16-runStop | 0.337 | 0.2 cm | 0/330 |
| L3-F16-contactStop | 0.579 | 0.3 cm | 0/288 |
| RH-F6-twoArm (baseline) | 0.416 | 0.4 cm | 4/140 |
| RH-F6-failed (baseline) | 0.211 | 0.2 cm | 0/320 |
| L2-F3-runStop (baseline) | 0.264 | 0.1 cm | 0/330 |

The 22–25 cm tracking errors are the deliberately saturating 3 kN loads. Load release does not launch: peak height at most 0.891 m (stand 0.89 m), peak vertical speed 1.3–1.6 m/s. Support saturation during wrap is higher in L3 than in the RH baseline (twoArm 10 against 4 ticks).

## Plan 06 contact pops and sprint

Peak from 0.4 s.

| Case | L1 (plan 06) | RH | L3 |
| --- | --- | --- | --- |
| Collision | 61.8 cm at 0.58 s, wrist | 18.2 cm at 0.62 s, knee | 19.8 cm at 0.62 s, knee |
| Two-arm | 110.1 cm at 1.00 s, ankle | 26.0 cm at 1.47 s, elbow | 22.6 cm at 0.53 s, elbow |
| One-arm | 94.0 cm at 0.58 s, wrist | 20.0 cm at 0.53 s, elbow | 19.2 cm at 0.53 s, elbow |

The large plan 06 pops are gone, but most of that came from earlier plans: L3 is about level with RH.

**Clearance alternatives no longer jump the shown limb, and the 19–23 cm peaks are collision corrections.** Traced on L3-F4-twoArm, R's free left arm, 0.48–0.56 s, and L3-F3-collision, R's right leg, 0.60–0.62 s:

- Candidate changes are absorbed. At 0.5083 s the chosen arm candidate's departure changes by 1.15 m, and the shown target moves about 4.6 cm.
- The limb is inside the other player's moving body, so it is pushed out at the `CONT_PUSH_MAX_M` limit, 5 cm per substep (about 12 m/s). The arm's target moves about 40 cm in 40 ms.
- The peak is the push stopping once clear (0.5208 s), since the push has no easing. The arm's sharpest values are 13.1 cm at 0.500 s and 22.6 cm at 0.533 s.

As plan item 4 requires, this is reported rather than interpolated through the obstacle. It will still read as a fast limb knock in playback. I traced those two cases only; the one-arm peak matches them in time and limb, but it was not traced separately.

L3-F4-twoArm also has 3 failed plants of 6 in contact, which is honest under contact but worth watching.

Sprint: L3-F16-sprint (added at closeout) matches L2-F11-sprint at 6.5 cm, 1.18 s, left elbow; 9 plants, 0 failed; 18 ownership boundaries, largest 0.6 cm. The torso-proxy self-overlap recorded in plan 06 is a property of the clip on the padded proxy. It was not re-measured and plan 08 does not change it.

## Lifecycle

- 20 resets give stable body, joint and retention counts, and a reset in mid-mode reproduces the fresh run exactly (test).
- In the lab, 20 resets of L3-F9-lift-free hold GPU resources at 35 geometries, 10 textures, 10 programs and 2 model instances. Five rounds of fixture loads hold at 43, 10, 11 and 2.
- 07a checks still pass on the same fixtures: handoff, first-solve and continuity tests are untouched and green.

## Playback

Lab at `npm run dev`, URL form `?fixture=<id>&speed=0.25&cam=side&zoom=0.5`, or `&t=<s>` to run to a time and pause.

**What I reviewed, with results.** Stills: L3-F16-runStop side 2.9, 3.35 s and oblique 3.8, 5.2 s; live 0.25× side samples across the stop; L3-F13-free 2.5 s; L3-F14-forward 1.6, 2.0 s; L3-F7-phase25 0.62, 0.95 s; L3-F6-hold 2.5 s; L3-F4-twoArm 1.0, 1.9 s; L3-F10-both 2.2 s; L3-F8-recontact 0.9 s. The body lowers, knees bend, feet stay on the ground, arms and held hands sit plausibly, and no first-frame ragdoll kick is visible in the frames seen.

**What still needs a human.** A screenshot cannot judge rhythm. Please watch at normal speed and 0.25×:

| Fixture | Look for | Views |
| --- | --- | --- |
| L3-F16-runStop, L3-F16-runStopFree | Recognisable deceleration, distinct catching steps, free-arm brace, stable finish | side, oblique |
| L3-F16-stop2.75 | The late settle at 4.88 s | oblique |
| L3-F16-runStop from 0 s | The 11 cm run start near 0.75 s | side |
| L3-F13-settle2.5, L3-F14-forward, L3-F14-lateral, L3-F14-backward | Idle posture, arm swing size and fade | front, oblique |
| L3-F14-walkRunStop | The 11.7 cm walk-to-run blend at 2.18 s | side |
| L3-F1-low, L3-F7-phase0, L3-F8-recontact | Contact entry at 5.8 cm audit, exit, recontact | oblique |
| L3-F3-collision, L3-F4-twoArm | The 19–23 cm contact peaks | side, oblique |
| L3-F9-convert-contact, L3-F10-both | Conversion during composition | oblique |

## Plan 08a: ball carry

**Plan:** [08a — Ball carry pose and placement](../open/08a_Ball_Carry_Pose_and_Placement.md). Started on the user's "08 finished" on 2026-11-07. Uncommitted. User visual acceptance is outstanding and separate.

**Incoming 08a audit, before the separate leg repair below:** three boundaries exceeded the unchanged 1 cm limit, failing two per-fixture tests:

| Fixture | t | Player, landmark | Delta | Raw | Ownership |
| --- | --- | --- | --- | --- | --- |
| `L3-F9-convert-prep` | 0.5500 | D right knee | 1.18 cm | 1.08 cm | swing follow to step |
| `L3-F9-noProbe-prep` | 0.5000 | D right knee | 1.50 cm | 1.17 cm | swing follow to step |
| `L3-F9-noProbe-prep` | 0.5542 | D left shoe | 1.42 cm | 1.42 cm | swing step to airborne |

None is on the carrier. The carry moves R's arm and palm, so R's ragdoll presents different geometry, contact timing shifts, and D's existing boundaries read higher. On the two knees the ankle moves only 0.21 and 0.11 cm: the knee pole's bounded step (about 0.0186 rad) is amplified because the pole lies nearly along the trailing leg's limb line. On the shoe, the live pose continues smoothly while the old path's clearance push would have jumped. Four leg fixes were tried and reverted, none reaching zero: a knee-bounded alpha bisect (4 over), a first-step pole cap (25 over), a smallest-push bisect (cured the shoe, 2 new elsewhere) and a slewed pole heading (5 over, peak 2.83 cm). Those attempts left the leg code as 08 left it. The following separate repair changes leg composition while preserving the carry fit.

### Leg composition repair (2026-11-07)

**Decision:** repair the shared L3 leg composition, with no exception for the three boundaries and no change to the audit, landmark set or 1 cm limit. This is follow-up work after the user's declaration that 08 is finished; it does not start 09. All work remains uncommitted.

- `stablePole` damps the requested bend-plane turn by the unit pole's perpendicular projection length. A heading becomes less authoritative as the pole approaches the hip–ankle line. The existing displacement limits remain. Only L3 legs opt in; arms and historical leg paths retain the old calculation.
- A leg's clearance correction removes penetration beyond the existing hard-valid surface, with a 1 mm margin, instead of applying the full penetration depth as soon as it crosses that surface. The 1.2 cm hard guard, 1.5 cm candidate tolerance, floor checks, push cap and iteration count are unchanged. This can retain more of the already-allowed overlap than the old full push.
- A new foot owner always starts its departure blend on the continued shown path. Removed the shortcut that immediately adopted a primary request within 8.75 mm; that request-space distance did not guarantee landmark continuity.

**Audit:** 0 of **2450** boundaries over 1 cm, peak **0.893 cm** (incoming: 3/2412, peak 1.503 cm). The number of boundaries changes with plant/ownership timing; none is suppressed. The original three times remain audited:

| Fixture | t | D landmark | Incoming | Repaired |
| --- | --- | --- | --- | --- |
| `L3-F9-convert-prep` | 0.550000 | right knee | 1.18 cm | 0.709 cm |
| `L3-F9-noProbe-prep` | 0.500000 | right knee | 1.50 cm | 0.609 cm |
| `L3-F9-noProbe-prep` | 0.554167 | left shoe | 1.42 cm | 0.426 cm |

**Checks:** **600/600 tests pass** (`npm test -- --maxWorkers=2`, no unhandled errors); build/typecheck pass. The first full run exposed the moved landing assertion below and two worker RPC timeouts; the corrected regression and the reduced-worker rerun are clean. The focused original failures, foot-rate limits and reseed checks pass. A new pole-singularity regression checks that an almost parallel pole retains the achieved bend plane while keeping both segment lengths. The existing negative audit control still rejects a known smooth-achieved-motion boundary over 1 cm. The landing-artifact regression now finds D's next left landing by its old/new request kinds: it moved from 0.467 to 0.767 s, retains a raw 1.88 cm difference, and still records the failed plant as a slide. Its raw-error assertion now requires an excess over the audit's 1 cm limit, rather than the obsolete 1.9 cm observation; the audit acceptance assertion is unchanged.

**Fixture comparison against incoming 08a:** 335 exports, all 238 committed summaries identical; 61 L3 summaries differ, 0 non-L3. All result and ending kinds are unchanged. This comparison reran the archived incoming pose/simulation in an isolated temporary tree and first verified all 97 incoming L3 summaries against the incoming export.

All 18 rule spots move: maximum **7.094 cm**; ending time shifts by at most **12.5 ms**. Values below compare the separately repaired legs with incoming 08a, not with the older palm hold:

| Fixture | Ending time before → after (s) | Ball spot shift (cm) |
| --- | --- | --- |
| `L3-F1-phase0` | 1.12500 → 1.12500 | 0.030 |
| `L3-F1-phase1` | 1.18750 → 1.18750 | 0.030 |
| `L3-F1-phase2` | 1.10000 → 1.10000 | 0.035 |
| `L3-F1-phase3` | 1.16250 → 1.15833 | 2.247 |
| `L3-F1-phase4` | 1.12917 → 1.12917 | 0.020 |
| `L3-F1-phase5` | 1.16250 → 1.15000 | 7.094 |
| `L3-F1-phase6` | 1.08750 → 1.08750 | 0.014 |
| `L3-F1-phase7` | 1.08750 → 1.09167 | 5.906 |
| `L3-F1-mirror0` | 1.16667 → 1.16667 | 0.010 |
| `L3-F1-mirror4` | 1.18750 → 1.19167 | 2.237 |
| `L3-F1-rising` | 1.09583 → 1.10000 | 2.322 |
| `L3-F1-falling` | 1.09583 → 1.09583 | 0.041 |
| `L3-F1-low` | 1.37083 → 1.37083 | 0.041 |
| `L3-F4-twoArm` | 1.15833 → 1.15833 | 0.055 |
| `L3-F4-oneArm` | 1.10000 → 1.10000 | 0.035 |
| `L3-F9-defenderRising` | 1.09583 → 1.10000 | 2.322 |
| `L3-F9-defenderFalling` | 1.09583 → 1.09583 | 0.041 |
| `L3-F10-defender` | 1.09583 → 1.10000 | 2.322 |

**Handoffs:** 10 records change, all D. Carrier handoff times and decisions are unchanged. All changed handoff records that occur are accepted; the one intentional diagnostic rejection remains separate (67 accepted handoffs, 1 rejected across L3). Four D conversions appear/disappear; the other six records change only in time. These remain behavior changes for visual review, not tuning targets:

| Fixture | D incoming → repaired (s; all accepted when present) |
| --- | --- |
| `L3-F1-phase1` | 1.38333 → 1.39583 |
| `L3-F1-phase3` | 1.57917 → none |
| `L3-F1-phase5` | 1.60000 → 1.61667 |
| `L3-F1-phase7` | 1.46667 → none |
| `L3-F1-mirror0` | 1.49583 → 1.51667 |
| `L3-F1-mirror4` | none → 1.69583 |
| `L3-F1-low` | 1.57917 → 1.58333 |
| `L3-F4-twoArm` | 1.41250 → 1.45833 |
| `L3-F9-convert-free` | none → 1.12500 |
| `L3-F9-noProbe-prep` | 0.75417 → 0.76250 |

**Visual evidence:** [local playback gallery](../../evidence/traces/08a-review/index.html), with six recordings at 1× and actual 0.25×, from front, side and oblique, beside sim-6. Loading gaps are removed; donor and sim-7 gait phases are independent. Play the 0.25× captures at the video player's normal speed. Windows cover idle, walk, Fast Run, Sprint, stop/settle, contact/conversion and the original two failing fixtures. The donor stays a free carry reference during sim-7 contact. Fingers remain in the bind pose in both implementations; the open glove is inherited from the donor. User visual acceptance stays outstanding. The frames inspected show the inherited open glove and ball seating; these recordings are provided for the user's continuous visual review, not recorded as visual acceptance. Both rule and no-rule lab fixtures load with no console/page errors or model load errors. Generated local evidence lives under ignored `evidence/traces/08a-review/`, alongside the fixture exports.

**Identity:** `carry-sim6-v1` (`CARRY_L3`, `src/sim/carry.ts`), exported beside `locomotion`. L3 fixtures opt in through `asL3`, with `ballSource: 'carryPose'` on rule profiles. `carryPalm` and `coreOffset` are unchanged.

**Provenance:** sim-6 `src/anim/ballCarry.ts` (keys and swing parameters, values unchanged), `src/movement/football.ts`, `src/rig/carryProbe.ts`, `tests/ballCarry.test.ts`. Model SHA-256 `5aaab36942e3ec558715bad264702b3419dd14f8368cf037cd72af23cc8792d3`, the same in both checkouts. No runtime dependency on sim-6.

**Decisions:**
- The seat is stored as forearm-frame scalars (`CarrySeat`), so it survives conversion and interpolates linearly. `alongM` scales with forearm length against the fitted 0.23217 m.
- A rested palm faces along the forearm's hinge axis, about 81° from the donor's hold. The forearm bone rolls about its segment Y as the donor's does (`rollRad`, in `RigAdapter`); the physics segment keeps its hinge frame.
- The sampled swing is scaled by the clip's `carryShare`. Walk share 0 gives a settled hold; with the full swing the wrist ranged 13.5 cm.
- Ready hands leave the carry in place. An achieved arm keeps authority, publishing the seat with no wrist flex. No L3 fixture currently achieves the carrying arm; the test forces it.
- The published palm sits at the seat. The solved chain's end stays as `reach`, where the arm's request and `targetResidualM` are measured.
- Scenes with rules draw the ball in `RuleOverlay`; scenes without draw it in `PlayerView`. Each draws one.

**Mesh seating** through `RigAdapter`, worst value of each measure in metres (donor tolerances: torso > -0.08, upper > -0.1, forearm -0.05 to 0.02, front < 0.02, tip < 0.04):

| Gait | Samples | Torso | Upper arm | Forearm low | Forearm high | Front | Tip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sprint | 25 | -0.060 | -0.029 | -0.022 | -0.008 | -0.005 | 0.028 |
| Fast run | 33 | -0.036 | -0.021 | -0.022 | -0.008 | -0.005 | 0.028 |
| Stand | 5 | 0.010 | -0.021 | -0.016 | -0.016 | -0.005 | 0.020 |
| Walk | 15 | 0.010 | -0.021 | -0.016 | -0.016 | -0.005 | 0.020 |

A ball shifted 10 cm forward, 8 cm back or 9 cm off the forearm fails, as does a hand flex negated or zeroed, and a palm roll of π. The donor's 25° shoulder swing passes unweakened, and the swing runs opposite the free arm (correlation below -0.7).

**Summaries.** 238 of 238 committed are identical. Against the 08 baseline, 41 L3 summaries changed and no others. No result changed, and no rule ending changed kind. D's representation changed in 4 fixtures, matching the handoff table below.

Rule ball spots, all 18 endings `groundDown`, moved 7.5 to 24.0 cm, mean 13.9 cm, because the reference moved from the palm to the seated ball:

| Fixture | Spot moved | Ending t, palm hold then carry |
| --- | --- | --- |
| `L3-F1-phase0` | 16.3 cm | 1.113 then 1.125 |
| `L3-F1-phase1` | 10.1 cm | 1.192 then 1.188 |
| `L3-F1-phase2` | 14.8 cm | 1.096 then 1.100 |
| `L3-F1-phase3` | 17.3 cm | 1.158 then 1.163 |
| `L3-F1-phase4` | 8.8 cm | 1.137 then 1.129 |
| `L3-F1-phase5` | 15.0 cm | 1.158 then 1.163 |
| `L3-F1-phase6` | 13.2 cm | 1.087 unchanged |
| `L3-F1-phase7` | 7.5 cm | 1.104 then 1.087 |
| `L3-F1-mirror0` | 20.6 cm | 1.163 then 1.167 |
| `L3-F1-mirror4` | 24.0 cm | 1.188 unchanged |
| `L3-F1-rising` | 14.0 cm | 1.092 then 1.096 |
| `L3-F1-falling` | 13.8 cm | 1.092 then 1.096 |
| `L3-F1-low` | 10.8 cm | 1.379 then 1.371 |
| `L3-F4-twoArm` | 7.9 cm | 1.158 unchanged |
| `L3-F4-oneArm` | 14.8 cm | 1.096 then 1.100 |
| `L3-F9-defenderRising` | 14.0 cm | 1.092 then 1.096 |
| `L3-F9-defenderFalling` | 13.8 cm | 1.092 then 1.096 |
| `L3-F10-defender` | 14.0 cm | 1.092 then 1.096 |

Handoffs: R's accepted times are unchanged everywhere. D's changed in 11 fixtures, all accepted. The one rejection across L3 is `L3-F11-invalid`, by design.

| Fixture | D, palm hold | D, carry |
| --- | --- | --- |
| `L3-F1-phase1` | 1.471 | 1.383 |
| `L3-F1-phase3` | 1.558 | 1.579 |
| `L3-F1-phase4` | 1.288 | none |
| `L3-F1-phase5` | 1.475 | 1.600 |
| `L3-F1-phase7` | 1.308 | 1.467 |
| `L3-F1-mirror0` | none | 1.496 |
| `L3-F1-low` | 1.563 | 1.579 |
| `L3-F4-twoArm` | 1.304 | 1.413 |
| `L3-F9-convert-free` | 0.842 | none |
| `L3-F9-noProbe-free` | none | 0.775 |
| `L3-F9-noProbe-prep` | 0.762 | 0.754 |

`tests/transitions.test.ts` "gathers speed" now finds D's boundary near 1.517 s, which moved with the same timing shift.

**Checked in the lab** at `L3-F16-sprint` and `L3-F1-phase0`: loads with no console errors, one ball in the scene with rules and one in the scene without. Fingers stay in the bind pose, as planned, so the glove stands open past the nose. That was a look at single frames, not a visual review.

**Reproduce:** `npx vitest run tests/ball-carry.test.ts tests/ball-carry-mesh.test.ts`; `npx vite-node scripts/probe/p08a-over.ts` lists boundaries over 1 cm; `npx vite-node scripts/probe/p08a-spots.ts` compares spots and handoffs against the palm hold; `npx vite-node scripts/probe/p08a-diff.ts <fixture>` shows the first trace difference.

Visual review for the user: complete cycles and transitions at normal speed and 0.25×, front, side and oblique, beside the donor. Open plan items: nose under the hand, ball against the forearm, shoulder swing, stable idle, no detachment or twist at contact, stop or conversion.

## Remaining limits

Open from this plan:
1. Visual review of the repaired handovers is outstanding. 110 boundaries pass with a carried foot, whose correction is spread after the boundary and is not visible to the same-time audit. See [the plan's wording](#where-the-repair-differs-from-the-plans-wording).
2. 54 boundaries pass on a corrected reference and are over 1 cm raw. Each names a demonstrated artifact, and that is a judgement on the old path, not a measurement of the new one.
3. Limb second differences in contact exceed 1 cm at 353 boundaries. Passing the same-time limit does not make contact smooth.
4. D's handoff outcome moved in 5 fixtures, then back in `L3-F1-phase2` and `L3-F4-oneArm`, and `L3-F1-low` still falls about 0.5 s sooner than incoming. Not reviewed visually.
5. Run start 11.0 cm, walk-to-run 11.7 cm and the hard stop 9.7 cm are incoming figures, not re-measured at closeout.
6. Contact peaks of 19-23 cm were last measured before these repairs: a free limb pushed out of a moving body, stopping sharply once clear.
7. Clamp churn remains high: `L3-F6-hold` has 739 `clampBegin`.
8. `reach` still ends most plants in a stop.
9. The 20.89 m/s planner step at the start of `L3-F3-side` is not explained.
10. [08a's separate leg repair](#leg-composition-repair-2026-11-07) passes the unchanged audit (0/2450, peak 0.893 cm), but changes 10 D handoff records, including four conversions appearing/disappearing. Visual acceptance remains open.

Declared approximations, unchanged:
- Bounded suspension support, including visual flight without ballistic gait.
- Simple gait heuristics.
- Coarse ragdoll with a frozen shoe-to-shin relationship.
- Omitted relative limb-swing velocities at handoff; bulk transfer remains the audited approximation.

Plan 09's fall responses do not remove these and belong to a separate milestone.

## Reproduce

```sh
npx tsc --noEmit -p .
npx vitest run
npm run fixtures
npm run build
npx vite-node scripts/probe/p08-audit-all.ts           # transition audit, summary and kinds
npx vite-node scripts/probe/p08-over.ts                # every boundary over 1 cm, with both compositions' legs
npx vite-node scripts/probe/p08-rates.ts '^L3-' all    # foot rates inside and outside the planner
npx vite-node scripts/probe/p08-carry.ts               # first updates of a step with no reseed, against both caps
npx vite-node scripts/probe/p08-groups.ts              # the audit by scenario, what the raw boundaries set aside, carried feet
npx vite-node scripts/probe/p08-whistle.ts             # the motor's request after a referee ending in a walk
npx vite-node scripts/probe/p08-stops.ts               # the stop report
npx vite-node scripts/probe/p08-audit.ts '<id regex>' 10
npx vite-node scripts/probe/p08-baseline.ts            # baseline against L3
npx vite-node scripts/probe/p08-sweep.ts '<id regex>' 2.4
npx vite-node scripts/probe/p08-height.ts '<id regex>'
npx vite-node scripts/probe/p08-handoffs.ts            # rejections across L3
npx vite-node scripts/probe/p08-table.ts               # over 1 cm, raw and achieved motion by scenario and kind
npx vite-node scripts/probe/p08-rawover.ts             # every boundary over 1 cm raw
npx vite-node scripts/probe/p08-review.ts              # the boundaries the reviews named, as the audit reads them now
npx vite-node scripts/probe/p08-final.ts               # conversions, rejections and every failed plant across L3
npx vite-node scripts/probe/p08-trace.ts <id> <player> <from> <to> [side]   # one player's legs at actual substeps
```

New files: `src/sim/locomotion.ts`, `src/sim/fixtures/transitions.ts`, `tests/transitions.test.ts`, `scripts/model/idle-intake.ts`, `src/sim/model/idle-pose.record.json`, `models/animations/idle.json`, `models/animations/source/idle.fbx`, `scripts/probe/p08-*.ts`.
