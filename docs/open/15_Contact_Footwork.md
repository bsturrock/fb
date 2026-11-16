# 15. Contact footwork: one stepping model

Status: approved by the owner 2026-11-17 (rewrite yes; older families option A). Steps 1 to 3 done: the model is behind
`FootworkProfile.steps` (lab `&steps=new`), no fixture uses it. Step 4 (the flip) next.

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

**A place.** One test says whether a leg can stand on a place: the shoe off every other player's footprint (a part's
span below the shin top, moved along its velocity to the landing), the whole leg the leg solve gives there (`pose.ts`
`plannedLeg`: thigh, shin, shoe) clear of their parts by a skin, and that leg inside its joint ranges (knee between its
fold and the reach; under a range profile, the thigh inside the hip's swing cone and twist range less its margin).
`isFree` asks it; `nearestFree` finds the nearest such place, exact on the ground and, for the leg and the ranges, by
cutting what fails and asking again (at most 8 times).

**Where.** A foot's want is the capture point (`home + v sqrt(h / g)`, taken where the hips will be when it lands)
limited to a short step from the hip. Its aim is the nearest place that passes the test, first within the short step,
then anywhere within the leg's reach. With none, the foot is **bound** and its aim is under its hip. A foot in the air
follows its aim at a bounded rate falling to zero at touchdown, and (unless bound) its path keeps to free ground: a
move into a footprint slides along its edge.

**When.** A plant never moves on the ground. It lifts at once when its leg leaves its ranges, whatever the other foot
does (the only flight, as in running, ended by the other foot's landing). With both feet down, a foot steps when that
gains more than coverM on its want (a plant whose leg is no longer clear counts as infinitely far), and the feet take
turns. A step's time comes from its length, at a speed that grows with the body's, and never changes. At its time the
foot lands where it is shown: the shoe turned onto the body's heading over the step, the plant taken at its lowest sole
corner (no settle).

**Shown as asked.** The leg solve shows a model foot exactly where the model asks (`FootRequest.exact`): no push-out,
no offset variant, no sweep, no hold. What the leg guard still does to a model leg: a plant whose planned leg is in a
body may turn its knee to another pole (rung 7). A body coming into a standing leg is the model's to answer, by
stepping.

**Falls.** The bound-legs fall's clause (b) reads `legsBound` (a foot cannot follow the hips) and the ride-down's
come-down reads `standsNowhere` (neither can), in place of "held off" and "past its time", which cannot happen here.

Constants (`STEPS_V1`): short step 0.4 m, gain 12 cm, step time length / (1.6 + 2 |v|) m/s within 0.16-0.30 s, aim
followed at 2 m/s, lift 7 cm, foot radius 10 cm, leg skin 3 cm.

## Known limits (all L3, L4 and HC runs, both orders, `steps=new`; `.scratch/p22/measure/agg5.txt`)

- **Legs through the other man at the hit.** As the players meet, their legs mix and often no place within reach passes
  the test: the foot is bound and steps under its hip, through the other man's legs, and nothing moves the shown leg
  off him. Supported leg against ragdoll 26 s over all runs (reactive planner 1.9 s), supported against supported 10 s
  (5.4 s), peaks 15-25 cm: the tackler running over a fallen carrier (L3-F1-phase2, L3-F4-oneArm, HC-F3-phase75 near
  0.6-1.2 s), legs scissored at the hit (L3-F5-drag 0.7 s, L3-F19-front 0.58 s). Bound 52 s over 442 s of contact.
- **A held carrier's leg among the holder's legs** (L3-F6-hold, -holdMirror, -saturated): every place within the
  carrier's reach has his thigh in the holder's thighs, so the foot is bound for most of the hold (2.6-3 s).
- **A landing rolled on its edge.** The shoe has no ankle roll: a foot turned onto the heading lands on a sole corner,
  rolled 15-33 degrees in hit scenes. Flat and on heading together needs a subtalar roll in the pose, rig, render and
  ragdoll.
- **Hip past its range in the clip's swings** (not the model's): 2.4 s over all runs (reactive 0.9 s).

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
   bound rare, a step's path through free ground. Done.
4. Flip on L3, L4 and HC. Who-falls changes go to the owner. Milestone: lab review.
5. Older families per the decision above, then delete the old planner and its tests.
6. Polish what looks worst in the lab.

## Acceptance (viewer rules, as rules over all L3, L4, HC runs)

- No step longer than the short-step limit; step times within the floor and ceiling.
- No same foot stepping twice while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot landing inside another player's footprint; no leg through another player's leg.
- Existing: no skate, foot continuity, hip range, no snap.
