# Contact motion M2: the carrier's brace (rough-first slice)

Plan: [02-carrier-brace](../open/contact-motion/02-carrier-brace.md), rough-first slice steps 1 to 3, on branch
`prereq-ladder`: `6430eea` the decision (flag off), `a091547` the pose (flag off), `7ca0c08` the samples the flip moves
restated ahead of it, `1897908` the flip on L3, L4 and HC carriers. Follow-up (below, "Ruled down, and the lean in
time"): `e0838e3` / `138bd85` the referee's balanced clear (flag off, flip), `6adab8f` / `c514d53` the lean in time
(`CARRIER_BRACE_V2`, flag off, flip), then the tracked defects' tests.

Reference: `../football-sim-6` now holds only a `.vite/` cache. Its sources (`src/logic/brace.ts`,
`src/anim/ballCarry.ts`) are missing, so the brace follows the milestone file's description of them (0.45 s / 0.65 s /
0.2 m seeds, hips 5 cm, trunk about 17 deg, carry high and tight, free palm on the ball), not their code.

## What the carrier does

A carrier who sees a defender closing, with contact predicted within 0.45 s, braces:
- knees bend and the hips drop 5 cm;
- the chest comes a few degrees forward;
- the ball arm closes to the ribs, elbow down, ball high under the pec;
- the free forearm comes across the chest with its palm on the ball;
- the ball arm's swing drops to a quarter.

The weight ramps in over about 0.2 s. It holds while the same defender keeps coming or is engaged, and ramps out when he
misses, moves away (`opening`, about 0.26 s after a glancing hit), or the carrier starts to fall. No brace for a defender
behind (outside 70 deg of his facing), one hidden behind another player, one passing wide, or nobody near. A ragdoll
carrier has no proxy pose, so nothing of the brace carries into the fall.

## Flag, lab and code

- `FixtureDef.brace` = `CARRIER_BRACE_V2` (`src/sim/brace.ts`; V1 with the lean rate and the reached-lean hold). Registered on every L3, L4 and HC fixture with
  locomotion composition and a ball carrier (`src/sim/fixtures/index.ts` `braceFlip`, 128 fixtures); G, L1, L2 and RH
  unchanged.
- Lab `brace=on|v1|off`: `v1` is the brace before the lean flip, `off` the view before the brace. Lab `balclear=on|off`:
  `off` is the referee before the balanced clear. `tests/runs.ts` `preBraceV2`, `preBalancedClear` and `preBrace` give a
  definition as before each flip (the head of `BEFORE_FLIPS`).
- Decision: `stepBrace`, from the carrier's observed snapshot (his controller's delay), in `Simulation.advanceBrace`. It
  emits `brace` events with reason `seen`, `miss`, `opening`, `far`, `gone` or `inactive`, and their bearing and
  predicted contact.
- Pose:
  - `bracePosture` sets the trunk lean;
  - `composeTarget`'s drop lowers the support;
  - `pose.ts` sets the carry key and the free-arm cover;
  - `carry.ts` quietens the swing.
- Tests: `tests/brace.test.ts`. Each case has its fault twin (`BraceDebug`, `PoseDebug`). A braced capture resumes
  without the profile.

## Values and why

