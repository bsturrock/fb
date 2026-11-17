# 15. Contact footwork: one stepping model

Status: steps 1 to 4b and 5a done. The model is on for every L3, L4 and HC fixture with a composed foot planner and,
since 5a, every L2 fixture (plan 07's planner, `FOOTWORK_L2`). RH has no foot planner. Lab: `&steps=old` shows the
reactive planner, `&steps=v1` the model as at step 4. Owner (2026-11-16): the round-4 scenes look fine with the model;
the overlaps there are polish, not blockers. Next: step 5b, delete the reactive planner (inventory below).

## What a viewer should see (owner, 2026-11-15)

Short choppy steps under the hips. Feet never inside the other man. A foot always down when pushed. No galloping.
A clear system that works, not more rules: this plan replaces the contact stepping core; it adds no guards to it.

## Why replace

The reactive planner (`footwork.ts`) picks where and when knowing nothing of other bodies; the leg guard then moves the
leg off them and the planner re-aims at the same body (the gallop); retimers rewrite step times after the fact; a
held-off foot never plants. Two attempts to patch a body test into it each worsened another scene.

## The model (`src/sim/contact-steps.ts`, `src/sim/free-ground.ts`)

Per player, per substep, once the clip regime ends (contact hold or braking, or no clip weight). It runs on either
planner: plan 08's composed one or plan 07's; a step starts from the achieved foot at its motion (`seedAchieved`), and
`observeFeet` measures that motion whenever the model is on. The clip regime, airborne feet and shown sole stay the
planner's own (on L2, plan 07's: no composition is brought, so one model, no variant).

**A place, and how deep it is.** `depthAt`: how deep a leg standing there is in the other players (the shoe's disc in
a footprint, or the whole planned leg, `pose.ts` `plannedLeg`, in their parts past a skin); 0 is free. A place where
the leg leaves its joint ranges, or beyond reach, is no place. Depths within the skin of each other are equal.
**Where.** A foot's want is the capture point, limited to a short step from the hip; its aim the least deep place within
reach (`leastDeep`). An aim deeper than 8 cm is **bound**. A foot in the air follows its aim at a bounded rate, its path
no deeper into the footprints than its ends, never into the turf. **When.** A plant never moves; it lifts at once when
its leg leaves its ranges. With both feet down a foot steps to a less deep aim, or as deep and a gain on its want. The
feet take turns unless the plant is visibly in a man. A step's time comes from its length and never changes.
**Shown as asked** (`FootRequest.exact`). **Falls:** the bound-legs fall reads `legsBound`; the ride-down's come-down
takes a riding tackler down with his man once nothing holds him up (`underHips`, STEPS_V2, step 4b).

Constants (`STEPS_V2`): short step 0.4 m, gain 12 cm, step time length / (1.6 + 2 |v|) m/s within 0.16-0.30 s, aim
followed at 2 m/s, lift 7 cm, foot radius 10 cm, leg skin 3 cm, bound past 8 cm.

## Step 5a, L2 on the model (measured, 27 fixtures, old = plan 07)

