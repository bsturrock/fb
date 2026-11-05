# Tackling Gate 4 — Ragdoll Handoff, Retained Wraps, and Drill Completion

Implementation specification v1.1 • 2026-11-02

Shared fixture contract: schemaVersion = tackling-v1.1. Export the active body, arm, solver, and rule profile identifiers wherever used; explicit legacy profiles remain reproducible.

Revision v1.1 distinguishes forearm-clamp handoff from hand-grip handoff and adds an explicit football-oriented ending subset. Sources, parallel work, and deferred tackle families are in [the review guide](00_Tackling_Review_and_Implementation_Order.md).

## 1. Outcome and contribution

When a player loses support, replace his single standing/falling proxy with an articulated passive ragdoll initialized from current simulation pose and motion. Continue collisions and valid individual hand/forearm retention. Observe ground contact, genuine stopped progress, and configured boundary endings through a separate rule observer. Retain the old core-only ending as a diagnostic profile.

The product destination is low-poly, CPU-versus-CPU American football with 22 independent players and coach-selected plays. Interactions should remain sensitive to position, effort, contact, and recovery. A fall must not acquire a paired animation's authority over another player.

**Contribution to the final product:** this gate connects the previously demonstrated movement, wrapping, and balance mechanics to a dynamic articulated fall. It establishes a reusable representation transition, including collision continuity, grip remapping, and observable completion.

This remains a two-player tackle laboratory. Passing this gate does not prove production football realism, reliable pileups, active recovery, or 22-player performance.

## 2. Prerequisites and baseline

Build after:

- [Gate 1](01_Gate_1_Movement_and_Impact.md): bounded movement, dynamic collision, fixed stepping, stable IDs, reproduction tools.
- [Gate 2](02_Gate_2_Reach_Grip_and_Wrap.md): achieved arm poses, one-arm hold, two-arm wrap, per-arm failure, shared effort.
- [Gate 3](03_Gate_3_Balance_and_Loss_of_Support.md): actual lean and angular motion, finite recovery torque, loss event, continued falling proxy.

Inspect the actual repository and evidence first. No repository paths or implementation quality were verified when writing this spec. Module names below are proposals.

Reuse the Simulation, PlayerController, BodyAndContact, Presentation, and TestScene boundaries. Preserve blocking/playground scenes and the explicitly selected legacy fixture profiles.

The supplied visual model may be a 25-bone, fingerless football player. Inspect its axes, units, hierarchy, skinning, and joint mapping. A segmented placeholder is sufficient; missing production artwork must not block the physical experiment.

## 3. Required scope and deliberate simplifications

Required:

- A simulation-owned articulated pose/landmark representation.
- A coarse ragdoll with finite segment lengths, connected joints, and elbow/knee bend limits.
- Collision-safe staging and atomic body replacement at a physics boundary.
- Mass and bulk momentum continuity.
- Both participants independently eligible to fall.
- Individual grip remapping, passive retention, and valid release.
- Correctly distinct forearm-clamp handoff and a declared ground/progress/boundary completion subset.
- Reproduction, quantitative audits, normal/slow-motion visual review, and regression.

Deferred:

- Active ragdoll locomotion, active get-up, physical foot support while standing.
- Learned movement, muscles, fingers, realistic injury, and production anatomical articulation.
- Stiff-arms, autonomous jukes, full-team pursuit, gang tackles, ball dislodging, penalty enforcement, and complete officiating. Gate 1's simple entry and Gate 3's continued finish remain available.

The first ragdoll has one rigid compound core for torso/pelvis, plus head and limb segments. There is no articulated spine. Shoulder/hip ball joints may remain without cone/twist limits in this coarse version; elbow/knee hinges and neck motion limits are required. Report this limitation honestly. Do not claim complete anatomical constraints.

Self-collision within one ragdoll may initially be disabled. Collisions with the ground and the other player remain enabled. Do not use self-collision filtering to disable collisions between different players.

## 4. Simulation pose, visual rig, and physical bodies

Introduce a physical-pose record with explicit joint landmarks and segment frames. The pose is generated from solved core motion, achieved arms, and a bounded procedural leg pose.

~~~ts
type SegmentId =
  | "core" | "head"
  | "leftUpperArm" | "leftForearm"
  | "rightUpperArm" | "rightForearm"
  | "leftThigh" | "leftShin"
  | "rightThigh" | "rightShin";

type Representation = "proxy" | "ragdoll";
type ControlMode = "supported" | "falling";

