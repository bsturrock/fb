# Plan 06 handoff: supplied run clips sampled into the physical pose

Date: 2026-11-05. Status: implemented; smoothness and carry-arm pass 2 done the same day; waiting for the user's visual acceptance. Plan: [06 — Supplied animations and running](../open/06_Supplied_Animations_and_Running.md).

The two supplied clips, Fast Run and Sprint, are decoded headless from the baked JSON. Each player plays them from its solved travel, and they are sampled into the existing `buildProxyPose` path:
- legs: ankle targets around the calibrated hips, the knee pole, and foot IK on the clip's planted point;
- free arms: the clip swing.

The procedural gait remains the explicit fallback in four cases: below the clip speed band, when travel is more than 30° off the facing, while airborne, and while falling. The physical core, the hips and shoulders, forces and every Gate 1–4 rule are unchanged. Until the first handoff, the physics of a drill is bit-identical with and without clips (test).

Supplied-clip acceptance is not claimed here. The clip plays at full weight in L1-F1/F3/F4 (`run … w 1.00` in the lab and in traces), but acceptance of the look is the user's call after watching it.

## Pass 2 (2026-11-05): user review "incredibly jerky; the football arm needs to move as well"

Causes found by measuring the per-tick second difference of body-local landmarks against the clip request's own (`l1-jerk.ts`):

| Cause | Symptom | Fix |
| --- | --- | --- |
| Rigid shoe: the shoe tilted with the shin; in stance the shin leans forward up to ~30°, the toe dug in, and the floor lift raised the ankle 7–9 cm, which bent the knee further and tilted the shoe more (feedback) | stance knee 19° → 48° in one tick; shin lean 2° → 21° in one tick | **Ankle pitch** (`PhysicalPose.anklePitchDeg`): the shoe frame is the shin frame pitched about its hinge axis so the shoe keeps the clip foot's angle to the floor, within 30° dorsiflexion / 50° plantarflexion. The planted foot stays flat; no lift is needed in stance |
| Leg solve searches and switches (variant picks, knee-axis flips near a straight leg) | knee 0.236, ankle 0.193 m/tick² | continuous sampled solve: floor-relative ankle heights, a fixed forward knee pole, soft reach (0.08 m ease below the reach that keeps 1° minimum flexion) |
| Foot IK pulled the procedural/clip blend toward the clip's contact point during the weight ramp; the pull dropped in a tick at liftoff | L1-F2 onset ankle 0.107 | foot IK is a correction of the clip ankle, added at the clip weight |
| Clip blend Fast Run ↔ Sprint followed speed instantly; hard braking (~14 m/s²) crossed 40 % of the 5.83–6.24 m/s blend in one tick | L1-F2 braking carry palm 0.134, free palm 0.09 | blend position rate-limited (`blendRatePerS` 2: a full blend takes 0.5 s) |
| Free arm flipped between candidates | carry palm 0.817, sprint left palm 0.889 | continuous radial clearance push against other bodies only (own-torso overlap is visual only: ragdoll self-collision is disabled for the same owner) |

The carry arm now swings: hold `CLIP_CARRY` (body-local 0.34, 0.24, 0.20 × side) plus `carrySwing` 0.6 × the clip hand's excursion from its cycle mean. The ball follows the hand: L1 rule profiles use `ballSource: 'carryPalm'` (rule ball = the pose's right palm), and the lab draws the ball there. G4 rule fixtures keep `coreOffset`.

Result, max second difference per tick (m), achieved / clip request (legs: ankle request; arms: palm request or carry swing):

| Fixture | Legs (knee, ankle, shoe) | Free palm | Carry palm |
| --- | --- | --- | --- |
| L1-F1-fastRun | 0.060 / 0.042 | 0.075 / 0.075 | 0.034 / 0.034 |
| L1-F1-sprint | 0.060 / 0.043 | 0.065 / 0.065 | 0.077 / 0.077 |
| L1-F2-accelBrake | 0.052 / 0.038 | 0.070 / 0.068 | 0.047 / — |
| L1-F4-twoPhases (R / D) | 0.051 / 0.027, 0.043 / 0.036 | 0.051, 0.060 (= request) | 0.023 |

The arms now move exactly as the clip asks. The legs stay within 1.9× the request (they add touchdown and liftoff contact). A test fails at 2×; the old solve was 5.9×.

## Pass 3 (2026-11-05): user review "arms look ok but it's still super jittery; side view it's super obvious"

