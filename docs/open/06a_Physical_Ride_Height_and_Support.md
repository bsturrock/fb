# Physical ride height and support

Repository-aligned plan • 2026-11-05 • Implemented in the accepted 06a/07 checkpoint. The original RH profile preserves its incoming load-release rebound and one-arm hinge-limit rejection as evidence ([handoff](../handoff/plan06a.md)); 07 repairs them under explicit new profiles. Continuous visual acceptance remains open.

Previous: [committed running baseline](06_Supplied_Animations_and_Running.md). Next: [support recovery and contact footwork](07_Procedural_Contact_Footwork.md).

## Decision and boundary

Plan 06 is committed. Its pose-only physics invariance is historical evidence, not a constraint on this milestone. Fix the physical support height rather than offsetting the drawn pelvis. Locomotion requests a height; bounded physical support determines the achieved core motion; poses, contacts, rule observations and rendering consume that solved motion. No direct root positioning, hidden pelvis offset, bone stretching or enlarged handoff tolerance.

The reported hip heights (physical 0.981 m versus straight-leg 0.986 m; Fast Run 0.88–0.92 m and Sprint 0.86–0.94 m) motivate this work, but must be reproduced in a common calibrated coordinate system before tuning. Distinguish hip landmark, proxy origin, COM, shoe sole and ground height. Preserve plan 06's existing measurements and outcome records as the baseline.

This is a bounded suspension proxy, not physical walking. It makes bent-knee ground contact reachable; persistent foot planting remains plan 07. No independent foot bodies, spine, new motion clips or active fall responses.

## User decisions (2026-11-05)

Recorded in full in the [handoff](../handoff/plan06a.md#user-decisions-2026-11-05-and-how-they-are-implemented).

- **Balance ceiling.** While supported with a valid probe, the balance ceiling uses the nominal body weight: min(240, m g r). This supersedes the instantaneous N × r ceiling. Without physical support, or once falling, balance authority is zero. The absolute and combined torque ceilings are unchanged, and drive and yaw stay load-limited. Posture compensation uses the actual pivot load and the solved geometry.
- **Force application.** The clamped suspension force F is split: Fp = min(F, m g) acts at the turf below the body's calibrated legacy pivot (the support capsule's lower hemisphere centre), and the excess F − Fp acts through the COM. This is a deliberate suspension approximation: excess vertical load supplies lift without additional tipping torque. Both components and the resulting torque are recorded in the trace.
- **Sprint bob.** The reduced bob is kept provisionally (acceleration bound ≤ 0.75 g down). Tracking numbers measure agreement with the attenuated target, not preservation of the clip's original 8.1 cm motion.
- **Standing height.** 0.89 m root height (hips about 0.921 m) is the provisional initial athletic stance, subject to visual review. It is not a universal maximum.
- **Invalid-surface collapse.** The bump-stop collapse rule stays, explicit and tested. Leaving probe travel removes support and motor authority immediately, without an irreversible conversion. Re-acquiring support is allowed before falling begins and never after.
- **Flight and toe-off.** Visual-flight support stays as a declared approximation beyond 07; toe-off residuals and valid plants belong to plan 07. Neither is described as physical running or foot planting. Changing physical support during flight requires a separate future milestone.

## Implementation order

