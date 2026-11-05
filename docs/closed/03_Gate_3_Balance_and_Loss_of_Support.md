# Tackling Gate 3 — Finite Balance, Recovery, and Loss of Support

Implementation specification v1.1 • 2026-11-02

Shared fixture contract: schemaVersion = tackling-v1.1. Export the active body, arm, solver, and rule profile identifiers wherever used; explicit legacy profiles remain reproducible.

Revision v1.1 adds bounded posture preferences, continued drive/readjustment, and forearm-clamp integration. Sources, parallel-work guidance, and limits on low/roll tackles are in [the review guide](00_Tackling_Review_and_Implementation_Order.md).

## 1. Outcome and contribution

Extend the tackle laboratory so a player can resist a disturbance, lean, recover, or lose the ability to remain upright. Contact, arm forces, momentum, and finite recovery effort determine that behavior.

The final product is a low-poly Three.js American football game with independent CPU players and coach-selected plays. Tackling must remain a contest: a wrap can fail; an unwrapped collision can destabilize someone; either participant can fall first.

**Contribution to the final product:** this gate replaces the early prototype's inviolable upright lock with a reusable, explicitly limited support model. It produces a loss-of-support event based on the body's actual motion, preparing a truthful handoff to ragdolls in Gate 4.

The model is deliberately simpler than physical feet or full-body locomotion. Its thresholds are authored game mechanics. It must not be described as a calibrated simulation of human balance.

## 2. Prerequisites and scope

Build after:

- [Gate 1](01_Gate_1_Movement_and_Impact.md): stable IDs, dynamic proxy bodies, bounded motors, fixed steps, inspectable real collisions.
- [Gate 2](02_Gate_2_Reach_Grip_and_Wrap.md): achieved arm geometry, one-arm retention, independent two-arm wraps, finite reciprocal grip forces and releases.

No repository was inspected for this specification. Verify the actual prerequisites and reuse suitable Simulation, PlayerController, BodyAndContact, Presentation, and TestScene modules. Names and paths here are proposals.

Required now:

- Free pitch/roll for the active balanced-body profile.
- A grounded, finite upright torque motor and finite yaw motor.
- Actual lean/angular-motion measurements.
- Recovery and loss of support using a documented criterion.
- Capability changes after support loss.
- Continued physical motion as a single falling proxy.
- Controlled comparisons, visual review, and prerequisite regression.
- Bounded post-contact drive, side readjustment, and resqueezing while the runner keeps executing his own requests.

Deferred: ragdolls, active get-up, physical feet, jumping/diving, advanced running biomechanics, full-team pursuit/autonomous runner evasions, deliberate roll finishing, full physical dip/lift, ball rules, and full tackle completion. Gate 1's simple coached entry remains available.

Gate 4 will replace the falling proxy with an articulated passive ragdoll. Do not implement that conversion here.

## 3. Replace the rotation lock explicitly

The Gate 1/2 test profile locks pitch and roll and permits yaw. Create a new balanced profile with all three rotational axes dynamic. Remove any equivalent constraints, orientation overwrites, or artificial angular-velocity zeroing.

Retain the locked legacy profile for regression and historical fixture reproduction. A selected profile must be obvious in the UI/export; never silently use locked rotation in a balance demonstration.

Supported and falling refer to control capabilities, not to whether a body currently touches the ground:

~~~ts
type ControlMode = "supported" | "falling";

interface BalanceState {
  playerId: PlayerId;
  controlMode: ControlMode;
  leanAngleRad: number;
  outwardLeanRateRadPerS: number;
  projectedLeanRad: number;
  supportingContact: boolean;
  requestedBalanceTorqueNm: Vec3;
  actualBalanceTorqueNm: Vec3;
  recoveryLimitCounter: number;
}

interface LossOfSupportEvent {
  playerId: PlayerId;
  tick: number;
  substep: number;
  reason: "recoveryEnvelope" | "hardLeanLimit";
  leanAngleRad: number;
  outwardLeanRateRadPerS: number;
  angularVelocity: Vec3;
  relevantContactAndGripIds: string[];
}
~~~

