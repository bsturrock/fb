# Tackling Gate 2 — Reach, Breakable Grips, and Two-Arm Wrapping

Implementation specification v1.1 • 2026-11-02

Shared fixture contract: schemaVersion = tackling-v1.1. Export the active body, arm, solver, and rule profile identifiers wherever used; explicit legacy profiles remain reproducible.

Revision v1.1 distinguishes hand surface holds from forearm clamps. A canonical wrap must be demonstrated without palms glued to the runner. Source mapping, parallel-work boundaries, and deferred tackle families are in [the review guide](00_Tackling_Review_and_Implementation_Order.md).

## 1. Outcome and product context

Extend a two-player tackle laboratory so a defender can reach a runner, establish a real one-arm hold, and then attempt a two-arm wrap. Each arm moves and acquires contact independently. A hold transfers finite force to both bodies and can fail, stretch, slip, or release.

**Wrapping is included in this gate.** A single gripping arm is the first proof, not the completed wrapping feature. Two same-front retention contacts do not by themselves constitute a wrap. The canonical forearm-clamp demonstration may have no palm-to-runner grip at all.

The eventual game is low-poly Three.js, CPU versus CPU, with a coach calling plays and 22 independent players acting within assignments. Interactions must develop from bounded actions and current geometry. No paired animation or outcome roll may reserve or control both players.

**Contribution to the final product:** this gate establishes reusable reach, arm execution, persistent contact, force-limited retention, and circumferential wrapping. Gate 3 adds balance; Gate 4 carries valid grips through a dynamic fall. No chat history is required.

## 2. Prerequisite and active scope

Implement after the requirements in [Gate 1](01_Gate_1_Movement_and_Impact.md) have been demonstrated:

- Stable-ID player collection, shared physics, dynamic body contact, bounded movement/facing.
- Fixed ticks, deterministic fixtures, clear force ownership, pause/reset/single-step.
- Visual model separated from physical state.

Gate 1-A through C are sufficient for isolated arm experiments. Canonical Gate 2 wrapping acceptance also requires Gate 1-D's verified shoulder/contact profile. This permits preparation in parallel without bypassing integration checks.

No repository was inspected when writing this specification. Inspect actual code and evidence before implementation. All names below are proposed. Reuse the existing Simulation, PlayerController, BodyAndContact, Presentation, and TestScene boundaries.

Required:

1. One arm's bounded, collision-aware reach.
2. One arm hold with finite reciprocal force and physical failure cases.
3. Two independently controlled arms.
4. A wrap-attempt controller that requests paths around the runner's sides.
5. A geometric, observational distinction between one hold, two same-side holds, and a two-arm wrap.
6. Regression, causal fixtures, and visual review.
7. Forearm closing pressure, pressure-limited tangential friction, slipping, and independent reclosure after actual contact loss.

Deferred: balance loss, ragdolls, full-team pursuit/autonomous runner evasions, stiff-arms, hand-to-hand fighting, physical fingers, ball physics, fumbles, penalties, and multi-defender validation.

Pitch/roll remain locked in the Gate 1/2 profile. Grounded movement and yaw remain dynamic. Feet remain visual.

Do not replace existing physical blocking arms with this simplified tackle arm model. Where a bounded articulated-arm implementation already exists, reuse achieved limb/contact data and integrate the grip into that authority. Preserve the blocking drill.

## 3. Chosen physical approximation

For a new tackle prototype, use:

- One dynamic standing proxy per player: the legacy capsule for old mechanical fixtures and Gate 1's compound upper-body profile for canonical football fixtures.
- Achieved arm geometry with finite lengths, joint limits, finite endpoint speed, and collision-aware pose validation.
- Query-only hand/arm shapes while reaching. A verified closing forearm contact may apply the bounded clamp forces defined below; query shapes never bulldoze bodies as infinite-mass colliders.
- For an acquired palm surface hold, one powered virtual arm link between the defender's shoulder and a verified runner surface point.
- Forces on both bodies along that link, with finite capacity and continuous release checks.

This is not a complete physical arm or a literal topological loop. Reach-only arms supply no punch/stiff-arm forces. Core collision supplies body impact; verified hand holds and closing forearm contacts supply retention through their separate bounded laws. The achieved arm pose must fit around the runner without crossing the body.

