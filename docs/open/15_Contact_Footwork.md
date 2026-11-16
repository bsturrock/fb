# 15. Contact footwork: one stepping model

Status: approved by the owner 2026-11-17 (rewrite yes; older families option A). Steps 1 and 2 done (the model behind
`FootworkProfile.steps`, lab `&steps=new`, no fixture uses it); step 3 next.

## What a viewer should see (owner, 2026-11-15)

Short choppy steps under the hips. Feet never inside the other man. A foot always down when pushed. No galloping.
The owner's constraint: a clear system that works, not more rules. This plan replaces the contact stepping core; it
does not add guards to it.

## Why replace

The current planner (`src/sim/footwork.ts`: `planFeet`, `startStep`, `destination`, `advanceStep`) has three
structural faults, and two attempts to patch a body test into it each worsened another scene
(`.scratch/p7/parked/README.txt`).

1. Two controllers with no shared plan. The planner picks where and when knowing nothing of other bodies; the leg
   guard in `pose.ts` moves the leg off the body afterwards. Their only channel is "held off", which the planner
   answers by re-aiming at the same body. This loop is the gallop and the stranded swing leg.
2. Place and time come from a constant-velocity hip, then five retimers (`fitStance`, `fitLanding`, `continueSwing`,
   `boundedHorizon`, the arrival stretch) rewrite the duration after the fact. A hit, a lean or a blocker never
   enters. Result: steps aimed 2 to 3 m ahead, durations from 0.05 s to 1.1 s.
3. A landing needs the guard's primary candidate, so a held-off foot never plants: no foot down for 0.5 s after an
   impact.

## The model

Per player, per substep, once the clip regime ends (contact hold or braking). Three rules.

**Free ground.** One function answers "may a foot or shin be here": the ground minus the footprints of other
players' bodies and legs, each moved by its relative velocity over the step's remaining time. The planner and the
leg guard both call it. Nothing else decides whether a place is blocked.
Built (`src/sim/free-ground.ts`): a footprint is a part's span below the stepping player's shin top projected to the
ground (supported: proxy colliders and published limbs, a leg moving at its measured ankle velocity; ragdoll: segment
colliders); a foot asks with its radius and a side wall from its other foot (no crossing). `isFree`, `nearestFree`
(exact), the sim adapter `bodyParts` / `groundFor`. About 0.06 ms per substep for two players.

**Where.** The support point is where the hips need a foot given their real motion now:
`hip + v * sqrt(h / g)` (the capture point: hit and lean are already in `v`), plus the foot's side offset, taken where
the hips will be when the foot lands (hips and footprints moved along their motion for the step's time left). The step
target is the support point, limited to a short step from the hip, then moved to the nearest free ground. The target
follows the support point while the foot is in the air, at a bounded rate that falls to zero at touchdown.

**When.** A planted foot never moves on the ground: it stands or it steps. It stands while it can (its leg reaches
it) and lifts the moment it cannot, whatever the other foot does: the only way both feet are in the air (a flight, as
in running), ended by the other foot's landing within one step time. Otherwise a foot lifts only while the other
stands, when it is more than a few centimetres from its own aim now (the farther foot of the two). One duration rule
from step length, at a foot speed that grows with the body's speed (one floor, one ceiling), fixed at lift-off. When
the time is up the foot lands where the leg is, always. A foot in the air when the model takes over continues as a
step from where it is, at its motion.

That is the whole planner. No retimers, no blocked memory, no re-pick loop, no tentative landings.

Built (`src/sim/contact-steps.ts`, `STEPS_V1`): step at most 0.4 m from the hip (less where the reach at the stance
height is shorter), stance covered within 12 cm, step time = length / (1.6 + 2 |v|) m/s within 0.16-0.30 s, aim
followed at 2 m/s at most. `planFeet` hands the feet to `stepFeet` wherever the reactive regime would run; the leg
solve gets the same `FootRequest`s and under the model a plant is never released by its solve. Above about 4 m/s (a
hit at full speed) a plant runs out of reach within one step time, so the stride has a flight.

## What stays

- The clip regime (running) and the switch condition into contact.
- `FootRequest` to the leg solve, and `observeFeet` feeding the achieved pose back.
- The leg guard as the last-resort geometry check on the solved leg, now reading the same free ground.
- The fields `boundLegs` clause (b), `rideUnsupported`, `clipJoin` and the transition audit read (mode, swing age,
  planted). "Held off" disappears as a state: a foot is planted or in a step that will land.
- Feet stay pose-only. Feeding foot support into balance is a separate later decision.

## What is deleted

In `footwork.ts`: the reactive triggers, `destination`, `fitStance`, `fitLanding`, `continueSwing`, `lateLand`,
`blockedW`, the `tentative` and `inherited` paths, `compose.lateLanding` and its lab switch, and the `FootDebug`
faults that exist only for those paths. In `foot-compose.ts`: `heldOff`. Tests that pin those mechanisms go with
them; tests that state viewer rules (no skate, foot continuity, one foot down) stay and must pass unchanged.

## Older families

L2 and RH use the old planner (`FOOTWORK_L2`) and are byte-identical by rule. Owner decision (2026-11-17): they move
onto the new model in one step and their summaries change once; the old planner is then deleted. One system. Until
that step (5) they stay byte-identical.

## Steps

Each is one commit with a full check, per `CLAUDE.md`.

1. Free ground: the function, constructed tests with fault twins, used by nothing. Summaries identical.
2. The new planner in its own module behind a profile no fixture uses, lab switch `&steps=new`. Constructed tests:
   pushed from each side a foot is down within the step ceiling; a blocker in the path, the foot lands beside him;
   steady drive gives alternating steps of bounded length and duration. Summaries identical.
3. Leg guard reads free ground under the new profile. Summaries identical.
4. Flip on L3, L4 and HC. Every contact scene moves. Who-falls changes go to the owner. Milestone: lab review.
5. Older families per the decision above, then delete the old planner and its tests.
6. Polish what looks worst in the lab.

## Acceptance (viewer rules, checked as rules over all L3, L4, HC runs)

- No step longer than the short-step limit; no step shorter than the floor or longer than the ceiling in time.
- No same foot stepping twice in a row while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot target or landing inside another player's footprint.
- Existing: no skate, foot continuity, hip range, no snap.

## Risks

- The flip changes conversion timing through `boundLegs` and `rideUnsupported`, so who falls will move.
- The capture point assumes a fixed hip height; a crouched driving player may want a lead term. Decide from the lab.
- Free ground between two supported players standing chest to chest may leave little room; the short-step limit must
  still give a natural stance. This is the first thing to look at in step 2's lab switch.
