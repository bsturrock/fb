# Support recovery and contact footwork

Repository-aligned plan • 2026-11-05 • Implementation accepted for the 06a/07 checkpoint. All four closeout items pass independent review: 218 tests, build and 216 regenerated fixtures; all 143 historical summaries unchanged. Continuous visual acceptance remains open. 07a is cleared to start; natural braking presentation remains 08 work ([handoff](../handoff/plan07.md)).

Previous: [physical support](06a_Physical_Ride_Height_and_Support.md). Next: [ragdoll contact handoff](07a_Ragdoll_Contact_Handoff.md).

Natural-contact overlap rejections remaining after this milestone are owned by [07a](07a_Ragdoll_Contact_Handoff.md), before integrated locomotion in 08. The passive falling proxy remains a safety fallback; it is not the accepted final behavior for those named cases. Natural idle posture and procedural walking arm motion belong to 08.

## Review closeout: accepted implementation

Support recovery, hinge repair, confirmed plants, tuning validation, the step-transfer repair and the lower physical braking stance are accepted implementation. Preserve these fixes; do not restart 07.

Independent review reproduced a 0.801 m root at the runStop clip-to-procedural crossing (previously 0.891 m), five individual final steps, no two-foot flight, and a stop in 1.48 s over 3.31 m at the existing 5.5 m/s² braking cap. All 12 controlled stopping phases finish with both feet planted and no overlapping lifted steps, two-foot flight, drags or failed proposals. The observed stop has 17 confirmed and sustained plants and 95% eligible-stance plant coverage per foot.

Continuous normal/slow playback remains a visual review item. Toe-off has a sharp change in knee motion: the one-tick second difference is 11.8 cm in the observed stop and up to 14.4 cm in a phase variant, not a measured displacement/teleport of that size. Plan 08 owns ordinary transition smoothing, cadence and free-arm balance presentation. Plan 07a owns the larger player-contact clearance snaps and simultaneous conversion rejection. These accepted mechanics are the starting point for those milestones.

The specifications below preserve the incoming reproductions and required repairs. Final measurements are in the handoff's Fix 3, Fix 4 and independent closeout review; earlier measurements describe earlier revisions.

### 1. Confirm plants from the achieved pose

**Reproduction.** Run `p07-churn.ts` for `L2-F11-fastRun` and `L2-F3-runStop`. Fast Run currently reports 21 plant events, 11 released in the same substep; runStop reports 21, with 5 same-substep releases across the drill. `planFeet` uses the previous achieved foot to call `plantAt` and publish touchdown before the new leg solve. `observeFeet` can immediately invalidate it. The running test counts these failed attempts toward its minimum plants, while `stats.plantErrM` only accumulates surviving contacts.

**Change.** Reuse `planFeet` → `buildProxyPose` → `observeFeet` and the existing per-substep event buffer. Treat a proposed touchdown as tentative until the current achieved contact satisfies support, stance eligibility, reach/clearance and the existing 0.01 m contact-error limit. Only then expose it as an authoritative plant and emit `footPlant`. A failed proposal must continue from the achieved foot with its residual/reason, without a successful touchdown/liftoff pair or marker. Apply the same rule to initialization and reactive-step touchdown, not only supplied clips. Do not merely suppress logs while leaving invalid plant state active.

Keep failed attempts distinguishable in the existing diagnostics, without a second planner or event framework. Prevent repeated touchdown attempts based solely on the same stale ankle/gap; re-evaluate current feasibility before confirming another plant. Preserve valid heel/toe roll, bounded target motion, explicit releases and early reach releases. Do not lengthen a stride, lower the body, increase motor authority or widen contact tolerances to satisfy the test.

**Checks.** Add a focused regression where the previous foot appears eligible but the next achieved solve is out of reach: no successful plant is emitted or retained. Cover both clip and reactive touchdown paths, valid plants and support loss. For existing Fast Run/Sprint and runStop integration checks:

- Distinguish attempted touchdowns, confirmed contacts and positive-duration plant intervals. No confirmed plant may be released in its confirmation substep because it failed that same solve.
- Count sustained intervals, not raw touchdown events. A sustained interval must survive into a subsequent solved substep; report per-foot duration distribution and fraction of eligible stance time actually planted. Use a controlled reachable stance to prove positive coverage; infeasible parts of a supplied stance remain explicit residuals, not hidden failures or mandatory full-stride locks.
- Measure achieved error/drift throughout each interval, including the sample that causes release. Report failed-attempt errors separately rather than treating the maximum over surviving plants as proof of universal contact success.
- Retain current limb lengths, hinge limits, penetration and target-speed checks, reset/event reproducibility, no unsupported plants and unchanged physical state before conversion with planner on/off at the same support/motor settings.

