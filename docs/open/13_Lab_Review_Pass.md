# 13 — Lab review pass: speed, clips, fixtures and tests

Repository-aligned plan • 2026-11-09 • **Designed, not implemented.** Follows plan 12 (`4f38d34`) and the plan 13 stub (`588d63b`). The stub, the conversion overlap margin, becomes 13f; the user added five items on 2026-11-09:

1. Remove the Sprint animation; Fast Run is the base for every run speed.
2. Use the idle and walk animations where they belong.
3. Fix the stutter on collision (L4-F10-wrap-on, and others).
4. Make the lab's fixture list short enough to use.
5. Cut the test count, which is approaching 1,000.

## Baseline (`588d63b`, Apple M2)

- **Tests:** 845 in 24 files, all pass; 281 s wall time. 503 of them are one check copied per fixture.
- **Fixtures:** 410 registered, all in one lab list.
- **Speed:** 86 fixtures have at least one tick over the 16.7 ms frame budget, 57 have their p95 over it. L3 is worst: 55 of 97. Up to 83,682 shape queries in one tick, 93–98% of them between bodies more than 2 cm apart.
- **Clips:** Fast Run and Sprint blend by speed, 7% apart in nominal speed. A jog from 2.1 to about 3.5 m/s shows the procedural gait. Idle is one static frame. Of the 194 L3, L4 and HC fixtures, 87 have the idle, walk and run clips.

## Milestones

| Milestone | Scope | Why here | Summary impact |
| --- | --- | --- | --- |
| [13a](13a_Contact_Performance.md) | Exact culls and collider-side queries in the pose clearance (a prototype cull alone made contact 2–4× faster, byte-identical); the lab simulates ahead of playback so a slow tick never holds a frame | Behaviour-neutral. Every later milestone then tests, exports and reviews faster, and the user reviews in the lab without stutter | None: all exports byte-identical |
| [13b](13b_Test_Consolidation.md) | 845 tests to at most 300; one test per contract, not per fixture; one shared run per fixture; 24 files to 13 | Tests only. Before the clip changes, so 13d–13f update far fewer tests | None: no `src/` change |
| [13c](13c_Lab_Fixture_List.md) | A 26-fixture review set as the lab's default list; "All fixtures" toggle and a filter | Lab only. Before the clip changes, so the user reviews them from the short list | None |
| [13d](13d_Fast_Run_Base_Clip.md) | Sprint removed everywhere; Fast Run from a jog to top speed, its stride shortening below its slowest cadence | The first behaviour change | Every fixture with run clips (130): L1, L2, RH, HC, L3, L4 |
| [13e](13e_Idle_and_Walk_Coverage.md) | The idle cycle plays (arms, head, sway); idle, walk and Fast Run on every model-body L3, L4 and HC fixture | After 13d, so the new coverage gets the one-clip run | HC, L3 and L4 |
| [13f](13f_Conversion_Overlap_Margin.md) | Predictive leg guard: the pose's legs stay clear of where other bodies will be at the next substep | Last: 13d and 13e change the legs, so the near-limit table is re-measured on them | L3, L4 and HC (opt-in profile) |

Each milestone is its own commit, with its handoff section in `docs/handoff/plan13.md`.

## User decisions (2026-11-09)

| ID | Decision | Milestone |
| --- | --- | --- |
| U1 | Sprint is removed everywhere, asset and record included. The plan 10 U2/U3 history rule is waived for this change | 13d |
| U2 | Fast Run is the base for every run speed, with its existing adaptations (calibrated legs, stance width, carry swing, plan 12 ranges) | 13d |
| U3 | The idle cycle plays: arms, head and a small weight sway; feet planted; each player at its own phase | 13e |
| U4 | Idle, walk and Fast Run apply on L3, L4 and HC; HC moves to the L3 foot planner; changed summaries listed, not tuned back | 13e |
| U5 | Conversion margin: option B, a predictive leg guard | 13f |
| U6 | Fixtures are hidden in the lab, not deleted | 13c |
| U7 | The test count comes down; the target (at most 300) is the plan's | 13b |

**Defaults the user can still change** before the milestone starts:
- 13f is an opt-in profile on L3, L4 and HC (plan 10 U2/U3 rule), and the diagnostic forearm-clamp cases are out of its scope.
- 13e leaves the 50 authored-body fixtures and the 12 L4 tipped falls (converted at 0.05 s) without the locomotion set.
- 13d's `minStride` and `liftScale`, and 13c's names and members, are set by the user by eye in the lab.

## Ground rules for every milestone

- Preserve committed summaries unless the milestone names the change. Record every changed summary, ending, ball spot and handoff; do not tune outcomes back into place.
- Do not raise a threshold, drop a landmark, shorten a fixture, suppress a boundary or relabel a failure to pass. Infeasible-contact boundaries stay failures, as the user ruled.
- A behaviour change on a historical path ships under a new profile id unless the user rules otherwise (13d's U1 is such a ruling).
- Every fix lands with a check that fails when the fault is put back. After 13b, a per-fixture check is a contract in `tests/l3-contracts.test.ts` or a table row, never a generated test.
- Close each milestone with the full suite (exit 0, no unhandled errors), typecheck and build, fixture export and a comparison of all summaries, then the handoff.
- Probes used as evidence are committed under `scripts/probe/` with the milestone prefix (`p13-…`), not left in `.scratch/`.

## Visual acceptance still outstanding from earlier plans

08a's carry and its leg repair, plan 09's user review, and plans 11 and 12's visual acceptance stay open. 13c's review set covers the carry, run, wrap and fall cases those reviews use; any other fixture they name is one filter away in the full list.
