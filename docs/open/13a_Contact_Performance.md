# 13a — Contact performance

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). First milestone: behaviour-neutral, so every later milestone exports, tests and reviews faster.

**Goal:** a collision plays smoothly in the lab, and the simulation is faster in contact, with no change to what it does. Every export, trace, event log and summary stays byte-identical.

## Why

The user sees stutter when players collide, for example in L4-F10-wrap-on.

**The lab driver.** The lab steps the simulation on the render thread: each display frame runs the whole 1/60 s ticks it owes, at most 4 (`FixedStepDriver`, `maxTicksPerFrame`), and drops wall time past that. A tick that costs more than a frame makes that frame late, so the next frame owes two or three ticks and is later still. Uneven frames are the stutter; the dropped time shows as `dropped … s` in the info panel.

**Measured** (Apple M2, Node 26, headless `Simulation.stepTick` at `588d63b`; probe `.scratch/p13/ticktime.ts`, untracked):

| Fixture | Ticks | Mean (ms) | p95 (ms) | Max (ms) | Ticks over 16.7 ms |
| --- | --- | --- | --- | --- | --- |
| L4-F10-wrap-on | 105 | 10.8 | 29.4 | 36.2 | 22, all between 0.48 and 1.25 s (contact) |
| L3-F8-recontact | 144 | 24.3 | 67.4 | 98.2 | 69 |
| L3-F5-dragMirror | 158 | 23.0 | 33.9 | 41.7 | 131 |
| L3-F5-drag | 160 | 16.6 | 26.7 | 36.1 | 66 |
| L3-F16-runStop (no contact) | 330 | 0.6 | 1.0 | 12.1 | 0 |
| L3-F13-free (standing) | 180 | 0.4 | 0.5 | 0.9 | 0 |

Over all 410 fixtures, 86 have at least one tick over 16.7 ms and 57 have a p95 over it:

| Milestone | Fixtures | With a tick over 16.7 ms | p95 over 16.7 ms | Worst tick (ms) |
| --- | --- | --- | --- | --- |
| L3 | 97 | 55 | 43 | 98.2 |
| L4 | 75 | 15 | 10 | 39.3 |
| HC | 22 | 9 | 3 | 157.4 (one GC pause) |
| RH | 36 | 4 | 1 | 25.1 |
| L2 | 37 | 2 | 0 | 24.5 |
| G4 | 41 | 1 | 0 | 17.3 |
| G1–G3, L1 | 102 | 0 | 0 | 13.9 |

**Where the time goes** (V8 CPU profiles of L4-F10-wrap-on, and of L3-F8-recontact with L3-F5-drag):
- Rapier `Shape.contactShape` takes 67–70% of all simulation time. The physics step itself takes about 4%.
- Of the `contactShape` time, 51–74% is the procedural pose's clearance check against other bodies (`poseClearanceOf` → `depth` → `external`, pose-runtime.ts), called from the limb candidate search in `buildProxyPose` (pose.ts: `pick`, `continuityAlpha`, the push-out loops). The rest is `soft`, `self`, `push`, the arm task's `segmentHit` and the fall response's `closingSpeeds`.
- About 30% of all time is spent only moving shapes between JavaScript and WebAssembly: `intoRaw`, `free`, `__wrap` and `__destroy_into_raw`. `poseShapeToRapier` makes a new `Capsule`, `Ball` or `Cuboid` for every shape on every call, and `Shape.contactShape` converts both shapes into WebAssembly and frees them again on every call.

**Query counts** (probes `.scratch/p13/qcount.ts` and `dup.ts`, wrapping `contactShape`):

| Fixture | Mean per tick | Worst tick | Returning a contact within 2 cm | Exact repeats within a tick |
| --- | --- | --- | --- | --- |
| L3-F8-recontact | 21,033 | 83,682 (0.867 s) | 2.0% | 10.9% |
| L3-F5-drag | 11,444 | 27,080 | 6.6% | — |
| L3-F5-dragMirror | 14,102 | — | 8.2% | 6.9% |
| L4-F10-wrap-on | 7,039 | 27,824 (0.683 s) | 4.8% | 6.8% |
| L3-F13-free | 32 | 32 | 25% | — |

