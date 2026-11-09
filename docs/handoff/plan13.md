# Plan 13 handoff: lab review pass

Plan: [13 — Lab review pass](../open/13_Lab_Review_Pass.md). One section per milestone, each in its own commit on `model-integration`.

## 13a — Contact performance

Plan: [13a](../open/13a_Contact_Performance.md). Implemented 2026-11-09 after `5c85eb7` (plan 13 docs).

**Result:**
- **Identity.** All 410 exports are byte-identical to `5c85eb7`. Every trace and `summary.json` was compared byte for byte against exports regenerated at that commit, after each of the three steps of part 1. Part 2 changes only `src/lab`, `index.html` and tests.
- **Query count.** The worst tick of L4-F10-wrap-on falls from 28,557 shape queries to under 4,000, and L3-F8-recontact from 83,682 to under 4,000 (the new regression test).
- **Headless speed.** 9 fixtures now have a tick over the 16.7 ms frame budget (86 before) and 1 has its p95 over it (57 before). Every p95 is under 20 ms. Two fixtures miss the plan's mean-under-8 ms target: L3-F5-dragMirror (10.5 ms) and L3-F6-holdMirror (8.0 ms). See [Known limits](#known-limits).
- **Lab.** The lab now computes ahead of what it shows and draws from per-tick snapshots. In Chrome, at 1× from a cold start, L4-F10-wrap-on, L3-F8-recontact and L3-F5-drag play in real time with a frame-time p95 of 17.5–18.4 ms. There was no `computing` hold.
- The full suite passes: 851 tests in 24 files (845 before, +6), in 161 s (281 s before). Typecheck and build pass.

### What changed

**Part 1: exact culls (src/sim).** Each skips a shape query whose result is known to be empty. None changes a result.
- `physics.ts`: `CULL_SLACK_M` (0.1 mm), `shapeRadius`, `boundsNear`, `cullGeom`/`geomNear` (bounding sphere, then an enclosing capsule: exact for a ball or capsule, the longest axis for a box), `boxSeg`, `segmentDistanceSq` (Ericson 5.1.9), and a box-against-segment bound in the box frame. `TrunkPiece` gains an enclosing capsule (`seg`), and `trunkContact` tests it before querying. Its existing sphere test is unchanged.
- `pose-runtime.ts` (`depth`, `push`): cull per pair, cache each external's cull geometry once per clearance, and build a limb's Rapier shape only when some pair survives.
- `arms.ts` (`query`), `simulation.ts` (`closingSpeeds` against other bodies and its plan 11 self-trunk loop, plan 12 `shoeDeeper`): the same cull.
- **Step 3: queries from the collider side.** An `ExternalShape` from a live collider keeps it (`collider`): other players' active colliders and obstacles in the pose clearance, and the own torso and pelvis. `depth` and `push` then call `collider.contactShape`, which converts only the limb shape. `closingSpeeds` calls `contactCollider`, which converts nothing. Byte-identical, so it stays.

**Part 2: look-ahead playback (src/lab).**
- `playback.ts`: `Playback<F>`, a buffer with one snapshot per tick. Each display frame computes one tick, then more while the last tick's cost still fits the 8 ms budget. Shown time advances by wall time × speed and holds at the newest frame (`computing`). It also has `step`, `seek`, `finish` and `restart`. It is generic, so tests drive it with a fake clock.
- `snapshot.ts`: `FrameCapture` turns the simulation after a tick into a `LabFrame`: core poses, the solved pose (the simulation builds a new one each tick and never changes it after), COM and velocity, overlay inputs, collider wireframe shapes and poses, contact and foot markers, rule ball spot, and the info panel's simulation lines. A collider set is one shared array while unchanged, and shapes are read when the set changes, because a removed body's colliders are freed. Arm overlay points are tagged with the player whose drawn pose carries them.
- `main.ts`: draws only from frames, interpolating the pair around the shown time. A representation change still shows the new representation without a blend. Run, pause, step, speed, `?t=`, reset and the tune sliders work on the buffer. There is a new scrub bar ("time", over the computed range). Export JSON computes the run to its end first. Scripted hooks: `lab.runTo(t)` seeks, and `lab.shownT` and `lab.computedT` are new. The info panel shows `playback 1×  computed to … s (end)  COMPUTING` in place of the dropped-time report.
- `views.ts`: `PlayerView` builds wireframes from `ColliderDesc` and reads its overlays from the `PlayerFrame`, not the live player.

