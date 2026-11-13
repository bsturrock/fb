# Contact motion M3: the wrap, the committed finish and the hold through it (rough-first slice)

Plan: [03-wrap-and-finish](../open/contact-motion/03-wrap-and-finish.md), rough-first slice, on branch `prereq-ladder`:
`02fa1b8` the slice, `23551d8` open and close (flag off), `aea0caa` its flip, `01f9dfb` the committed finish (flag
off), `51a7f4b` its flip, `e886c0f` the hold through the takedown (flag off), `a02a5fc` its flip.

## What the defender does

A tackling defender (a `wrapAttempt` controller that pursues to the end) on L3, L4 and HC:
- **Carries** his hands 20 cm ahead of his chest while the carrier is far.
- **Opens a cradle** once contact is 0.25 s away (or the gap is under 0.5 m): palms 35 cm ahead of the chest and 12 cm
  outside the carrier's torso, elbows bent and out. Back to the carriage when both distances more than double (a miss
  going by).
- **Closes on the first valid touch** (palm or forearm on the carrier at or past the torso's near corner, or the bodies
  meeting with the hand there), toward the far corner of the carrier's torso (150 deg, 5 cm in), which draws the forearms
  along the flanks so the clamps form.
- **Commits with a secure hold.** Both arms retaining (a clamp or a grip) and touching the carrier for 50 ms: he lowers
  to 0.78 m and leans in 12 deg for 0.2 s while he drives, then asks to leave support. The simulation converts him
  through the validated, audited path with reason `takedown`. If the carrier he holds securely loses his support first,
  he follows at the next substep.
- **Keeps his hold while he goes down.** At the takedown his forearm holds carry onto his ragdoll arms: they keep
  their shape and press his forearms into the carrier where the clamps held, under a bounded arm drive. In the front
  wrap his arms stay on the carrier for about half a second after he leaves his feet (0.48 and 0.65 s; 0.42 and 0.51 s
  reversed), the bodies stay together as they go down, and the carrier falls over him. In the forward rear wrap they
  hold 0.37 s as he slides down the carrier's back; the carrier still runs on. When a hold lapses the arm reaches for
  the ground (or goes limp once his trunk is down).
- **Does not commit on less.** A one-arm hold, a miss, or a hold broken for more than 50 ms never takes him down; a
  broken hold during the lowering stands him back up and he pursues. The carrier is never converted by the finish: his
  own balance decides.

Before: the Gate 2 progression. His hands hung at the carrier's sides as they met (at 0.3 m gap the palms were a
median 3 cm inside his silhouette, as far as 22 cm), an arm closed on an arc threshold up to 0.78 s after its touch,
and he stayed on his feet over the carrier until a later trip.

## Flags, lab and code

- `FixtureDef.wrap` = `WRAP_V3` (`src/sim/controllers/wrap.ts`). Registered on every L3, L4 and HC fixture with a
  tackling defender (`src/sim/fixtures/index.ts` `wrapFlip`). G, L1, L2 and RH unchanged.
- Not registered on a defender who stops to stand in a hold (`standAfterS`, the L3-F6 stationary holds): their wrap and
  hold settle check (`HOLD_SETTLES`, the plan 13e known limit) is about a standing hold, and under the cradle its free
  gap is 0.21 m against 0.05.
- Lab `wrap=on|v2|v1|off`: `on` is `WRAP_V3`, `v2` the takedown with his arms let go at it (before the hold flip),
  `v1` the cradle without the committed finish (before its flip), `off` the Gate 2 progression (before M3).
  `tests/runs.ts` `preWrapV3`, `preWrapV2` and `preWrap` give a definition as before each flip (the head of
  `BEFORE_FLIPS`).