**Causes:**
1. **No broad phase.** Every candidate limb shape is tested against every collider of every other player, every published limb and every obstacle, however far apart they are. 92–98% of the pairs are farther apart than the 2 cm prediction distance, so the query returns nothing.
2. **Shapes are rebuilt per query.** See the 30% above.
3. **The candidate search is large.** Arm and leg variants, the continuity bisection and the push-out loops measure many distinct candidate poses. Only 5–11% of queries in a tick repeat one exactly, so caching results would gain little.

Plan 11's trunk check already avoids causes 1 and 2: `trunkContact` (physics.ts) tests a bounding sphere first and queries a persistent collider in a private, never-stepped query world.

**A cull prototype** (session scratch, reverted): bounding-sphere culling added to `depth` and `push` alone, measured on seven of the worst fixtures. Their traces, events and summaries hashed identical to the baseline.

| Fixture | Mean (ms) | p95 (ms) | Max (ms) | Ticks over 16.7 ms |
| --- | --- | --- | --- | --- |
| L3-F8-recontact | 24.3 → 6.1 | 67.4 → 19.9 | 98.2 → 27.5 | 69 → 9 |
| L3-F5-dragMirror | 23.0 → 13.2 | 33.9 → 19.2 | 41.7 → 20.6 | 131 → 28 |
| L4-F10-wrap-on | 10.8 → 7.0 | 29.4 → 14.9 | 36.2 → 25.0 | 22 → 4 |
| L3-F5-drag | 16.6 → 8.9 | 26.7 → 13.9 | 36.1 → 16.8 | 66 → 1 |

After the cull, `contactShape` is still about half the time, now mostly the narrow phase itself (WebAssembly) on pairs that really are close. So exact speedups make contact two to four times faster, but they cannot promise that every contact tick fits in a frame. **The lab must stop making a frame wait for a slow tick.** That is part 2.

## Design

### Part 1: a faster simulation, exactly

Each change skips work whose answer is already known; none approximates it.

**1. Bounding-sphere cull.**
- `ExternalShape` (ragdoll.ts) gains an optional `bound: { c: Vec3; r: number }`, the world bounding sphere of the shape at its pose. `externalFromColliders`, `externalFromRagdoll`, `publishedLimbs`, the soft arm capsules and the own torso and pelvis set it for a ball (radius), capsule (half height + radius) or cuboid (half-extent length). Any other shape leaves it unset and is always queried.
- `depth`, `push`, the arm task's `query` and the fall response's `closingSpeeds` compute each pose shape's bound once (`poseShapeBound`, already in pose-runtime.ts), skip a pair whose centres are farther apart than `r1 + r2 + prediction`, and build the limb's Rapier shape only for a pair that survives.
- Why it is exact: `contactShape` returns null beyond `prediction`. `depth` starts at 0 and only takes positive penetration, and `push` only takes negative distances, so a pair that returns null changes nothing.

**2. Tighter cull for round pairs.** For a capsule or ball against a capsule or ball, the exact separation test is segment-to-segment (or point-to-segment) distance against the radii plus `prediction`, a few lines of JavaScript. It replaces the sphere test for those pairs, with a 1e-6 m guard so floating-point rounding can never skip a pair the query would return.

**3. Query from the collider side.** For an external that is a live collider, keep the collider on `ExternalShape` and call `collider.contactShape(shape, pos, rot, prediction)`, as `trunkContact` does: only the limb shape is converted. The collider is at the captured pose; no physics step runs between the clearance build and its queries. If any of the 410 exports differs by a byte with this step, revert it and keep steps 1 and 2.

### Part 2: the lab plays ahead of the simulation

