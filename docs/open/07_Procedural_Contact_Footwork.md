# Procedural contact footwork

Repository-aligned plan • 2026-11-05 • Planned.

Previous: [supplied running](06_Supplied_Animations_and_Running.md). Next: [transitions](08_Locomotion_Transitions_and_Tackle_Integration.md).

## What is new

`buildProxyPose` already has actual-velocity-directed leg swing, fixed-length IK, stable hinge frames, floor/shoe checks and sticky clearance alternatives. `PoseMemory` stores candidate indices; it is not a world-space foot plant or step scheduler. Add persistent per-foot plant/swing state and finite short contact steps. Reuse the existing solve rather than introduce another leg solver or pose composer.

Use calibrated model geometry first. Check whether a bent-knee floor stance is reachable at the actual supported core height. Report infeasible configurations; never lower the physical root, stretch bones or silently change support radius to make the feet fit. Shoes remain shin-owned rigid shapes; do not require independently rolling ankles/toes.

## Implementation

1. Store per-foot achieved target, world anchor/contact feature, planted/swing/airborne state, swing progress, destination and release reason in player-owned simulation state. Initialize from the current achieved pose, not a standard brace pose.
2. Plan from solved core translation/yaw, actual local velocity and existing support/control mode. Stationary contact should settle without marching. Backward dragging must produce backward adjustments even when requested velocity is forward. Use reach margins and hysteresis to trigger steps; alternate when feasible, but release both anchors if the geometry requires it.
3. Move swing targets on bounded trajectories with finite speed, duration and clearance. Retarget from the current target without resetting the trajectory. Preserve a planted contact feature in world space while valid. Excess reach, yaw, obstruction or support loss releases it with a reason; no teleport to a plausible stance.
4. Feed targets through existing `twoBone`, `hingeChain`, `legShapes` and clearance queries in `pose.ts`. Report achieved residuals and any clearance-driven departure from a plant. A clamped IK endpoint is not a successful plant. Keep numerical singularity fallbacks and profile length checks.
5. Do not let foot states change physical grounded state, drive/balance torque, friction or completion rules. Stop new supported steps at loss of support; an articulated player uses `ragdollPose`. Rejected candidates retain the existing explicit failure/falling-proxy behavior.
6. Trace anchor drift, requested/achieved targets, swing limits and release reasons. Reset state alongside gait/pose memory. Add overlays to existing lab views only as needed.

## Scope and acceptance

Extend `src/sim/pose.ts` and `Simulation.updatePoses` with a small planner if needed; reuse model/ragdoll profiles. Add fixtures through the existing registry and focused planner/pose tests. No controller, motor or physics support rewrite is required.

## 13. Fixtures and measurable acceptance

| ID | Fixture | Required behavior |
| --- | --- | --- |
| L2-F1 | Neutral/staggered stance feasibility | Reachable floor geometry with intended bend; no hidden pelvis lowering or length changes |
| L2-F2 | Stationary loaded contact for 3 s | Settles without constant marching; no physical force change from foot state |
| L2-F3 | Slow forward travel then stop | Short finite steps; world plants stay fixed until released; clean settling |
| L2-F4 | Backward drag while desired velocity is forward | Steps respond to actual backward movement; no forward treadmill cycle |
| L2-F5 | Left/right displacement and yaw | Mirrored behavior, no indefinite foot swivel, no knee flip or crossed legs |
| L2-F6 | One planted/one swinging, then both airborne | Preserve initial states; no instant grounded reset |
| L2-F7 | Sudden hip displacement beyond reach | Release invalid anchor, finite constrained pose, explicit reason; root untouched |
| L2-F8 | Actual support lost and physical falling | No new authoritative plants or recovery support; ragdoll override respected |
| L2-F9 | Zero-distance, full extension, extreme target, turn singularity | Finite IK, stable bend convention, valid joint limits, recorded residuals |
| L2-F10 | Render FPS/visibility, pause/reset | Same planner trace at equal fixed tick counts; no duplicate liftoff/touchdown events |

Measure:

- Anchored contact-feature drift <= 0.01 m while the anchor remains valid. Measure the feature, not the ankle of a rolling foot.
- Limb length error <= 0.001 m and no forbidden knee/hip/ankle limits.
- Ground penetration <= 0.01 m in accepted flat-ground stance/swing fixtures; evaluate shoe volume as well as its landmark.
- Commanded swing/retarget speeds inside caps, with passive impact-induced corrections separately labeled.
- Mode/step decisions reproducible at equal fixed tick counts on the same runtime.

Compare enabled/disabled procedural-foot rendering against the same physical run before ragdoll conversion. Root motion, force budgets, grip results, and balance decisions must be unchanged. If the canonical leg pose is changed before a later ragdoll, resulting articulated falls can legitimately differ; use the same pose config for ragdoll comparisons.

Numerical success is necessary but not sufficient. Feet should read as purposeful short steps, with visible differences between forward effort, sideways recovery, and backward dragging.

Run the new checks, existing model/Gate 4 regressions and typecheck; review forward, sideways and dragged contact motion at normal and slow speed. Record unreachable stances and residuals rather than enlarging acceptance tolerances. Integrate automatic run/contact selection in document 08; isolated planner fixtures can be developed before supplied clips arrive.

## Optional implementation reference

[Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): Its IK-rig approach may inform mapping animation targets to different limb proportions. Reuse our existing twoBone/hingeChain solver; persistent plants, clearance and step scheduling still belong to this simulation. Treat it as a reference, not a required dependency. Compatibility with our assets has not been tested.
