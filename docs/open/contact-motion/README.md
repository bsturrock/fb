# Contact motion implementation sequence

Requested 2026-11-10. Implementation brief for Opus 5.5. Planning only; no simulation changes made.

## Intended result

A carrier sees contact coming, lowers and pitches forward while covering the ball, then carries that posture and momentum into a controlled fall. A defender approaches with open arms, closes firmly on real contact, and commits their own body to taking the carrier down. Free hands and bent knees absorb the landing. Shoulders and elbows remain anatomically coherent throughout.

Status (2026-11-12): M1 is done ([handoff](../../handoff/contact-motion.md)). The prerequisites the user ruled must
land before M2 (hard ragdoll joint stops, own-leg contact, physical supported legs) are on branch `prereq-ladder`
([handoff](../../handoff/contact-motion-prerequisites.md); what is still open, with the user's review list:
[prerequisites ladder](prerequisites-ladder.md)). M2's rough-first slice (the carrier's brace: decision, pose, on for
L3, L4 and HC carriers) is done on the same branch ([handoff](../../handoff/contact-motion-m2.md)). Status
(2026-11-13): M3's rough-first slice (the defender's cradle, close on touch, committed takedown and the hold carried
through it, on for L3, L4 and HC tackling defenders) is done ([handoff](../../handoff/contact-motion-m3.md)). M4's
rough-first slice (every falling L3 and HC player reacts: knees and hips flex, the ball stays tucked, a free arm
reaches for the floor and, landed, gives under the body and lets go when unloaded; L4 keeps plan 09's response) is
done ([handoff](../../handoff/contact-motion-m4.md)); next is the user's lab look at the whole tackle and fall, then
polishing what looks worst. The first polish planned, locked hands so the rear-wrap carrier is dragged down, was
measured unreachable before any code (his hands stay 0.37 m or more apart around these bodies; M3 handoff, "Locked
hands"): the rear-wrap carrier still runs on, and making it go down is a design step of its own.

## Direction (user-approved 2026-11-12; supersedes conflicting text below and in the milestone files)

The prerequisites ladder ended at 14b. Its remaining rungs (shoulder twist rebound, upper arm in chest, the parked
flips) are tracked defects in the prerequisites handoff, worked only when they are seen in the lab.

1. **Rough whole tackle first.** Build brace (M2), wrap and finish (M3) and ground contact (M4) end to end in rough
   form, then polish what looks worst in the lab. Do not perfect one layer before the next exists.
2. **Arms in three stages:** an authored source pose, one task on top (reach, wrap, carry), one final pass (joint
   limits, stay out of the own trunk, pelvis and head). New arm behaviour goes into this shape; per-case guards are
   deleted as it replaces them, and no new per-case guard is added.
3. **Authored poses.** Brace, wrap and carry are short authored clips or keyed poses (Blender, or ported from
   `../football-sim-6`), blended and aimed by rules, not built from stacked procedural rules.
4. **Ragdoll rather than fall stiff.** A conversion is refused only when grossly impossible. The tolerance is a
   simulation rule, so loosening it is its own flagged step with a lab look.
5. **Gates on the visible bar** (`CLAUDE.md` rule 6); audit of the fine limits that parked steps:
   `.scratch/ladder/gate-audit.md`. Every parked flag is later flipped or deleted; old families retire after M4.

Unchanged: posed legs and running, physics decides who falls, small flagged steps, lab review at milestones.
Rejected: physically driven arms (map of the cost: `.scratch/ladder/physical-arms-map.md`), a move to Godot.

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