interface SegmentPose {
  segmentId: SegmentId;
  originWorld: Vec3;
  rotationWorld: Quat;
}

interface PhysicalPose {
  playerId: PlayerId;
  segments: Record<SegmentId, SegmentPose>;
  jointLandmarksWorld: Record<string, Vec3>;
}
~~~

The visible rig maps onto this pose. Do not use changing visual mesh bounds, material properties, or arbitrary Three.js bone names as collision configuration.

Expand Gate 2's BodyPartId from the single core value to the SegmentId set. Keep the same stable player/grip identities; replace only the physical part mapping.

Before conversion, the current visible player and candidate physical pose must agree. After conversion, physics bodies own segment transforms and Presentation maps those solved transforms to the rig.

Do not snap the player to a T-pose, replay a fall clip, or take a stale pose from several frames earlier.

For a skinned mesh, convert solved world segment targets into the correct parent-local bone transforms. Account for bind-pose offsets and the character root once. Applying root motion twice is a failure.

## 5. Initial ten-body blueprint

The table supplies an implementable placeholder. It is an engineering profile, not an anthropometric dataset. Match and explicitly adjust it to the verified rig when appropriate.

Local landmarks relative to the Gate 1 upright proxy origin at approximately Y = 0.95 m:

| Landmark | Local location |
| --- | --- |
| Pelvis midpoint | (0, -0.05, 0) m |
| Left/right hip | (±0.13, -0.05, 0) m |
| Left/right knee in straight reference | (±0.13, -0.49, 0) m |
| Left/right ankle in straight reference | (±0.13, -0.85, 0) m |
| Left/right shoulder | (±0.26, +0.50, 0) m |
| Neck pivot | (0, +0.64, 0) m |
| Head center | (0, +0.79, 0) m |

Use negative X for anatomical left and positive X for right. The ± notation above represents those two explicit records.

Use Gate 2's arm lengths: upper arm 0.35 m, forearm 0.34 m, palm extension 0.05 m. Current elbow/wrist positions come from the achieved pose, not a new reset pose.

Use the same declared torso/hip surface profile as the supported football proxy wherever possible. A proxy origin is not necessarily its COM; every transfer calculation uses actual engine mass properties.

| Segment | Fraction of total mass | Starting geometry |
| --- | --- | --- |
| core | 0.48 | Torso and pelvis shapes attached to one dynamic body |
| head | 0.08 | Sphere radius 0.14 m |
| each upper arm | 0.04 | Capsule radius 0.055 m fitted within shoulder–elbow extent |
| each forearm including hand | 0.03 | Capsule radius 0.045 m plus a small palm shape |
| each thigh | 0.10 | Capsule radius 0.085 m fitted within hip–knee extent |
| each shin including shoe | 0.05 | Capsule radius 0.065 m plus optional attached shoe box |

Fractions sum to 1.00: 0.48 + 0.08 + 2 × (0.04 + 0.03 + 0.10 + 0.05).

Core starting shapes, positioned relative to the proxy-origin frame:

- Torso cuboid center (0, +0.23, 0), half extents (0.25, 0.29, 0.15) m.
- Pelvis cuboid center (0, -0.08, 0), half extents (0.20, 0.13, 0.15) m.
- A small neck shape may bridge toward the neck landmark without adding another dynamic body.

For a capsule fitted inside a joint-to-joint segment of length L, radius r, use cylinder half-height max(0, (L - 2r) / 2). Its total outer extent is L. Do not accidentally add two radii to the specified limb length.

A shoe may be attached to its shin with initial half extents (0.08, 0.05, 0.14) m and center 0.05 m below and 0.08 m forward of the ankle in its reference frame. Shoes add colliders, not separate masses on top of the declared segment mass.

Set each body's total mass deliberately and retrieve its actual mass, COM, and inertia from the engine. Compound-collider body translation is not necessarily its COM.

## 6. Joints and collision configuration

Construct joint anchors from the same current world-space landmarks used by both connected parts:

~~~text
localAnchorA = inverseTransform(bodyAFrame, worldJointLandmark)
localAnchorB = inverseTransform(bodyBFrame, worldJointLandmark)
~~~

Require these anchors to coincide before the first step.

Initial joint profile:

