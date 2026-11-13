# Contact motion M3: the wrap, the committed finish and the hold through it (rough-first slice)

Plan: [03-wrap-and-finish](../open/contact-motion/03-wrap-and-finish.md), rough-first slice, on branch `prereq-ladder`:
`02fa1b8` the slice, `23551d8` open and close (flag off), `aea0caa` its flip, `01f9dfb` the committed finish (flag
off), `51a7f4b` its flip, `e886c0f` the hold through the takedown (flag off), `a02a5fc` its flip. Polish 1.1, the
strike: `5f85796` (flag off), `cd4d92e` its flip. Polish 1.2, the drive: `b328144` (flag off), 48c9403 its flip.

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

## The strike (polish 1.1, WRAP_V4, on)

As contact nears (0.6 s to it, or the gap under 0.8 m) he hinges at the hips: trunk pitched 40 deg toward the carrier,
hips 8 cm lower, facing turned up to 30 deg toward his head's side and his line steered so his centre passes 0.3 m to
that side (the near shoulder leads), arms open wide from the shoulders (upper arms about 100 to 112 deg from hanging,
elbows out and up). The head goes to the side behind the carrier's motion across the approach, never across his front.
On contact the arms close as before. On a miss he unwinds to upright and pursues; he never loses balance before
contact. Before (`wrap=v3`): upright trunk, hands at elbow width.

- Flag and lab: `FixtureDef.wrap` = `WRAP_V4` on every fixture that had `WRAP_V3` (`fixtures/index.ts` `strikeFlip`);
  lab `wrap=v3` is before it. `tests/runs.ts` `preWrapV4` gives a definition as before.
- Model: the hip hinge (`src/sim/hinge.ts`). The supported proxy is one rigid body, so the pitched trunk is the proxy
  pitched about its level lateral axis; the legs' frame is that rotation with the hinge's share taken out. Loss
  envelope and lean scale read the legs; the balance torque serves the legs first and gives the hinge PD what is left.
  The legs are posed in the travel frame, so the pitched core reads as hip flexion.
- Who falls (`.scratch/p2/s2-falls.txt` in the main checkout, 78 of 106 runs change): the carrier now goes down from
  the hit itself, earlier, in most runs. In 34 runs (L3-F1-phase0/1/2/4/6/7, L3-F1-mirror0/4, L3-F1-low, L3-F4-twoArm,
  L3-F4-oneArm, HC-F3-mirror/phase0/phase50 rev/phase75/lowRunner, L4-F10-wrap-on/off) the tackler then stays on his
  feet over the felled carrier, where before he tripped over him. The front wrap's carrier goes down at 0.75 s (was
  1.05) and the tackler, his hold gone, falls on his own at 1.31 s. The rear wrap's takedown comes later (2.5 s, was
  0.90 forward); reversed, both now go down (tackler 2.50, carrier 3.58 s; before, neither), forward the carrier
  still runs on. The misses (`L3-F19-miss`, `L3-F2-miss`) stay up; `L3-F1-low`'s runner still falls.
- Known issues: the tackler standing over a hit-felled carrier is what the drive (1.2) addresses. Head-first contact
  in `L3-F19-front`. Tracked defects the flip reached, none made worse by it (`tests/strike-defects.test.ts`, each on
  a capture with its twin):

  | defect | capture | what |
  | --- | --- | --- |
  | `HIT_MOVES_CLIP_REQUEST` | L3-F10-bothMirror (0.583 s), L3-F1-mirror4 (0.433 s) | the hit moves the clip leg request past B3 at its onset (the carrier's walk stride scale; the defender's jolted root); `tests/l3-pass.ts` excepts those onset jumps there |
  | `REJECTED_PROXY_PRESS` | HC-F5-invalidOne (1.167 s) | a labelled invalid (rejected) candidate's rigid proxy presses the carrier's arm back past the held bar; excepted there alone |
  | `STEP_SEEDS_CLEARANCE_JUMP` | L3-F1-phase7 (0.483 s) | a step seeded from a clearance jump of the achieved ankle runs the foot behind the hips to a supported hip snap (the seed exists in 19 runs before and after the flip); a footwork fix of its own |

  Trend only: L4 over-power substeps (7 runs 0 to 1); passive energy L3 and HC down, L4 442 to 477 J, largest solve
  down; worst shape-query tick 3048.

## The drive (polish 1.2, WRAP_V5)

