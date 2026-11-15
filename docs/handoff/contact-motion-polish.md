# Contact motion polish: the tackle and the fall after the user's lab review (parked 2026-11-15)

Plan: [polish](../open/contact-motion/polish.md) (the list the user's 2026-11-13 lab review produced), on branch
`prereq-ladder`, from `cd4d92e` (the strike) to `f840b27` (the shoulder twist). Earlier layers: the
[M3 handoff](contact-motion-m3.md) ("The strike", "The drive"), [M4](contact-motion-m4.md) (the fall reaction). The
user parked the tackler here on 2026-11-15 ("leave the tackler where it is and move on; we can come back to polish");
the next area is contact footwork ([polish.md](../open/contact-motion/polish.md), `docs/open/15_Contact_Footwork.md`).
What is left of the tackle is the parked list at the end.

## Owner rulings (standing)

- **Wraps and hits are different tackles** (2026-11-14). A hit is a violent shoulder collision: no arms coming out to
  wrap, the tackler does not have to go down. A wrap holds on through the fall.
- **Never slow a tackler artificially to make a fixture read as a wrap** (2026-11-14). A closing-speed cap ("gather")
  was rejected; do not propose speed caps again.
- **The tackle from behind is low priority** (2026-11-14: rare in the game). Its debt waits.
- **Which tackle is chosen is decided by game context, later.** Today it is a per-fixture request.
- **The ball carrier always biases forward** and tries to fall forward for the extra yards (2026-11-13): an intention
  for the brace, a held carrier on his feet, the bound-legs fall and the ragdoll's fall effort, not a forced outcome.
- The tackle the user pictures: "hit, wrap, roll" (kept in polish.md, "The user's reference for a tackle").
- Accepted, not to be worked: crossed legs in a fall, the carrier's arms folding into his trunk on landing, the
  carrier's arm into the tackler (`HC-F1-mirror`), the who-falls changes of M2 to M4.

## What a viewer sees now

Every L3, L4 and HC wrap fixture registers `WRAP_V13` (`src/sim/controllers/wrap.ts`; the flip chain in
`src/sim/fixtures/index.ts`: `linkFlip`, `behindFlip`, `stayOnFlip`, `hitFlip`, `aimFlip`). Each profile is the one
before plus one layer:

| profile | layer | what a viewer sees |
| --- | --- | --- |
| `WRAP_V4`-`V5` | strike, drive | the tackler leans in, shoulder leads, head to the side, arms wide; with a hold he keeps his legs driving (M3 handoff) |
| `WRAP_V7` | ride-down | he stays on his feet following the carrier down and converts low (chest about 0.5 m, shoulders 0.77-0.91 m on the front, rear and drag wraps), folding and arriving slowing down, no somersault |
| `WRAP_V8` | bound-legs fall | a carrier held round the hips or legs, or whose stranded foot cannot plant, goes down then, leaning toward his travel |
| `WRAP_V9` | the hold | at his switch each clamp becomes a breakable tension-only link to the patch it held (10 kN/m, 150 N s/m, 700 N per arm, 1000 N in all; breaks on overload, 0.25 m stretch, out of reach); carried through the referee's ending while he rides; gives way to born overlaps that begin after it (`bornYield`) |
| `WRAP_V10` | drive from behind | from behind (carrier up, 1 m/s or more, line within 60 deg of his travel) the drive never asks for more than the carrier's speed: no push |
| `WRAP_V11` | rear stay-on | from behind he stays posed in the strike on the runner's back at the runner's speed (no brake, no weight commit); a runner held so 0.25 s (grace 0.05) goes down forward (bound-legs clause (c)), the tackler riding down after him and letting go an arm the runner falls away from (`letGoM` 0.35 m) |
| `WRAP_V12` | hits | a tackle asked for as a hit (`WrapSpec.tackle: 'hit'`) is a shoulder collision: head behind the runner's travel, arms tucked, no clamp, drive, ride or link, 0.3 s through the contact at his own speed, falling only by his own balance. No speed rule: only `HIT_FIXTURES` ask (`L3-F4-twoArm`, `L4-F10-wrap-on`, `L3-F1-low`, `HC-F3-lowRunner`, `HC-F3-phase0`); every other tackle is a wrap |
| `WRAP_V13` | front-side aim | on a crossing runner the hit's line turns so the striking shoulder meets his core led 0.15 m along his travel, held from 0.1 s before contact: the shoulder lands on his chest or the front of his near shoulder (first contact 50-59 deg off his facing, V12 73-99), the runner goes down 0.13-0.17 s later with no new stride, flat on side or front |

Who falls under the hits: the runner always; the tackler goes down in 8 of 10 runs (not `HC-F3-phase0`) at about
1.0 s, tripping on the downed runner's shins, a ragdoll fall, forearm first. On the rear wrap (`L3-F19-rear`, both
orders) the runner goes down first, forward, at about 1.0 s, the tackler after him.

