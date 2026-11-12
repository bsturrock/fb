# Contact motion implementation sequence

Requested 2026-11-10. Implementation brief for Opus 5.5. Planning only; no simulation changes made.

## Intended result

A carrier sees contact coming, lowers and pitches forward while covering the ball, then carries that posture and momentum into a controlled fall. A defender approaches with open arms, closes firmly on real contact, and commits their own body to taking the carrier down. Free hands and bent knees absorb the landing. Shoulders and elbows remain anatomically coherent throughout.

Status (2026-11-12): M1 is done ([handoff](../../handoff/contact-motion.md)). The prerequisites the user ruled must
land before M2 (hard ragdoll joint stops, own-leg contact, physical supported legs) are on branch `prereq-ladder`
([handoff](../../handoff/contact-motion-prerequisites.md); what is still open, with the user's review list:
[prerequisites ladder](prerequisites-ladder.md)). M2 starts from that branch after the user's review.

Implement in this order, one reviewable milestone at a time:

1. [Anatomical limb rotation](01-limb-rotation.md): establish valid joints and continuous poses before tuning force.
2. [Carrier preparation and fall](02-carrier-brace.md): anticipate contact and preserve ball protection.
3. [Wrap acquisition and committed finish](03-wrap-and-finish.md): consolidate wider/faster arms and going down together because retention is the prerequisite for a coupled fall.
4. [Load-bearing ground contact](04-ground-contact.md): hands and knees absorb rather than bounce.

## Implementation instructions

Read applicable repository instructions and the existing plans 07a, 08a, 09, 10c, 11 and 12 plus their handoffs before editing. Existing implementations are the starting point, not specifications to reimplement. In particular, plan 12 already added shoulder limits, plan 09 already supplies active falls, and the arm system already supports grips and clamps. Trace active fixture profiles and actual call sites; an implemented feature may simply be inactive in the failing scene.

First capture representative current lab clips and traces. Diagnose whether each defect is in intent, achieved physical pose, conversion, or mesh presentation. Change the responsible layer. Do not treat these plans' suspected causes as proven bugs. Use existing fixtures, profile patterns, event traces and test runners. Add only evidence fields needed to distinguish success from a visually similar failure.

Preserve actual contact requirements, finite reach, force/torque/work budgets, self-clearance, conversion validation, grip breakage and referee outcomes. Never teleport limbs, set root velocity to manufacture a fall, or classify a tackle merely because a controller requested one. New deliberate takedown policy may initiate the defender's existing validated conversion path; it must not bypass that path's checks.

Tune proposed values against baseline clips; they are engineering starting points, not anatomical or biomechanical measurements. Retain previously agreed joint limits unless evidence specifically requires revisiting them. Do not silently loosen limits to reach a target.

## Shared acceptance matrix and delivery

Cover front, oblique, side and rear contact; walking and running carriers; left/right mirrored cases; one and two retained arms; missed wrap; broken hold; obstructed hand; and no opponent nearby. Reuse existing cases where they already cover these conditions. A forward fall is desirable when momentum supports it, not compulsory against a strong opposing impact.

For each milestone deliver the code, focused deterministic regression checks, and lab before/after evidence from front and side views at normal speed and slow motion. Track the simulation landmarks as well as the mesh so a rendering correction cannot hide a physical defect. Record profile and fixture IDs with evidence. Run relevant existing tests and typecheck; run the full suite at final integration. Update test-map/registry entries only when their conventions require it.

At integration, replay the combined sequence from approach through settled bodies. Confirm no hover, explosive separation, newly invalid conversion, perpetual hold, or premature rule ending. Report remaining misses honestly; do not weaken assertions or regenerate baselines without explaining the changed behavior.
