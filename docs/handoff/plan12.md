# Plan 12 handoff: joint range for shoulders and ankles

Plan: [12 — Joint range: shoulders and ankles](../open/12_Joint_Range_Limits.md). Implemented 2026-11-09 on `model-integration` after `baa512c` (plan 11), in its own commit.

**Result:**
- The full suite passes: 845 tests in 24 files. Typecheck and build pass. 410 fixtures export.
- Every G, L1, L2 and RH export is byte-identical to `baa512c`. Each of the 216 traces was compared byte for byte against traces regenerated at that commit, and their 216 summaries are identical.
- All 194 L3, L4 and HC exports change, because they record the profile.
  - 175 of their summaries change: HC 20, L3 81, L4 74. 19 are identical.
  - No result changes. 30 endings move by −33 to +100 ms.
- There is one new ragdoll validation failure, against the plan's acceptance. L4-F10-wrap-off D is rejected for external penetration. The user accepted it as a known limit (see [Known limits](#known-limits)); resolved in plan 13 ([13f](plan13.md#13f--conversion-overlap-margin)).

## User decisions

From the plan (2026-11-09):
- **Shoulder back limit:** 45° behind the side line with the arm hanging, 30° with it raised. One shared cone (approach A).
- **Forward preference:** a hard limit plus a small cost. The ragdoll gets the limit only.
- **Ankle:** 25° dorsiflexion at most. Past it, the heel lifts.
- **Limp foot:** eases to 15° toe-down over 0.3 s.
- **Collarbones:** not moved.
- **Evidence:** an opt-in profile on L3, L4 and HC. Older exports stay byte-identical.

During the build (2026-11-09):
- **Ankle.** At 25° (and still at 35°) the plan's "no new mechanism" heel lift broke the plan 07/08 stop footing. The heel plant jumped to a toe-corner pivot, and the plant failed as a slide. The user chose to **build a real heel-lift mechanism**: plant on the ball of the foot, contact continuous, keep 25°, and re-verify the stop tests against the plan 08 stop rules.
- **Shoulder.** No single cone keeps plan 09's across-chest range together with the new back limit, so L4 brace outcomes change. The user chose to **accept the approved cone and update those tests**, each listed below with its reason. The 0.32 s persistence case is reported as a known limit.

At the handoff (2026-11-09):
- **L4-F10-wrap-off conversion rejection:** accepted as a known limit. The margin between the pose's leg guard and the conversion tolerance becomes its own plan. The 8 cm limp-foot hold near other players is kept.

## What changed

**Profile** (`profiles.ts`):
- `JointRangeProfile` and `JOINT_RANGE_V1` (`joint-range-v1`):
  - The shoulder is `ENVELOPE_L4.shoulder` with the cone tilt 67.5° toward 25°, 110° along and 95° across.
  - `forwardCostM` is 0.01.
  - The ankle is 25° dorsi and 50° plantar.
  - The limp foot is 15° over 0.3 s.
- `FixtureDef.jointRange` is set by `asL3`, `asL4` and the HC `label`. It is exported in `profileIds` and `profiles`.
- `withJointRange` (applied in `Simulation.create`) gives the ragdoll the profile's shoulder:
  - An L4 envelope keeps its hips; its id is `envelope-l4-v2+joint-range-v1`.
  - L3 and HC get the shoulder-only `envelope-joint-range-v1`. `RagdollEnvelope.hip` is now optional.
- A fall response still needs an envelope with hips.

**Cone** (`joint-cone.ts`, new):
- `swingExcess`, `swingExtentDeg` and `clampDirToEnvelope` moved here from ragdoll.ts, which re-exports them.
- New: `behindDeg`.

**Supported pose** (`pose.ts`):
- Each procedural arm candidate whose upper arm is outside the cone is turned rigidly about the shoulder onto the boundary, with the elbow bend kept.
- A candidate behind the side line pays `forwardCostM` per 30° behind.

**Arm-task arms** (`arms.ts`):
- In `solveArm`, a pole with the upper arm past the cone is invalid.
- If every pole is invalid, the least-bad one is kept, ranked by depth past the surface tolerance and then by range excess.

