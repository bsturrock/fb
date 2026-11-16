# 15. Contact footwork: one stepping model

Status: approved by the owner 2026-11-17 (rewrite yes; older families option A). Steps 1 to 3 done: the model is behind
`FootworkProfile.steps` (lab `&steps=new`), no fixture uses it. Not ready for step 4 (the flip): see Known limits.

## What a viewer should see (owner, 2026-11-15)

Short choppy steps under the hips. Feet never inside the other man. A foot always down when pushed. No galloping.
A clear system that works, not more rules: this plan replaces the contact stepping core; it adds no guards to it.

## Why replace

The reactive planner (`footwork.ts`: `planFeet`, `startStep`, `destination`, `advanceStep`) picks where and when
knowing nothing of other bodies, then the leg guard in `pose.ts` moves the leg off them and the planner re-aims at the
same body (the gallop, the stranded swing leg); five retimers rewrite step times after the fact (steps aimed 2-3 m
ahead, 0.05-1.1 s long); a held-off foot never plants (no foot down for 0.5 s after an impact). Two attempts to patch
a body test into it each worsened another scene (`.scratch/p7/parked/README.txt`).

## The model (`src/sim/contact-steps.ts`, `src/sim/free-ground.ts`)

Per player, per substep, once the clip regime ends (contact hold or braking).