The active scope is an upper-body shoulder/wrap foundation. Lowering a hand goal does not establish a thigh tackle: true low shoulder entry, leg restriction, and deliberate roll finishing need the follow-up capabilities listed in the review guide.

If existing articulated arms already transmit forces, integrate the new hold without applying a second copy of the same force. Choose one authority for each contact/constraint.

## 4. Coordinates and arm profile

Use meters, kilograms, seconds, newtons, and radians. Y is up; local +Z is player forward; local +X is anatomical right.

Use explicit physical shoulder and arm landmarks rather than reading arbitrary visual-bone transforms during simulation.

Initial placeholder profile, relative to Gate 1's core center:

| Parameter | Starting value |
| --- | --- |
| Left shoulder | (-0.26, +0.50, 0.00) m |
| Right shoulder | (+0.26, +0.50, 0.00) m |
| Upper-arm length | 0.35 m |
| Forearm length | 0.34 m |
| Elbow-to-palm extension beyond forearm | 0.05 m |
| Maximum shoulder-to-palm-contact reach | 0.72 m, below 0.74 m straight-chain length |
| Upper-arm query radius | 0.055 m |
| Forearm query radius | 0.045 m |
| Palm query radius | 0.04 m |
| Maximum endpoint speed relative to shoulder | 4.0 m/s |
| Surface/pose tolerance | 0.015 m |

For a simple two-bone pose solve, the effective elbow-to-contact length is 0.39 m. Map the forearm's final 0.05 m to the palm reference explicitly. The palm contact landmark, palm volume center, and wrist are different points; keep their offsets in the arm profile.

Adapt dimensions explicitly to a supplied model. Do not scale reach implicitly by changing artwork. Enforce limb lengths and joint limits even if a requested target is unreachable.

The initial wrap target band is the runner core center Y +0.05 to +0.40 m. This is a drill parameter, not a universal coaching or anatomical measurement.

## 5. Records and authority

~~~ts
type ArmSide = "left" | "right";
type ArmPhase = "rest" | "reach" | "close" | "hold" | "recover";
type BodyPartId = "core"; // expanded to ragdoll segments in Gate 4

interface ArmIntent {
  action: "rest" | "reach" | "close" | "pull" | "release";
  targetWorld: Vec3; // requested palm-contact landmark
}

interface ArmState {
  playerId: PlayerId;
  side: ArmSide;
  phase: ArmPhase;
  shoulderWorld: Vec3;
  elbowWorld: Vec3;
  palmContactWorld: Vec3; // achieved, not merely requested
  gripId: string | null;
  clampContactId: string | null;
  armedForFreshContact: boolean;
}

interface Grip {
  id: string;
  ownerId: PlayerId;
  arm: ArmSide;
  targetId: PlayerId;
  targetPart: BodyPartId;
  targetPointLocal: Vec3;
  targetNormalLocal: Vec3;
  desiredLengthM: number;
  overloadExposureS: number;
  createdAtTick: number;
}
~~~

Configuration holds stiffness, damping, force caps, reach, pull speed, and release thresholds. Do not duplicate independently editable versions of these limits inside each grip.

Grips and clamp contacts are nonexclusive collections keyed by stable IDs. One arm has one primary retention mode in this prototype: surfaceHold or forearmClamp. Do not apply a full hand-hold force and a full clamp force independently for the same arm. A player can have multiple ordinary contacts. A single engagedOpponent field cannot control physics.

Controllers request arm actions. BodyAndContact owns achieved arm geometry, grip creation/release, and physical effects. Presentation may not attach a hand that the simulation says has missed.

### 5.1 Forearm clamp contract

Keep the point-grip law in sections 7/8 for an actual acquired palm surface hold. A forearm clamp is a different relationship:

~~~ts
interface ClampContact {
  id: string;
  ownerId: PlayerId;
  arm: ArmSide;
  targetId: PlayerId;
  targetPart: BodyPartId;
  forearmParameter: number; // contact along achieved segment, 0..1
  pointWorld: Vec3;
  outwardNormalWorld: Vec3; // target toward forearm
  tangentElasticDisplacementM: Vec3;
  normalForceN: number;
  tangentForceN: Vec3;
}
~~~

