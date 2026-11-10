# Milestone 1 — Anatomical, continuous limb rotation

## Visual target

An opening arm rotates at the shoulder with the elbow pointing consistently outward/downward. Closing the wrap folds the forearm around the opponent through elbow flexion. The elbow never bends sideways or backward; the upper arm never suddenly rolls 180 degrees when the hand crosses the chest. A falling arm can rotate and yield under contact but cannot wind up behind the back beyond the agreed range. Left and right limbs should look like mirror images under mirrored inputs.

## Inspect and implement

Start in `src/sim/pose.ts`, `pose-runtime.ts`, `arms.ts`, `ragdoll.ts` and `profiles.ts`; trace their callers and the lab's skeleton/bone mapping. Reuse plan 12's shared shoulder range and plan 11's clearance handling. Audit joint-local axes, handedness, rest rotations and the conversion of physical segment orientation to mesh bone orientation. Distinguish shoulder swing from axial twist: an acceptable upper-arm direction alone does not guarantee an acceptable elbow plane.

1. Reproduce a bad shoulder/elbow pose and record segment axes, elbow angle and mesh orientation before, at and after conversion. Identify whether physical joints or only rendered bones are wrong.
2. Fix incorrect axes/signs/rest offsets at their shared source. Make supported IK elbow-plane selection continuous near straight arms using the previous valid plane and a deterministic anatomical fallback. Preserve reach and collision constraints.
3. Verify elbow hinge frames on both sides; keep elbow flexion on the intended axis. If shoulder axial twist is demonstrably unconstrained, extend the existing joint-range representation and bounded constraint enforcement rather than layering a second competing pose solver.
4. Apply the same anatomical convention to supported arm tasks, accepted conversion poses and physical limbs. Carry continuity through conversion without snapping an invalid pose into bounds; use existing validation and transition handling.

## Acceptance

Add focused checks in the existing body-limit/pose coverage for mirrored reaches, across-chest targets, nearly straight elbows and supported-to-physical transitions. Assert declared angle limits with the existing solver tolerance, no discontinuous elbow-plane flip for nearby targets, and consistent physical/visual orientation. Replay wrap, carry and ground-brace cases to ensure limits do not make them unreachable unnecessarily.

Done when front/side clips show ordinary shoulder rotation and elbow folding throughout those motions, with no new self-penetration or conversion failure. Avoid a skeleton redesign or clavicle system unless the diagnosis demonstrates one is essential.
