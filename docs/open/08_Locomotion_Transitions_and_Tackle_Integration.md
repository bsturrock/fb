# Locomotion transitions and tackle integration

Repository-aligned plan • 2026-11-05 • Implemented in all three passes with the [08 review closeout](08_Review_Closeout.md); declared finished by the user on 2026-11-07. See the [handoff](../handoff/plan08.md).

**Implementation status (2026-11-05; history, superseded):** at the first pass the 1 cm transition metric held for free locomotion (735 boundaries, largest 0.9 cm) and did not hold in contact (274 of 1807 boundaries over 1 cm, largest 5.8 cm). The review closeout and the leg composition repair brought the audit to 0 of 2450 boundaries over 1 cm ([repair evidence](../handoff/plan08.md#leg-composition-repair-2026-11-07)); plan 10b's audit results are in its [handoff](../handoff/plan10.md#10b--foot-target-continuity).

**Review disposition:** close the contact/airborne continuity gap, restore the declared composed foot-motion limits, and repair integration tests that do not establish recontact, falling and retained-arm geometry. Preserve this implementation as the starting point; the [closeout plan](08_Review_Closeout.md) contains the reproductions, scope and acceptance checks.

Previous: [ragdoll contact handoff](07a_Ragdoll_Contact_Handoff.md). Next: [active falls](09_Active_Falls_Joint_Limits_and_Role_Responses.md).

## Intended result and execution order

Make the accepted movement mechanics read as purposeful football movement: a convincing deceleration into a settled stance, natural idle and walking arms, then automatic run/contact/exit composition. Start with the visible stopping problem. Implement the three passes in order; the first gives a small, useful playback review before contact integration expands the cases. Full 08 acceptance requires all three.

| Pass | Work | Evidence to hand off |
| --- | --- | --- |
| 1. Start, brake and stop | Smooth the run-start takeover and clip toe-off release; preserve achieved foot motion and independent plants. Refine braking step timing/placement, the existing lower physical stance and free-arm balance pose. Settle without a final hop or endless stepping. | L3-F16 plus the accepted runStop, hard-stop comparison, phase variants and interrupted stop. Normal-speed deceleration should look deliberate; substep traces explain target/landmark velocity changes and plant releases. |
| 2. Idle and walking | Fit a useful posture from the supplied Idle.fbx; settle on existing plants. Restore procedural walking arm swing through the existing pose path, blending to idle/run and respecting carry/ready/held ownership. | L3-F13–F15: carrier/non-carrier idle, forward/backward/lateral walking and idle/walk/run/stop transitions. Include a conversion from the fitted posture. |
| 3. Automatic contact integration | Compose free movement, preparation, contact and exit from actual observations and achieved pose. Preserve valid feet/arms independently; handle misses, recontact and falling without a shared stance reset. | L3-F1–F12, including eight run phases, mirrors, sustained contests, released loads and falls in every transition. Accepted 07a handoffs and first-solve checks stay valid. |

Use the accepted 0.80 m braking-height candidate and 5.5 m/s² motor braking cap as the starting profile. The runStop reference reaches about 0.801 m at the clip-to-procedural crossing and stops to ≤ 0.1 m/s in about 1.48 s over 3.31 m. Refine the motion from actual slowing; step count and duration remain outputs. A refined bounded height/posture request can change support load and travel, so report those changes. Force budgets, artificial root/velocity corrections and render-only pelvis offsets are not presentation controls.

For pass 1, show the complete stop at normal speed and 0.25× from side and oblique views. It should lower, take distinct catching steps, use available free arms and finish stably. Address the known toe-off velocity reversal around 3.067–3.10 s, the 2.55 s brake-phase variant and run-start takeover around 0.75 s. Retain the now-accepted absence of the synchronized hop. Natural deceleration is a visual acceptance requirement, alongside the numeric checks below.

At each pass, run focused regressions and keep the existing contact cases available for review. At closeout, run the full suite/build/fixture export and publish one handoff with profile identities, measured deltas, playback cases and remaining limits. New jump design, ballistic running, spine/head animation and active/anatomical ragdoll changes keep their later scope.

## Prerequisites

Require the adopted plan 06a suspension with plan 07's accepted load-release recovery, hinge-valid handoffs and running/contact plants. An implemented 06a controller or passing foot-drift metric alone does not satisfy this prerequisite. Migrate integrated locomotion fixtures to that explicit repaired support profile; retain named legacy cases for historical evidence. Committed plan 06 pre-handoff invariance is not required for new support. Record every changed tackle outcome; restoring legacy winners/timings is not an acceptance target.

Require [07a's contact-handoff acceptance](07a_Ragdoll_Contact_Handoff.md) for the simultaneous, player-below and footwork one-arm cases. Their rigid falling-proxy behavior is not an accepted integration baseline; retain safety rejection only for genuinely invalid candidates and diagnostics.

This prerequisite is satisfied by the user-accepted [07a closeout](../handoff/plan07a.md#review-closeout-fixes-2026-11-05). Preserve candidate-equivalent opponent-limb clearance, the final shown reach-direction limit and its recovery state, and momentum/energy measurements beginning before the first solved step. The accepted defender remains upright in RH-F6-oneArm, L2-F14-oneArm, HC-F3-mirror and HC-F3-phase0; changed tackle winners are not a reason to alter force budgets. Every actual required natural-contact fall must still articulate with passing audits. Retain legacy fixtures as historical evidence rather than retrofitting their profiles.

## Idle and procedural walking poses

This milestone owns both the unnatural idle stance and missing free-arm motion during procedural walking. Keep them together with walk/run/stop composition rather than expanding completed footwork work in 07. Diagnose existing `proceduralArmTargetLocal`, gait phase/speed scaling, clearance alternatives and ready/carry/achieved-arm overrides before adding motion code: a swing target already exists and may be suppressed downstream.

Use the calibrated body and existing supported height controller for a stable, reachable athletic idle: soles on turf, knees inside limits, feasible arm clearance and deliberate carry/ready assignments. An idle should settle without marching or forced arm oscillation. No visible-pelvis offset or breathing/head/spine animation to disguise an invalid stance.

### Supplied idle reference

The user supplied `/Users/brandon/Downloads/Idle.fbx`. Background Blender inspection on 2026-11-05 found an actual animation, not just a static stance:

| Property | Inspected value |
| --- | --- |
| File size | 1,078,480 bytes |
| SHA-256 | `662267cccb15fb8ea1c74de8fa85637628b65689f4436b05168d82932bc4341c` |
| Rig | `Armature`, 33 bones, `mixamorig:` names |
| Action | `Armature\|mixamo.com\|Layer0` |
| Imported timing | Frames 1–251 at 30 FPS; 8.333 s between first and last sample |

The source is still in Downloads; it has not been copied into the repository or visually accepted. During 08 intake, preserve the original as `models/animations/source/idle.fbx`, verify its hash and record the selected pose/frame or playback policy in the existing asset inventory. Inspect front/side/oblique views for posture, foot placement, arms, root drift and loop continuity. The current metadata proves animation is present, not that its stance or loop suits football.

Start with the smallest useful application: a representative supplied resting posture fitted to the calibrated model and existing planted feet. Use source limb directions/relative pose through the canonical pose/IK path; retain physical core authority, achieved arms, carry/ready ownership and joint/clearance limits. Source proportions and raw hip height do not set the physical body's height. If fitting needs a different stance height, request it through the existing bounded support controller and validate it physically. No direct mesh-bone playback that disagrees with the published pose.

Only play the idle cycle if its motion adds value after the posture fits and its seam, plant stability and transitions pass review. Additional spine/head animation or cosmetic root bob is not required here. Reuse the FBX sampling and bone/calibration tooling, but do not force idle through run-only planted-toe speed calibration or running stance-interval validation. Keep a deterministic static idle when animated playback is unused. Confirm unchanged held/carry assignments and rerun the accepted 07a handoffs from the fitted idle and its walk/run/stop transitions.

Free walking arms follow actual gait phase and speed with bounded continuous swing, fading into idle and supplied run arms without a pop. Check forward, backward and lateral procedural movement with appropriate direction/phase; start transitions from the achieved state. Carry, ready, reaching and held arms retain ownership, and clearance corrections stay continuous. Reuse the existing pose/IK path; no separate animation system or simulated arm-swing momentum is required. Pose changes still affect clearance, ball location and ragdoll candidates, so rerun 07a handoffs.

## Existing boundary

Keep `PlayerRuntime.pose`, `Simulation.updatePoses`, `convertBatch`, `validateCandidate`, `switchToRagdoll` and `ragdollPose`. The code already has canonical physical segments, delayed observation history, render interpolation, simultaneous conversion, retained contact remapping and transfer failure handling. The new work is switching/blending clip and contact-foot targets while preserving that boundary. Existing snapshot history is not automatically sufficient for per-foot transition state; add only the previous achieved targets/state needed by the transition.

Preserve `poseMemory` and the reach-recovery flag through ordinary locomotion mode changes. Clear them on actual reset/accepted conversion, not to hide a transition correction. Advance gait and clip phase once per physics substep. Same-time old/new-pose comparisons use copied state and must not advance or mutate the live sampler, foot planner or continuity memory.

## Implementation

1. Add a small per-player locomotion mode (free run, preparation, contact, exit); keep it separate from supported/falling control and proxy/articulated representation. Use observed contact, retained arms and actual movement, with hysteresis. Preparation may request bounded stance height and existing posture lean, but cannot grant contact, traction or balance. Blend height targets through the plan 06a controller; use achieved core height and orientation for all limbs.
2. Enter from achieved feet and current swing progress. Preserve valid anchors independently. Blend targets and solve fixed lengths; do not linearly interpolate final bone positions or snap to a shared brace stance. Keep physical root and achieved/carry arms authoritative.
3. Exit when real contact/retention clears. Select a compatible clip phase using foot positions and stance annotations, then release plants gradually. Recontact during exit starts from the currently composed pose. Stationary contests must not trigger automatic marching/falling timers.
4. Make contact-time clearance changes continuous for free limbs. The plan 06 handoff records abrupt ARM_ALTS switches and free-arm self-overlap; reuse current achieved targets, bounded retargeting and clearance precedence to address these. Held/carry arms retain authority. If collision or reach makes continuity impossible, report the correction/failure explicitly; no interpolation through an obstacle or weakened candidate validation.
5. Falling interrupts every mode immediately. Queue conversion on the existing substep schedule from the last published achieved pose; never wait for a blend, pre-pose a hidden candidate or sample the visible mesh. Preserve the achieved ankle pitch in shin-owned shoe frames and actual vertical core velocity. Suspension and all supported motors are off when falling, including after candidate rejection. Keep current mass, momentum, energy, anchor and penetration audits and `invalidHandoff`/`invalidTransfer` handling unchanged.
6. Clear transition/sampler/planner state at reset and accepted conversion. Preserve interpolation reset at representation changes. Renderer visibility, FPS and camera cannot affect state or fall acceptance.

## Scope and acceptance

Add rising/falling bob phases and low-stance entry/exit to L3-F1/F9/F10. Include support saturation during a wrap and loss of probe support during each transition. Reject any result where locomotion restores support after falling. Forward lean uses the existing capped posture controller; sampled spine twist/head motion remain deferred because they require a separate physical pose/collider contract.

Re-run release of a sustained wrap/load during contact and exit against the accepted recovery behavior; transition targets must not recreate the compression-release launch. Include the formerly hinge-invalid one-arm defender in L3-F9/F10 and retain valid achieved hinge frames through transition composition. Keep the player-below load case as a support-budget regression, without requiring the carrier to fall. Load-limited drive, attenuated bob and support during visual flight remain declared approximations; foot ownership changes do not grant or remove physical support.

Polish run-to-stop transitions using 07's procedural final steps and persistent plants. Review ordinary braking and braking interrupted by contact/reacceleration from different run phases; preserve achieved feet and bounded height/posture requests as the clip fades. Measure actual speed, stopping travel and plant drift separately. Match the pose to physical deceleration rather than imposing a stop duration or changing force budgets for appearance; no additional stopping mode or clip is required unless the existing transition state proves insufficient.

Use 07's explicitly calibrated opt-in controlled-braking motor profile for ordinary controlled-stop integration, and keep the original-profile hard-stop case as a comparison. Its separate braking cap is an approved physics-profile change, not a parameter the transition/foot planner may adjust. Carry the motor identity into evidence; step count and animation duration follow actual solved deceleration. Contact/grip impulses remain outside the motor-only cap, and profile changes must not be used to force a successful tackle or plant.

**Accepted 07 transition residuals.** Reproduce the observed runStop toe-off around 3.067–3.10 s and the 2.55 s brake-phase variant. Positions remain continuous at physics substeps, but the released plant rejoins the moving clip with an abrupt change in knee/ankle velocity (one-tick second difference 11.8 cm observed, 14.4 cm in the variant). Also review run-start quick-step takeover around 0.75 s. Smooth ordinary plant/clip/step transitions from the achieved motion, without weakening confirmed-contact checks, changing braking authority or hiding a ground-contact failure. Measure first displacement and velocity alongside second differences; do not describe the latter as a literal teleport. Preserve the accepted 07a contact-clearance fixes and report any new regressions introduced by this composition.

**Football braking presentation (user visual feedback).** Plan 07 now owns both the synchronized two-foot hop repair and the bounded lower physical braking stance; they must already work on entry here. This milestone refines cadence/foot placement, stance timing and the arms-out balance pose using that accepted physical height request. Free arms may move outward within existing reach, clearance and continuity limits; carry, ready and held arms keep their assignments. Do not lower only the mesh, change braking budgets to manufacture a preferred number of steps, or reintroduce rebound on return to idle. The pose should visibly anticipate/respond to actual slowing and finish in a stable stance; handle contact, reacceleration and falling from the achieved state. Pose-only arm motion still supplies no physical counterbalance. Review at normal speed for recognisable deceleration, not just finite numbers or absence of an explosion.


Changes belong in simulation pose/locomotion state, `updatePoses`, fixture registry and focused tests. Extend lab overlays/exports for mode, transition reason and foot ownership. Do not replace the ragdoll or rule observer. Before integrated acceptance, reproduce the model baseline's rejected handoffs and clamp churn from `../handoff/gate4.md`; report whether changed poses improve or worsen them.

## Required integration fixtures

| ID | Fixture | Required observation |
| --- | --- | --- |
| L3-F1 | Force entry at at least 8 evenly spaced run phases | No common brace reset; planted/swinging feet retained independently; finite targets |
| L3-F2 | Anticipated entry that misses the runner | Preparation unwinds; no phantom collision/grip/plant; running resumes feasibly |
| L3-F3 | Surprise lateral hit at speed | Body reacts immediately; legs adapt/release within limits; blend does not delay impact |
| L3-F4 | Shoulder plus partial/two-arm wrap | Arms remain achieved; legs keep stepping from actual movement; wrap flag grants no force |
| L3-F5 | Runner drives while defender is dragged | Distinct forward/backward footwork; no desired-speed treadmill |
| L3-F6 | Stationary contested hold for 3 s | Settled stance/limited readjustment; no automatic fall or marching timer |
| L3-F7 | Contact releases during left/right stance and swing | Phase-matched exit, no foot snap, free gait consistent with actual travel |
| L3-F8 | New contact halfway through exit | Resume from composed pose, not raw clip/old contact pose; no mode chatter |
| L3-F9 | Loss of support in free run, entry, contact, and exit | Exact pose candidate; no animation wait; Gate 4 audits pass |
| L3-F10 | Either/both players convert with retention | Correct grip/clamp remap and shoe pose; no duplicated colliders/forces |
| L3-F11 | Candidate rejected for a genuine bad pose | Explicit failed trial with safe falling-proxy fallback; no hidden snap or shrink |
| L3-F12 | 30/60/144 render FPS, hidden player, pause/reset | Matching fixed-step gait/physics traces; no culling-dependent outcome |
| L3-F13 | Idle for 3 s, carrier and non-carrier, from different prior gait phases | Feasible settled stance and arm assignments; no marching, arm chatter or hidden root offset |
| L3-F14 | Procedural walk/idle/run/stop, forward/backward/lateral, held/ready/free arms | Visible continuous free-arm swing; correct ownership, lengths and clearance; stable carry palm/ball relationship and audited handoff |
| L3-F15 | Supplied Idle.fbx fitted posture; optional cycle and transitions | Recorded source hash/pose policy, finite calibrated pose, stable plants/core and arm ownership, valid handoff; test seam only if the cycle is used |
| L3-F16 | Football braking posture/cadence, free versus carry/held arms, interrupted stop | Preserve 07's physical lower stance and individual steps; refine feasible free-arm balance pose/timing and correct ownership, with unchanged motor budgets and audited interruption/handoff |

Use mirrored approaches, different runner headings, and representative supported speed/body profiles. A full combinatorial sweep is unnecessary initially, but entry/exit/fall must each be checked on both sides and in both planted/swinging states.

## Quantitative and visual acceptance

Retain Documents 06/07 length, plant, target-speed, ground, and reproducibility tolerances. Add:

- Transition-only pose discontinuity <= 0.01 m for anatomical landmarks at the same solved time/root. Measure the old and new pose paths at the same boundary; do not confuse ordinary physical displacement between ticks with a transition pop.
- No discontinuity of held hand anchors attributable to gait mixing; valid achieved retention remains under Gate 2 tolerances.
- Locomotion may request height/posture through the accepted bounded physical controllers. It may not set achieved root transforms, grant grounded state, override force budgets or change completion predicates. Foot plants never grant traction.
- Height/lean requests remain continuous and within slew limits across every mode transition; report suspension tracking error and saturation.
- Free-limb clearance alternatives no longer create unexplained single-tick target jumps; inspect the recorded plan 06 contact-pop cases and sprint self-overlap.
- Gate 4 mass/momentum/energy/penetration audits pass on the actual integrated candidates.
- A 20-reset sequence has stable active body/joint/retention counts and no accumulating owned sampler/rig resources.

Review normal speed for football rhythm and purpose. Review slow motion for feet sliding, hyperextended knees, ankle/shoe jumps, core/mesh disagreement, impossible hands, and first-frame ragdoll kicks. A passing metric does not excuse an obvious repeated visual fault.

Record known limitations explicitly: bounded suspension support (including visual flight without ballistic gait), simple gait heuristics, coarse ragdoll with frozen shoe-to-shin relationship, and omitted relative limb-swing velocities at handoff. Document 09's fall responses do not remove these limitations and are accepted in a separate milestone.

Run all tests, typecheck and build; export affected fixtures with clip/pose/profile identities and compare outcomes. Existing honest rejected candidates are not successful transitions. Keep the documented boundary policy: no relative limb-swing velocity injection at conversion; bulk transfer remains the existing audited approximation.

## Optional implementation reference

[Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): Its separation of animation poses and IK targets may inform clip/contact composition. Preserve our achieved-pose authority, fixed-step timing and audited ragdoll boundary; it is not a replacement transition or physics system. Treat it as a reference, not a required dependency. Compatibility with our assets has not been tested.