Create/update it only from an eligible achieved forearm/body surface contact while the arm requests closure. An open arm merely near the torso has no closing pressure. A gap beyond the 0.015 m contact tolerance removes the clamp's normal and friction forces.

The contact point is a current surface observation, not a welded material point. Requery it as the arm or runner slides. A contact cannot chase a distant body to remain alive.

### 5.2 Closing pressure and friction

Compute an unobstructed requested arm pose and a collision-limited achieved pose. At corresponding forearm locations qWanted and qAchieved, with outward target normal n:

~~~text
closingError = clamp(dot(qAchieved - qWanted, n), 0, 0.08 m)
closingSpeed = max(0, -dot(vArmGoal - vTargetPoint, n))
Nrequested = max(0, normalStiffness * closingError
                   + normalDamping * closingSpeed)
~~~

Do not render the requested penetrating pose. The achieved arm remains on the exterior. Pressure exists only with actual eligible contact.

Start normal stiffness at 4,000 N/m, normal damping at 80 N s/m, friction coefficient mu = 0.8, and tangential stiffness at 1,500 N/m. Use no tangential damping in this first compliant-friction model; normal damping and fixed stepping address initial stability. These are uncalibrated virtual-arm coefficients.

Let vRelative = target-point velocity minus achieved forearm-contact-point velocity, including root rotation and measured bounded arm motion. Project into the tangent plane:

On acquiring a clamp, retain a preferred forearm station in the owner's physical frame. Longitudinal readjustment of that station is rate-limited, initially to 0.5 m/s relative to the owner; closure still acts toward the exterior surface. Do not chase an advancing target material point at free-reaching speed and thereby cancel all measured slip. The friction calculation must compare target material motion with the arm's owner-relative contact motion. A closest-point query changing its location along a surface is not the material velocity of that surface.

~~~text
vT = vRelative - n * dot(vRelative, n)
xT = projectToCurrentTangentPlane(previousXT) + vT * dt
FtWanted = -tangentStiffness * xT
Ft = clampVectorMagnitude(FtWanted, mu * Nrequested)
~~~

Initialize xT to zero on a fresh contact. If friction saturates, allow slipping and update elastic memory consistently:

~~~text
xT = -Ft / tangentStiffness
~~~

This is a compliant friction approximation. It prevents elastic error accumulating without bound while the runner slips. Reproject history as the normal changes; discard history when the surface patch no longer continues. Do not store a permanent surface anchor that follows the runner regardless of overlap.

If pressure is zero, set friction to zero and clear tangent elastic memory. If the shared actuator budget also binds, perform the slip-memory correction using the final actual tangential force after allocation. All configured stiffness values used as divisors must be positive.

Raw force on the target is -Nrequested * n + Ft. Apply its opposite to the owner at the same observed world contact point. The virtual limb transmits that force to its owner; the pair must not create net force or a spurious internal couple.

### 5.3 One shared arm-effort budget

For all an owner's active retention sources, construct a candidate force vector:

- Surface hold: the tension vector from section 7.
- Forearm clamp: its combined normal/friction vector.

Cap each arm's vector magnitude, then proportionally scale the vectors if the sum of magnitudes exceeds the total owner arm budget. Start with the existing 700 N per-arm and 1,000 N owner limits.

Scale a clamp's normal and tangential components by the same factors. Thus friction remains <= mu × actual normal force after budget allocation. Do not allocate fresh full force to every surface patch or to both modes on one arm.

Section 7's scalar allocation is the surface-hold-only special case. For mixed contacts the vector-magnitude allocator here governs. Ordinary engine collision impulses are passive contact responses, not additional arm motor effort.

If an existing physical-arm solver already supplies this normal/friction response, use its constraints and motor limits. Do not add these custom query-arm forces on top of the same engine response.

### 5.4 Clamp loss and renewed closure

Clamps slip through the friction law, lose force with normal pressure, and end when contact/pose/reach becomes invalid. They do not use the hand grip's overload timer as a wrap-success meter.

