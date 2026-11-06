# Ragdoll handoff during player contact

Repository-aligned plan • 2026-11-05 • Cleared to start after the accepted 06a/07 checkpoint, before 08. Independent closeout review passes 218 tests, build and all 216 fixtures; the 143 historical summaries are unchanged. Continuous visual acceptance remains open.

Previous: [support recovery and contact footwork](07_Procedural_Contact_Footwork.md). Next: [locomotion integration](08_Locomotion_Transitions_and_Tackle_Integration.md).

## Problem and required result

Start from the accepted 06a/07 checkpoint, including its [step-transfer repair](07_Procedural_Contact_Footwork.md#3-transfer-stopping-feet-without-starting-a-two-foot-hop) and [lower physical braking stance](07_Procedural_Contact_Footwork.md#4-lower-the-physical-braking-stance). Independent review passed all four closeout items: 218 tests, build and 216 regenerated fixtures, with the 143 historical summaries unchanged. Do not redo these fixes. The ordinary stop physically lowers and takes individual final steps. Its remaining abrupt toe-off/run-start motion, cadence and arms-out styling belong to 08; the contact-clearance discontinuities below belong here.

The current baseline has improved: `RH-F5-playerBelow` and `L2-F14-oneArmFeet` now produce accepted conversions after the limb-continuity work; preserve those gains as regressions. `RH-F6-simultaneous` still rejects both players for overlapping upper arms and leaves rigid falling proxies. This milestone owns the remaining natural-contact conversion failures and the associated discontinuous clearance corrections. Plan 09's active joint responses cannot repair a conversion that never happened.

Retain rejection and the passive fallback for genuinely invalid input and diagnostic failures. They are safeguards, not accepted final behavior for these natural-contact cases. Removing a limb snap alone does not meet the goal.

## Boundary and constraints

Reuse `PhysicalPose`, clearance queries, `convertBatch`, `buildCandidate`, `validateCandidate`, `switchToRagdoll` and retained-contact remapping. Conversion already builds disabled candidates, checks simultaneous candidates against one another, and atomically switches the accepted set. Preserve its mass, momentum, energy, joint, landmark and penetration audits.

Earlier rejected baselines included about 14.5 cm in the player-below case and 4.05 cm of the one-arm defender's thigh into the runner's pelvis; these are historical depths, not current failures to recreate. Reproduce the post-closeout baseline. The existing landmark tolerance is 0.01 m and new-penetration tolerance 0.015 m: do not assume a placement nudge can resolve deep overlaps. No hidden root teleport, conversion-only reposing, bone/collider shrink, ignored player pair, widened tolerance, velocity reset or discarded hold may manufacture a pass.

## Contact-continuity baseline

Code review reproduced body-local one-tick second differences in `RH-F5-playerBelow`: A's right ankle about 0.659 m at 0.517 s and B's left wrist about 0.606 m at 0.667 s. The lower player's arm jump is in the procedural pose path, not an achieved grip-arm override. `RH-F6-simultaneous` also has achieved grip-arm jumps up to about 0.26 m. Use `p07-snap.ts` and `p07-legtrace.ts`; measure the first displacement as well as the second difference so a diagnostic acceleration measure is not mistaken for displacement.

Trace target, pole, selected candidate, shown pose, penetration and the continuity guard at each actual substep. The guard can advance past the nominal rate-limited blend to regain validity; accepting the eventual candidate does not establish a continuous path. Fix the shared pose/contact cause rather than excluding the fixture, raising a test threshold or disabling collision. Separate solved root/contact motion from changes introduced by pose selection, and track procedural versus achieved-arm ownership. If a continuous collision-valid path is impossible with the current representation, resolve that explicit mismatch under the boundary policy below rather than silently snapping to a clear pose. These cases must be part of 07a's tests and continuous visual review even when conversion already succeeds.

## Implementation order

1. Reproduce the remaining failures, contact-continuity cases and now-successful conversions from the adopted support/footwork profiles. Record conversion tick, own segment, opposing collider, depth, joint angles, retained anchors and candidate versus achieved pose. Identify whether overlap exists in the published pose, appears when proxy collision geometry becomes ragdoll geometry, or is introduced by simultaneous candidate composition. Preserve the incoming evidence.
2. Fix avoidable overlap in shared canonical pose/clearance generation before conversion, using candidate-equivalent limb/shoe geometry and existing fixed-length/hinge constraints. Account for the other player's achieved limbs when both may convert. Target corrections must be bounded, continuous and visible in the published pose. Preserve valid plants/hand contacts where feasible; release or fail them explicitly when impossible. No second hidden ragdoll pose.
3. Validate candidates together against the representations that will actually remain active, including supported and already-articulated counterparts. If one candidate is rejected, revalidate the others against its surviving proxy. Preserve deterministic batch decisions and remap relationships once; player array order must not select a winner accidentally.
4. If pose avoidance cannot resolve a natural-contact case within existing geometry/continuity constraints, identify the representation mismatch and propose the smallest explicit shared collision/transition change. Do not assume every overlap has a placement solution. A change to contact activation or representation needs its own measured penetration, impulse and work behavior and explicit contract amendment; collision must not simply remain disabled. Keep this milestone open while any required natural-contact case still falls rigidly.
5. Transfer actual solved bulk velocity, including vertical motion, at the accepted pose. Relative limb-swing velocity injection remains out of scope. Disable suspension and supported motors immediately on falling, including during failed conversion. No delayed fall trigger, regained balance, unbounded retries or permanent contact exemptions to buy clearance.
6. Retain genuine bad-candidate and failed-transfer diagnostics, safe rule handling and clear failure reasons. No duplicate proxies/candidates, stale colliders, repeated grip forces or leaked rejected bodies. Do not rewrite an official ending/spot to improve the visible fall.

## Fixtures and acceptance

Keep existing fixture IDs and historical records. Add focused variants under prefix `HC`; preserve and explain changed known-rejection evidence.

| Case | Required evidence |
| --- | --- |
| RH-F6-simultaneous / G4-F10 model equivalent | Both players become audited ragdolls in the representative natural-contact case; no order dependence |
| RH-F5-playerBelow | Upper falling player articulates without false ground support; lower player may carry within capacity; test both falling too |
| L2-F14-oneArmFeet | Defender articulates at actual support loss with valid retention/limbs; runner's existing ragdoll participates in clearance |
| RH-F5-playerBelow A ankle / B wrist and simultaneous achieved grip arms | Substep traces explain and remove discontinuities introduced by pose/clearance selection; current successful conversions stay valid; no fixture exclusion or hidden snap |
| Mirrored, phase and height variants | Works on both sides, with rising/falling bob and low stance; no fixture-specific offsets/times |
| Clear-space conversion | Existing successful transfer stays continuous and audited |
| Deliberately invalid candidate / strict transfer diagnostic | Still rejects or reports failed transfer safely; no false completion |
| Reset, pause, render rates and batch ordering | Reproducible fixed-step decisions and stable body/joint/collider/retention counts |

All required natural-contact cases must become real articulated falls and pass the unchanged boundary checks. Record landmark continuity, floor/new external penetration, limb lengths, signed hinge angles, mass, linear/angular momentum and energy. Inspect the first solved steps after acceptance for penetration spikes, launch impulses and hand-anchor jumps: validating only the disabled candidate is insufficient. Preserve post-conversion integrity tolerances; no velocity correction may conceal a spike.

Run focused handoff/clearance tests, Gate 4/model and support/footwork regressions, all tests, fixtures, typecheck and build. Review continuous normal/slow playback of the simultaneous fall, stacked-player contact and one-arm fall from side and oblique views, including the lower player's procedural arm. Intentionally invalid `L2-F8-noRescue` must remain a safe rejection; it is not a natural-contact failure to force through validation. Record changed tackle outcomes without prescribing legacy winners. Publish causes, shared fixes, profiles, transfer audits and remaining failures. No active muscles, new anatomical envelopes, spine, get-up or physical walking is required here.