- Code:
  - `WrapProfile.ready`, `open`, `closeOnTouch`, `close`: the cradle and the close (requests only; every acquisition
    guard, the shared arm budget and the break rules stay).
  - `WrapProfile.commit`: the hold clock and the lowering in the finish branch of `WrapAttemptController.decide`. It
    reads the arm observation (retention and `touchingTarget`), never the observational wrap status (Gate 3's rule).
  - `PlayerIntent.leaveSupport: 'takedown'`; `Simulation` stage 1 converts on it (`HandoffRecord.reason` `takedown`),
    only under a profile with a commit and never after the referee's ending.
  - `WrapProfile.commit.hold` (`FALL_HOLD_V1`, `src/sim/profiles.ts`): the plan 09 fall response a takedown starts on
    a fixture without one of its own (`conversion.ts` `takedownHold`; no other conversion starts it). Why L3 and HC
    lacked the transfer: the fall response, and with it the arm system's forearm-hold memory (`holdMemoryS`), was built
    only for a fixture with its own fall response, which needs a hip envelope; their ragdolls have a shoulder envelope
    only, and the wrap's holds are forearm clamps, which end at the owner's switch. Palm grips carry as passive links
    everywhere, unchanged. The build refuses a hold that drives a ball joint its ragdoll has no envelope for.
  - The press (`FallResponseProfile.arms.holdPressN`, `ArmSystem.pressTarget`): a forearm hold carried from a clamp
    keeps that clamp's patch on the carrier's body; the hold task adds the joint torques (r x F at the shoulder and
    elbow) of pushing the forearm, at the clamp's parameter, into it along its normal. Same ceilings, power and work
    caps, impact guard and shared falling budget as every arm torque; the hold still lives only while solved contact
    renews it (0.1 s memory) and lapses into a brace. No virtual force acts after the switch.
  - L4 runs its own fall response (`FALL_L4`) for every conversion, takedowns included, as before: the flip leaves L4
    runs unchanged.
- Tests: `tests/wrap-open.test.ts` (the cradle, the close), `tests/wrap-takedown.test.ts` (the finish),
  `tests/wrap-hold.test.ts` (the hold through it), each case with its fault twin; `tests/wrap-defects.test.ts` (tracked defects).

## Values and why

| value | setting | why |
| --- | --- | --- |
| carriage | palms 0.2 m ahead, 0.2 m off the centre line | hands up and in front, ready to open |
| open lead | 0.25 s ahead of predicted contact, or gap under 0.5 m | the arm reaches the cradle in about 0.2 s at the measured closing speeds |
| cradle | palms 0.35 m ahead of the chest, 0.12 m outside the carrier's half width | wider than the carrier with the elbows bent; further out, the hands go behind the target |
| close on touch | slack 0 deg (at or past the near corner) | the first valid touch closes at once |
| close target | 150 deg on the ring, 5 cm in | the Gate 2 125 deg, 10 cm in, leaves the palm on the flank and the forearm off it (no clamp in L3-F19-rear) |
| secure | both arms retaining and touching the carrier for 0.05 s | past a clamp's flicker (twelve substeps) |
| lowering | 0.2 s, stance 0.78 m (11 cm down), lean 12 deg | the stance at its 0.6 m/s rate; 12 deg is the balance profile's cap |
| grace | a hold lost for over 0.05 s starts over | a broken hold or a miss never commits |
| follow | at once when the held carrier is off his support | he goes down with the carrier, not after a later trip |
| hold drive | FALL_L4's arm tasks; no reaction delay (20 ms ramp) | the takedown is his own committed fall and the arms were already holding; FALL_L4's 40 ms delay and 80 ms ramp leave the drive near zero for the hold memory's whole 0.1 s, and every hold lapsed at exactly 0.1 s |
| hold strength | holdScale 1; shoulder 30, elbow 20 N m | 15 N m does not hold a horizontal arm up; both arms at these ceilings ask 290 N of the 350 N falling owner budget |
| press | 100 N into the clamp's patch | the clamp's closing force carried on. Pressing at the solved touch instead did little (a palm 1 mm off has no contact record), and no press lapsed within 0.1 to 0.3 s |
| knees, hips | no effort | how he lands is M4's |

## Measured

Full checks `.scratch/m3/<step>/`, each against the step before: `s1-open`, `s2-flip-b`, `s3-commit-b`, `s4-flip-b`.
At the end: suite 451/451; G, L1, L2 and RH byte-identical at every step. Arm measures: `.scratch/m3/wrapm.ts` over the
53 flipped wrap fixtures, both orders (`fin/`). Gross scan: `.scratch/m3/gross.ts`, the 56 wrap fixtures, both orders,
supported arms per drawn frame (`g2/A` before M3, `g5/B` now).

| | before M3 (`wrap=off`) | cradle (`wrap=v1`) | now (`wrap=on`) |
| --- | --- | --- | --- |
| palm outside the carrier's torso at 0.3 m gap, median (min to max) | -3.2 cm (-21.9 to 2.8) | 12.0 cm (10.2 to 13.5) | 12.0 cm (10.2 to 13.5) |
| touch to retention, the slower arm, median (max) | 12 ms (779 ms; L3-F4-twoArm 225 ms) | 0 (12 ms) | 0 (12 ms) |
| L3-F4-twoArm support loss, carrier / defender | 0.63 / 1.08 s | 0.74 / 0.94 s | 0.74 / 0.94 s |
| L3-F19-front support loss, carrier / defender | neither | neither | 1.10 (1.15 reversed) / 0.74 s |
| L4-F9-transferFailed support loss, carrier / defender | 0.92 / 1.45 s | 0.88 / 1.38 s | 0.88 / 0.80 s |
| defender's hold after the takedown (arms; body touching) | | | L3: 0; 0.38 s front (0.20 reversed), 0.07 s rear |
| rejected conversions (rigid figures) | 4 (the labelled invalid ones) | 4 | 4 |
| supported shoulder or elbow snaps; one-tick jumps over 20 cm (frames over 5 cm) | 0; 0 (6200) | 0; 0 (4502) | 0; 0 (4623) |
| ragdoll snaps, L3 / L4 / HC | 2 / 2 / 2 | 0 / 0 / 0 | 0 / 2 / 0 |
| forearm or palm deep in own trunk; hand axis in own trunk or head | 0; 0 | 0; 0 | 0; 0 |
| upper-arm axis in own trunk (frames) | 50 | 104 | 104 |
| arm over 10 cm into another player (frames) | 0 | 34 | 34 |
| hand axis inside another player (frames) | 167 | 189 | 70 |
| worst shape-query tick (limit 4000) | 3048 (HC-F2-lift3.0) | 3433 (L3-F4-twoArm reversed) | 3197 (L3-F1-mirror4) |
| passive energy L3 / L4 / HC (largest solve) | 827 (166) / 335 (15) / 613 (60) J | 835 (48) / 361 (15) / 587 (60) J | 866 (48) / 442 (39) / 587 (60) J |

- The cradle is wider than the carrier in every approach (it was inside his silhouette in most), and both arms hold
  on the touch's substep (the side wrap's far arm took 225 ms).
