# Plan 11 handoff — arm self-clearance

Plan: [11 — Arm self-clearance](../open/11_Arm_Self_Clearance.md). Implemented 2026-11-08 on `model-integration` after `2923d8d` (10f), in its own commit.

**Result:** the full suite passes, 837 tests in 23 files. Typecheck and build pass. 410 fixtures export. Every G, L1, L2 and RH export is byte-identical to `2923d8d` (216 files compared byte for byte against exports regenerated at that commit, which also reproduce the committed `summary.json` exactly). The 194 L3, L4 and HC exports all change, because they record the profile and the measured trunk. 90 of their summaries change (HC 20, L3 42, L4 28) and 320 summaries are identical. No result changes. Fourteen endings move by one or two ticks.

## User decisions (2026-11-08)

- **Scope:** all three arm sources: the supported pose arms (clip, walk, carry, brace), the arm-task arms, and the ragdoll forearms.
- **Evidence:** opt-in profile `self-clearance-v1` on the current paths (L3, L4, HC, and so the lab). Older summaries stay byte-identical (the plan 10 U2/U3 rule).

## What changed

- **Calibration.** `scripts/model/calibrate.ts` fits `trunkHull`: seven convex slabs of the Hips, Spine, Spine1 and Spine2 skin in the body frame, two below the Spine joint and five above it, overlapping by 1 cm. The slabs have 31, 28, 20, 21, 11, 19 and 17 points. `bew-v6.calibration.json` was regenerated, and every other key is identical. `modelBody` puts the pieces (one shared array) and `glove.tipAlongM` into `measured.trunkHull` and `measured.handTipM`.
- **Profile.** `SelfClearanceProfile` / `SELF_CLEARANCE_V1` (`toleranceM` 0.01, `ragdoll` true) is set as `FixtureDef.selfClearance` by `asL3`, `asL4` and the HC `label` builder. It is exported in `profileIds` and `profiles`. Exports without it omit `trunkHull` and `handTipM` from the body, so they are as before.
- **Shapes.** `armSelfShapes` (pose.ts) returns the forearm capsule from elbow to wrist, the palm ball, and a 3 cm finger capsule out to the glove tip.
- **Supported pose.** `PoseClearance.body` and `bodyPush` (pose-runtime) give the depth beyond the tolerance and the separating move. `buildProxyPose` adds the depth to each arm candidate's depth, adds the push to the continuity push, and records `limbClearance.<side>ArmTrunk`.
- **Arm-task arms.** `ArmSystem.selfHit` joins the trunk into each candidate solve's worst contact. Grips, clamps and touch are unchanged.
- **Ragdoll.** `buildCandidate` adds massless self colliders: the trunk hulls on the core, and each forearm's self shapes with their radii reduced by the tolerance. They are kept on `Ragdoll.self` and not in `colliders`. The contact filter passes only a self-arm shape against its own player's trunk piece. `collectContacts` never records a self pair.
- **Impact guard (plan 09).** `closingSpeeds` also tests the self pairs, and the new `FallHost.selfImpulses` reports their impulses from the last solve. Either holds effort off that arm.
- **Query cost.** Trunk queries use parentless colliders in a private, never-stepped world (`trunkPieces`, `trunkContact` in physics.ts) with a bounding-sphere cull. `Shape.contactShape` on a `ConvexPolyhedron` rebuilds the hull on every call (8.3 µs against 0.7 µs), which had made `L3-F6-hold` 4× slower. With the change, the three L3-F6 holds take 10–23% longer than without the profile (holdMirror 4.72 s against 4.29 s, saturated 3.89 s against 3.16 s).

## Depth in the own trunk (all 194 L3, L4 and HC fixtures, every tick, each arm)

Raw depth of the full-radius self shapes in the measured trunk. It includes the 1 cm skin tolerance, so 1 cm is touching. The probe is `.scratch/armpen/hull-agg.ts` (untracked). "Without" is the same fixture with `selfClearance` removed.

| Arm source | Arm-ticks | Max without → with | Ticks over 2 cm without → with |
| --- | --- | --- | --- |
| Arm task (reach, close, hold, recover) | 8,251 | 11.3 cm (HC-F3-lowRunner) → 1.0 cm | 3.2% → 0% |
| Supported pose | 46,859 | 18.1 cm (L3-F9-playerBelow) → 7.8 cm (L3-F1-phase7, contact sandwich) | 6.7% → 1.9% |
| Ragdoll | 22,262 | 19.9 cm (L3-F10-falling) → 4.1 cm (HC-F3-rising) | 28.4% → 0.1% |

