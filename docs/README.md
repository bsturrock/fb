# Documentation

- [Open plans](open/): implementation checkpoints and remaining work. [06 — Supplied animations and running](open/06_Supplied_Animations_and_Running.md) is committed ([handoff](handoff/plan06.md)). [06a — Physical ride height and support](open/06a_Physical_Ride_Height_and_Support.md) and [07 — Support recovery and contact footwork](open/07_Procedural_Contact_Footwork.md) pass independent implementation review ([handoff](handoff/plan07.md)). [07a — Ragdoll contact handoff](open/07a_Ragdoll_Contact_Handoff.md) is accepted by the user, including both review fixes ([handoff](handoff/plan07a.md)). [08 — Locomotion integration](open/08_Locomotion_Transitions_and_Tackle_Integration.md) is cleared to start, followed by [09 — Active falls](open/09_Active_Falls_Joint_Limits_and_Role_Responses.md).
- [Closed plans](closed/): implemented Gates 1–4, their original implementation-order guide, and completed model integration (00–05).
- [Handoffs](handoff/): implementation evidence, reproduction instructions and known limitations.

Closed means the implementation work is complete, not that every visual acceptance item or known issue is resolved. The open plans retain the outstanding handoff, clamp and visual-review concerns.

## External references

- [Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): character animation, retargeting and IK-rig reference for plans 06–08. Optional reading; not an installed dependency or a prerequisite for ongoing work.

## Current decision

Physical ride height replaces the fixed-height assumption for new locomotion profiles. Preserve committed plan 06 and historical handoffs as evidence; their pose-only invariance does not apply to the new support profile. Plans 06a–09 own support, reachable plants, transitions and active falls in that order. Fixture prefixes L1–L4 stay stable; new suspension fixtures use RH. Visual acceptance and existing rejected-handoff/clamp issues remain explicit debt.

Plan 07 resolved bounded load-release recovery (`support-suspension-rh-v2`) and the one-arm hinge-limit failure (two-bone solves bounded at the hinge limit); changed tackle outcomes alone are not regressions. A grounded carrier may carry another player within finite support capacity. Load-limited drive, attenuated Sprint bob and suspension during visual flight remain declared limits; only toe-off residuals/planting move into 07. Ballistic running is a separate future scope.

Accepted plan 07a supplies audited articulated falls for the simultaneous, player-below and footwork one-arm cases; preserve these through 08. A rigid falling proxy remains a safety fallback for genuinely invalid candidates. Plan 08 owns natural idle stance and procedural walking arm swing alongside locomotion transitions. Plan 09 adds physical joint restrictions and active fall responses after those passive handoffs work.

Plan 07a was accepted by the user on 2026-11-05 for checkpoint commit. Its review fixes bound the final shown reach direction and include the first solved response in post-conversion measurements. **239 tests, the build and 238 fixtures pass; the 143 historical summaries are unchanged.** The [handoff closeout](handoff/plan07a.md#review-closeout-fixes-2026-11-05) records corrected measurements and four one-arm variants whose defenders remain supported after the runner falls.

**Next: implement [08](open/08_Locomotion_Transitions_and_Tackle_Integration.md) in three passes:** start/brake/stop presentation first; supplied idle posture and procedural walking arms second; automatic contact entry/exit and falling integration third. Preserve accepted physical support, braking budgets, per-foot ownership and 07a conversion/continuity checks. Review stopping for recognisable deceleration at normal speed as well as bounded targets in slow playback. Anatomical ragdoll restrictions and active fall responses remain 09 work.