A supported arm may continue closing and regain clamp contact after actual separation/recontact. The withdrawal/fresh-close rule in section 8 applies to discrete palm-grip acquisition, not to ordinary forearm friction contact. Every renewed contact still requires valid geometry; it cannot be recreated remotely.

Keep one arm's failure independent from the other. Report normal pressure, friction demand/cap, slip, and contact loss so the user can see why retention failed.

## 6. Reach and contact acquisition

At each physics substep:

1. Read the same pre-step world snapshot used by the movement controllers.
2. Express the arm's goal relative to its current shoulder.
3. Clamp the endpoint's requested travel by maximum endpoint speed × dt.
4. Solve the arm with fixed segment lengths and a stable elbow bend direction.
5. Check the swept palm volume and resulting arm-segment volumes against relevant target/obstacle shapes.
6. Stop or slide along an obstruction within tolerance. Do not let the endpoint or intermediate segments tunnel through the runner.
7. Record requested and achieved positions separately.

Use real shape queries or an equivalent analytic capsule/segment implementation with bounded subdivisions. Account for relative body movement, not only a stationary runner: query the root motion sweep or predict relative motion and subdivide to keep query displacement bounded. Record the chosen implementation and its maximum unchecked displacement.

For the first prototype, use a conservative maximum query travel of 0.02 m per subdivision. Small palm queries must not silently skip the runner between endpoints. Engine CCD on the core does not solve query-only arm tunneling.

For an analytic two-bone solve, let a = 0.35 m and b = 0.39 m for the effective upper-arm and elbow-to-contact lengths. Given shoulder s and a clamped endpoint p:

~~~text
d = length(p - s)
direction = (p - s) / d
along = (a*a - b*b + d*d) / (2*d)
height = sqrt(max(0, a*a - along*along))
elbow = s + direction*along + perpendicularPole*height
wrist = elbow + (0.34 / 0.39) * (p - elbow)
~~~

Clamp d away from zero and within both the joint-limit and maximum-reach interval. Build perpendicularPole by projecting an outward elbow preference perpendicular to direction; retain a stable previous pole when the projection degenerates. Test the resulting segment volumes. A small fixed set of exterior pole alternatives is sufficient; if none is valid, report obstruction rather than pushing the elbow through the runner.

Store an unheld arm's achieved target/pole in the owner's physical frame. After a root physics step, derive its world pose again from the solved root and validate it against solved obstacles. Held endpoints are reconstructed from the current target anchor and current shoulder. Do not display a previous-root world hand position connected to a newly moved shoulder.

A grip can be born only if:

- The close action is requested and the arm is armed for a fresh acquisition.
- The achieved palm is in verified contact with an eligible runner surface.
- The shoulder-to-contact distance is reachable.
- The arm pose and intervening path are valid; the hand has not arrived through the runner.
- The contact normal/hand orientation allows the palm to face the surface.
- The world point is inside the configured target band for this drill.

Persist the actual contact point and surface normal in target-body local coordinates. A requested target, broad overlap, proximity radius, or close button by itself is insufficient.

Use only the contact's own participant/part identity. Do not search for the nearest runner and attach to him after an arm misses.

On acquisition, initialize desiredLengthM to the actual shoulder-to-contact distance. This avoids a force jump caused by starting with an artificially short arm target.

## 7. A finite powered arm link

Define:

- s = owner's shoulder position.
- p = target surface anchor in world space.
- L = length(p - s).
- n = (p - s) / L, with a zero-distance guard.
- vS and vP = point velocities including each body's angular velocity.

For a rigid body, point velocity is COM velocity plus angularVelocity cross (point - COM).

When the controller requests pull, shorten desiredLengthM at a bounded rate toward a configured minimum. Otherwise preserve its current value or allow a bounded relaxation. Never snap it shorter.

Initial tuning profile:

| Parameter | Starting value |
| --- | --- |
| Link stiffness | 2,500 N/m |
| Separation damping | 120 N s/m |
| Per-arm force ceiling | 700 N |
| Total owner grip-force budget | 1,000 N across all owned grips |
| Pull shortening speed | 0.5 m/s |
| Minimum desired length | 0.35 m, also constrained by feasible arm pose |
| Reach tolerance | 0.015 m |
| Overload release threshold | 0.10 equivalent overload-seconds |
| Overload recovery rate | 0.5 exposure-seconds per second |

