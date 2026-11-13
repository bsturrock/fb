# Contact motion M4: falling players react, and a landed palm bears load (rough-first slice)

Plan: [04-ground-contact](../open/contact-motion/04-ground-contact.md), rough-first slice, on branch `prereq-ladder`:
`1d1f22b` the reaction (flag off), `e4deefd` its flip, `3ac5c5f` its tracked defects, `b8b8554` the palm load (flag
off), `b158346` its flip, `f871b50` its tracked defects.

## What a falling player does

On every L3 and HC fixture with a ragdoll, every player whose conversion is accepted (a loss of support, a takedown, a
diagnostic switch) runs one fall response, `FALL_REACT_V2`:
- **Knees and hips flex before he lands** and yield through the landing: from the angles he converts in, after a 40 ms
  reaction delay, the knees toward 40 deg more flexion (at most 110) over 0.25 s and the hips 30 deg more over 0.3 s;
  a knee only flexes, a hip only damps past its target.
- **The carry arm keeps the ball**: it protects around the pose it had at the switch (the braced tuck).
- **A free arm reaches for the floor** ahead of the body (the plan 09 brace: a predicted landing point 0.1 to 0.25 s
  ahead, the palm 2 cm above the floor, the elbow bent at least 12 deg).
- **A landed palm bears load.** From the palm's (or forearm's) floor contact the arm chases no pose: shoulder and
  elbow only damp their own motion, so the body's weight bends the elbow and moves the shoulder while the damping
  takes the landing's energy out. When neither palm nor forearm has touched the floor for 50 ms the arm lets go and
  is passive.