`WRAP_V6` (the low strike of the deep crouch tackle and, from behind, the drag-down on two live fall links) is built on
`WRAP_V10` and flag off: no fixture registers it.

**The forward fall** (`FORWARD_FALL_V1` in `FALL_REACT_V3` on L3 and HC, `FALL_L4_V2` on L4,
`src/sim/profiles.ts`, `src/sim/fall-response.ts`). Decided once at the switch (trunk lean 0.1 s ahead at least 10 deg
toward the chest's front half, and lean plus velocity within 60 deg of the chest front). The hips drive toward 15 deg
flexion over 0.3 s at 60 N m, knees toward 15 deg; the free arm braces with at least 30 deg of elbow and, landed, only
damps (60 / 40 N m shoulder / elbow); above 2-3 m/s the ball arm folds in to the chest (`carry`). The drives give their
ceiling up with the joint's own speed along them (`concentricRadPerS` 4; not the brace's shoulder, which would turn
`L3-F4-twoArm` over the arm again). Power and work caps (150 W, 100 J) unchanged. A man going down forward lays out
flat behind his arm and gives on it, the ball tucked; backward and sideways falls are unchanged (trace-identical). The
ten hit runs end flat. Who falls: in `L4-F10-knee-on` (both orders) the tackler no longer goes down.

**The shoulder twist limit** (`SHOULDER_TWIST_ANAT_V2`, `withShoulderTwistLimit`, registered on every L3, L4 and HC
ragdoll by `shoulderTwistFlip`; G, L1, L2, RH keep plan 09's). The ragdoll shoulder's twist is read in the anatomical
measure, so a fallen arm overhead keeps a natural twist instead of bending the wrong way, and both twist stops are
stepped over the substep on the arm's own inertia (`steppedLimitPush`: damping at most critical, never pushing back past
the stop), so an arm twisted to its stop stops there instead of being thrown back. Ragdoll shoulder past the impossible
margin 32.4 to 0.2 player-s; sweep excursions 132 to 4. No who-falls change.

