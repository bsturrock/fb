# 13 — Conversion overlap margin

Repository-aligned plan • 2026-11-09 • **Stub: not designed, not approved.** It follows plan 12 (`4f38d34`) and was opened by the user's ruling on L4-F10-wrap-off ([plan 12 handoff](../handoff/plan12.md#known-limits)).

**Goal:** a supported player whose limbs are held clear by the pose converts to a ragdoll without failing the conversion's external-penetration check.

## Why

The pose and the conversion use different limits:
- **Pose leg guard.** The procedural pose holds a supported leg's depth in other bodies to `HARD_OK`, 1.2 cm (pose.ts). The check runs once a tick, against those bodies as they stand.
- **Conversion check.** The conversion rejects a candidate ragdoll with new external penetration over `penetrationTolM`, 1.5 cm (ragdoll.ts `validateCandidate`). The check runs at the substep where the conversion fires.
- **The gap.** The margin between the two is 0.3 cm. A ragdoll leaning into a tangled leg moves more than that in one substep.

A rejected player falls as a rigid proxy instead of a ragdoll, so the trial loses its ragdoll fall evidence.

**The case:** L4-F10-wrap-off D, since plan 12.
- At 1.392 s, D's left thigh is 1.88 cm inside R's ragdoll right thigh.
- On the tick before, the pose had it at 1.17 cm.
- In the twin, without the profile, the legs sat 1.0–1.5 cm deep for 0.2 s, and D converted at 1.17 cm.

## Accepted conversions near the limit

These are the L3, L4 and HC conversions accepted with more than 1.2 cm of new depth at 4f38d34. There are 13.

| Fixture | t (s) | Player | Trigger | Depth (cm) | Own part in another's part |
| --- | --- | --- | --- | --- | --- |
| L3-F9-noProbe-contact | 0.721 | D | lossOfSupport | 1.46 | left thigh in R's right shoe |
| HC-F1-low, HC-F1-mirror, L3-F10-both, L4-F5-twoClamp-on, -off, L4-F9-both | 1.2 | D | diagnostic | 1.40 | forearm in R's torso |
| HC-F1-lowMirror, L3-F10-bothLow, L3-F10-bothMirror | 1.2 | D | diagnostic | 1.39–1.40 | forearm in R's torso |
| HC-F1-at0.9 | 0.9 | D | diagnostic | 1.37 | left forearm in R's torso |
| L3-F10-rising | 0.842 | D | diagnostic | 1.37 | left forearm in R's torso |
| L3-F10-bothLow | 1.2 | R | diagnostic | 1.20 | left palm in D's left palm |

The forearm cases are a separate mechanism. They come from arm-task clamp depth on a diagnostic conversion, not from a leg tangle. The only leg case near the limit is L3-F9-noProbe-contact, which plan 12's limp-shoe hold keeps under the limit.

## Options (for design)

- **A. Retry.** A conversion rejected only for external penetration is retried on the following substeps, for a short bounded window, before falling back to the rigid proxy.
- **B. Predictive guard.** The pose's leg guard measures against other ragdolls advanced by their velocity over one substep, or it uses a margin below `penetrationTolM` by the expected motion.
- **C. Candidate push-out.** Before validation, a `CandidateEdit` separates the penetrating candidate segment along the contact normal. The edit is bounded, and the anchor and landmark checks still apply.

## Decisions needed

- Which option, or which mix.
- Opt-in profile (the plan 10 U2/U3 rule, older exports byte-identical) or a change everywhere.
- Whether the diagnostic forearm-clamp cases are in scope.

## Acceptance (draft)

- **Wrap-off.** L4-F10-wrap-off D converts.
- **Near-limit cases.** No accepted conversion in the table above is rejected.
- **Real overlaps.** A deliberately invalid conversion is still rejected: HC-F5-invalidOne, L3-F11-invalid, L4-F9-rejected and the G4 penetration cases.
- **Physics.** There are no transfer audit failures that the baseline lacks, and the plan 09 power audit stays clean.