| Joint | Type | Required bounds |
| --- | --- | --- |
| core–head | Neck hinge | Approximately -35 to +35 degrees in the declared bind frame |
| core–upper arm | Ball joint | Connected anchor; cone/twist bounds deferred for this coarse version |
| upper arm–forearm | Elbow hinge | Approximately 0 to 145 degrees of anatomical flexion |
| core–thigh | Ball joint | Connected anchor; cone/twist bounds deferred |
| thigh–shin | Knee hinge | Approximately 0 to 150 degrees of anatomical flexion |

Express bounds relative to a documented anatomical reference frame. Do not treat the arbitrary handoff pose as zero flexion and then apply limits intended for a straight limb.

Set hinge axes consistently in both body frames. Use a stable bend plane from the pose/profile; do not derive it from a zero cross product at a straight limb. If the installed engine needs explicit local joint frames, construct and validate them.

No locomotion or pose-following motors remain on the passive ragdoll. Joint limits and damping are constraints, not commands to reach a landing pose.

Rapier's supported joint APIs must be checked for the installed version. Do not assume a spherical joint offers the same limit methods as a revolute joint.

Collision filtering:

- Ground versus all relevant ragdoll segments: enabled.
- Standing other player versus ragdoll segments: enabled.
- Different players' ragdolls: enabled.
- Adjacent self-pairs: disabled to avoid rest-overlap impulses.
- Other same-owner self-pairs: may be disabled in the initial profile and must be reported.

Filter using owner/segment identity rather than treating every ragdoll as a single noncolliding category. Do not allocate one permanently unique physics bit for every future football player without checking the engine's bit limits.

## 7. Candidate-pose validation before switching

A single-body proxy can occupy space differently from the articulated body. A handoff into deep overlap will create artificial solver impulses.

Evaluate a candidate pose before enabling the new bodies:

1. All transforms, masses, and inertia values are finite and valid.
2. Limb lengths and joint anchors match their profile.
3. Hinge angles start inside permitted limits.
4. Ground clearance/penetration is within tolerance.
5. External-player/object penetration is within tolerance.
6. Held hands remain at their achieved points if the pose is to retain those grips.

Initial tolerances:

- Joint anchor separation before step: <= 0.002 m.
- New external/floor penetration: <= 0.015 m.
- Visible anatomical landmark discontinuity at the handoff: <= 0.01 m.

Use supported-state pose constraints ahead of time to avoid impossible candidate limbs. Those constraints may change requested leg/arm posing within reach limits, but may not teleport the root, stretch limbs, or preserve an invalid hand attachment.

Self-pair overlaps deliberately filtered by the ragdoll profile are separate from external penetration. Do not count arbitrary through-body limbs as good presentation merely because self-collision is disabled.

If a candidate fails validation:

- Keep the original proxy as a physically falling proxy with standing motors disabled.
- Record handoffRejected and its concrete reason.
- Mark that fixture invalid/unpassed for Gate 4.
- Continue safely or stop for diagnosis.

The fallback prevents a crash; it is not an accepted replacement for ragdoll success. Do not silently shrink collision shapes, disable external contacts, or translate the whole player upward to pass.

## 8. Atomic representation transition

Queue LossOfSupportEvent from Gate 3 after a solved substep. Perform the conversion before the next physics substep:

1. Snapshot old transforms, COM, velocities, mass, inertia, physical pose, and every affected grip's world anchors.
2. Build and validate candidate bodies/joints without advancing physics.
3. For several players converting at the same boundary, validate their candidate geometry together and process the transition as one batch.
4. Compute initial segment velocities as specified below.
5. Disable/remove each old proxy's collider/body and enable the replacement bodies with the correct filters.
6. Update stable player/segment mappings and remap all affected grips once.
7. Recompute the new step's application-owned forces for the new representation.
8. Advance physics.

Never simulate a step with both the old standing collider and the new ragdoll colliders active for the same player. Never simulate a gap where the player has no collision representation.

Do not transfer an already consumed contact impulse as a second impulse. The previous step's impact is already in the captured velocities.

Staged engine handles may differ; PlayerId remains unchanged. Remove stale contacts, joints, and lookup entries as part of the controlled transition, not by guessing that the old core handle still exists.

## 9. Mass and bulk momentum transfer

Keep total mass M identical before and after conversion. Do not add segment collider masses on top of the profile fractions.

For a one-body-to-many-body transition, assigning the old velocity to every part preserves translation but generally fails to preserve angular momentum. Use a bulk-motion transfer:

Let:

