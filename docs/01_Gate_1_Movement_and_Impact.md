# Tackling Gate 1 — Bounded Movement and Mutual Impact

Implementation specification v1.1 • 2026-11-02

Shared fixture contract: schemaVersion = tackling-v1.1. Export the active body, arm, solver, and rule profile identifiers wherever used; explicit legacy profiles remain reproducible.

Revision v1.1 adds a coached approach and shoulder-contact profile. It supersedes v1.0 for new work while retaining the original capsule fixtures as explicit legacy profiles. Package sources, coverage, and parallel-work rules are in [the implementation-order guide](00_Tackling_Review_and_Implementation_Order.md).

## 1. Purpose and product context

Build a small Three.js tackle laboratory containing a runner, a defender, and a floor. Both players attempt movement independently. Their physical bodies collide, slow, redirect, and displace one another.

The eventual product is a low-poly, CPU-versus-CPU American football game. The user calls plays as coach. All 22 players will have individual objectives and attributes; plays should develop through those actions and their interactions. No interaction animation may reserve an opponent, teleport him, or guarantee an outcome.

**Contribution to the final product:** this gate establishes the reusable movement and collision foundation for tackling. A player's desired motion is an attempt with finite force. An opposing body can change the result while both players continue receiving movement requests.

This is a proposed implementation specification, not evidence that a solver or repository has already passed these requirements.

## 2. Four-gate sequence and authority

| File | Capability |
| --- | --- |
| 01_Gate_1_Movement_and_Impact.md | Independent, bounded movement and mutual collisions |
| 02_Gate_2_Reach_Grip_and_Wrap.md | First one arm hold; then a genuine two-arm wrap with independent, breakable contacts |
| 03_Gate_3_Balance_and_Loss_of_Support.md | Finite upright control, recovery, and physically motivated loss of support |
| 04_Gate_4_Ragdoll_Handoff_and_Completion.md | Motion-preserving ragdoll handoff, surviving/releasing grips, and ground-based drill completion |

Implement these gates in order. Each file supplies its own context, prerequisites, physical approximation, completion conditions, and handoff instructions. Reading chat history is unnecessary. A later gate's prerequisite does not authorize implementing that later gate early.

Model mapping, isolated arm/balance experiments, fixture tooling, and ragdoll construction may run in parallel after shared contracts are fixed. Final contact/balance/handoff integration remains sequential. Assign one owner to the shared physics loop and do not merge competing force or transform authorities.

The active gate governs new work. Later gates deliberately replace stated temporary approximations; they do not retroactively invalidate completed historical fixtures. Keep a Gate 1 fixture profile that retains Gate 1's rotation locks after the newer balance profile is added.

## 3. Baseline and repository inspection

No repository has been inspected for this specification. All module names and paths below are proposed.

The project may already contain a two-player blocking experiment, a pose playground, Three.js rendering, a model adapter, and contact mechanics. Inspect available source and evidence before changing it.

- Reuse suitable Simulation, PlayerController, BodyAndContact, Presentation, and TestScene code.
- Add an isolated TackleLab scenario; preserve blocking and pose-playground scenarios.
- Do not replace existing bounded articulated-arm contact with cosmetic arm following. The simplified arm model in Gate 2 is for the tackle prototype where needed.
- If no suitable scaffold exists, create TypeScript + Three.js + Vite and one physics implementation. Rapier 3D is the reference choice. Inspect installed package APIs and pin the actual version in the lockfile.
- Prefer the project's existing suitable physics backend over adding a second engine. If its capabilities cannot meet this gate, report the concrete mismatch before a broad migration.
- Use a segmented placeholder when a production character is unavailable. A supplied 25-bone, fingerless model needs joint/axis/scale inspection; bone count alone is not a rig contract.

Before implementation, report a short repository-informed plan: reusable components, new components, known assumptions, and commands actually available. Then implement; do not remain in a planning loop.

## 4. Scope and approximations

Required now:

- Two player records keyed by stable IDs.
- Dynamic rigid-body locomotion, gravity, floor support, and nonpenetrating body contact.
- Independent movement/facing requests from deterministic fixture controllers.
- Finite drive, braking, and yaw authority.
- Fixed simulation steps, pause, reset, slow motion, and single-step.
- Minimal debug overlays, reproducible fixture export, and meaningful numerical checks.
- A deterministic coached entry controller, mirrored leverage cases, and classification of actual shoulder versus head/other contact.