Update the plant tables and stop-step counts with the corrected meaning. A lower honest count is acceptable; a passing count made from immediately rejected contacts is not.

### 2. Validate braking and stance-width settings before building physics

**Reproduction.** `withBrakingLimit(DEFAULT_MOTOR, -5.5)` produces a motor that applies +550 N to a 100 kg player moving at +6 m/s when requested velocity is zero. A run profile with `stanceWidthAddM: { sprint: Infinity }` passes initialization and produces six non-finite leg landmarks after a tick while the trial still reports `running`.

**Change.** Reject an explicitly supplied braking limit unless it is finite and strictly positive. Reject non-finite stance-width entries; finite signed widths remain allowed, including zero and the editor's inward adjustments. Give a clear error naming the profile and field instead of silently replacing invalid values. Validate once at construction/initialization before creating physics bodies: cover the fixture's motor and each player motor override. Extend `validateRunClipProfile` for widths and reuse a small shared braking check where profiles are authored/consumed; do not add per-frame validation or a generic configuration system. Absent optional fields retain the existing behavior.

**Checks.** Test negative/zero/non-finite braking limits, non-finite widths, valid signed/zero widths, valid braking, absent fields and an invalid per-player motor override. Invalid profiles must throw before simulation construction rather than reaching `numericalFailure` or a non-finite pose. Retain the stop/steering force-cap tests and the unchanged historical/default profile comparisons.

### 3. Transfer stopping feet without starting a two-foot hop

**Reproduction.** In the regenerated `L2-F3-runStop` trace, both feet start non-drag planner steps at 3.16667 s, as clip weight reaches zero and horizontal speed is about 2.88 m/s. Left/right step durations are 0.200/0.215 s; both are in lifted planner swings for 12 outer ticks, through 3.35 s. The user sees a hop instead of individual braking steps. This is a pose scheduling defect, not the suspension launching the root or a reason to change braking force again.

**Cause and change.** The reactive-entry loop in `planFeet` starts a step for every following foot before the ordinary one-foot scheduler runs. Reuse the current per-foot phase, achieved targets and confirmed contacts when crossing from clip playback to procedural braking. Schedule ordinary new steps one at a time through the same ownership rule as reactive travel. Finish an already-airborne foot's motion and allow its honest touchdown before lifting a usable stance foot; preserve or release each existing plant on its actual validity. If both inherited feet are airborne, handle their existing flight/recovery explicitly rather than starting two synchronized clearance arcs or pretending either is planted. No shared brace reset, target teleport, instant ground snap or restart of an existing swing.

Keep the controlled-braking profile and confirmation checks unchanged. A genuine reach/yaw failure or shove may require an explicit drag/recovery action, but an ordinary clip fade must not manufacture that emergency or just relabel a lifted foot as dragging. The scheduler repair itself adds no jump design, arm-balance animation or new stop controller; the bounded lower braking stance is specified separately in item 4.

**Checks.** Add a regression for the observed clip-weight crossing and representative other run phases, for controlled and original-profile hard stops. In the ordinary supported run-to-stop path, new procedural step starts must be staggered and must not create two overlapping lifted step arcs. Check achieved shoe/contact motion as well as mode flags and `drag` labels. Retain confirmed plants only while valid, settle without endless steps, and maintain lengths, joint/penetration limits and bounded targets. Recheck genuine airborne recovery, lateral shove/drag and support loss so this fix does not force a plant or suppress a necessary release. Keep planner-on/off physics identical before conversion at the same motor/support settings.

Watch continuous normal-speed and slow playback around 3.0–3.6 s and through the complete stop. The feet should read as separate final steps without the synchronized hop. Lower stance is now part of 07 item 4; final cadence styling and arms-out presentation remain in 08.

### 4. Lower the physical braking stance

The user wants a lower decelerating body, not just suppression of the hop. The item-3 handoff reports a narrow reactive reach window at the existing run hip height (about ±0.21 m), producing very quick stopping steps. Add a temporary lower physical stance during supported controlled braking. Begin with the already validated 0.80 m root-height intermediate stance as a tuning candidate, versus ready at 0.89 m; it is not a prescribed result for every speed or body. Do not automatically use the 0.72 m maximum crouch.

