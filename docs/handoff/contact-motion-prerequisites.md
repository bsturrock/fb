# Contact-motion prerequisites handoff: the ladder

Open items and the user's lab review list: [prerequisites ladder](../open/contact-motion/prerequisites-ladder.md).
Sequence: [contact motion](../open/contact-motion/README.md). This work comes after M1
([contact-motion.md](contact-motion.md)) and before M2.

The work is on branch `prereq-ladder`, cut from `a6d712f` (M1) and built in the worktree
`~/.claude-wt/football-sim-7-ladder`: 61 commits to `8a6af97`, the close-out docs, then ladder 13 (four commits to
`599dc57`, and its docs), the full check's speed-up (`69ae0bb` to `29c785b`) and ladder 14 (`c81146e` to `8f3ce6e`).
It is not merged into `model-integration`, and the repository has no remote. Replacing that branch's old uncommitted
stack is the user's decision (plan doc, "Replacing the old working tree").

Ladder 13 (2026-11-12) took the user's three look rulings: the fallen arm bent the wrong way overhead (13a), legs
planted and still in a stationary hold (13b), and the elbow and upper arm inside the own chest (13c). Each landed off;
13a's and 13c's flips are parked, and 13b's was registered in 14a. Ladder 14:

- **14a** registered 13b's still feet. It first replaced the coverage floor that blocked it (`c81146e`), then made the
  flip (`809d9aa`).
- **14b** fixed what 13c left at its source: a clip arm's held departure carried across the chest
  (`CLIP_ARM_HELD_DEPARTURE`). It landed off (`clipArmSwing`, `8f3ce6e`), and its flip is parked.

**Result at the tip** (full check `.scratch/ladder/r14b-flagoff/` in the main checkout). Every step after 10e is
byte-identical to 10e except 14a-ii, which changed four summaries. 13a-i changed only the visible meter:
- The suite passes 383/383 in 41 files (250 at the start); after ladder 15's gate tests (below) 395/395 in 42 files,
  `.scratch/ladder/r15-c-energy-conv/`. Typecheck and build pass. 411 fixtures export, equal to `evidence/summary.json`.
- G, L1, L2 and RH summaries and traces are byte-identical to `a6d712f`. Summaries changed: L3 59 of 98, L4 70 of 75,
  HC 21 of 22.
- Leg matrix: none over a ceiling. L4 matrix: one row over the power ceiling (`IMPACT_OVER_POWER`, tracked). The worst
  shape-query tick is 3588 (the budget is 4000).
- The full check takes 220-250 s since ladder 14-speed (it took 396 s): the suite alone 141 s on a quiet machine, 161 s
  with the lab open in a browser, then one pass of every fixture and order with every meter attached, 74-83 s. A step
  that changes no file the pass runs (docs, test files, test data) can take the pass from the previous result
  (`CHECK_REUSE`, `scripts/check/README.md`): the suite and 5 s.

**What players visibly do now.**
- A falling or fallen player's hips and knees stay within what a body can do. Its legs no longer pass through each
  other or its own trunk.
- A standing player's legs are solid to falling players: a falling arm, leg or body meets the shin or thigh, and both
  are pushed.
- Two players in a still hold keep their feet planted (14a).
- Otherwise supported players look as at M1, because every other supported-side step is landed off.

## Behaviour registered on L3, L4 and HC

`src/sim/fixtures/index.ts` maps the registry through `visibleFlip` (8m), then `ownLegFlip` (9d), then `legFlip`
(10d), then `holdStillFlip` (14a). `tests/runs.ts` `preFlip`, `preOwnLegs`, `preV3` and `preHoldStill` give a
definition as before each one, for captures and natural samples taken earlier.