- C0 = old proxy world COM.
- v0, omega0 = old linear and angular velocity.
- I0 = old world-space inertia tensor.
- mi, Ci, Ii = each candidate body's mass, COM, and world-space inertia tensor.
- C = sum(mi × Ci) / M, the new assembly COM.
- ri = Ci - C.

Calculate:

~~~text
P = M * v0
L_about_C = I0 * omega0 + cross(C0 - C, P)

Iassembly =
    sum(Ii + mi * ((dot(ri, ri) * identity) - outer(ri, ri)))

omegaAssembly = inverse(Iassembly) * L_about_C

vi = P / M + cross(omegaAssembly, ri)
omegai = omegaAssembly
~~~

Use matrix/vector math with consistent world frames and validate that Iassembly is invertible. Do not confuse body-local principal inertia values with the world tensor.

This initializes a common rigid bulk motion for the new assembly. Initially omit extra cosmetic limb-swing velocities; including them requires a further momentum-correction calculation. Document that omission.

Audit immediately before and after the switch, with no physics step between:

- Mass difference <= 0.0001 kg.
- Relative linear-momentum error <= 0.00001, normalized by max(length(P), 1 kg m/s).
- Relative angular-momentum error <= 0.0001, normalized by max(length(L_about_C), 1 kg m²/s).

The different mass distribution can change kinetic energy even when P and L are preserved. Record both energies and the difference. Do not claim exact energy conservation.

For the required fixtures, an instantaneous energy gain above max(10 J, 50% of old kinetic energy) is a handoff failure to diagnose. Adjust the declared proxy/segment inertia or pose family using evidence; do not clamp new velocities while claiming momentum preservation.

Never add a cinematic launch impulse or zero motion to make the fall attractive.

## 10. Hand holds, forearm clamps, and wraps through a fall

Handle relationships per arm, not as a single paired tackle.

### Only the target of a hand surface hold becomes a ragdoll

For each standing owner's grip:

1. Preserve the old target anchor and normal in world space.
2. Map it to the corresponding candidate segment, initially core for Gate 2 torso contacts.
3. Convert that world point/normal to the new segment's local frame.
4. Verify that the point is still on that segment's actual eligible surface within 0.015 m.
5. Revalidate owner reach, arm pose, obstruction, and shared force budget.

If valid, preserve grip identity, desired length, and overload exposure. Continue the supported virtual arm law, applying force to the target segment and equal opposite force at the owner's shoulder.

If invalid, release with a recorded reason. Do not snap the anchor to a different nearby surface or reset its load history to rescue the hold.

### The hand-grip owner becomes a ragdoll

Active arm shortening stops. The owner's arm is now physically articulated.

Map the achieved palm-contact landmark into the appropriate forearm/hand rigid body's local frame. If target contact remains eligible, replace the powered shoulder-to-target link with a finite passive palm-to-target retention link:

~~~text
e = targetAnchor - ownerPalmAnchor
distance = length(e)
n = e / distance
separationSpeed = dot(vTargetPoint - vOwnerPalmPoint, n)

rawTension = max(0, passiveStiffness * distance
                   + passiveDamping * separationSpeed)
~~~

At approximately zero distance use zero force, not a division by zero. Apply tension toward the opposing anchor on each actual body. The force pair is collinear and reciprocal. It has no active shortening or desired landing pose.

Initial passive profile: stiffness 3,000 N/m, radial damping 100 N s/m, maximum anchor separation 0.10 m, shared owner retention budget 35% of its supported grip budget. Keep the existing overload-exposure/release mechanism with the allocated passive capacity.

The passive link approximates retaining an existing grasp. It may fail as the arm/body moves. It cannot acquire a fresh grip while the owner is falling.

Do not continue applying the old shoulder force as well as the new palm force. Ordinary body collisions remain active.

### Forearm clamps

Do not remap a forearm clamp as a fabricated palm grip.

If the target alone converts, the supported owner's arm remains in the query-arm model. Requery its real forearm contact against the new target segment, preserve only continuing contact history, and use Gate 2's closing-pressure/friction law under the shared budget. If geometry leaves a gap or changes to an ineligible surface, the clamp slips/ends normally. No remote anchor is created.

If the owner converts, stop its virtual closing-arm normal/friction force before the first ragdoll step. Its forearm/hand colliders are now physical. Let actual articulated limb contact, joint constraints, and ordinary friction determine whether the arm remains around the target.

Do not add a second custom clamp force on top of the same physical forearm contact. Do not weld that forearm to the target or keep applying a root-to-target virtual arm force. Existing genuine palm surface holds may retain through the separately specified passive grasp link.