**Tests (+6):**
- `harness.test.ts`: the regression test (the worst-tick query count on the two fixtures stays under 4,000; at the baseline it fails at 28,557), and the cull unit test. The unit test runs 10,000 random ball, capsule and box pairs at field coordinates (a fifth parallel or antiparallel). No pair the query returns is culled, and over 90% of the empty pairs are culled. Two injected faults were caught: the box test without its prediction culled 120 returning pairs, and the segment test 2 mm short culled 35.
- `lab-render.test.ts` (rewritten on the playback path; the follow-camera test keeps its 1 mm bound at 60, 120 and 144 Hz):
  - A 40-tick slow stretch (12 ms ticks) costs lead, not frames. Every frame's stepping is within the budget plus one tick, the shown time advances exactly one tick per 60 Hz frame, and there is no hold. Removing the budget fails it (a 660 ms frame).
  - Playback that outruns the simulation (20 ms ticks at 2×) holds and never skips a tick.
  - Paused fill, step, seek, finish and restart address exact ticks.
  - A real fixture's frames match direct stepping tick for tick, and the collider set changes only at a representation change.
- `helpers.ts`: `shapeQueryCounter`.

**Probes** (committed): `scripts/probe/p13-ticktime.ts` (per-tick wall time) and `scripts/probe/p13-qcount.ts` (queries per tick).

### Measurements (Apple M2, `p13-ticktime`, ms)

Slowest fixtures after 13a, against the baseline survey at `5c85eb7`:

| Fixture | Mean | p95 | Max | Ticks over 16.7 ms |
| --- | --- | --- | --- | --- |
| L3-F8-recontact | 24.34 → 5.56 | 67.44 → 17.50 | 98.23 → 26.33 | 69 → 8 |
| L3-F5-dragMirror | 22.96 → 10.47 | 33.86 → 15.10 | 41.73 → 15.98 | 131 → 0 |
| L3-F6-holdMirror | 16.32 → 8.03 | 25.42 → 12.48 | 32.23 → 13.94 | 171 → 0 |
| L3-F5-drag | 16.59 → 6.48 | 26.74 → 10.48 | 36.07 → 12.76 | 66 → 0 |
| L4-F10-wrap-on | 10.83 → 4.50 | 29.39 → 11.03 | 36.21 → 15.18 | 22 → 0 |
| L3-F4-twoArm | 9.41 → 4.00 | 28.08 → 10.55 | 35.28 → 19.97 | 19 → 1 |
| L3-F1-phase0 | 7.97 → 3.74 | 19.64 → 9.30 | 42.98 → 18.25 | 10 → 1 |
| HC-F3-mirror | 7.37 → 3.64 | 19.41 → 10.26 | 36.53 → 19.65 | 7 → 1 |
| L4-F9-defenderRising | 6.86 → 5.0 | 20.73 → 13.5 | 31.14 → 18.4 | 6 → 3 |

- All four prototype-table fixtures are faster than the prototype (L3-F8-recontact mean 6.1 → 5.56, L3-F5-dragMirror 13.2 → 10.47, L4-F10-wrap-on 7.0 → 4.50, L3-F5-drag 8.9 → 6.48).
- The full-survey run showed one 85 ms tick on L4-F9-defenderRising. Two repeat runs gave a maximum of 18.4 ms, so it was a GC pause; its row uses the repeats.
- Exporting all 410 fixtures took 82 s with step 1 and 73 s after step 3.

