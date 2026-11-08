# Codebase review milestones

Repository-aligned plan • 2026-11-08 • Not started. Findings from an intensive review of the whole working tree on `model-integration`: committed gates 1–4 and plans 05–07a (HEAD `736d90a`) plus the uncommitted 08, 08a and 09 work.

## Review baseline

Typecheck passes. **All 675 tests pass, but `vitest run` exited 1**: vitest reported one unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` error and counted it as a failure. 411 fixtures are registered; `evidence/summary.json` holds 411 summaries, 238 of them committed at `736d90a`.

No crash, corruption or NaN defect was found in the simulation. The ball-carry port matches the sim-6 donor to about 1e-16. Momentum transfer at conversion, energy behaviour of the joint envelope, the power cap before each solve, substep order, opt-in boundaries and trace/audit-independent determinism were all checked and are sound. The findings are live discontinuities the transition audit cannot see, one broken plan 09 priority rule, evidence and export gaps, and tests that do not establish the contracts they name.

## Evidence labels

Every item carries one label:

- **Checked**: confirmed by reading the cited code during the review.
- **Reported**: found by a reviewer's probe script or code reading and not re-checked. Reproduce it before changing code; if it does not reproduce, record that and close the item.

Review probes were session scratch and are not kept. Each item gives the fixture, time, player and numbers needed to reproduce it.

## Ground rules for every milestone

- Preserve the 238 committed summaries unless an item names the change and the user rules on it. Record every changed L3/L4 summary, ending, ball spot and handoff; do not tune outcomes back into place.
- Do not raise a threshold, drop a landmark, shorten a fixture, suppress a boundary or relabel a failure to pass. Infeasible-contact boundaries remain failures, as the user ruled.
- A behaviour change on a historical path ships under a new profile id unless the user rules otherwise.
- Every fix lands with a regression that fails when the fault is put back.
- Close each milestone with the full suite (exit 0, no unhandled errors), typecheck and build, fixture export and a comparison of all summaries, then update the relevant handoff.

## Prerequisite: checkpoint commits (user decision)

Plans 08, 08a and 09 are stacked uncommitted on `736d90a` (110 paths, about 7.8k changed lines). Recommendation: commit each plan separately as it stands, with its outstanding acceptance in the message (08a visual acceptance; 09 user review), before 10a starts, so each repair below is a reviewable diff.

10c and 10d change exactly what the 09 review and the 08a visual acceptance would look at. Either hold those reviews until after 10c and 10d, or expect to repeat them.

## Milestones

| Milestone | Scope | Why here | Summary impact |
| --- | --- | --- | --- |
| [10a](10a_Test_Gate_and_Evidence_Integrity.md) | Test gate, fixture runner, exports, reset, event stamping, lifecycle | Every later milestone needs a green gate, correct evidence and exports that identify their profiles | None expected to values; exports, trace row 0 after reset and event tick numbers change |
| [10b](10b_Foot_Target_Continuity.md) | Live foot-target snaps, stale step velocity, request jumps, walk ramp, stance width | The largest live defects; L3 changes feed L4 | L3 and L3-derived L4 summaries change |
| [10c](10c_Active_Fall_Contract_Repairs.md) | Hold priority, carry-arm identity, ground and obstruction, order dependence, effort bookkeeping | Plan 09 is awaiting user review | L4 summaries change |
| [10d](10d_Ball_Carry_Evidence_and_Presentation.md) | Non-circular carry tests, mesh seating controls, achieved-arm carry roll, seat frame, lab hot paths | Must precede 08a visual acceptance | L3 may change where the seat or clearance changes |
| [10e](10e_Rules_and_Referee_Correctness.md) | Settle-window intent, influence, retention direction, ground touch | Can change committed summaries; needs rulings | New rules profile; historical unchanged unless ruled |
| [10f](10f_Cleanup_and_Module_Structure.md) | Probes, debug switches, duplicate helpers, dead code, docs, splitting `simulation.ts` and `footwork.ts` | Behaviour-neutral; last, so the splits move settled code | Byte-identical summaries, traces and exports required |

## Finding map

| ID | Finding | Severity | Label |
| --- | --- | --- | --- |
| A1 | `vitest run` exits 1 from worker RPC starvation | P1 | Checked |
| A2 | A filtered fixture run overwrites `evidence/summary.json` | P2 | Checked |
| A3 | Exports carry the carry profile id but not its values | P2 | Checked |
| A4 | One profile id stands for different values (rules, ragdoll) | P2 | Reported |
| A5 | `reset()` leaks per-tick contact classes into trace row 0 | P2 | Checked |
| A6 | A numerical failure still runs the rest of the substep | P3 | Checked |
| A7 | Event tick is one behind its trace row; `substep` is a global counter | P3 | Reported |
| A8 | Stop reasons are relabelled; out-of-bounds stops emit no `trialEnd` | P3 | Checked |
| A9 | `physics.dispose()` not idempotent; driver drops time; tests leak worlds | P3 | Checked / Reported |
| A10 | Vacuous loops in gate tests | P3 | Reported |
| A11 | `allFixtures()` rebuilt on every call | Polish | Reported |
| A12 | `RAPIER_VERSION` hard-coded | Polish | Reported |
| B1 | Composed steps stop dead when the late stretch expires | P2 | Checked |
| B2 | Composed steps keep a stale vertical velocity | P2 | Checked |
| B3 | Unbounded leg-request jump at contact entry | P3 | Reported |
| B4 | Walk ramp skipped outside free mode; mode read one substep stale | P3 | Checked |
| B5 | Hard-coded hip half-width; duplicated stance fade | P3 | Checked |
| B6 | `braceW` clamped without `braceV` | P3 | Reported |
| B7 | Coached controller aims with the previous phase | P3 | Reported |
| B8 | Transition tests that do not establish their claims | P3 | Checked / Reported |
| B9 | Intake script robustness | P3 | Checked / Reported |
| B10 | Plan 08 handoff corrections | Docs | Checked |
| C1 | A hold arm's own effort overloads and releases its grasp | P2 | Checked |
| C2 | `L4-F12-carryLeft` protects the empty arm | P2 | Checked |
| C3 | Three different definitions of ground | P3 | Reported |
| C4 | `obstructed` is sticky and set by the player's own hold | P3 | Checked |
| C5 | `rotateToward` skips its rate limit for opposite vectors | P3 | Checked |
| C6 | Natural-contact articulation depends on player order | P3 | Checked |
| C7 | Effort bookkeeping: `pairSum`, `activeSubsteps`, ledgers, twist measures | P3 | Checked / Reported |
| C8 | Fall tests that do not establish their claims | P3 | Reported |
| C9 | Plan 09 handoff corrections | Docs | Checked |
| D1 | Circular carry contract tests | P2 | Checked |
| D2 | Mesh seating controls too weak | P2 | Reported |
| D3 | Achieved right arm still gets the carry roll and flex | P3 | Checked |
| D4 | Seat set in the request frame, ball placed in the achieved frame | P3 | Reported |
| D5 | Lab hot-path allocations and blend mismatch | Polish | Reported |
| D6 | 08a handoff corrections | Docs | Checked |
| E1 | Settle-window override drops the stance request | P3 | Checked |
| E2 | Influence clears while the request is zero | P3 | Checked |
| E3 | Progress retention uses force magnitude, not direction | P3 | Reported |
| E4 | Ground touch matches the floor key only; exclusion list unused | P3 | Reported |
| F1–F11 | Cleanup and structure | Polish / Change | Mixed |

## Decisions the user owns

| ID | Decision | Milestone |
| --- | --- | --- |
| U1 | Checkpoint commits before 10a | Prerequisite |
| U2 | Whether out-of-bounds stops gain a `trialEnd` event, which changes event counts in their summaries | 10a A8 |
| U3 | Whether the coached-controller phase fix applies to historical fixtures | 10b B7 |
| U4 | Hold priority: grasp-first allocation (recommended), damping-only hold, or effort-free overload exposure | 10c C1 |
| U5 | Left carry: drop `L4-F12-carryLeft` or implement a mirrored carry | 10c C2 |
| U6 | Whether obstacles count as ground | 10c C3, 10e E4 |
| U7 | Natural-contact articulation in both player orders: required, or a declared limit | 10c C6 |
| U8 | Rules fixes on the historical rules profile or only a new one | 10e |
| U9 | Keeping the stance request through the settle window on committed fixtures | 10e E1 |
| U10 | Probe scripts: delete unreferenced ones or archive them outside typecheck | 10f F1 |
| U11 | Git LFS for model and animation sources | 10f F11 |
