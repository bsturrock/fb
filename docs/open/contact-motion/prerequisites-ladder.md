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
- **4c** (carried impacts) parked, see Parked.
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

Rungs 5-7 are interleaved in the `pose.ts` leg loop and `poseClearanceOf` in the old tree; they are re-expressed in
order, not hunk-split.

## Parked

- `ARM_CLEARANCE_V1` and the arm sweep: dormant and untested in the old tree; M3 reworks the wrap arms.
- Shoulder twist 1000/3: traded one power breach for another and masked the head-plant test.
- The pushed-target clamp from `arm.patch`: raised reversals on trapped arms.
- D4/D5 footwork: reverted (see the handoff's known issues).
- Rung 4c, `impactGuard.carried` (the old tree's D3): no case at 4b needs it. With the flag on the L4 matrix (92 rows) is
  identical; `carriedImpacts` fires in 5 runs for one substep each and changes nothing. The old tree's case
  (L4-F9-defenderFalling, 179.8 W) was measured with the physical supported legs on. Patch and evidence:
  `.scratch/ladder/parked/r4c-carried/`. Reconsider at the physical-legs rungs (6-8). Rung 6, V3 on every leg-guard
  fixture: L4-F9-defenderFalling D 172.0 W (1 substep over) without it, 148.1 W highest with it (the case it needs).

## Open defects to test on the ladder

To be reproduced on the first rung where they appear, then handled under rule 7:

- Self-trunk pinch: a ragdoll forearm pressed into its own trunk by the floor gains 7.5 J in one solve
  (L4-F9-contact reversed R; read by the audit as 172 W). Suspected solver energy injection.
- Posed thigh held 1.0-1.45 cm inside a ragdoll pelvis for 15 substeps with every clearance loop capped
  (L4-F10-wrap-on D).
- Shoulder persistence under a loaded forearm (L4-F9-exit, L4-F3-run-on).
- Posed leg held inside another player's ragdoll, the conversion then rejected (tracked from rung 3, `LEG_IN_RAGDOLL`
  in tests/l3-pass.ts): D's posed legs 2-6.6 cm inside R's ragdoll core for 8-25 substeps before D's conversion,
  rejected for external penetration: L3-F4-oneArm and L3-F1-phase2 (right thigh in R's pelvis, 4.28 cm at 1.304 s),
  L4-F10-wrap-off (right thigh in R's torso, 5.34 cm at 1.300 s). Controlled twin: rung 3's change off from 1.0 s (the
  same state) gives the same rejection to the last digit. Probably the deeper form of the L4-F10-wrap-on entry above.
- A held player's planted foot released by its clearance solve (plant drift just over 1 cm on clearance variant 1) and
  planted again every 0.2-0.6 s in a stationary hold (tracked from rung 3, `HOLD_CLEARANCE_REPLANT`): L3-F6-hold R left
  (2 plants after 3.5 s), L3-F6-holdMirror R right (3) and D left (1). Controlled twin: rung 3's change off from 3.0 s
  keeps the cycle (L3-F6-hold 2 plants, holdMirror 3 R plants).
- Shape-query budget exceeded outside the budget test's two fixtures at `a6d712f`: HC-F5-invalidOne asks 4412 queries in
  one tick (unchanged by the rung 1 memo), L3-F7-mirror50 4028 before the memo and 3943 after. Resolved with the flags
  off at rung 5b (every leg-matrix run under 4000, counted by the full check).