Derive the request from locomotion intent and actual solved travel/braking state, not fixture timestamps or foot-plant state. Route it through the existing bounded height composition/support controller, with continuous entry and return to the ready/idle target as the body settles or accelerates again. The request must remain effective while the run clip is fading: composing a stance request that is ignored at full clip weight is not sufficient. Blend the running-height/bob contribution and braking posture explicitly without advancing phase twice, snapping the root or applying a render-only pelvis offset. Preserve support loss, irreversible falling, the force split/caps and the selected braking deceleration limit.

The foot planner consumes the achieved lower hips and follows actual stopping travel. Let step cadence and placement respond to the new reachable geometry, with individual bounded steps and confirmed contacts; do not force a step count, extend stopping distance for appearance, or stretch limbs. Carry/held/ready arm ownership remains unchanged; arms-out styling is 08 work. Profile/request behavior must be identical with the foot planner enabled or disabled. This height request is an explicit physical change: report new height, support load, stop time/distance and tackle/handoff deltas rather than demanding equality with the previous high-stance runStop.

Test controlled run-to-stop from the observed phase and representative other phases/speeds, plus a slow stop, interrupted braking/reacceleration, genuine airborne recovery and falling. Demonstrate a lower achieved root during the relevant braking interval, bounded request/force/target rates, reachable fixed-length legs, valid joint and shoe clearances, no synchronized hop and no rebound on return to idle. Include an audited conversion during the lower braking stance. Preserve historical profiles and explicit original-profile hard-stop comparisons. Review the complete stop at normal speed and slow motion: the player should visibly lower and take individual final steps, with further arm/cadence styling deferred to 08.

### Verification and handoff

Run the focused footwork/profile tests, all tests, fixtures, typecheck and build. Compare the 143 historical summaries with the pre-fix baseline; explain any changed RH/L2 events, poses or articulated outcomes separately. Update the handoff with corrected plant durations/coverage and proof that invalid profiles are rejected. Do not rewrite the review's incoming measurements as though the fixes were already present.

Watch continuous normal-speed and slow playback of Fast Run, Sprint, runStop and a reactive stop to check for contact chatter, sliding or new pops. Resolve/review items 3–4 before the requested commit, then continue to 07a. Record visual limitations separately from code acceptance: 07 needs a bounded lower physical braking stance with coherent steps and contacts; free-arm balance styling and final cadence polish belong to 08. No new jump design, idle/walk-arm work, raw-bob restoration or anatomical-limit expansion is part of this closeout. The large stacked-player limb snaps and remaining simultaneous handoff rejection are explicit 07a work, not reasons to weaken the accepted confirmation/validation fixes or call all contact motion solved.

## Carry-forward repairs before footwork acceptance

Use the adopted 06a model: nominal-weight balance ceiling, calibrated legacy pivot carrying at most body weight, and excess suspension force through the COM. Preserve its isolated 12° defender stability and its defeat cases. Do not reopen the force-application decision merely to restore legacy tackle winners. The [06a handoff](../handoff/plan06a.md) is the incoming baseline, including its failures; implemented does not mean visually accepted.

1. **Load-release recovery.** Reproduce `RH-F4-load`: the 3 kN load bottoms the body, then release sends the root to about 1.21 m, roughly 0.32 m above standing and beyond support travel for about 0.4 s. Fix recovery in the shared support controller before tuning foot plants around that motion. Measure height, vertical velocity, applied force, saturation, guard contact, force work and target history through compression and release. The current law is proportional/derivative plus feedforward, with no integral accumulator: diagnose the large height-error force and release work rather than assuming integrator windup. Use the smallest bounded force/target recovery change that prevents the launch; derive any recovery state from solved compression/velocity/saturation, never the diagnostic load's schedule. Preserve push-only support, the force split and caps, normal bob tracking and the ability to be overloaded. No root/velocity correction, artificial downward force, or forced conversion solely to hide the rebound.
2. **New one-arm hinge rejection.** Reproduce the late defender conversion in `RH-F6-oneArm`, identify the offending joint, candidate angle, allowed interval and first invalid supported pose. Trace the achieved segment/joint frames and signed-angle mapping through candidate construction; fixed limb lengths alone do not prove valid hinges. Fix the shared pose or frame conversion that violates the contract. The published achieved pose and candidate must agree: no conversion-only reposing, widened limit/tolerance, skipped audit or delayed fall. Add a regression for the reproduced cause and keep genuinely invalid candidates rejected with the existing passive falling-proxy fallback. This is required handoff correctness, not deferred active-joint work in 09.
3. **Loaded player and outcome baseline.** Reproduce `RH-F5-playerBelow`. A receives no ground support when obstructed or falling; B may support the combined load through real body contact while its own ground probe is valid. A 100 kg passenger plus a 100 kg carrier is below the 3.5-body-weight vertical ceiling at rest, so B staying upright is not itself a failure. Record contact load, support force/split and balance response; require a separate above-capacity load or disturbance to overcome support. Do not add automatic collapse on player contact. Track the two-arm defender holding upright, the slow-line pair remaining upright and the later side-recovery fall as changed outcomes, not prescribed bugs or winners. Keep the new one-arm hinge rejection separately labeled as a defect.