- Takedowns happen only with both arms holding the carrier: L3-F19-front (both orders), L3-F19-rear (forward) and
  L4-F9-transferFailed (both). No ask without a two-arm hold; the miss, one-arm holds and the side wrap's slipping far
  arm never commit; the reversed rear wrap's hold breaks during the lowering and he stands back up. Each takedown
  passes the audit (momentum error under 1e-8; front 4.4 J against a 79 J allowance, rear 12.3 J against 615 J) except
  where the fixture's 1 % profile flags it, as before.
- The upper arm in own trunk rose with the cradle (M2 tracked defect `UPPER_ARM_IN_TRUNK`, reached more by defenders
  who now hold); the arm in another player is the carrier's (`CARRIER_ARM_IN_DEFENDER` below).

### The hold through the takedown

Full checks `.scratch/m3b/s1-hold-b` (flag off: every summary, trace and matrix byte-identical, suite 455/455) and
`s2-flip-b` (the flip, against s1: suite 455/455; only L3-F19-front and L3-F19-rear summaries change, same results and
end representations). Measures: `.scratch/m3b/hold.ts` (before `wrap=v2`, now `wrap=on`).

| | before (`wrap=v2`) | now |
| --- | --- | --- |
| front wrap: hold retained after his switch, left / right | 0 / 0 | 0.48 / 0.65 s (reversed 0.42 / 0.51 s) |
| front wrap: bodies in contact after his switch, unbroken (total) | 0.36 s (0.89 s); reversed to the end (1.59 s) | 0.86 s (1.11 s); reversed to the end (1.84 s) |
| front wrap: support loss, carrier / defender | 1.100 (1.150 reversed) / 0.742 s | 1.121 (1.087 reversed) / 0.742 s |
| rear wrap, forward: hold retained, left / right | 0 / 0 | 0.38 / 0.37 s |
| rear wrap, forward: bodies in contact, unbroken (total) | 0.07 s (0.25 s) | 0.38 s (0.43 s) |
| rear wrap, forward: support loss, carrier / defender | runs on / 0.904 s | runs on / 0.904 s |
| side wrap (L3-F4-twoArm): support loss, carrier / defender | 0.742 / 0.938 s | unchanged (no takedown: one-arm hold) |
| the hold's arm work (front, reversed, rear) | | 14.9, 23.9, 24.6 J of 100; no power over the cap |
| worst shape-query tick | 2122 (L3-F19-front) | 3574 (L3-F19-front; limit 4000) |
| rejected conversions, supported or ragdoll snaps, passive energy | | unchanged; no new injecting run, the largest gain did not rise |