Both players use the same mechanics. Controllers cannot issue a loss-of-support event for an opponent.

## 4. Ground support approximation

Keep one dynamic proxy body per player. Use the legacy capsule for old fixtures or Gate 1's compound contact profile for canonical football cases. Its designated support shape's real floor contact approximates support. Feet remain visual and do not generate forces.

A supporting contact initially requires:

- Contact between the designated support shape and floor/support category, not an opponent or a sideways torso/head touch.
- A solved contact normal with dot(normal, worldUp) > 0.6.
- A contact in the capsule's lower supporting region for the current orientation. Inspect the manifold/contact point rather than assuming every floor touch is a planted stance.

Orient the normal from support toward player regardless of pair ordering. Transform the player-side point into the support shape's own local frame, including its offset inside the body. Require local Y <= -supportCapsuleCylinderHalfHeight + 0.02 m for the initial support shapes. Record a changed region rule with the profile.

Use contact geometry plus a short supplementary floor query if needed for robustness at contact onset. The query must confirm actual reachable support; it cannot supply ground force across a gap. Record any support hysteresis/tolerance, initially no more than 0.02 m.

A body can be briefly airborne while still in supported control mode, but its grounded drive and upright support torque are zero during that interval. It may land and resume support if it has not crossed the loss criterion.

Do not add an upward spring, reset height, or teleport a player onto the floor to conceal instability. Gravity and real ground contact determine vertical motion.

## 5. Measure lean and lean rate

Let:

- U = world up = (0, 1, 0).
- u = the body's local up transformed by its solved quaternion.
- theta = acos(clamp(dot(u, U), -1, 1)).
- a = normalize(cross(u, U)), the correction axis toward upright.
- omega = solved world angular velocity.

For nondegenerate tilt:

~~~text
outwardLeanRate = dot(omega, -a)
~~~

Negative outward rate means the body is rotating back toward upright.

Near zero tilt, use a finite zero-rate convention or a stable last valid axis. The loss condition below also requires meaningful actual tilt. Near an upside-down orientation, the hard lean limit already applies; never divide by a zero cross-product length.

Measure pitch/roll independently from yaw. A fast turn around world up must not be misclassified as falling.

Store actual theta/rate and displayed degrees separately. Physics calculations use radians.

## 6. Finite upright control

While controlMode is supported and there is a supporting contact, use a bounded desired-up target. Its default is world up; section 6.1 permits a small requested athletic lean:

~~~text
thetaError = angle(actualBodyUp, desiredBodyUp)
correctionAxis = normalizedCross(actualBodyUp, desiredBodyUp)
omegaTilt = omega - U * dot(omega, U)
tauRequested = Kp * thetaError * correctionAxis - Kd * omegaTilt
tauBalance = clampVectorMagnitude(tauRequested, availableBalanceTorque)
~~~

When thetaError is approximately zero, omit the undefined position-correction term and retain finite damping. Actual world lean theta remains separate and continues to govern loss of support.

Initial parameters:

| Parameter | Starting value |
| --- | --- |
| Balance position gain Kp | 1,200 N m/rad |
| Balance angular damping Kd | 220 N m s/rad |
| Configured maximum balance torque | 240 N m |
| Yaw torque ceiling | 180 N m |
| Combined support-torque ceiling | 300 N m |
| Recovery look-ahead | 0.18 s |
| Minimum actual lean for projected-loss test | 25 degrees |
| Projected recovery-envelope limit | 55 degrees |
| Hard actual lean limit | 70 degrees |
| Consecutive projected-loss confirmations | 2 physics substeps |

A simple available balance limit is:

~~~text
availableBalanceTorque =
    min(configuredMaximum, mass * gravityMagnitude * supportRadius)
~~~

This caps virtual ground-support authority using the declared body profile. It is an approximation, not a computed support polygon or physical foot traction.