Initial engineering acceptance for the fixed-target load-release case: peak root height no more than 0.05 m above the unchanged standing request, no departure from probe travel caused by release alone, and settling within 1 s of release to error <= 0.01 m without sustained oscillation. Measure against the original standing request, not a temporarily lowered recovery target. Exercise shorter/longer compression and a nearby load magnitude to rule out fixture-specific tuning. Keep the upward-kick fixture separate: externally imparted upward momentum may still leave travel, with zero authority outside it. If the release targets cannot be met with finite push-only support, report the force/work constraint and keep the repair open.

Complete these repairs and their focused tests before accepting the footwork stage. Footwork development may proceed independently, but final evidence must use the repaired support profile. Preserve the 06a incoming results and record new profile identity/settings and before/after deltas; do not rewrite historical evidence as if these repairs were already present.

## What is new

`buildProxyPose` already has actual-velocity-directed leg swing, fixed-length IK, stable hinge frames, floor/shoe checks and sticky clearance alternatives. `PoseMemory` stores candidate indices; it is not a world-space foot plant or step scheduler. Add persistent per-foot plant/swing state and finite short contact steps. Reuse the existing solve rather than introduce another leg solver or pose composer.

Start from the adopted plan 06a support plus the recovery repairs above. Standing/contact stances request calibrated feasible heights through its bounded controller; the foot planner solves against the achieved physical hips, including tracking lag. Report infeasible configurations; never reposition the root, stretch bones or silently change support geometry to make feet fit. Reuse the supported ankle pitch and sole features introduced in plan 06 pass 2. At handoff the shoe retains that pitch and remains fixed to the shin; no independent ankle/toe bodies are added.

The 3.5–4.5 cm stance residual near toe-off belongs here: distinguish valid heel/toe roll, true liftoff, reach clamping and actual shoe separation. A median stance gap near zero does not certify a valid plant. For a valid plant, require both contact-feature error and drift <= 0.01 m; release an infeasible anchor explicitly rather than reporting a clamped target as planted.

Stopping uses this same procedural plant/step state: preserve the current achieved feet as the run clip fades, take bounded final steps from actual remaining travel, and settle when the body stops. A zero requested velocity is a braking request, not proof the body has stopped. The existing drive motor owns deceleration; the feet must not freeze while the root continues sliding or alter braking forces to make a pose fit. Include a run-to-stop check alongside the existing slow stop. This follows the support/handoff repairs in priority; detailed stopping posture and transition polish belong to 08, with no new stop clip or separate controller required here.

**Controlled-braking decision.** The measured 6 m/s stop (about 1.0 s, 1.6 m, peak motor deceleration about 14 m/s²) uses the full acceleration force budget for braking. Add an explicit opt-in motor profile with a separate braking deceleration ceiling, initially 5–6 m/s² as an authored engineering setting, not a measured athlete limit. This is an approved physical locomotion change, independent of the foot planner, and supersedes the blanket unchanged-braking restriction above only for that profile. Historical profiles retain their existing behavior. Apply the cap to the motor's component opposing actual horizontal travel; preserve the existing total horizontal force budget, effort/lean/load limits and zero unsupported authority. Do not clamp collision, grip or other external deceleration, or overwrite velocity. Handle zero speed and reversal without division errors or chatter; steering/acceleration must retain their shared force budget.

Compare the original and controlled-braking profiles with identical starts/requests and the foot planner disabled, then use the chosen profile unchanged for planner on/off comparisons. Report stop time (to speed <= 0.1 m/s, remaining below it), distance, peak motor and total deceleration, applied force and steps separately. Roughly 1.3–1.5 s, 3–4 m and 4–5 steps are expectations to check, not required outputs or permission to stretch a step. Nearby initial speeds must also stop cleanly. Retain an explicit original-profile hard-stop case to test plant release/recovery when available stopping travel is short. No automatic switch of motor profiles because a foot target becomes infeasible.