- Visible quality: the defender's impossible shoulder seconds fall (front 0.27 to 0 s, reversed 0.43 to 0.07 s; rear
  0.03 to 0), and the rear wrap loses its deep own-body overlaps. Up: the front wrap's limp-legged defender crosses his
  legs more (0.28 to 0.50 s; the shoe pair already 19 cm deep, now 23) and the carrier, landing later over him, folds
  his upper arms 11 to 12 cm into his own trunk and each other for 0.05 to 0.27 s around 2 s (M2's tracked
  `UPPER_ARM_IN_TRUNK`, reached by his moved landing; his arms are passive).

## Who falls

Times are when the support loss starts (forward / reversed order). No other run changes who falls. The hold flip
changes no fall outcome (times above).

| fixture | player | before M3 | cradle | now | result before -> now |
| --- | --- | --- | --- | --- | --- |
| L3-F19-front | defender | stays up | stays up | 0.742 / 0.742 s, takedown | progressStopped -> groundDown |
| L3-F19-front | carrier | stays up | stays up | 1.100 / 1.150 s | |
| L3-F19-rear | defender | stays up | stays up | 0.904 s / stays up | practiceOutOfBounds (the carrier runs on alone forward) |
| L4-F9-transferFailed | defender | 1.45 s | 1.38 s | 0.804 s, takedown (flagged) | invalidTransfer |

The cradle step changed no fall outcome (only times: the side wrap's carrier 0.63 to 0.74 s, its defender 1.08 to
0.94 s). In the reversed rear wrap the hold breaks during the lowering (the left arm's clamp is lost at 0.858 s, 46
ms before he would go down): he stands back up and the pair run on as before.

## Known issues