Deferred:

- Arm forces, grips, wrapping, tackling success, balance loss, and ragdolls.
- Full-team pursuit/communication, autonomous runner evasions, stiff-arms, dives, jumps, fumbles, penalties, and football rules.
- Physical feet, learned locomotion, muscle simulation, motion capture, paired clips, and full-team plays.

**Temporary approximation:** pitch and roll are locked in this gate. Yaw remains dynamic. This isolates translational collision from balance. Gate 3 explicitly unlocks pitch/roll and replaces the lock with finite upright control.

Feet are visual. Do not claim that a rendered planted foot creates traction. Ground friction and an explicitly bounded grounded movement motor approximate support.

## 5. Coordinates, dimensions, and scene

- SI units: meters, kilograms, seconds, newtons, newton-meters, radians.
- Y is up; X/Z are the field plane.
- A player's local forward is +Z; local right is +X.
- World directions and anatomical left/right are distinct. Never derive an action from screen left/right.
- Ground surface is Y = 0.
- The rigid body's origin and physical center of mass coincide for the initial symmetric capsule only. Compound profiles must use the engine's actual COM.

Initial legacy foundation profile:

| Parameter | Starting value | Meaning |
| --- | --- | --- |
| Total mass | 100 kg | Verified total engine mass, not mass added on top of collider density |
| Capsule radius | 0.30 m | Collision approximation |
| Capsule cylinder half-height | 0.65 m | Excludes the hemispherical caps |
| Total capsule height | 1.90 m | 2 × (0.65 + 0.30) |
| Resting center Y | approximately 0.95 m | Let the solver settle onto the floor |
| Maximum requested speed | 6.0 m/s | Controller request limit, not a hard physical velocity clamp |
| Maximum drive/brake force | 1,400 N | Shared horizontal motor budget per player |
| Velocity response time | 0.25 s | Converts velocity error into acceleration |
| Maximum yaw torque | 180 N m | Finite facing effort |
| Floor/player restitution | 0 | Start without bouncing |
| Floor/player friction | 0.7 starting coefficient | Record the engine's friction-combination rule |

These are engineering starting values, not measured athlete capabilities. Tune documented coefficients if needed; retain explicit units and limits. A body hit by another body may exceed its requested running speed.

Use a 16 × 12 m practice area. A marked boundary is a drill boundary, not an invisible collision wall. Stop and label an out-of-bounds trial rather than forcing the player back into the area.

Render contrasting low-poly players, a cosmetic ball on the runner, ground markings, and an orbitable camera with side, oblique, and overhead presets. Ball possession is a scenario label only.

### 5.1 Upper-body football contact profile

Use the legacy capsule to prove the first movement/impact milestones. Before accepting the coached shoulder-and-wrap path, also supply an upper-body contact profile on the same single dynamic body. A broad circular footprint can obstruct an arm wrap even when the visible torso is flatter.

Starting compound geometry relative to the proxy origin:

| Region | Geometry |
| --- | --- |
| support | Capsule radius 0.16 m, cylinder half-height 0.65 m, center offset (0, -0.14, 0) m |
| torso | Cuboid center (0, +0.23, 0), half extents (0.25, 0.29, 0.16) m |
| pelvis | Cuboid center (0, -0.08, 0), half extents (0.20, 0.13, 0.15) m |
| head | Sphere radius 0.14 m, center (0, +0.79, 0) m |

At origin Y = 0.95 m the support capsule reaches the floor. These dimensions are tuning defaults. Total mass remains the configured player mass; define its distribution once and retrieve actual COM/inertia. Remove the legacy large capsule in this profile.

Tag collider ownership and anatomical region. Initial shoulder landmarks are (±0.26, +0.50, 0) m. A real torso manifold point within 0.20 m of the selected shoulder may be classified as shoulder-region contact. Head-collider contact cannot be relabeled as shoulder contact.

Classification adds no impulse or technique bonus. The engine resolves ordinary collision once.

This profile is an upper-body approximation. It does not establish separate moving legs or a true thigh tackle.