Keep load-limited drive/yaw (about 18% lower mean drive cap while running) and attenuated Sprint bob as declared limits. Measure footwork against actual travel and the attenuated height target; neither increasing drive nor restoring raw bob is part of this milestone. Suspension during visual flight also remains an explicit approximation: plan 07 releases airborne foot anchors but does not turn visual flight into a physical support signal. Ballistic running and independent foot-ground dynamics require a separate future milestone, not an implicit dependency of 08 or 09.

## Implementation

1. Store per-foot achieved target, world anchor/contact feature, planted/swing/airborne state, swing progress, destination and release reason in player-owned simulation state. Initialize from the current achieved pose, not a standard brace pose.
2. Plan from solved core translation/yaw, actual local velocity and existing support/control mode. Stationary contact should settle without marching. Backward dragging must produce backward adjustments even when requested velocity is forward. Use reach margins and hysteresis to trigger steps; alternate when feasible, but release both anchors if the geometry requires it.
3. Move swing targets on bounded trajectories with finite speed, duration and clearance. Retarget from the current target without resetting the trajectory. Preserve a planted contact feature in world space while valid. Excess reach, yaw, obstruction or support loss releases it with a reason; no teleport to a plausible stance.
4. Feed targets through existing `twoBone`, `hingeChain`, `legShapes` and clearance queries in `pose.ts`. Report achieved residuals and any clearance-driven departure from a plant. A clamped IK endpoint is not a successful plant. Keep numerical singularity fallbacks and profile length checks.
5. Do not let foot states change physical grounded state, drive/balance torque, friction or completion rules. Stop new supported steps at loss of support; an articulated player uses `ragdollPose`. Rejected candidates retain the existing explicit failure/falling-proxy behavior.
6. Apply persistent plants to supplied running stance intervals as well as short contact steps, using the existing clip stance/flight annotations. Preserve heel/toe contact features through bounded ankle roll. Do not lock airborne feet or extend a plant beyond reach to conceal support tracking error. Fix procedural fallback step direction from actual travel, including the recorded moonwalk; verify standing targets against the calibrated sole instead of retaining the old elevated ankle target.
7. Trace anchor drift, requested/achieved targets, swing limits and release reasons. Reset state alongside gait/pose memory. Add overlays to existing lab views only as needed.

## Scope and acceptance

The opening repairs may change `support.ts`, support profile/runtime integration, and the shared pose/candidate frame path where the measured hinge cause requires it. Reuse RH fixtures and support tests; change candidate validation only to expose useful diagnostics, preserving its checks and thresholds. Do not broaden this into a ragdoll or balance redesign.

The controlled-braking exception may extend `MotorProfile`, `computeDrive`, profile validation/export and focused motor/fixture tests. Fix braking in the shared motor path; do not add a second stop controller or a foot-planner-dependent force. Preserve unchanged defaults for all profiles that omit the new cap.

Then extend `src/sim/pose.ts` and `Simulation.updatePoses` with a small planner if needed; reuse model/ragdoll profiles. Add fixtures through the existing registry and focused planner/pose tests. The foot planner consumes the repaired support law; stance height requests go through that controller and foot state itself grants no physical support.

## Fixtures and measurable acceptance