These are uncalibrated game-model starting values. Preserve causal bounds while tuning.

For a taut link, calculate:

~~~text
extension = L - desiredLength
separationSpeed = dot(vP - vS, n)

if extension <= 0:
    rawTension = 0
else:
    rawTension = max(0, stiffness * extension
                       + damping * separationSpeed)
~~~

This surface-hold link supplies tension only. Core contact supplies body compression; a separately verified forearm clamp supplies its own bounded normal/friction response.

### Shared effort allocation

Calculate all an owner's grip demands from the same snapshot before applying any force:

~~~text
individualDemand[i] = min(rawTension[i], perArmCeiling[i])
scale = min(1, totalGripBudget / sum(individualDemand))
actualTension[i] = individualDemand[i] * scale
if scale < 1:
    allocatedCapacity[i] = actualTension[i]
else:
    allocatedCapacity[i] = perArmCeiling[i]
~~~

Guard the zero-demand case. Under a binding shared budget, each arm's allocated capacity is its actual share; this makes overload detection recognize that even a small demand may be under-supplied. When the shared budget does not bind, the per-arm ceiling limits retention. Zero demand never creates overload by division through zero. This policy deliberately shares capacity proportionally to capped demand; it is an explicit approximation. Do not evaluate each grip as if it owned the entire player budget.

Apply -n × actualTension to the target at p and +n × actualTension to the owner at s. The opposite collinear forces transfer both momentum and torque appropriately for the virtual link.

Record the force pair. Do not move either body directly. Do not add another force because the wrap-status flag becomes true.

## 8. Slip, release, and reacquisition

Before applying force, release if the arm is unreachable, the target no longer exists/is eligible, the controller requests release, or an achieved arm pose cannot remain valid around an obstruction.

Use current and conservatively predicted shoulder-to-anchor separation to avoid applying a long-distance force for another whole substep. Revalidate after solving and release invalid grips before publishing the visible pose.

For overload, compare raw demand against allocated capacity:

~~~text
excessRatio = max(0, rawTension / allocatedCapacity - 1)
exposure += excessRatio * dt
if excessRatio == 0:
    exposure = max(0, exposure - recoveryRate * dt)
release if exposure >= overloadThreshold
~~~

Guard zero capacity; zero available capacity cannot sustain a loaded hold. Exposure approximates slipping under excessive load. It is not a tackle-success meter. Keep it per arm; do not pool it into a winner score.

Reach/invalid-geometry release is immediate and bypasses overload tolerance. Release stops force application; it never adds a launch impulse.

Log specific reasons: voluntary, unreachable, invalidPose, lostTarget, overload, or invalidSurface.

After release, require the hand to withdraw at least 0.08 m from the target surface and enter a fresh close attempt before rearming. This prevents a failed hold from recreating itself every substep. Rearming follows geometry and a new action, not a guaranteed regrip timer.

## 9. Two independent arms and wrap-attempt controller

After one arm passes its fixtures, enable the other arm using the same code and a second ArmState. Do not duplicate the solver or introduce a synchronized arm animation.

The wrap controller generates separate arm targets around opposite sides of the runner. Canonical wrapping uses forearm closure rather than requiring two palm grips. A minimal attempt can use the phases:

1. Approach the runner's near-side torso band with both hands open.
2. Spread toward accessible left/right exterior waypoints.
3. Move along exterior arcs toward the runner's sides.
4. Close each arm against an eligible exterior surface; a palm grip additionally requires its own eligible palm contact.
5. Sustain actual clamp pressure or pull through an acquired surface hold while continuing the other arm's attempt.
6. Abort/recover an obstructed or unreachable arm without freezing the other arm or either player's movement.

Waypoints are motion requests, not prescribed achieved paths. Advance a phase using observed hand position/contact progress; a timeout may abandon an attempt but cannot establish contact or declare a wrap.

Generate the side paths from current runner geometry. Keep elbows outside the runner's occupied volume; do not interpolate the hands along a chord through his torso. The two-bone pose's bend direction must be stable and favor an exterior elbow location.

