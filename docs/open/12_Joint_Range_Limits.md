# 12 — Joint range: shoulders and ankles

Repository-aligned plan • 2026-11-09 • **Implemented 2026-11-09** ([handoff](../handoff/plan12.md)). Follows plan 11 (`baa512c`). Opt-in profile `joint-range-v1` on the L3, L4 and HC fixtures; every G, L1, L2 and RH export is byte-identical. One new conversion rejection (L4-F10-wrap-off) is accepted as a known limit (user ruling, 2026-11-09).

**Goal:**
- A player's upper arm rarely sits behind the body, and never far behind it, in all three places arms are made: the supported pose, the arm-task arms and the ragdoll.
- Feet stay near perpendicular to the shin: the toe never comes up close to the shin, standing or limp.

## Why

Two lab screenshots from the user:
- A prone runner with an arm pinned up behind the back.
- A falling player whose foot sits almost against the shin.

Probes over the 194 L3, L4 and HC fixtures confirm both (`.scratch/shoulder/back.ts` and `ankle.ts`, untracked). "Behind" is the upper arm's angle behind the body's side line (coronal plane), in the core frame.

| Arm source | Arm-ticks | Worst behind | Over 30° | Over 45° |
| --- | --- | --- | --- | --- |
| Arm task | 9,335 | 20° | 0% | 0% |
| Supported pose | 50,451 | 85° (L3-F9-convert-prep D.left) | 5.2% | 1.0% |
| Ragdoll | 37,684 | 88° (HC-F3-phase0 R.left) | 12.3% | 4.1% |

- 58 of the 138 fixtures with a ragdoll put an arm more than 45° behind, and 45 put one more than 60° behind.
- The L3 and HC ragdolls have no shoulder limit at all; their spherical joints are unrestricted, the Gate 4 passive path.
- The L4 ragdolls have the plan 09 envelope, but its shoulder cone allows 76° behind hanging and 77° behind at horizontal.
- A pose arm already past the envelope when the player goes limp keeps that excess as start slack. It decays at only 30°/s.
- The supported pose and the arm-task arms have no shoulder range.

| Ankle (dorsiflexion = toe toward the shin) | Past 20° | Past 30° | Past 40° |
| --- | --- | --- | --- |
| Supported legs (58,230 leg-ticks) | 61% | 25% | 7.5% |
| Ragdoll feet at conversion (266 feet) | 184 | 125 | 59 |

- Supported legs allow 45° of dorsiflexion. Plan 07 raised it from 30° so a flat heel holds in a deep crouch.
- The ragdoll has no ankle joint. The shoe is rigid on the shin at the conversion pitch for the whole fall, so a foot planted in a crouch stays jammed toward the shin in the air.
- The model's rest foot is the neutral 90° to the shin.

## User decisions (2026-11-09)

- **Shoulder back limit:** at most 45° behind the side line with the arm hanging, and 30° with it raised. The forward and across-chest range stays as it is.
- **Forward preference:** a hard limit, plus a small cost for being behind when a supported arm chooses between candidates. The ragdoll gets the limit only, because it is passive.
- **Collarbones:** not in this plan. The mesh's clavicles keep their rest transform.
- **Ankle, supported legs:** 25° dorsiflexion at most. Past it, the heel lifts onto the ball of the foot.
- **Limp foot:** from conversion, the foot eases over about 0.3 s to a relaxed 15° toe-down, and its collider turns with it.
- **Approach:** one shared shoulder range, a retuned plan 09 cone (approach A), rather than a separate back-limit term (B).
- **Evidence:** an opt-in profile on L3, L4 and HC. G, L1, L2 and RH stay byte-identical, under the plan 10 U2/U3 rule as in plan 11.

## Design

**Profile.** `JointRangeProfile` / `JOINT_RANGE_V1` (id `joint-range-v1`) holds four things:
- `shoulder`: a `JointEnvelope`. It has the cone below and plan 09's twist range, stiffness, damping and torque cap.
- `forwardCostM`: the forward preference, 0.01 m per 30° behind. That is the size of a soft overlap, so it only breaks ties between clear candidates.
- `ankle`: `dorsiDeg` 25 and `plantarDeg` 50 (unchanged).
- `limpFoot`: `pitchDeg` 15 toe-down and `easeS` 0.3.

`FixtureDef.jointRange` is set by `asL3`, `asL4` and the HC `label` builder, beside `selfClearance`. It is exported in `profileIds` and `profiles`; exports without it are unchanged.

**Shoulder range: one cone, three users.** The plan 09 swing cone, refit (`.scratch/shoulder/fit.ts`): tilt 67.5° toward 25° (between forward and out), with an elliptical boundary 110° along the tilt plane and 95° across it.

| Swing (behind the side line, by arm elevation) | Plan 09 cone | New cone |
| --- | --- | --- |
| Hanging, straight back (extension) | 76° | 44.5° |
| Raised 45° / 70° / 90° (horizontal) | 45° / 70° / 77° | 45° / 39° / 31° |
| Raised 120° / 150° (toward overhead) | 46° / 17° | 19° / 8° |
| Flexion / abduction extent | 167° / 167° | 177° / 174° |
| Horizontal adduction (in front, past forward) | 76.5° | 70.5° |

