# Contact-motion prerequisites: ladder re-land

Status: active (2026-11-11). Replaces the stacked "s10..s17" candidate.

## Why

The prerequisite work before M2 sat as ~3,350 uncommitted lines of interleaved changes on top of M1 (`a6d712f`). Over
17 rounds it did not converge: there was no committed baseline to compare against, the changes could not be judged or
bisected apart, and each fix moved chaotic fixture trajectories so that a different fixture crossed a threshold.

The stack is preserved, not continued: `.scratch/cmp-evidence/s17/` holds `main-tree-2026-11-11.patch` (the whole
uncommitted diff), the untracked files, and the s17 patches (`b`, `query`, `arm`, `palm`, `j1-1000-3`).

## Rules

1. Work happens on branch `prereq-ladder`, cut from `a6d712f`, in its own worktree. The old working tree is reference
   only.
2. One rung = one reviewable change = one commit. A rung lands only after the full check passes against the previous
   rung.
3. **Full check** (`scripts/check/`, landed in rung 0): suite failures compared by message, fixture summaries, leg
   matrix, L4 matrix. Results are stored per rung so any later rung can be diffed against any earlier one.
4. Code lands behind its profile flag first, with fixture summaries byte-identical. Turning a flag on for fixtures is its
   own rung, so behaviour change is judged alone.
5. G, L1, L2 and RH summaries stay byte-identical on every rung.
6. A rung that cannot go green alone is parked with its evidence, not carried forward.
7. **Trajectory-shift rule.** A breach of an existing limit blocks a rung only if the rung introduces the mechanism, or
   worsens it in a controlled twin (same state, the change on and off). A breach whose mechanism already exists and is
   merely reached by a moved trajectory becomes a deterministic regression test (seeded state) plus a tracked defect
   with its own fix rung. Limits are never raised and expectations are never re-pinned to pass.
8. No experiment hooks land (`D1_OFF`, `D1_NOSTOP`, `D2_OFF`, `D3_OFF`, `SELFTRADE`, `ARMDBG`).

## Rungs

| # | Rung | Expected effect on fixture summaries |
| --- | --- | --- |
| 0 | Check tooling in `scripts/check/` and the baseline at `a6d712f` | none |
| 1 | Per-build contact-query memo (`query.patch`, adapted) | byte-identical |
| 2 | Test hooks and independent negative controls (`releasePlantAt`, `ownerChangeJumpM`, pulled-forearm control) | byte-identical |
| 3 | Arm-task twist anchor: once per substep, no widening past the rate window | L3/L4/HC change |
| 4 | Impact guard: joint residual (head-plant seed test), then manifold points (core-rock seed test), then carried impacts with a dedicated test | L4 change, one sub-rung each |
| 5 | Leg sweep and alternate placements behind `LEG_GUARD_V2`, no fixture uses it | byte-identical |
| 6 | Physical supported legs behind `LEG_GUARD_V3` in the s17 form (surface-advance speeds, single ledger), with unit tests for the floor-backed launch and grounded-only rules | byte-identical |
| 7 | Planted primary pose, knee-pole-first | byte-identical while unflipped |
| 8 | Turn `LEG_GUARD_V3` on for L3, L4, HC (split by family if that isolates failures) | the judged rung |
| 9 | Arm overhead-twist singularity and palm continuity (the sound parts of `arm.patch`) | L3/L4/HC change |

## Status

Results per rung under `.scratch/ladder/<rung>/` in the main checkout; each compared against the previous rung.

- **0** (`r0-baseline`) landed: 250/250, no L4-matrix row over the power ceiling, highest audited peak 145.9 W.
- **1** (`r1-query-memo`) landed: byte-identical.
- **2** (`r2-controls`) landed: byte-identical; 253/253 (three added tests). The pulled-forearm control (body-limits),
  the `PoseDebug.ownerChangeJumpM` audit control on L3-F16-sprint (l3-contracts), and the controlled reseed and
  support-loss boundary records (`FootDebug.releasePlantAt`, `reseedCovered` / `stepAsIsCovered` in l3-pass), each beside
  the natural sample it backs up; nothing replaced.