**A place, and how deep it is.** A place is ordered, not passed or failed. `depthAt` says how deep a leg standing
there is in the other players: the shoe's disc (foot radius) into a footprint (a part's span below the shin top, moved
along its velocity to the landing), or the whole leg the leg solve gives there (`pose.ts` `plannedLeg`: thigh, shin,
shoe) into their parts past a skin; 0 is free. A place where the leg leaves its joint ranges (knee between its fold and
the reach; under a range profile, the thigh inside the hip's swing cone and twist range less its margin), or beyond
reach, is no place. Depths within the skin of each other are equal.

**Where.** A foot's want is the capture point (`home + v sqrt(h / g)`, taken where the hips will be when it lands)
limited to a short step from the hip. Its aim is the least deep place within the leg's reach, among equals first one
within the short step, then the nearest the want (`leastDeep`: the nearest free place, exact on the ground and cut for
the leg at most 8 times, when there is one; else a sample of the reach, refined toward the want). A foot whose aim
is still deeper than 8 cm (its leg 5 cm past the skin, visibly in the man) is **bound**. A foot in the air follows its
aim at a bounded rate falling to zero at touchdown, and its path, bound or not, goes no deeper into the footprints than
its ends: a move deeper ends at the nearest place within the move that is not (`nearestNoDeeper`; between free ends,
along the footprint's edge).

**When.** A plant never moves on the ground. It lifts at once when its leg leaves its ranges, whatever the other foot
does (the only flight, as in running, ended by the other foot's landing). With both feet down, a foot steps when its aim is less deep than its plant (by more than the skin: by
coverM plus the difference), or, as deep, when that gains more than coverM on its want; never to a deeper aim. The feet
take turns, unless the plant is visibly in a man (deeper than 8 cm). A step's time comes from its length, at a speed that grows with the body's, and never changes. At its time the
foot lands where it is shown: the shoe turned onto the body's heading over the step, the plant taken at its lowest sole
corner (no settle).

**Shown as asked.** The leg solve shows a model foot exactly where the model asks (`FootRequest.exact`): no push-out,
no offset variant, no sweep, no hold. What the leg guard still does to a model leg: a plant whose planned leg is in a
body may turn its knee to another pole (rung 7). A body coming into a standing leg is the model's to answer, by
stepping.

**Falls.** The bound-legs fall's clause (b) reads `legsBound` (a foot cannot follow the hips) and the ride-down's
come-down reads `standsNowhere` (neither can), in place of "held off" and "past its time", which cannot happen here.

Constants (`STEPS_V1`): short step 0.4 m, gain 12 cm, step time length / (1.6 + 2 |v|) m/s within 0.16-0.30 s, aim
followed at 2 m/s, lift 7 cm, foot radius 10 cm, leg skin 3 cm, bound past 8 cm. The 8 cm is measured: a held
carrier's thighs against the holder's stand 2-6 cm deep for most of a hold (L3-F6-hold, 2.4 s), 6-8 cm for 0.7 s;
the hit scenes' bound feet stand 10-30 cm deep.

## Known limits (all L3, L4 and HC runs, both orders, `steps=new`; `.scratch/p23/measure/agg6.txt`)

Against round 3 (where no free place bound the foot under its hip): bound 52 s to 21 s, leg in the man at landing 240
to 156, gallops 16 to 3, steps over 0.41 m 23 to 16. Still far from the reactive planner on the legs:

- **Supported leg against ragdoll 20.9 s** (round 3 26.3 s, reactive planner 1.9 s), peaks 13-20 cm. Not mainly the
  swing: 17 s of the 19 s excess is in runs whose falls changed. The tackler goes down later (33 player-runs at least
  50 ms later, median 0.33 s; 12 takedowns become diagnostic falls) and stands that long over the falling carrier. In
  L3-F1-phase3 his drive lasts 0.13 s longer and his come-down runs to its 0.225 s limit instead of ending at once;
  how the feet reach his body there is not traced. Runs with the same falls add 1.9 s.
- **Supported against supported 16.4 s** (round 3 10.2 s, reactive 5.4 s), 7.7 s of it in the holds (L3-F6-hold,
  -holdMirror, -saturated): with no free place the carrier's foot takes the least deep place, 2-8 cm deep, so it is
  not bound and stands with his thigh 3-8 cm in the holder's (round 3 aimed under the hip).
- **Plants shown off their anchor**: 7 of 1606 past 5 cm, at most 8 cm (round 3 none), in the holds and drags: plants
  that stand in a man move with the leg guard's knee pole (0.45 s of plants moved, round 3 0.15 s).
- **A landing rolled on its edge.** The shoe has no ankle roll: a foot turned onto the heading lands on a sole corner,
  rolled 15-42 degrees in hit scenes. Flat and on heading together needs a subtalar roll in the pose, rig, render and
  ragdoll.
- **Hip past its range** 3.6 s over all runs (round 3 2.4 s, reactive 0.9 s).

Tried and parked (`.scratch/p23/parked/s3-over/`): the swing's path in 3D, lifting over low parts up to 30 cm and going
round the rest. In a constructed scene the leg in the man is the thigh at the knee, carried there by the hips; moving
the ankle 14 cm leaves it 9-11 cm in, and over the fixtures supported against ragdoll rose to 24 s.

## What stays

- The clip regime (running) and the switch into contact; `FootRequest` and `observeFeet`.
- The leg guard for the reactive planner's feet, unchanged.
- Feet stay pose-only. Feeding foot support into balance is a separate later decision.

## What is deleted at step 5

In `footwork.ts`: the reactive triggers, `destination`, `fitStance`, `fitLanding`, `continueSwing`, `lateLand`,
`blockedW`, the `tentative` and `inherited` paths, `compose.lateLanding` and its lab switch, and the `FootDebug` faults
that exist only for those paths. In `foot-compose.ts`: `heldOff`. Tests that pin those mechanisms go with them; tests
that state viewer rules stay and must pass unchanged.

## Older families

L2 and RH use the old planner (`FOOTWORK_L2`) and stay byte-identical until step 5. Owner decision (2026-11-17): they
then move onto the model in one step and their summaries change once; the old planner is deleted.

## Steps

Each one commit with a full check, per `CLAUDE.md`.

1. Free ground, used by nothing. Done.
2. The model behind a profile no fixture uses. Done.
3. The model as one test of a place (joint ranges in it), feet shown as asked, the swing ending as the plant begins,
   a step's path through free ground; places ordered by depth, bound only when visibly in a man. Done.
4. Flip on L3, L4 and HC. Who-falls changes go to the owner. Milestone: lab review.
5. Older families per the decision above, then delete the old planner and its tests.
6. Polish what looks worst in the lab.

## Acceptance (viewer rules, as rules over all L3, L4, HC runs)

- No step longer than the short-step limit; step times within the floor and ceiling.
- No same foot stepping twice while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot landing inside another player's footprint; no leg through another player's leg.
- Existing: no skate, foot continuity, hip range, no snap.