| ID | Fixture | Required behavior |
| --- | --- | --- |
| L2-F13 | RH-F4-load release plus nearby load/duration variants | Bounded recovery against original stance request; no launch beyond travel, no hidden correction; normal bob still passes |
| L2-F14 | RH-F6-oneArm late defender fall and reproduced hinge cause | Correct signed hinge frames/limits, continuous achieved pose and valid representative conversion; genuinely bad candidate still rejected |
| L2-F15 | RH-F5-playerBelow, above-capacity load and existing defeat cases | A never gets false/resurrected support; B carries only within finite authority; capacity can be overcome; no required legacy winner |
| L2-F16 | Original versus opt-in controlled braking from 6 m/s and nearby speeds; zero speed, reversal and steering | Capped opposing motor force with existing shared budgets; external impacts unaffected; original profile unchanged; stop metrics independent of step count |
| L2-F17 | Proposed clip/reactive touchdown rejected by the current achieved solve, then valid contact | Failed proposal is distinct from a confirmed plant; sustained intervals/coverage measured; no false touchdown/liftoff pair or unsupported plant |
| L2-F18 | Invalid braking/width profiles, fixture defaults and player motor overrides (tests) | Clear rejection before physics construction; valid signed widths and absent options retain behavior |
| L2-F19 | Clip fade to procedural braking, observed runStop phase and representative other phases | Ordinary final steps start independently without a two-foot clearance hop; inherited airborne motion and genuine recovery remain honest; physics budgets unchanged |
| L2-F20 | Physical lower braking stance, clip fade, interrupted stop and handoff | Effective bounded height request during braking, achieved lower hips and feasible individual steps; smooth return, existing force caps, honest changed physics and audited conversion |
| L2-F1 | Neutral/staggered stance feasibility | Reachable floor geometry with intended bend; requested/achieved physical height recorded; no hidden pelvis lowering or length changes |
| L2-F2 | Stationary loaded contact for 3 s | Settles without constant marching; no physical force change from foot state |
| L2-F3 | Slow forward travel and supplied forward run, then stop | Final steps follow actual braking travel; valid plants persist through clip fade; settle without frozen-foot sliding, snap or endless marching |
| L2-F4 | Backward drag while desired velocity is forward | Steps respond to actual backward movement; no forward treadmill cycle |
| L2-F5 | Left/right displacement and yaw | Mirrored behavior, no indefinite foot swivel, no knee flip or crossed legs |
| L2-F6 | One planted/one swinging, then both airborne | Preserve initial states; no instant grounded reset |
| L2-F7 | Sudden hip displacement beyond reach | Release invalid anchor, finite constrained pose, explicit reason; root untouched |
| L2-F8 | Actual support lost and physical falling | No new authoritative plants or recovery support; ragdoll override respected |
| L2-F9 | Zero-distance, full extension, extreme target, turn singularity | Finite IK, stable bend convention, valid joint limits, recorded residuals |
| L2-F11 | Fast Run/Sprint stance, flight and rate clamps | World plants persist only while feasible; explicit release and residuals at rate limits |
| L2-F12 | Slow procedural forward/side/backward fallback and standing | Correct step direction and sole height; no moonwalk or elevated rest targets |
| L2-F10 | Render FPS/visibility, pause/reset | Same planner trace at equal fixed tick counts; no duplicate liftoff/touchdown events |

Measure:

- Anchored contact-feature drift <= 0.01 m while the anchor remains valid. Measure the feature, not the ankle of a rolling foot.
- Limb length error <= 0.001 m and no forbidden knee/hip/ankle limits.
- Ground penetration <= 0.01 m in accepted flat-ground stance/swing fixtures; evaluate shoe volume as well as its landmark.
- Commanded swing/retarget speeds inside caps, with passive impact-induced corrections separately labeled.
- Mode/step decisions reproducible at equal fixed tick counts on the same runtime.

After the opening repairs, freeze the support settings for foot-planner comparisons. Compare enabled/disabled runs with identical height requests and the same repaired support profile before conversion. Root motion, force budgets, grip results, and balance decisions must be unchanged; pose-query rule observations may legitimately differ and must be reported. The support repair itself may change physics outcomes and needs its own before/after comparison. Rendering toggles alone must change no simulation results. If the canonical leg pose is changed before a later ragdoll, resulting articulated falls can legitimately differ; use the same pose config for ragdoll comparisons.

Numerical success is necessary but not sufficient. Feet should read as purposeful short steps, with visible differences between forward effort, sideways recovery, and backward dragging.

Run focused support/hinge/planner checks, all tests, fixtures, typecheck and build. Compare historical legacy evidence and the incoming RH baseline separately; retain reasons for any remaining rejected handoffs. Watch continuous normal-speed and slow playback of load release, the one-arm defender's fall, standing/crouch, both supplied runs, braking, forward/sideways/dragged contact, and vertical handoffs. Stepped frames alone do not establish absence of a rebound or transition pop. Record unreachable stances and residuals rather than enlarging acceptance tolerances. Integrate automatic run/contact selection in document 08; supplied clips already exist and are required for running-plant acceptance. Leave 07 open if load recovery or the new hinge failure remains unresolved, even when foot metrics pass.

## Optional implementation reference

[Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): Its IK-rig approach may inform mapping animation targets to different limb proportions. Reuse our existing twoBone/hingeChain solver; persistent plants, clearance and step scheduling still belong to this simulation. Treat it as a reference, not a required dependency. Compatibility with our assets has not been tested.