**Lab, Chrome (rAF intervals and frame-callback timing from injected script, not a DevTools trace), 1×, Run pressed right after load:**

| Fixture | Wall (s) / simulated (s) | Frame p50 / p95 / max (ms) | Frames over 20 ms | Worst frame's stepping (ms) |
| --- | --- | --- | --- | --- |
| L4-F10-wrap-on (fresh page) | 1.75 / 1.75 | 16.7 / 17.5 / 18.5 | 0 | 16 (one tick) |
| L3-F8-recontact (first fixture of the page) | 2.42 / 2.40 | 16.7 / 18.4 / 33.3 | 1 | 21 (one tick) |
| L3-F8-recontact (again) | 2.37 / 2.40 | 16.7 / 18.4 / 18.7 | 0 | 20 (one tick) |
| L3-F5-drag | 2.63 / 2.67 | 16.7 / 18.4 / 18.6 | 0 | 11 (one tick) |

- Replaying a fully computed buffer gives p95 18.5–18.6 ms with no frame over 20 ms, so drawing alone fits a frame. Paused, the buffer fills in the background: L4-F10-wrap-on's 1.75 s computed in 1.1 s of wall time, with every frame under 18.5 ms. No console errors.
- The very first measurement of the session was bad (p50 33 ms, p95 69–115 ms on all three fixtures, with Run pressed while the page was still loading and warming up). It did not reproduce in the four later runs, including the fresh page above.

### Departures from the plan

- **Cull geometry.** The bounds come from each shape and its pose (`cullGeom`), not from a stored `bound` field on `ExternalShape`.
- **Step 1 alone did not pass the query test** (6,713 on L4-F10-wrap-on, 6,090 on L3-F8-recontact). Step 2 was widened to pass it, still exactly: boxes get an enclosing capsule and a box-frame bound, trunk pieces get an enclosing capsule, and the cull also covers `shoeDeeper` and the self-trunk loop of `closingSpeeds`.
- **Slack.** The cull slack is 0.1 mm, not the plan's 1e-6 m. Rapier computes in single precision, and 1e-6 m is below its rounding at field coordinates. The larger slack culls slightly less but is safe.
- **Step 3 scope.** The arm task's obstacles still query from the shape side, because their pose is composed from the body pose, not read from the collider.
- **Stepping per frame.** The plan asked that no frame spend more than 8 ms stepping. On one thread that cannot hold: a tick cannot be split, and skipping it would stall the run. Each frame computes one tick and then more while the estimate fits, so a frame steps at most the budget plus one tick (21 ms at worst, on L3-F8-recontact). The plan's test (a 30 ms stub tick inside an 8 ms frame) is replaced by the slow-stretch and outrun tests above. Running the simulation in a Web Worker would remove the limit; the snapshots are plain data except for the collider descriptors, which are plain too.
- **Driver.** `FixedStepDriver` and `solver.maxTicksPerFrame` stay: seven test files and a probe use the driver, and the profile field is part of the solver profile. The lab no longer uses either, and the dropped-time report is gone.

### Known limits

- **Mean tick over 8 ms** on L3-F5-dragMirror (10.47) and L3-F6-holdMirror (8.03), both sustained contact. A CPU profile of dragMirror after the culls shows Rapier `contactShape` at 66% of tick time. Most of that is the narrow phase in WebAssembly on pairs that are really within 2 cm; moving shapes into WebAssembly is about 13%. No exact cull removes it. In the lab these fixtures still play at 1× (one tick plus drawing fits a frame).
- On a slower machine, a sustained contact whose tick and drawing together exceed a frame plays below 1× while `computing` shows.

### Evidence