- **3** (`r3-twist-anchor`) landed. The arm-task twist window is anchored once per substep and never widened: the
  largest arm-task twist change in one tick on the M1 review fixtures goes from 55.6 deg (L3-F4-twoArm D.left 0.867 s;
  17.8-23.6 deg on the others) to the rate, 11.46 deg (at most 0.0016 deg over, inside the fit's stopping tolerance).
  Summaries changed: L3 30/98, L4 10/75, HC 14/22; G/L1/L2/RH byte-identical; no L4-matrix row over the power ceiling
  (highest rise L4-F10-wrap-on D 125.5 to 138.2 W). Everything moves from the first tick: D's arm-task elbow is 2.4-3 cm
  elsewhere at 0.017 s (the first substep's solves no longer turn past one rate step), its palm meets R elsewhere from
  about 0.43-0.6 s, and the contacts follow. Who falls: L3-F4-oneArm and L3-F1-phase2 D (conversion rejected, tracked
  defect below), L4-F10-wrap-off D (the same), L3-F1-low D (R falls 4 ms later; D keeps its support, it lost it at 1.696 s
  before), HC-F3-mirror D (R falls 54 ms later; D's probe lands on R's ragdoll at 1.400 s and D loses support at 1.475 s).
  Tests: the arm-task per-tick bound (body-limits M1); two rule 7 tracked defects with their own tests (l3-contracts
  "ladder tracked defects"); the STEP_AS_IS natural sample (L3-F4-twoArm) gone, covered by rung 2's controlled record;
  the 13e blocked-home fault no longer moves a foot of L3-F6-hold, shown on the old tree's constructed planner hold
  instead; the limp-shoe hold catalogue gains HC-F1-low R.left and HC-F1-lowMirror D.right (plan 12's rule; the twin
  with the change off from 1.20 s, before either player converts, holds the same shoes for the same substeps).
- **4a** (`r4a-joint-residual`) landed, `fall-response-l4-v4`: the parent joint's velocity residual counts toward a
  segment's closing speed. Summaries changed: L4 28/75 only; no result or who-falls change; no L4-matrix row over the
  power ceiling (highest peak L4-F9-contact R 142.0 to 151.1 W, under 157.5). Test: `tests/headplant.test.ts` on the
  old tree's L4-F9-low seed (step 326), valid here unchanged: the same ragdoll profile id, the head touches with 9.75 N s
  (under the impulse rule) and is at rest (0.004 m/s), closes at 1.08 m/s with its neck's residual, takes 54.4 N s; the
  twin without the residual realizes 177.3 W (1 substep over), FALL_L4 holds the body and peaks at 129.7 W.
- **4b** (`r4b-manifold-points`) landed, `fall-response-l4-v5`: the closing speed is read at every point of the pair's
  last manifold. Summaries changed: L4 33/75 only; no L4-matrix row over the power ceiling (highest rise L4-F10-wrap-on
  reversed D 131.2 to 154.7 W, under 157.5). Who falls: L4-F10-elbow-on D no longer falls: R's guard reads a manifold
  point closing at 0.383 s and holds one substep more; R's pelvis meets D's support 8 ms earlier with 27.4 N s instead of
  33.6, and D's lean stays inside its recovery envelope (the twin lost support at 0.779 s, 36.9 deg). Test:
  `tests/corerock.test.ts` on the old tree's tipped-forward seed (step 105), valid here unchanged: same ragdoll profile
  id; in the third seeded solve the core's closest point reads no closing, the far corner 3.5 m/s, the solve takes 56 N s,
  nothing over the impulse rule before it; on the closest point alone 219 W, FALL_L4 133.5 W.
- **4c** (carried impacts) landed as 6c, on the physical-legs base its case needs.
- **4d** (`r4d-limp-rule`) landed: byte-identical. The limp-shoe hold catalogue in body-limits becomes a check of plan 12's
  rule on every hold decision of its four fixtures (held exactly when the turn would come closer to another player inside
  8 cm, recomputed unculled; a held shoe keeps its pitch, a turned one moves one rate step), with a positive sample and
  the rule disabled and inverted as fault controls.
- **4e** (`r4e-state-capture`) landed: byte-identical, no `src/sim` change. Full-state capture and resume for tests
  (`tests/state.ts`, `scripts/capture-state.ts`, `tests/README.md`): the Rapier snapshot and the Simulation's whole JS
  state graph at a tick boundary, resumed into a fresh build of the (possibly variant) definition; resumed runs
  reproduce the uninterrupted export byte for byte. The rule 7 tracked-defect tests (`LEG_IN_RAGDOLL`,
  `HOLD_CLEARANCE_REPLANT`) resume from captures 2 ticks before the defect (`tests/data/state/`, 166-232 KB each).
- **5** (`r5-leg-sweep`) landed: byte-identical, shape-query counts unchanged. `LEG_GUARD_V2` (`sweep`, no fixture runs
  it): the supported legs' shown step is judged against the physical bodies (`PoseClearance.legs.physical`), a leg
  still past HARD_OK tries the primary's other knee poles, then the offsets, and the step is swept from the shown pose in
  1 cm samples, stopping at the last clear one. Tests: the 13f thrown closing body under V2 (body-limits) and four
  constructed pose cases (another placement, a stop at the last clear sample with the twin crossing, limb lengths and
  hip kept, no jump on stop or resume); the harness profile row. With V2 on all fixtures (information,
  `.scratch/ladder/r5-leg-sweep/v2-on/`): the leg matrix changes 8 of 390 rows, L3-F1-mirror4 reversed D falls (1.567
  s); the L4 matrix changes 1 of 92 rows, none over the ceiling; `LEG_IN_RAGDOLL` stays (the L3 pair deeper, 5.54 cm new
  penetration and 13 substeps instead of 4.28 and 12; L4-F10-wrap-off unchanged); the worst shape-query tick reaches 4889
  (L3-F1-mirror4; 6 fixtures over 4000, 3 of them at 4030 with V2 off).

- **5b** (`r5b-query-budget`) landed: byte-identical. The 4030-query tick (HC-F1-at0.9, HC-F1-at1.6, HC-F5-invalidOne at
  0.867 s) was R's held left arm in D's wrap: its swing-out bracket runs to its cap with nothing clear (15 builds, 17 cm
  deep), then its continuity step bisects to the valid fraction with each step's push-out at its 4-iteration cap (40
  builds a substep, depth converging on HARD_OK): a real search, not repeats. The push-outs (pose and trunk) read
  penetrating contacts only and now ask at the depth checks' prediction, reusing their answers (a penetrating contact
  is the same at any prediction: harness test on random pairs of every shape kind, both query paths); the trunk answers
  are kept per shape like the others. Worst tick 4030 to 3242 there, every leg-matrix run under 4000 (highest
  L3-F7-mirror50, 3423), 5% fewer queries over the export. The full check counts every leg-matrix run
  (`queries.jsonl`, a compare line for ticks over the budget); the suite's budget test adds HC-F1-at0.9 and
  L3-F7-mirror50.