Cause: the lab's follow camera. Players are drawn interpolated between the last two ticks (driver alpha), but the camera target was the current tick's COM. The camera therefore stepped once per 1/60 s tick while the runner moved smoothly, so the runner (and the field behind them) shook against the camera by up to one tick of travel: 9.7 cm at 5.8 m/s.

| Measure (`scripts/probe/l1-render.ts`, L1-F1-fastRun) | Value |
| --- | --- |
| Core in the world, second difference per tick | 0 (smooth) |
| Core rotation change per tick | max 0.05° |
| Drawn core relative to the camera, second difference per frame, before | 0.097 m every frame at 120 Hz; p90 0.097 at 60 Hz (frames with 0 or 2 ticks) |
| Same, after (`tests/lab-render.test.ts`, 60/120/144 Hz) | < 1 mm |

Fix: `src/lab/follow.ts` `followCenter` interpolates the players' COM with the same alpha as the drawn poses; the lab stores each player's COM with the previous-tick pose. The simulation is unchanged.

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | no errors |
| Tests | `npm test` | 136 passed (17 G1, 12 G2, 16 G3, 49 G4, 20 model, 21 L1, 1 lab render), 0 failed |
| Production build | `npm run build` | ok; chunk-size warning only (Rapier WASM inlined, as before) |
| Evidence export | `npm run fixtures` | all fixtures, including the 8 L1 fixtures, written to `evidence/traces/<id>.json`; every pre-existing fixture's `evidence/summary.json` entry is identical to HEAD |
| Regenerate the intake record | `npm run intake-clips` | rewrites `src/sim/model/run-clips.record.json` from `models/animations/` (a test checks the committed record still matches) |
| Playback and stance probe | `npx vite-node scripts/probe/l1-probe.ts <id> [every]` | per tick: phase, weight, rate, residuals; stance gap and contact slip; handoffs |
| Free-arm candidates | `npx vite-node scripts/probe/l1-arm.ts <id> [player] [side]` | depth/soft of each arm candidate |
| Physics equivalence | `npx vite-node scripts/probe/l1-equiv.ts` | G4-F3-*-M vs L1-F5..F7 up to the first handoff |
| Smoothness | `npx vite-node scripts/probe/l1-jerk.ts <id> [player] [top]` | per landmark: second difference per tick (median/p90/p99/max) and the request's own (`req:`); top spikes with memory and residuals |
| Leg and shoe per tick | `l1-shoe.ts`, `l1-trace.ts`, `l1-ik.ts <id> <side> <t0> <t1>` | shin lean, lowest shoe corner, ankle pitch, hip distance; playback weight/phase; request → foot IK → lift |
| Arm per tick | `l1-armtrace.ts <id> <side> <t0> <t1>` | body-local palm/elbow, playback blend/rate/heading, memory |
| What the lab draws | `l1-render.ts <id> [hz] [player]` | world core motion per tick; the lab frame loop emulated at a display rate (driver, alpha, follow camera) |
| Lab | `npm run dev`, then http://127.0.0.1:5197/?fixture=L1-F1-fastRun | the L1 group is "L1 · supplied run clips"; the info panel shows a `run …` line per player |

## Clip inventory (intake record)

Source: `models/animations/` (manifest, original FBX files, baked JSON). Record: `src/sim/model/run-clips.record.json`, generated by `scripts/model/clip-intake.ts`. Calibration: bew-v6 `5aaab36942e3`.

| | fast-run | sprint |
| --- | --- | --- |
| Source FBX sha256 (manifest-checked) | `3706070da7b5…` | `6de0bb9717cf…` |
| Baked data sha256 / identity | `fast-run@9d9ad0197d33` | `sprint@f2aa3627a75d` |
| Samples | 17 at 30 fps; closed cycle of 16 frames, 0.5333 s | same |
| Tracks | 29 joint positions, 29 world rotations from bind | same |
| Rest vs calibrated model | 0.07 mm (same skeleton); player leg scale 0.99998 | same |
| Bone-length change across frames | 0.05 % | 0.06 % |
| Loop seam (last vs first frame) | 0 m | 0.1 mm |
| Root motion | in place as supplied | 3.4505 m forward travel removed at bake (`--in-place`) |
| Facing vs travel (pelvis) | −2.0° | −3.9° |
| Nominal speed (planted-toe speed, calibrated) | 5.833 m/s (spread 0.09, 6 contacts) | 6.239 m/s (spread 0.52, 7 contacts); the original bake travelled at 6.47 m/s |
| Stride (one full cycle) | 3.111 m | 3.327 m |
| Phase zero | left touchdown (source phase 0.310) | left touchdown (source phase 0.292) |
| Stance, half-open `[touchdown, liftoff)` | L [0, 0.319), R [0.492, 0.822) | L [0, 0.271), R [0.492, 0.793) |
| Flight fraction | 0.351 | 0.429 |
| Playback bounds | rate 0.7–1.3 | rate 0.7–1.3 |

