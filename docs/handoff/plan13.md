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

## 13d — Fast Run as the base run clip

Plan: [13d](../open/13d_Fast_Run_Base_Clip.md). Implemented 2026-11-09 after `63323e1` (13c). User rulings during the work: thresholds may change in 13d "since we have a new animation"; no stumble yet; four known limits (below).

**Result:**
- **No Sprint.** `sprint.json`, `source/sprint.fbx`, the manifest entry, the intake record entry, the `SPRINT` import and `stanceWidthAddM.sprint` are gone. `git grep -i sprint` (outside `docs/` and `evidence/`) finds only speed names: the fixture ids L1-F1-sprint, RH-F3-sprint, L2-F11-sprint and L3-F16-sprint, the `l1f1` / `rhf3` kind and `MOTOR_L1_SPRINT` behind them, the template name "Idle To Sprint" in the clip README and a fixture comment, and old test names in `tests/test-map.json` (13b's rename map).
- **One run clip.** `runClipsBew` plays Fast Run at every run speed: id `run-clips:<fast-run identity>+jog-v1`, fade [1.6, 2.2] m/s, `run: { minStride: 0.45, liftScale: 1, shareRadPerS: 12 }`. `runClipsL3` is walk + Fast Run, `stanceWidthAddM { walk: 0, 'fast-run': 0.065 }`. 6.6 m/s plays at 1.13× Fast Run's cadence.
- **The jog.** Below Fast Run's slowest cadence (4.08 m/s scaled) the stride share is `clamp(v / (minRate × nominal × legScale), minStride, 1)`, followed critically damped at `shareRadPerS`. The swing foot's lift and the run bob scale by `share ^ liftScale`; the stance foot keeps the floor. On the walk profiles stride and lift blend in with the clip position.
- **Look review.** The user kept 0.45 / 1 (lab sliders on L3-F17-runStartFree, L3-F16-runStopFree, L3-F16-sprint).
- **Fast Run everywhere it runs** (`scripts/probe/p13d-clip-weight.ts`, exit 0): 130 fixtures with run clips, 11,656 settled rows at 2.2–6.6 m/s, all at clip weight 1 on Fast Run. 44 of them, in L3-F14-walkRunStop(+Carrier) and L3-F17-runStart(Free), are still blending in from the walk at `blendRatePerS` 2 (reported). Rows whose weight target is below 1 (heading fades, contact) are reported by fixture.
- **Jog** (`scripts/probe/p13d-jog.ts`, PASS): L3-F17-runStartFree at 2.3–2.7 m/s (1.117–1.183 s): cadence 0.701× Fast Run's on the mean (0.649–0.752 per tick); the right plant down through it (1.050–1.300 s) drifts at most 3.2 mm (plant tolerance 10 mm).
- **Transitions.** The transition audit finds no L3 boundary over 1 cm (the suite's audit row).
- **Physics.** The plan 09 power audit rows pass. Conversion rejections against `63323e1`: L4-F10-wrap-off D now **converts** (plan 12's known limit, 1.88 cm, no longer occurs); L3-F9-defenderFalling D and L3-F1-falling D (the same run) are **newly rejected**, 2.39 cm, and HC-F3-lowRunner reversed R (a test-only order) is newly rejected, 1.59 cm: known limits to 13f. The deliberate invalid conversions are unchanged.
- **Evidence.** All 410 exported. G1–G4 byte-identical (135); 98 summaries changed (by milestone below). One result change, 32 end-time changes, 39 ball-spot changes; every rule ending keeps its kind.
- **Tests.** 230 in 13 files (228 before, +2: the constant-run full stride, the L3-F9 defender pins), all pass, exit 0, no unhandled errors; 104.7 s wall time. Typecheck and build pass.

### What changed

- `src/sim/run-clip.ts`: `RunClipProfile.run` (validated: `0 < minStride <= 1`, `liftScale >= 0`, `shareRadPerS > 0`; exported); the share and lift in `advanceRunPlayback` (`RunPlayback.share`, `shareV`, `lift`, `stride`); `RetargetOptions.lift` scales the swing ankle's clip height (blended out by the stance contact weight); `playbackLabel` names the last clip at blend 1.
- `src/sim/model/run-clips.ts`: one run clip, `RUN_JOG`, the `+jog-v1` id, the fade band. `run-clips.record.json` regenerated (`npm run intake-clips`; the idle record unchanged).
- `src/sim/pose-runtime.ts` passes the lift; `src/sim/support.ts` `runHeight` scales the bob by it; `sim-evidence.ts` traces the share (`run.s`); `profiles.ts` restates the attenuated-bob comment with Fast Run's figures.
- Fixture notes and the L3-F16-sprint title (`locomotion.ts`, `transitions.ts`); `models/animations/` (manifest, README); `scripts/probe/p07-validate.ts` (the width key).
- Lab: a jog panel beside stance width (`index.html`, `src/lab/main.ts`): `minStride` 0.2–1, `liftScale` 0–3; a change reloads the fixture as `…+jog(minStride X, liftScale Y)`; Copy gives the `run: { … }` block.
- Probes (committed): `p13d-clip-weight.ts`, `p13d-jog.ts`, `p13d-summary-diff.ts`.

### Faults found in 13d's own change, fixed, each with a check

1. **Share step.** Following the raw speed, the share stepped with the first substep and with contact speed changes, and the clip foot request jumped 14–40 cm (the 10b continuity rows failed). The share is now followed critically damped. Unit row: no jump in a substep, no overshoot, settled within 1 s.
2. **First substep.** The first substep after setup measures no travel (0 m/s), which pulled the share to 0.99 for about 0.5 s at the start of every run, even at 6.6 m/s. A substep with no travel now holds the share. Checks: a unit row (fails without: 0.9986) and the L3 row "a constant 6.6 m/s run keeps the full stride" (fails without: 0.9898 at 0.083 s). This alone returned the L3-F9-lift-free audit boundary to 1.00 cm (1.04 before the fix), the 10b crossing-heading negative control to its recorded boundary, two continuity rows, and L3-F7's off-ground time to under its limit.
3. **Label.** On L3 a full run read "walk+fast-run" in traces and the lab panel (the last pair at blend 1). Unit row (fails without).

### Tests re-pointed or changed

Each control moved to a run that still shows its case, with the same limit, unless the limit column changes.

| Check | Was | Now | Why |
| --- | --- | --- | --- |
| L2-F11 stance width (footwork) | unsigned separation | separation signed toward each foot's side | Fast Run at 6.6 m/s lands the feet 3.7 cm crossed |
| Self-clearance negative control (body-limits) | L3-F16-sprint twin | L3-F14-forward twin (walk swing 3.6 cm) | Fast Run's twin swing stays 0.7 cm off the trunk |
| Shoulder cone twin control | L3-F16-sprint | L3-F8-recontact (L3-F16-sprint kept for the on-side) | Fast Run's twin is 7° inside the cone |
| Ragdoll shoulders | HC-F3-phase0, L3-F1-phase0 | HC-F3-falling, HC-F3-mirror | margin 14.6°, twin 25.8° behind; the new ones 32.9° and 32.0° |
| Ankle range, heel lift | L3-F16-sprint | L3-F16-runStop | the twin's shin 34° at constant 6.6 m/s; 45° in the stop |
| E1 settle window (gate4) | L3-F1-phase0 | L3-F1-mirror0 | phase0's historical rise 0.041 m, needs 0.052 |
| Stop handover plant (L3) | first plant after 3.2 s before 3.33 s | first plant after the crossing within 0.1467 s of it | the crossing moved 3.183 → 3.517 s; now 0.071 s |
| Step compared as it is | L3-F1-phase5 | L3-F1-phase6 | phase5's supported-to-airborne boundary is gone |
| Raw kept, set aside | L3-F1-mirror0, raw > 1 cm and after ≤ 1 cm | L3-F1-mirror4, raw − after > 5 mm | no L3 boundary is over 1 cm raw now; mirror4 0.99 → 0.22 cm |
| Out-of-time reproductions | L3-F1-phase0 | L3-F1-phase1 | phase0 has none; phase1 D left 0.721 s, 11.0 → 10.5 m/s |
| Carried handover | L3-F1-low | L3-F1-phase6 | L3-F1-low carries none |
| Defender converts on its bob | L3-F9-defender* | L3-F10-rising, L3-F10-falling | the one-arm defender stays in contact with level vertical speed |
| Obstructed brace misses (falls) | at least 3, natural | at least 1, with L4-F4-obstructed's no-range twin | the 3 natural ones are gone; the twin still misses obstructed (R left 0.442 s) |
| Braking crossing height (footwork) | < 0.81 m | < 0.85 m, and 4 cm under the high-stance twin | the crossing is at about 1.0 m/s, not 2.9: 0.840 m, 5 cm under the high stance |
| Limb landmark jump (footwork) | ≤ 0.3 m | ≤ 0.33 m | RH-F6-failed D left elbow 0.318 m at 1.500 s, a clamp that begins and loses contact in two substeps |
| Run start last step (L3-F17) | > 1.4 m | > 1.39 m | the short half of Fast Run's own stride, 1.396 + 1.713 m |
| Full stop settles (L3-F16-stop2.9 only) | last plant > 0.5 s before the end | > 0.4 s | the squaring step comes 0.41 s before the end |

### Known limits (user rulings)

- **L3-F9-defenderFalling and L3-F1-falling D, HC-F3-lowRunner reversed R:** conversions rejected for external penetration, the players left as falling proxies. Pinned (`DEFENDER_13F` in `tests/l3-pass.ts`, `KNOWN_13F` in `tests/handoff-contact.test.ts`) and listed in [13f](../open/13f_Conversion_Overlap_Margin.md#rejections-13d-adds-user-ruling-2026-11-09). L3-F9-defenderRising converts on loss of support at 1.54 s instead of on its bob.
- **L3-F16-stop1.9:** one sliding plant at the crossing (right foot, 0.33 m/s, fails by 1.5 cm). Allowed on that fixture in `BRAKE` and `SETTLES`; the fix goes to [13e](../open/13e_Idle_and_Walk_Coverage.md).
- **L4-F9-low R right shoulder:** 5–8° past the tolerance from 1.93 s to the fixture's end, 0.47 s (persistence limit 0.25 s), the runner alone on the ground. Bounded at 0.5 s beside plan 12's entry.
- From the plan: the jog is a shortened Fast Run with Fast Run's timing; below 1.6 m/s a run request shows the procedural gait.
- At 2.5 m/s in L3-F17-runStartFree the clip is still two-thirds walk (the blend reaches Fast Run at 4.5 m/s). The share lags a hard start: 0.48 against 0.61 at 2.5 m/s.
- Every braking stop now crosses to the procedural gait at about 1.0 m/s (the fade starts near 2.2 m/s and takes 0.2 s), where the speed-scaled braking stance is about half depth.
- The post-contact rejoin that skipped a stance on L3-F7 before the share fix (a following foot whose stance window opens in the air keeps following) is unchanged code; it no longer fires on these fixtures. No stumble (user: later).
- Plan 12's known limit "L4-F10-wrap-off rejected" no longer occurs at this tip; the plan 12 handoff is left as written, and 13f re-measures it.

### Changed summaries (98; G1–G4 byte-identical)

- **HC** (8 changed, 14 identical): HC-F3-mirror, HC-F3-phase0, HC-F3-phase50, HC-F3-phase75, HC-F3-rising, HC-F3-falling, HC-F3-lowRunner, HC-F5-strictTransfer
- **L1** (4 changed, 4 identical): L1-F3-collision, L1-F5-twoArm, L1-F6-oneArm, L1-F7-failed
- **L2** (8 changed, 29 identical): L2-F3-runStop, L2-F3-runStopHard, L2-F3-runStopReaccel, L2-F3-runStopHandoff, L2-F3-runStopKick, L2-F11-sprint, L2-F14-oneArm, L2-F14-oneArmFeet
- **L3** (58 changed, 39 identical): L3-F1-phase0, L3-F1-phase1, L3-F1-phase2, L3-F1-phase3, L3-F1-phase4, L3-F1-phase5, L3-F1-phase6, L3-F1-phase7, L3-F1-mirror0, L3-F1-mirror4, L3-F1-rising, L3-F1-falling, L3-F1-low, L3-F2-miss, L3-F2-missMirror, L3-F3-collision, L3-F4-twoArm, L3-F4-oneArm, L3-F5-drag, L3-F5-dragMirror, L3-F7-phase0, L3-F7-phase25, L3-F7-phase50, L3-F7-mirror0, L3-F7-mirror50, L3-F8-recontact, L3-F9-lift-exit, L3-F9-convert-contact, L3-F9-convert-exit, L3-F9-noProbe-prep, L3-F9-noProbe-exit, L3-F9-low, L3-F9-defenderRising, L3-F9-defenderFalling, L3-F10-defender, L3-F14-walkRunStop, L3-F14-walkRunStopCarrier, L3-F14-handoff, L3-F16-runStop, L3-F16-runStopFree, L3-F16-runStopReady, L3-F16-runStopHard, L3-F16-stop2.55, L3-F16-stop1.7, L3-F16-stop1.9, L3-F16-stop2.1, L3-F16-stop2.3, L3-F16-stop2.45, L3-F16-stop2.75, L3-F16-stop2.9, L3-F16-stop3.05, L3-F16-reaccel, L3-F16-handoff, L3-F16-kick, L3-F16-sprint, L3-F16-contactStop, L3-F17-runStart, L3-F17-runStartFree
- **L4** (10 changed, 65 identical): L4-F3-run-off, L4-F5-oneClamp-on, L4-F5-oneClamp-off, L4-F9-contact, L4-F9-exit, L4-F9-low, L4-F9-defenderRising, L4-F9-defenderFalling, L4-F10-wrap-on, L4-F10-wrap-off
- **RH** (10 changed, 26 identical): RH-F3-sprint, RH-F3-accelBrake, RH-F6-collision, RH-F6-twoArm, RH-F6-oneArm, RH-F6-failed, RH-F6-defenderRun-0, RH-F6-defenderRun-25, RH-F6-defenderRun-50, RH-F6-defenderRun-75

**Result change (1):** RH-F6-failed `practiceOutOfBounds` → `groundDown`.

**End times (32):**

| Fixture | End (s) | Change |
| --- | --- | --- |
| L1-F7-failed | 1.6333 → 1.6 | -33 ms |
| RH-F6-twoArm | 1.65 → 1.7833 | +133 ms |
| RH-F6-failed | 2.6667 → 2.35 | -317 ms |
| HC-F3-mirror | 1.6167 → 1.7333 | +117 ms |
| HC-F3-phase0 | 1.65 → 1.6333 | -17 ms |
| HC-F3-phase75 | 1.7 → 1.6667 | -33 ms |
| HC-F3-rising | 1.6333 → 1.6667 | +33 ms |
| HC-F3-falling | 1.7 → 1.6667 | -33 ms |
| HC-F3-lowRunner | 2.0833 → 1.8333 | -250 ms |
| L3-F1-phase0 | 1.7167 → 1.55 | -167 ms |
| L3-F1-phase1 | 1.75 → 1.6833 | -67 ms |
| L3-F1-phase2 | 1.5833 → 1.65 | +67 ms |
| L3-F1-phase3 | 1.7167 → 1.5833 | -133 ms |
| L3-F1-phase5 | 1.7333 → 1.75 | +17 ms |
| L3-F1-phase6 | 1.5833 → 1.6833 | +100 ms |
| L3-F1-phase7 | 1.5667 → 1.55 | -17 ms |
| L3-F1-mirror0 | 1.7167 → 1.7 | -17 ms |
| L3-F1-mirror4 | 1.7667 → 1.5833 | -183 ms |
| L3-F1-rising | 1.5833 → 1.65 | +67 ms |
| L3-F1-falling | 1.5833 → 1.65 | +67 ms |
| L3-F1-low | 1.85 → 1.9 | +50 ms |
| L3-F4-twoArm | 1.7333 → 1.75 | +17 ms |
| L3-F4-oneArm | 1.5833 → 1.65 | +67 ms |
| L3-F5-dragMirror | 2.6333 → 2.65 | +17 ms |
| L3-F9-defenderRising | 1.5833 → 1.65 | +67 ms |
| L3-F9-defenderFalling | 1.5833 → 1.65 | +67 ms |
| L3-F10-defender | 1.5833 → 1.65 | +67 ms |
| L4-F5-oneClamp-on | 1.6 → 1.65 | +50 ms |
| L4-F5-oneClamp-off | 1.5833 → 1.65 | +67 ms |
| L4-F9-defenderRising | 1.6 → 1.65 | +50 ms |
| L4-F9-defenderFalling | 1.6167 → 1.65 | +33 ms |
| L4-F10-wrap-off | 1.7333 → 1.75 | +17 ms |

**Rule endings (39):** every kind stays `groundDown`; RH-F6-failed had none and now ends `groundDown`. Ball spots:

| Fixture | Ball spot before (x, y, z m) | After |
| --- | --- | --- |
| L1-F5-twoArm | 1.78, 0.58, 1.18 | 1.72, 0.58, 1.26 |
| L1-F6-oneArm | 1.65, 0.62, 1.32 | 1.64, 0.62, 1.33 |
| L1-F7-failed | 1.96, 0.23, 1.08 | 1.78, 0.20, 1.05 |
| RH-F6-twoArm | 2.15, 0.24, 1.60 | 2.11, 0.03, 1.65 |
| RH-F6-oneArm | 2.07, 0.11, 1.38 | 2.07, 0.07, 1.54 |
| RH-F6-failed | none | 4.54, 0.01, 1.27 |
| L2-F14-oneArm | 2.07, 0.11, 1.38 | 2.07, 0.07, 1.54 |
| L2-F14-oneArmFeet | 2.06, 0.15, 1.37 | 2.05, 0.08, 1.55 |
| HC-F3-mirror | 2.87, 1.02, -0.94 | 3.25, 0.98, -1.04 |
| HC-F3-phase0 | 1.92, 0.03, 1.42 | 2.21, 0.05, 1.87 |
| HC-F3-phase50 | 2.05, 0.12, 1.40 | 1.99, 0.02, 1.64 |
| HC-F3-phase75 | 1.78, 0.10, 1.63 | 2.05, 0.10, 1.53 |
| HC-F3-rising | 1.59, 0.23, 1.43 | 1.73, 0.10, 1.60 |
| HC-F3-falling | 1.68, 0.13, 1.48 | 1.69, 0.13, 1.52 |
| HC-F3-lowRunner | 4.01, 0.03, 1.64 | 2.47, 0.06, 1.74 |
| L3-F1-phase0 | 3.02, 0.18, 1.48 | 2.38, 0.51, 1.29 |
| L3-F1-phase1 | 3.15, 0.19, 1.49 | 2.91, 0.26, 1.42 |
| L3-F1-phase2 | 2.47, 0.47, 1.35 | 2.82, 0.30, 1.37 |
| L3-F1-phase3 | 2.96, 0.25, 1.56 | 2.47, 0.49, 1.30 |
| L3-F1-phase4 | 2.98, 0.22, 1.44 | 2.97, 0.24, 1.46 |
| L3-F1-phase5 | 3.12, 0.21, 1.45 | 3.13, 0.23, 1.49 |
| L3-F1-phase6 | 2.48, 0.44, 1.34 | 2.91, 0.23, 1.43 |
| L3-F1-phase7 | 2.30, 0.46, 1.39 | 2.32, 0.48, 1.32 |
| L3-F1-mirror0 | 3.00, 0.74, -1.38 | 2.94, 0.75, -1.41 |
| L3-F1-mirror4 | 3.33, 0.42, -1.44 | 2.39, 0.92, -1.18 |
| L3-F1-rising | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L3-F1-falling | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L3-F1-low | 3.36, 0.28, 1.78 | 3.57, 0.19, 1.86 |
| L3-F4-twoArm | 2.72, 0.20, 1.54 | 2.86, 0.21, 1.46 |
| L3-F4-oneArm | 2.47, 0.47, 1.35 | 2.82, 0.30, 1.37 |
| L3-F9-defenderRising | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L3-F9-defenderFalling | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L3-F10-defender | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L4-F5-oneClamp-on | 2.56, 0.47, 1.37 | 2.84, 0.30, 1.39 |
| L4-F5-oneClamp-off | 2.45, 0.48, 1.35 | 2.82, 0.30, 1.37 |
| L4-F9-defenderRising | 2.56, 0.47, 1.37 | 2.84, 0.30, 1.39 |
| L4-F9-defenderFalling | 2.62, 0.40, 1.40 | 2.84, 0.30, 1.39 |
| L4-F10-wrap-on | 2.90, 0.12, 1.45 | 2.96, 0.17, 1.47 |
| L4-F10-wrap-off | 2.73, 0.20, 1.54 | 2.86, 0.21, 1.46 |

### Evidence

- `.scratch/p13d/final.json` (the closing run), `.scratch/p13d/fixtures2.log` (the export), `.scratch/p13d/diff.txt`, `clipw.txt` (the probes' output), the baseline export at `63323e1` in `.scratch/p13d/base/`.
- Investigation probes for the re-points in `.scratch/p13d/A/`, `.scratch/p13d/B/` (untracked).

## 13e — Idle and walk where they belong

Plan: [13e](../open/13e_Idle_and_Walk_Coverage.md). Implemented 2026-11-09 after `c5b85a1` (13d). User rulings during the work: the hold re-stepping is fixed in 13e; three small overshoots are bounded known limits; HC-F3-phase75 D's new rejection goes to 13f; HC-F2-bothFall's post-switch window ends at A's first new contact; the L3-F6 hold's prep flicker is a bounded known limit (all below).

**Result:**
- **The idle cycle plays.** A standing player plays the supplied 8.33 s idle: the free arms (blended with frame 71 by the idle weight, through `chestArm` as before), the head on the core (bounded by the cycle, 1.02°), and the weight sway. Each player's phase is `frac(t / 8.333 + frac(0.618 × index))`, the index in the fixture's player list. The idle weight is the stance fade (1 at rest, 0 from 1.5 m/s) while free, grounded and supported, 0 otherwise, moved at the contact weight rate (5/s).
- **Sway is physical.** The cycle's hip rate, times the weight and the leg scale, in the body's heading frame, is added to the drive's request only (`motor-step.ts`), while the player's own request is zero and outside a rules ending; the referee, braking and clip playback read the controller's request. The foot planner's home leaves out the integrated sway, so the feet stay where the body stood. Plant drift on L3-F13 and L3-F15 is 0.82 mm (0.77 mm without sway), no extra steps: the fallback (drop sway) is not needed.
- **Coverage.** Every model-body L3, L4 and HC fixture has the L3 foot planner, `locomotion-l3-v4` and the walk and Fast Run clips (`withLocomotion`). Exempt, by reason in the notes: the 50 authored-body fixtures (no supplied clips or idle cycle: both are calibrated to the player model) and the 12 L4 tipped falls (converted before they can stand). HC moved from the L2 planner or legacy legs to the L3 planner.
- **13d's sliding plant.** An inherited foot settles over an arrival (`C.arriveS`), not one substep; the L3-F16-stop1.9 allowances in `BRAKE` and `SETTLES` are gone.
- **Look review.** Passed (user, 2026-11-09): L3-F13-carrier, L3-F13-free, L3-F14-walkRunStopCarrier, HC-F1-mirror and HC-F3-rising at 1×.
- **Transitions.** The transition audit finds no L3 boundary over 1 cm outside the two listed known cases (one from plan 12, one new below).
- **Physics.** The plan 07a handoff audits pass on every HC fixture in both body orders; the plan 09 effort audits, plan 11 self-clearance and plan 12 joint-range rows pass on the newly covered fixtures. One new rejection (HC-F3-phase75 D, to 13f); the 13d case HC-F3-lowRunner reversed R converts again.
- **Evidence.** All 410 exported. G1–G4, L1, L2 and RH byte-identical; HC 22, L3 64 and L4 6 changed. One result change, 7 end-time changes, 8 ball-spot changes, every rule ending keeps its kind; 20 fixtures' handoffs changed.
- **Tests.** 241 in 13 files (230 before, +11), all pass, exit 0; 95.4 s wall time. Typecheck and build pass.

### What changed

- `scripts/model/idle-intake.ts`: records the cycle for all 251 frames: each arm's upper and forearm directions in the Spine2 frame, the head relative to the chest and to the representative frame, the hips' horizontal offset from the loop mean, with `periodS`, `headMaxDeg`, `hipsMaxM`. `idle-pose.record.json` regenerated; the manifest's `posePolicy` is `cycle: …` and `models/animations/README.md` says so.
- `src/sim/locomotion.ts`: `LOCOMOTION_L3_IDLE` (`locomotion-l3-v4`: `LOCOMOTION_L3` plus `idle.cycle` and `idle.sway`); `idlePhase`, `sampleIdle` (frames interpolated, directions renormalized, head slerped, the hip rate from central differences), `idleTarget`, `advanceIdle`, `idleWeight`; `LocoState.idleW`. `LOCOMOTION_L3` (`v3`) is unchanged and stays on the authored body.
- `src/sim/simulation.ts`: the idle weight at the end of each locomotion mode update; `idlePhaseOf`; the sway (`PlayerRuntime.sway`, `swayM`), unwound at 0.05 m/s when it stops. `src/sim/motor-step.ts`: the drive adds the sway.
- `src/sim/pose.ts`: the free arms' rest blends to the cycle; the head segment and head landmark take the cycle's head. `src/sim/pose-runtime.ts`: the idle sample in the pose input; the planner home leaves out `swayM`; `others` (the other players' cores) in the foot input.
- `src/sim/footwork.ts` (`footwork-l3-v4`): the settle test over an arrival; the blocked-home memory (`FootState.blockedW`, `blockerW`): a foot whose step another body held off its home takes no step or settle step toward that home while the home and the nearest other player's core stay within `settleTriggerM` (9 cm) of where they were.
- `src/sim/fixtures/with-locomotion.ts` (new): `withLocomotion`, `onModel`, `lockedOutOfLocomotion`. `asL3` (transitions.ts) and the HC `label` (handoff-contact.ts) call it; fixture notes name the set or the exemption (`falls.ts` for the tipped falls).
- `src/sim/debug.ts`: three negative-control switches, `settleOneSubstep`, `swayInHome`, `noBlockedMemory`.
- Probes (committed): `scripts/probe/p13e-idle.ts` (the palm path against the cycle, the head bound, no marching: PASS), `scripts/probe/p13e-handoffs.ts` (accepted, rejected and audit-failed handoffs of two exports compared).

### Faults found in 13e's own change, fixed, each with a check

1. **Sway in the home.** With the integrated sway in the planner home, L3-F16-stop2.9's swaying root dragged the home past the settle trigger 0.18 s before the end (a late settle step). The home leaves it out. Check: `swayInHome` puts it back and `SETTLES` fails (l3-contracts, "plan 13e faults put back").
2. **Re-stepping into a blocker** (user ruling: fix in 13e). With the clips on L3-F6, the hold defender's step toward a home inside the runner was held off by the runner's body and landed about where it started, then re-triggered every 0.3 s: 6 plants after 3.5 s on L3-F6-holdMirror (bound 1), 2 on L3-F6-hold. The blocked-home memory holds the foot. Check: `noBlockedMemory` puts it back and `HOLD_SETTLES` fails.
3. **A blocker that leaves.** The first memory, cleared only by the home moving, kept L3-F4-gripOwner's runner's left foot off its home after the defender had moved 19 cm away, and the later clearance release crossed its boundary by 1.01 cm. The memory now also clears when the nearest other core moves 9 cm. Check: the runner steps home at 1.3917 s (same test).
4. **Order dependence.** The idle phase came from the body order, so a reversed run swapped the players' phases. It now comes from the fixture index. Check: each player's phase is the same in both orders (transitions.test.ts; fails with the body order).
5. **13d's sliding plant.** Check: `settleOneSubstep` puts the one-substep settle back and L3-F1-phase4's D plants its right foot while it still moves and the plant fails at 0.4792 s (none without). L3-F16-stop1.9 no longer slides with the fault either: the clips and the other 13e changes moved its crossing.

### Tests re-pointed or changed

| Check | Was | Now | Why |
| --- | --- | --- | --- |
| Out-of-time reproduction (l3-contracts) | L3-F3-side | L3-F3-recover (R left near 0.838 s, 1.47 m/s, still moving 1.16 m/s) | L3-F3-side's moving out-of-time steps are gone on the clips |
| Post-switch first solve (handoff-contact) | HC-F4-clear-falling | HC-F3-rising (D, 2.83 body weights) | HC-F4-clear-falling's falling feet leave the turf on the L3 planner: no impulse in its first solve |
| HC-F2-bothFall post-switch window (user ruling) | 24 substeps | 18, pinned | A's right upper arm, falling at 5.1 m/s, meets B's head at +18 (closing 2.7 m/s along the normal); the next solve takes the impact: elbow 8.7 mm, 26.9 body weights. Through +18: 0.47 mm, 3.5 body weights. The pin fails if the first new contact moves |
| Ragdoll shoulders (body-limits) | HC-F3-falling | HC-F3-phase50 (twin 82.4°, profile 50.4°) | HC-F3-falling's twin is 28.3° behind on the L3 planner |
| Ankle held cases (body-limits) | HC-F1-low D.right, R.left | HC-F1-low R.left | D's right shoe relaxes within 1° like the others |
| Planner and locomotion ids (harness) | L3 only, `v3` | L3 and HC; `footwork-l3-v4`, `locomotion-l3-v4` on the model, `locomotion-l3-v3` on the authored body | the new coverage and ids |
| Idle record (transitions) | `posePolicy` `static…` | `cycle…` | the cycle plays |
| Stance width with the idle (transitions) | the plain profile | the profile without sway | the width is measured at rest |
| `KNOWN_13F` (handoff-contact) | HC-F3-lowRunner reversed R | HC-F3-phase75 D | below |

New: the cycle record's structure; phase and sampling (the hip rate integrates to the hip path within 1 mm); the weight's unit rows; the two-player palm path (L3-F13-free-pair, 9 s: palms follow the cycle within 2 cm, repeat within 1 mm, move over 5 mm, the two players differ by over 5 mm); the coverage census; the phase in both orders; the L3 rows `IDLE_WEIGHT` and `IDLE_PLANTS`; the three faults put back; the HC-F2-bothFall window pin.

### Known limits (user rulings)

- **L3-F6-saturated:** the runner's root peaks at 0.9122 m (limit 0.91). Bounded at 0.913 m in `NO_LAUNCH`.
- **L3-F14-lateral:** one plant fails on the slide (R left, 1.1417 s, 3.36 cm). Pinned in `WALK_VALID` (that plant only, under 3.5 cm).
- **L3-F3-recover:** R's right knee crosses its step-to-step boundary at 0.725 s by 1.144 cm. Bounded at 1.15 cm in `KNOWN_AUDIT`.
- **HC-F3-phase75 D:** its conversion is rejected for external penetration (left thigh 2.01 cm in R's right shoe at 1.392 s); it ends a falling proxy. Pinned (`KNOWN_13F` and the family row) and listed in [13f](../open/13f_Conversion_Overlap_Margin.md).
- **L3-F6-hold and L3-F6-holdMirror:** on the walk clips D's run-in reaches 1.513 m/s (1.46 without clips), over the 1.5 m/s prep threshold, so both players enter prep at 0.308 s; the arrival brake takes the closing speed back under it, prep unwinds at 0.567 s and the wrap is retained at 0.604 s. Pinned in `HOLD_SETTLES`: prep, free, contact, the free gap under 50 ms.
- The blocked-home memory knows only where the other players' cores are: a blocker that moves less than 9 cm keeps the foot off its home.
- From the plan: backward and side walks stay procedural (the supplied walk is a forward cycle).

### Changed summaries (92; G1–G4, L1, L2 and RH byte-identical)

- **HC** (22 changed, 0 identical): every HC fixture.
- **L3** (64 changed, 33 identical): L3-F1-phase4, L3-F3-side, L3-F3-sideMirror, L3-F3-recover, L3-F3-collision, L3-F5-drag, L3-F5-dragMirror, L3-F6-hold, L3-F6-holdMirror, L3-F6-saturated, L3-F7-phase0, L3-F7-phase50, L3-F7-loadRelease, L3-F8-recontact, L3-F9-lift-free, L3-F9-lift-contact, L3-F9-lift-exit, L3-F9-convert-contact, L3-F9-convert-exit, L3-F9-noProbe-exit, L3-F9-low, L3-F9-playerBelow, L3-F10-both, L3-F10-bothMirror, L3-F10-bothLow, L3-F10-rising, L3-F10-falling, L3-F11-invalid, L3-F13-carrier, L3-F13-free, L3-F13-ready, L3-F13-settle2.1, L3-F13-settle2.3, L3-F13-settle2.5, L3-F13-settle2.7, L3-F14-forward, L3-F14-backward, L3-F14-lateral, L3-F14-carrier, L3-F14-ready, L3-F14-walkRunStop, L3-F14-walkRunStopCarrier, L3-F14-handoff, L3-F15-fitted, L3-F15-handoff, L3-F16-runStop, L3-F16-runStopFree, L3-F16-runStopReady, L3-F16-runStopHard, L3-F16-stop2.55, L3-F16-stop1.7, L3-F16-stop1.9, L3-F16-stop2.1, L3-F16-stop2.3, L3-F16-stop2.45, L3-F16-stop2.75, L3-F16-stop2.9, L3-F16-stop3.05, L3-F16-reaccel, L3-F16-handoff, L3-F16-kick, L3-F16-contactStop, L3-F17-runStart, L3-F17-runStartFree
- **L4** (6 changed, 69 identical): L4-F5-twoClamp-on, L4-F5-twoClamp-off, L4-F9-contact, L4-F9-exit, L4-F9-low, L4-F9-both

**Result change (1):** L3-F3-sideMirror `duration` → `practiceOutOfBounds`, on the last tick (1.75 s, the fixture's duration).

**End times (7):**

| Fixture | End (s) | Change |
| --- | --- | --- |
| HC-F3-mirror | 1.7333 → 1.6667 | -67 ms |
| HC-F3-phase0 | 1.6333 → 1.55 | -83 ms |
| HC-F3-phase50 | 1.6667 → 1.6833 | +17 ms |
| HC-F3-rising | 1.6667 → 1.6333 | -33 ms |
| HC-F3-falling | 1.6667 → 1.6333 | -33 ms |
| HC-F3-lowRunner | 1.8333 → 1.9167 | +83 ms |
| L3-F3-side | 1.7333 → 1.75 | +17 ms |

**Rule endings (8):** every kind stays `groundDown`. Ball spots:

| Fixture | Ball spot before (x, y, z m) | After |
| --- | --- | --- |
| HC-F3-mirror | 3.25, 0.98, -1.04 | 2.84, 0.57, -1.31 |
| HC-F3-phase0 | 2.21, 0.05, 1.87 | 2.27, 0.55, 1.21 |
| HC-F3-phase50 | 1.99, 0.02, 1.64 | 2.81, 0.31, 1.36 |
| HC-F3-phase75 | 2.05, 0.10, 1.53 | 2.74, 0.34, 1.33 |
| HC-F3-rising | 1.73, 0.11, 1.60 | 2.66, 0.36, 1.29 |
| HC-F3-falling | 1.69, 0.13, 1.52 | 2.66, 0.36, 1.29 |
| HC-F3-lowRunner | 2.47, 0.06, 1.74 | 3.63, 0.05, 1.85 |
| L3-F1-phase4 | 2.9681, 0.2357, 1.4642 | 2.9680, 0.2357, 1.4642 |

**Handoffs (20 fixtures changed; `p13e-handoffs.ts`):**

| Fixture | Before (accepted; rejected) | After |
| --- | --- | --- |
| HC-F2-bothFall | B 0.487, A 0.667 | B 0.450, A 0.667 |
| HC-F2-bothFallL2 | B 0.637, A 0.646 | B 0.637, A 0.654 |
| HC-F2-lift1.4 | A 1.579, B 1.629 | B 1.492 (A stays supported) |
| HC-F2-lift3.0 | A 1.413 | A 1.354 |
| HC-F2-lowCarrier | none | A 0.692 |
| HC-F3-falling | D 0.713, R 0.850 | R 0.804, D 1.171 |
| HC-F3-lowRunner | R 0.996, D 1.517 | R 1.050 (D stays supported) |
| HC-F3-mirror | R 0.929, D 1.438 | R 0.846 (D stays supported) |
| HC-F3-phase0 | R 0.767 | R 0.775 |
| HC-F3-phase50 | R 0.833, D 1.475 | R 0.838, D 1.467 |
| HC-F3-phase75 | R 0.875, D 1.446 | R 0.825; D rejected 1.392 (externalPenetration, 2.01 cm) |
| HC-F3-rising | D 0.700, R 0.846 | R 0.804, D 1.204 |
| HC-F5-invalidOne | R 1.200; D rejected 1.200 (jointAnchor, landmarkDiscontinuity) | the same, D's worst penetration 0.32 → 0.11 cm |
| HC-F5-strictTransfer | R 0.842, D 1.296 (both energyGain audit failures, by design) | R 0.804, D 1.308 (the same) |
| L3-F10-rising | D 0.842, R 1.200 | D 0.821, R 1.200 |
| L3-F11-invalid | R 1.200; D rejected 1.200 (jointAnchor, landmarkDiscontinuity) | the same, D's worst penetration 0.52 → 0.11 cm |
| L3-F3-collision | R 0.813, D 0.883 | R 0.779, D 0.858 |
| L3-F3-recover | R 1.146 | R 1.129 |
| L3-F3-side | R 0.896 | R 0.821 |
| L3-F3-sideMirror | R 0.871 | R 0.771 |

### Departures from the plan

- `withLocomotion` lives in `src/sim/fixtures/with-locomotion.ts`, not transitions.ts: transitions imports handoff-contact, so the HC `label` could not import it from there.
- The plan's `withLocomotion` sets `LOCOMOTION_L3`; the idle cycle needs a new profile id (a behaviour change on a historical path), so it sets `LOCOMOTION_L3_IDLE` (`locomotion-l3-v4`), and the authored-body L3 fixtures keep `LOCOMOTION_L3` (`v3`) without clips.
- The sway goes to the drive's request only, not the locomotion request every reader sees, and the planner home leaves out its integral (fault 1).
- The blocked-home memory and the `others` input are not in the plan: they are the fix the user ruled for the hold re-stepping the new clips exposed.

### Evidence

- `.scratch/p13e/suite6.log` (the closing run), `.scratch/p13e/fixtures.log` (the export), `.scratch/p13e/sumdiff.txt` and `handoffs.txt` (the comparisons), the baseline export at `c5b85a1` in `.scratch/p13e/base/`.
- Investigation probes in `.scratch/p13e/` (untracked).
