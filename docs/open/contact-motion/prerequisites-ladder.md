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
  (L4-F9-contact reversed R; read by the audit as 172 W). Suspected solver energy injection.
- Posed thigh held 1.0-1.45 cm inside a ragdoll pelvis for 15 substeps with every clearance loop capped
  (L4-F10-wrap-on D).
- Shoulder persistence under a loaded forearm (L4-F9-exit, L4-F3-run-on).
- Shape-query budget exceeded outside the budget test's two fixtures at `a6d712f`: HC-F5-invalidOne asks 4412 queries in
  one tick (unchanged by the rung 1 memo), L3-F7-mirror50 4028 before the memo and 3943 after. The budget test checks
  only L4-F10-wrap-on and L3-F8-recontact.