Do not require palms to meet behind the runner. Whether that is reachable depends on dimensions and approach. This prototype represents wrapping as arms closing around opposite sides with valid contact and geometry.

## 10. Geometric wrap classification

Wrap classification describes an existing configuration. It does not create extra force, disable escape, or determine completion.

For two active arm-retention contacts on the same target core, from verified surface holds or pressure-bearing forearm clamps:

1. Project the owner's shoulder midpoint and runner center into the horizontal plane.
2. Define nearDirection from the runner toward the owner; define an orthogonal sideDirection consistent with the owner's approach right.
3. Compute each contact's azimuth:

~~~text
theta = atan2(dot(radialContact, sideDirection),
              dot(radialContact, nearDirection))
~~~

4. Require the left/right contacts to have opposite azimuth signs. For a clamp use its observed forearm surface point, not a fictitious palm anchor, and require actual allocated normal force >1 N.
5. Initially require each absolute azimuth to be at least 55 degrees, so the near-side angular span is at least 110 degrees.
6. Require both arms to remain reachable, their elbows/forearms outside the core, and both contacts inside the declared height band.

Guard degenerate approach/radial vectors by retaining the last valid approach basis for the attempt. Show this basis in debug view. These angles are diagnostic engineering thresholds, not measurements of proper football technique.

Possible status values:

- noHold
- oneArmHold
- twoArmHold: both arms retain through their chosen mode, but circumferential/pose conditions are unmet
- wrapped: both independent retention contacts and the geometric conditions are met

The status can revert from wrapped to oneArmHold as one arm slips. A one-arm hold can still redirect or topple a runner in later gates. A wrap can still fail.

## 11. Step order and presentation

For every fixed physics substep:

1. Snapshot all players/parts.
2. Compute all movement and arm intentions.
3. Clear application-owned force/torque accumulators.
4. Apply bounded movement/yaw requests.
5. Advance unheld arms using collision-aware reach; collect valid acquisitions.
6. Validate surface holds and current forearm clamps; calculate all demands; allocate shared per-player arm budgets.
7. Apply reciprocal retention forces once, including verified clamp normal/friction forces.
8. Solve physical bodies and their ordinary collisions.
9. Reconstruct achieved arms against solved roots/current contacts, revalidate reach/pose/surfaces, and release failed relationships. Clamp contact is not a welded anchor.
10. Update wrap classification and log actual state.

Presentation maps the achieved arm pose, not the desired target. A held palm follows the verified target anchor only while the arm can physically reach it. Clamp/release before rendering an impossible limb.

For a forearm clamp, the palm is not attached to the runner unless a separate eligible hand hold actually exists. Show the achieved forearm/body contact and a feasible hand position around or beyond the side.

Record any residual geometric error. Do not conceal a disconnected hand with an independently positioned glove.

## 12. Fixtures and acceptance evidence

Retain Gate 1 fixtures. Inputs can be deterministic fixture requests; autonomous football pursuit is unnecessary.

### G2-F1 — Reach and obstruction

Reach a reachable surface, then request a target beyond reach and one on the far side through the runner.

Pass: reachable motion is finite and visible; impossible requests remain unmet; no grip is created through the body or across excess distance.

### G2-F2 — One arm, acquisition and mutual drag

Use one enabled arm in surfaceHold mode, with the forearm-clamp mode disabled for this isolated fixture. Place the bodies within reachable side contact and request close, then pull. The runner continues requesting travel.

Pass: the hold is born from contact; actual force remains bounded; both bodies react. It is possible for the runner to move the defender while held.

Repeat with acquisition disabled while preserving core collision and movement. Compare force/displacement traces after the candidate touch. Differences must follow the arm force, not changed collision filtering.

### G2-F3 — Escape, overload, and reacquisition

After a valid hold, request increasing separation or an unfavorable turn. Exercise reach loss, overload, voluntary release, and the withdrawal/fresh-close rule.

Pass: force stops when released; no launch impulse; no hand stretch beyond tolerance; no immediate automatic reattachment while still touching.

### G2-F4 — Two hands on the front

Acquire two eligible front contacts with contact azimuths near ±15 degrees.