Also on L3, L4 and HC from this work: `JOINT_RANGE_V3` (the supported thigh's rotation bounded, `9c6319e`).

## Lab (port 5180)

Each switch shows the view before one flip:

| switch | view |
| --- | --- |
| `wrap=v12` | before the hit's aim (hits aimed behind the shoulder) |
| `wrap=v11` | before the hit (the five fixtures as wraps) |
| `wrap=v10` | before the rear stay-on (the rear tackler commits his weight and hangs off one arm) |
| `wrap=v9` / `v8` | before the drive from behind / before the hold |
| `wrap=v12auto`, `v13auto` | lab only: the placeholder speed rule (6 m/s closing at strike start makes a hit) |
| `wrap=v6` | the low strike / drag-down (flag off) |
| `fwd=off` | before the forward fall (`fall=v2` the same on L3 and HC) |
| `armtwist=off` (`v1`) | before the shoulder twist flip (V1: anatomical, not stepped) |

Worth watching: the hit, `?fixture=L3-F4-twoArm&cam=side&speed=0.25&t=0.45` (and `&cam=front`, `t=1.0` for the
landing); the hit with the tackler staying up, `?fixture=HC-F3-phase0&cam=side&speed=0.25&t=0.45`; the rear wrap,
`?fixture=L3-F19-rear&cam=side&speed=0.25&t=0.7` (`t=1.2` the let-go); the forward fall's who-falls,
`?fixture=L4-F10-knee-on&cam=side&speed=0.25&t=0.6`; the overhead arm, the end of `L3-F4-twoArm` with `&armtwist=off`.

## Code and tests

- Profiles: `src/sim/controllers/wrap.ts` (`WRAP_V6`-`V13`, `WRAP_V12_AUTO`, `WRAP_V13_AUTO`), `src/sim/profiles.ts`
  (`FORWARD_FALL_V1`, `FALL_REACT_V3`, `FALL_L4_V2`, `SHOULDER_TWIST_ANAT_V2`). Flips and `HIT_FIXTURES`:
  `src/sim/fixtures/index.ts`. Lab switches: `src/lab/lab-params.ts`. Bound-legs clauses: `Simulation.boundLegs`.
- Before-flip definitions for samples and captures: `tests/runs.ts` `preWrapV9` ... `preWrapV13`, `preForwardFall`,
  `preShoulderTwist` (all in `BEFORE_FLIPS`), `WRAP_V6_PRE_V10`.
- Behaviour tests, each case with its fault twin: `tests/fall-link.test.ts` (V9), `wrap-behind.test.ts` (V10),
  `wrap-stay-on.test.ts` (V11), `wrap-drag.test.ts` (V6 drag-down), `wrap-hit.test.ts` (V12),
  `wrap-hit-aim.test.ts` (V13), `fall-forward.test.ts`, `shoulder-twist-stepped.test.ts`.
- Tracked defects (each on a capture, with a same-state twin; reached, not caused, by the step named):

  | defect | where | what |
  | --- | --- | --- |
  | `LANDING_SHOULDER_SNAP` | `tests/shoulder-twist-stepped.test.ts` | `L3-F9-low`, `L4-F9-low` rev: landing on the free arm whips the shoulder past the snap bar (before the flip, the elbow); plan 09's limit from the same state snaps the same |
  | `OWN_SHIN_TRUNK_REBOUND` | `tests/self-legs.test.ts` | the own-leg rig: the shin's self shape on the own trunk gains energy in one solve |
  | `SUPPORTED_ELBOW_SNAP` | `tests/fall-forward-defects.test.ts` | `HC-F3-mirror` 1.28 s: the upright tackler's elbow jumps a frame (62 rad/s; 41 without the forward fall, 62 with it off from 1.23 s) |
  | `HOLD_SHOULDER_IMPACT_POWER`, `PROTECT_ELBOW_IMPACT_POWER` | same file | `L3-F5-dragMirror` rev 164 W, `L3-F1-phase7` 179 W in an impact (153 / 149 W without the plan); realized power is a trend, not a gate |
  | `ARM_HELD_IN_HEAD` | `tests/thigh-defects.test.ts` | `HC-F2-lowCarrier`: an arm converted in the other man's head held there; its fix is the born separation |
  | `LANDING_REBOUND`, `LANDING_ELBOW_SNAP` | `tests/fall-react-defects.test.ts` | M4's; the hit runner's 80 J landing on `L4-F10-wrap-on` is this class |

  `OVERHEAD_TWIST_UNHELD` (`tests/ride-defects.test.ts`) and `RAISED_ARM_TWIST` (`tests/bind-defects.test.ts`) are
  fixed and now test the shoulder twist fix; `CLEARANCE_KNEE_TURNS_BACK` (`ride-defects`) is gone under `JOINT_RANGE_V3`.

## Evidence and baseline

The current full-check baseline is main checkout `.scratch/p19/s2b-flip` (`f840b27`, suite 580/580), compare text
`.scratch/p19/s2b-compare.txt`. Measurement summaries (main checkout): the hold `.scratch/p11/hold/`,
`hold-on2/summary.txt`; from behind `.scratch/p12/behind/summary.txt`, `.scratch/p14/back/summary.txt`,
`back2/summary.txt`; the side wrap measured `.scratch/p15/side/summary.txt`; the hit `.scratch/p16/hit/summary.txt`;
the forward fall `.scratch/p17/landing/`, `flat/`, `fast/`, `on/summary.txt`; the aim `.scratch/p18/aim/summary.txt`;
the shoulder twist `.scratch/p19/s2-twins.txt` and the sweep in worktree `.scratch/p19/` (`sweep-fwd.jsonl`, `sweep-rev.jsonl`
before, `sweep-reg-*.jsonl` registered after, `sweep-v2x-*.jsonl` V2 forced; `python3 summ.py <files>`).

## Parked and known issues

One line each; where to resume from. "Main" is the main checkout's `.scratch/`, "worktree" the ladder worktree's.

- **Tackler ending on top of the runner.** Two tries, neither passes alone; decided not a steering problem: the hold
  through the landing (lock, roll) is what keeps him on his man. Main `p10/parked/` (`onto-v9.patch`,
  `onto-high.patch`, README), evidence `p10/onto/`, `onto-high/`.
- **Pinned hold on a supported carrier** (real weight on his back from behind). A supported clamp re-forms every
  substep, so its friction carries 5-30 N and the sag lifts the runner; needs a pinned hold or tension link on a
  supported carrier. Main `p14/parked/` (`back.patch`, `back2.patch`, `back2-drivehold.patch`, README).
- **Low tackle `WRAP_V6`, flag off.** The fold needs 0.85 s (a longer approach than the registered wraps), the palms
  stop 0.35 m apart (head on his pelvis, never past the hip), the hit from the front spins the folded tackler;
  reversed from 2 m back he commits with one clamp and the carrier runs on; the tackler ends at arm's length. Parked
  square-up main `p5/parked/`; probes worktree `.scratch/p5/`.
- **Hand lock.** None at torso height: the hands stay 0.52-0.60 m apart, matching the arm's geometry. It belongs to
  the low wrap once its hands meet. Main `p3/hand-gap/`; probes worktree `.scratch/p1/handgap.ts`, `handgeo.ts`.
- **Sideways roll** with the carrier after the wrap. Not built; needs the hold through the landing.
- **Head-on hit takes the head** (`L3-F19-front` as a hit, lab-only `wrap=v12auto` / `v13auto`): the head takes about
  half the strike. Main `p16/hit/summary.txt`, `p18/aim/f19.txt`.
- **Brace amount; L4 bent brace late.** The carrier's brace wants a bit more forward lean and crouch; `L3-F2-miss`
  shows no brace (intended or a decision bug, unchecked). In the constructed standing fall (`L4-F3-forward-on`,
  `L4-F10-palm-on`) the forward plan's bent brace arrives late (0.388 s) and misses, so the chest lands first; about
  11 forward fallers end worse than before. Main `p17/on/summary.txt`.
- **Whiff.** On a miss the swinging arms rotate the tackler (`L3-F19-miss`); a real tackler may reach and fall. Not built.
- **Wrap-or-hit choice.** Owner: decided by game context, later. Today `HIT_FIXTURES` requests it; the 6 m/s speed rule
  is a lab-only placeholder (it would make 70 of 106 wrap runs hits, the head-on one included).
- **Drag mirror still pushes** (+0.42 m/s): its line starts 68 deg off the runner's travel, so the behind test fails as
  its drive begins. Main `p12/behind/summary.txt`.
- **Rear tackle ends with the tackler 0.8-1.1 m to the runner's side**, no hold alive; from behind the finish mode
  alternates reposition and contact every substep. Low priority (owner). Main `p14/back2/summary.txt`.
- **`HC-F3-phase0` forearm overlap** (not tracked): the tackler's tucked left forearm 10 cm into the falling runner for
  0.13 s at 0.77 s (the runner's thigh swings into it, then his run carries the arm through); head brush 3 cm. Main
  `p18/aim/summary.txt`; probe worktree `.scratch/p18/fore.ts`.
- **Tackler's head share on landing after a hit**: 26-36% of his ground impulse on L3 and HC. Probe worktree
  `.scratch/p18/dfall.ts`.
- **`LANDING_SHOULDER_SNAP`**, **`OWN_SHIN_TRUNK_REBOUND`**: tracked (table above); each its own fix step.
- **4 remaining shoulder overshoots**: `L4-F3-run-on` and `L4-F9-free`, both orders, D's right shoulder 51 deg past
  range for 0.07 s at 1.55 s after a 725 deg/s axial spin. Also a supported raised arm posed a few degrees past the
  twist range starts its ragdoll there as slack (`HC-F1-low` D, 6 deg). Worktree `.scratch/p19/sweep-reg-*.jsonl`.
- **Ragdoll arm resting in its own trunk** (trend, untwinned): deep armTrunk self-overlap 126.7 to 139.5 s across the
  suite at the shoulder twist flip, `HC-F5-strictTransfer` fwd 6.2 to 19.9 s. Main `p19/s2b-compare.txt`.
- **Falls, still open** (polish 4): the palm touches but does not plant; the tackler's legs bounce backward on contact
  (`HC-F3-lowRunner`); trend only: tackler palm in own thigh 11-14 cm on the rear wrap.
- **Footwork** (gallop, stranded swing leg, step aimed past a blocker, no foot down after impact, a 2 m step while
  leaning): moved to the footwork plan; see polish.md.