### 5.2 Coached approach and connection

Add this controller after the basic motors/contact pass. It emits only bounded movement/facing and posture-preparation requests.

Observe the runner's near-hip and torso landmarks, velocity, relative surface gap, and tackler self-state. Configure a leverage-side vector and selected anatomical shoulder. The fixture supplies assignment; no whole defensive scheme is required.

Phases:

1. Track a short predicted near-hip interception point while preserving the assigned side.
2. Gather speed as the gap closes and prepare the selected shoulder.
3. Request connection toward the near upper-torso surface.
4. Continue a bounded request through contact or recover from a missed/glancing entry.

Initial prediction horizon: 0–0.5 s. Optional observation delay: 0.08 s; decision interval: 0.05 s. Mechanics still run each physics substep. Use zero delay for isolated mechanics and export the chosen timing.

Gather from closing speed and finite braking capacity. One initial requested-speed ceiling is:

~~~text
entrySpeedCeiling =
    sqrt(contactEntrySpeed^2 + 2 * brakingAcceleration * max(surfaceGap, 0))
~~~

Start intended contact-entry speed near 1.5 m/s. This is a request, not a guarantee. Do not stop in an identical pose at a universal fixed distance, and do not force the selected shoulder to connect.

Use actual closest-surface queries and a shoulder-sized lateral fit offset. Center distance alone is insufficient across body profiles. Near-hip tracking transitions toward the upper-torso aim as entry becomes possible.

Show ready hands, bent hips/knees, stable head/gaze, and the selected-side step/shoulder relationship. These are posture targets; physical foot placement and vertical dip/rise are still approximate. A displayed planted foot supplies no additional force.

Prefer head clearance beside the contact path. Do not deliberately target a facemask, neck, or collar. A poor attempt may still strike head-first: keep the collision, log the technique failure, and do not teleport or disable the head to repair it.

The review guide records the coaching sources and deferred low/roll mechanics. Exact controller values are engineering choices.

## 6. State ownership and module contracts

| Owner | Responsibilities |
| --- | --- |
| Simulation | Fixed time, players, configuration, events, reset, fixture lifecycle |
| PlayerController | Reads a shared prior-state snapshot; emits intentions |
| BodyAndContact | Applies bounded motors; owns physical transforms through the physics engine |
| Presentation | Reads solved state and maps it to the model |
| TestScene | Fixture selection, controls, views, and debug displays |

Do not mandate an ECS or plugin framework. Ordinary TypeScript records/functions are sufficient.

~~~ts
type PlayerId = string;
type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

interface LocomotionIntent {
  desiredVelocityWorld: Vec3; // horizontal; m/s
  desiredFacingWorld: Vec3;   // normalized horizontal direction
  effort: number;            // clamped 0..1
}

interface PlayerConfig {
  id: PlayerId;
  bodyProfileId: "legacyCapsule" | "upperBodyCompound";
  massKg: number;
  capsuleRadiusM: number;
  capsuleHalfHeightM: number;
  maximumRequestedSpeedMps: number;
  maximumDriveForceN: number;
  velocityResponseTimeS: number;
  maximumYawTorqueNm: number;
}

interface BodySnapshot {
  playerId: PlayerId;
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  centerOfMassWorld: Vec3;
  grounded: boolean;
}
~~~

Keep engine handles in the physics adapter. Store player identity separately; engine handle values may change after reset or ragdoll conversion.

The capsule dimensions in the compact example configure the legacy/support capsule, not an invisible envelope around every compound collider. Compound torso/head dimensions and shape offsets live in the selected physical profile.

Contacts are nonexclusive relationships, not an exclusive opponent slot. A focus target may guide a controller but may never filter out legitimate physical contact.

## 7. Body setup and mass

Create one dynamic body per player with the selected legacy capsule or compound football profile. Keep translations enabled. Allow yaw and lock pitch/roll only for the Gate 1/2 fixture profile.

Set total mass once using the engine's supported mass/density mechanism. Inspect the resulting body mass and center of mass. Do not unintentionally combine a 100 kg additional mass with a second 100 kg collider mass.

Use a fixed floor collider. Leave gravity to the physics engine. Keep controller forces distinct from engine gravity, contact impulses, and any diagnostic disturbance.

