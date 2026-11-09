# 13f — Conversion overlap margin

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). Last milestone, after 13d and 13e change the legs. Opened as a stub after plan 12 (`4f38d34`) by the user's ruling on L4-F10-wrap-off ([plan 12 handoff](../handoff/plan12.md#known-limits)).

**Goal:** a supported player whose limbs are held clear by the pose converts to a ragdoll without failing the conversion's external-penetration check.

## Why

The pose and the conversion use different limits:
- **Pose leg guard.** The procedural pose holds a supported leg's depth in other bodies to `HARD_OK`, 1.2 cm (pose.ts). It measures against those bodies as they stand when the pose is built, at the end of each substep.
- **Conversion check.** The conversion rejects a candidate ragdoll with new external penetration over `penetrationTolM`, 1.5 cm (ragdoll.ts `validateCandidate`). It runs at the substep where the conversion fires, after the bodies have moved again.
- **The gap.** The margin between the two is 0.3 cm. A ragdoll leaning into a tangled leg moves more than that in one substep (1/240 s): 0.3 cm in one substep is 0.72 m/s of relative speed.

A rejected player falls as a rigid proxy instead of a ragdoll, so the trial loses its ragdoll fall evidence.

**The case:** L4-F10-wrap-off D, since plan 12.
- At 1.392 s, D's left thigh is 1.88 cm inside R's ragdoll right thigh.
- On the substep before, the pose had it at 1.17 cm, inside the guard.
- In the twin without the profile, the legs sat 1.0–1.5 cm deep for 0.2 s, and D converted at 1.17 cm.

## Accepted conversions near the limit

These are the L3, L4 and HC conversions accepted with more than 1.2 cm of new depth at `4f38d34`. There are 13. 13d and 13e change the legs and the poses, so the first task re-measures this table at the 13e tip.

| Fixture | t (s) | Player | Trigger | Depth (cm) | Own part in another's part |
| --- | --- | --- | --- | --- | --- |
| L3-F9-noProbe-contact | 0.721 | D | lossOfSupport | 1.46 | left thigh in R's right shoe |
| HC-F1-low, HC-F1-mirror, L3-F10-both, L4-F5-twoClamp-on, -off, L4-F9-both | 1.2 | D | diagnostic | 1.40 | forearm in R's torso |
| HC-F1-lowMirror, L3-F10-bothLow, L3-F10-bothMirror | 1.2 | D | diagnostic | 1.39–1.40 | forearm in R's torso |
| HC-F1-at0.9 | 0.9 | D | diagnostic | 1.37 | left forearm in R's torso |
| L3-F10-rising | 0.842 | D | diagnostic | 1.37 | left forearm in R's torso |
| L3-F10-bothLow | 1.2 | R | diagnostic | 1.20 | left palm in D's left palm |

The forearm cases are a separate mechanism: arm-task clamp depth on a diagnostic conversion, not a leg tangle. The only leg case near the limit is L3-F9-noProbe-contact, which plan 12's limp-shoe hold keeps under the limit.

## User decisions

- **2026-11-09: option B, a predictive guard.** The pose's leg guard measures against where the other bodies will be, so the shown leg stays clear of them at the next substep, where a conversion would check it. Options A (retry the conversion on the following substeps) and C (push the candidate out before validation) are not used.
- **Defaults, not yet ruled** (the plan's recommendation; the user can change them before 13f starts):
  - Opt-in profile on L3, L4 and HC, under the plan 10 U2/U3 rule, as in plans 11 and 12. G, L1, L2 and RH stay byte-identical to the 13e tip.
  - The diagnostic forearm-clamp cases are not in scope. They are arm-task depth, they all pass today, and the arm guard is not changed.

## Design

**Profile.** `LegGuardProfile` / `LEG_GUARD_V1` (id `leg-guard-predictive-v1`) in profiles.ts: `{ id; aheadS }`, with `aheadS` one physics substep (1/240 s). `FixtureDef.legGuard` is set by `asL3`, `asL4` and the HC `label`, beside `jointRange`. It is exported in `profileIds` and `profiles`; exports without it are unchanged.

**Predicted bodies.** `poseClearanceOf` (pose-runtime.ts) gains `externalAhead(shapes)`, the depth of the shapes against every external collider moved by its motion relative to the posing player over `aheadS`:
- For each external collider on a dynamic body: its point velocity at the collider centre, minus the posing player's proxy point velocity at the same point, times `aheadS`, is added to its translation. Its rotation turns by its body's angular velocity times `aheadS`. The player's own rotation over one substep is not included (it is below 0.1° at the fixtures' yaw rates).
- Static colliders (turf, obstacles) and published limbs (poses, which have no velocity) are not moved; they are measured as they are.
- It reuses 13a's bounding-sphere cull, with each moved bound enlarged by its displacement.

**The guard.** Under the profile, wherever a leg candidate is judged against `HARD_OK` (the leg candidate choice, the leg continuity bisection and the leg push-out loop in pose.ts), the depth is `max(external, externalAhead)`. The push-out direction comes from whichever of the two is deeper. Arms keep the present guard.

**Why this is enough for the case.** In L4-F10-wrap-off, R's ragdoll thigh moves 0.71 cm into D's thigh in the substep before the conversion. The predicted measure sees that 0.71 cm on top of the 1.17 cm and pushes D's leg out of it, as the guard does today for depth that is already there.

## Tasks

- [ ] **Re-measure** the near-limit table at the 13e tip, with the plan 12 probe (`.scratch/jr12/`, untracked; recreate as `scripts/probe/p13-near-limit.ts`). Record it in the handoff. If L4-F10-wrap-off no longer fails at the 13e tip, record that, and keep the regression on the case that is closest to the limit then.
- [ ] **Test first.** In `tests/body-limits.test.ts` (13b): L4-F10-wrap-off D converts and its candidate passes validation; the twin without `legGuard` still rejects it (or, if 13e moved the case, the closest one exceeds 1.2 cm without the profile).
- [ ] **Profile** and its export.
- [ ] **`externalAhead`** in `poseClearanceOf`, with the cull.
- [ ] **Guard** in the three leg places in pose.ts.
- [ ] **Evidence.** Full suite, typecheck, build, all fixtures. G, L1, L2 and RH byte-identical to the 13e tip; changed L3, L4 and HC summaries listed with endings.
- [ ] **Audits.** Transition audit (1 cm), plan 07 plant limits, plan 09 power audit, handoff audits.
- [ ] **Close.** Handoff section; move the L4-F10-wrap-off known limit in the plan 12 handoff to resolved, with a link.

## Acceptance

- **Wrap-off.** L4-F10-wrap-off D converts.
- **Near-limit cases.** No conversion in the re-measured table is rejected.
- **Real overlaps.** A deliberately invalid conversion is still rejected: HC-F5-invalidOne, L3-F11-invalid, L4-F9-rejected and the G4 penetration cases.
- **Legs stay where they were** when nothing moves near them: every one-player L3, L4 and HC fixture has a summary byte-identical to the 13e tip (only static bodies are external there, and they are not moved). Their exports change only by the recorded profile.
- **Physics.** No transfer audit failures that the 13e tip lacks; the plan 09 power audit stays clean.
- **Historical evidence.** G, L1, L2 and RH exports byte-identical to the 13e tip.

## Known limits

- One substep of prediction. A body that accelerates hard within the substep can still move a little further than predicted; the remaining margin is the 0.3 cm between the guard and the tolerance.
- Arms keep the present guard: the forearm cases stay near the limit.