- **The rear-wrap carrier still runs on.** The defender's arms hold 0.37 s while he drops, then slide off: a forearm
  wrap pressed at 100 N cannot carry his weight (about 900 N against some 150 N of friction), and the falling owner
  budget (350 N) would not carry it either. Only a palm grip (a passive link) or hands locked around the carrier could;
  the wrap forms clamps, not grips. His limp legs drop him almost in free fall (no knee or hip effort, M4's).
- **Holds last about half a second, not to the ground.** A forearm hold lives while solved contact renews it; as the
  defender drops the contact thins and it lapses into a brace (0.37 to 0.65 s). Not a perpetual hold, by design.
- **L4 takedowns keep L4's own response** (L4-F9-transferFailed: `FALL_L4`, no press, its reaction delay): L4 runs are
  unchanged by the hold flip.
- **One-arm holds do not commit** (out of the slice). In the side wrap (L3-F4-twoArm) the far arm's clamp slips
  between 0.52 and 0.55 s, so the hold is one-armed: the carrier falls on his own at 0.74 s and the defender trips over
  him 0.2 s later. A one-arm hit that brushes past (the miss with the defender 0.4 m nearer) leaves him standing over
  the carrier.
- **Stationary holds are not flipped** (L3-F6, above).
- **Tracked defects** (`tests/wrap-defects.test.ts`, each pinned on a capture shortly before it; each test fails once
  its defect is gone from that state):

  | defect | capture | under the flip / twin | across L3, L4, HC |
  | --- | --- | --- | --- |
  | `CARRIER_ARM_IN_DEFENDER`: the supported carrier's right upper arm, on its clip's swing, 10 to 11 cm into the defender's drawn trunk as they meet (the met-arm rule keeps his forearm and hand out; the upper arm's queries against other trunks are culled) | HC-F1-mirror@39 (0.650 s, cradle) | 11.4 / 11.2 cm (the run before the cradle with the defender's arms off from 0.3 s: no early clamp slowing his arrival). Before the cradle as registered, 5.3 cm | 34 frames past 10 cm, HC-F1-mirror and HC-F1-lowMirror, both orders |
  | `FALLING_SHOULDER_SNAP`: the ragdoll defender's left shoulder past the snap rate for two ticks in the air (61.3 and 65.9 rad/s, upper arm 0.53 m up) | L4-F9-transferFailed@72 (1.200 s, both ragdolls) | the same ticks under the cradle profile from there, bodies identical to the last digit | the only ragdoll snaps the flips add |
  | `PASSIVE_GAIN`: the same defender gains 38.8 J in one solve at 1.271 s, in contact, not pinched, no other player touching | the same capture | the same solve | the largest L4 passive gain (was 15.4 J) |

  - None is introduced or made worse by the step that reached it, so none blocks. The last two come after both players
    are ragdolls, where the finish reads nothing; the takedown's earlier fall is the moved trajectory.
  - Also reached, already tracked in M2: `CARRY_PINCH` (the side wrap's carrier, reversed, 29.8 J at 1.079 s; its L4
    twin L4-F10-wrap-off the same) and `UPPER_ARM_IN_TRUNK` (above).
  - The forward rear wrap's carrier runs 0.6 s longer, and his arm swing adds frames over 5 cm (94 to 268; none over
    20 cm): his run, not a new mechanism.
- **Supported snaps in L4-F9-transferFailed** rose from 9 to 13 per order (L4 total 28 to 36). They are the labelled
  invalid transfer's; the other ten (L4-F9-crowded, L4-F10-knee) are unchanged.

## Lab

Port 5180. Each link at the moment before the arms open; add `&wrap=v2` for the takedown with his arms let go at it,
`&wrap=v1` for the cradle without the takedown and `&wrap=off` for before M3.

- Front wrap, going down together: `?fixture=L3-F19-front&cam=side&speed=0.25&t=0.15` (and `cam=front`). The hold
  through the takedown from 0.74 s: `?fixture=L3-F19-front&cam=side&speed=0.25&t=0.65` (`&wrap=v2` before it; reversed
  `&order=rev`).
- Rear wrap: `?fixture=L3-F19-rear&cam=side&speed=0.25&t=0.30`. The hold from 0.90 s, sliding off by 1.28 s:
  `?fixture=L3-F19-rear&cam=side&speed=0.25&t=0.80` (`&wrap=v2` before it).
- Side wrap (the far arm's clamp slips, a one-arm hold: no commit):
  `?fixture=L3-F4-twoArm&cam=front&speed=0.25&t=0.15`.
- Broken hold, the rear wrap reversed (lowered from 0.70 s, the left hold lost at 0.86 s, he stands back up):
  `?fixture=L3-F19-rear&order=rev&cam=side&speed=0.25&t=0.30`.
- Miss: `?fixture=L3-F19-miss&cam=front&speed=0.25&t=0.15`.
- The carrier's upper arm in the defender (tracked): `?fixture=HC-F1-mirror&cam=side&speed=0.25&t=0.35`.