Nominal speed comes from the samples, not the duration: it is the backward speed of a toe planted within 5 mm of its rest height, relative to the hips. Each touchdown and liftoff is an interpolated crossing of 2 cm above the rest heights, and exactly one stance interval per foot is required.

## Profile settings (`runClipsBew`, `src/sim/model/run-clips.ts`)

| Setting | Value | Meaning |
| --- | --- | --- |
| id | `run-clips:fast-run@9d9ad0197d33+sprint@f2aa3627a75d` | exported in `profileIds.runClips` and `profiles.runClips`; sample data is not exported |
| Clip choice | by speed / leg scale: Fast Run alone up to 5.83 m/s, a blend between the two nominal speeds, Sprint only (blend 1) above 6.24 m/s | trace `clip` shows `fast-run`, or `fast-run+sprint` with `b` as the blend (1 = Sprint only) |
| Playback rate | actual speed ÷ (blended stride × leg scale ÷ cycle), clamped to 0.7–1.3 | trace `r` |
| Weight band | 0 below 3.208 m/s, 1 above 4.083 m/s (smoothstep); 0.55× and 0.70× the Fast Run nominal speed | trace `wt` |
| Heading | travel within 30° of facing plays; fades to 0 over a further 30° | |
| Support | grounded and `supported`, otherwise target 0 (airborne, falling) | |
| Weight rate | at most 5 per second (0.2 s full fade) | trace `w` |
| Blend rate (`blendRatePerS`) | 2 clip positions per second (0.5 s from Fast Run to Sprint) | the blend follows speed within this rate; trace `b` |
| Free-arm swing | on | never on an achieved (ArmSystem) arm or ready hands |
| Carry swing (`carrySwing`) | 0.6 | share of the clip hand's excursion about its cycle mean added to the carry hold; 0 = still carry |
| Carry hold (`CLIP_CARRY`, pose.ts) | body-local (0.34, 0.24, 0.20), x by side | the carry palm's cycle-mean position while the clip plays; found by a clearance search (`l1-carry.ts`): holds that clear the bew-v6 torso need x 0.27–0.34 |
| Foot contact (`CONTACT`, run-clip.ts) | full at ≤ 5 mm clip heel/toe height, none above 25 mm; heel-to-toe roll over 30 mm | |
| Ankle range (`ANKLE_DORSI`/`ANKLE_PLANTAR`, pose.ts) | 30° toe up, 50° toe down about the shin | sampled legs only; procedural legs keep the rigid shoe (pitch 0) |
| Soft reach (`SOFT_REACH_M`, `MIN_FLEX`, pose.ts) | targets ease in over the last 0.08 m below the reach at 2 × `straightBendDeg` knee flexion | |
| Swing clearance (`SWING_OUT_STEP`/`MAX`, pose.ts) | radial outward push of the palm, bracketed and bisected, up to 0.30 m, against other bodies only | |
| Ball source (L1 rule profiles) | `carryPalm` | rule ball = the pose's right palm |

## How it works

1. Decode (`src/sim/run-clip.ts`; no DOM, no simulation state):
   - Validate structure: fps, frames, rest pose, joints, finite values, unit quaternions.
   - Normalize the cycle: check for scale changes, remove linear travel and yaw drift, centre on the mean hips, rotate so the planted-toe travel is +Z, and check the seam.
   - Re-analyse the samples and compare them with the committed record. A stale record is an error that says to re-run `npm run intake-clips`.
   - Build deep-frozen working frames: legs in leg units, arms as directions in the chest frame.
   - Decode once; every fixture and player shares the result.
2. Playback (`RunPlayback`, owned by the player, rebuilt on reset):
   - Advanced once per substep from the solved core travel.
   - At `dt` = 0 it initializes from the solved velocity.
   - While the weight is 0, the clip phase follows the procedural gait phase. While the clip plays, the gait phase follows the clip.