Disable sleeping during short active fixtures or wake bodies when applying effort. Enable CCD or suitable fixed substeps for fixtures that would otherwise tunnel. Record solver iterations, substeps, friction rules, damping, and collision settings with the fixture.

Do not derive collision shapes from visual mesh triangles, jersey size, or a rendered animation frame.

## 8. Locomotion and facing motors

For each player, clamp the horizontal requested velocity's magnitude to the request limit. Compute:

~~~text
vError = desiredHorizontalVelocity - actualHorizontalVelocity
aRequested = vError / velocityResponseTime
FRequested = mass * aRequested
FDrive = clampVectorMagnitude(FRequested, maximumDriveForce * effort)
~~~

Apply FDrive at the center of mass. Use one combined horizontal vector budget, not the full force independently on X and Z.

When grounded is false, apply zero ground-drive force. Do not emulate air steering in this gate. Grounded means a real floor/support contact with an upward supporting normal; a cast may supplement detection but cannot create support over empty space. Define and record the contact-normal threshold, initially normal dot worldUp > 0.6.

Braking uses the same finite budget. A requested velocity of zero must not freeze the body.

For yaw, compute the shortest signed horizontal angle from current facing to requested facing. Apply a damped proportional torque with a maximum magnitude. Suggested initial gains: 300 N m/rad position gain and 80 N m s/rad angular damping, capped at 180 N m.

Do not set solved velocity, rotation, or translation every step. Direct state setting is allowed only for reset, initial fixture state, and clearly labeled diagnostic setup.

The motor may continuously reapply effort. That is compatible with contact affecting motion as long as its force remains bounded.

## 9. Fixed-step update and force lifetime

Use a fixed outer simulation tick of 1/60 s. Start with one physics step per tick; introduce a small fixed substep count only when contact stability/CCD evidence requires it.

For every actual physics substep:

1. Apply queued reset/configuration changes at a boundary.
2. Read all players into one immutable snapshot.
3. Calculate every controller's requests from that snapshot.
4. Clear the previous substep's application-owned forces/torques.
5. Compute bounded motor contributions and apply them once.
6. Advance the physics engine by the substep duration.
7. Read solved contacts and body state; record diagnostics and stop conditions.

If the engine accumulates forces until explicitly reset, clear once and then sum all application-owned contributions. One subsystem must not erase another subsystem's current force.

Impulses are one-shot events. Never apply an impulse once per render frame or reapply the collision impulse already resolved by the engine.

Render independently with interpolation if useful. Slow motion changes how rapidly simulated time is consumed; it does not change force limits or the integration step. Pause freezes simulated time. Single-step advances exactly one configured outer tick.

Do not increase physics dt to catch up after a stall. Limit work per display frame and expose any discarded wall time; simulated fixture time remains the number of completed fixed ticks.

## 10. Fixtures and evidence

The fixtures below define requests and starting conditions, not trajectories after contact. Set initial velocities only at reset. Let bodies settle on the floor before t = 0 unless a fixture explicitly tests airborne behavior.

### G1-F1 — Free movement and finite stopping

One player starts at rest. Request +Z at 4 m/s for 1.5 s, then zero for 1.0 s. Record velocity, motor force, and travel distance.

Pass: force remains within its cap; acceleration and braking take time; zero request does not instantly zero velocity. Away from other contact, maximum acceleration attributable to the drive motor does not exceed its force cap divided by mass.

### G1-F2 — Symmetric mutual impact

Players start at X = -2 and +2 m, Z = 0, facing each other, with initial velocities +2 and -2 m/s along X. Disable drive/yaw for the impact interval. Use equal profiles.

Pass: bodies cannot pass through one another; both react; horizontal pair momentum is approximately preserved apart from measured floor impulses. Compare at matched times with a no-contact control fixture.

Repeat with player insertion/iteration order reversed. Use stable player IDs and compare corresponding records. Do not assume bitwise equality across platforms.

### G1-F3 — Off-center impact

Repeat an impact with a 0.35 m lateral offset in Z. Yaw is unlocked. Record contact location, displacement, yaw, and angular velocity.

Pass: a visibly and numerically different response from the centered fixture. No controller directly rotates the opponent.

### G1-F4 — Both players continue trying