1. Record the committed Gate 1–4/model and L1 fixture outcomes, support geometry, mass/inertia, height, stance clearance and handoff evidence. Reproduce known failures instead of treating them as new regressions. Record the source revision and solver/profile identities.
2. Replace rigid floor support for the new profile with a finite ground-probed suspension. The existing full-length support capsule blocks descent: explicitly shorten/reconfigure its floor collision geometry or replace its support role before applying a height force. Keep physical body collision and a safe falling representation. Document ground filtering, probe extent, acceptable normals, support point and force application point. Ground detection must exclude players and self-colliders. Preserve total mass and intentionally specify COM/inertia; collider changes must not silently retune them.
3. Apply gravity compensation plus spring/damping feedback at each physics substep, using height and relative vertical velocity against the ground. Clamp support force to a declared nonnegative maximum; the ground cannot pull the player down. Declare target-height range, suspension travel, target slew, frequency/damping and saturation behavior. Log commanded/applied force and work. No position or velocity correction may hide tracking error. Begin with flat static turf; other surfaces need explicit evidence before being supported.
4. Define support eligibility independently of visible foot plants and of the old capsule manifold. A valid nearby ground probe alone is not proof of unrestricted traction. Declare how actual support load bounds drive, yaw and balance authority, and update support lever geometry from the solved body. No authority when the ground is beyond travel, the surface is invalid, or control is falling. Preserve irreversible loss-of-support/handoff policy; a probe must not rescue an already falling player. Update reset, settling, initial lean placement and contact diagnostics to use the new contract.
5. First validate constant standing and lower stance targets. Then derive running height from the clip's calibrated pelvis-to-ground trajectory, preserving its mean and bob before the existing mean-hip normalization discards them. Convert to physical root height with calibrated offsets; do not copy raw source metres. Blend clips, standing and stances with continuous bounded targets and shared phase. Target velocity must reflect the changing target. Sample/advance phase once per substep in a documented order before support forces; pose generation must not advance it again.
6. Keep running flight explicit. For this milestone the suspension remains the declared approximate support while both drawn feet may be airborne; visual flight does not disable or re-enable it. Real loss of probe support does disable it. Report this distinction in traces and acceptance; do not claim ballistic running. Reuse the existing bounded unsupported/falling playback fallback without phase/grounded feedback chatter.
7. Build legs around achieved physical hips and existing fixed lengths. Measure requested height, achieved height, phase lag, knee bend, stance sole gap and IK residual independently. Existing foot IK may improve contact but cannot certify world plants. Handoff uses the achieved pose and actual bulk vertical velocity; disable suspension and supported motors before falling forces. Keep candidate/transfer audits and safe rejection behavior.

## Compatibility and scope

Touch `physics.ts`, `profiles.ts`, `simulation.ts`, support/balance calculations and fixture initialization; extend clip intake/records, `run-clip.ts`, pose requests and trace/export only as needed. Rendering remains a consumer. Reuse the existing calibrated skeleton, two-bone solve and ankle/shoe frames. Forward lean uses the existing bounded posture request later, not an extra render transform.

Keep a named legacy support profile for historical Gate/L1 fixtures and evidence; opt new RH fixtures into suspension explicitly. Equal standing height does not imply equal dynamics. Re-run equivalent scenarios under both profiles and report changed physical outcomes, including before handoff. Plan 08 migrates integrated locomotion to the accepted new profile. Legacy compatibility is not evidence that new support passes old scenarios.

## Required fixtures and acceptance

| ID | Scenario | Required evidence |
| --- | --- | --- |
| RH-F1 | Standing equilibrium, reset and supported lean | Reproducible height, load, COM/inertia and settling; no force chatter |
| RH-F2 | Standing to crouched/staggered target and back | Continuous bounded request; physical movement; feasible calibrated bent-knee stance |
| RH-F3 | Fast Run and Sprint, acceleration/braking and clip seam | Mean height/bob, amplitude/phase error, saturation, stance gap and residual recorded |
| RH-F4 | Minimum/maximum target, excessive load and abrupt disturbance | Finite force/travel; controller can be overcome; no hidden root correction |
| RH-F5 | Ground out of range, invalid normal, other player below | No false support/traction; existing falling policy honored; no recovery after loss |
| RH-F6 | Legacy and suspension versions of movement, impact and L1 tackles | Outcome/force/balance deltas explained; known rejected candidates retained as baseline |
| RH-F7 | Handoff while rising, falling and at height extrema; either/both players | Actual vertical velocity transferred; no double support; unchanged boundary audits |
| RH-F8 | Render rates, hidden meshes, pause, single-step and repeated reset | Same fixed-step traces; no stale probe/controller state or resource growth |

Initial engineering targets: settled constant-height error <= 0.01 m, settling within 1 s, and no sustained oscillation after settling in RH-F1/F2. For unsaturated nominal running, target RMS height error <= 0.02 m and bob phase lag <= 10% of a stride; report amplitude ratio and extrema too. Tune under declared mass/speed/step conditions, then freeze settings before regression runs. An unreachable or saturated request is an explicit failed nominal case, not a reason to widen tolerances silently.

Require fixed-length error <= 0.001 m, shoe penetration <= 0.01 m and reachable bent-knee static acceptance poses. Report running stance gaps without calling them plants; persistent stance accuracy is accepted in 07. No support force beyond its cap; no supported drive/yaw/balance after support is disabled. Retain Gate 4 mass, momentum, energy and penetration tolerances.

Run focused controller/support tests, all tests, fixtures, typecheck and build. Review continuous normal-speed and slow playback from side/front/oblique views. Publish a handoff with reproduced baseline, settings, changed outcomes, saturation/lag and unresolved artifacts. Do not close this milestone on numerical bob alone if the body visibly bounces, feet remain unreachable, or tackles gain artificial recovery.
