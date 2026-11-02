# Gate 1 handoff — bounded movement and mutual impact

Date: 2026-11-02. Status: G1-A..D implemented; numerical checks pass. Visual review partly done (stills only); see R6.

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | no errors |
| Tests (headless fixtures) | `npx vitest run` | 17 passed, 0 failed |
| Evidence export | `npm run fixtures` | 45 fixtures, all `duration` (no numerical stop, no out-of-bounds); `evidence/traces/<id>.json`, `evidence/summary.json` |
| Production build | `npm run build` | ok (one chunk-size warning: Rapier WASM is inlined) |
| Lab | `npm run dev` then http://127.0.0.1:5197/ | renders; URL `?fixture=<id>&t=<s>&cam=side|oblique|overhead` runs to `t` and pauses |

Versions: three 0.170.0, @dimforge/rapier3d-compat 0.21.0, vite 6.4.5, vitest 3.2.7, vite-node 3.2.4, typescript 5.9.3, Node 26.9.0. Schema `tackling-v1.1`.

## Files

- `src/sim/vec.ts` — vector/quaternion/matrix helpers.
- `src/sim/contracts.ts` — IDs, tags, intents, snapshots, contacts, events.
- `src/sim/profiles.ts` — body (legacyCapsule, upperBodyCompound), motor, solver (`solver-g1-1x60`), stance (`stance-g1-pitchRollLocked`) profiles.
- `src/sim/physics.ts` — the only Rapier owner: proxies, tags, contact collection, support test, closest points.
- `src/sim/motors.ts` — bounded drive `F = m(vdes−v)/τ` capped at 1400 N·effort, zero when unsupported; yaw PD capped at 180 N·m.
- `src/sim/contact.ts` — geometric region classification (head > selected shoulder > other shoulder > torso > pelvis > support).
- `src/sim/simulation.ts` — fixed tick, stage order, events, episodes, stop reasons, trace, fixture export.
- `src/sim/driver.ts` — wall-time to whole fixed ticks; slow motion changes consumption only.
- `src/sim/controllers/{base,coached,index}.ts` — scripted requests; coached entry (track/gather/connect/drive/recover).
- `src/sim/fixtures/gate1.ts` — F1–F10 definitions.
- `src/sim/pose.ts` — sim-owned physical pose (landmarks, two-bone limbs). Legs and Gate 1 arms are visual only.
- `src/lab/{main,views}.ts`, `index.html` — TackleLab.
- `tests/gate1.test.ts`, `tests/helpers.ts`; `scripts/run-fixtures.ts`; `scripts/probe/*` (diagnostics).

There was no earlier blocking/playground code in this repository; nothing to preserve.

## Rubric

| ID | Grade | Evidence |
| --- | --- | --- |
| G1-R1 Bounded execution | 2 | F1: drive ≤ cap, max accel ≤ cap/m, t95 > 0.25 s, braking > 0.25 s. F6 airborne (both profiles): no drive while unsupported, gravity acts, no air steering, drive resumes on landing. |
| G1-R2 Mutual collision | 2 (numeric) / U (motion) | F2: no pass-through (min gap > −0.03 m), pair momentum change < 0.05, both react versus the no-contact control, reversed creation order within 0.001 m. F3: deflection; compound proxy gets contact yaw (ω > 0.05) with zero yaw motor torque. Stills of F6 impact inspected (no overlap at first touch). Slow-motion playback of F2/F3 not inspected. |
| G1-R3 Independent intent | 2 | F4: both request traces persist after contact for ≥ 2 s; velocity never assigned (source: only `addForce`/`addTorque`); contact module has no force APIs (test greps source). |
| G1-R4 Physical configuration | 2 | F5: masses read back from engine (120/85 kg); drift toward lighter body; swapped masses differ. Collider and solver profiles exported. |
| G1-R5 Reproducibility | 2 | F7: 30 vs 120 FPS driving identical; two resets within tolerance; cosmetic palette change exact; 0.25× gives 60 ticks over 240 frames; stalls discard and report wall time. Exported fixture JSON in `evidence/traces/`. |
| G1-R6 Readable presentation | U | Inspected: stills in side/oblique/overhead; collider wireframes match torso/pelvis/head meshes (F9-poor, F6 impact). Not inspected: normal-speed playback, slow-motion playback. |
| G1-R7 Integration | 2 | tsc, 17 tests, fixture export, production build all ran (results above). No prior scenarios existed. |
| G1-R8 Football entry and connection | 2 (mechanism), see measured result | All 20 F8 cases, F9 ×3, F10 ×7 make contact; classification is geometric; F9-poor produces head contact + `techniqueFailure` and is not erased. One miss inspected in lab (F8-side-insideOut: other shoulder lands first, selected patch on far side). |

No hard failure observed: no nonfinite state, no tunneling (8 m/s, min gap ≥ −0.007 m over all fixtures), no velocity/pose overwrite after reset, single collision response (Rapier only), no predetermined winner.

## Measured coached-entry result (not a gate, reported for the user)

Selected shoulder in the defender's first contact tick: 8 of 20 F8 cases; within 0.2 s: 14 of 20. Others land `shoulder:other` or `torso` first (side and oblique approaches especially), and the turn cases never reach the selected shoulder within 0.2 s. Mirror pairs match before contact (< 0.002 m) and diverge after (up to 0.19 m) because Rapier's manifold order is not mirror-symmetric.

Likely cause (hypothesis): the defender squares to the frozen approach axis in gather, so both shoulders are equally forward; with lateral runner motion the trailing shoulder meets the runner first. Not changed — the spec does not set a hit rate.

## Limitations

- Pitch/roll locked; feet visual only; traction is the bounded motor (supported support shape has zero friction).
- Legacy round capsules cannot produce contact yaw (frictionless support, round shape).
- F5 outcome depends on motor stiffness m/τ; it is a configuration consequence, not a calibrated athlete result.
- Head-first contact needs the diagnostic forward-head profile at this gate (upright torso shields the head).
- Arms in Gate 1 are visual and have no colliders; they can visually pass through the opponent.

## Reproduce the least attractive case

`http://127.0.0.1:5197/?fixture=G1-F8-oblique-insideOut-turn&t=1.38&cam=oblique` — runner turns at 0.9 s; defender's first contact is support/torso on the runner's shoulder, selected shoulder never lands within 0.2 s. Headless: `npx vite-node scripts/probe/dbg.ts G1-F8-oblique-insideOut-turn 3`.