Who falls: unchanged in every run (same conversions, same times; L2-F8-sideLoss R's transfer gains 3.1 % against 2.8 %).
No stiff fall added (L2-F8-noRescue's rigid fall is the fixture's own). Steps in the planner's regime 167 to 160, time
median 0.20 to 0.16 s (max 0.34 to 0.20); landing from its hip median 1 to 11 cm, max 28 cm; gallops 2 to 0; longest
time without a planted foot 0.23 to 0.27 s (L2-F8-sideLoss D, within one step time); skates 0 and 0; bound 0.77 s
(hop, shove, out-of-range, side hit); supported hip past range 0.05 to 0.08 s; supported leg through supported 0.02 to
0.15 s (below); snaps 1 and 1. Visibly: the feet step in short even steps under the body (drag, shove, slow walks,
the run's stop) instead of plan 07's long late swings and shuffles. RH unchanged.

## Tracked defects (polish order)

None blocks a gate, none has an exception.

1. **Two conversions of a tackler held up too long** (step 4, none since 4b; tests/steps-defects.test.ts, parked
   `.scratch/p25/parked/`): a takedown gaining over half its energy; a supported right elbow past the ragdoll's 145 deg.
2. **A leg in the other man** with no free place: the holds (L3-F6-hold, -holdMirror, -saturated, thigh 3-8 cm), and
   since 5a a side hit (L2-F8-sideLoss 0.50-0.62 s: the tackler's left foot steps under him into the runner, the least
   deep place 4-16 cm, his thigh 14 cm in the runner's; plan 07 from the same state left it trailing, 1 cm;
   LEG_IN_MAN_SIDE_HIT on the capture `L2-F8-sideLoss@27`).
3. **A landing rolled on its edge**, 15-42 deg in hit scenes (no subtalar roll in the pose, rig, render and ragdoll).
4. **Plants shown off their anchor**: L3 7 of 1606 past 5 cm, at most 8 cm; L2 up to 4.8 cm (L2-F7-shove).
5. **A shoe in the turf** up to 0.05 s and 5.6 cm (L3-F8-recontact D 0.92 s); L2 1-2 cm (hop, shove, side hit).
6. **A plant taken over with no footPlant** (5a): the model takes over a proposed plant (the initial stance) without
   confirming it, so its release has no plant event (L2 most fixtures, L3-F4-gripTarget, L4-F4-occupied). Goes with
   the tentative path at 5b.

Also: a supported ankle 1 deg past its dorsiflexion range in L2-F1-stagger (1 s); L3/L4/HC supported leg against
ragdoll 16.3 s, hip past range 3.6 s, leg-guard depth queries over budget in 6 runs (4,335 at most).

## Tests

Rows that pin the reactive planner's mechanisms run on fixtures as before their flip (`preSteps`: the L3 contract pass,
tests/l3-pass.ts and l3-contracts.test.ts; footwork.test.ts `PRE` rows; harness's legacyEntry/noQuick row; plus
single-fixture twins in met-arm-stay, wrap-hold, physical-legs, visible, transitions, gate4, falls). Viewer rows (limb
lengths, knee limits, swing caps, continuity, conversions) run on the registered fixtures.

## Step 5b: what is deleted (inventory, estimated 2,500-3,000 lines: 600-750 source, the rest tests)

- `footwork.ts` (1,798): planFeet's reactive-steps block (about 135 lines), `destination`, `startStep`,
  `continueSwing`, `fitStance`, `fitLanding`, `lateLand`, `nearestOther`, `stepClearance`, the reactive parts of
  `advanceStep`, `blockedW`/`blockerW`, the `tentative` and `inherited` paths outside the clip (initFeet plants at once:
  fixes defect 6), `compose.lateLanding` with `withLateLanding`; about 500-650 lines. Kept: the clip regime, crossing
  into the model, airborne feet, observation.
- `foot-compose.ts` (267): `heldOff`, `handsOn`, `canFollow`'s reactive uses; about 40-60 lines.
- Profiles: `FOOTWORK_L2`'s trigger fields (settle, drag, yaw, quick-step), `steps` becomes required (or the model is
  the planner), `withSteps`/`withoutSteps`. `debug.ts`: `legacyEntry`, `noQuick`, `noVoluntarySteps`, `lateRepick`,
  `noBlockedMemory`. Lab: `steps=old|v1|new` and `late=` (lab-params.ts and its tests).
- Tests, delete: the L3 contract pass's planner contracts (most of l3-pass.ts's 2,180 lines and part of
  l3-contracts.test.ts's 1,200, about 1,800-2,100 together), footwork.test.ts `PRE` rows (proposals, plant floor, drag,
  bookkeeping; about 250 lines), the harness switch row, `preSteps`/`preStepsV2` in tests/runs.ts once no capture needs
  them (captures before 4b resolve through them: keep while those captures are kept). Restate on the model: the
  every-fixture sole and plant contracts as the turf and skate rules (defects 4, 5), reproducibility's bookkeeping as
  plant/release pairing (after defect 6), the transition audit on the shown pose; the single-fixture twins in other
  files keep `preSteps` until their captures are retaken.

## Steps

1-3. Free ground; the model behind a profile; one test of a place. 4 / 4b. The flip on L3, L4, HC; the come-down's
read. 5a. L2 on the model (one flip; who falls unchanged). 5b. Delete the reactive planner and its tests.
6. Polish what looks worst in the lab, in the order above.

## Acceptance (viewer rules over all L3, L4, HC and L2 runs)

- No step longer than the short-step limit; step times within the floor and ceiling.
- No same foot stepping twice while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot landing inside another player's footprint; no leg through another player's leg (defect 2 tracked).
- Existing: no skate, foot continuity, hip range, no snap, no stiff fall.
