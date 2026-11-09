# 11 — Arm self-clearance

Repository-aligned plan • 2026-11-08 • **Implemented 2026-11-08** ([handoff](../handoff/plan11.md)). Opt-in profile `self-clearance-v1` on the L3, L4 and HC fixtures (and so in the lab); every G, L1, L2 and RH export is byte-identical.

**Goal:** a player's forearms, palms and fingers stay out of the player's own torso and pelvis, in all three places arms are made: the supported pose (clip, walk, carry, brace), the arm-task arms (reach, close, hold, recover), and the ragdoll.

## Why arms went through the body

It was an omission by design, not a broken collider:

- **Supported pose.** The proxy has no limb colliders. `PoseClearance.self` checked the forearm and palm against the proxy's torso and pelvis boxes, but only the held-arm search used it, and those boxes are 2–98 percentile bounds padded for the physics body, so they are far from the visible skin.
- **Arm-task arms.** `ArmSystem` tested arm shapes against opponents only (`opponents()`).
- **Ragdoll.** The contact filter drops every same-owner pair, so a forearm passes through its own core.

On the skinned mesh this showed as up to 18 cm of forearm or hand inside the trunk (sprint swings, tackle reaches, ragdoll falls). Clearance against other players already worked.

## User decisions (2026-11-08)

- **Scope:** all three arm sources.
- **Evidence:** an opt-in profile on the current paths (L3, L4, HC and the lab). Older summaries stay byte-identical (the plan 10 U2/U3 rule).

## Design

**Trunk shape.** The calibration (`scripts/model/calibrate.ts`) fits seven convex slabs to the skin vertices dominated by the Hips, Spine, Spine1 and Spine2 bones, in the body frame: two from the bottom of the skin to the Spine joint (the pelvis), and five from the Spine joint to the top (the torso). Neighbouring slabs overlap by 1 cm. The spine bones are not driven, so the trunk is rigid on the core segment and one set of pieces serves the proxy body and the ragdoll core. `bew-v6.calibration.json` gains `trunkHull`, and every other key is unchanged. A body without a measured trunk (the authored bodies) is unaffected.

**Arm self shapes** (`armSelfShapes`, pose.ts): the forearm capsule from elbow to wrist (the elbow cap included), the palm ball, and a finger capsule (r 3 cm) out to the glove tip (`glove.tipAlongM`).

**Tolerance.** `toleranceM` is 1 cm. Skin contact is clear and only depth beyond it counts. A relaxed arm hangs against the side and touches it, which is correct.

**Supported pose.** `PoseClearance.body` and `bodyPush` (pose-runtime) measure the self shapes against the trunk at the proxy pose. `buildProxyPose` adds the depth to each arm candidate's depth, so candidates are picked by it as by any other clearance, and adds the push to the continuity push. Under the profile the held arm treats its own torso as a constraint.

**Arm-task arms.** `ArmSystem.selfHit` adds the trunk to each candidate solve's worst contact. The distance is shifted so the shared validity rule (`>= -surfaceTolM`) accepts exactly the tolerance. Grips, clamps and touch still see opponents only.

**Ragdoll.** `buildCandidate` adds massless colliders: the trunk pieces (convex hulls) on the core, and each forearm's self shapes with their radii reduced by the tolerance. The contact filter lets a self-arm shape meet only its own player's trunk pieces, and nothing else meets either. They are not in `colliders`, they never appear in a contact record, and the segment masses and inertias are unchanged.

**Active falls (plan 09 impact guard).** A forearm that meets its own trunk is an impact on that arm. Without it, the guard, which reads contact records and other bodies' geometry, did not see the hit: in `L4-F9-contact` R's left forearm took a 41 N·s impulse from its own trunk with the elbow still torqued, and realised 221 W against the 150 W ceiling. The ragdoll now keeps its self colliders (`Ragdoll.self`). `closingSpeeds` also tests them against the player's own trunk, and `selfImpulses` reports their impulses from the last solve. Either one holds effort off that arm only: the core is far heavier and is not held for it.

**Query cost.** `Shape.contactShape` on a convex polyhedron rebuilds the hull in WASM on every call (8 µs against 1.3 µs for a box), which made sustained holds 4× slower. The runtime queries go through parentless colliders in a private, never-stepped query world instead: the hull is built once and posed for each query (0.7 µs). A bounding-sphere test also skips pieces out of reach.

## Known limits

- **Contact sandwich.** When an arm is caught between its own trunk and an opponent, the two push-outs can cancel. The held arm's radial search reaches 0.3 m, and continuity rate-limits travel to clear alternatives that are farther away, so 3–7 cm of depth can remain for a few ticks. The full fix would be physical proxy arm colliders, which is a separate scope.
- **Upper arm** is not checked. It joins the trunk at the shoulder, and its inner surface sits against the lats by design.
- **Authored bodies** (no `trunkHull`, about 50 L4 fixtures) keep the old behaviour under the profile.

## Acceptance

- Arm self depth beyond the tolerance stays within a few millimetres for pose and arm-task arms, and within 2.5 cm for ragdoll forearms, with the without-profile twins shown passing through (`tests/self-clearance.test.ts`).
- Self colliders are massless and never reach a contact record.
- Historical exports are byte-identical. Changed L3, L4 and HC summaries are listed in the handoff.