Pass: status is twoArmHold, not wrapped. No special resisting force appears when the second hand touches.

### G2-F5 — Successful circumferential wrap

Begin with compatible dimensions and a near-side approach. Run the same bounded arm controller through exterior paths.

Pass: arms reach around opposite sides; pose/collision checks remain valid; status changes to wrapped only after both contacts satisfy the geometric conditions.

Inspect normal speed and front, side, and oblique slow motion. A top-down view alone cannot prove the arms avoid the torso.

### G2-F6 — Failed or partial wrap

Use the same controller and arm profile; increase separation, offset the runner, or obstruct one arm. Do not modify the outcome logic.

Pass: one arm can miss or remain obstructed while the other holds. There is no snap into a completed wrap.

### G2-F7 — Wrap breaks one arm at a time

From a valid wrap, change movement/facing to load one arm disproportionately.

Pass: an individual release can leave a one-arm hold; the second hand is not automatically released or guaranteed to stay attached.

### G2-F8 — Shared force and reciprocal-force audit

Load both grips above the shared budget. Sum actual scalar tensions for each owner and inspect each force pair.

Pass: total tension <= owner budget + 0.01 N; each tension <= its allocated capacity + 0.01 N; each pair's vector force sum has magnitude <= 0.000001 N before engine integration.

Repeat with mixed surface/clamp modes using the shared vector allocator. Sum all active arm-force magnitudes against the owner budget and verify clamp tangential force <= mu × actual normal force + 0.01 N. Ordinary passive engine contact impulses are reported separately.

Repeat arm evaluation in reverse order. Demands, allocations, and release events should agree within declared numerical tolerances.

### G2-F9 — Reset and timestep robustness

Reset repeatedly; use different render rates with identical fixed input ticks. Ensure no orphan grip IDs or stale collider handles remain. Repeat high relative hand/body movement with the configured query subdivisions.

Pass: reproducible contacts, no query tunneling, finite state, and intact Gate 1 behavior.

Fixture positions and exact event times must be exported from the working build. Do not claim the above unexecuted scenarios have already passed.

### G2-F10 — Forearm wrap without attached palms

Use the compound upper-body profile. Disable palm-grip acquisition and attempt closure around opposite sides with both forearms.

Pass: eligible forearm contacts carry closing pressure and friction; palms are not remotely attached; wrap classification uses real around-body geometry. The runner can slip or pull the tackler despite the wrap.

Compare with closing effort disabled while preserving body contact and movement. Clamp normal/friction force must disappear; no hidden wrap-resistance bonus may remain.

### G2-F11 — Pressure, friction, and slipping intervention

Load a forearm clamp tangentially. Compare unchanged geometry with lower closing-force capacity or lower friction, selecting a fixture where that limit actually binds.

Pass: force traces respect the friction cone and shared budget; elastic history does not grow without bound during sliding; retention can fail through actual loss of contact. Zero pressure gives zero clamp friction.

### G2-F12 — Continued arm work after an imperfect connection

Use the same controller with an offset approach and a runner that continues movement and changes facing. Let one arm slip; keep the other's valid action active.

Pass: bounded closure/readjustment may improve the partial hold or fail. There is no standard-pose reset, both-arm release requirement, or automatic new grip.

## 13. Milestones and rubric

| Milestone | Required result |
| --- | --- |
| G2-A | Achieved one-arm reach; G2-F1 passes |
| G2-B | One breakable reciprocal hold; F2/F3 and single-arm force audit pass |
| G2-C | Two independent arms and real forearm wrapping; F4–F8 and F10/F11 pass |
| G2-D | Continued work, regression, robustness, and inspected presentation; F9/F12 and full review pass |

Show requested/achieved hand targets, arm segments, target anchor/normal, contact azimuths, arm phase, grip ID, raw/actual tension, allocated capacity, overload exposure, and release reason. Keep the UI compact.

Grade 0 missing/broken, 1 partial, 2 meets, U unverified. All required rows must be 2.