- Exports: `.scratch/p13/ev-base` (at `5c85eb7`) against `ev-step1`, `ev-step2`, `ev-step3` and `ev-final` (the committed tree): `cmp` on `summary.json`, `diff -rq` on 410 traces, no differences.
- Tick table: `vite-node scripts/probe/p13-ticktime.ts . 0 quiet`.

## 13b — Test consolidation

Plan: [13b](../open/13b_Test_Consolidation.md). Implemented 2026-11-09 after `6b5dc0c` (13a). Tests, `scripts/probe/` and docs only: no file under `src/` changes, so every export is byte-identical.

**Result:**
- **Count.** 851 tests in 24 files at the 13a tip, 226 tests in 13 files now (at most 300 in 13 asked).
- **Time.** The three closing runs took 76.7, 74.5 and 72.3 s of wall time (Apple M2, `npx vitest run`). The 13a tip took 161 s, so the target was at most 80.5 s. User CPU fell from 847 s to 371–394 s.
- **Map.** `scripts/probe/p13-test-map.ts` maps all 851 baseline tests to the 226, problems 0, and every test now holds at least one baseline assertion. The expanded map is [plan13b-test-map.md](plan13b-test-map.md).
- **Faults put back.** Each of the three fails the suite and names its fixtures (see [Negative check](#negative-check)).
- **Stability.** Three runs in a row exit 0 with no unhandled errors. Typecheck and build pass.

| File | Tests | Holds (baseline files) |
| --- | --- | --- |
| l3-contracts | 30 | the per-fixture parts of transitions-audit (107), foot-continuity (102), transitions-feet (99), transitions-modes (93) and transitions-contact (41); three ball-carry checks |
| transitions | 11 | the scenario tests of those five files |
| falls | 32 | falls (84) |
| gate4 | 23 | gate4 (49), rules-revision (5) |
| footwork | 20 | footwork (60) |
| gates | 18 | gate1 (19), gate2 (12), gate3 (16) |
| harness | 17 | harness (14), debug-options (3), lab-render (5); the opt-in and export tables |
| ball-carry | 16 | ball-carry (24), ball-carry-mesh (4), ball-carry-evidence (2) |
| handoff-contact | 15 | handoff-contact (22) |
| body-limits | 13 | self-clearance (17), joint-range (8) |
| locomotion | 11 | locomotion (22) |
| model | 10 | model (20) |
| ride-height | 10 | ride-height (23) |

### What changed

**The L3 contract pass** (`tests/l3-pass.ts`, `tests/l3-shard.ts`, `tests/l3-contracts.test.ts`):
- A check is `{ name, fixtures, watch(def, report) }`. `fixtures` is a pattern or a list of L3 ids; a list must be covered exactly. `watch` returns hooks for every substep, before and after every tick, and the end of the run.
- Every L3 fixture runs once with the transition audit on and every check that covers it attached: 46 checks over 97 fixtures. They are the nine per-fixture contracts of the plan, and the named cases that read a plain run of a registered L3 fixture. Those cases now read the pass's run instead of a run of their own; the audit reads copies, which "the audit reads copies" proves on its sample.
- A hook that throws reports its first failed assertion and stops that check for that fixture, as the old test stopped. The other checks go on. A check that collects breaches (the audit, continuity, foot limits) reports each of them.
- One test per contract, or per closely related group (30 tests). Each fails once with every failure on every fixture, prefixed with its check's name, and the list is in the message, because the JSON reporter prints no diff. Assertions over several fixtures together (the counters that show a check saw what it bounds) are in the same test, after the list.
- **Shards.** The pass is split over child processes: two by default, a quarter of the cores, at most 4. Each runs `tests/l3-shard.ts` under vite-node and asks for the next fixture as it finishes one, longest first, so the shards end together. They send back each fixture's failures and, at the end, their records: counters are summed, per-fixture maps taken over. Results are put back in the pass's order. A shard that fails or exits early fails the pass with what it printed. The shards run at nice 10, below the test workers: they fill the cores the single-worker files leave idle instead of slowing them.
- `L3_CONTRACTS=<regex>` narrows the pass to the matching fixtures. Every test name then says so, a test whose checks cover none of them is skipped, and the assertions over several fixtures together are not made. `L3_SHARDS=<n>` sets the shard count; 0 runs the pass in the test process, to debug a check.
- The copy comparison's unaudited run is made in the shard right after the audited one, so the trace and per-substep state hashes never leave the shard.
- The shards cannot import `vitest` (it throws outside its runner). The checks use `tests/plain-expect.ts`: chai with `@vitest/expect`'s plugins, which is what vitest's own `expect` is built from, so the matchers and messages are the same. The simulation helpers without vitest moved to `tests/runs.ts`; `tests/helpers.ts` re-exports them and keeps `rows` and `nonEmpty`.
- The KNOWN_AUDIT entry removed (`L3_CONTRACTS='^L3-F7-(mirror0|phase0)$'`): the audit test fails with the one boundary, `L3-F7-mirror0 0.7875 R leftAnkle … raw 0.0101: expected 0.010089016080803953 to be less than or equal to 0.01`.

**Tables.** `rows()` (tests/helpers.ts) runs every row of a table, yields a macrotask between rows, and fails once with each failing row's label and first failed assertion. Every `for … it(…)` loop is now one table test. Checks under one describe that read the same runs are one test whose rows are the named checks; the map shows each merge. `each()` is deleted.

**Harness tables.** One opt-in table: each plan's profile on for exactly its fixtures, earlier ids on their paths (G4, the L2 braking motor, plan 08, L4, plan 10b, plan 10e, plan 12). One export table: exports name their profiles by id and value (G1-C, L1, plan 08, L4, the two 10a A3/A4/A12 tests, plan 11). Each row is the plan's own test, unchanged.

**Shared runs.** Within a file a fixture with the same options is simulated once, with every observer attached. falls and ball-carry register observers while the file is collected, so the first test to read a fixture runs it with all of them. Their tests assert on what the observers recorded.

**Moved into the pass from ball-carry:** the one-ball evidence (plan 10d D1(a), every L3 rule fixture), the rule-reference check (the first 12) and contact and recontact (six audited runs). They read runs of registered L3 fixtures, which the pass already makes. ball-carry keeps the carry runs that need its own observers and its twins.

**Map.** `tests/test-map.json` holds ordered rules `{ from, to }`; the first `from` (an anchored regex over `<file> > <describe> > … > <title>`) that matches a baseline test gives its new test. `vite-node scripts/probe/p13-test-map.ts <baseline.json> <new.json> tests/test-map.json [out.md]` exits 1 on an unmapped baseline test, an unknown or failed target, or a rule that matches nothing.

### Negative check

Each fault was put into every simulation of a full run: appended to `tests/setup.ts` and `tests/l3-shard.ts` as a wrapper on `Simulation.create`, then removed (both files `cmp`-identical after).

| Fault | Tests failing | Named |
| --- | --- | --- |
| 10b crossing heading (`debug.foot.crossingBodyHeading`) | 2 | the transition audit: L3-F9-convert-prep 0.5458 D rightKnee, 1.054 cm (raw 0.73); the harness debug-switch rows (the switch is on in the default run too) |
| plan 11 without self-clearance (`selfClearance: undefined`) | 10 | body-limits: L3-F16-sprint R right arm 5.4 cm into the trunk, L3-F1-low and HC-F3-mirror arm-task arms, HC-F1-low, L3-F3-recover and L3-F16-handoff ragdoll forearms, the impact guard on L4-F9-contact; the transition audit (L3-F9-noProbe-contact); the export row; three L3 contracts |
| plan 12 without joint range (`jointRange: undefined`) | 15 | body-limits: shoulder cone (L3-F9-convert-prep D left 38.8°), HC-F3-phase0 ragdoll shoulder, HC-F1-low ankle −45°, L3-F1-low heel lift, the ragdoll feet; falls: the slack cone, brace outcomes on L4-F3 and L4-F4, the obstructed miss, both hold tests, the mirror; the opt-in row; the L3 boundary records (L3-F7-phase75, L3-F1-phase5) and continuity records (L3-F3-side) |

### Departures from the plan

- **The contract shape.** A check's `watch` returns hooks, and a failure is a string that carries the fixture, player, time and value. The plan's form was `{ observe, finish → Failure[] }`. The hooks also serve the named cases that need a tick or a substep.
- **More checks than the nine contracts.** The named cases on plain runs of L3 fixtures became checks in the pass too, so 46 checks ride one run per fixture.
- **Shards.** Not in the plan. Run in the test process, the pass alone took 51 s, 78 s with the other files, and set the suite at 91 s. With two shards the pass ends with the rest.
- **Yielding.** The yield is `pace()` (a macrotask once 50 ms of wall time has passed) and `breathe()` between fixtures and rows, the helpers' way since 10a, not a `setTimeout` per fixture.
- **No reproducibility table.** The reset, render-rate and pause tests stay in their files: gate4's 35 resets, falls, transitions (L3-F12 and 20 resets), handoff-contact, locomotion, footwork (L2-F10), ball-carry, harness A5 and gates. Each reads its file's runs and helpers, and together they are about 70 s of serial runs: one table in harness would make that one worker the suite's critical path and miss the time target. The opt-in and export tables are made.
- **One commit.** The plan's commit-sized steps (audit first, then continuity, then the rest) were worked through in order, with a passing run and a map check at each step, and are committed as one milestone commit.

### Known limits

- A contract test fails as one test for many fixtures; the message carries the list. A failure is cut to 600 characters.
- The shards do not run `tests/setup.ts`. `tests/l3-shard.ts` repeats its one default (`SIM_DEFAULTS.ledgers = true`); a new default in setup.ts must be added there too, and a fault put back must go in both.
- `chai` and `@vitest/expect` are vitest's own dependencies, imported directly (no package change was allowed). They update with vitest.
- vitest collects every `*.test.ts` outside `node_modules`, `.scratch` included: keep none there.
- The time is near its limit on this machine: runs of the closing tree measured 72–77 s, and earlier steps up to 80 s. The suite is CPU-bound. The last files to finish, falls (27 s alone) and handoff-contact, run in one worker each, and the whole machine is busy until the end.

### Evidence

- Reports in `.scratch/p13b/`: `base.json` (the 13a tip, 851 tests), `final1.json` to `final3.json` (the three closing runs), `fault-crossing.json`, `fault-noSelfClearance.json`, `fault-noJointRange.json`, `known-off.txt`.
- Map: `npx vite-node scripts/probe/p13-test-map.ts .scratch/p13b/base.json .scratch/p13b/final3.json tests/test-map.json docs/handoff/plan13b-test-map.md`.

## 13c — A short lab fixture list

Plan: [13c](../open/13c_Lab_Fixture_List.md). Implemented 2026-11-09 after `aa1157a` (13b). Lab, `index.html`, tests and docs only: no file under `src/sim/` changes.

**Result:**
- **The list.** The lab opens on the review set: the plan's 26 fixtures in four groups, each option `name · id`. The checkbox **All fixtures (410)** shows every registered fixture, grouped by milestone as before, each option `id · title` (the title cut at 60 characters). The filter box narrows whichever list shows, by id, name or title.
- **Reach.** `?fixture=G4-F1` opens the full list on G4-F1. All 410 fixtures stay registered, tested and exported.
- **Identity.** `npm run fixtures` exported all 410 and left `evidence/summary.json` byte-identical (no `git diff`).
- **Tests.** 228 in 13 files (226 before, +2), all pass, exit 0, no unhandled errors; 78.3 s wall time. Typecheck and build pass.
- **Outstanding.** The user edits names and members by eye in `src/lab/review-set.ts`; the tests hold whatever set results to the rules below.

### What changed

- `src/lab/review-set.ts`: `REVIEW_SET`, groups of `{ id, name }`. The only place the list is written.
- `src/lab/fixture-list.ts` (new, no DOM): `fixtureList(fixtures, all)` builds the review or the full list; `filterList(groups, query)` keeps the options holding every word of the query (any order, ignoring case) in their id, name or full title, and drops empty groups; `inReviewSet`, `firstReviewId`; `milestoneGroup` (moved out of `main.ts`, same labels).
- `index.html`: the filter box and the checkbox above the select.
- `src/lab/main.ts`: `fillFixtureSelect` rebuilds the select from the chosen list and the filter and keeps the loaded fixture selected; `wireFixtureList` wires the select, the filter and the checkbox. The choice of list is stored under `tackleLab.allFixtures` in `localStorage`, each access in try/catch; the default is the review set.
- **Tests** (`tests/harness.test.ts`, "plan 13c"):
  - The set: every id registered and unique, every player on the model body (`MODEL_CALIBRATION_ID`), at most 30 entries, no empty group or name. It failed before `review-set.ts` existed.
  - The lists: the review list is the set in order as `name · id`; the full list is every fixture in registry order as `id · title`, at most 60 title characters; the filter finds by name (`HEAD-ON`), id (`l4-f10`), title (`contested`) and several words (`wrap two-arm L4`), returns nothing for a non-match and the list unchanged for a blank query; G4-F1 is outside the set.

### Negative check

Faults put into `src/lab/review-set.ts`, then the file restored (`cmp`-identical):
- A repeated id: `duplicate review-set ids: expected 28 to be 29`.
- A blank name, G4-F1 and an unregistered id: `HC-F1-low: no name`, `G4-F1: a player is not on the model body`, `nope: not registered`.

### Browser check (Chrome, the dev server on 5197)

- No URL: the select shows 26 options in four groups, L3-F13-carrier loaded; nothing stored.
- `wrap`: seven options. `zzzz`: a disabled "no fixture matches the filter".
- The checkbox: 410 options, the loaded fixture kept, `1` stored; unchecked: 26, `0` stored.
- `?fixture=G4-F1`: the full list, G4-F1 selected, the stored `0` unchanged. Unchecked, G4-F1 stays at the top under "Loaded".
- Choosing L4-F10-wrap-on in the select loads it and sets the URL. `head-on` then Enter loads L3-F3-collision; Esc clears the filter.
- No console errors.

### Departures from the plan

- **`fixture-list.ts`.** The list building and the filter are a pure module, so the second test checks them without a browser. `review-set.ts` stays data only.
- **"Loaded".** A loaded fixture the list does not show (filtered out, or outside the review set) is kept at the top of the select under "Loaded", so the select always names what is on screen.
- **Keys.** Enter in the filter loads the first match; Esc clears it.
- **Default fixture.** Without `?fixture=` (or with an unregistered id) the lab opens on the first review-set fixture, L3-F13-carrier, not the first registered one (G1-F1).
- **URL and memory.** A `?fixture=` outside the set turns on the full list for that page only; the remembered choice changes only when the checkbox is used.
- **Groups.** The full list keeps the earlier grouping: 21 groups (each gate's milestones are separate groups), not the ten the plan counted.

### Known limits

- The review list's names are a first draft (the plan's table). L3-F16-sprint keeps its id after 13d removes the Sprint clip; its name ("Top speed, 6.6 m/s") does not name a clip.
- The filter is a substring match, not a fuzzy one: `twoarm` does not find `two-arm`.

### Evidence

- `.scratch/p13c/final.json` (the closing run, 228 tests), `.scratch/p13c/fixtures.log` (the export).
