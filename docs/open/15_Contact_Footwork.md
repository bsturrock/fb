# 15. Contact footwork: one stepping model

Status: steps 1 to 4 done, and 4b (the come-down's read on the model). The model is on for every L3, L4 and HC
fixture with a composed foot planner (lab `&steps=old` shows the reactive planner, `&steps=v1` the model as at step 4). L2 and RH keep the reactive planner until step 5. Owner
(2026-11-16): the round-4 scenes look fine with the model; the overlaps there are polish, not blockers.

## What a viewer should see (owner, 2026-11-15)

Short choppy steps under the hips. Feet never inside the other man. A foot always down when pushed. No galloping.
A clear system that works, not more rules: this plan replaces the contact stepping core; it adds no guards to it.

## Why replace

The reactive planner (`footwork.ts`) picks where and when knowing nothing of other bodies; the leg guard then moves the
leg off them and the planner re-aims at the same body (the gallop); retimers rewrite step times after the fact; a
held-off foot never plants. Two attempts to patch a body test into it each worsened another scene.

## The model (`src/sim/contact-steps.ts`, `src/sim/free-ground.ts`)

Per player, per substep, once the clip regime ends (contact hold or braking).

**A place, and how deep it is.** `depthAt`: how deep a leg standing there is in the other players (the shoe's disc in
a footprint, or the whole planned leg, `pose.ts` `plannedLeg`, in their parts past a skin); 0 is free. A place where
the leg leaves its joint ranges, or beyond reach, is no place. Depths within the skin of each other are equal.

**Where.** A foot's want is the capture point, limited to a short step from the hip. Its aim is the least deep place
within reach (among equals, first one within the short step, then the nearest the want: `leastDeep`). A foot whose aim
is deeper than 8 cm is **bound**. A foot in the air follows its aim at a bounded rate, its path no deeper into the
footprints than its ends (`nearestNoDeeper`), and never into the turf: its lowest sole corner, as last shown, on or
above it (`overTurf`).

**When.** A plant never moves on the ground; it lifts at once when its leg leaves its ranges. With both feet down, a
foot steps when its aim is less deep than its plant, or as deep and a gain on its want; never to a deeper aim. The
feet take turns unless the plant is visibly in a man. A step's time comes from its length and never changes; it lands
where it is shown, the shoe turned onto the heading, the plant at its lowest sole corner.

**Shown as asked.** The leg solve shows a model foot exactly where asked (`FootRequest.exact`). The leg guard may
still turn a planted leg's knee to another pole (rung 7).

**Falls.** The bound-legs fall reads `legsBound` (a foot cannot follow the hips) in place of "held off" and "past its
time". The ride-down's come-down takes a riding tackler down with his man (off his support) once, for the grace,
nothing holds him up (`underHips`, simulation.ts `rideUnsupported`): no foot can get under his hips (`footUnder`: not
bound, and the hips' capture point within its short step), his body (trunk, head, arms; not the legs the model shows)
is off the carrier, and he holds no carrier still on his feet (a hold counts until the carrier's core is within the
ride's `carrierDownM` or the play has ended). Step 4 read the reactive planner's terms (`standsNowhere`, any contact,
any hold); none of them ever let go on the model: the tackler drives on at 3.3-3.9 m/s, a foot stays planted or in a
short step, his shown legs lie against the fallen carrier, his clamp stays on a man already down. He rode the come-down
to its low exit, its bound or the scripted fall, 0.1-0.45 s after the reactive planner's tackler, whose feet were
stranded in long swings.

Constants (`STEPS_V2`, `STEPS_V1` with `underHips`): short step 0.4 m, gain 12 cm, step time length / (1.6 + 2 |v|) m/s within 0.16-0.30 s, aim
followed at 2 m/s, lift 7 cm, foot radius 10 cm, leg skin 3 cm, bound past 8 cm (a held carrier's thighs stand 2-8 cm
in the holder's for most of a hold; the hit scenes' bound feet 10-30 cm).

## Tracked defects (polish order)

Each is reached with the model on (measured over the flip's runs); none blocks a gate, none has an exception.

1. **Two conversions of a tackler held up too long** (step 4's runs; none since 4b, parked: `.scratch/p25/parked/`),
   pinned on step-4 captures with the reactive planner's twin (tests/steps-defects.test.ts): a folded tackler's
   transfer, conserving momentum with a smaller inertia and his centre of mass 15 cm off the proxy's, gains over half
   his energy and spins him up (TAKEDOWN_ENERGY_GAIN); a takedown is refused for a supported right elbow at 150 deg past
   the ragdoll's 145, a rigid-proxy fall (ELBOW_PAST_RAGDOLL_RANGE: the clamp's achieved arm, arms.ts, is floored only by
   the arm profile's 0.12 m reach, about 160 deg; the generated arms keep the ragdoll's range, plan 07). Since 4b no
   supported elbow passes 145 deg in any L3, L4 or HC run, and no takedown gains over half (median 17 %, reactive 6 %).
2. **A leg in the other man in the holds** (L3-F6-hold, -holdMirror, -saturated): with no free place the carrier's
   foot takes the least deep, his thigh 3-8 cm in the holder's.
3. **A landing rolled on its edge**, 15-42 deg in hit scenes: the shoe has no ankle roll (needs a subtalar roll in the
   pose, rig, render and ragdoll).
4. **Plants shown off their anchor**: 7 of 1606 past 5 cm, at most 8 cm, in the holds and drags, moved with the leg
   guard's knee pole (and one-substep flickers of 5-10 cm, L3-F6-holdMirror 4.1 and 4.8 s, not on a drawn frame).
5. **A shoe in the turf** for up to 0.05 s, at most 5.6 cm, in 8 runs: the leg solve shows the ankle below its request
   as the hips drop (L3-F8-recontact D 0.92-0.95 s).

Also: supported leg against ragdoll 16.3 s over all runs (reactive planner 1.9 s, step 4 20.9 s); hip past its range
3.6 s (0.9 s); the leg guard's depth queries (`pose.ts`, external) past the 4,000-a-tick budget in 6 runs, at most
4,335 (L3-F1-low, HC-F3-lowRunner 0.72 s, L3-F4-twoArm 0.8 s). Parked: the swing's path in 3D
(`.scratch/p23/parked/s3-over/`), the knee carried in by the hips.

## Tests

The L3 contract pass (tests/l3-pass.ts) checks the reactive planner's contracts, on the L3 fixtures as before the flip
(`preSteps`), until step 5. Its viewer rules measured on the model over all runs: shown leg pops over 2 cm in a substep
955 against 1470 under the reactive planner; runs with a player 0.25 s without a planted foot 34 against 103. Its
transition audit (a landmark off the old owner's continuation) reads 5-8 cm at the model's swing-to-plant changes,
a continuation the model does not have: step 5 restates it on the shown pose.

## What is deleted at step 5

In `footwork.ts`: the reactive triggers, `destination`, `fitStance`, `fitLanding`, `continueSwing`, `lateLand`,
`blockedW`, the `tentative` and `inherited` paths, `compose.lateLanding` and its lab switch, the `FootDebug` faults of
those paths; `foot-compose.ts` `heldOff`. Tests that pin those mechanisms (the L3 contract pass's) go with them; tests
that state viewer rules stay.

## Older families

L2 and RH use the old planner (`FOOTWORK_L2`), byte-identical until step 5. Owner (2026-11-17): they then move onto
the model in one step, their summaries change once, and the old planner is deleted.

## Steps

1. Free ground. 2. The model behind a profile. 3. One test of a place, feet shown as asked, places ordered by depth.
4. The flip on L3, L4 and HC (summaries changed once; who falls to the owner). Done. 4b: the come-down's read on the
   model (STEPS_V2), its own flip. Done.
5. Older families, then delete the old planner and its tests.
6. Polish what looks worst in the lab, in the order above.

## Acceptance (viewer rules over all L3, L4, HC runs)

- No step longer than the short-step limit; step times within the floor and ceiling.
- No same foot stepping twice while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot landing inside another player's footprint; no leg through another player's leg.
- Existing: no skate, foot continuity, hip range, no snap.