Approach under opposing nonzero movement requests. Maintain requests for 2 s after contact.

Pass: neither controller is suspended by contact; neither body is assigned its desired velocity; both can be impeded and displaced. No minimum engagement duration exists.

### G1-F5 — Unequal mass and bounded effort

Use a 120 kg player and an 85 kg player with motor limits unchanged, then exchange the masses while preserving IDs and initial conditions.

Pass: recorded engine masses match configuration; acceleration/impact response changes through mechanics. Do not require one designated winner.

### G1-F6 — Airborne and high-speed robustness

For the airborne case, start one body 0.3 m above its resting height and request horizontal movement. For the impact case, use closing velocities up to 8 m/s per body with no initial overlap.

Pass: no ground drive while unsupported; gravity remains active; high-speed bodies do not tunnel. Numerical failures stop and label the trial.

### G1-F7 — Time, reset, and cosmetic independence

Run the same tick-indexed fixture under nominal 30 and 120 render FPS. Run it twice after reset. Change only colors/materials and repeat.

Pass: matching simulation configuration and input ticks reproduce state within the declared numerical tolerance. Cosmetic changes produce the same physical trace.

Default same-runtime comparison tolerances: position 0.001 m, linear speed 0.001 m/s, orientation 0.001 rad. Report a materially larger needed tolerance and its cause before claiming a pass.

### G1-F8 — Coached entry, mirrored leverage, and changing runner heading

Use the same entry controller with configured inside-out and outside-in approaches, then mirror the scene. Supply front, oblique, side, and rear starting positions and a runner whose requested heading changes once.

Pass: the selected hip/shoulder and leverage side influence requests; braking/turning remain finite; late entries may overrun or miss; the runner remains active. No contact is awarded from the controller phase.

### G1-F9 — Shoulder connection, glance, and head clearance

Demonstrate a compatible upper-body shoulder fit, an offset glancing contact, and a deliberately poor diagnostic approach. Show actual manifolds, shoulder patches, head landmarks, and the compound proxy.

Pass: contact is classified from geometry; no shoulder bonus impulse exists; head-first contact is not the controller's intended aim and is not erased. Normal and slow-speed visual inspection distinguish the cases.

### G1-F10 — Body-profile sensitivity

Repeat selected entries with explicit 80, 100, and 135 kg profiles and at least two torso widths/heights. Declare dimensions and capabilities separately from mass.

Pass: steering/reach geometry uses actual profiles; no universal center-distance snap exists; differences are traceable to configuration. These are fixture ranges, not a calibrated athlete population.

## 11. Debug UI and exported reproduction data

Show player ID, actual/requested velocity, drive-force vector/cap, actual/requested facing, grounded state, collision shape, and real contact locations. Display simulation time, fixed tick/substep, and numerical-failure status.

For coached entry also show observed/predicted hip, assigned leverage, selected shoulder, intended strike surface, approach phase, actual contact region, head clearance, and the active proxy profile.

Controls: fixture selection, run/pause, reset, single-step, playback speed, camera presets, and overlay toggle. Parameter changes that alter geometry/mass/solver settings require reset. Do not add a large editor.

Export a versioned fixture JSON containing body profiles, initial conditions, tick-indexed inputs, solver settings, fixture duration, and random seed if used. Randomness is unnecessary for these gates.

Provide compact traces and event logs sufficient to reproduce failed cases. Never label a numerical stop as a successful defensive stop.

## 12. Build milestones

| Milestone | Observable result | Completion evidence |
| --- | --- | --- |
| G1-A | Scene, fixed loop, one bounded motor | G1-F1 plus unsupported movement check |
| G1-B | Two independently controlled bodies with contact | G1-F2, F3, F4, F5 |
| G1-C | Reproducible, inspectable drill | F6, F7; normal-speed and slow-motion review |
| G1-D | Coached upper-body entry and contact profile | F8–F10; mirrored and failed entries |

Finish one milestone before starting the next. Run the repository's relevant type/build checks. Add focused numerical checks for motor bounds, collision causality, and repeatability; do not build a generic test platform.

## 13. Rubric

Grade each row 0 = missing/broken, 1 = partial, 2 = meets this specification, U = unverified. Completion requires 2 on every required row and no hard failure.