**Ragdoll shoulders:** the plan 09 soft envelope, unchanged, on the new cone. The fall response's brace clamp reads the same cone.

**Supported ankles** (`pose.ts` `legSolver`):
- On ground-relative legs the pitch is clamped at −25° (it was −45°). The legacy L1 limit is unchanged.
- `legInfo.rangeLiftM` reports the part of the floor lift that the range limit makes.

**Heel lift** (`footwork.ts`, `foot-compose.ts`, `step-path.ts`, `pose-runtime.ts`), on `FootPlanInput.heelLift`, which is set when the fixture has a joint-range profile:
- **Touchdown.** A foot tilted toe down past its planned contact lands on its lowest sole corner, the ball of the foot (`ballOfFoot`, `lowestCorner`, `proposeOnCorner`).
- **Arrival.** A lifted foot has arrived when it is horizontally over its target and inside the plant reach margin.
- **Reach.** A planted foot standing on its toe with the heel lifted is read where its ankle is (`plantedAnkle`), for reach, step triggers and the plant target.
- **Home error.** Home error is measured at the footprint, so a heel turning about the ball does not move it.
- **Stance step.** A heel-lift stance step keeps at least the time its horizontal path needs (`fitStance`).
- **Handover.** A step held up at the range limit is compared with the clip at the height it is shown (`joinsRequest`).
- **Not a hold.** `heldOff` does not count the range floor lift as a hold.
- **Plant pivot.** In the pose, a continuing plant whose knee pole is still blending keeps its sole point on the anchor at the blended pole (`plantIk`). The foot then turns about that point.
- **Sole angle.** Under the profile, `soleAngle` is in the measure the next solve applies (shin angle less pitch).
- **Dead stop** (`boundedHorizon`, ungated). A dead stop in the last substep also needs the change from the last substep's motion to be within the limit. Every G, L1, L2 and RH export is byte-identical with it.

