# 10f — Cleanup and module structure

Repository-aligned plan • 2026-11-08 • Not started. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first. Runs last, so the splits move settled code.

**Goal:** remove what no longer earns its keep and split the two largest modules along their existing seams, with no behaviour change. **Every summary, trace and export must be byte-identical** before and after each item, apart from export fields an item names. Audit-on and audit-off identity must hold.

## F1. Probe scripts (Polish; decision U10)

`scripts/probe` holds 200 scripts: 137 tracked and 63 new and untracked (`p08-*`, `p08a-*`, `p09-*`). 122 are not referenced by any doc, 50 of them among the new probes. `tsconfig.json` includes `scripts`, so all 200 are typechecked and every API change has to keep them compiling.

Either delete the unreferenced probes or move them to an archive directory excluded from `tsconfig`. Keep every probe a handoff cites compiling. Update doc links if paths move.

## F2. Debug switches as shared module state (Change)

`FOOT_DEBUG` (`src/sim/footwork.ts:1668`: `noReachCheck`, `legacyEntry`, `noQuick`, `noJoinCheck`) and `POSE_DEBUG` (`src/sim/pose.ts:577`: `on`, `trace`, `noContinuity`, accumulators) change simulation behaviour, are shared by every simulation in a process, and are not recorded in exports. Tests restore them in `finally`.

Pass them as `SimOptions` per simulation, and record any non-default switch in the export. Test and probe usage moves to options.

## F3. Duplicate helpers (Polish, Reported)

Move these into `src/sim/vec.ts` or reuse existing exports:

- `src/sim/ragdoll.ts`: `wrapPi`, `poseOfRb`, `composePose`, `I3` (134; vec has `qIdentity`), and the inline 3×3 determinant (826; vec has `m3Det`).
- `src/sim/arms.ts`: `slerp` (233), `quatAngle`, `poseOfRb`, `composePose`, `relPose`, `moveToward`, and `landmarkOf`, which duplicates `ragdoll.landmarkWorld`.
- `src/sim/fall-response.ts`: `smooth`, `rotateToward` (after [10c C5](10c_Active_Fall_Contract_Repairs.md#c5-rotatetoward-skips-its-rate-limit-for-opposite-vectors-p3-checked)).
- `src/sim/footwork.ts:1165`: `scale3`, which duplicates `scale`.
- `src/sim/controllers/coached.ts:52`: `smooth`.
- Tests: `breathe`, `FIX`, `runEach` and `evs` into `tests/helpers.ts`.

## F4. Dead code (Polish, Reported)

Confirm each with a search before removing:

- `src/sim/vec.ts`: `rightOf`, `m3Identity`, `m3Scale`.
- `src/sim/physics.ts:394`: `vScaleAdd`.
- `src/sim/simulation.ts:319-323`: `DiagnosticConversion`.
- `src/sim/rules.ts:19`: `EXCLUDED_GROUND_REGIONS`, unless [10e E4](10e_Rules_and_Referee_Correctness.md#e4-ground-touch-matches-the-floor-key-only-p3-reported) wires it in.
- `src/sim/fall-response.ts:28` and `:454`: `floorTarget`.
- `src/sim/ragdoll.ts:458` and `:463`: `twistReach`.
- `src/sim/arms.ts:793` and `:825`: `tgt` / `void tgt`.
- Profile fields declared and never read: `RagdollProfile.endBandM` (`src/sim/profiles.ts:613`, `:782`), `SolverProfile.sleeping`, `ProfileIds` (469–479). Wire or delete.
- `src/sim/controllers/wrap.ts`: `stripUndef` leaves `stance` in `this.p`.

## F5. Magic numbers (Polish, Reported)

These move into profiles or named, commented constants, with values unchanged:

- In `src/sim/fall-response.ts`:
  - the brace pole `v3(sideSign × 0.6, 0, −1)`;
  - the 1e-3 reach margin;
  - the 14 bisection iterations;
  - the mL²/3 rod inertia in the power prediction (the 5% audit holds, so document it as an approximation).
- `CLIP_WEIGHT_RADPS = 24` (`src/sim/simulation.ts:363`), as a profile field beside `braceRadPerS`.

New profile fields change exports; the values must not change.

## F6. Per-substep lookups (Polish, Reported)

`rag.joints.find(...)` runs per envelope entry per substep (`src/sim/ragdoll.ts:576`, `:614`). Store the joint index in each entry at `initEnvelope`.

## F7. Documentation (Polish, Checked)

- **`docs/README.md`:** the "Next" paragraph says "all 600 tests" and "Plan 09 follows once 08 is accepted", contradicting the paragraph above it (675 tests, 09 implemented). Rewrite it to the current state.
- **The plan 08 doc's 2026-11-05 implementation-status block:** 274 of 1807 contact boundaries over 1 cm is history. Label it as such or remove it.
- **Comments in `src/sim/profiles.ts`:**
  - the `ballSource` doc (803–807) omits `carryPose`;
  - `AUTHORED_BALL_LOCAL` in the model profiles duplicates `RULES_FOOTBALL.ballLocal`, so import one from the other.
- **Misplaced docstrings in `src/sim/simulation.ts`:**
  - 114–115 and 357–361 sit above unrelated code;
  - `followClipWeight` (363–382) sits between `checkLimbContract`'s docstring and its function;
  - 1205–1211 is misplaced;
  - 1948–1958 stacks two docstrings.
- **`src/sim/footwork.ts`:** the `FOOT_DEBUG` doc (1663–1667) omits `noJoinCheck`.
- **`src/sim/locomotion.ts:57-58`:** `braceRadPerS` is mis-indented inside `contact`.
- **`src/sim/physics.ts:270-319`:** state that `collectContacts` keeps only the best manifold per pair.

## F8. Configuration hygiene (Polish, Checked)

- `vite.config.ts` casts its config `as any`. Use `defineConfig` from `vitest/config`.
- Add `.claude/` to `.gitignore`.

## F9. Split `simulation.ts` (Change)

`src/sim/simulation.ts` is about 2450 lines. Each seam already has its own cluster of fields:

- trace and export (`recordTrace` 2211–2332, `exportFixture` 2334–2410);
- the transition audit (`auditInput`, `keepLandmarks`, `recordTransition`, and the audit copy inside `advanceLocomotion` at 1280–1290);
- contact observation (`postStep` 1425–1533, `tickContactClasses`);
- conversions (`convertBatch` 1610–1713);
- rules wiring (`observeRules` 1311–1356);
- pose runtime (`updatePoses`);
- suspension support runtime;
- motor step.

Move each into a module behind a narrow host interface, as `ArmSystem` does with its host. `stepSubstep` remains the orchestrator and lists the pipeline order explicitly. Start with trace/export and the transition audit: they only read state, so they are the lowest risk.

**Acceptance:** byte-identical summaries, traces and exports for all fixtures after each move.

## F10. Split `footwork.ts` (Change)

`src/sim/footwork.ts` is about 1670 lines. Separate the composed step, follow, chase and sole paths from the legacy planner. Hold horizontal and vertical step state in separate structures, if [10b B2](10b_Foot_Target_Continuity.md#b2-composed-steps-keep-a-stale-vertical-velocity-p2-checked) has not already done so.

## F11. Assets (Change, optional; decision U11)

- `models/animations/idle.json` is 592 KB (251 frames) and is kept for provenance; the simulator uses one frame through `idle-pose.record.json`.
- FBX, GLB and Blender sources are committed directly.

Consider Git LFS if model and animation sources keep growing; no change is needed otherwise.