| What | Flag / helper | Mechanism | Where |
| --- | --- | --- | --- |
| Hip stops | `HIP_STOPS_V2` (`hipStopsFor`, `withHipStops`) | Rapier per-axis angular limits on each spherical hip: a box in an anatomical frame per side (flexion 125, extension 30, abduction 50, adduction 30, rotation 45), read as Rapier does, 2 atan2(e_i, w). A conversion outside it starts at a widened stop that closes with the joint (cap 172). On L4 too (8k), where the soft hip envelope now only bounds fall-response targets. | `joint-stops.ts`, `ragdoll.ts` |
| Approach zone | `HIP_APPROACH_V1` (in V2) | A damped one-sided spring 10 deg inside each stop, passive as stepped. Fall-response hip targets are held inside it. | `joint-stops.ts` |
| Knee stop 140 | `withKneeStop` | The hinge's upper limit goes from 150 to 140, with the same widen-and-close start. Fall-response knee targets are held at the stop. | `joint-stops.ts` |
| PGS +4 | `withAdditionalPgsIterations` | Each segment body asks for 4 more internal PGS iterations per substep. | `ragdoll.ts` |
| Conversion retry | `CONVERSION_RETRY_V1` | A candidate rejected for `externalPenetration` is deferred (`handoffDeferred`; the pose guard keeps working) and tried again each substep for 0.25 s, then rejected for good. The 1.5 cm check is unchanged. | `conversion.ts`, `simulation.ts` |
| Own-leg contact | `SELF_LEGS_V1` (`withSelfLegs`) | Massless self shapes 1 cm smaller than drawn (distal half thigh, shin, shoe): legs meet each other, shins and shoes the own trunk. A group overlapping at the switch stays out until clear. The impact guard reads them. | `ragdoll.ts` |
| Physical supported legs | `LEG_GUARD_V3` | V2 (`sweep`): the shown leg step is judged against physical bodies, tries other knee poles and offsets, and is swept in 1 cm samples; plants take a knee pole first (7, 7b). `physicalLegs`: six massless colliders on the proxy, placed from the achieved pose, live only on static ground (probe `ok`, 10b) and until the conversion request, meeting other players' ragdoll segments only; the guard clears the posed legs to 1 mm. | `pose.ts`, `pose-runtime.ts`, `physics.ts`, `simulation.ts` |
| Fall response L4 v6 | `FALL_L4` | The impact guard reads the joint residual (4a) and every manifold point (4b). `carried` (6c) holds the body for a landing carried through a contact; it acts only with physical legs. | `fall-response.ts`, `simulation.ts` |
| Solved impulses | `SolverProfile.solvedImpulses` (7c) | Contact records, support contact, leg ledger and self-trunk impulses read Rapier's solved contacts. A manifold point outside the at most four solved reads 0. L3/L4/HC only, because it moved G/L2/RH. | `physics.ts` |
| Still feet in a hold | `HOLD_STILL_V1` (13b, `withHoldStill`; flipped in 14a) | A player holding or held (a grip or clamp within the last 0.25 s), its body under 0.3 m/s, takes no step home, settle or turn step; a foot that cannot keep its plant still steps. On every L3, L4 and HC foot planner (L2's is unchanged). It changed four summaries (the three L3-F6 holds and L4-F5-twoPalm-on), with no result, ending or who-falls change. The plan 10b coverage floor it lowered became coverage by kind outside a stationary hold (14a-i) | `footwork.ts` |

These have no flag: the arm-task twist window anchored once per substep (rung 3, `arms.ts`; it moved L3/L4/HC); a
brace pressed on a body at the end of its window misses `obstructed` (9e); and three byte-identical query savings
(1, 5b, 9g).

## Landed off (no fixture uses them)

| Flag | Mechanism | Where |
| --- | --- | --- |
| `impactGuard.selfTrunkBody` (9f) | A limb's own-trunk pair (forearms, shins, shoes) closing faster than `bodyClosingMPerS` holds the whole body | `fall-response.ts` |
| `JOINT_RANGE_V3` `hipTwist` (11b) | The supported shin is turned about the thigh into the hip envelope's twist range less 5 deg, rate-limited (`fitThighTwist`) | `joint-cone.ts`, `pose.ts` |
| `LEG_GUARD_V4` `ownLegs` (11c) | A knee-pole placement whose bone axes come nearer the other leg than the primary's do is not taken | `pose.ts` |
| `SELF_CLEARANCE_V2` `seamSettle` (11d iii) | The own trunk's share of an arm's continuity push halves each time it turns against the one before | `pose.ts` |
| `JOINT_RANGE_V4` (11d ii) | The M1 twist window works in `limbAnatomicalTwistRad`: the envelope's measure up to horizontal, regular overhead. `guardEnvelopeTwist` keeps the envelope's twist in range | `joint-cone.ts`, `pose.ts` |
| `JOINT_RANGE_V5` (12b) | V4 plus `fitMaxMps` 6: the M1 elbow fit moves the elbow at most 6 m/s | `pose.ts` |
| `SHOULDER_TWIST_ANAT_V1` (13a, `withShoulderTwistLimit`) | The ragdoll shoulder's twist limit reads the anatomical twist (regular overhead) instead of plan 09's measure, which fades at the pole | `ragdoll.ts` |
| `SelfClearanceProfile.upperArm` (13c, `withUpperArmClearance`) | The supported upper arm's distal half (at the forearm's radius) joins the arm's self shapes: candidate depth, the arm task's validity and the continuity push, whose target stays within the arm's reach of its shoulder | `pose.ts`, `arms.ts` |
| `SelfClearanceProfile.clipArmSwing` (14b, `withClipArmSwing`) | A composed arm another body has met keeps its clip swing. While met, a clip arm takes its plain clip candidate whenever that is clear of its own trunk. Its departure moves back toward the chosen pose as fast as the clip's target moves, and a push that leaves it invalid is not kept. Squeezed between the other body and its own trunk, a met arm gives up the part of its departure that carries it into its trunk, and loses the other body's push share toward it. Arm tasks and arms nothing has met are unchanged | `pose.ts` |
| `SelfClearanceProfile.metArmStay` (16b, `withMetArmStay`, lab `armstay`) | A composed arm another body has met (clip, procedural, brace, ready hands, the carry tuck) keeps its natural pose. It keeps its request while it presses at most `HARD_OK` into the other body (another player's arm task included), swings out continuously past that, else hangs at its side; never a raised or forward alternative. The carry arm keeps its tuck whatever presses it. Its shown departure moves at most `CONT_FAST_MPS`; a push is never kept and never carries it more than `MET_ARM_OWN_M` (3 cm) into its own trunk; a departure that would is given up with its elbow pole. While its player's handoff is deferred it is pushed clear as registered. With it `clipArmSwing` changes nothing | `pose.ts`, `pose-runtime.ts` |

Kept but unregistered: `LEG_GUARD_V2`, `HIP_STOPS_V1` (no zone, lab `hips=v1`), `HIP_STOPS_L4_V1` (8g's L4 backstop,
`hips=l4`). Every one of the flips is parked (below).

## Gates (2026-11-12)

Ladder 15 (`7bfe068`, `b825dcb`, `9bd8041`; tests only, every summary, trace and matrix byte-identical) puts the
whole-run tests on the visible bar (CLAUDE.md rule 6, the owner's ruling). Tests of G, L1, L2 and RH keep their
assertions. Elsewhere a whole run or natural sample blocks only on:

| What | Blocks when | Where |
| --- | --- | --- |
| Limb in its own or another body | deeper than 10 cm in any substep, past 5 cm for 0.10 s on end, or its bone axis inside for 0.10 s | `tests/visible-bar.ts` `limbInBody`; `body-limits.test.ts` (pose arms, arm-task arms, ragdoll forearms) |
| Pose pop at a boundary | a joint landmark jumps more than 5 cm in one substep, or the 60 rad/s snap | `l3-pass.ts` AUDIT, RAW_KEPT, LANDINGS, RECONTACT, CARRY_AUDIT (`POP_M`) |
| Planted foot, root | a failed or held plant slides more than 5 cm; the root more than 10 cm over its target, on the launch fixtures (L3-F6-saturated, L3-F7-loadRelease: lifts and kicks raise the root by their own motion) | `l3-pass.ts` PLANT_ROOT (`plantRootBreaches`) |
| Joint past its range | more than 15 deg past for 0.25 s on end | `visible-bar.ts` `jointPastRange` (body-limits ragdoll shoulders); `loaded-limb.ts` `deepRunS` (every L4 fall) |
| Conversion | a rejected handoff leaves a rigid falling figure; an accepted conversion has a limb more than 5 cm through a torso, either way round | `handoff-contact.test.ts` (`torsoBreach`) |
| Energy | the explosion gate: a limit returns no more than it absorbs or 40 J, no body over 9 m/s; L4-F8-passive gains under 40 J | `falls.test.ts` |
| Coverage | every kind occurs at least once outside the excluded phases | `l3-contracts.test.ts` (continuity, foot limit, carried ball) |

Report-only now, printed by the tests on console lines tagged `(ladder 15 meter)` (`l3-contracts`, `body-limits`,
`falls`, `handoff-contact`, `hip-approach`), one per fixture group: pops over 1 cm, plant slides and drift, root peaks,
the deepest limb per source, shoulder excess, the loaded-limb free/bound/return times, the accepted-handoff anchor 5 mm,
landmark 1 cm and penetration/floor 1.5 cm, the first solved step's torso depth, the L4-F1 soft mean against its load
(was 0.25 deg), the L4 realized power past the 5% tolerance (also `l4mx`), the L4-F8-passive energy change (was 0.3 J)
and the coverage counts. `energymx` carries each run's injection past 0.5 J.

Unchanged: constructed rigs (stops, `HARD_OK` rigs, identities, conservation), determinism, resume and byte-identity
tests, class-A rows, class-C budgets, capture-based mechanism tests (their `INJECTION_J` 0.5 J is a pass input; the
hip-approach regression reads its rebound window, solves 60-90), and the work and plan caps. Not settled by the
values above and left as they were: the `HOLD_SETTLES` 50 ms gap, `STANDS_STILL` 2 mm and `TOE_OFF`. Each new rule's
fault twin: constructed series (`visible-bar.test.ts`, `unseenChase`, `plantRootBreaches`, `torsoBreach`), an 8 cm
owner-change jump, a shoulder held 100 deg behind on L4-F8-passive (`holdArmBehind`), and a 3 m/s kick on L4-F8-passive.

## Key decisions and why

- **Hard stops through Rapier's raw per-axis limits.** Rapier 0.21's JS has no public limits on spherical joints and
  no joint softness, and the soft envelopes left 258.7 player-s of impossible ragdoll joints. `setAngularLimits`
  (`joint-stops.ts`) is the one call into the raw joint set, and `tests/joint-stops.test.ts` fails if a Rapier upgrade
  changes it. The box reads Rapier's own measure (8g); 8d's 2 asin(e_i) made the stop seem early.
- **An approach zone inside the stops.** Stops alone made a rebound: L4-F2-side-off R gained 4.19 J with no contact.
  With the zone, no solve gains over 0.5 J (`hip-approach.test.ts`).
- **The box on L4, not the L4 envelope narrowed to the human range** (8k, `.scratch/ladder/r8k-choice/`). Both remove
  hip implausible time. The box also cuts deep own-body overlap from 332 to 134 player-s (narrowed: 248), and adding the
  narrowed envelope inside it changes nothing.
- **Knee 140, not 145.** At 145, own-body overlap is 394 against 326, with a 67 J L4 gain. The knee stop alone moves
  the bend into the free hips, so knee, hips and PGS flipped as one step. The user chose 140.
- **Iterations not flipped alone** (8a): PGS +4 cut injected energy 5006 -> 1594 J but removed no rebound, added an
  L4 ceiling row and changed nothing visible. It was chosen with the stops and own legs (PGS 2 and 8 read worse).
- **Own-leg contact holds groups, not pairs**: a held pair let its crossed neighbours take force and lock the legs
  crossed. The 1 cm skin keeps resting contact free of force.
- **A deferred conversion, not a looser tolerance** (8j). Rejected candidates were clear 5-22 substeps later.
- **Physical legs off over a refused surface** (10b), the one mechanism V3 introduced: D was kicked up 28.7 cm by its
  own shin. The old tree chose the opposite.
- **Judging a flip:** every suite failure is classed (by construction, natural sample, behaviour); behaviour is
  twinned. Natural samples keep the profile they were taken under, never a re-pinned number.
- **Visible quality is the primary measure** (2026-11-11, after the user's screenshots of fallen bodies). User
  rulings: the fixed joints "look much better"; changed outcomes accepted, including the lost L4-F5-onePalm-on hold;
  knee-downs from solid legs "ok for now"; each flip landed unattended as its own step, listed for the morning review.
- **A coverage floor follows a flip only by kind** (14a). The plan 10b floor asked for over 30,000 step substeps, and
  the still-feet flip removes steps by its definition. Lowering the number was not allowed, so the floor became "every
  kind of planner step is checked outside a stationary hold". It has its own fault twin (`FootDebug.noVoluntarySteps`).
- **Arms through the body are fixed at the source, not guarded harder** (14b). The user's acceptance bar is gross
  pass-through: past 10 cm, or a bone axis inside the trunk or head. Centimetre overlap and brushing do not count,
  and no push may distort the pose to remove them. 31 of the 32 player-s of forearm in the own trunk came after contact,
  from a held departure, not from a brace or reaction layer. So 14b stops the departure being carried with the clip,
  and adds no guard. The upper arm (13c) is not needed for the forearm and hand. It is still needed for the upper
  arm's own pass-through, once its own blockers are fixed (`parked/clip-arm-swing-flip/README.md`).

## Tooling

- **Full check** (`scripts/check/README.md`): `full-check.ts <dir>`, then `compare.ts <a> <b>`. Results go to
  `.scratch/ladder/<step>/`, about 1 MB each. It compares the suite by message, summaries and traces per family, and
  the leg, L4, query, passive-energy (`energymx`) and **visible-quality** (`visiblemx`) matrices. `visiblemx` reads
  drawn-frame joints against human ranges, plus overlaps and snaps, with lab links. It exits 1 only on a new suite
  failure or a changed G/L1/L2/RH output.
- **Captures and twins** (`tests/state.ts`, `scripts/capture-state.ts`, `tests/README.md`): the full state at a tick,
  resumed byte for byte; a twin is `resumeState(cap, { def, variant })` or `{ faults }`. 30 captures in
  `tests/data/state/`; `tests/seed.ts` is the older seed behind `headplant` and `corerock`.
- **Rules as tests:** `tests/loaded-limb.ts` (7f), `tests/passive-energy.ts` (7g), `tests/visible.ts` (8c).
- **Lab parameters** (`src/lab/lab-params.ts`): `order=rev`, `legs=v1|v2|v3`, `hips=on|l4|v1|off`, `pgs=<n>`,
  `knees=off|140|145`, `retry=on|off`, `selfleg=on|off`, the ladder 13 flags `armtwist=on|off` and `upperarm=on|off`,
  and the ladder 14 flags `holdstill=on|off` (registered since 14a) and `armswing=on|off`. `armtwist=on`,
  `upperarm=on` and `armswing=on` each show a parked flip. Before-views (each equals the earlier registration on all
  195 L3/L4/HC fixtures, `r10d-v3-flip/lab-views.txt`):

  | as it was | add |
  | --- | --- |
  | before 8m | `&legs=v1&selfleg=off&hips=off&pgs=0&knees=off&retry=off&holdstill=off` |
  | after 8m | `&legs=v1&selfleg=off&holdstill=off` |
  | after 9d (through 10b) | `&legs=v1&holdstill=off` |
  | after 10d (through 13c) | `&holdstill=off` |

  Rungs 3 to 7c have no lab view. Serve the lab from the ladder worktree (`npx vite --port 5180 --strictPort`). The
  dev server in the main checkout (pid 35012) serves the old tree.
- **Who falls against the start:** `.scratch/ladder/r10d-v3-flip/tools/netfalls.py`.

## Measured result: 8c to the tip

Player-seconds over every L3/L4/HC fixture, both orders (`r8c-visible-checks` to `r14b-flagoff`). 8c is the tree
after rungs 1-7, the first visible measure.

| family | ragImpS | ragImplS | supImpS | ragSelfLegAxS | ragSelfDeepS | supSelfLegAxS | crossLegSupRagS | kneeStopS | ragSnap60 | supSnap60 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L3 | 157.9 -> 0.8 | 235.5 -> 3.6 | 1.0 -> 1.0 | 100.9 -> 2.3 | 284.7 -> 89.0 | 9.3 -> 10.7 | 1.69 -> 0.45 | 16.4 -> 0 | 1 -> 0 | 15 -> 16 |
| L4 | 0.9 -> 1.5 | 188.0 -> 3.4 | 0.5 -> 0 | 254.2 -> 21.7 | 416.3 -> 44.4 | 3.1 -> 2.0 | 1.78 -> 0 | 103.3 -> 0 | 4 -> 0 | 33 -> 28 |
| HC | 99.9 -> 2.5 | 157.7 -> 4.5 | 4.4 -> 4.2 | 63.2 -> 3.4 | 184.3 -> 40.3 | 6.7 -> 6.5 | 1.26 -> 0.20 | 7.8 -> 0 | 0 -> 0 | 1 -> 1 |

The impossible time was nearly all L3/HC hips, which had no limit; the deep own-body overlap left is mostly arms on
the trunk; the L3 supSelfLegAxS rise is V2's sweep paths. Passive energy: L3 1150 -> 804 J (largest 128 -> 48), L4 2907 -> 531 (122 -> 58), HC 949 -> 423 (197 -> 48). Of
the 464 injecting solves left, 387 (1653 J) follow a larger loss in the tick before (rebound).

13a-i changed the meter, not the sim: shoulder rotation is read in the anatomical twist (regular overhead), as the
user's ruling on question 1 asked. At the tip (`r14b-flagoff`) the ragdoll shoulder rotation past the impossible line
reads 31.5 player-s where the old reading found 2.5, so ragImpS reads L3 11.35, L4 17.67, HC 4.77, ragImplS 14.5,
29.0, 10.8, and L3 supImpS 1.17; every other column is as in the table.

## Who falls, against the ladder's start

The start is `a6d712f` (`r0-baseline`); a time is when the fall starts. Lab links are in the plan doc's morning
review. Net: 16 player-runs now fall that stayed up, and 8 now stay up that fell. Rigid falling figures (rejected
conversions) are only the three fixtures built for it, as at the start.

| fixture | order | player | at the start | now | changed at |
| --- | --- | --- | --- | --- | --- |
| HC-F3-mirror | reversed | defender | stays up | falls 1.75 s | 3 |
| HC-F3-phase0 | forward | defender | falls 1.18 s | stays up | 8m |
| L3-F1-low | both | defender | falls 1.70 / 1.65 s | stays up | 3 (fwd), 9d (rev) |
| L3-F1-mirror0 | both | defender | stays up | falls 1.39 / 1.45 s | 8m |
| L3-F1-mirror4 | reversed | defender | stays up | falls 1.50 s | 8m |
| L3-F1-phase0 | forward | defender | falls 1.17 s | stays up | 8m |
| L3-F1-phase5 | reversed | defender | stays up | falls 1.60 s | 3 |
| L3-F1-phase7 | forward | defender | stays up | falls 1.54 s | 10d |
| L3-F4-gripTarget | both | defender | falls 1.82 s | stays up | 10d |
| L3-F9-convert-free | both | defender | stays up | falls 0.86 s | 10d |
| L4-F3-run-off | both | defender | stays up | falls 0.86 s | 10d |
| L4-F10-knee-on | both | defender | stays up | falls 0.69 s | 10d |
| L4-F3-run-on | both | defender | stays up | falls 1.12 s | 9d |
| L4-F9-free | both | defender | stays up | falls 1.12 s | 9d |
| L4-F5-twoPalm-on | both | runner | falls 2.17 s | stays up | 8m |

## Open defects

These are handled under CLAUDE.md rule 5. Captures are in `tests/data/state/`, and other states and twins are in
`.scratch/ladder/`.

- **`IMPACT_OVER_POWER`** (the one L4 ceiling row): L4-F9-low reversed R, 161.5 W at 1.0875 s (cap 157.5). Its right
  forearm hits its own trunk. The guard holds only that arm (plan 11), and the hip and knee effort realizes the jolt.
  V1 from 0.833 s gives the same. Test: `fall-defects.test.ts` on `L4-F9-low~rev@50`, with an older instance at
  `L4-F3-run-on@96`. `selfTrunkBody` fixes both, but its flip is parked. Proposed fix: read an own-trunk hit from what
  the solve will take (the pair's penetration, pinning or predicted impulse), not its closing speed. Test it at those
  captures and at the three states in `parked/self-trunk-flip/10f/`.
- **Rebound energy** (the largest passive-energy class: brace rebounds, hip-stop impact rebounds). After an impact the
  next solve gives part of the loss back. On L4-F9-contact (V1), solves 249-250 take out 135 and 244 J as R's palm
  lands, and solve 251 gives back 73.0 J. Test: `ragdoll-iterations.test.ts` on `L4-F9-contact@61`. Iterations shrink
  it; none removes it. Cause (`.scratch/ladder/pinch/README.md`): the solver does not converge on a fallen body's
  closed loops, warm-started from the impact. The fix needs warm-start or impact handling that Rapier 0.21's JS lacks;
  check what a Rapier upgrade exposes.
- **Self-trunk pinch:** a forearm pressed into its trunk by the floor gains energy in one solve. L4-F9-contact
  reversed R (V3), solve 270, +7.70 J. Capture `L4-F9-contact~v3-rev@63`; with 3 extra PGS iterations it reads -5.87 J.
  At the tip there are 21 pinch solves (32 J). A backup idea is one gap-free trunk hull for the self shapes.
- **A rigid proxy rebounding off a ragdoll:** on L3-F9-noProbe-prep, D's pelvis bounces 13.9 cm off R's shoe at
  0.917 s (V1 from 0.750 s: 12.85 cm). On L3-F9-noProbe-free, D bounces 24.2 cm at 1.1 s. The user accepts it as a
  look for now (question 7).
- **A physical leg starting a solve inside another ragdoll:** at worst 1.85 cm (HC-F2-bothFallL2 rev A's right
  shoe in B's trunk, 0.683 s), and 2.3 cm for 0.05 s (L3-F1-phase2 and L3-F4-oneArm D's left shin in R's shoe,
  1.233 s), against `PHYS_LEG_OK` 1 mm. Small; no test.
- **`SHOULDER_TWIST_REBOUND`** (blocks 13a's flip; replaces `SHOULDER_POLE_TWIST`): HC-F5-strictTransfer R lies with
  its right arm overhead, bent the wrong way (the user's ruling on question 1), because plan 09's twist limit fades at
  the pole. `SHOULDER_TWIST_ANAT_V1` brings it back inside (`shoulder-twist.test.ts` on `HC-F5-strictTransfer~v3@100`),
  but the limit is still plan 09's spring (400 N m/rad, about 0.3 of critical for a bent arm), and an arm lifted past
  it stores the impact and gives it back: L4-F10-elbow-on R's left shoulder snaps 86 deg in a frame at 0.517 s, and
  solves gain 8.2 J (HC-F3-phase75 rev D) and 3.1 J (L4-F9-low rev R). Same-state twins in `assess-13a/caps/`. Fix
  (13a-iii): step the term as 8g's approach zone is stepped (`parked/arm-twist-flip/README.md`).
- **The solved-impulse reading misses coincident manifold points:** L3-F1-phase6 reversed, solve 266. Points 2-4
  share one position and one solver contact. Rapier wrote 15.53 N s to point 4, but the match gives it to point 2, so
  the pair reads 0. The energy meter uses max(solved, raw). Still to check: which records read 0 for a real contact.
- **Rapier's hip-stop correction at a combined pose** turns mostly Z at flexion 110, so the Y stop overruns by
  11 deg. Seen only in the 8g probes.
- **L4 supported limbs switch placement in one frame** (28 snaps). L4 supported players have no suspension, so their
  poses have no `ground` and no plan 07 continuity. Example: L4-F9-crowded D's right arm goes from hanging to overhead
  at 0.067 s and back at 0.217 s (`assess-11d/snaps.txt`). Fix: continuity without ground, L4 only, behind a flag,
  after the user's look.
- **A raised arm held up under the anatomical window** (blocks the arm pair): L3-F6-holdMirror R's right arm from
  1.65 s to the end. The envelope's twist reads -113 to -128 deg, the anatomical -68 to -83 (`assess-12b/twins.txt`).
  Fix in the window or the guard, or the user accepts the arm and the meter reads the anatomical twist.
- **A falling proxy's thigh sliding in a ragdoll shoe at HARD_OK** (blocks 11b): under V3 it is 1.16-1.20 cm deep
  (HARD_OK 1.2) on L3-F11-invalid and HC-F5-invalidOne, both orders, from about 1.88 s (`assess-12a/`). The fix is the
  guard's, and it moves V2 runs too.
- **`HOLD_LEG_CLEARANCE`** (blocks 11c; replaces "footwork plants a held foot by the midline"): on L3-F6-hold the
  defender steps in the still hold at 2.15 s, its step, held off its home, sweeps the runner's planted left leg at
  3.18 s, and that foot plants by the midline at 3.70 s. Under V3 the runner's knee then tucks behind the other from
  3.90 s; under V4 the foot steps out at 4.02 s and plants again at 4.33 s (`own-legs.test.ts` on `L3-F6-hold@231`).
  `HOLD_STILL_V1` removes the voluntary steps. What it leaves is forced: the clearance solve releases the runner's plant
  when the defender's swaying leg meets it, and the held-off step chases a lifted clearance variant
  (`hold-still.test.ts` on `L3-F6-hold@126`). Fix the release in a still hold, or the stance width.
- **A palm target inside the arm's minimum reach** (21.9 cm) turns the reach direction 62 deg in a frame (L3-F1-phase7
  D, V4). Plan 07a's `stableReach` fixes it. It is not landed, because under V5 only one frame reaches it
  (`r12b-twist-fit/mechanism/`).
- **Palms going to and fro under the arm pair:** L3 325 substeps (L3-F4-gripTarget D, L3-F6-saturated rev). Not
  traced.
- **`CLIP_ARM_HELD_DEPARTURE`**: fixed off by `clipArmSwing` (14b); its flip is parked. A clip arm with no clear
  candidate takes a body-fixed alternative, and the departure toward it is carried with the clip's target. As the clip
  swings on, the arm is carried across the chest, and each push-out it cannot follow walks the target on.
  - Where it shows: in the user's screenshot (L3-F16-contactStop, 0.55 s, 21 ms before contact), D's left forearm goes
    10.4 cm into its own trunk at 0.567 s, with its bone axis 4.6 cm inside. It is held 0.6-2.4 m off its clip target.
  - Size, registered: 31 of the 32 player-s of forearm past 2 cm in the own trunk come after contact, from this hold.
  - With the flag: 0.47 s.
  - Test: `clip-arm-swing.test.ts` on `L3-F16-contactStop@18`. The registered arm is the fault twin.
  - The same hold keeps L3-F6-holdMirror R's right arm overhead (the raised arm above; not re-measured under the flag).
  - Evidence: `parked/clip-arm-swing-flip/README.md`, `assess-14b/`.
- **`PROC_ARM_HELD_DEPARTURE`** (what 14b leaves): a procedural arm holds a departure that nothing met, and its upper
  arm goes through the own trunk. Under the flag it is the larger part of the 7.1 s of upper-arm gross pass-through left
  (41.6 s registered). Example: L3-F5-drag R's left arm is 13.6 cm deep from 1.6 to 2.7 s, with a departure of 1.07 m.
  Fix: extend the let-go to a procedural arm's held departure, then re-measure whether `upperArm` is still needed.
- **`ARM_OWN_HEAD`**: a supported hand passes through its own head (the user's "facemask" report). In L3-F5-drag, R's
  left hand bone axis is inside its own head at 0.80-1.25 s, after contact at 0.40 s: three events, with a peak of 5.0
  cm at 0.967 s. The arm is procedural, held 0.8 m off its request. The self-clearance shapes are the torso and pelvis
  only; the head is in none of them, and the visible meter's `headLimb` class has no deep or axis measure. The flag
  removes it over the whole run. From a capture at 1.10 s, where the departure is already held, it stays (3.6 cm at
  1.217 s). Parked failing test and capture: `parked/arm-own-head/`. Proposed: an own-head axis meter beside armTrunk's
  (that test's measure), then the head as an arm self shape. Not built: the guard is not extended now.
- **A met arm pressed into the other player** (the flag's trade-off). The met arm now stays against the other body
  instead of being sent into its own chest: L3 any arm part past 5 cm in the other player goes 0.97 -> 6.50 s. In the
  screenshot, D's forearm is 4.4 cm into R's trunk at 0.55-0.567 s. It is not yet judged against the gross bar.
- **L3-F1-low: a shoulder visibly turns as the player lands** (the user's report, minor). Not measured.
  `?fixture=L3-F1-low&cam=front&speed=0.25&t=0.90`.

Resolved on the way, tests kept: `LEG_IN_RAGDOLL`, `HOLD_CLEARANCE_REPLANT` (exceptions retired),
`BRACE_EXPIRED_OBSTRUCTED`, `THIGH_MET_AT_CONVERSION`, stale impulses, loaded-limb persistence, the 4036-query tick.

## Parked flips

Each patch is registration only, applied with `git apply` from `.scratch/ladder/parked/<dir>/` in the main checkout.
Its README has the evidence and the suite failures by class.

| Flip | Would fix | Blocked by | Patch; evidence |
| --- | --- | --- | --- |
| `selfTrunkBody` on every L4 fall response (9f, 10f) | The last L4 ceiling row (161.5 -> 132.9 W) | From the same state it makes three runs worse by acting on closings that breach nothing: L4-F9-prep R's arm stays in its trunk 1.52 s against 0.48, L4-F9-exit rev R gains 1.73 J, L4-F4-obstructed R gains 1.27 J against 0.81 | `self-trunk-flip/` (on `7c14b85`, `--binary`), states `10f/`; `assess-10f/` |
| `JOINT_RANGE_V3` (11b) | Supported knees turning sideways or backwards: HC supported impossible 4.22 -> 0.05 s | The proxy thigh sliding in a shoe (caused); 3 who-falls changes, all reached: HC-F3-phase0 rev D stands, L3-F1-phase0 rev D falls, L3-F1-phase7 D stands | `hip-twist-flip/map.patch`; `assess-11b/`, `assess-12a/` |
| `LEG_GUARD_V4` (11c) | L3-F6's tucked knee (supSelfLegAxS L3 12.84 -> 10.44) | The hold's second plant (`HOLD_SETTLES`); on L3-F6-saturated, a cross-leg rise and a 1.22 cm transition, not twinned | `own-legs-flip/map.patch`; `assess-11c/` |
| Arm pair: `JOINT_RANGE_V5` with `SELF_CLEARANCE_V2` (11d, 12b) | One-frame arm turns (supSnap60 L3 16 -> 2) and trembling palms (L3 3027 -> 405) | The raised held arm (L3 supImpS 0.95 -> 4.13, caused). Not yet twinned: three natural samples (falls' L4-F9 boundary identity first) and HC ragdoll implausible time 4.48 -> 6.58 | `arm-pair-flip/map.patch` (replaces `palm-seam-flip/`, `overhead-twist-flip/`); `assess-12b/` |
| `SHOULDER_TWIST_ANAT_V1` on every L3/L4/HC ragdoll (13a) | The fallen arm bent the wrong way overhead: ragdoll shoulder impossible 31.5 -> 0.5 player-s | `SHOULDER_TWIST_REBOUND`: a rebound snap and two solve gains, caused; two soft suite rows (L4-F1-shoulderTwist, L4-F8-passive) | `arm-twist-flip/flip.patch`; `assess-13a/` |
| `upperArm` on every L3/L4/HC self-clearance (13c) | Arms in the own chest: L3 upper arm past 5 cm 160 -> 85 player-s (arm tasks 16.7 -> 0); trembling palms L3 3027 -> 1111 | Caused: two runners fall as rigid figures, the low-tackle runner stays up, shape queries 4265 (budget 4000), the carry's tuck. Worsened: supported snaps L3 16 -> 53 (`CLIP_ARM_HELD_DEPARTURE`). With `clipArmSwing` too (14b) the snaps are 20, but the low-tackle runner, one rigid runner (HC-F1-at1.6 rev), the tuck and the queries (4759) remain | `upper-arm-flip/flip.patch`; `assess-13c/`, `assess-14b/full-upperarm/` |
| `clipArmSwing` on every L3/L4/HC self-clearance (14b) | Arms through the own body, gross pass-through: forearm or hand 28 events / 1.68 s -> 5 / 0.08 s, upper arm 111 / 41.6 s -> 75 / 7.1 s; the screenshot and the facemask are gone; forearm past 2 cm L3 26.4 -> 0.23 s | Who falls, caused (same-state twins): three defenders keep their feet (L3-F1-phase1, L3-F1-phase7, HC-F3-phase0 rev). Worsened, not twinned: supported snaps L3 16 -> 48, HC 1 -> 11; the largest passive gain 48 -> 144 J (L3) and 48 -> 77 J (HC); one new L4 power row; HC wrist jumps of 0.37-0.40 m | `clip-arm-swing-flip/flip.patch`; `assess-14b/` |

Not taken: the narrowed L4 envelope (`l4-hip-envelope-narrowed/`). From the old stack: `ARM_CLEARANCE_V1` and the
arm sweep (dormant and untested; M3 reworks the wrap arms), shoulder twist 1000/3 (it traded one power breach for
another) and `arm.patch`'s pushed-target clamp (it raised reversals on trapped arms).

## Questions waiting on the user (look and design)

Open each link on a lab served from the ladder worktree. Start with the who-falls table above.

Open:

3. Does one leg sliding off the other look natural? `?fixture=L3-F9-noProbe-free&cam=side&speed=0.25&t=1.95`
4. Legs crossed at the switch stay crossed until they part. Acceptable, or push them apart?
   `?fixture=HC-F1-at0.9&cam=front&speed=0.25&t=1.25`
9. An L4 standing arm flicks from hanging to overhead and back. Fix before M2?
   `?fixture=L4-F9-crowded&cam=front&speed=0.25&t=0.05`
10. May an arm held raised through a hold stay raised (the arm pair's blocker)? It shows only under the parked patch,
    which has no lab parameter: `?fixture=L3-F6-holdMirror&cam=front&speed=0.25&t=1.60` is the registered arm.
11. In the still hold (13b) the planted thighs touch, 1.6 to 2.8 cm, where before the stepping shins crossed 5.6 to
    7.4 cm. Acceptable? `?fixture=L3-F6-saturated&cam=front&speed=0.25&t=3.20&holdstill=on`
12. Under 13c the arm a clip swings across the chest is held out at the chest's surface. Under 14b the clip's swing
    itself no longer carries the arm across. Which is the look? Compare
    `?fixture=L3-F16-contactStop&cam=front&speed=0.25&t=0.55&upperarm=on` with the same link ending `&armswing=on`.
13. With the 14b swing, three defenders keep their feet where they now fall. Acceptable? The flip is parked on these:
    `?fixture=L3-F1-phase1&cam=front&speed=0.25&t=1.30&armswing=on`,
    `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.40&armswing=on`,
    `?fixture=HC-F3-phase0&order=rev&cam=front&speed=0.25&t=1.30&armswing=on` (drop `&armswing=on` to see the fall).
14. Under 14b an arm that meets the other player stays pressed against it, a few centimetres in, instead of being sent
    into its own chest. Is that acceptable, or should it give way?
    `?fixture=L3-F16-contactStop&cam=front&speed=0.25&t=0.55&armswing=on`
15. Should a hand be kept out of its own head (the facemask), as the arms are kept out of the trunk? Today nothing
    stops it. `?fixture=L3-F5-drag&cam=side&speed=0.25&t=0.85` (with `&armswing=on` it no longer happens there).

Answered (2026-11-12):

1. The overhead arm bends the wrong way: a real limit is wanted, not a meter change. Taken as 13a (the meter now reads
   the anatomical twist too).
2. Propped on its own leg: does not matter.
5. Legs planted and still while the hold is stationary. Taken as 13b; question 11 is what it leaves.
6. The slow trip is fine.
7. The rigid body's bounce is accepted as a look for now.
8. The elbow inside the chest: wanted fixed, lower urgency. Taken as 13c.

## Known issues carried from the M1 handoff

These are from the old tree's uncommitted draft. **D4 and D5 never landed on the ladder** (user ruling 2026-11-10:
reverted together). Its footwork is M1's plus a plant `tolM` and the `releasePlantAt` test hook, so the mechanisms
below are in unchanged code (`footwork.ts` `advanceStep`). The numbers come from the old tree (s10/s15), and the
trajectories have moved since, so re-read them before relying on a time.

- **A late planner step can hover while its body runs on** (L3-F1-phase6 D right, under D4): each late stretch moves
  a destination at the leg's reach 0.2-0.33 m (D at about 6 m/s), so the target never comes within 1 mm; plan 10b's
  `settled` covers a still foot only. Probes `.scratch/b2/`.
- **The clip's roll toward the heel can take a plant past its reach** (L3-F7-phase50 R left, 1.7208 s): the ankle
  drops 4.6 cm, needs 0.893 m against 0.843 m, and the plant is released (off-ground time within 0.25 s).
- **D's left foot never lands in L3-F1-phase6** (older, separate). Its 2.59 m clip swing is still going when D goes
  ragdoll.
- **13f coverage.** The prediction's evidence is the constructed thrown body in `tests/body-limits.test.ts` (V2 with
  it converts, `noLegAhead` is rejected). Under V3 the physical legs stop the body first, so fixtures show collision
  protection, not the prediction. It stays (user ruling 2026-11-10).

## Evidence

Main checkout `.scratch/ladder/`: `r0-baseline` (start), `r8c-visible-checks`, `r10d-v3-flip` (last behaviour flip,
`netfalls`, lab views), `r12b-twist-fit` (before ladder 13), `r13c-upper-arm` (end of ladder 13), `r14a-flip`,
`r14b-flagoff` (tip); `assess-*/` (README each), `parked/`, `pinch/`, `visible-audit/`. Old
stack: `.scratch/cmp-evidence/s17/`. What may be deleted: `.scratch/ladder/cleanup-audit.md`.