Use supportRadius = 0.30 m for the legacy capsule and 0.16 m for the initial compound profile unless explicitly retuned. Do not use torso half-width as if it were a planted physical foot. Read the actual body's mass, COM, and inertia.

Calculate yaw and balance from the same snapshot. Sum their torque vectors and enforce the combined support ceiling. Log requested and actually applied components so a cap cannot be hidden. Do not grant fresh balance effort for every contact or grip.

Apply the resulting torque through the physics engine. Never set rotation to a desired pose. Contact can overcome the motor.

### 6.1 Limited posture request

Permit an initial desired lean of at most 12 degrees from world up, toward a selected running/contact direction. Rate-limit desired-up changes, initially to 30 degrees/s. A ready or recovery request can return the target toward upright.

This makes posture an attempted physical orientation with finite torque. It is not an inviolable stance and cannot reset actual lean or change the loss threshold.

Hip/knee bend and shorter visible steps may accompany preparation, but this fixed-height proxy cannot truthfully claim physical vertical dip/rise or a leg-powered lift. Do not add an upward opponent impulse to imitate those actions.

## 7. Movement while leaning

Retain Gate 1's bounded velocity-error drive. Reduce its available ground effort as the body leans:

~~~text
leanScale = clamp(1 - (theta / hardLeanLimit)^2, 0, 1)
availableDrive = maximumDriveForce * effort * leanScale
~~~

Apply ground drive only with support. This links the reduced model's posture to an explicit capability. It must not depend on a rendered foot position.

Facing remains a preference with bounded yaw torque. Do not instantly face the runner to rescue a poor tackle angle.

The engine supplies impact impulses and gravity. Grip forces are applied once by the shared contact authority. Do not add a named tackle knockdown torque on top of these mechanics.

## 8. Loss-of-support criterion

After each physics substep, compute:

~~~text
projectedLean =
    theta + max(0, outwardLeanRate) * recoveryLookAhead
~~~

Emit loss of support when either:

1. theta reaches the hard actual lean limit; or
2. theta is at least the minimum actual lean and projectedLean exceeds the recovery-envelope limit for two consecutive substeps.

Reset the confirmation counter when the projected condition is no longer true.

The projected test approximates a recovery envelope: how far the current outward angular motion is taking the body before its controller can recover. It does not prove physiological irrecoverability. Its parameters must remain visible and inspectable.

The hard limit prevents an inverted body continuing to run with upright control. Numerical failure is a separate invalid trial, not a loss-of-support event.

Do not use:

- A tackle rating comparison or chance roll.
- Two hands attached as an automatic fall trigger.
- A timer measured from first contact.
- A hidden damage/balance bar filled by tackle animations.
- Contact force magnitude alone regardless of orientation and motion.

If a valid recovery fixture crosses the criterion too early, diagnose the motor/envelope/profile and document changes. Do not add a special-case immunity for the runner.

## 9. Behavior after support loss

At the next controlled physics boundary, set the affected player's controlMode to falling.

For this gate:

- Keep the same dynamic proxy, its pose, velocities, collision settings, and mass.
- Remove upright support, yaw steering, and ground-drive motors.
- Do not zero velocity, set a landing pose, add a launch impulse, or freeze the opponent.
- Continue the physics simulation so the proxy tips, contacts the floor, and interacts with the other body.
- Continue evaluating controllers for diagnostics, but unsupported capabilities cannot execute their standing requests.
- No active get-up or return to supported mode is required within the trial.

### Existing hand holds and forearm clamps

If only a grip's target loses support, keep the relationship and revalidate geometry normally.

If the grip owner loses support, stop active shortening of the virtual arm. Freeze its desired length, retain a passive elastic/damped link with a reduced total owner grip budget, initially 35% of the supported budget, and keep all reach/overload/obstruction release checks.

This approximates a retained hold during a proxy fall; it is not active arm control. A valid hold is not automatically dropped, and an invalid one is not preserved for appearance. Gate 4 replaces the falling owner's virtual link with a passive hand-to-target constraint on articulated bodies.