A falling-owner forearm wrap may remain temporarily through geometry or open naturally. A supported-owner wrap on a falling runner can remain actively closed while valid. Neither outcome is guaranteed. Passive collision/joint impulses are distinct from capped active arm effort.

For a continuation across representations, classify current arm contact from actual manifolds and achieved limb geometry. Do not preserve a historical wrap flag once contact opens.

### Both players convert

Construct both candidates before remapping. Resolve both anchor mappings against the same boundary snapshot. Then allocate passive retention effort and validate relationships.

If a contact surface disappears or no longer fits, release. A grip may legitimately survive one conversion and fail during another.

### Wrap classification

Retain wrapped status only while both arms' current retention/contact and achieved around-body geometry satisfy Gate 2. For physical forearms, inspect their real manifolds/normal loading rather than expecting a palm anchor. New joint motion may turn a wrap into a partial or absent hold.

Do not preserve a wrap flag to force both bodies to land together. Classification adds no physical force.

## 11. Controller and presentation behavior

Both controllers may continue observing the world, but a falling ragdoll executes no standing drive, yaw, balance, or new reach/grip-acquisition commands.

A still-standing defender retains his own capabilities and bounded force budget. He is not frozen when the runner falls. If he also loses support, he converts through the same mechanics.

Presentation follows solved segment transforms. Map gloves and shoes to their owning limb bodies. A cosmetic ball can follow the runner's carry-hand/forearm mapping; it has no collision or fumble authority in this drill.

Maintain pose continuity at a physics boundary and interpolate rendering between compatible solved states. Do not interpolate between an old proxy transform and ten unrelated ragdoll transforms without resetting the interpolation history appropriately.

One cosmetic color/material change must leave all physical outcomes unchanged.

## 12. Rule observer, ball spot, and stopping

Separate physical motion, referee observation, and statistical tackle credit. A loss-of-support event or wrap flag cannot declare the play dead.

Keep two explicit profiles:

- labCoreOnly: historical diagnostic; a solved runner torso/pelvis-ground contact after valid handoff produces runnerCoreDown.
- footballTackleSubset: canonical v1.1 demonstration; observes eligible ground contact after defensive influence, sustained physically restrained progress, and a configured sideline.

The NFL-oriented subset is informed by official 2026 Rule 7-2-1. Contacted-runner ground endings include body regions beyond the core; the hand/wrist and foot/ankle exclusions must not be expanded to the entire arm or leg. Restraint can also end progress while upright. This is a limited game observer, not complete NFL/NCAA officiating.

### 12.1 Eligible ground contact

Track current ground-contact region and recent continuing defensive influence. A physical opponent impact, valid hand hold, or loaded forearm clamp can establish that influence.

Eligible tags include core, head, upper arm, elbow/forearm outside the wrist band, thigh, knee, and shin outside the ankle band. Excluded tags are hand/wrist and foot/ankle.

Split palm/shoe colliders from forearm/shin tags even if they share a rigid body. For an endpoint band on a larger collider, classify the actual contact point against the wrist/ankle landmark, initially using a declared 0.03 m band. Do not mark the whole forearm or shin excluded.

Use solved segment-ground contacts after handoff. For a still-supported proxy's limbs, a contact query against the simulation-owned achieved pose may detect eligible touching; it does not supply foot support or move the player. Queries must use the same world pose shown by Presentation.

Do not require ragdoll mode to recognize qualifying contact. Conversely, becoming a ragdoll does not itself establish ground contact.

For the drill's continuing-contact approximation, retain defensive influence through an uninterrupted fall/hold. Clear it after at least 0.20 s of regained supported balance, no retention or impeding opponent contact, and resumed unrestrained movement. An untouched fall is not automatically a contacted-runner ground ending; an opponent touching an already-grounded runner can establish the ending.

This history policy is a declared approximation. Do not use a single forever-true wasEverTouched flag.

### 12.2 Forward-progress observer

Configure a field-forward axis and a carried-ball reference point from the physical carry pose. A cosmetic ball still supplies a deterministic reference offset; there is no fumble simulation.

A starting referee approximation may declare progressStopped only when all are observed:

1. The runner continues requesting meaningful forward movement.
2. Actual retention or opposing body contact is physically restraining him; a low speed alone is insufficient.
3. Forward ball advancement remains <= 0.05 m over a continuous 0.75 s observation window.
4. Restraint persists through that window.