**Look-ahead playback** (src/lab only; the simulation is untouched):
- The lab keeps a buffer of render snapshots, one per tick: each player's core pose, captured `PhysicalPose` (`capturePose`), representation and active collider poses; the contact and foot-anchor markers; the arm, balance and rule overlay inputs; and the info panel's per-tick values. The lab draws only from snapshots, never from the live simulation.
- Each display frame, the lab steps the simulation ahead into the buffer for up to 8 ms of wall time (one tick at least while the buffer is empty), then draws the snapshot pair at the playback time, interpolated as now.
- Free running costs about 0.5 ms a tick, so the buffer runs seconds ahead of playback before most contacts start; the contact's slow ticks are computed in the background of smooth frames. If playback catches up with the buffer, it holds the last snapshot and the panel shows `computing`, rather than skipping a frame.
- Pause, step, speed and `?t=` read the buffer: step shows the next snapshot (computing it if needed), and `?t=` computes up to that time on load, as now. A slider bar scrubs over the computed range. Reset and the tune sliders rebuild the simulation and the buffer.
- The driver keeps its fixed tick; `maxTicksPerFrame` and the dropped-time report go, since playback never drops time.

## Tasks

- [ ] **Baseline.** Commit the probes as `scripts/probe/p13-ticktime.ts` and `scripts/probe/p13-qcount.ts`. Regenerate all exports at the starting commit into a temporary directory for the byte comparison.
- [ ] **Regression test first.** In `tests/harness.test.ts`: over L4-F10-wrap-on and L3-F8-recontact, the shape queries in every tick (counted through a wrapped `contactShape`, as the probe does) stay under 4,000. It fails at the baseline (27,824 and 83,682).
- [ ] **Part 1, step 1.** Add `bound` to `ExternalShape` and its builders; cull in `depth`, `push`, `query` and `closingSpeeds`. The test passes. Byte comparison of all 410 exports.
- [ ] **Step 2.** Segment-distance cull for round pairs, with a unit test against `contactShape` on 10,000 random capsule and ball pairs near the boundary: never a pair culled that the query returns. Byte comparison.
- [ ] **Step 3.** Collider-side queries. Byte comparison; revert if any byte differs, and say so in the handoff.
- [ ] **Re-measure** with the tick probe over all 410 fixtures; record the table.
- [ ] **Part 2, test first.** A lab test (as `tests/lab-render.test.ts` does for the follow camera): driven by a fake clock, a fixture whose ticks are made slow (a stub `stepTick` that burns 30 ms) draws a frame every 16.7 ms of fake time with at most 8 ms of stepping in it, and the drawn ticks advance without a skip.
- [ ] **Snapshots and buffer.** Write `src/lab/playback.ts` (the buffer, the per-frame budget, the scrub range); move everything the frame loop reads from the live simulation into the snapshot.
- [ ] **Controls.** Run, pause, step, speed, `?t=`, reset, the tune sliders and the scrub bar on the buffer.
- [ ] **Browser check.** At 1×, L4-F10-wrap-on, L3-F8-recontact and L3-F5-drag play to their ends; record a Chrome performance trace of each contact window and report the frame-time p95. No console errors.
- [ ] **Close.** Full suite, typecheck, build, all fixtures exported and compared. Handoff section in `docs/handoff/plan13.md`.

## Acceptance

- **Identity.** All 410 exports and summaries byte-identical to the commit before 13a.
- **Headless speed.** On every fixture, the mean tick is under 8 ms and the p95 under 20 ms, with the worst ticks listed; the four fixtures in the prototype table are at least as fast as the prototype.
- **Query count.** The regression test passes.
- **Lab.** On the three fixtures at 1×, the frame-time p95 is 20 ms or less through contact, and no frame spends more than 8 ms stepping. Any `computing` hold is reported with its length.

## Known limits

- The headless targets are for the M2 used for the baseline. On a slower machine the lab still plays smoothly; it may hold for `computing` before a heavy contact.
- The fixture registry still takes about 0.3 s to build when the lab loads (`allFixtures`, mostly `upperBodyCompound` and `structuredClone`). That is a one-time cost, not stutter, and is out of scope.
