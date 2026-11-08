# Plan 08 review closeout

Repository-aligned plan • 2026-11-05; follow-up review 2026-11-06 • Initial, follow-up and second review repairs implemented; results are in the [handoff](../handoff/plan08.md#second-review-repairs-2026-11-07). User visual acceptance is outstanding: do not accept 08 or start 09 before it. This is closeout work within 08, not another locomotion milestone.

Parent: [08 — Locomotion transitions and tackle integration](08_Locomotion_Transitions_and_Tackle_Integration.md). Incoming implementation: [plan 08 handoff](../handoff/plan08.md). Next after acceptance: [09 — Active falls](09_Active_Falls_Joint_Limits_and_Role_Responses.md).

## Current fix plan — independent review, 2026-11-06

**Verdict: not accepted.** Review reproduced 557 passing tests and 6 failures out of 563; typecheck/build pass. All 335 fixtures ran headlessly, and all 238 committed summaries reproduced unchanged. The six failing fixtures contain seven boundaries over 1 cm under the current audit. Visual playback was not checked in this review.

Implement the following three fixes in order. Preserve the existing implementation and the physical/validation boundaries below. The later sections record the initial closeout's incoming evidence and repair requirements; they are not a claim that those old reproductions still fail. This section sets the current execution order.

### 1. Restore the same-time continuity audit (P1)

**Problem:** `Simulation.recordTransition` takes the per-landmark minimum of the raw old/new comparison, a request-corrected comparison and achieved body-frame motion extrapolated from two earlier substeps. Smooth achieved motion can therefore make a failed same-time comparison pass. In `L3-F3-side`, R at 0.320833 s, the raw difference is 5.15 cm, no request jump is recorded, and the audit passes at 0.44 cm. This does not establish the required old/new composition limit.

**Fix:** reconstruct one valid old composition at the same solved state/time as the new composition, using copied planner, sampler and pose memory. Correct demonstrated reference artifacts at their source. Keep raw differences, request corrections and achieved-motion measurements separate; do not select whichever measurement is smallest to decide acceptance. Retain all landmarks and the 0.01 m threshold.

**Regression:** use the landing reproduction above to establish why the reference is valid. Add a negative control where a known old/new pose difference over 1 cm still fails even when achieved motion is smooth. Preserve identical live traces/events with the audit enabled and disabled.

Relevant code: `src/sim/simulation.ts` (`auditInput`, `recordTransition`), `src/sim/footwork.ts` (`continueOwners`), and the transition-audit tests in `tests/transitions.test.ts`.

### 2. Resolve the remaining transition failures (P1)

The current audit reports these boundaries; rerun the complete L3 audit after fix 1 because its result may change:

| Fixture | Time (s) | Player / landmark | Difference (cm) |
| --- | --- | --- | --- |
| `L3-F1-phase0` | 0.479167 | D / left ankle | 2.57 |
| `L3-F1-phase1` | 0.483333 | D / left knee | 1.35 |
| `L3-F1-phase1` | 0.491667 | D / left knee | 1.39 |
| `L3-F1-phase6` | 0.479167 | D / left knee | 1.12 |
| `L3-F1-phase7` | 1.120833 | D / left palm | 1.17 |
| `L3-F3-side` | 0.466667 | D / left shoe | 1.96 |
| `L3-F4-twoArm` | 0.475000 | D / right knee | 1.49 |

**Fix:** trace each failure at actual substeps, including ownership, achieved motion, requests, sole/pole blends, clearance candidate/push-out and continuity memory. Repair genuine corrections in the shared foot/arm handover path, starting from the achieved pose and motion. The palm case changes from ready to free ownership and must be covered alongside the foot transitions. Do not tune fixtures, stance widths or force budgets merely to remove these reproductions.

**Acceptance:** all required transitions meet the corrected same-time 1 cm limit. A comparison artifact needs a regression and a corrected reference. An infeasible contact remains an explicit failure, as the user required; it is not a passing exception. Retain substep rate checks, honest plant failures, retained-arm geometry and the accepted 07a candidate/transfer/first-solve checks.

Relevant code: `src/sim/footwork.ts`, `src/sim/pose.ts`, and the all-L3 continuity assertion in `tests/transitions.test.ts`.

### 3. Preserve the original controller request through the walking ramp (P2)

**Problem:** `rampWalkRequest` replaces `pl.intent.locomotion.desiredVelocityWorld` with its ramped output. Between controller decisions, the next substep reads that output as the destination, so the ramp advances only when the controller decides again. Reproduction: run `L3-F14-forward` with its controller decision interval set to 0.05 s instead of every substep. At 1.5 s, after one second of ramping, the request is 0.10 m/s instead of 1.20 m/s. The controller contract supports nonzero intervals; the coached controller defaults to 0.05 s.

**Fix:** retain the original controller velocity request separately from the ramped output. Update that destination when a new decision arrives, then advance the existing ramp toward it every physics substep. Reset the stored destination with the player and preserve referee stop requests and existing contact/run bypass behavior. Do not change the controller decision interval or ramp rate to compensate.

**Regression:** run the same scheduled walking request with decision intervals 0 and 0.05 s, aligned at request changes. Assert equivalent ramp progress and stopping, with no inherited request after reset. Keep the existing walk/start/stop and contact regressions.

Relevant code: `src/sim/simulation.ts` (intent decision loop, `rampWalkRequest`, player initialization/reset) and `tests/transitions.test.ts`.

### Final verification and acceptance

Run focused audit/ramp regressions, the full suite and build, then regenerate fixture evidence and compare all 238 committed summaries. Report corrected transition counts, changed L3 outcomes and actual substep rates. Update the handoff with the final results. Review continuous normal-speed and 0.25× playback as specified below and record user visual acceptance separately. Do not accept 08 or begin 09 while a required repair remains open.

## Starting point and boundaries

Start from the current, uncommitted three-pass 08 implementation on top of `736d90a`. Preserve the composed foot planner, supplied static idle, walking/free-arm ownership, automatic locomotion modes and accepted 07a handoffs. Do not restart those features from the committed 07a code.

Independent review verified **347 passing tests, typecheck/build and 330 reproducible fixture summaries**. All 238 committed summaries, including the 143 historical ones, are unchanged; 92 L3 fixtures are new. Passing tests do not yet establish the three requirements below.

Keep motor/braking, suspension and balance budgets, collision pairs, fixed bone lengths, joint limits, plant confirmation and ragdoll candidate/transfer tolerances. Retain the 5.5 m/s² braking motor and existing physical braking-height control. No root/velocity correction, render-only pelvis offset, collider shrink, discarded hold or weakened validation. Changed later tackle outcomes must be measured, not forced to match previous winners.

Changes should remain opt-in to the L3/composed path. Preserve all 238 committed summaries. Existing L3 IDs stay available; add only focused variants needed to prove a missing scenario. No new jump design, anatomical envelopes, active ragdoll muscles, spine/head animation or played idle cycle belongs in this closeout.

## 1. Establish and meet transition continuity in contact

### Incoming evidence

The plan's limit is **0.01 m of transition-only landmark discontinuity at the same solved time and root**. The handoff reports 274 of 1807 contact-fixture boundaries over it. Review reproduced:

| Case | Boundary | Measured difference |
| --- | --- | --- |
| `L3-F1-low`, D at about 1.158 s | Exit to contact, following feet become steps | 5.8 cm at the left ankle |
| `L3-F8-recontact`, D2 at 0.950 s | Step to plant | 3.4 cm at the right ankle |
| `L3-F16-kick`, R at about 2.675–2.679 s | Plant/step ownership changes | About 4.4–4.5 cm at the shoe |

The automated 1 cm assertion currently covers free locomotion and excludes contact and the kick. Some raw comparisons may include an old path's collision-driven request jump rather than a discontinuity introduced by the new path. Sampling one such explanation does not establish that every failing boundary is safe.

### Repair

Trace these reproductions at actual physics substeps before changing the solver. Record old/new ownership and mode, achieved landmark motion, ordinary request and its velocity, composed request, sole/pole blend, selected clearance candidate, push-out, continuity memory and penetration. Distinguish actual first displacement, velocity change and second difference; report the coordinate frame and time interval.

Make `Simulation.auditInput`/`recordTransition` compare the old and new compositions at one solved state and time. Use copied pose/planner/sampler state; phase advances once in the live substep. Compare all changed ownership inputs, including free-arm composition when it changes. The present audit substitutes old foot requests into the new input; reusing the new arm inputs for both sides cannot prove arm-transition continuity.

For each reproduced excess, determine whether it is a real transition correction or a comparison artifact. If the reference path contains unrelated physical/request motion, add a regression demonstrating the mistake and correct the measurement. Retain raw differences and achieved-motion traces so the correction remains reviewable. Do not force the new path to reproduce an invalid old jump, or remove a failure by changing the threshold, dropping a landmark, suppressing the boundary or relabelling it.

Fix genuine handover corrections in the shared composition path. Start from the achieved motion and preserve valid per-foot anchors, sole angle, knee pole and the accepted reach-recovery state. Rebase ownership without adding the previous owner's correction twice or clearing continuity memory. Keep target motion bounded; report an infeasible contact explicitly instead of snapping to a hidden pose or blending through an obstacle.

### Acceptance

- Enforce the 1 cm transition-only limit across L3 contact, recontact, landing/airborne recovery and free movement, with diagnostic candidate edits kept separate from canonical pose transitions.
- The existing read-only-audit regression still produces identical live traces/events with the audit enabled and disabled.
- Retain actual substep displacement/rate checks alongside the same-time comparison; one passing measure cannot replace the other.
- Exercise the reported boundaries, both sides, existing entry/exit phases and contact interrupted by falling. Preserve successful 07a conversions and their first-solve checks.

## 2. Restore the declared foot-motion limits

### Incoming evidence

`FOOTWORK_L3` inherits `swing.maxLiftRateMps = 1.5` and `rejoinMps = 1.5`, but its composed path exceeds them:

| Case | Measured vertical planner rate | Measured follow-offset recovery rate |
| --- | --- | --- |
| `L3-F16-runStop` | 2.57 m/s | 2.94 m/s |
| `L3-F14-walkRunStop` | 3.75 m/s | 2.83 m/s |
| `L3-F7-phase0`, D | 2.60 m/s | 8.53 m/s |

`advanceStep` replaces the inherited vertical limit for continued clip swings with `1.25 * compose.descentMps` (3.75 m/s). The composed branch of `decayOffset` integrates its damped state without enforcing the inherited recovery cap. The plan requires the accepted target-speed bounds to remain in force.

### Repair

Apply the declared bounds to the motion that the composed path actually publishes, including continued swings, interrupted steps and final touchdown. Fix the shared trajectory/state update rather than clamping diagnostics after the fact. When a step is speed-limited, keep its stored velocity/acceleration consistent with the accepted movement so the next quintic does not inherit an imaginary trajectory.

For following feet, bound the additional offset-recovery motion at `rejoinMps`. Measure the correction relative to its moving ordinary request; the clip's own motion is a separate quantity. A reseed that changes coordinates while preserving the world target is not itself a physical displacement. Check the world target and achieved ankle as well, so a coordinate change cannot conceal a real jump.

Preserve continuity of inherited motion through feasible retiming, earlier handover and bounded recovery. If a target is unreachable within the rate/reach/contact limits, use the existing explicit release/failure path. Do not snap to the destination when a timer expires, force a plant, or raise `descentMps`, the inherited limits or a test tolerance to retain the present result.

### Acceptance

- Measure every actual substep of all L3 cases: planner vertical target speed ≤ 1.5 m/s, and follow-offset recovery speed ≤ 1.5 m/s, with only a small floating-point comparison epsilon.
- Include the three reproductions, high inherited swings, hard/slow stops, reacceleration, airborne recovery and contact release. Instrument the relevant update even when the foot changes owner in that substep.
- Keep the declared horizontal/yaw caps, fixed lengths, shoe clearance and confirmed-plant tolerances. Preserve individual stopping steps, a stable finish and honest failed proposals.
- Report stopping time/distance, last step, coverage, failed plants, support load and any handoff/outcome changes after the repair. Keep full-stop cases in bounds long enough to demonstrate settling; practice-edge termination is not proof of a settled stop.

## 3. Make integration tests establish their claimed scenarios

Use the actual observations and geometry, not only absence of an error event. Keep the existing unit tests, but repair the integration fixtures and assertions below.

### Recontact during exit

`L3-F8-recontact` currently keeps R in contact from about 0.571 to 0.950 s, then enters exit and resumes free at 1.150 s. No player takes the `exit -> contact` branch. Its test only requires some contact and a short event list.

Adjust the second defender's physical starting conditions/script timing so R has actually entered exit before the second collision and is still exiting when it arrives. Change the fixture, not the runtime mode logic or observation thresholds to manufacture the scenario. Assert the ordered observed sequence `contact -> exit -> contact -> exit -> free`, with the second contact named `recontact`, appropriate hysteresis and no duplicate resumption/chatter. Audit the achieved feet, held arms and landmarks at that boundary.

### Airborne recovery versus irreversible falling

All four `L3-F9-lift-*` fixtures currently finish without conversion. The shared test leaves `fellAt` null and passes, despite claiming that each case converts. It also always inspects R, including defender-specific variants.

Give each case explicit intent. Temporary airborne recovery may be valid: if that is the lift fixture's purpose, name it accordingly and assert genuine loss/regaining of probe support, airborne foot ownership and support-force behavior. A lift that never leaves support does not prove airborne recovery. Preserve separate, strict irreversible-fall tests in every mode using the existing conversion and no-probe cases. If a lift is claimed to cause irreversible falling, make the finite physical disturbance actually cause it and assert that outcome.

At the trigger/boundary, assert the intended player's actual mode; a scheduled disturbance time alone does not establish the mode when support is lost. Require the expected falling event/conversion to occur, check its candidate and transfer audits, and require support/motors to stay disabled after irreversible falling. For `defenderRising`/`defenderFalling`, inspect D and the measured vertical-velocity sign, rather than relying on R's independent fall. Retain deliberately invalid handoff/transfer diagnostics as safe failures.

### Retained hands and arm geometry

The existing test named “keeps held hand anchors and arm lengths” only checks that no `gripBroken` event with reason `gaitMix` exists. Neither is emitted by the engine. The no-contact/miss test also uses nonexistent `gripFormed`/`clampFormed` event names.

Use the existing `gripBegin`, `gripRelease`, `clampBegin`, `clampEnd`, remap/passive records and live arm/retention state where applicable. Exercise actual retained hands and forearm clamps; assert the relevant relation exists before testing its preservation. Add only a focused L3 copy of an existing grip drill if the current cases exercise clamps alone.

Measure achieved shoulder/elbow/wrist/palm geometry and compare segment lengths with the current body/arm profile using existing Gate 2 tolerances. Check target anchors in the correct active representation through entry, exit, recontact and conversion; use Gate 4 tolerances when the owner becomes articulated. Free-arm composition must not displace an achieved held arm. Physical release remains legitimate, but must have an actual supported reason and must not be a transition-induced anchor jump. Preserve one force law per retained relationship and existing remapping/body-count checks.

Make these regressions fail if the scenario never occurs, the wrong player is inspected, a hand anchor is shifted, or a limb length is wrong. Filtering for an event name/reason the engine cannot produce is not evidence.

## Implementation order and verification

1. Add the failing scenario/measurement regressions and capture the current baseline. Correct audit artifacts with focused proof, then use the corrected audit for the transition repair.
2. Repair composed foot-motion limits and transition seeding together where they interact. Re-run focused contact/airborne/stop checks after each change; preserve both sets of requirements.
3. Finish recontact, fall and retention integration assertions. Run the complete suite and regenerate evidence only after the focused checks pass.

Relevant code: `src/sim/simulation.ts` (audit/composition), `src/sim/footwork.ts` (trajectory/offset updates), `src/sim/pose.ts` (ownership rebase), `src/sim/fixtures/transitions.ts` (scenario construction), and `tests/transitions.test.ts`. Reuse the existing pose memory, geometry helpers, probes and Gate 2/4 checks; no separate animation/audit framework is required.

Run focused transition tests, 07a/footwork regressions, `npm test`, `npm run typecheck`, `npm run build`, and `npm run fixtures`. Extend/reuse `p08-audit-all.ts`, `p08-audit.ts`, `p08-feet.ts`, `p08-stop.ts` and the existing first-solve probe as needed. Confirm all 238 committed summaries remain identical. Explain every changed L3 result, handoff, event count or profile identity; retain the pre-closeout measurements as incoming evidence.

Update the 08 handoff with before/after transition counts by scenario/kind, actual substep rates, scenario coverage, geometry errors, candidate/first-solve results and remaining limits. Keep test count separate from proof that each required event occurred. Do not mark 08 accepted or start 09 while any required closeout item remains unmet.

## Visual review after numeric closeout

Review continuous normal-speed and 0.25× playback from side and oblique views: runStop/free-arm stop, a late braking phase through rest, run-start and walk-to-run, idle/walking, repaired recontact, low-runner contact, kick recovery and conversion during contact. Include the accepted 07a offset/stacked-player/simultaneous/one-arm regressions.

Look for deliberate deceleration, distinct catching steps, stable idle, appropriate free-arm swing/brace and continuous contact handovers. Passing the numeric checks does not waive a repeated visible pop, slide or first-frame ragdoll kick. Record user visual acceptance separately from automated verification. Anatomical ragdoll restrictions and active fall responses remain 09 work.