For a falling owner's forearm clamp, freeze its closing reference pose and stop active closure/tracking. Retain only pressure from the remaining passive compliant contact, under the same reduced owner arm budget. A gap removes normal/friction forces immediately. Do not turn a clamp into a palm surface hold merely to keep it attached.

When only the target falls, a supported owner's valid closing arm action may continue. Every contact is still revalidated from current geometry. All hand-hold and clamp forces share one owner arm budget.

Run this behavior for at least 1 s after the first loss event unless another stop condition intervenes. A diagnostic timeout may end the observation; it may not label a tackle complete.

### 9.1 Supported finishing and continued contest

Add a small post-contact controller once the isolated balance checks pass. It generates requests through existing actuators:

| Observation | Intent/request | Allowed failure |
| --- | --- | --- |
| Selected shoulder/core contact and feasible retention | Continue bounded drive in the chosen advantageous field direction; sustain actual closure | Runner can resist or move the defender |
| Only one valid arm or a glancing shoulder fit | Limited lateral reposition and independent new reach/closure | New arm can miss or existing contact can slip |
| Stable contact but little progress | Adjust facing/relative position within existing speed/torque limits | Stalemate may remain; no forced fall |
| All useful contact lost | Recover toward the runner using Gate 1's bounded entry controller | Defender may overrun and fail |
| Own support lost | Stop supported drive/active closure and follow falling capabilities | Existing retention may fail |

Choose the finish direction as an explicit controller parameter. Do not always push the runner toward his own destination or toward the tackler's stale initial target.

Drive uses the same finite ground-force budget as locomotion. Resqueezing changes a bounded closing request, not a magical resistance multiplier. Repositioning changes self-intent, never the opponent transform.

The runner continues trying to move, brace, or change heading through the same bounded motors. Deterministic fixture inputs are sufficient; an autonomous juke/spin policy is not required.

Near-side step timing and visible foot cadence should correspond to actual speed and direction. Physical support is still the declared approximation. A coaching cue about continuing steps is not a minimum displacement, minimum block time, or guaranteed tackle completion.

A deliberate roll finish is deferred. A passive side tumble or a lower hand contact is not proof that the controller performed a thigh-and-roll technique.

## 10. Fixed stepping and ownership

Use the fixed-step architecture from Gate 1. Keep all controllers reading one prior snapshot before shared mechanics.

The canonical balanced profile may use two fixed 1/120 s physics substeps per 1/60 s outer tick if needed for the finite-torque/arm system. Record the actual choice. Recompute force contributions for every actual substep and clear persistent forces correctly.

Per substep:

1. Apply queued control-mode changes.
2. Snapshot all bodies/arms/retention contacts and support contacts.
3. Generate independent intentions.
4. Clear application-owned accumulators.
5. Compute finite movement, yaw, and upright support contributions.
6. Advance arms, validate hand holds/forearm clamps, allocate the shared arm budget, and add each reciprocal force pair once.
7. Advance physics once.
8. Revalidate hand holds and clamps and read actual body/contact state.
9. Evaluate lean/recovery envelope and queue loss events.
10. Publish solved state and diagnostics.

No subsystem independently rotates or positions a body to satisfy an animation target.

## 11. Presentation and debug evidence

Render the actual body lean. A mesh held visually upright while its proxy tips fails this gate.

Arms continue using achieved contact geometry. As a shoulder tilts/moves, its world position changes and a hold may become unreachable. Do not stretch a forearm to hide this.

Leg steps and foot placement remain procedural visual approximations. Preserve segment lengths and avoid gross floor penetration. A visual foot adjustment cannot move the physical root or create extra balance effort.

Show:

- Actual up vector and world up.
- Lean, outward lean rate, projected lean, and configured thresholds.
- Supporting contact and control mode.
- Requested/applied balance and yaw torques, caps, and saturation.
- Drive-force reduction.
- Existing grip force/release traces and loss-event reason.