| value | setting | why |
| --- | --- | --- |
| acquire | predicted contact within 0.45 s | sim-6 seed. The milestone's 0.15-0.3 s leaves the pose no time to form before a 7 m/s defender arrives. |
| hold | 0.65 s, or engaged (touching, or within the contact distance + 0.1 m) | sim-6 seed. The hysteresis stops the brace flickering. |
| contact distance | both torso half widths + 0.2 m | sim-6 margin |
| field of view | 70 deg half angle from his achieved body facing | rough start. A defender 104 deg off his facing (HC-F1, L3-F10) is unseen. |
| closing | at least 0.5 m/s | a standing or drifting opponent is no threat |
| occluder | within 0.3 m of the sight line | a player in between hides the defender |
| ramp | critically damped, 20 rad/s (weight 0.9 at 0.2 s) | the ball moves no further in one tick than in the run |
| hip drop | 5 cm at full weight | sim-6 |
| trunk lean | 12 deg requested (the balance profile's bound), at up to 60 deg/s, the reached lean held | about 9.5 deg at contact (below) |
| carry key | elbow down at the ribs; ball 2 cm higher and 3 cm nearer the chest than in the run | reads "high and tight" on the L3 model |
| swing kept | 0.25 | the ball moves 8 cm over a stride, against 26 cm in the run |
| cover | free palm at the ball's inner front, 3 cm gap; elbow low and out front | further in, the 10 cm upper arm passes through the chest |

## Measured at the flip

Full check `.scratch/m2/s3-flip2` against the step before (`s3i-tests`). Suite 429/429. G, L1, L2 and RH are
byte-identical; summaries changed on L3 23, L4 6 and HC 8. Gross scan: `.scratch/m2/gross.ts`, every L3, L4 and HC
run, both orders.

| | before | after |
| --- | --- | --- |
| rigid falling figures (rejected conversions) | 6 | 6 |
| rejected or deferred handoffs added | | none |
| conversions before contact; braced runs without contact | | none |
| worst shape-query tick (limit 4000) | 3983 | 3048 |
| carrier hand in own body; head | 0.35 s; 0 | 0.35 s; 0 |
| supported shoulder or elbow snaps | 0 | 0 |
| one-tick jumps over 20 cm (frames over 5 cm) | 4 (54476) | 4 (50790) |
| carrier arm inside another player past 5 cm / past 10 cm / axis inside | 28.65 / 6.67 / 4.77 s | 20.37 / 0.45 / 0.78 s |
| defender wrap upper arm in own trunk | 1.77 s | 8.65 s |
| ragdoll bodies at 9 m/s or faster (run-players) | 25 | 40 |
| passive energy L3 / L4 / HC (largest) | 859 (119) / 602 (86) / 687 (60) J | 1150 (210) / 375 (20) / 721 (60) J |
| visible snaps: supported / ragdoll | 0 / 0 | 2 / 2 |

- **Braced arms reduced arm problems.** The carrier's arm inside the defender past 10 cm fell from 6.67 s to 0.45 s.
- **Contact is harder.** The peak contact impulse of a head-on hit about doubles, for example HC-F3-phase0 106 to 215 Ns.
- **Why the breaches rose.** They are mechanisms that exist without the brace, reached because trajectories moved:
  - Ragdolls now spend more time on screen (L3 155 to 243 s, L4 388 to 460 s), because runs that ended `groundDown`
    now run to the time limit with the bodies lying. Their deep own-body overlap (armArm 6.4 to 48.8 s, armTrunk 101 to
    182 s) and shoulder-twist seconds (42.8 to 87.1 s) rise with that time.
  - The defender's left forearm reaches 13 m/s in the falling families (HC-F3, L3-F1, L3-F9, L4-F9 `-falling`). A twin
    from tick 50 is identical with the brace and without it.
  - The defender's right hip snaps at 0.783 s in L3-F1-phase4 and HC-F3-phase50, reversed order. A twin from 0.75 s
    gives 65.0 deg with the brace and 64.2 without.
  - The defender's right shoulder, ragdoll, snaps at 1.217 s in L4-F9-defenderRising and L4-F5-oneClamp-on; the carry
    forearm pinches in L3-F1-phase3 R, 210 J at 1.17 s; the defender's wrap upper arm stays in his own trunk longer.
  - All five are now tracked defects with capture twins (Known issues).

## Ruled down, and the lean in time

**Ruled down.** After the braced carrier is hit, he keeps his feet and his line for a while as he topples (lean 5 to 30
deg, rising at 1 to 2 rad/s). The referee counted that as "free" movement, so the defensive influence cleared 0.2 s
later. His fall a moment afterwards then landed with no influence, and the play ran to `duration`. Gate 4 section 12
clears the influence after 0.2 s of regained supported *balance*, so the rule now reads balance:
- `RuleProfile.balancedClear`: a free substep also needs his lean, projected ahead, under the lean where the recovery
  envelope starts to judge a loss (`BalanceProfile.minLeanRad`, 25 deg).
- Registered on every L3, L4 and HC football referee.
- In every L3, L4 and HC run, with and without the brace, each clear was followed by a loss of support within 0.6 s, so no
  clear was a real recovery. Running carriers project at most 6.5 deg; toppling ones 31 to 48 deg.
- Tests: `tests/rules-balance.test.ts` (constructed frames and a capture twin).
- At the flip (`f-balclear2`), all 11 fixtures that ended `duration` end `groundDown` again, and so do the 7 that ended
  `practiceOutOfBounds` with an upright defender (HC-F3-mirror, HC-F3-phase75, L3-F1-mirror0, L3-F1-phase1, 2, 5 and 6,
  L3-F4-oneArm).
- Nobody falls differently. Lab: `?fixture=L3-F1-falling&cam=side&speed=0.25&t=1.0`, `&balclear=off` for before.

**The lean in time.** V1 reached about 2.4 deg at contact (median, -0.3 to 3.0, over 37 braced runs with contact).
- Cause: the posture's gravity hold is computed for the *desired* lean, and is full while the body is still near
  upright. It cancels most of the stiffness, leaving about 209 N m/rad against 220 N m s/rad of damping, a time constant
  of about 1 s. On top of that, the desired lean moves at only 30 deg/s.
- Not the cause: torque saturation and the support cap.
- `CARRIER_BRACE_V2`:
  - `leanRateDegPerS` 60: the braced posture moves at 60 deg/s;
  - `leanHold: 'reached'`: while short of the desired lean, the hold is for the lean the body has reached.
- Result: 7.6 to 10.8 deg at contact (median 9.5), and no carrier loses support before contact.
- Test: `tests/brace.test.ts` "V2", head-on hits in L3-F3-collision, L3-F1-phase0 and HC-F3-phase0, with the V1 twin.
- Lab: `?fixture=L3-F3-collision&cam=side&speed=0.25&t=0.45`; `&brace=v1` for V1, `&brace=off` for no brace.

The lean flip (`f-lean2b` against `f-lean1`): suite 436/436, G, L1, L2 and RH byte-identical; summaries changed L3 23,
L4 6, HC 8. Hits are firmer and both players go down sooner (conversions mostly 0.80-0.86 s, were 1.3-1.6 s). Who
falls, time a fall starts (before the brace / V1 / V2, forward and reversed order):

| fixture | player | forward | reversed | result now |
| --- | --- | --- | --- | --- |
| HC-F3-mirror | defender | up / up / 0.84 | 1.75 / up / 0.85 | groundDown |
| HC-F3-phase0 | defender | up / up / 0.83 | 1.55 / up / 0.80 | groundDown |
| HC-F3-phase75 | defender | 1.35 / up / 0.83 | 1.46 / up / 0.84 | groundDown |
| HC-F5-strictTransfer | defender | 1.30 / up / 0.80 | 1.30 / up / 0.82 | invalidTransfer |
| L3-F1-mirror0, phase1, 2, 5, 6 | defender | fell / up / 0.80-0.86 | fell / up / 0.82-0.86 | groundDown |
| L3-F1-phase0 | defender | up / up / 0.83 | up / up / 0.80 | groundDown |
| L3-F4-oneArm | defender | 1.41 / up / 0.80 | 1.30 / up / 0.82 | groundDown |
| L3-F3-side | defender | up / up / 0.98 | up / up / 0.97 | practiceOutOfBounds -> duration (no referee) |
| L3-F3-sideMirror | defender | up / up / 0.88 | up / up / 0.94 | practiceOutOfBounds -> duration (no referee) |
| L3-F3-collision | carrier | 0.78 / 0.86 / up | 0.78 / 0.90 / up | duration |
| L3-F5-drag | defender | up / 1.95 / 1.37 | up / up / 1.39 | groundDown |
| L3-F5-dragMirror | carrier | up / up / 0.82 | up / up / 0.83 | practiceOutOfBounds -> groundDown |

- Most defenders that V1 kept up fall again, as before the brace, but sooner.
- New falls: the HC-F3-phase0 and L3-F1-phase0 defenders forward, the L3-F3 side-hit defenders, and the L3-F5-dragMirror
  carrier.
- The head-on L3-F3-collision carrier now stays up.
- Lab: each `?fixture=<id>&cam=front&speed=0.25&t=0.7`, with `&brace=v1` for V1.

Other measures at the lean flip:
- Passive energy: L3 largest 210 J -> 166 J (the L3-F1-low carry pinch).
- Ragdoll snaps 2 -> 4, and no supported snaps (tracked defects b and e).
- Shape queries: worst 3048.
- Restated ahead of the flip as natural samples taken before it (`preBraceV2`): gate 4 E1 (L3-F1-mirror0), the
  referee-ending request stop (L3-F1-phase0), and the L3-F9 labelled conversions. L3-F9-defenderRising's D now loses
  support at 0.796 s, before his label. The pass now checks that every such conversion is accepted with none rejected,
  whatever starts it; the labelled reason is the sample.

**L3 landings floor.** The landing check's coverage floor is now by kind (the ladder 14a rule), not by count: over its
four fixtures, a carrier's landing and a defender's landing are both checked (`LANDING_SEEN`, with its constructed
twin).
- It was more than one landing in each fixture. The brace flip had cut it to at least one, which lowered a number.
- Under V2 neither L3-F3 side-hit run lands a step before both players are down. The 9 landings that remain (carrier 5,
  defender 4) all pass.

## Who falls (the brace flip)

The comparison is with the step before; a time is when the fall starts. Open each link on the lab (port 5180); add
`&brace=off` for the run before.

| fixture | order | player | before | now | result before -> now | lab |
| --- | --- | --- | --- | --- | --- | --- |
| HC-F3-lowRunner | both | defender | stays up | falls 1.25 / 1.27 s | groundDown | `?fixture=HC-F3-lowRunner&cam=front&speed=0.25&t=1.10` |
| HC-F3-mirror | reversed | defender | falls 1.75 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=HC-F3-mirror&order=rev&cam=front&speed=0.25&t=1.60` |
| HC-F3-phase0 | reversed | defender | falls 1.55 s | stays up | groundDown | `?fixture=HC-F3-phase0&order=rev&cam=front&speed=0.25&t=1.40` |
| HC-F3-phase75 | both | defender | falls 1.35 / 1.46 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=HC-F3-phase75&cam=front&speed=0.25&t=1.20` |
| HC-F5-strictTransfer | both | defender | falls 1.30 / 1.30 s | stays up | invalidTransfer | `?fixture=HC-F5-strictTransfer&cam=front&speed=0.25&t=1.15` |
| L3-F1-low | both | defender | stays up | falls 1.26 / 1.25 s | groundDown | `?fixture=L3-F1-low&cam=front&speed=0.25&t=1.11` |
| L3-F1-mirror0 | both | defender | falls 1.39 / 1.45 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F1-mirror0&cam=front&speed=0.25&t=1.24` |
| L3-F1-phase1 | both | defender | falls 1.39 / 1.38 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F1-phase1&cam=front&speed=0.25&t=1.24` |
| L3-F1-phase2 | both | defender | falls 1.41 / 1.30 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F1-phase2&cam=front&speed=0.25&t=1.26` |
| L3-F1-phase5 | both | defender | falls 1.64 / 1.58 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F1-phase5&cam=front&speed=0.25&t=1.49` |
| L3-F1-phase6 | both | defender | falls 1.37 / 1.46 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F1-phase6&cam=front&speed=0.25&t=1.22` |
| L3-F1-phase7 | both | defender | stays up | falls 1.33 / 1.58 s | groundDown | `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.18` |
| L3-F4-oneArm | both | defender | falls 1.41 / 1.30 s | stays up | groundDown -> practiceOutOfBounds | `?fixture=L3-F4-oneArm&cam=front&speed=0.25&t=1.26` |
| L3-F5-drag | forward | defender | stays up | falls 1.95 s | practiceOutOfBounds -> groundDown | `?fixture=L3-F5-drag&cam=front&speed=0.25&t=1.80` |
| L3-F5-drag | both | carrier | stays up | falls 1.38 / 1.92 s | practiceOutOfBounds -> groundDown | `?fixture=L3-F5-drag&cam=front&speed=0.25&t=1.23` |

In total, 18 defender player-runs now stay up that fell, and 7 now fall that stayed up. The carrier in L3-F5-drag now
falls in both orders; that is the fixture whose leg nearest the wrapping defender moves oddly, and its outcome is what
the brace changes there.

Eleven fixtures fall as before but end on `duration` instead of `groundDown`: HC-F3-falling, HC-F3-rising,
L3-F1-falling, L3-F1-rising, L3-F10-defender, L3-F9-defenderFalling, L3-F9-defenderRising, L4-F5-oneClamp-off,
L4-F5-oneClamp-on, L4-F9-defenderFalling and L4-F9-defenderRising. The balanced clear rules them down again ("Ruled
down" above).

## Known issues

- **HC has no drawn ball.** The cover palm goes to a ball seated on the hold's forearm at `holdBallRadiusM`.
- **The cover arm is not checked against bodies.** Like the carry arm, the braced free arm keeps its pose when another
  body meets it (`pose.ts`, the first candidate taken). The final pass does not check the upper arm, so it can press
  into the defender at contact.
- **Nothing carries over at conversion.** The weight freezes once the carrier is a ragdoll. Carry-over and fall control
  are not in this slice.
- **Tracked defects reached, not caused** (`tests/brace-defects.test.ts`; each is pinned on a capture shortly before it
  and twinned there with the brace off; each test fails once its defect is gone from that state):

  | defect | capture | with brace / without | across L3, L4, HC (before brace / V1 / V2) |
  | --- | --- | --- | --- |
  | (a) `FAST_FOREARM`: falling defender's forearm whips | L3-F1-falling@40 (V1, 0.667 s, carrier still braced) | 12.80 / 12.79 m/s | player-runs at 9 m/s or more 25 / 40 / 36 |
  | (b) `HIP_SNAP`: supported defender's right hip, one tick | L3-F1-phase4~bracev1-rev@45 (0.750 s, braced) | 65.0 / 64.2 rad/s | supported snaps 0 / 2 / 0 |
  | (c) `UPPER_ARM_IN_TRUNK`: wrap upper arm in own trunk (13c `upperArm` parked) | L3-F1-phase5@42 (0.700 s, braced) | 9 ticks, 2.3 / 9 ticks, 1.7 cm | 0.55 / 6.5 / 0.8 player-s |
  | (d) `CARRY_PINCH`: ragdoll carry forearm pinched on the ground | L3-F1-low~rev@64 (1.067 s) | 165.9 / 165.9 J | carrier pinches over 5 J 6 / 8 / 7; largest 86 / 210 / 166 J |
  | (e) `RAGDOLL_SHOULDER_SNAP`: upper arm on the ground spun about its axis by the forearm | L4-F9-defenderFalling@65 (1.083 s) | 94.5 / 94.5 rad/s | ragdoll snaps 0 / 2 / 4 (earlier rungs had them, e.g. 8c) |

  - None is introduced or made worse by the brace, so none blocks.
  - (c) is deeper with the braced carrier pressing on the wrap, but it lasts the same ticks and is there without him.
  - (d) and (e) come after the carrier has converted. From before his conversion, the run without the brace takes another
    path and does not reach them: they are reached by a moved trajectory.
  - Each needs its own fix step.
- **No near miss in the fixtures.** The fixtures have no case where the brace starts and is then released on a miss: the
  only releases are `opening` after a glancing hit. The miss release is covered by a constructed case in
  `tests/brace.test.ts`.