Built, no fixture uses it (`WrapProfile.drive`, `src/sim/controllers/wrap.ts`; the hold carried through his own loss,
`src/sim/conversion.ts`; `tests/wrap-drive.test.ts`). With a secure hold (both arms on the carrier, or one arm holding
with his body touching him, for 50 ms) he keeps the strike posture and keeps running through the carrier: request the
carrier's velocity plus 3 m/s along the line through him, full effort, the ordinary drive force (no new force path),
the extra eased off as his own lean goes from 12 to 25 deg. He leaves his feet only (a) when the carrier is down, (b)
when the carrier leans past 30 deg, (c) on his own loss of balance (the takedown's hold carried through it), or (d) on a
stall (0.9 s without the carrier's lean past 15 deg or rising 2 deg in 0.3 s; 1.6 s at most); (a), (b), (d) by the
`takedown` conversion. A hold lost for over 50 ms ends the drive.

On for L3, L4 and HC since its flip (`driveFlip`, WRAP_V4 to WRAP_V5; lab `wrap=v4` is the view before it,
`tests/runs.ts` `preWrapV5`). Exits seen: front wrap (b) at 0.72 s; rear wrap (b) after 1.15 s and 7 steps, the carrier
pushed 5.5 m and over forward; the side and felled-by-the-hit wraps (a) at once; the drag (c) at 0.72 s. Who falls (13
changes, both orders; the rest are times): the tackler now goes down with his carrier at about 0.6 s in L3-F1-phase0,
-phase1, -phase2, -phase7, L3-F1-low, L3-F4-twoArm, L3-F4-oneArm, HC-F3-phase0, HC-F3-lowRunner, L4-F10-wrap-on and
-off (he stayed up); L3-F19-rear's carrier goes down with him at 1.90 s (stayed up forward, down at 3.58 s reversed).
The diagnostic conversions of the rising and falling defenders are pre-empted by the takedown at 0.63 s. The L3-F1-low
runner still falls, `L3-F19-miss` is unchanged. Tracked defects the flip reached, none made worse by it
(`tests/drive-defects.test.ts`, each on a capture with its twin, drive off from the same state identical):

| defect | capture | what |
| --- | --- | --- |
| `OVERHEAD_TWIST_UNHELD` | L4-F9-transferFailed reversed (1.000 s) | the failed-transfer carrier's passive left arm thrown overhead keeps its twist 70 to 79 deg past range to the end; before the flip the forward order does the same |
| `CLEARANCE_KNEE_TURNS_BACK` | L3-F5-dragMirror reversed (1.500 s) | the defender's swing foot lifted close above the hip to clear the fallen carrier turns his supported knee back (hip twist 111 deg past, 1.65 to 1.93 s); the ladder 11b mechanism, within range under JOINT_RANGE_V3 (no fixture uses it); before the flip in L3-F1-phase1 |

Not twinned, reached by falls that did not happen before (inferred): the rear-wrap carrier's ragdoll shoulder twist
77 to 80 deg past for 0.25 to 0.37 s as he goes over; the reversed drag carrier's hip extension 46 deg past for 0.15 s.
Trend only: ragdoll
self-overlap seconds up where the tackler now falls with his carrier; carriers' fall-response over-power substeps 0 to
1 or 2 in 16 runs.

## Flags, lab and code

- `FixtureDef.wrap` = `WRAP_V3` (`src/sim/controllers/wrap.ts`). Registered on every L3, L4 and HC fixture with a
  tackling defender (`src/sim/fixtures/index.ts` `wrapFlip`). G, L1, L2 and RH unchanged.
- Not registered on a defender who stops to stand in a hold (`standAfterS`, the L3-F6 stationary holds): their wrap and
  hold settle check (`HOLD_SETTLES`, the plan 13e known limit) is about a standing hold, and under the cradle its free
  gap is 0.21 m against 0.05.
- (Since polish 1.2 the registered profile is `WRAP_V5`, above; lab `wrap=on|v4|v3|v2|v1|off`, `v4` the strike before
  the drive, `v3` the hold before the strike.) Lab `wrap=on|v2|v1|off` as M3 left it: `on` was `WRAP_V3`, `v2` the takedown with his arms let go at it
  (before the hold flip), `v1` the cradle without the committed finish (before its flip), `off` the Gate 2 progression (before M3).
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
  budget (350 N) would not carry it either. Neither locked hands nor a palm grip can take over on these bodies (below,
  "Locked hands").
- **Holds last about half a second, not to the ground.** A forearm hold lives while solved contact renews it; as the
  defender drops the contact thins and it lapses into a brace (0.37 to 0.65 s; since M4's fall reaction 0.36 to
  0.47 s). Not a perpetual hold, by design.
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

## Locked hands: not reachable on these bodies (2026-11-13)

Planned as the first polish after M4: his two hands lock (hand on hand, or hand on the other wrist) on the carrier's
far side, so the arms close a loop around him and the hold stops depending on friction. Measured first, before any
code: the hands never come within a lock's reach of each other, so nothing was built and the forearm clamps remain.
A link no fixture can form would be a flag that can never be flipped (Direction item 5).

| two-arm hold, forward / reversed | front (`L3-F19-front`) | rear (`L3-F19-rear`) | side (`L3-F4-twoArm`) |
| --- | --- | --- | --- |
| substeps with both arms holding the carrier | 159 / 172 | 148 / 52 | 2 / 4 (the far clamp slips) |
| closest palm to palm in them | 0.52 / 0.52 m | 0.51 / 0.51 m | 0.48 / 0.48 m |
| closest palm to the other arm's forearm | 0.57 / 0.57 m | 0.57 / 0.57 m | 0.52 / 0.52 m |
| his shoulders above the band; behind the carrier's centre | 0.35 to 0.40; 0.37 to 0.46 m | 0.27 to 0.36; 0.33 to 0.38 m | 0.38 to 0.40; 0.37 to 0.39 m |

- Over all 56 L3, L4 and HC wrap fixtures, both orders: nine have a two-arm hold, and the hands come no nearer than
  0.37 m (`L4-F9-transferFailed`), every other at least 0.45 m. The palms stop just outside the carrier's far corners.
- Why: his palm would have to go from the shoulder to outside the far corner (about 0.61 m) and then across the far
  face to its middle (about 0.26 m), 0.87 m against a reach of 0.70 m (chain 0.72 m). Both proxy torso boxes are
  0.40 m deep, so his chest on the carrier's back keeps his shoulders a third of a metre or more behind the carrier's
  centre, and the carrier's box is 0.46 m wide at the band (the drawn trunk there is about 0.43 by 0.31 m). With
  both torsos shrunk to 0.30 by 0.22 m the hands still stay 0.22 m or more apart: the reach, not the girth alone.
- A close target at the far face's middle (180 deg, 5 or 15 cm in; 170 deg, 10 cm) brings the front and rear hands no
  nearer (0.50 m or more) and takes the forearms off the flanks: the rear wrap's two clamps last 3 or 4 substeps
  instead of 61 and he never commits (the front wrap too at 15 cm in). In the side wrap the hands meet only after the
  carrier has fallen out of them, closing on air with no clamp. A regression, so the close target stays at 150 deg.
- A palm grip on the far side is refused by the grip rule itself (`farSide`: a grip is a straight shoulder-to-anchor
  tension, which cannot pull through the body); with the wrap's arms in grip mode every attempt is rejected and, with
  no clamp either, there is no takedown.
- The side wrap's far arm never gets round. From the side the carrier's far corner is 139 deg round; one arm gets to
  115 or 116 deg, the other to 145 or 146 deg, where its clamp is lost and remade every substep, so both arms hold him
  for 5 to 20 ms. The carrier falls by his own balance (0.74 s), the defender 0.2 s later over him (his core 0.36 m
  above the carrier's as his trunk lands), and they touch for 0.3 to 0.4 s after the first fall.
- `L3-F5-drag` (the 3 m/s defender dragged by the 4 m/s runner): never a two-arm hold. One arm gets 93 deg round and
  clamps for some 25 ms at 0.96 s, the other 147 deg, its clamp flickering from 0.43 to 0.80 s; the palms stay 0.52 m
  or more apart. The carrier falls by his own balance at 0.73 s; the defender follows 0.58 to 0.61 s later by losing
  his own support and ends lying on him (his trunk never reaches the floor).
- Design intent for a lock, when one is reachable (the user, 2026-11-13): a tackler never lets go of his own accord;
  a lock lasts to the ground and ends only on physical overload, the wrap genuinely ending or the referee ending the
  play, never on a timer or a short lapse of solved contact; the pair reach the ground connected.
- What would make a lock reachable, each its own design step: a tackle that drives his shoulder into the carrier with
  his head to one side (the shoulder at the carrier's flank, not a third of a metre behind his centre) and wraps
  lower; trunk colliders nearer the drawn body (they move every L3, L4 and HC run); or a wrist, so each hand turns
  round the far corner onto the far face (a hook that bears by normal contact, not a lock).
- Probes (run from the ladder worktree): `.scratch/p1/scan.ts` (every wrap fixture; `<az> <depth>` for another close
  target), `.scratch/p1/reach.ts` (close-target variants), `.scratch/p1/reachgeo.ts` (shoulder placement),
  `.scratch/p1/slim.ts` (shrunk torsos), `.scratch/p1/grip.ts` (grip mode), `.scratch/p1/scene.ts <fixture>` (one
  scene's arms, falls and landing). Outputs in the main checkout's `.scratch/p1/evidence/`.

## Lab

Port 5180. The strike (add `&wrap=v3` for before it): front `?fixture=L3-F19-front&cam=side&speed=0.25&t=0.15`, rear
`?fixture=L3-F19-rear&cam=side&speed=0.25&t=0.30`, side `?fixture=L3-F4-twoArm&cam=front&speed=0.25&t=0.15`, a
hit-felled carrier with the tackler left standing `?fixture=L3-F1-low&cam=side&speed=0.25&t=0.40`.

The M3 links below were taken under `WRAP_V3`: add `&wrap=v3` to see them as described. Each link at the moment
before the arms open; add `&wrap=v2` for the takedown with his arms let go at it, `&wrap=v1` for the cradle without
the takedown and `&wrap=off` for before M3.

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