Twist keeps plan 09's range: −100° to 100° about neutral 180°.

- **Supported pose.** Every arm candidate goes through `procedural` (pose.ts). That covers the clip and run arms, the free walk swing, brace, carry, the alternatives, the held-arm search and the continuity push. There, the two-bone result is checked against the cone in the core frame. If the upper arm is outside, the whole chain is turned rigidly about the shoulder by the smallest rotation that brings it onto the boundary (`clampDirToEnvelope`, margin 0). The elbow bend is kept and the palm moves with the arm, off its target. The request residual reports it.
  - The forward preference adds `forwardCostM` × (behind angle / 30°) to the candidate's soft cost, only when the angle is positive. A free procedural arm choosing between alternatives settles forward. A held (clip) arm keeps its primary when that is clear, so the clip swing stays the clip's within the range. The sprint swing (46° behind at 67° elevation) is trimmed by about 6°.
- **Arm-task arms.** In `ArmSystem.solveArm`, a pole candidate whose upper arm is past the cone counts as invalid, as a hit does, and the next pole is tried. If every pole is invalid, the least-bad candidate is kept, ranked by depth then range excess. The worst today is 20°, so this is a guard.
- **Ragdoll.** Under the profile, the ragdoll's envelope shoulder is `jointRange.shoulder`:
  - L4 ragdolls keep their hips and get the new shoulder.
  - L3 and HC ragdolls get a shoulder-only envelope. `RagdollEnvelope.hip` becomes optional, and the runtime skips a joint with no envelope.
  - The plan 09 machinery is reused unchanged: soft spring-damper, energy-consistent gradient, start slack, tolerance and persistence evidence.
  - The fall response's brace clamp (`envelopeMarginDeg`) reads the same cone.
  - Supported arms are already inside the cone when the player goes limp, so shoulder swing slack at conversion is about zero.

**Ankle.**
- **Supported legs.** Under the profile, the ground-relative leg solve (`legSolver`) clamps the pitch at `−ankle.dorsiDeg` instead of `ANKLE_DORSI` (45°). The legacy L1 limit (30°) and the plantar limit are unchanged.
  - Heel lift needs no new mechanism. When the solved shoe at the range limit would dip below the floor at a sole corner, the plan 07 plant already pivots the footprint on that corner and lifts the rest of the sole.
  - Swing feet keep the clip's foot angle within the new range.
- **Ragdoll.**
  - At conversion, the pose's pitch is clamped to [−dorsiDeg, plantarDeg].
  - After that, `rag.anklePitchDeg` moves toward `limpFoot.pitchDeg` at the rate that covers the conversion difference in `easeS`. The ease is done in substeps.
  - The shoe collider's rotation and translation relative to the shin are set to the eased pitch (`setRotationWrtParent`, `setTranslationWrtParent`). The landmark and the published `anklePitchDeg` follow, so the mesh, the collider and the evidence agree.
  - The shin's mass properties must follow the moved shoe. Verify this in Rapier 0.21 and recompute them if it doesn't.
  - Fallback if the energy audit or a kick shows up: hold the ease while the shoe is in ground contact.

## Acceptance

Each check is shown failing with the profile removed (the twin).

- **Supported pose.** No arm's swing excess past the new cone exceeds 0.5°, on any tick of the opted fixtures.
- **Arm task.** No arm-task arm is past the cone.
- **Ragdoll shoulders.** Over the opted fixtures, the worst swing excess past the new cone and the share of arm-ticks more than 5° past are reported in the handoff. Regression tests use the HC-F3 and L3-F1 runner cases and HC-F1-low. Each twin exceeds 45° behind; with the profile, the arm stays within the envelope's 5° tolerance, apart from persistence-tagged loads that are reported.
- **Supported ankles.** No pitch below −25°, exactly.
- **Ragdoll feet.** Every foot is within the range at conversion, and within 1° of the relaxed pitch 0.35 s later, unless the ground-contact fallback is in force; any such case is reported.
- **No physics regressions.** No new ragdoll validation failure (energy gain, anchors). The plan 09 power audit still has no substep over its ceiling.
  - *Exception (user ruling, 2026-11-09):* L4-F10-wrap-off D's conversion is rejected for external penetration, 1.88 cm against 1.5 cm. Its legs were already tangled before this plan; the twin converted at 1.17 cm. It is a known limit; the margin between the pose's leg guard and the conversion tolerance is separate work.
- **Historical evidence.** G, L1, L2 and RH exports and summaries are byte-identical. Changed L3, L4 and HC summaries are listed in the handoff with their endings.

## Known limits (declared up front)

- **Supported upper-arm twist is not limited.** Twist past the range at conversion keeps start slack, as today.
- **The ragdoll limit is soft.** 1,500 N·m/rad, capped at 500 N·m, so a heavy body lying on an arm can hold it some degrees past.
- **Collarbones do not move.** Arms reaching forward do not protract the shoulder girdle on the mesh.
- **Heel lift changes footing.** It may move endings in the crouch fixtures (L3-F1, HC-F1, HC-F3). That is expected and listed, not hidden.