The 4.1 cm ragdoll case is inherited at the conversion. R converts at 0.863 s with its supported arm in a contact sandwich, and the self contact pushes the arm out within a few ticks. Every other ragdoll case stays at 2.2 cm or less.

## Regressions (`tests/self-clearance.test.ts`, 17 tests)

| Check | Shown failing by |
| --- | --- |
| The profile is on for exactly the L3, L4 and HC fixtures | — |
| The trunk is seven slabs inside the padded proxy boxes, and the model body carries it | — |
| An opted export records the profile and the trunk; L2-F3-runStop's export has neither | — |
| Pose arms within tolerance + 1.2 cm: L3-F16-sprint, -runStop, L3-F17-runStart, L3-F13-carrier, -free | the same sprint without the profile exceeds 2.5 cm (asserted) |
| Arm-task arms within tolerance + 0.5 cm: L3-F1-low, HC-F3-mirror, L3-F5-dragMirror | — |
| Ragdoll forearms ≤ 2.5 cm: HC-F1-low, L3-F3-recover, L3-F16-handoff | each one's twin without the profile exceeds 5 cm (asserted) |
| The impact guard sees a forearm on its own trunk (L4-F9-contact) | with the guard blind to self pairs, R has 1 over-power substep (shown, then restored) |
| Self colliders are massless and never in a contact record | — |

## Tests changed

- `transitions-modes` "asL3 keeps the source fixture and only adds the profiles": `selfClearance` is one more added profile.
- `transitions-audit` "a step is compared with its old path as it is" (10b): the check took D's supported-to-airborne boundary in a 1.45–1.55 s window. Under the profile that boundary, still the run's only one, comes at 1.650 s instead of 1.504 s. The window is dropped. Its three assertions hold unchanged: the old kind is `target`, the delta equals the raw value, and there is no `stepStopM`.
- `transitions-contact` "L3-F4/F5: legs keep stepping in contact": the check wanted any player's `footPlant` after D's contact entry. In L3-F4-twoArm both runs start the same steps at 0.475 and 0.479 s, in contact. The only later plant (1.375 s, in exit mode) now does not happen, because D loses support at a 31° lean 33 ms earlier (1.367 s against 1.400 s), with the same `groundDown`. The check now accepts a step that starts (`footSwing`, source `step`) or lands after the entry. L3-F5-drag needs the player-agnostic form: there, D takes no step after the entry in either run.

## Changed summaries

No result changes. The differences are in players' end states, events and `minPairGap`. The endings that move:

| Fixture | Ending t (s) |
| --- | --- |
| HC-F3-phase0, -phase50 | 1.6333 → 1.6167, 1.6833 → 1.6667 |
| HC-F3-phase75 | 1.7167 → 1.6833 |
| HC-F3-rising, -falling | 1.6333 → 1.6667, 1.6667 → 1.6833 |
| L3-F1-phase4, -mirror0 | +17 ms |
| L3-F1-mirror4, -low | −17 ms |
| L3-F4-twoArm | 1.6667 → 1.65 |
| L4-F5-oneClamp-on, L4-F9-defenderRising | −17 ms |
| L4-F10-wrap-on, -off | −33 ms, −17 ms |

## Known limits

- **Contact sandwich.** An arm caught between its own trunk and an opponent can keep 3–7.5 cm of depth for a few ticks: the two push-outs cancel, the held-arm search reaches 0.3 m, and continuity rate-limits travel to clear poses farther away. Cases: L3-F3-recover R.left at 0.63 s, L3-F16-contactStop D.left at 0.52 s, L3-F1-low R.left at 0.5 s, HC-F3-mirror R.right at 0.48 s, and the L3-F5-dragMirror carry arm (3.3 cm). The full fix would be physical proxy arm colliders.
- The upper arm is not checked against the trunk.
- Authored bodies (no `trunkHull`, about 50 L4 fixtures) are unaffected by the profile.
- Visual acceptance on the skinned mesh is outstanding.

## Reproduction

- `npx vitest run tests/self-clearance.test.ts`
- `npm run fixtures`, then compare `evidence/summary.json` with `git show 2923d8d:evidence/summary.json`.