A loaded retention contact qualifies only with real current pressure/force. For a body-contact-only case, require an observed opposing downfield contact response, initially >20 N, rather than floor support or mere proximity.

Reset the window when restraint is lost or meaningful forward advancement resumes. An unopposed stopped runner, brief collision, or slow gather cannot produce a progress whistle.

These numbers are transparent simulation thresholds, not rulebook timing. The observer must log the predicate values and can be disabled for isolated mechanics fixtures. It cannot weaken opponents or guarantee a tackle after a fixed contact duration.

Record the best forward ball location within the continuous restraint episode. Do not reuse the furthest point from a much earlier free-running segment.

### 12.3 Sideline and event spot

Place a configured sideline inside the larger practice bounds, e.g. X = +4 m while the safety/drill edge remains farther away. Use actual physical body/ball ground-touch points or verified achieved foot-pose ground probes, not the player's COM crossing a line in midair.

The side-plane equation and touch tolerance must be exported. A default on/outside touch satisfies dot(point, outwardNormal) >= boundaryOffset. Airborne reach across the plane alone is not this subset's sideline event.

Keep practiceOutOfBounds as an invalid/outside-observation stop, distinct from the deliberate sidelineOut event.

For groundDown, progressStopped, or sidelineOut, record the earliest qualifying tick/substep, ball reference position, relevant body/contact IDs, and predicate evidence once. Do not move the official event/spot as the bodies later settle.

After an ending, stop new tackle acquisitions, active arm shortening, and tackle acceleration. A still-standing player's finite braking/upright support may remain. Let gravity, contacts, and existing passive motion settle for about 0.5 s without freezing or driving the opponent after the event.

### 12.4 Other endings and exclusions

Timeout, numericalFailure, and invalidHandoff are not successful tackles. Defender falling alone is not runner completion. A hand/foot brace alone is not groundDown. Runner contact with the other player is not ground contact.

Default full trial duration remains 6 s. Tackle-credit statistics, exact all-case spotting, fumbles, touchdowns, giving-up/sliding logic, and penalty enforcement are deferred.

The controller avoids deliberate helmet/facemask/collar targets. Full foul judgment remains a separate future observer. Do not label every rolling fall a hip-drop foul; preserve the rule's required conditions and sufficient motion evidence in any later implementation.

## 13. Fixed-step integration and cleanup

Per substep:

1. Process pending representation/control transitions as one boundary operation.
2. Snapshot all active representations and relationships.
3. Generate intentions independently.
4. Clear application-owned forces/torques on the current active bodies.
5. Apply supported motors only to supported proxies.
6. Advance supported arms; validate/remap relationships as needed.
7. Calculate supported hand/clamp and passive grasp demands under shared owner budgets; physical forearm contact is engine-owned.
8. Apply each reciprocal force pair once to the currently mapped bodies.
9. Step the single physics world.
10. Read contacts, enforce hand/clamp validity, evaluate supported players' balance, and queue transitions.
11. Update wrap classification and the selected rule observer's ground/progress/boundary events, traces, and stop conditions.

Reset removes old proxies, all segment bodies, ragdoll joints, transient query objects, contacts, grip/clamp mappings and tangent histories, queued transitions, pose history, and completion events. Recreate a clean configured scenario.

Repeated reset must not accumulate bodies/joints or GPU resources. Provide a body/joint/grip/clamp count display in debug mode.

## 14. Fixtures and quantitative evidence

### G4-F1 — Stationary handoff and settling

Use a diagnostic conversion of an upright, stationary player in a valid reference pose. This is a conversion test, not evidence of a contact-caused fall.

Pass: no T-pose snap, duplicate collider, unexplained launch, joint separation, or new deep ground penetration. Momentum/energy and geometry audits pass.

### G4-F2 — Moving and rotating conversion

Initialize nonzero translation and angular motion, then request a diagnostic conversion at a fixed boundary. Test several yaw orientations and a valid tilted pose.

Pass: the pose/mass/P/L continuity audits pass; movement direction is retained; no extra impact impulse appears.

### G4-F3 — Real one-arm and two-arm tackle falls

Use Gate 2/3 contact-driven scenarios, including a genuine wrap. Allow their physical support loss to trigger conversion.

Pass: active execution creates the disturbance; conversion follows actual pose/motion; surviving or released hand/clamp contacts agree with validation; the selected rule observer controls completion from observed events.