| ID | Criterion | Pass condition and evidence |
| --- | --- | --- |
| G1-R1 | Bounded execution | F1/F6 force and velocity traces; finite movement/braking and no unsupported drive |
| G1-R2 | Mutual collision | F2/F3 physical traces and inspected slow-motion evidence |
| G1-R3 | Independent intent | F4 source inspection and both input/motor traces |
| G1-R4 | Physical configuration | F5 mass verification; explicit collider and solver profile |
| G1-R5 | Reproducibility | F7 paired traces, reset, and exported fixture |
| G1-R6 | Readable presentation | Normal-speed and side/oblique slow-motion inspection; mesh/collider agreement |
| G1-R7 | Integration | Actual build/check results; existing blocking/playground regression evidence if present |
| G1-R8 | Football entry and connection | F8–F10; leverage/shoulder requests, real contact classification, and inspected misses |

Hard failures: nonfinite state; uncontrolled tunneling; per-step teleport/velocity overwrite; duplicated collision response; predetermined engagement/winner; broken required existing scenarios; unsupported claims of visual inspection.

At this gate, locked pitch/roll and approximate feet are documented limitations, not failures.

## 14. Paste-ready implementation goal

Use the installed tool's /goal command if available; otherwise use this as an ordinary task prompt. Start with G1-A. Use one active milestone at a time.

~~~text
/goal Implement and demonstrate G1-A in 01_Gate_1_Movement_and_Impact.md.

Read this specification and inspect the repository first. Reuse suitable existing
simulation, model adapter, physics, and UI components. All paths in the spec are
proposals unless verified in the repository.

Implement only the selected milestone. Both players retain independent intentions;
bounded mechanics and shared collisions determine actual motion. Preserve stable
IDs, nonexclusive contacts, one physical-state authority, and the visual adapter.

Completion requires the milestone's fixtures, applicable rubric rows, actual
build/check results, reproduction JSON, and inspected normal/slow-motion evidence.
Mark unavailable visual evidence U. Do not weaken checks or implement Gate 2.

Stop after a reviewable milestone handoff. If blocked or unfinished after 20 turns,
report progress, the blocker, and the next experiment. A bounded stop is not a pass.
~~~

Later milestone goals (run separately after the prerequisite passes):

~~~text
/goal Implement and demonstrate G1-B in 01_Gate_1_Movement_and_Impact.md.
Read the entire specification and inspect G1-A evidence first. Implement only
G1-B. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G1-C in 01_Gate_1_Movement_and_Impact.md.
Read the entire specification and inspect G1-B evidence first. Implement only
G1-C. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G1-D in 01_Gate_1_Movement_and_Impact.md.
Inspect G1-A through G1-C evidence first. Implement only the coached approach,
compound contact profile, fixtures G1-F8 through G1-F10, and applicable rubric.
Show real shoulder/head contact classification and bounded mirrored approaches
including a miss. Export settings and inspect normal/slow-motion evidence.
Preserve legacy fixtures; do not implement Gate 2. Mark missing evidence U.
Stop at a reviewable handoff; if unfinished after 20 turns, report the blocker
and next experiment without claiming completion.
~~~

## 15. Handoff and sources

Return: changed files and purpose; actual start/check commands; package versions; fixture JSON; measured limits; criterion-by-criterion grades/evidence; visual review status; limitations; next unresolved experiment. Include instructions to reproduce the least attractive failure, not only a successful impact.

Read official documentation for the installed package version:

- [Rapier rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)
- [Body types and kinematic limitations](https://rapier.rs/docs/user_guides/javascript/rigid_body_type/)
- [Forces and their persistent lifetime](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/)
- [Rotation locks](https://rapier.rs/docs/user_guides/javascript/rigid_body_locking_translations_rotations/)
- [Contact queries/events](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/)
- [Claude Code goal behavior](https://code.claude.com/docs/en/goal)

These sources establish engine/tool capabilities. The body profile, motor limits, fixture thresholds, and football abstractions above are authored design choices. They require implementation evidence and are not calibrated physiological measurements.

Coaching source mapping and full coverage limits: [Tackling review and implementation order](00_Tackling_Review_and_Implementation_Order.md), especially sources S2, S4, S5, and S8.
