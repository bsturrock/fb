# Contact-motion prerequisites handoff: the ladder

Open items and the user's lab review list: [prerequisites ladder](../open/contact-motion/prerequisites-ladder.md).
Sequence: [contact motion](../open/contact-motion/README.md). This work comes after M1
([contact-motion.md](contact-motion.md)) and before M2.

The work is on branch `prereq-ladder`, cut from `a6d712f` (M1) and built in the worktree
`~/.claude-wt/football-sim-7-ladder`: 61 commits to `8a6af97`, the close-out docs, then ladder 13 (four commits to
`599dc57`, and its docs), the full check's speed-up (`69ae0bb` to `29c785b`), ladder 14 (`c81146e` to `8f3ce6e`),
ladder 15, ladder 16 (`11551f6`, `5c8d4aa`), ladder 17 (`8d50783`, `0926d2c`) and ladder 18 (`f64b277` to `3630ede`).
`model-integration` in the main checkout is fast-forwarded to it, and both branches are pushed to `origin`.

Ladder 13 (2026-11-12) took the user's three look rulings: the fallen arm bent the wrong way overhead (13a), legs
planted and still in a stationary hold (13b), and the elbow and upper arm inside the own chest (13c). Each landed off;
13a's and 13c's flips are parked, and 13b's was registered in 14a. Ladder 14:

- **14a** registered 13b's still feet. It first replaced the coverage floor that blocked it (`c81146e`), then made the
  flip (`809d9aa`).
- **14b** fixed what 13c left at its source: a clip arm's held departure carried across the chest
  (`CLIP_ARM_HELD_DEPARTURE`). It landed off (`clipArmSwing`, `8f3ce6e`); its flip landed in 18e.

Ladder 16 took the user's L3-F5-drag report (the carrier's arm, natural at its side when the wrap lands, travels to
its facemask and goes haywire: the body-fixed alternatives, `MET_ARM_FIXED_ALTERNATIVE`):

- **16a** (`11551f6`): a capture's definition comes out of the flip chain (`asCaptured`, `BEFORE_FLIPS`).
- **16b** (`5c8d4aa`): a met arm keeps its natural pose (`metArmStay`), landed off.
- **16c**: its flip with `clipArmSwing` was parked after one fix round: a new rigid falling figure and the shape-query
  budget broken. Landed in 18e.

Ladder 17 (direction item 4: a player who should go to ragdoll always does; a rigid falling figure is the worst look):

- **17a** (`8d50783`): a candidate born inside another player converts, the overlapping pairs out of the solve until
  they separate (`bornOverlap`), landed off.
- **17b** (`0926d2c`): registered on every L3, L4 and HC ragdoll.
- **17c**: 16c's flip re-judged on 17b with one more round (a limb born deep in a trunk deferred, query trims): parked
  again. Its deferral made the outcome depend on the player order, and held pairs deepened (33 past 5 cm).

Ladder 18 landed the met-arm flip:

- **18a** (`f64b277`): 17c's query trims, stay path only, landed off.
- **18b** (`b0cb4f3`): a held born pair is pushed apart, capped (`BORN_OVERLAP_V2`), landed off. It replaces 17c's
  deferral (order dependent): pairs are taken in key order, so no player order changes what is applied.
- **18c** (`e8a93b8`): registered on every L3, L4 and HC ragdoll (byte-identical summaries: no registered pair needed a
  push before the met arms).
- **18d** (`f8ac65e`), **18e-i** (`e1bad7e`): tests restated ahead of the flip and valid before it: the design's cases
  (the carry tuck kept, the shoulder and twist twins on the definition before it), the conversion's torso rule as the
  visible bar on held pairs, and samples taken before the flip moved onto `preMetArmStay`.
- **18e** (`3630ede`): `metArmStay` with `clipArmSwing` on every L3, L4 and HC fixture.

**Result at the tip** (full check `.scratch/ladder/r18-e-flip/` in the main checkout). Every step after 10e is
byte-identical to 10e except 14a-ii (four summaries), 17b (two) and 18e (68). 13a-i changed only the visible meter:
- The suite passes 383/383 in 41 files (250 at the start); after ladder 15's gate tests (below) 395/395 in 42 files,
  `.scratch/ladder/r15-c-energy-conv/`; after ladder 16 404/404 in 43; after ladder 17 409/409 in 44; after ladder 18
  416/416 in 44. Typecheck and build pass. 411 fixtures export, equal to `evidence/summary.json`.