The same code must also demonstrate a failed/partial attempt where the runner remains mobile or escapes. Do not require every wrap to complete a tackle.

### G4-F4 — Grip remapping interventions

Exercise target-only conversion, owner-only conversion, and simultaneous conversion. Include one eligible surviving hold and one deliberately invalid surface/reach case.

Pass: valid anchors persist within tolerance; invalid grips release with reasons; active shoulder and passive palm forces never run together for one grip.

### G4-F5 — External collision and continuing opponent

Let a ragdoll contact a still-standing opponent and the ground. Also collide two ragdolls from different owners.

Pass: no inter-player collision filtering hole; the standing opponent still executes bounded intentions; additional contact affects the fall.

### G4-F6 — Bad candidate and safe failure

Construct a diagnostic pose with a joint mismatch or deep external penetration.

Pass: handoff is rejected and labeled; the old proxy continues safely as a falling proxy or the trial stops invalid. No hidden translation, shrink, collision disable, or completion claim.

### G4-F7 — Completion semantics

Exercise both explicit profiles. labCoreOnly must preserve the old diagnostic result. footballTackleSubset must cover:

| Case | Expected subset result |
| --- | --- |
| Hand/wrist or foot/ankle brace only | No groundDown |
| Knee, elbow, or eligible forearm ground touch with continuing defensive influence | groundDown, even before the core lands |
| Untouched fall with no qualifying history or touch | No contacted-runner ground ending |
| Opponent touches an already-grounded runner | Qualifying ground ending |
| Contact only with the other player; defender falls alone | No runner groundDown |
| Supported runner remains physically restrained and forward advancement stops | progressStopped only after its declared predicates/window |
| Unopposed stationary runner or freely advancing runner | No progressStopped |
| Eligible configured sideline touch | sidelineOut |
| Practice safety edge or numerical failure | Separate non-success label |

Pass: contact-region tags, continuing influence, and predicate traces explain the event. No fall animation/timer selects completion; the progress observer's window is evaluated only under actual continuous restraint.

### G4-F8 — Lifecycle and reproducibility

Run at least 30 reset cycles across supported, holding, one-player-converting, both-converting, and completed states.

Pass: active body/joint/grip/clamp counts return to the fixture baseline; no orphan IDs/handles; repeat traces match within declared same-runtime tolerances.

Repeat with different render rates, cosmetic colors, and reversed player/transition iteration order. Investigate solver-order sensitivity; do not promise cross-platform bitwise determinism.

### G4-F9 — Presentation and worst-case review

Inspect normal speed and slow motion from side and oblique views, plus overhead relationship review. Include a failed tackle, a wrap that breaks, simultaneous falling, and the least stable accepted case.

Pass: the switch is visually continuous; visible hands agree with their current constraints; elbows/knees do not reverse through forbidden hinge directions; the player does not visibly pass through the ground or another player.

Shoulder/hip looseness, rigid core, absent active recovery, and disabled self-collision must be listed as remaining coarse-model limitations.

### G4-F10 — Forearm-clamp representation handoff

Start with a genuine forearm wrap and no palm grips. Exercise target-only, owner-only, and simultaneous conversions.

Pass: a supported owner's valid virtual clamp can continue on the fallen target; a converting owner's virtual clamp force stops and actual forearm collision takes over. No new palm anchor or duplicate normal/friction force is created. Actual around-body contact, opening, or slipping determines wrap status.

### G4-F11 — Forward progress, boundary, and frozen event spot

Demonstrate a held-up upright stop, a runner who resumes progress before the window completes, a foot touching the configured sideline while the COM remains inside, and settling movement after an ending.

Pass: resumed/unrestrained progress resets the observer; actual boundary touch matters; the stored ball event/spot stays fixed while physical bodies continue settling. Do not give a physics timeout the same label as a referee ending.

## 15. Milestones and rubric

| Milestone | Required result |
| --- | --- |
| G4-A | Isolated blueprint, joints, pose mapping, and safe conversion; F1/F2/F6 |
| G4-B | Real support-loss handoff and hand/clamp continuity; F3/F4/F10 |
| G4-C | Ongoing contact and ground/progress/boundary completion; F5/F7/F11 |
| G4-D | Reset, reproduction, quantitative/visual review, and regression; F8/F9 |

Grade 0 missing/broken, 1 partial, 2 meets, U unverified. All required criteria must be 2.