- **An arm still holding at the switch keeps its hold** (M3's takedown hold, no reaction delay), pressed on what it
  holds, and braces when the hold lapses.
- The efforts fade from 0.8 s after the switch over 0.2 s. Every torque stays under the impact guard, the 150 W power
  cap and the 100 J work budget; the arms share the falling owner budget.

L4 keeps its own response (`FALL_L4`, plan 09) and its motor-off twins: L4 is plan 09's evaluation family and its
acceptance is pinned on that profile; moving it is its own opt-in step. G, L1, L2 and RH keep their definitions.

Before M4 an L3 or HC player went limp the moment he lost his feet: the ball arm swung out (a median 73 deg off its
tuck on L3), a braced palm landed in 3 of 159 L3 falls and none on HC, the knees bent only as far as they fell, and the held
carrier in HC-F3-lowRunner hung in a stride (one hip flexed up to 119 deg, the other extended to -20 deg, knees
straight). After the first step the landed brace was held on springs at its contact pose, which pushed the folded arm
back toward it under the body.

## Flags, lab and code

- `FixtureDef.fallResponse` = `FALL_REACT_V2` on every L3 and HC fixture with a ragdoll (`src/sim/fixtures/index.ts`
  `fallFlip`, then `palmLoadFlip`). `FALL_REACT_V1` is the reaction without the palm load (the step-1 flip).
- Lab `fall=on|v1|off` on an L3 or HC fixture: `on` is `FALL_REACT_V2`, `v1` the landed brace held on springs (before
  the palm-load flip), `off` limp (a takedown's hold only under `WRAP_V3`, the M3 view). A view without the hip stops
  (`hips=off`) runs limp (`fall off (no hip stops)`): the response bounds an L3 or HC hip by the hard stops alone.
- `tests/runs.ts` `prePalmLoad` and `preFallReact` (the head of `BEFORE_FLIPS`) give a definition as before each flip;
  every capture and natural sample taken before a flip resumes under the definition it was taken with.
- Code:
  - `FALL_REACT_V1` (`src/sim/profiles.ts`): `FALL_L4`'s tasks, gains, timing, caps and impact guard, with
    `FALL_HOLD_V1`'s arm ceilings (shoulder 30, elbow 20 N m), hold scale 1, press 100 N and a holding arm's own onset
    (`arms.holdOnset`, no delay, 20 ms ramp).
  - `FALL_REACT_V2`: `brace.load` `{ dampScale, releaseS }`. In `src/sim/fall-response.ts` `observe()` a brace in
    contact refreshes `loadedAtS` while palm or forearm is on the floor and goes passive past `releaseS` without
    (event `braceRelease` `{ arm, tS, loadedS }`, task-change reason `braceUnloaded`); `armCmds()` gives a loaded
    brace pure damping (shoulder swing `-kd * dampScale * w`, elbow `-kd * dampScale * rate`).
  - On a ragdoll without a hip envelope (L3, HC) the hip target is bounded by the hard stops; the build accepts a hip
    envelope or hip stops. A fixture whose players have no supported arms runs its arm system on the ragdoll's limbs
    (`armSystemProfile`), so the shared falling budget applies.
- Tests: `tests/fall-react.test.ts` (the reaction and the palm load, each case with its fault twin),
  `tests/fall-react-defects.test.ts` (tracked defects).

## Values and why

| value | setting | why |
| --- | --- | --- |
| reaction | `FALL_L4`'s tasks, gains, timing (40 ms delay, 80 ms ramp, fade from 0.8 s over 0.2 s), caps (150 W, 100 J) and impact guard | one response, not a second system; L4's has been judged since plan 09 |
| knees, hips | 40 deg more knee flexion (max 110), 30 deg hip, ceilings 22 and 18 N m | `FALL_L4`'s; at first ground contact the median knee is 89 (L3) and 112 deg (HC) |
| arm ceilings | shoulder 30, elbow 20 N m for every arm task | 15 N m does not hold a horizontal arm, the tucked ball arm included, against gravity (about 20 N m for the model's arm) |
| hold onset | no delay, 20 ms ramp, for a holding arm only | M3's takedown hold lapsed at its 0.1 s memory under the 40 ms delay |
| palm load damping | the gains' own damping (scale 1: shoulder 6, elbow 3 N m s/rad) | twice the damping measured the same on the palm; damping alone stores nothing |
| release | 50 ms with neither palm nor forearm on the floor | three ticks, past contact flicker; with `releaseS` 0 it lets go within 10 ms of the first gap |
| brace elbow | at least 12 deg (unchanged) | 30 deg (so a near-straight arm does not take the landing as a column) gave no longer palm time and a harder HC trunk rebound (p90 2.0 against 1.5 m/s) |

## Measured

Full checks `.scratch/m4/<step>/`, each compared with the step before: `s1-off`, `s2-flip`, `s3-defect`,
`s4-load-off`, `s5-load-flip`, `s6-defects` (compare output beside each, `<step>.compare.txt`). At the end: suite
469/469; G, L1, L2 and RH byte-identical at every step; both flag-off steps byte-identical. Fall measures: every
accepted conversion on L3 and HC, both orders (159 and 69 falling player-runs); medians unless stated; L3 / HC.

| | before M4 (`fall=off`) | step 1 (`fall=v1`) | now (`fall=on`) |
| --- | --- | --- | --- |
| falling players reacting | takedown holds only | 159 / 69 of 159 / 69 | 159 / 69 |
| knee flexion at first ground contact | 65 / 73 deg | 89 / 112 deg | 89 / 112 deg |
| knee flexion when the body lands | 58 / 68 deg | 91 / 95 deg | 92 / 94 deg |
| carry tuck kept (carry upper arm within 40 deg of its tuck throughout) | 14 of 86 / 7 of 39 | 73 / 29 | 75 / 29 |
| carry arm's largest deviation | 73 / 58 deg | 25 / 25 deg | 25 / 25 deg |
| braces landing on the palm | 3 / 0 | 154 / 76 | 148 / 76 |
| palm on the floor: first touch; in the first 0.6 s | 8 ms; 13 ms | 8 ms; 58 / 100 ms | 8 ms; 65 / 96 ms |
| palm within 6 cm of the floor after it lands | | 108 / 112 ms | 83 / 117 ms |
| arm work given back after the palm lands (spring-back): median, p90, total | | 1.2 / 1.3 J, 9.6 / 8.9 J, 505 / 236 J | 0, 0.01 J, 0.6 / 0.5 J |
| elbow flexion in 0.3 s after the palm lands; re-extension after its deepest fold | | 41 / 34 deg; 40 / 43 deg | 52 / 48 deg; 40 / 39 deg |
| landed braces let go when unloaded | | 0 (held to the fade) | 128 of 149 / 66 of 76 |
| palm rise in 0.6 s after it lands | 0.16 m (3 landings) | 0.31 / 0.21 m | 0.32 / 0.26 m |
| upper arm over 10 cm in own trunk (player-s, L3 and HC) | 46.9 (all limp arms) | 55.1 (14.6 in a landed brace) | 49.3 (1.9 in a landed brace) |
| ragdoll leg axis in own leg or trunk (s) | 12.2 / 4.2 | 12.8 / 3.5 | 17.4 / 3.7 |
| ragdoll legs deep in each other (s, all families) | 34.5 | 28.2 | 30.1 |
| ragdoll joints past the impossible line (s) | 17.8 / 5.7 | 5.9 / 3.7 | 7.0 / 3.7 |
| ragdoll snaps, L3 / L4 / HC | 0 / 2 / 0 | 0 / 2 / 0 | 1 / 2 / 0 |
| fall work (cap 100 J): median, max | | 30.2 / 27.4, 63.6 / 56.7 J | 27.4 / 26.3, 56.6 / 50.6 J |
| runs with a substep over the power cap (each one impact-tagged substep) | | 7 | 5 |
| passive energy L3 / HC (largest solve); L4 | 864 (48) / 587 (60) J; 442 J | 1217 (146) / 665 (64) J; 442 J | 1313 (134) / 638 (64) J; 442 J |
| worst shape-query tick (limit 4000) | 3574 | 3668 | 3668 |
| rejected conversions (rigid figures) | the labelled invalid ones | unchanged | unchanged |

- The reaction (step 1) takes the impossible joint time down by two thirds on L3 (mostly limp shoulders twisting) and
  keeps the ball tucked in most falls. 27 player-runs convert at a moved time (0.07 s earlier to 0.12 s later). Apart
  from the two below, every changed summary has the same result and end representations.
- The palm load (step 2) removes the arm's spring-back: from the palm's landing every command on the arm opposes its
  joint's motion, and the arm gives back no work. The elbow still re-opens about 40 deg after its deepest fold, now
  passively (the body's motion, and the limp arm once let go), not by the drive. The palm's time on the floor did not grow (below).
- The leg-axis rise on L3 under the palm load is mostly L3-F16-handoff's carrier, his right thigh's axis 0.57 cm into
  his trunk for 1.8 s in each order: a sub-centimetre trend.
- The palm load's power-cap row: L3-F1-phase7 forward, the defender, one impact-tagged substep at 160 W (the tracked
  `IMPACT_OVER_POWER` class, `tests/fall-defects.test.ts`; realized power is printed, not gated, since ladder 15).
  Three of step 1's seven are gone.

## Who falls

Times are when the support loss starts (forward / reversed). No result or referee ending changes in any run. The
palm-load flip changes no fall outcome. L3-F1-low's runner still falls (0.76 s, both orders).

| fixture | player | before M4 | now | changed at |
| --- | --- | --- | --- | --- |
| L3-F4-gripTarget | defender | stays up | falls 1.88 / 1.88 s | step 1 |
| L3-F9-convert-free | defender | falls 0.87 / 0.87 s | stays up | step 1 |

## Known issues

- **The palm touches, it does not plant.** Its first floor contact lasts a median 8 ms and it is on the floor 65 to
  96 ms of the first 0.6 s, as under the springs. The 20 N m elbow cannot carry the body's weight, so the arm folds
  within about 0.1 s, the forearm lands, and the hand rises as the body rolls (0.26 to 0.32 m in 0.6 s). It no longer
  springs back; it does not yet read as catching weight. Carrying weight needs a stronger elbow inside the falling
  owner budget (350 N), out of this slice's scope (tolerances).
- **A near-straight arm takes the landing as a column** (32 to 105 N s through the palm) where the brace's elbow is at
  its 12 deg minimum; a 30 deg minimum did not help (above).
- **A released arm is limp**: nothing damps the passive elbow toward its straight stop (`LANDING_ELBOW_SNAP` below).
- **The front wrap's defender still crosses his legs** (L3-F19-front forward: his left thigh and right shin 16 cm into
  each other, 0.75 to 2.05 s; axis crossing 0.50 s before M4, 0.27 s now). The response flexes both legs alike and
  nothing steers one leg off the other.
- **HC-F3-lowRunner's held carrier no longer hangs in a stride**: both hips flex (left 51 to 119 deg, right 7 to
  59 deg), the knees bend 50 to 130 deg, the largest hip split 122 deg before and 66 to 73 deg now. Whether it reads
  as running is for the lab look.
- **The ragdoll shoulder twist** (prerequisites handoff `SHOULDER_TWIST_REBOUND`): L3-F16-handoff's carrier, his left
  shoulder 66 deg past range at 3.75 s under the palm load, long after his arm let go; the limp arm from the same
  state (3.2 s) goes 79 deg past. Reached by the moved trajectory.
- **Tracked defects** (`tests/fall-react-defects.test.ts`, each pinned on a capture shortly before it; each test
  fails once its defect is gone from that state):

  | defect | capture | under the reaction / twin from the same state | across L3 and HC |
  | --- | --- | --- | --- |
  | `LANDING_REBOUND`: the solver's rebound off a limb under the body. The carrier lands on his tucked carry arm and one solve throws his trunk up, the efforts' own work under 5 J | L3-F1-phase4@68 (1.133 s, `FALL_REACT_V1`) | 146 J / 113 J with every effort off | older (M2's `CARRY_PINCH` up to 166 J); the largest solve 48 J before M4, 146 after step 1, 134 now |
  | the same, reached by the palm load: the loaded left arm yields and the trunk comes down on the tucked right arm | HC-F3-phase75~rev@57 (0.950 s, `FALL_REACT_V2`) | 34 J off his right upper arm alone, the efforts' work about -4 J / under V1's springs from the same state nothing over 0.5 J | the palm load moved the passive gains L3 1217 to 1313 J, HC 665 to 638 J |
  | `UPPER_ARM_IN_TRUNK` (M2's: the upper arm has no own-trunk shape, ladder 13c parked): the bracing free arm reaches across the chest and its contact springs held the upper arm 10 to 12 cm in the drawn trunk | L3-F1-phase5~rev@48 (0.800 s, `FALL_REACT_V1`) | at least 20 ticks over 10 cm / arms off: under 10 cm, out by 1.25 s | 49.3 player-s, 1.9 in a landed brace (the palm load lets go), 6.3 seeking |
  | `LANDING_ELBOW_SNAP`: after the brace lets go the carrier lands on the arm and the passive elbow is thrown straight, about 100 to 2 deg in two drawn frames | L3-F9-low~rev@58 (0.967 s, `FALL_REACT_V2`) | 61.6 rad/s / every effort off 61.4 rad/s (V1's springs 52.5) | the only L3 or HC ragdoll snap |

  None is introduced or made worse by the step that reached it, so none blocks: each twin shows the mechanism
  without the step's effort (the limp arm snaps, the limp body rebounds), or shows the step placing a limb the
  mechanism already acts on (the yielding arm under the body, its work negative). The rebound and the snap are the
  solver's and the passive joint's; their fixes are their own steps.

## Lab

Port 5180. Add `&fall=v1` for the landed brace on springs (before the palm load) and `&fall=off` for before M4 (limp).

- A carrier converted mid-run: knees bend, the ball stays tucked, the free arm reaches and lands:
  `?fixture=L3-F16-handoff&cam=side&speed=0.25&t=2.50`.
- The palm landing and the arm giving under the body (palm down at 0.66 s, let go when the body rolls off):
  `?fixture=L3-F9-convert-free&cam=side&speed=0.25&t=0.45`.
- The held carrier's legs (`HC-F3-lowRunner`, ragdoll from 0.77 s): `?fixture=HC-F3-lowRunner&cam=side&speed=0.25&t=0.70`.
- The front wrap, the defender's crossed legs: `?fixture=L3-F19-front&cam=front&speed=0.25&t=0.70`.
- A low tackle, both falling (the runner from 0.76 s): `?fixture=L3-F1-low&cam=side&speed=0.25&t=0.70`.
- Who falls: `?fixture=L3-F4-gripTarget&cam=front&speed=0.25&t=1.75` (the defender now goes down at 1.88 s);
  `?fixture=L3-F9-convert-free&cam=front&speed=0.25&t=0.75` (the defender now stays up).
- Tracked: the elbow snap `?fixture=L3-F9-low&order=rev&cam=front&speed=0.25&t=0.95`; the rebound off the tucked arm
  `?fixture=HC-F3-phase75&order=rev&cam=side&speed=0.25&t=0.95` and `?fixture=L3-F1-phase4&cam=side&speed=0.25&t=1.10`;
  the upper arm in the trunk under the springs `?fixture=L3-F1-phase5&order=rev&cam=front&speed=0.25&t=0.80&fall=v1`.
