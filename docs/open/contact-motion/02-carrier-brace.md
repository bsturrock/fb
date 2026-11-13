# Milestone 2 — Carrier prepares for contact and falls with control

## Rough-first slice (2026-11-13; do this before anything else in this file)

Per the direction in the [README](README.md): a rough, visible brace end to end, judged in the lab, polish later.

1. **Decision, flag off.** A brace weight 0..1 on the carrier from an observed, visible, closing opponent and a
   predicted contact time (port the intent of sim-6 `src/logic/brace.ts`: acquire about 0.45 s out, hold with
   hysteresis, release smoothly on a miss, none for unseen or rear approaches, none when unthreatened).
2. **Pose, flag off.** One authored brace pose blended by that weight (start from sim-6 `CARRY.brace`: hips about
   5 cm lower, trunk about 17 degrees forward, carry arm high and tight, free palm onto the ball, arm swing
   reduced), for either carry side. Arms use the three-stage shape: authored pose, then task, then the final pass;
   no new per-case guard.
3. **On for L3, L4 and HC carriers**, as its own step. Judged on the visible bar and by the user's look; changed
   fall outcomes are listed, not blocking.

Not in the slice: conversion carry-over and fall control (step 4 below), free-arm landing priority, tuning of
horizons and angles. Known items to look at while here: the carrier's leg nearest a wrapping defender moves oddly
(`L3-F5-drag`); a held ragdoll's trailing legs read as running (`HC-F3-lowRunner`).

## Visual target

Before an approaching defender reaches them, the carrier bends knees, lowers the hips slightly and brings chest/shoulders forward over the advancing base. The ball stays tight against the ribs; the carrying elbow closes toward the body and the free forearm can cover the exposed ball. This is a short athletic crouch, not a waist collapse or head-first dive. On a forward-moving tackle, the runner continues down and forward from that posture; the carrying arm protects the ball while the free arm becomes available for landing.

## Inspect and implement

### Prior implementation: football-sim-6

Use sibling repository `../football-sim-6` as a visual and code reference before inventing a new brace. These files were located and inspected during planning; the old app was not run and its appearance has not been revalidated.

- `src/anim/ballCarry.ts`: `CARRY.brace`, `BRACE`, `rampBrace`, `braceWeight`, `braceLower`, `carryBrace`, and the free-hand cover construction. The existing pose lowers hips by 0.05 m and pitches the trunk forward by 0.297 radians (about 17 degrees), blends the carry arm to a dedicated high-and-tight key, reduces arm swing and brings the free palm onto the ball. Use this silhouette and transition as an initial reference, not mandatory sim-7 constants.
- `src/movement/braceEditor.ts`: interactive pose editor with a “go to full brace” control and source-value output. Use the old contact lab to inspect full brace and intermediate weights from front/side views. Capture reference frames during implementation; compare hip drop, chest pitch, carrying elbow and free-palm coverage against sim 7.
- `src/logic/brace.ts`: visible-imminent-contact decision, relative-motion contact-time calculation, body-facing field of view, third-player occlusion, and same-threat hysteresis. Old seeds are a 0.45 s acquisition horizon and 0.65 s retention horizon with 0.2 m margin. Compare these with the shorter proposed horizon below; choose timing that actually permits the pose to develop before impact. Visibility uses achieved body facing rather than travel direction or incidental animated head turns. Rear/unseen approaches do not trigger anticipation.
- `tests/brace.test.ts`, `src/scenario/braceMetrics.ts`, `scripts/brace-measure.ts`, and `scripts/brace-trace.ts`: reference scenarios and measurement ideas. Cases include `carry`, `carryMiss`, `carryRear`, `carrySide` and `carryFacing`. Some historical recovery/continuity tests are explicitly skipped after the articulated-body migration; do not cite those as passing evidence.
- `milestones/m4/ball_carrier_brace_goal.md` and its review/fix goals: original intent and known transition problems. `reference/movement/ball-carry/high-and-tight.png` and `running-carry.png` are available carry reference images, not verified screenshots of the implemented brace.

Port the intent and visual relationships selectively. Sim 6 edits clip frames and uses different body/rig conventions; do not copy its coordinate signs, bone transforms, root lowering or contact architecture directly. In sim 7, request the corresponding posture through existing support/pose controls and preserve physical conversion. Generalize its right-carry-specific pose to the actual carry side. Keep visibility-based anticipation and no-brace-on-near-miss behavior when adapting the decision; use existing observations instead of importing a parallel perception system.

### Sim-7 integration

Trace carrier intent production from `controllers/base.ts` through posture/stance consumers in `balance.ts`, support and pose runtime, plus existing ball-carry logic. Inspect `fall-response.ts`, `conversion.ts` and their call sites. Existing fall response protects the actual carry arm using its accepted reference pose: a poor pre-contact reference must be fixed before merely increasing post-conversion effort.

1. Add the smallest shared carrier preparation policy at the existing intent composition point so it works across carrier controllers. Trigger from an observed nearby closing opponent and predicted contact horizon, not a fixture timestamp or omniscient future collision. Start testing a roughly 0.15–0.3 second horizon, with hysteresis and a smooth release when the threat misses.
2. Compose bounded forward lean and lower stance with locomotion. Prefer travel direction, with facing as a low-speed fallback; avoid whipping the torso toward a side threat. Start with modest lean and height changes within current support limits; tune from achieved pose, not requested values.
3. Reuse carry-pose targets to tuck the actual ball arm. Add free-arm cover only while feasible and give landing preparation priority when falling. Preserve attachment and self-clearance for either carry side.
4. Preserve achieved posture, linear/angular motion and arm references at validated conversion. Reuse bounded hip/knee and arm fall response to maintain control; do not add a world-space forward shove or force every impact to produce a forward fall.

## Acceptance

Extend carrier/ball-carry, handoff and fall fixtures/tests. Demonstrate preparation before front/oblique contact, no persistent crouch after a miss, no crouch during unthreatened running, and correct carry-side protection. Check pose/velocity continuity across conversion and ball-to-carry-landmark consistency. Compare forward displacement and torso pitch with baseline on forward-moving cases; retain side/backward outcomes when impact warrants them.

Done when the clip visibly reads as anticipating contact, protecting possession and following momentum into the fall, with no ball teleport, pre-contact loss of balance or newly rejected conversion.