| ID | Criterion | Evidence |
| --- | --- | --- |
| G4-R1 | Valid articulated body | Blueprint, actual mass/joint data, F1/F6 |
| G4-R2 | Continuity and atomicity | Boundary audit, active-body counts, F1/F2 |
| G4-R3 | Contact-driven falling | F3 input/contact/support event traces and failed-attempt comparison |
| G4-R4 | Grip/wrap survival and failure | F4 per-arm anchor/force/release traces |
| G4-R5 | Continuing mutual interaction | F5 collision/intent evidence |
| G4-R6 | Honest football ending subset | F7/F11 event matrix, restraint history, and stored ball spot |
| G4-R7 | Lifecycle/regression | F8; actual build/check results; prior gate profiles |
| G4-R8 | Readable physical presentation | F9 inspected normal/slow-motion evidence and limitations |
| G4-R9 | Correct forearm-clamp transition | F10; no palm glue and no duplicate virtual/physical arm response |

Hard failures: old/new colliders coexist during a solve; no active collider during a solve; pose reset; artificial launch; mass/P/L continuity failure; force duplication; remote or through-body grip; disabled inter-player contact; invisible completed-tackle flag; unsafe unreported fallback; false claims of inspection.

A valid local prototype can pass with the declared coarse articulation. It cannot claim full-game scalability or realistic athlete recovery from this evidence.

## 16. Paste-ready implementation goal

Start with G4-A. Use one active milestone at a time.

~~~text
/goal Implement and demonstrate G4-A in
04_Gate_4_Ragdoll_Handoff_and_Completion.md.

Inspect the actual repository and Gate 1–3 evidence first. Implement only the
selected milestone. Preserve previous fixtures and one physical-state authority.

Convert loss of support into an atomic, geometry-validated ragdoll handoff from
the current achieved pose and bulk motion. Audit mass, momentum, energy, joint
anchors, collision continuity, and per-arm grip remapping.

Both players may fall. Existing wraps can survive partially or fully, or fail
through normal validity/load checks. Do not freeze the other player, add a launch
impulse, double-apply grip force, or award completion from an animation or an unconditional contact timer.

Completion requires the milestone fixtures and rubric, exported reproduction
settings, actual check results, and inspected normal/slow-motion evidence.
Mark unavailable evidence U. Do not add active get-up, full-team pursuit,
fumbles, gang tackles, or full football rules.

Stop at a reviewable handoff. If blocked or unfinished after 20 turns, report
progress, the blocker, and the next experiment; do not claim completion.
~~~

Later milestone goals (run separately after the prerequisite passes):

~~~text
/goal Implement and demonstrate G4-B in 04_Gate_4_Ragdoll_Handoff_and_Completion.md.
Read the entire specification and inspect G4-A evidence first. Implement only
G4-B. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G4-C in 04_Gate_4_Ragdoll_Handoff_and_Completion.md.
Read the entire specification and inspect G4-B evidence first. Implement only
G4-C. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G4-D in 04_Gate_4_Ragdoll_Handoff_and_Completion.md.
Read the entire specification and inspect G4-C evidence first. Implement only
G4-D. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

## 17. Final handoff and references

Return changed files and purpose; actual run/check commands and package versions; active profiles; fixture JSON; source-to-ragdoll mapping; quantitative boundary audits; surviving/released grip evidence; rubric grades; visual status; remaining limitations; worst-case reproduction.

The four-gate project is complete only when each gate's applicable criteria pass or unresolved criteria are explicitly reported. A passing build alone does not establish convincing movement.

Official technical references:

- [Rigid bodies and mass/inertia](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)
- [Joints](https://rapier.rs/docs/user_guides/javascript/joints/)
- [Revolute joint limits](https://rapier.rs/javascript3d/classes/RevoluteImpulseJoint.html)
- [Spherical joint API](https://rapier.rs/javascript3d/classes/SphericalImpulseJoint.html)
- [Forces/point application](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/)
- [Contact queries/events](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/)
- [Claude Code goal behavior](https://code.claude.com/docs/en/goal)

The ragdoll profile, momentum-transfer policy, retention model, and completion rule are authored engineering choices. Verify them against the actual implementation and installed engine; they are not a previously validated football solver.

Football source mapping and deliberately deferred low/roll/gang tackle capabilities: [review guide](00_Tackling_Review_and_Implementation_Order.md). Its source S11 links the official 2026 NFL rulebook; the predicate windows, contact-history heuristic, and region bands above are explicit smaller simulation approximations.
