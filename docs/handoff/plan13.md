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
