# Documentation

- [Open plans](open/): implementation checkpoints and remaining work. [06 — Supplied animations and running](open/06_Supplied_Animations_and_Running.md) is committed ([handoff](handoff/plan06.md)). [06a — Physical ride height and support](open/06a_Physical_Ride_Height_and_Support.md) and [07 — Support recovery and contact footwork](open/07_Procedural_Contact_Footwork.md) pass independent implementation review, including the lower physical braking stance and individual final stopping steps ([handoff](handoff/plan07.md)). Continuous visual acceptance remains open. [07a — Ragdoll contact handoff](open/07a_Ragdoll_Contact_Handoff.md) is cleared to start, followed by [08 — Locomotion integration](open/08_Locomotion_Transitions_and_Tackle_Integration.md) and [09 — Active falls](open/09_Active_Falls_Joint_Limits_and_Role_Responses.md).
- [Closed plans](closed/): implemented Gates 1–4, their original implementation-order guide, and completed model integration (00–05).
- [Handoffs](handoff/): implementation evidence, reproduction instructions and known limitations.

Closed means the implementation work is complete, not that every visual acceptance item or known issue is resolved. The open plans retain the outstanding handoff, clamp and visual-review concerns.

## External references

- [Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): character animation, retargeting and IK-rig reference for plans 06–08. Optional reading; not an installed dependency or a prerequisite for ongoing work.

## Current decision

Physical ride height replaces the fixed-height assumption for new locomotion profiles. Preserve committed plan 06 and historical handoffs as evidence; their pose-only invariance does not apply to the new support profile. Plans 06a–09 own support, reachable plants, transitions and active falls in that order. Fixture prefixes L1–L4 stay stable; new suspension fixtures use RH. Visual acceptance and existing rejected-handoff/clamp issues remain explicit debt.

Plan 07 resolved bounded load-release recovery (`support-suspension-rh-v2`) and the one-arm hinge-limit failure (two-bone solves bounded at the hinge limit); changed tackle outcomes alone are not regressions. A grounded carrier may carry another player within finite support capacity. Load-limited drive, attenuated Sprint bob and suspension during visual flight remain declared limits; only toe-off residuals/planting move into 07. Ballistic running is a separate future scope.

Plan 07a owns overlap-safe articulated falls for the simultaneous, player-below and footwork one-arm cases before 08; a rigid falling proxy is a safety fallback rather than their final accepted behavior. Plan 08 owns natural idle stance and procedural walking arm swing alongside locomotion transitions. Plan 09 adds physical joint restrictions and active fall responses after those passive handoffs work.

Next: start 07a from the accepted 06a/07 checkpoint. Independent closeout review passes 218 tests, build and 216 regenerated fixtures; all 143 historical summaries are unchanged. 07a owns the remaining natural-contact handoff rejection and large contact-clearance limb corrections. 08 owns ordinary toe-off/run-start smoothing, free-arm balance styling, final stopping cadence, idle/walk arms and supplied Idle.fbx intake. Review the latest runStop at normal and slow speed separately; code acceptance does not claim finished football movement.