| ID | Criterion | Evidence |
| --- | --- | --- |
| G2-R1 | Reach and real acquisition | F1/F2 source, query traces, and inspected motion |
| G2-R2 | Finite reciprocal hold | F2/F8 force ledger and causal comparison |
| G2-R3 | Physical failure/recovery | F3/F7 release traces and visual evidence |
| G2-R4 | Actual wrapping | F4/F5/F6 geometry, pose validity, and multiple views |
| G2-R5 | Independent arms/shared effort | F6/F7/F8; no exclusive paired state |
| G2-R6 | Reproducibility/integration | F9; Gate 1 and existing applicable scenario checks |
| G2-R7 | Presentation agreement | Achieved limb geometry matches the visible body, including failures |
| G2-R8 | Forearm clamp causality | F10/F11; actual pressure, friction-limited slip, shared vector budget, and no palm glue |
| G2-R9 | Continued independent execution | F12; partial retention, readjustment, and a failed improvement case |

Hard failures: grip without eligible contact; through-body acquisition; unlimited force; remote tether; outcome roll; paired target lock; wrap flag adds magical resistance; force budget duplicated per arm; one player is frozen; impossible visible limb; unverified evidence reported as inspected.

## 14. Paste-ready implementation goal

Start with G2-A. Use one active milestone at a time.

~~~text
/goal Implement and demonstrate G2-A in 02_Gate_2_Reach_Grip_and_Wrap.md.

Inspect the repository and Gate 1 evidence first. Implement only the selected
milestone. Reuse the existing body/contact authority and model adapter.

The feature includes wrapping: the one-arm hold is a prerequisite; a completed
Gate 2 requires two independent arms reaching around opposite runner sides.
Two same-front contacts must not be classified as a wrap.

Require actual eligible contact, reachable achieved geometry, bounded reciprocal
forces, a shared owner force budget, and independent failure/release. No paired
animation, outcome roll, hidden resistance bonus, or remote attachment.

Demonstrate the milestone fixtures and rubric with exported settings, force and
contact traces, actual checks, and inspected normal/slow-motion evidence.
Mark unavailable evidence U. Preserve Gate 1 and existing blocking/playground
behavior. Do not implement balance or ragdolls.

Stop at a reviewable handoff. If blocked or unfinished after 20 turns, report
progress, the blocker, and the next experiment; do not claim completion.
~~~

Later milestone goals (run separately after the prerequisite passes):

~~~text
/goal Implement and demonstrate G2-B in 02_Gate_2_Reach_Grip_and_Wrap.md.
Read the entire specification and inspect G2-A evidence first. Implement only
G2-B. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G2-C in 02_Gate_2_Reach_Grip_and_Wrap.md.
Read the entire specification and inspect G2-B evidence first. Implement only
G2-C. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

~~~text
/goal Implement and demonstrate G2-D in 02_Gate_2_Reach_Grip_and_Wrap.md.
Read the entire specification and inspect G2-C evidence first. Implement only
G2-D. Completion requires its fixture set, applicable rubric criteria,
exported reproduction settings, actual build/check results, and inspected visual
evidence. Mark unavailable evidence U. Preserve the physical-state ownership,
bounded forces, individual player decisions, valid contacts, and prior scenarios
required by the specification. Do not weaken checks or advance beyond this
milestone. Stop at a reviewable handoff; if unfinished after 20 turns, report
progress, the blocker, and the next experiment without claiming completion.
~~~

## 15. Handoff and sources

Return changed files; actual run/check commands; versions; arm/force/query profiles; fixture JSON; rubric grades and evidence; known approximation limits; worst failed-wrap reproduction; next unresolved experiment.

Official technical references:

- [Forces and point application](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/)
- [Queries, contacts, and events](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/)
- [JavaScript API index](https://rapier.rs/javascript3d/)
- [IK concepts, targets, and joint constraints](https://create.roblox.com/docs/animation/inverse-kinematics)
- [Claude Code goal behavior](https://code.claude.com/docs/en/goal)

The virtual-arm law, wrap classification, parameters, and fixtures are authored game-design approximations. The Roblox page is an explanation of IK concepts, not a dependency recommendation for a Three.js project.

Football source mapping: [review guide](00_Tackling_Review_and_Implementation_Order.md), especially S3, S7, and S9. The clamp force law is an authored compliant-contact approximation, not a force model measured from those coaching materials.