Normal speed establishes readable recovery rhythm. Slow motion and side/oblique views establish that contact, body tilt, and arm geometry agree.

## 12. Fixtures

Use identical motor/envelope profiles for recovery and failure comparisons unless the fixture explicitly varies one parameter. Fixture tuning must be documented; the initial numerical profile has not been executed for this spec.

### G3-F1 — Unlock and stable support

Run the balanced profile at rest for 5 s, then execute straight movement and finite braking.

Pass: pitch/roll are genuinely unlocked; the body remains reasonably upright without position/orientation overwrites; no sustained jitter or unexplained vertical launch.

Initial numerical target: settled resting lean below 2 degrees and no nonfinite state. Diagnose rather than artificially zeroing angular velocity to meet it.

### G3-F2 — Small disturbance and recovery

At reset, initialize a 10-degree lean with no outward angular velocity and valid floor contact. Alternatively use a clearly labeled external diagnostic impulse and record its exact value.

Pass: the same finite motor returns the player toward upright without crossing the loss condition. Suggested observation: lean below 5 degrees within 1.5 s, with damping rather than persistent oscillation.

### G3-F3 — Contact-caused recovery versus loss

Use body collision and/or a real Gate 2 grip to apply an off-center load. Establish one recoverable and one falling case by varying a physical input such as approach offset, initial momentum, or contact height.

Pass: one case recovers and another emits a loss event through the same code and profile. The failing case continues moving as a falling proxy. No scripted outcome switch exists in the fixture.

Changing contact height must change a real anchor/contact point, not an abstract tackle-strength multiplier.

### G3-F4 — Envelope and yaw unit checks

Check values around 25/55/70 degrees, near-zero lean, zero angular velocity, inward angular velocity, and pure yaw.

Pass: radians/degrees are correct; inward motion does not inflate projected lean; pure yaw does not cause loss; counters reset correctly; no divide-by-zero/NaN.

These checks validate the declared model, not realistic athlete thresholds.

### G3-F5 — Capacity intervention

Repeat a near-threshold fixture with only maximum balance torque reduced by 30%. Keep movement, grips, initial state, and envelope unchanged.

Pass: the applied torque trace reflects the reduction and produces an explainable response difference. Select a fixture where the torque cap actually binds; no designated winner is required.

### G3-F6 — Wrap is neither necessary nor sufficient

Run a valid two-arm wrap with low destabilizing motion and a separate unwrapped off-center collision with sufficient disturbance.

Pass: the wrap alone does not automatically trigger loss; an actual collision may cause loss without a wrap. Use the same loss criterion.

### G3-F7 — Defender can fall and hold can release

Choose inputs where the defender's motion is destabilized. Keep the runner active.

Pass: defender loss uses the same mechanics; unsupported drive/pull shortening stops; valid passive retention may remain, or an individual hold may release through normal checks.

### G3-F8 — Regression, reset, and timing

Repeat the canonical profile at different render rates and after repeated resets. Rerun Gate 1/2 fixtures in their explicitly preserved locked profiles and relevant wrap fixtures with the new balanced profile.

Pass: no stale loss event, body mode, or grip survives reset; historical fixtures reproduce; actual balanced outcomes are reported separately rather than compared to locked rotation as if unchanged.

### G3-F9 — Sustained drive and readjustment intervention

Use a canonical shoulder/forearm-wrap case. Compare sustained post-contact drive/closure against the same case with those requests removed after connection; keep geometry, collision, and the runner's effort unchanged.

Pass: applied force/pressure traces show the intervention and an explainable response difference. Do not require the active case to always win.

Also begin from an imperfect one-arm connection. Demonstrate a bounded attempted improvement and a case where it fails without resetting to a paired pose.

### G3-F10 — Posture request and runner resistance

Vary desired lean within its 12-degree bound and supply runner drive/heading changes under the same mechanics.

Pass: actual posture can lag or be opposed; world-lean loss logic is unchanged; runner requests remain active. No force or torque is granted from a visual foot or wrapped flag.