3. Retarget (`retargetSample`):
   - Ankle targets sit on the floor frame around the hip midpoint, rotated to the travel heading, scaled by leg length.
   - Ankle heights are floor-relative: the player's flat-shoe ankle height plus the clip ankle's lift. The hip and core stay authoritative and the clip's pelvis bob is dropped.
   - The knee pole is fixed forward along the travel heading (the clip's own knee offset is unreliable near a straight leg).
   - Foot pitch: the clip foot's angle (ankle → toe base) in the travel plane relative to its rest angle.
   - While the clip foot is down, the contact point is the clip's planted heel/toe position mapped into the world.
   - Arms: the clip's chest-frame segment directions from the player's shoulders, and each hand's excursion from its cycle mean (carry swing).
4. Pose (`buildProxyPose`, sampled branch only; every step is continuous in the clip phase, no searches):
   - Soft reach, then the two-bone solve with the forward pole.
   - Ankle pitch: the shoe gets the clip foot angle, within the ankle range, blended by the clip weight.
   - Foot IK corrects the clip ankle so the shoe's planted sole point lands on the contact point (a fixed point over the shoe frame, primary variant only), added at the clip weight.
   - A fixed-point floor lift takes what is left (a pitch at its range limit, the procedural blend).
   - Free arms take the clip palm target. The carry arm takes the hold plus the carry swing. If the target is not clear of other bodies, the palm is pushed radially out by the smallest clearing distance. The blend starts from the procedural arm shown before the clip.
   - `targetResidualM` records the distance from each sampled request (after foot IK) to the achieved limb, and is published to the trace as `res`.
   - `anklePitchDeg` is published with sampled poses only; the authored and procedural pose output has no new fields.
5. Shoe frame everywhere (`footFrame`, `pitchShin` in pose.ts):
   - pose shapes, the shoe landmark, the lab's primitive shoe and the model's Foot bones (`RigAdapter`, pivoting about the calibrated rest ankle; at pitch 0 exactly the undriven rest);
   - ragdoll candidates build the shoe collider and landmark at the pose's ankle pitch, and the ragdoll keeps that pitch (a locked ankle) and publishes it, so handoff landmark continuity holds.

## Fixtures (`src/sim/fixtures/locomotion.ts`, milestone L1, bew-v6 geometry)

| Fixture | Requests | Playback | Result / handoffs |
| --- | --- | --- | --- |
| L1-F1-fastRun | R 5.8 m/s +X from t = 0 | `fast-run`, w 1 throughout, rate 0.994 | duration |
| L1-F1-sprint | R 6.6 m/s; labelled motor with request ceiling 6.8 m/s, same force | `fast-run+sprint` b 1, rate 1.058 | duration |
| L1-F2-accelBrake | stand 0.5 s, 6 m/s, stop at 2.6 s | procedural at rest, ramps to w 1 near 3.2–4.1 m/s, back to procedural when stopped | duration |
| L1-F3-collision | R 5.8 m/s into a bracing D (0.25 m lateral offset) | rate follows the reduced actual speed | R accepted 0.925, D accepted 0.904, both audits ok |
| L1-F4-twoPhases | R 4.6 m/s phase 0, D 6.0 m/s phase 0.4, 3 m apart | independent phases and rates; R's playback identical when run solo | duration |
| L1-F5-twoArm | G4-F3-twoArm-M requests | D's held arms identical to G4; R's carry arm swings | groundDown; R accepted 0.771, D accepted 1.242 |
| L1-F6-oneArm | G4-F3-oneArm-M requests | as F5 | groundDown; R accepted 0.704 |
| L1-F7-failed | G4-F3-failed-M requests | as F5 | groundDown; R accepted 0.900, D accepted 1.321 |

Before the first handoff, L1-F5..F7 are bit-identical to G4-F3-*-M in every physical trace field (position, centre of mass, velocity, drive, caps, yaw torque, arm forces, lean). After a handoff the candidate is built from the clip pose, so later falls differ, as plan 06 allows:
- L1-F5: D is accepted where G4-F3-twoArm-M rejects D (`externalPenetration` 30 mm).
- L1-F7: R is accepted at 0.900 where G4-F3-failed-M rejects R (102 mm, R's shoe in D's support), and the drill ends in groundDown instead of invalidHandoff.

These changed outcomes come from the new pose, not from a fix: the G4-M fixtures themselves are unchanged.

### Measured stance and residuals (`l1-probe.ts`, ticks at full clip weight; pass 2, shoe on the pitched frame)

| Fixture | Stance gap, lowest shoe point (min / median / max, m) | Leg residual (median / p90 / max, m) | Arm residuals (max, m) |
| --- | --- | --- | --- |
| L1-F1-fastRun | 0.016 / 0.027 / 0.045 | 0.03 / 0.10 / 0.132 | 0 |
| L1-F1-sprint | 0.005 / 0.020 / 0.066 | 0.02 / 0.08 / 0.098 | 0 |
| L1-F2-accelBrake | 0.012 / 0.024–0.029 / 0.046 | 0 / 0.04–0.06 / 0.132 | 0 |
| L1-F3-collision | 0.016 / 0.027–0.030 / 0.053 | 0.03 / 0.09–0.11 / 0.128 | 0 |
| L1-F4-twoPhases | 0.012 / 0.024–0.030 / 0.056 | 0.02 / 0.09–0.10 / 0.132 | 0 |
| L1-F5..F7 (R free arm in the tackle) | — | 0.01 / 0.09 / 0.114 | 0.944 |

How these columns are measured:
- **Stance gap:** height of the lowest shoe corner during the clip's stance interval. No stance tick penetrates the floor. The gap is the stance target being out of reach (next section, item 1).
- **Residuals:** distance from the sampled request (after foot IK) to the achieved limb.

Contact slip is no longer a useful number: the shoe rarely comes within the probe's 1 cm because of the stance gap.

Pass 1 numbers, for comparison (rigid shoe, lift): stance gap median −0.001, p90 0.02–0.09, max 0.106; slip median 0.6–1.2 m/s; free-arm residual in sprint p90 0.15.


## Tests (`tests/locomotion.test.ts`, 21; `tests/model.test.ts` +1)

1. The committed intake record reproduces from `models/animations` (manifest FBX hashes, analysis, policy).
2. The record stores identity, root-motion policy, nominal speed, playback bounds, half-open stance and phase zero (left stance starts at 0). Flight exists, and the rest pose matches the calibration.
3. Missing or invalid assets fail as `RunClipError`:
   - missing data;
   - missing joint;
   - NaN;
   - fps 0;
   - non-unit quaternion;
   - rotation count mismatch;
   - scale change;
   - open loop;
   - stale record.
4. Root travel and a 25° yaw added to the samples are removed: the working samples are identical (< 1e-9).
5. Loop seams are continuous (< 1e-5 at u = 1 − 1e-7 against u = 0). Sampling is deterministic and wraps, and the clips are deep-frozen.
6. Constant speed: phase rate = speed over stride, exact per substep. The playback rate bounds hold at 12 m/s and at low speed.
7. Slow, stopped or unsupported: the weight target is 0, the fade is bounded by the weight rate, and the phase stops at weight 0.
8. A hard speed change (6.8 → 5 m/s) crosses the clip blend at the bounded blend rate, never in one step.
9. Invalid profiles are rejected at simulation initialization: no clips, wrong order, inverted fade band, blend rate 0, leg scale.
10. L1-F1: the clip plays from the first tick, and each tick's phase step equals rate × tick ÷ cycle.
11. L1-F2: procedural at rest, weight 1 while running, back to 0 when stopped; the weight change per tick is bounded.
12. L1-F3: the playback rate follows the actual (reduced) speed, not the request.
13. L1-F4: phases and rates are independent, and a solo run gives identical playback rows.
14. The held arms (every ArmSystem phase) are identical to the clip-free run. Free arms and the carry arm move, and the rule ball equals the carry palm every tick.
15. No pops (defect detector): in L1-F1 (both), L1-F2 and L1-F4, no body-local knee, ankle, shoe, elbow or palm has a per-tick second difference above twice the largest of the clip request's own.
16. The shoe landmark is on the pitched shoe frame in supported and ragdoll poses; the shoe pitches while running; after R's handoff in L1-F5 the pitch stays at the candidate's.
17. Render rate (30 against 144 Hz) gives an identical trace. Reset mid-run reproduces the trace.
18. Every L1 fixture keeps finite landmarks and fixed thigh, shin and upper-arm lengths each tick. Flight is visible: both shoes up at full clip weight.
19. Physics before the first handoff is identical to G4-F3-*-M (all physical trace fields).
20. Every L1 handoff is accepted with a passing audit or rejected with reasons. No `transferFailed`, `invalidTransfer` or `numericalFailure`.
21. The export carries the profile identity (clip identities, no frames), and the trace carries a per-player `run` row. Clip-free fixtures add nothing.
22. (model) An ankle pitch turns the model's Foot bone about the calibrated ankle by that angle about the shin hinge axis, toe down for positive pitch; the shin, thigh and the other leg are unchanged.

## Baseline (reproduced, unchanged)

`npm run fixtures` reproduces the G4-M results recorded in `gate4.md`:
- **Three G4-M fixtures with rejected handoffs:**
  - G4-F3-twoArm-M: D rejected at 1.125 s, `externalPenetration`.
  - G4-F3-failed-M: R rejected at 0.900 s, ends in `invalidHandoff` (the changed failed-tackle outcome).
  - G4-F10-simultaneous-M: D and R rejected at 1.2 s.
- **G4-F11-sidelineFoot-M** ends `sidelineOut` (the shoe that starts out of bounds).

The 113 Gate 1–4 and model tests pass unchanged. Supported limb overlaps and clamp churn are not affected by this work: the arm and clamp paths are untouched.

## Visual review (Chrome, lab on 5197, this session)

Stills (no continuous watching):
- **1× side view of L1-F1-fastRun:** 9 stills across about two cycles, t 0.80–1.27 s. The legs run a recognisable cycle: a planted stance foot under the body, toe-off behind, knee drive, and a flight frame with both feet up. The shoes sit on the turf in stance.
- **1× oblique view of L1-F1-fastRun:** 4 stills. The free (left) arm swings from beside the hip to a raised forward position. The carry arm holds the ball high in front of the chest, as before.
- **L1-F1-sprint:** stills at 1× side and oblique.
- **0.25× live playback:**
  - L1-F2 acceleration: the info line shows the weight ramp and the clip label changing.
  - L1-F2 braking: the stride collapses to the procedural stand within about 0.3 s, with no visible jump between samples.
  - L1-F5-twoArm through R's handoff and the ground ending, from the oblique view: no jump at the switch.

Not done: continuous normal-speed watching, a front view of the stance, and close-ups of the foot.

Pass 2 (agents' Chrome, 1× side view of L1-F1-fastRun, 4 stills): the planted foot is flat on its sole, the trailing shoe points toe down, the ball sits in the carry hand, and the free arm swings. There were no console errors. Smoothness is judged from the numbers above, not from watching.

## Unresolved artifacts and limits

1. **Upright core, no pelvis bob; the stance foot hovers 1–5 cm.**
   - The plan keeps the core authoritative, so there is no sampled torso lean or bob. The sprint looks upright.
   - The hips sit about 7 cm above the clip's stance hips. Through stance the foot-IK target is 0.88–0.99 m from the hip, but the leg reaches 0.875 m. The stance shoe therefore stays 1.6–4.5 cm above the turf (median 2.7 cm, Fast Run). Leg residual p90 is 0.08–0.10 m.
   - Only a lower hip (or a sliding foot) removes this. See decision 6.
2. **Ankle in the pose, locked in the ragdoll.**
   - Supported players pitch the shoe at the ankle. Ragdolls keep the pitch they had at handoff: there is still no ankle joint body.
   - Procedural legs keep the rigid shoe (pitch 0), so G1–G4 evidence is unchanged.
3. **The Sprint arm swing crosses the bew-v6 torso proxy** at phases about 0.39–0.53 and 0.95–1.0 (self overlap about 9 cm).
   - Pass 2 plays it as the clip asks: overlap with the player's own torso is visual only (the ragdoll disables same-owner self-collision), so the swing is no longer pushed off its path. A visible arm-through-jersey moment in sprint is possible.
4. **The runner's free arm in tackles** leaves the clip swing whenever the swing would cross the defender. This is clearance precedence; the residual reaches 0.94 m.
   - It switches between `ARM_ALTS` variants in a tick (pops of 0.5–1.1 m/tick² in L1-F5/F6 at 0.58–0.75 s; L1-F3 R's leg 0.40 at 0.83 s).
   - The same pops are in the clip-free G4-F3-*-M (identical left-palm spikes): they come from contact-time limb avoidance, not the clips. Making that continuous is contact behaviour, not part of this pass.
5. **Procedural fallback below 3.2 m/s, beyond 30–60° heading offset, airborne and falling.**
   - Lateral and backward running have no clip.
   - The procedural gait's known issues stay visible in those ranges.
6. **Pre-existing, observed during probing and not changed:**
   - The procedural legs step backwards relative to travel (moonwalk).
   - The model's procedural carry and free arms sit on `ARM_ALTS` index 2 in G3-F1-M; the clip swing now replaces the free arm while running.
   - The standing procedural ankle target is 0.19 m above the floor.
7. **Within one tick, the phase advances per substep from that substep's speed.** The trace reports the last substep's rate, so the per-tick check allows 2e-4.
8. **The clip's chest frame drives only the arm directions.** The clip's head, spine twist and hand rotations are not used.

## Decisions (technical; open to the user)

1. **The weight band starts at 0.55× the Fast Run nominal speed and is full at 0.70×** (the minimum playback rate). Below it, the procedural gait.
   - Alternatives: (a) a lower band, which plays the clip slower than 0.7× and slides the planted foot; (b) a walk/jog clip if one is supplied.
2. **Above Sprint's nominal speed (6.24 m/s), Sprint plays at a rate up to 1.3.** L1-F1-sprint uses a labelled motor with a 6.8 m/s request ceiling to reach 6.6 m/s; the default motor caps at 6.0.
3. **Foot IK targets the clip's own planted point,** which stays still in the world when the rate matches the speed. It is not a world-locked foot plant: a clamped rate (below 0.7 or above 1.3) still slides.
   - Alternative: lock the contact point in the world at touchdown and release at liftoff.
4. **Free-arm swing clearance:** a continuous radial push against other bodies only (≤ 0.30 m), then the existing alternatives. Own-torso overlap is allowed.
   - Alternative: also push off the own torso (smoother than pass 1's search, but the sprint swing then leaves the clip path).
5. **Clips are baked JSON imported at build time,** decoded headless. The GLB animation tracks are not used. `RigAdapter` now drives the Foot bones from the shoe frame; nothing else in it or `player-model.ts` changed.
6. **Stance hover (unresolved item 1).** Options, for the user:
   - (a) Lower the drawn pelvis while the clip plays (standard foot-IK pelvis offset). The physical proxy stays where it is. The pose's core then no longer equals the proxy: this changes the "core authoritative" contract.
   - (b) Lower the physical proxy's ride height while running. This is a physics change.
   - (c) Keep the hover.
7. **Carry look:** hold position `CLIP_CARRY` and swing share `carrySwing` 0.6 are first choices, not tuned. A live slider editor with copyable values can be added for these if the user wants to set them.
8. **Ankle range** 30° up / 50° down, and **blend rate** 2/s, are standard values, not tuned.

## Files

- New:
  - `src/sim/run-clip.ts`
  - `src/sim/model/run-clips.ts`
  - `src/sim/model/run-clips.record.json`
  - `src/sim/fixtures/locomotion.ts`
  - `scripts/model/clip-intake.ts`
  - `scripts/intake-clips.ts`
  - `tests/locomotion.test.ts`
  - probes `scripts/probe/l1-*.ts`
- Changed:
  - `src/sim/pose.ts`: sampled branch, foot IK, swing clearance, residuals; pass 2: continuous leg solve, ankle pitch (`anklePitchDeg`, `footFrame`, `pitchShin`), carry swing, radial clearance.
  - `src/sim/ragdoll.ts`: shoe collider and landmark at the pose's ankle pitch; `Ragdoll.anklePitchDeg`, published by `ragdollPose`.
  - `src/sim/rules.ts`, `src/sim/profiles.ts`: `RuleProfile.ballSource` (`carryPalm` for L1).
  - `src/lab/views.ts` (primitive shoe on the shoe frame), `src/lab/rig-adapter.ts` (Foot bones).
  - `src/sim/simulation.ts`: playback state, update, trace, export, validation.
  - `src/sim/fixture.ts`: `runClips`, `initial.runPhase`.
  - `src/sim/fixtures/index.ts`.
  - `src/lab/main.ts`: `run` info line, the L1 group, the ball at the carry palm, ankle pitch interpolation.
  - `tests/model.test.ts`: the Foot-bone pitch test.
  - New in pass 3: `src/lab/follow.ts`, `tests/lab-render.test.ts`, `scripts/probe/l1-render.ts`.
  - `package.json`: `intake-clips`.