- G, L1, L2 and RH summaries and traces are byte-identical to `a6d712f`. Summaries changed: L3 59 of 98, L4 70 of 75,
  HC 21 of 22. 17b changed two L3 summaries against 16b (L3-F1-falling, L3-F9-defenderFalling: D converts 12.5 ms
  earlier, same result). 18e changed L3 39, L4 13 and HC 16 summaries against 18c.
- Leg matrix: none over a ceiling. L4 matrix: one row over the power ceiling (`IMPACT_OVER_POWER`, tracked). The worst
  shape-query tick is 3983 (the budget is 4000; 3588 before 18e).
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
- A player who goes to ragdoll while overlapping another (an arm in the other's body, a trunk against a trunk) becomes
  a ragdoll instead of falling stiff (17b). The overlapping parts are pushed apart gently, in about 0.15 s, and never
  sink deeper (18c). A rigid falling figure is left only where the candidate is not the shown body: the three fixtures
  built for it.
- A standing player's arm that another player meets keeps its natural pose (18e). It stays low and may press a few
  centimetres into the other player (more for the ball's carry tuck and an arm hanging in a wrap). It no longer goes up
  to a raised or forward pose, through its own chest or to its own facemask, and it does not snap.
- Otherwise supported players look as at M1, because every other supported-side step is landed off.

## Behaviour registered on L3, L4 and HC

`src/sim/fixtures/index.ts` maps the registry through `visibleFlip` (8m), then `ownLegFlip` (9d), then `legFlip`
(10d), then `holdStillFlip` (14a), then `bornFlip` (17b), then `bornSepFlip` (18c), then `metArmStayFlip` (18e).
`tests/runs.ts` `preFlip`, `preOwnLegs`, `preV3`, `preHoldStill`, `preBornOverlap`, `preBornSeparation` and
`preMetArmStay` give a definition as before each one, for captures and natural samples taken earlier (`BEFORE_FLIPS`,
`asCaptured`).

| What | Flag / helper | Mechanism | Where |
| --- | --- | --- | --- |
| Hip stops | `HIP_STOPS_V2` (`hipStopsFor`, `withHipStops`) | Rapier per-axis angular limits on each spherical hip: a box in an anatomical frame per side (flexion 125, extension 30, abduction 50, adduction 30, rotation 45), read as Rapier does, 2 atan2(e_i, w). A conversion outside it starts at a widened stop that closes with the joint (cap 172). On L4 too (8k), where the soft hip envelope now only bounds fall-response targets. | `joint-stops.ts`, `ragdoll.ts` |
| Approach zone | `HIP_APPROACH_V1` (in V2) | A damped one-sided spring 10 deg inside each stop, passive as stepped. Fall-response hip targets are held inside it. | `joint-stops.ts` |
| Knee stop 140 | `withKneeStop` | The hinge's upper limit goes from 150 to 140, with the same widen-and-close start. Fall-response knee targets are held at the stop. | `joint-stops.ts` |
| PGS +4 | `withAdditionalPgsIterations` | Each segment body asks for 4 more internal PGS iterations per substep. | `ragdoll.ts` |
| Conversion retry | `CONVERSION_RETRY_V1` | A candidate rejected for `externalPenetration` is deferred (`handoffDeferred`; the pose guard keeps working) and tried again each substep for 0.25 s, then rejected for good (under born overlap, converted at the window's end). The 1.5 cm check is unchanged. | `conversion.ts`, `simulation.ts` |
| Own-leg contact | `SELF_LEGS_V1` (`withSelfLegs`) | Massless self shapes 1 cm smaller than drawn (distal half thigh, shin, shoe): legs meet each other, shins and shoes the own trunk. A group overlapping at the switch stays out until clear. The impact guard reads them. | `ragdoll.ts` |
| Physical supported legs | `LEG_GUARD_V3` | V2 (`sweep`): the shown leg step is judged against physical bodies, tries other knee poles and offsets, and is swept in 1 cm samples; plants take a knee pole first (7, 7b). `physicalLegs`: six massless colliders on the proxy, placed from the achieved pose, live only on static ground (probe `ok`, 10b) and until the conversion request, meeting other players' ragdoll segments only; the guard clears the posed legs to 1 mm. | `pose.ts`, `pose-runtime.ts`, `physics.ts`, `simulation.ts` |
| Fall response L4 v6 | `FALL_L4` | The impact guard reads the joint residual (4a) and every manifold point (4b). `carried` (6c) holds the body for a landing carried through a contact; it acts only with physical legs. | `fall-response.ts`, `simulation.ts` |
| Solved impulses | `SolverProfile.solvedImpulses` (7c) | Contact records, support contact, leg ledger and self-trunk impulses read Rapier's solved contacts. A manifold point outside the at most four solved reads 0. L3/L4/HC only, because it moved G/L2/RH. | `physics.ts` |
| Still feet in a hold | `HOLD_STILL_V1` (13b, `withHoldStill`; flipped in 14a) | A player holding or held (a grip or clamp within the last 0.25 s), its body under 0.3 m/s, takes no step home, settle or turn step; a foot that cannot keep its plant still steps. On every L3, L4 and HC foot planner (L2's is unchanged). It changed four summaries (the three L3-F6 holds and L4-F5-twoPalm-on), with no result, ending or who-falls change. The plan 10b coverage floor it lowered became coverage by kind outside a stationary hold (14a-i) | `footwork.ts` |
| Born overlap | `BORN_OVERLAP_V1` (17a, `withBornOverlap`, lab `born`; flipped in 17b, V2 since 18c) | A candidate deeper than the 1.5 cm tolerance in another player converts. Each collider pair born deeper (its segment, the other's collider) is left out of the solve (the contact hook, `Ragdoll.born`) until no deeper than 1 mm (`bornOverlapReleased`), so the switch adds no push-out. A limb converts at once; a trunk or head in another's trunk or head is deferred within the retry window, then converted so. The floor stays in the solve, accepted to 5 cm deep (a shoe 4.6 cm in leaves at 0.25 m/s). A pair whose other collider is replaced by its ragdoll moves to that ragdoll's collider. Anchors, landmarks, hinges and lengths still reject. Over every L3/L4/HC run, both orders: rigid figures 6 -> 6 (the built invalid candidates), deferred handoffs 2 -> 0, born pairs 2 (a palm 3.1 cm in an arm, held 0.021 s); no who-falls change | `conversion.ts`, `ragdoll.ts`, `physics.ts`, `simulation.ts` |
| Born separation | `BORN_OVERLAP_V2` (18b, `BORN_SEPARATION_V1`, `withBornSeparation`, lab `bornsep`; flipped in 18c) | Before each solve, every ragdoll's held born pairs at once, in key order (no player order changes what is applied): a pair at most 1 mm deep is released; any other gets equal and opposite forces at its witness midpoint along the contact normal, bringing the relative normal speed to its born depth over 0.15 s (0.1-0.5 m/s), one-sided, at most 2000 N, its positive work capped at 2 J (then only kept from closing). Under the met arms (every L3/L4/HC run, both orders): 89 pairs, none deeper than born, no limb past 5 cm in another player's trunk or head for 0.10 s (33 without it) | `conversion.ts`, `simulation.ts` |
| Met arms keep their natural pose | `SelfClearanceProfile.metArmStay` (16b, `withMetArmStay`, lab `armstay`) with `clipArmSwing` (14b, `withClipArmSwing`, lab `armswing`); flipped in 18e | A composed arm another body has met (clip, procedural, brace, ready hands, the carry tuck) keeps its request while it presses at most `HARD_OK` into the other body (another player's arm task included), whatever the request's own overlap with its trunk; past that it swings out continuously, else hangs at its side; never a raised or forward alternative. The carry arm keeps its tuck whatever presses it. Its shown departure moves at most `CONT_FAST_MPS`; a push is never kept and never carries it more than `MET_ARM_OWN_M` (3 cm) into its own trunk. While its player's handoff is deferred it is pushed clear as registered. With it `clipArmSwing` changes nothing (14b alone: a met clip arm keeps its swing). Arm tasks and arms nothing has met are unchanged | `pose.ts`, `pose-runtime.ts` |

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
| Conversion | a rejected handoff leaves a rigid falling figure; after an accepted conversion a held born pair has a limb in another player's trunk or head past 5 cm for 0.10 s, or past 10 cm (18d; it was the limb's depth when born, 5 cm, which since 17b and 18c is held out of the solve and pushed out) | `handoff-contact.test.ts` (`heldBornBar`) |
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
fault twin: constructed series (`visible-bar.test.ts`, `unseenChase`, `plantRootBreaches`, `holdsEndedEarly`; the held
born bar on HC-F1-at1.6 reversed without the born separation), an 8 cm
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
  and adds no guard. The upper arm (13c) is not needed for the forearm and hand. Since 18e the upper arm's gross
  pass-through left is 1.8 player-s, all arm tasks (81.6 before), which is what 13c's `upperArm` would still cover.
- **Met arms registered with the born separation, not with 17c's deferral** (18e). The deferral of a limb born deep
  pushed the arm out while the player waited, so the result depended on the player order (HC-F1-at1.6: accepted at
  step 385 forward, 387 reversed). The separation acts on every held pair at once in key order, after the conversion,
  with bounded work (2 J a pair; uncapped, the arm case takes 122 J and leaves at 7.6 m/s). The trade the user's
  bar accepts (question 16): a met arm presses into the other player (past 5 cm 0.2 -> 31.7 player-s, past 10 cm
  0 -> 7.5), against every arm through its own body or head gone but 0.35 s (forearm and hand) and the arm tasks' upper
  arms.
- **The flip's suite rows** (18e, 18e-i, 18d): definitions moved through `preMetArmStay`; the design's cases restated
  with their twins (the carry tuck, the plan 12 and M1 twins, the held born bar); samples taken before the flip kept on
  the definition they were taken under (the 13f shoe, the L3-F6-hold coverage pair, L3-F3-recover's fast step, the lab
  rows); fine whole-run rows on the visible bar or event order with constructed twins (the driven forearm control, the
  palm holds' end). The L4-F9 boundaries now compare with the source as registered.

## Tooling

- **Full check** (`scripts/check/README.md`): `full-check.ts <dir>`, then `compare.ts <a> <b>`. Results go to
  `.scratch/ladder/<step>/`, about 1 MB each. It compares the suite by message, summaries and traces per family, and
  the leg, L4, query, passive-energy (`energymx`) and **visible-quality** (`visiblemx`) matrices. `visiblemx` reads
  drawn-frame joints against human ranges, plus overlaps and snaps, with lab links. It exits 1 only on a new suite
  failure or a changed G/L1/L2/RH output.
- **Captures and twins** (`tests/state.ts`, `scripts/capture-state.ts`, `tests/README.md`): the full state at a tick,
  resumed byte for byte; a twin is `resumeState(cap, { def, variant })` or `{ faults }`. 31 captures in
  `tests/data/state/`; `tests/seed.ts` is the older seed behind `headplant` and `corerock`.
- **Rules as tests:** `tests/loaded-limb.ts` (7f), `tests/passive-energy.ts` (7g), `tests/visible.ts` (8c).
- **Lab parameters** (`src/lab/lab-params.ts`): `order=rev`, `legs=v1|v2|v3`, `hips=on|l4|v1|off`, `pgs=<n>`,
  `knees=off|140|145`, `retry=on|off`, `selfleg=on|off`, the ladder 13 flags `armtwist=on|off` and `upperarm=on|off`,
  the ladder 14 flags `holdstill=on|off` (registered since 14a) and `armswing=on|off`, `armstay=on|off` (16b; both
  registered since 18e), `born=on|off` (registered since 17b) and `bornsep=on|off` (registered since 18c).
  `armtwist=on` and `upperarm=on` each show a parked flip. Before-views (each equals the earlier registration on all
  195 L3/L4/HC fixtures, `r18-e-flip/lab-views.txt`; `born=off`, `bornsep=off`, `armswing=off` and `armstay=off` are
  also tested in `lab-params.test.ts`):

  | as it was | add |
  | --- | --- |
  | before 8m | `&legs=v1&selfleg=off&hips=off&pgs=0&knees=off&retry=off&holdstill=off&born=off&armstay=off&armswing=off` |
  | after 8m | `&legs=v1&selfleg=off&holdstill=off&born=off&armstay=off&armswing=off` |
  | after 9d (through 10b) | `&legs=v1&holdstill=off&born=off&armstay=off&armswing=off` |
  | after 10d (through 13c) | `&holdstill=off&born=off&armstay=off&armswing=off` |
  | after 14a (through 17a) | `&born=off&armstay=off&armswing=off` |
  | after 17b (through 18b) | `&bornsep=off&armstay=off&armswing=off` |
  | after 18c (through 18e-i) | `&armstay=off&armswing=off` |

  Rungs 3 to 7c have no lab view. Serve the lab from the ladder worktree (`npx vite --port 5180 --strictPort`).
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
review. Net (`netfalls.py r0-baseline r18-e-flip`): 15 player-runs now fall that stayed up, and 9 now stay up that
fell. Rigid falling figures (rejected conversions) are only the three fixtures built for it, as at the start.

| fixture | order | player | at the start | now | changed at |
| --- | --- | --- | --- | --- | --- |
| HC-F3-lowRunner | forward | defender | falls 1.59 s | stays up | 18e |
| HC-F3-mirror | reversed | defender | stays up | falls 1.75 s | 3 |
| HC-F3-phase0 | forward | defender | falls 1.18 s | stays up | 8m |
| L3-F1-low | both | defender | falls 1.70 / 1.65 s | stays up | 3 (fwd), 9d (rev) |
| L3-F1-mirror0 | both | defender | stays up | falls 1.39 / 1.45 s | 8m |
| L3-F1-mirror4 | reversed | defender | stays up | falls 1.50 s | 8m |
| L3-F1-phase0 | forward | defender | falls 1.17 s | stays up | 8m |
| L3-F1-phase5 | reversed | defender | stays up | falls 1.58 s | 3 |
| L3-F4-gripTarget | both | defender | falls 1.82 s | stays up | 10d |
| L3-F9-convert-free | both | defender | stays up | falls 0.86 s | 10d |
| L4-F3-run-off | both | defender | stays up | falls 0.86 s | 10d |
| L4-F10-knee-on | both | defender | stays up | falls 0.69 s | 10d |
| L4-F3-run-on | both | defender | stays up | falls 1.12 s | 9d |
| L4-F9-free | both | defender | stays up | falls 1.12 s | 9d |
| L4-F5-twoPalm-on | both | runner | falls 2.17 s | stays up | 8m |

What 18e changed (against 18e-i, both orders). Open on the lab at `speed=0.25&cam=front`; add `&armstay=off&armswing=off`
for the fall before it:

| fixture | order | player | before 18e | 18e | lab |
| --- | --- | --- | --- | --- | --- |
| HC-F3-lowRunner | forward | defender | falls 1.60 s | stays up | `?fixture=HC-F3-lowRunner&cam=front&speed=0.25&t=1.45` |
| L3-F1-phase7 | forward | defender | falls 1.54 s (10d) | stays up, as at the start | `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.40` |

The low-tackled runner in L3-F1-low still falls (0.9125 s, reversed 1.3208 s; `?fixture=L3-F1-low&cam=front&speed=0.25&t=0.85`).
HC-F1-at1.6 reversed R, a rigid figure under 16c's flip, converts at its request (1.600 s). 39 other conversions
move in time, the largest L3-F4-twoArm and L4-F10-wrap-off forward D, 1.283 -> 1.642 s
(`?fixture=L3-F4-twoArm&cam=front&speed=0.25&t=1.25`). HC-F3-lowRunner's change was twinned in 16c (caused: the
defender's met left arm, from its first difference at 0.467 s).

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
  check what a Rapier upgrade exposes. 18e reaches it more: passive energy L3 780 -> 859 J, L4 531 -> 602, HC
  423 -> 687 (largest 48 -> 119, 58 -> 86, 48 -> 60). The largest is L3-F1-phase4 reversed D, 119.4 J at 1.6458 s,
  the solve after a 1016.8 J loss. Same-state twins without the flip: from 1.0 s, 0.04 J; from 1.267 s, where the
  ragdoll already has its arm pose, 108 J. So the flip reaches it through the arm pose the ragdoll starts with; the
  explosion gate passes.
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
  (13a-iii): step the term as 8g's approach zone is stepped (`parked/arm-twist-flip/README.md`). Under 18e the
  ragdoll shoulder rotation past range reads 42.8 player-s, both orders (31.6 before), the worst HC-F5-strictTransfer
  forward R's left shoulder, 287 deg s over 1.52-6 s; not twinned (out of 18's scope); no gate row fails.
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
- **17b reaches the ragdoll arm in its own trunk** (the `armTrunk` class): L3-F1-falling and L3-F9-defenderFalling D,
  converted 12.5 ms earlier, has its arm past the deep line in its own trunk for 0.27 s each (0 before). Not twinned:
  the class existed, and the earlier conversion reaches it.
- **HC-F3-lowRunner: the runner tilted over "still trying to run"** (the user's look, measured only). The request is
  not late against the lean: lean passes 30 deg at 0.8875 s, the recovery envelope requests at 0.9125 s (lean 33 deg,
  projected 57 against 55), accepted at once with no deferral. From 1.45 s, where the look was seen, the runner has been
  a passive ragdoll for 0.5 s, carried on by its speed (3.3 -> 1.3 m/s) and the defender's hold. So it is the trigger,
  not validation. Capture before the lean passes 30 deg: `parked/low-runner-trigger/HC-F3-lowRunner@51.json.gz` (0.85 s),
  timeline in its README. Question 17.
- **`MET_ARM_REQUEST_IN_TRUNK`** (new in 18e): a met arm keeps its request whatever that request's own overlap with
  its trunk, so where the request is in the trunk the arm stays there. HC-F1-low R's left: the request is 6.5 cm in
  its own trunk with the bone axis inside from 0.95 to 1.2 s, and the ragdoll's first frame has the forearm 5.7 cm in.
  Over every L3/L4/HC run, both orders, supported arms past the visible bar in the own trunk: 40 runs -> 7 (HC-F1-low
  both, L3-F10-bothLow both, L3-F5-drag both, L3-F6-saturated forward), bone axis inside 3.15 -> 3.98 player-s. The
  body-limits driven forearm control prints it (`ladder 18e meter`). Proposed: keep a met arm's request only while it
  is at most `MET_ARM_OWN_M` in its own trunk, else take the stay's swing-out, behind a flag.
- **A grip let go at the switch** (new in 18e, twinned): in L3-F4-gripTarget D's left grip ends for `invalidPose` in
  the step R converts (0.900 s), its arm meeting the ragdoll's forearm, which starts where the met arm kept it. From the
  same state at 0.8 s without the flip the grip holds to 1.0875 s. The palm-hold row asked that every hold end strictly
  after the conversion; it now asks that none ends before it or without a reason (`holdsEndedEarly`, constructed
  twin). Not traced: whether the grip should follow the ragdoll's forearm out instead.
- **A met arm pressed into the other player** (the trade-off of the met-arm flip, question 16). The met arm stays
  against the other body instead of being sent into its own chest or up. Over every L3/L4/HC run, both orders, 18e-i
  -> 18e: supported arm past 5 cm in the other player 0.22 -> 31.7 player-s, past 10 cm 0 -> 7.5, forearm or hand
  bone axis inside 0 -> 5.2. The deepest are the ball's carry tuck, which keeps its tuck whatever presses it
  (L3-F5-dragMirror R's right past 10 cm for 1.25 s; HC-F2-lift1.4 A's in B's head), and hanging arms in a wrap
  (L3-F5-drag R's left, 0.48 s past 10 cm). Swung out instead, the carry arm's elbow rose to the shoulder and the hand
  crossed the chest (HC-F1-lowMirror R at 0.9 s), so the tuck is kept. After a conversion the ragdoll's limbs leave:
  a ragdoll limb is past 5 cm in another player's drawn trunk or head for 0.17 player-s in all, never for 0.10 s on end
  (the visible bar), and every held born pair is pushed apart (89 pairs, none deeper than born, deepest 8.9 cm).
- **L3-F1-low: a shoulder visibly turns as the player lands** (the user's report, minor). Not measured.
  `?fixture=L3-F1-low&cam=front&speed=0.25&t=0.90`.

Resolved on the way, tests kept: `LEG_IN_RAGDOLL`, `HOLD_CLEARANCE_REPLANT` (exceptions retired),
`BRACE_EXPIRED_OBSTRUCTED`, `THIGH_MET_AT_CONVERSION`, stale impulses, loaded-limb persistence, the 4036-query tick.
Closed by ladder 18 (every L3/L4/HC run, both orders; tests in `met-arm-stay.test.ts`, `clip-arm-swing.test.ts`,
`born-overlap.test.ts` (ladder 18) and `handoff-contact.test.ts`, each with its fault twin):
- `MET_ARM_FIXED_ALTERNATIVE` (the user's L3-F5-drag report: a met arm sent up to a body-fixed alternative, its hand
  to the facemask, its shoulder snapping), `CLIP_ARM_HELD_DEPARTURE` (the user's L3-F16-contactStop screenshot),
  `PROC_ARM_HELD_DEPARTURE` and `ARM_OWN_HEAD`: forearm or hand through the own trunk 49 events / 2.72 s -> 20 /
  0.35 s, hand in the own head 8 / 0.92 s -> 0, upper arm 253 / 81.6 s -> 36 / 1.8 s (all of it arm tasks, what 13c's
  `upperArm` would cover), supported snaps 17 -> 0, one-frame landmark jumps over 20 cm 124 -> 4, over 30 cm 17 -> 0.
- `MET_ARM_UPPER_IN_OTHER` (16c's rigid figure, HC-F1-at1.6 reversed R): converts at its request; its upper arm,
  born 8.2 cm in D, is pushed out and never past the visible bar.
- `BORN_PAIR_DEEPENS` (17c): the born separation (18b, 18c) pushes every held pair apart, capped at 2 J.

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
12. Under 13c the arm a clip swings across the chest is held out at the chest's surface. Since 18e the clip's swing
    itself no longer carries the arm across. Which is the look? Compare
    `?fixture=L3-F16-contactStop&cam=front&speed=0.25&t=0.55&upperarm=on&armstay=off&armswing=off` with the same link
    without the three parameters.
13. Since 18e two defenders keep their feet where they fell before it. Acceptable?
    `?fixture=HC-F3-lowRunner&cam=front&speed=0.25&t=1.45`, `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.40` (add
    `&armstay=off&armswing=off` to see the fall). L3-F1-phase1 and HC-F3-phase0 reversed, which 14b's swing alone kept
    up, still fall.
14. Since 18e an arm that meets the other player stays pressed against it, a few centimetres in, instead of being sent
    into its own chest. Is that acceptable, or should it give way?
    `?fixture=L3-F16-contactStop&cam=front&speed=0.25&t=0.55` (add `&armstay=off&armswing=off` for the arm in the chest).
15. Moot since 18e: no hand enters its own head in any L3/L4/HC run, so the head is not made an arm self shape. The
    facemask as it was: `?fixture=L3-F5-drag&cam=side&speed=0.25&t=0.85&armstay=off&armswing=off`.
16. A met arm stays low and presses into the other player, up to 10-16 cm for the carry tuck and a hanging arm in a
    wrap. Is that the look? `?fixture=L3-F5-drag&cam=side&speed=0.25&t=0.35` (add `&armstay=off&armswing=off` for
    the arm that goes to the facemask), the carry tuck in the tackler
    `?fixture=L3-F5-dragMirror&cam=front&speed=0.25&t=1.60`. Where the shoulder itself is against the tackler the arm
    stays, and the ragdoll's arm is pushed out of him after the conversion:
    `?fixture=HC-F1-at1.6&order=rev&cam=front&speed=0.25&t=1.55` (add `&born=off` for the stiff fall it would be,
    `&bornsep=off` for the arm left to part). Or may the arm lift over the tackler (a raised arm, which the fix forbids)?
17. HC-F3-lowRunner: the runner goes ragdoll at 0.91 s, when its lean (33 deg, falling outward) is projected past 55 deg.
    Should a tackled runner go ragdoll earlier, and from what (lean, contact, the tackler's hold)?
    `?fixture=HC-F3-lowRunner&cam=front&speed=0.25&t=0.85`.

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
`r14b-flagoff`, `r16-a-ascaptured`, `r16-b-metarmstay`, `r17-a-born-off` (17a), `r17-b3-born-flip` (17b),
`r17-scan/` (every L3/L4/HC conversion try, by variant), `r18-e-tests` (18e-i, summaries as 18c), `r18-e-flip` (tip:
`steps/` each ladder 18 step's compare, `lab-views.txt`, `meters/` the gross pass-through, own-trunk and held-pair
scans of 18e-i and 18e with their scripts); `assess-*/` (README each), `parked/`, `pinch/`, `visible-audit/`. Old
stack: `.scratch/cmp-evidence/s17/`. What may be deleted: `.scratch/ladder/cleanup-audit.md`.