- **6** (`r6-physical-legs`) landed: byte-identical, shape-query counts unchanged. `LEG_GUARD_V3` (V2 with
  `physicalLegs`, no fixture runs it): a supported proxy's six pose leg shapes are massless round-hull colliders on its
  own body (contacts act on the proxy once; mass properties bitwise kept), placed from the achieved pose after each
  solve with twist-free frames, live only while the proxy stands on static ground (D2: the suspension probe within
  travel and not on a player; legacy support only while `grounded`), off at the conversion request and removed with the
  proxy. Filter: groups (never static ground or another physical leg), the contact hook (never the floor, obstacles,
  another proxy's support capsule or guard, self-clearance shapes), one body (never its own proxy). The guard clears
  the posed legs to PHYS_LEG_OK (1 mm) of the bodies they meet, where they stand, predicted and stopped (D1), the sweep
  starting from the last shown leg. Leg ledger (`Simulation.legLedger`, observation only). Contact records of the legs
  are ordinary records (limb class) except for arm grips (skipped) and ground (never). `tests/state.ts` captures their
  shapes (`RoundConvexPolyhedron`). Tests: `tests/physical-legs.test.ts` (exactly once, filter layers, D2 on real
  states, ownership at conversion, D1 against `PoseDebug.noLegStop`, surface speeds against world-up frames), the 13f
  thrown body under V3 (body-limits), the `LEG_IN_RAGDOLL` captures under V3 (l3-contracts: all three convert, nothing
  past the tolerance), a V3 capture round trip (state). With V3 on every leg-guard fixture (information,
  `.scratch/ladder/r6-physical-legs/v3-on/`, README there): 22 suite failures (7 by construction, 6 natural samples or
  negative controls moved, 9 behaviour); 15 result or who-falls changes; one L4 row over the ceiling,
  L4-F9-defenderFalling D 172.0 W (rung 4c's case: R's core on D's thigh while R lands; the 4c flag clears it and leaves
  the matrix at 148.1 W); `LEG_IN_RAGDOLL` and the L4-F10-wrap-on stall gone; worst shape-query tick 3535.
- **6b** (`r6b-filter`) landed: byte-identical (summaries, traces, both matrices, shape-query counts). The physical legs
  meet another player's ragdoll segments only (`legMeets`, the contact hook for every leg pair), never a proxy; a leg
  deeper than `PHYS_LEG_ON_M` in a new ragdoll leaves the solve at the switch (`legsOffInsideConverted`). With V3 on
  every leg-guard fixture: who-falls changes 15 to 12, suite failures 21 to 17 (none new), no leg impulse on a proxy
  (was 1519 N s over 31 runs), largest injected energy per substep 0.623 to 0.20 J.
- **6c** (`r6c-carried`) landed, rung 4c re-expressed, `fall-response-l4-v6` with `impactGuard.carried`: a core-jointed
  segment closing on another player's ragdoll that is about to land holds the whole body. Flag off (V3 off): summaries,
  both matrices and query counts byte-identical; the 46 fall-response L4 traces change only in the profile id. Test
  `tests/carried.test.ts`: L4-F9-defenderFalling under V3 from a capture at tick 65, 172 W without the flag (one
  substep over 157.5), 136 W with it; three earlier landings with D's thigh resting on R hold nothing.
- **7** (`r7-planted-pose`) landed: byte-identical, 285/285. Under `sweep` (V2, V3) a planted leg whose primary is
  invalid (or, with `physicalLegs`, in a body the legs meet) takes the primary at a knee pole before any offset, held
  at the plant tolerance and the continuity rate, and returns to the primary once that is clear at its own knee; with
  no valid planted pose the leg is released as before. Fault `PoseDebug.noPlantedPole`. Tests
  `tests/planted-pose.test.ts` and the hold captures under V2/V3 (l3-contracts). `HOLD_CLEARANCE_REPLANT` under V2/V3:
  no clearance release and no plant after 3.5 s on either capture, the fault twin keeps the cycle. L3-F4-twoArm does not
  reach it (D's left foot there is released by reach at 0.583 s, not a plant).
- **7b** (`r7b-pole-exit`) landed: byte-identical, 286/286. The knee-pole exit was not a candidate switch: an exact plant
  is shown where it stands and never pushed, so a body the physical legs meet comes into it (R's left leg on its knee
  pole 5-6 mm deep), and the swing's first step pushed that depth out at once on top of the rate step. Under V3 a leg
  held so (pose memory `<side>Leg:mh`) now moves at most the plant rate from where it stands, push-out included, until
  it is clear of the met bodies. The rung-7-off breaches (L3-F4-gripTarget D 1.14 cm, L3-F4-gripOwner R 1.33 cm) are
  the same mechanism on the primary: with the fix every ownership change of the three runs is under 0.72 cm, with the
  fault `PoseDebug.noHeldMetExit` they come back. Test: tests/planted-pose.test.ts on
  `L3-F4-gripOwner~v3-audit@96` (`capture-state.ts --audit`), fault twin 2.03 / 1.31 cm.
- **7c** (`r7c-stale-impulse`) landed: G/L1/L2/RH byte-identical, 288/288; L3/L4/HC evidence changes (summary
  regenerated). Rapier solves at most four points of a manifold and writes impulses back to those only; a point left
  out keeps the impulse of the last solve that included it, and the contact records, the support contact, the leg
  ledger and the self-trunk impulses read every point as applied. `solvedImpulses` (physics.ts) matches each solver
  contact to its manifold point and reads the rest as 0, gated by `SolverProfile.solvedImpulses` (`+solved`) on
  L3/L4/HC only (the ungated reading moved G, L2 and RH summaries). Stale share over the leg-guard runs, both orders, on
  the old reading: V1 517.8 N s of 78,622 player-player (0.66%, 63 of 390 runs), V3 1055.4 of 81,886 (1.29%, 89 runs);
  none on the floor. Worst: V1 HC-F5-strictTransfer 37.0 N s in one record, V3 L3-F9-noProbe-prep 134.4 N s in the run.
  Changes: L4-F10-elbow-on D now falls (recovery envelope, 0.771 s, both orders): R's impact guard held one substep
  more on a stale 10.7 N s shoe record at 0.113 s under the old reading, and the runs part there. L3-F1-phase6 reversed
  D converts at 1.55 s: a stale 15.5 N s record of D's support on R's pelvis (a separated point kept only by its stale
  impulse) kept D's locomotion in `contact`; solved, D leaves it 18 substeps sooner. Six more summaries move in peaks
  only; no row over a ceiling, worst query tick 3423. Tests: tests/contact-impulse.test.ts (a five-point hull on a
  frictionless slab: the solved reading equals the momentum the contact applied in 479/479 steps, the old one is off in
  most), the gating per family. Captures regenerated; `L4-F9-defenderFalling~v3@65` kept as captured and resumed with
  the `solver` variant (from the start under the solved reading D stays under the ceiling without `carried`, 132.7 W).
- **7d** (`r7d-test-repairs`) landed: byte-identical, 289/289; tests only. The twoPalm hold-effort row reads the effort
  the joints were given (the fall ledger), with a V3 row: D's left arm asks 0.76 N m with its grasp over its allocation
  and gets none; fault twin, an arm with no room taking its request unscaled. The three rung 7 controls (10b crossing
  negative control, the RESEED sample on L3-F7-phase75, now run on its own, 13e inherited foot on L3-F7-phase50) run
  with `noPlantedPole`. Natural samples pinned to LEG_GUARD_V1: HC-F3-lowRunner and L3-F10-bothMirror shoulders,
  L4-F5-onePalm-on 'left expired', gate4 E1, 13e gripOwner step home, 13f L3-F9-noProbe-contact reversed. Under the V3
  map (`r7-triage/v3map.patch`): 8 failures, 6 by construction (harness profile table, physical-legs "no fixture runs
  V3", state.test x2, l3-contracts tracked defects x2), L4-F3-run-on shoulder persistence (0.2875 s), and the twoPalm
  hold's overload exposure 0.065 s against half the release threshold 0.05 s (behaviour, unmasked by the repair).
- **7e** (`r7e-lab-params`) landed: byte-identical; lab only. URL parameters `order=rev` (SimOptions.reverseOrder) and
  `legs=v1|v2|v3` (a leg-guard fixture under that profile; others as they are), shown in the title label, e.g.
  `?fixture=L3-F1-phase6&order=rev&legs=v3`. Test tests/lab-params.test.ts: that URL's run has the summary of the leg
  matrix's reversed row under V3; without the parameters it differs.
- **7f** (`r7f-loaded-limb-rule`) landed: byte-identical, 292/292; tests only (`tests/loaded-limb.ts`). The envelope's
  persistence check (falls) counts a joint's time past the tolerance only while the floor does not hold its limb
  (load-pinned: the floor's solved normal load on the distal segments could exert, at its Coulomb cone and lever, the
  envelope's moment at the tolerance, k |grad| 5 deg; own-trunk load does not pin). A pinned limb stays within
  (1 + overshoot) x the largest load moment of the last half damped period / k (the load from the distal chain's angular
  momentum balance, so friction counts; not judged in the load's first half period or at the cap); once the floor lets
  go it is back inside within the envelope's free crossing time plus a tick. Known-limit entries retired:
  L4-F3-model-oblique-off R (pinned throughout, 4.2 deg inside its bound); L4-F9-low R and L4-F5-twoClamp-off R no
  longer occur at this tree (0.042 s and under 0.05 s on the old clock). Every fall passes under V1 and V3, both orders;
  tightest: L4-F3-run-off D right hip under V3, back in 0.058 s against 0.061 (to watch at the flip). Test
  tests/loaded-limb.test.ts on `L4-F3-run-on~v3@66`: old clock 0.2875 s, rule passes; twins: swing spring off while
  pinned (8.8 deg over the bound, free clock under), off from the start (R's unloaded left arm 0.39 s free), the floor
  letting go at 1.40 s (back in 0.013 s, bound 0.065) and the same with k/25 (0.158 s).
- **8** (next). Triage with V3 on every L3/L4/HC leg-guard fixture at rung 7 (information,
  `.scratch/ladder/r7-triage/`, README there): 17 suite failures, 7 by construction, 4 natural samples or fault
  controls moved (3 of them by rung 7: the RESEED sample is the clearance re-plant rung 7 removes; the 10b and 13e
  controls' symptoms no longer show with the planted pose, both back with `noPlantedPole`), 6 behaviour; one L4 row over
  the ceiling (the self-trunk pinch below); leg matrix none; worst query tick 3588. Before the flip: the knee-pole exit
  at a swing start (below) fixed; the natural samples re-seeded or pinned to their V1 trajectories, the three rung 7
  controls run with `noPlantedPole`, the twoPalm hold-effort row reading the applied effort (it reads the request; with
  the grasps at the owner budget the applied effort is 0). Flip order HC, L4, L3, each with its own test repairs.

Rungs 5-7 are interleaved in the `pose.ts` leg loop and `poseClearanceOf` in the old tree; they are re-expressed in
order, not hunk-split.

## Parked

- `ARM_CLEARANCE_V1` and the arm sweep: dormant and untested in the old tree; M3 reworks the wrap arms.
- Shoulder twist 1000/3: traded one power breach for another and masked the head-plant test.
- The pushed-target clamp from `arm.patch`: raised reversals on trapped arms.
- D4/D5 footwork: reverted (see the handoff's known issues).

## Open defects to test on the ladder

To be reproduced on the first rung where they appear, then handled under rule 7:

- Self-trunk pinch: a ragdoll forearm pressed into its own trunk by the floor gains 7.5 J in one solve
  (L4-F9-contact reversed R; read by the audit as 172 W). Suspected solver energy injection. Reached with V3 on at rung
  7: the same run, R 172.4 W at 1.125 s, its right forearm on the floor (94.7 N s in one substep); from 1.05 s
  (`r7-triage/captures/L4-F9-contact~v3-rev@63`) the twins with the legs, rung 7 or `carried` off give the same 172.4 W:
  reached by the moved trajectory. Tracked defect with a seeded test at the flip.
- Posed thigh held 1.0-1.45 cm inside a ragdoll pelvis for 15 substeps with every clearance loop capped
  (L4-F10-wrap-on D). At rung 7: 24 substeps over 1 cm (longest run 12, deepest 2.14 cm), reversed 29; under V3 none.
  Resolved by the flip.
- Resolved at 7f (the check, not the physics): shoulder persistence under a loaded forearm (L4-F9-exit, L4-F3-run-on).
  Reached with V3 on: L4-F3-run-on R right shoulder past the tolerance 0.2875 s (1.25-1.54 s, up to 7.6 deg) with R's
  right forearm and upper arm on the floor throughout; from 1.10 s (`L4-F3-run-on~v3@66`) all twins give the same run.
  The excess is the load's static deflection (190 / 1500 N m/rad); the loaded-limb rule passes it (L4-F9-free R too).
- Posed leg held inside another player's ragdoll, the conversion then rejected (tracked from rung 3, `LEG_IN_RAGDOLL`
  in tests/l3-pass.ts): D's posed legs 2-6.6 cm inside R's ragdoll core for 8-25 substeps before D's conversion,
  rejected for external penetration: L3-F4-oneArm and L3-F1-phase2 (right thigh in R's pelvis, 4.28 cm at 1.304 s),
  L4-F10-wrap-off (right thigh in R's torso, 5.34 cm at 1.300 s). Controlled twin: rung 3's change off from 1.0 s (the
  same state) gives the same rejection to the last digit. Probably the deeper form of the L4-F10-wrap-on entry above.
  Resolved under V3 (rung 6: the three captures convert); tracked under V1 until the flip.
- A held player's planted foot released by its clearance solve (plant drift just over 1 cm on clearance variant 1) and
  planted again every 0.2-0.6 s in a stationary hold (tracked from rung 3, `HOLD_CLEARANCE_REPLANT`): L3-F6-hold R left
  (2 plants after 3.5 s), L3-F6-holdMirror R right (3) and D left (1). Controlled twin: rung 3's change off from 3.0 s
  keeps the cycle (L3-F6-hold 2 plants, holdMirror 3 R plants). Resolved under V2/V3 by rung 7; tracked under V1 until
  the flip.
- Resolved at 7b: knee-pole exit at a swing start (V3, rung 7): a planted leg held at a knee pole because its primary is in a body the
  legs meet leaves it for clearance alternative 9 in the substep its swing starts (the planted pose applies to plants
  only): the shown shoe moves 2.04 cm, over the transition audit's 1 cm (L3-F4-gripOwner R left 1.7125 s, right ankle
  1.31 cm at 2.083 s). From 1.60 s (`L3-F4-gripOwner~v3-audit@96`) the twin with the legs off and the twin with rung 7
  off are both under 1 cm. Fix before the flip (rung 7b, small): a leg leaving a plant at a knee pole keeps the pole
  candidates, bounded by continuity, until an ordinary one is reachable. Rung 7 off, V3 has its own owner-change
  breaches in the same family (L3-F4-gripTarget D 1.14 cm, L3-F4-gripOwner R 1.33 cm): to check against the fix.
- Resolved at 7c (L3/L4/HC; G/L1/L2/RH keep the old reading): stale impulses in the contact records and the leg
  ledger: both read every manifold point's impulse; a point that was not solved in a substep (one outside the pair's
  four solver contacts) keeps the last solve's value. L3-F9-noProbe-prep (V3) records
  D's shin on R's pelvis at 64.867 N s in three consecutive substeps while R's core changes speed by 2.02, 0.14 and
  0.05 m/s; repeated values add 181 N s to that run (V1: 11.4 N s), 47 N s to L3-F1-mirror4 (V1: none). Observation
  only, but the peaks and ledger totals used to judge contacts are inflated where it happens. A fix may move V1
  summaries that export contact impulses.
- A physical leg starting a solve inside another player's ragdoll: HC-F2-bothFallL2 reversed A's right thigh 1.52 cm in
  B's torso with load (0.979 s) and 3.19 cm in B's shin without (0.975 s), against `PHYS_LEG_OK` 1 mm. To read at the
  flip.
- An unsupported proxy over a refused surface (D2 keeps its legs live): L3-F9-noProbe-prep D, its probe refused on the
  strip and ungrounded in 31 of its 37 leg-contact substeps, falls onto R's shoe with its own pelvis (123.8 N s at
  0.754 s, not a leg), rebounds at 2.1 m/s, and its left shin meets R's pelvis while rising (one real 64.9 N s
  substep, injected 0.11 J, loaded depth 1.1 mm). The leg contact is plausible momentum exchange; the ledger's
  320.7 N s includes the stale repeats above. The rebound of a rigid proxy off a ragdoll shoe is the questionable part.
- Shape-query budget exceeded outside the budget test's two fixtures at `a6d712f`: HC-F5-invalidOne asks 4412 queries in
  one tick (unchanged by the rung 1 memo), L3-F7-mirror50 4028 before the memo and 3943 after. Resolved with the flags
  off at rung 5b (every leg-matrix run under 4000, counted by the full check).
