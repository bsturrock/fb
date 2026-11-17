# Plan 15 handoff: contact footwork, one stepping model

Plan: `docs/open/15_Contact_Footwork.md` (now the polish queue). Steps 1-5b done (2026-11-17).

## What it is

Outside the clip regime (a contact hold, braking, or no clip weight) the contact stepping model alone moves the feet
(`src/sim/contact-steps.ts` `stepFeet`, `src/sim/free-ground.ts`), on every L2, L3, L4 and HC fixture with a foot
planner (`STEPS_V2`; RH has none). A foot's want is the capture point within a short step of the hip; its aim the least
deep place within reach in the other players' footprints and parts (`depthAt`, `leastDeep`); an aim deeper than 8 cm is
bound. A plant never moves; with both feet down the foot that gains more steps, the feet taking turns; a step's time
comes from its length and never changes. The bound-legs fall reads `legsBound`; the ride-down's come-down takes a riding
tackler down once no foot can get under his hips (`footUnder`; fault `FootDebug.stepsRideAnyFoot`, the steps-v1 read).

`footwork.ts` keeps the clip regime (plants from the clip's stance annotations, the brake hold), the rejoin and
support-regained steps into it (`startStep`/`advanceStep`), the no-support branch, observation and the shown sole. A
footwork profile without `steps` throws outside a clip.

## What step 5b removed

- planFeet's reactive steps (the clip-to-procedural crossing, step triggers, blocked-home memory, the stationary hold's
  still feet), `continueSwing`, polish 2's `lateLanding` with `lateLand`; `STEPS_V1` (folded into `STEPS_V2`,
  whose `underHips` flag is now unread but kept so the profile exports as before), `withoutSteps`; FootDebug `legacyEntry`, `crossingBodyHeading`, `settleOneSubstep`, `noBlockedMemory`,
  `noVoluntarySteps`, `squeezeStart`, `lateRepick`. `holdStill` stays on the profiles for their ids; nothing reads it.
- Lab: `steps=`, `holdstill=`, `latestep=`. Tests: `preSteps`/`preStepsV2`, hold-still.test, late-landing.test.
- Captures resume on the registered footwork (a standing variant: tests/runs.ts `asCaptured`, tests/state.ts
  `resumeState`), whatever planner they were taken under.

## Tracked defects (polish order; lab `npm run dev`, then the link)

1. Tackler held up too long (step 4 only, none since 4b): pinned on `L3-F1-phase2~rev@64`, `L4-F10-wrap-off@72` with
   the steps-v1 read (tests/steps-defects.test.ts). No registered run reaches it.
2. A leg in the other man with no free place (holds 3-8 cm; L2 side hit, `LEG_IN_MAN_SIDE_HIT`):
   `?fixture=L2-F8-sideLoss&cam=front&speed=0.25&t=0.50`
3. A landing rolled on the shoe's edge, 15-42 deg in hit scenes (no subtalar roll):
   `?fixture=L3-F1-phase4&cam=side&speed=0.25&t=0.75`
4. Plants shown off their anchor (L3 at most 8 cm; a skate on holdMirror, exception `PLANT_OFF_ANCHOR`):
   `?fixture=L3-F6-holdMirror&cam=front&speed=0.25&t=2.70`
5. A shoe in the turf up to 5.6 cm for 0.05 s: `?fixture=L3-F8-recontact&cam=side&speed=0.25&t=0.90`
6. A proposed plant taken over with no footPlant event (bookkeeping only; L2 most fixtures, L3-F4-gripTarget):
   `?fixture=L3-F4-gripTarget&cam=side&speed=0.25&t=0`
7. Run-rejoin float: back on the run clip after contact, both feet off the ground over 0.25 s (exception
   `RUN_REJOIN_FLOAT`, L3-F7-phase50/75; captures `@54`, `@96`): `?fixture=L3-F7-phase75&cam=side&speed=0.25&t=1.70`
8. Two feet landing together at a stop: the trailing plant released for reach while the swing foot is still in the air
   (exception `STOP_FEET_TOGETHER`, L3-F16-stop1.9/2.1/2.9, -runStopHard; footwork.test's crossing rows; captures
   `L3-F16-stop1.9@153`, `-runStopHard@183`): `?fixture=L3-F16-stop1.9&cam=side&speed=0.25&t=2.55`
9. Pose pops at ownership changes: 40 boundaries over 5 cm on L3, largest 10.9 cm (the audit's 1 cm gate dropped; the
   audit and its records stay): `?fixture=L3-F3-side&cam=front&speed=0.25&t=0.60`

## Coverage dropped at step 5b (48 items; reason: the scenario no longer occurs on the model, or its bound moved)

- Tracked-defect pins on pre-flip captures: CLEARANCE_KNEE_TURNS_BACK (drive, ride x2), RAISED_ARM_TWIST, HIP_SNAP,
  HOLD_SHOULDER_IMPACT_POWER, UPPER_ARM_IN_TRUNK, STEP_SEEDS_CLEARANCE_JUMP, the ride-off half of
  OVERHEAD_TWIST_UNHELD, and the reactive twins of TAKEDOWN_ENERGY_GAIN, ELBOW_PAST_RAGDOLL_RANGE, LEG_IN_MAN_SIDE_HIT.
- Wraps: wrap-ride (b) 60 deg in 0.25 s; wrap-bind (b) braced and (c) still stepping; fall-link (e), (h), (j); ride-hold
  rows front reversed, L3-F1-low; wrap-hold row rear; wrap-stay-on (v); fall-react holdOnset rows front reversed, rear.
- Conversions: conversion-retry L3-F1-phase4 reversed and strictTransfer's start-clear row; harness 9g; fall-forward
  lay-out power; falls/lab-params retry run twin.
- Legs: physical-legs D1 yield; planted-pose rung 7b; body-limits heel-lift row L3-F1-low; gate4 E1's rise half;
  met-arm-stay row L3-F6-hold; visible's screenshot run.
- The L3 contract pass (22 of 55 tests): the transition gate, the planner's handovers, B1/B2 target continuity, step
  coverage and continuity records, plan 08 foot limits, plan 13e faults (5), the still feet, the ladder's 4 posed-leg
  defects. Kept: audit, records, step limits, B3, passes, known limits, held arms, retention, ball.
- footwork.test: plant intervals, backward drag, slow fallback, shove's one-foot row, plan 07's plant bookkeeping and
  1 cm sole/plant contracts, L2-F2 counts, the reactive touchdown/support-loss/initialization rows, the four synthetic
  crossing rows.
- The reactive planner's own rules: hold-still.test (2), late-landing.test (3), lab holdstill=/latestep=/steps= (5).

## Left in place, parked

- `FootworkProfile`'s reactive trigger fields (`stepTriggerM`, `settleTriggerM`, `yawTriggerDeg`, `yawReleaseDeg`,
  `leadLateralMps`, `leadLateralFrac`) are no longer read; left on the profiles so the step stayed byte-identical (a
  cleanup step can take them out with the fixture export checked). `startStep`, `fitStance`, `fitLanding` and
  `advanceStep` serve the rejoin and support-regained steps.
- Defect 6's fix (initFeet plants at once, no tentative path outside a clip) was not built.
- Parked: `.scratch/p25/parked/` (defect 1 at step 4).
