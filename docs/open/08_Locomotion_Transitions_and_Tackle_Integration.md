# Locomotion transitions and tackle integration

Repository-aligned plan • 2026-11-05 • Planned.

Previous: [contact footwork](07_Procedural_Contact_Footwork.md). Next: [active falls](09_Active_Falls_Joint_Limits_and_Role_Responses.md).

## Existing boundary

Keep `PlayerRuntime.pose`, `Simulation.updatePoses`, `convertBatch`, `validateCandidate`, `switchToRagdoll` and `ragdollPose`. The code already has canonical physical segments, delayed observation history, render interpolation, simultaneous conversion, retained contact remapping and transfer failure handling. The new work is switching/blending clip and contact-foot targets while preserving that boundary. Existing snapshot history is not automatically sufficient for per-foot transition state; add only the previous achieved targets/state needed by the transition.

## Implementation

1. Add a small per-player locomotion mode (free run, preparation, contact, exit); keep it separate from supported/falling control and proxy/articulated representation. Use observed contact, retained arms and actual movement, with hysteresis. Preparation may request a pose but cannot grant contact, traction or balance.
2. Enter from achieved feet and current swing progress. Preserve valid anchors independently. Blend targets and solve fixed lengths; do not linearly interpolate final bone positions or snap to a shared brace stance. Keep physical root and achieved/carry arms authoritative.
3. Exit when real contact/retention clears. Select a compatible clip phase using foot positions and stance annotations, then release plants gradually. Recontact during exit starts from the currently composed pose. Stationary contests must not trigger automatic marching/falling timers.
4. Falling interrupts every mode immediately. Queue conversion on the existing substep schedule from the last published achieved pose; never wait for a blend, pre-pose a hidden candidate or sample the visible mesh. Preserve shin-owned shoe frames. Keep current mass, momentum, energy, anchor and penetration audits and `invalidHandoff`/`invalidTransfer` handling unchanged.
5. Clear transition/sampler/planner state at reset and accepted conversion. Preserve interpolation reset at representation changes. Renderer visibility, FPS and camera cannot affect state or fall acceptance.

## Scope and acceptance

Changes belong in simulation pose/locomotion state, `updatePoses`, fixture registry and focused tests. Extend lab overlays/exports for mode, transition reason and foot ownership. Do not replace the ragdoll or rule observer. Before integrated acceptance, reproduce the model baseline's rejected handoffs and clamp churn from `../handoff/gate4.md`; report whether changed poses improve or worsen them.

## 15. Required integration fixtures

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

Use mirrored approaches, different runner headings, and representative supported speed/body profiles. A full combinatorial sweep is unnecessary initially, but entry/exit/fall must each be checked on both sides and in both planted/swinging states.

## 16. Quantitative and visual acceptance

Retain Documents 06/07 length, plant, target-speed, ground, and reproducibility tolerances. Add:

- Transition-only pose discontinuity <= 0.01 m for anatomical landmarks at the same solved time/root. Measure the old and new pose paths at the same boundary; do not confuse ordinary physical displacement between ticks with a transition pop.
- No discontinuity of held hand anchors attributable to gait mixing; valid achieved retention remains under Gate 2 tolerances.
- No gait-state command modifies forces, physical grounded state, balance limits, or completion predicates.
- Gate 4 mass/momentum/energy/penetration audits pass on the actual integrated candidates.
- A 20-reset sequence has stable active body/joint/retention counts and no accumulating owned sampler/rig resources.

Review normal speed for football rhythm and purpose. Review slow motion for feet sliding, hyperextended knees, ankle/shoe jumps, core/mesh disagreement, impossible hands, and first-frame ragdoll kicks. A passing metric does not excuse an obvious repeated visual fault.

Record known limitations explicitly: approximate standing support, fixed-height proxy, simple gait heuristics, coarse ragdoll with frozen shoe-to-shin relationship, and omitted relative limb-swing velocities at handoff. Document 09's fall responses do not remove these limitations and are accepted in a separate milestone.

Run all tests, typecheck and build; export affected fixtures with clip/pose/profile identities and compare outcomes. Existing honest rejected candidates are not successful transitions. Keep the documented boundary policy: no relative limb-swing velocity injection at conversion; bulk transfer remains the existing audited approximation.

## Optional implementation reference

[Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): Its separation of animation poses and IK targets may inform clip/contact composition. Preserve our achieved-pose authority, fixed-step timing and audited ragdoll boundary; it is not a replacement transition or physics system. Treat it as a reference, not a required dependency. Compatibility with our assets has not been tested.