**Limp foot** (`ragdoll.ts` `easeLimpFeet`, `simulation.ts`):
- At conversion the shoe pitch is clamped to [−25°, 50°].
- In each substep, before the envelope, each shoe turns toward 15° at its own rate: the conversion difference divided by 0.3 s.
- The collider's pose on the shin, the landmark and the published `anklePitchDeg` follow.
- The shin's mass properties are recomputed at once. Rapier 0.21 updates them only at the next step, after that substep's effort planning (`.scratch/jr12/mass.ts`).
- **Fallback (changed from the plan's).** The plan proposed holding the ease while the shoe is in ground contact. Instead, the ease holds while the turned shoe would come closer to another player than `LIMP_SHOE_CLEARANCE_M` (8 cm). "Another player" means its active colliders, or the published limbs of a player that can still convert. The floor and obstacles are not counted.
  - Why: the turn is kinematic, and the ground was never the problem. Without the hold, a turned shoe left the other player's convertible thigh inside it, and that player's conversion failed:
    - L3-F9-noProbe-contact: 1.5 cm at a 2 cm margin.
    - HC-F3-phase75: 2.3 cm at a 5 cm margin.

**Transition audit** (`transition-audit.ts`): across a support change, the old composition's continued feet keep the old ground height (`AuditPrev.groundY`). L3-F1-mirror4 D's probe read a body under its feet: the ground went from 0 to 0.103 m at 1.4333 s, which raised the old step's arc.

## Measurements (all 194 L3, L4 and HC fixtures, every tick)

Probe: `.scratch/jr12/accept.ts` (untracked). "Twin" is the same fixture with `jointRange` removed. Excess is the swing past the new cone, in degrees, with negative values inside it.

| Check | Twin | With the profile |
| --- | --- | --- |
| Supported pose arm, worst excess | 55.4° (L3-F6-holdMirror R.right) | **0.000°** (on the boundary) |
| Arm-task arm, worst excess | −5.4° (inside) | **−6.3°** (inside) |
| Ragdoll shoulder, worst swing excess | 79.0° (L3-F9-noProbe-free R.left) | **17.8°** (L3-F9-playerBelow A.left, 1.30 s) |
| Ragdoll arm-ticks more than 5° past | 11.45% of 37,684 | **0.18%** of 37,884 |
| Supported ankle, lowest pitch | −45.0° | **−25.000°** |

**Ragdoll shoulder over-tolerance runs.** These come from the envelope evidence of each of the 382 accepted ragdoll shoulders. That excess includes twist, scaled by cos(swing / 2).
- Persistence-tagged (over tolerance for at least `persistS`, 0.25 s): **one**, L4-F3-model-oblique-off R's right shoulder, 11.0° for 0.32 s. That is the runner's arm pinned under its own body with the response off; the soft limit is capped at 500 N·m.
- Every other run past 5° lasts 0.12 s or less. The longest is L3-F1-phase0 R's right shoulder, 8.8° for 0.117 s. The deepest is L4-F9-defenderFalling R's right shoulder, 33.5° for 0.05 s, an impact load.
- **Start slack at conversion:**
  - Swing slack is **0** on all 382 shoulders, as the plan expected: supported arms are inside the cone when the player goes limp.
  - 17 shoulders start with twist slack, up to 52.6° (L3-F1-mirror4 D's right shoulder). This is the declared limit, because supported twist is not limited. The baseline had one such case, but before this plan only the L4 ragdolls had an envelope.
  - The split comes from `.scratch/jr12/slack.ts`.

**Ragdoll feet.** These are the 382 limp feet of the accepted conversions.
- At conversion, **every** foot is within [−25°, 50°]. In the twin, feet convert down to −45°.
- 0.35 s after conversion:
  - 317 are within 1° of 15°.
  - 24 are in runs that end first.
  - 41 are held by the near-player fallback, listed below.
  - **None** is off the relaxed pitch without the fallback in force.
- Held feet, by their pitch 0.35 s after conversion:
  - HC-F1: mirror R.right −12.8°; at0.9 D.left −19.0°, R.left −10.0°; at1.6 D.right −6.5°, R.left −8.2°; low D.right 11.1°, R.left −19.4°; lowMirror D.left 12.2°, R.right −23.3°.
  - HC-F2-bothFallL2 A.right 14.0°.
  - HC-F3: mirror R.left 24.0°; phase0 R.right 19.0°; phase75 R.left 11.0°, R.right 26.6°; rising R.right 23.9°.
  - HC-F5-strictTransfer R.right 20.1°, D.right 13.3°.
  - L3-F1: phase2 R.right 11.7°; phase7 R.right 13.9°; low R.right 13.5°.
  - L3-F3-collision R.right 11.7°. L3-F4-oneArm R.right 11.7°.
  - L3-F9: noProbe-prep R.right 1.7°; noProbe-contact R.left 1.1°, R.right −4.4°; low R.right 7.2°; playerBelow A.right 11.6°.
  - L3-F10: both R.left 3.3°; bothMirror D.left 7.2°, D.right 3.9°, R.right −18.3°; bothLow R.left −10.6°; rising D.left 6.5°.
  - L4-F5-twoClamp: on R.left 8.0°; off R.left 3.8°.
  - L4-F9: low R.right 5.6°; both R.left 8.0°.
  - L4-F10: knee-on R.left 11.9°; knee-off R.left 8.5°; elbow-on R.right 13.5°; elbow-off R.right 14.0°.

**No physics regressions:**
- **Power audit.** No plan 09 power audit substep is over its ceiling: 0 `fallEffortOver` events in 54 fall-response episodes. The falls test asserts `overPowerSubsteps` 0 on every response fixture.
- **Transfer.** There is no transfer audit failure, energy gain or anchor failure that the baseline lacks.
  - `handoffAuditFailure`: 4 before and 4 after, all in the deliberate failed-transfer fixtures.
  - `numericalFailure`: 0.
- **External penetration.** There is **one new `handoffRejected`**: L4-F10-wrap-off D for `externalPenetration` (see [Known limits](#known-limits)). The other three are the deliberate invalid-conversion fixtures, unchanged.

## Regressions (`tests/joint-range.test.ts`, 8 tests)

| Check | Shown failing by |
| --- | --- |
| The profile is on for exactly L3, L4 and HC; L3-F16-sprint's export records it; L2-F14-oneArmFeet's has none | — |
| Cone values: 44.5° behind hanging, 44.9° at 45° elevation, 30.5° at horizontal; forward and out about unlimited | — |
| Pose arms ≤ 0.5° past the cone: L3-F9-convert-prep, L3-F16-sprint | twin's sprint > 4° past (asserted) |
| Arm-task arms inside the cone: HC-F5-invalidOne, L3-F4-twoArm, L4-F5-onePalm-on, L4-F6-break | a guard: the twins never exceed it either |
| Ragdoll shoulders: HC-F3-phase0, HC-F3-lowRunner, L3-F1-phase0, L3-F1-low stay behind < twin − 20°, with every over-5° run shorter than `persistS` and excess < 15° | each twin > 45° behind (asserted) |
| Ragdoll shoulders: HC-F1-low stays within 5° | twin > 5° past (asserted); its twin is only 26.6° behind |
| Supported ankles ≥ −25°: HC-F1-low, L3-F1-low, L3-F16-sprint | each twin < −35° (asserted) |
| Heel lift: planted feet never past −25°, with the plant gap and feature height within `plantTolM` and at least as many planted ticks as the twin | twin's planted feet > 10° past (asserted) |
| Ragdoll feet: L4-F3-forward-on, L4-F8-passive, HC-F1-low are in range at conversion and within 1° of 15° at +0.35 s unless held; the held set is exactly HC-F1-low D.right and R.left | twin converts below −25° (asserted) |

## Tests changed

**`transitions-modes`:**
- "asL3 keeps the source fixture and only adds the profiles": `jointRange` is one more added profile.
- L3-F16-runStop plant before 3.33 s (it was 3.3 s). The plant is at 3.325 s: the stance foot rises onto its toes and stays within reach 46 ms longer, and the step keeps the time its path needs. The plan 08 stop rules still hold: one foot then the other, and the planner takes the legs only when the foot in the air can land in time.

**`foot-continuity`:**
- **Chase start.** A step one row old started from the achieved request, not from the old owner's target. The two differ where the pose lifts a foot at its ankle limit off the floor.
- **Lift-cap cut.** The chase vertical-acceleration limit adds what the 1.5 m/s lift cap takes off a faster start, as B1 does for the speed cap. L3-F9-noProbe-exit D's left foot reseeds at 0.6875 s from an ankle that the lifted hip carries up at 1.70 m/s.
- **Out-of-time reproduction re-pinned.** D's left foot near 0.054 s now lands on time, because the heel-lift stance step keeps the time it needs. The test now pins R's left foot near 0.583 s, which runs out of time at over 3 m/s and is still moving after it.

**`transitions-audit`:**
- **Known audit pin** (`KNOWN_AUDIT`). L3-F7-mirror0 at 0.7875 s, R's left ankle, is bounded at 1.01 cm (1.009 cm against the 1 cm limit). R's left foot is on its toe at the ankle limit and lifts into a step inside a contact pile. The new owner turns its heading at its yaw rate and takes the achieved foot angle. The shown leg also leaves clearance variant 1 for the primary.
- **Reseed with no mode change.** The test moved from L3-F1-phase5 (three D reseeds) to L3-F7-phase75 R's right foot at 0.5417 s. With the ankle range and heel lift, the L3-F1-phase5 proposals no longer fail.
- **A step compared with its old path.** The test moved from L3-F1-low to L3-F1-phase5 (D's only supported-to-airborne boundary, at 1.55 s). L3-F1-low's D no longer loses support on a step.
- **Negative control** (crossing body heading on L3-F7-loadRelease). It now runs without the joint-range profile: with the profile, D's run into contact changes and the faulted crossing stays under 1 cm.
- **Held-leg handover.** `9-noProbe-exit` was added to the fixture list. The overdue step that loses support moved out of the other runs with the heel lift; noProbe-exit R's right foot has one at 0.6333 s.

**`handoff-contact`:** "no limb jump over 0.3 m" bounds HC-F5-invalidOne at 0.5 m. D is left a rigid falling proxy by its deliberately invalid conversion, and it clamps R with its right forearm. At 2.10 s every arm-task pole but one puts the arm 0.6–13 cm into R, and the one clear pole has the elbow 0.50 m away. The twin's arm, on another path, never gets there.

**`falls`:** 16 updates, all from the narrower shoulder (the user's ruling).
1. **Persistence.** L4-F3-model-oblique-off R's right shoulder is bounded at 0.33 s (it measures 0.32 s). This is the known limit.
2. **Slack test.** It reads the shoulder in force, `rag.profile.envelope.shoulder`, and asserts that it equals `JOINT_RANGE_V1.shoulder`.
3. **Impact test.** It skips a ragdoll accepted less than one ramp before the run ends. Such a ragdoll has a handful of substeps, too few to compare:
   - L4-F5-twoPalm-on R converts 29 ms before the end.
   - L4-F10-elbow-on D converts 71 ms before the end.
4. **L4-F2 forward.** It asserts `activeSubsteps > 0` instead of positive work. The plain forward fall only brakes; the twin pushed 0.28 J.
5. **L4-F3-model-side-on.** It misses `tooFar` (it was `late`). The brace point is now outside the range.
6. **L4-F3-oblique-on and L4-F3-side-on.** These moved to a new test:
   - The free arm misses `left late`, with no contact.
   - The carry arm stays on protect.
   - The twin's palm landed at 0.308 s.
7. **Brace-contact list.** It is now forward-on, run-on, model-forward-on and model-oblique-on.
8. **L4-F4-late.** It misses `tooFar` before it is late.
9. **L4-F4-obstructed.** A new test: the arm, inside the range, passes clear of the obstruction and lands `left palm`. The twin misses `obstructed`.
10. **Obstructed count.** It is at least 3 (it was 4), because L4-F4-obstructed lands instead.
11. **L4-F6-break.** D's left arm misses `expired` (it was `late`).
12. **L4-F5-onePalm-on:**
    - The held runner leaves the hold at 1.846 s (its feet released at 0.996 s; the twin's at 1.17 s).
    - Contact is `right palm`, the miss is `left expired`, and gripRelease is `left separation`.
13. **Allocation.** The scaled effort count is > 20 (29 measured; it was > 50). The L4-F5 runner leaves its holds sooner.
14. **Hold twin:**
    - Exposure with the response on is ≤ exposure with it off: 0.018 on and 0.020 off, where both were 0.
    - The off twin's holds end `right separation, left separation`.
    - The shared-budget scaling assertion was removed: this run's effort no longer meets the budget.
15. **L4-F11 work caps.** The caps are [0, 0.5, 1, 2, 5, 15]. The uncapped fall now does 18.6 J (the twin 20.0 J), so 20 J no longer binds.
16. **L4-F12 mirror:**
    - Neither fall reaches the floor in time. The twins' landing arm arrived at 0.32–0.33 s.
    - The mirrored arms miss within 0.03 s of each other.
    - The base's right reason equals the mirror's left reason; the base's left (`late`) and the mirror's right (`tooFar`) differ, at the edge of the reach test.
    - The work difference is < 8.
    - The deck is 4 m (it was 2 m): the fall now carries the palm past a 2 m edge.

## Changed summaries

There are no result changes. The other differences are in players' end states, events and `minPairGap` (53 summaries). These are the 30 endings that move:

| Fixture | Ending (s) |
| --- | --- |
| HC-F3-phase0 | 1.6167 → 1.65 |
| HC-F3-phase75, -falling | 1.6833 → 1.7 |
| HC-F3-rising | 1.6667 → 1.6333 |
| HC-F3-lowRunner | 2.0667 → 2.0833 |
| L3-F1-phase0 | 1.6167 → 1.7167 |
| L3-F1-phase1 | 1.6833 → 1.75 |
| L3-F1-phase3 | 1.6667 → 1.7167 |
| L3-F1-phase4 | 1.65 → 1.7 |
| L3-F1-phase5 | 1.6667 → 1.7333 |
| L3-F1-mirror0 | 1.6833 → 1.7167 |
| L3-F1-mirror4 | 1.7333 → 1.7667 |
| L3-F1-phase7 | 1.6 → 1.5667 |
| L3-F1-low | 1.8667 → 1.85 |
| L3-F1-phase2, -phase6, -rising, -falling; L3-F4-oneArm; L3-F9-defenderRising, -defenderFalling; L3-F10-defender; L4-F5-oneClamp-off | 1.6 → 1.5833 |
| L3-F4-twoArm | 1.65 → 1.7333 |
| L4-F10-elbow-on | 0.8333 → 0.85 |
| L4-F10-elbow-off | 0.8167 → 0.8333 |
| L4-F10-wrap-on | 1.6667 → 1.75 |
| L4-F10-wrap-off | 1.65 → 1.7333 |
| L4-F10-palm-on (`runnerCoreDown`) | 0.9333 → 0.9667 |
| L4-F10-palm-off (`runnerCoreDown`) | 0.9167 → 0.9333 |

All other endings are `groundDown`.

## Known limits

- **Resolved (plan 13): L4-F10-wrap-off D's conversion rejection.** It no longer occurs from plan 13d on (Fast Run's contact timing), and under plan 13f's predictive leg guard D converts in both body orders, at 1.19 cm forward and 1.26 cm reversed ([plan 13f handoff](plan13.md#13f--conversion-overlap-margin)). The original record:
- **New conversion rejection: L4-F10-wrap-off D.** This goes against the acceptance line "no new ragdoll validation failure".
  - **What happens.** At 1.392 s, D's supported left thigh is 1.88 cm inside R's ragdoll right thigh, and the conversion tolerance is 1.5 cm. D is left a rigid falling proxy. The result (`groundDown`) holds, and the ending moves +83 ms.
  - **Pre-existing tangle.** The legs were tangled before plan 12. In the twin, D's legs sit 1.0–1.5 cm inside R for 0.2 s, and its conversion at 1.433 s was accepted at 1.17 cm, thigh in shin. The pose guard (`HARD_OK`, 1.2 cm) holds the leg on the tick. R's ragdoll moves 0.7 cm more into it in the substep before the conversion.
  - **Not one cause.** The case is chaotic. Variants with the old shoulder alone, or the 45° ankle alone, convert. A variant with the limp-foot ease off is rejected on another pair (1.56 cm, right thigh in R's torso).
  - **Status.** Accepted as a known limit (user ruling, 2026-11-09). A fix belongs to the conversion and pose-guard margin, outside this plan, and would touch older fixtures; it is left to [plan 13f](../open/13f_Conversion_Overlap_Margin.md).
- **Known pins:**
  - L3-F7-mirror0 audit 1.009 cm (`transitions-audit` `KNOWN_AUDIT`).
  - HC-F5-invalidOne elbow 0.50 m (`handoff-contact`).
  - L4-F3-model-oblique-off right shoulder, 0.32 s over tolerance (`falls`).
- **Limp-foot fallback.** The fallback holds feet near other players, not in ground contact, and it holds 41 of 382 feet past 0.35 s. In crouch piles (HC-F1, L3-F10) a held foot can stay toe-up near −23° until the run ends.
- **L4-F4-obstructed** no longer exercises an obstruction: its arm, inside the range, passes clear and lands. The obstructed-miss reason is still covered by three other falls.
- **Arm-task check is a guard only.** The twins' arm-task arms never exceed the new cone (worst −5.4°), so the check cannot be shown failing.
- **HC-F1-low twin** is only 26.6° behind, not past 45°. Its regression asserts the excess (twin > 5° past, with the profile ≤ 5°) instead.
- **From the plan:**
  - Supported twist is not limited.
  - The ragdoll limit is soft (500 N·m cap).
  - Collarbones do not move.
  - Heel lift moves crouch-fixture endings (listed above).
- Visual acceptance on the skinned mesh is outstanding.

## Reproduction

- `npx vitest run tests/joint-range.test.ts`
- `npm run fixtures`, then compare `evidence/summary.json` with `git show baa512c:evidence/summary.json`, and the G, L1, L2 and RH traces with traces regenerated at `baa512c`.
- Acceptance sweep: `npx vite-node .scratch/jr12/accept.ts`, and `OFF=1` for the twins (untracked).