## 13. Milestones and rubric

| Milestone | Required result |
| --- | --- |
| G3-A | Dynamic rotation and finite upright control; F1/F2 and motor-bound checks |
| G3-B | Motion-based support loss and continued proxy fall; F3/F4/F5 |
| G3-C | Wrapped/partial-contact integration, continued finish, defender failure, presentation, and regression; F6–F10 |

Grade 0 missing/broken, 1 partial, 2 meets, U unverified. Every required row must be 2.

| ID | Criterion | Evidence |
| --- | --- | --- |
| G3-R1 | Finite upright authority | F1/F2 torque logs, unlocked-body source inspection |
| G3-R2 | Valid loss calculation | F3/F4 event traces and boundary checks |
| G3-R3 | Causal mechanics | F3/F5/F6 controlled comparisons |
| G3-R4 | Symmetric player capabilities | F7 traces for both IDs |
| G3-R5 | Correct post-loss execution | No supported motors or active arm shortening; passive grips remain bounded |
| G3-R6 | Visible correspondence | Normal/slow-motion side/oblique inspection, including failed recovery |
| G3-R7 | Reproduction and regression | F8, exported settings, actual build/check results |
| G3-R8 | Football finish remains a contest | F9/F10; bounded continued drive/closure, runner resistance, and failed improvement |

Hard failures: locked/overwritten orientation in balanced mode; unlimited correction torque; hidden tackle outcome trigger; extra impact impulse; falling declared as completed tackle; invalid grip preserved; controller directly changes an opponent; false visual-verification claim.

## 14. Paste-ready implementation goal

Start with G3-A. Use one active milestone at a time.

~~~text
/goal Implement and demonstrate G3-A in
03_Gate_3_Balance_and_Loss_of_Support.md.

Inspect the repository and Gate 1/2 evidence. Implement only the selected
milestone. Preserve the locked legacy fixtures as explicit profiles.

For the balanced profile, unlock pitch/roll and use finite grounded torque,
actual lean/angular motion, and the documented recovery envelope. Contact and
real arm forces must produce recovery or loss; wrapping cannot declare a fall.

Demonstrate the required fixtures and rubric using actual commands/results,
exported profiles, torque/contact traces, and inspected normal/slow-motion views.
Mark unavailable evidence U. Both participants may lose support.

After loss, standing motors stop and physical proxy motion continues.
Do not implement ragdolls, get-up, or full football completion.

Stop at a reviewable handoff. If blocked or unfinished after 20 turns, report
progress, the blocker, and the next experiment; do not claim completion.
~~~

Later milestone goals (run separately after the prerequisite passes):

~~~text
/goal Implement and demonstrate G3-B in 03_Gate_3_Balance_and_Loss_of_Support.md.
Read the entire specification and inspect G3-A evidence first. Implement only
G3-B. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G3-C in 03_Gate_3_Balance_and_Loss_of_Support.md.
Read the entire specification and inspect G3-B evidence first. Implement only
G3-C. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

## 15. Handoff and references

Return actual configuration and solver/substep settings; changed source files; run/check commands; successful and failed recovery fixtures; torque/event traces; criterion grades/evidence; visual status; limitations and the next experiment.

- [Rapier forces/torques](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/)
- [Rotation locks and their deliberate removal](https://rapier.rs/docs/user_guides/javascript/rigid_body_locking_translations_rotations/)
- [Contact queries](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/)
- [SIMBICON research context for the difficulty of full biped control](https://www.cs.ubc.ca/~van/papers/simbicon.htm)
- [Claude Code goal behavior](https://code.claude.com/docs/en/goal)

This gate does not implement SIMBICON. Its one-body support motor and recovery envelope are much smaller, authored approximations chosen for the tackle prototype.

Football source mapping: [review guide](00_Tackling_Review_and_Implementation_Order.md), especially S3, S9, and S10. Ground drive, stance, resqueezing, and finishing are translated into explicit actuator requests; source coaching does not supply their exact numerical limits.
