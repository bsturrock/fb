# Gate 4 handoff: ragdoll handoff, retained wraps, drill completion

Date: 2026-11-02. Status: G4-A to G4-D are implemented.

- 48 Gate 4 tests pass, together with 17 Gate 1, 12 Gate 2 and 16 Gate 3 tests (93 in total).
- Visual review (F9) used:
  - stepped stills across the handoff;
  - 0.25× slow-motion samples;
  - stills sampled during 1× playback.
- Continuous normal-speed motion was not watched (R8, U).
- Every quantitative number below was measured after the self-collision fix (Limitations 1).

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit -p .` | no errors |
| Tests | `npx vitest run` | 93 passed (17 G1 + 12 G2 + 16 G3 + 48 G4), 0 failed |
| Evidence export | `npm run fixtures` | 120 fixtures (31 Gate 4) written to `evidence/traces/<id>.json` and `evidence/summary.json` |
| Production build | `npm run build` | ok (chunk-size warning only: the Rapier WASM is inlined) |
| Ragdoll integrity per fixture | `npx vite-node scripts/probe/g4stats.ts` | table below |
| Solver comparison (1×, 2×, 4× substeps) | `npx vite-node scripts/probe/g4solver.ts` | table below |
| Blueprint read back from the engine | `npx vite-node scripts/probe/g4blueprint.ts` | masses, joints, limits |
| Grip/clamp evidence for F4/F10 | `npx vite-node scripts/probe/g4grips.ts` | per-arm events |
| F5 numbers | `npx vite-node scripts/probe/g4f5num.ts` | impulse, overlap, divergence |
| Completion matrix (F3/F7/F11) | `npx vite-node scripts/probe/g4end.ts` | table below |
| Reversed iteration order | `npx vite-node scripts/probe/g4rev.ts` | labels and deviations |
| Worst case drill-down | `npx vite-node scripts/probe/g4worst2.ts G4-F3-twoArm`, `g4energy.ts`, `g4speed.ts` | see "Reproduce" |
| Rejected real handoff | `npx vite-node scripts/probe/g4rej.ts` | see "Reproduce" |
| Lab | `npm run dev`, then open http://127.0.0.1:5197/ | `?fixture=<id>&t=<s>&cam=side\|front\|oblique\|overhead&zoom=<k>&speed=<0.1..2>` |

**Versions** (unchanged): three 0.170.0, @dimforge/rapier3d-compat 0.21.0, vite 6.4.5, vitest 3.2.7, TypeScript 5.9.3, Node 26.9.0. Schema `tackling-v1.1`.

**Gate 4 profiles.** Every export carries the profile ids and the full profile values.

- **Body** `upperBodyCompound/100kg-std-sr25-sh20`: the Gate 3 body with the shoulder pivot at ±0.20 m (Decisions 1).
- **Solver** `solver-g4-4x60`: four 1/240 s substeps per 1/60 s tick. Gate 1 to 3 fixtures keep `solver-g1-1x60`; a test checks this.
- **Ragdoll** `ragdoll-g4-v1`:
  - mass fractions: core 0.48, head 0.08, upper arm 0.04, forearm 0.03 (palm share 0.2), thigh 0.10, shin 0.05 (shoe share 0.2);
  - limits: neck ±35°, elbow 0..145°, knee 0..150°;
  - shoulders and hips are spherical joints with no limits;
  - self-collision: `disabledAllSameOwner`;
  - validation: anchor 2 mm, new external penetration 15 mm, landmark 10 mm, length 2 mm;
  - audit tolerances: mass 1e-4 kg, P 1e-5 relative, L 1e-4 relative;
  - energy gain limit: max(10 J, 50 % of the old kinetic energy);
  - passive palm link: stiffness 3000, damping 100, 0.10 m separation, budget 0.35.
- **Rules** `rules-g4-footballTackleSubset-v1` and `rules-g4-labCoreOnly-v1`:
  - influence: impulse ≥ 1e-3 N·s, or a grip, or a loaded clamp. It clears after 0.2 s of supported, grounded, unopposed movement at ≥ 0.5× the requested speed;
  - progress window: 0.75 s, ≤ 0.05 m advance, ≥ 20 N restraint, request ≥ 0.5 m/s;
  - sideline plane: dot(p, n) ≥ offset, using actual touch points only;
  - settle time 0.5 s after an ending;
  - the wrist/ankle exclusion band is 0.03 m.

## Files

- `src/sim/ragdoll.ts` (new): ragdoll blueprint, pose and validation.
  - Ten-body blueprint built from the body profile and the ragdoll profile.
  - Candidate pose from the achieved pose (tiered limb-pose pick with arm and leg alternatives).
  - Geometry validation: anchors, landmarks, lengths, hinge range, floor and external penetration.
  - Labelled diagnostic candidate edits (`jointMismatch`, `surfaceShift`).
  - Bulk P/L transfer (section 9 formula, world inertia tensors) with its audit.
  - Hinge-angle and anchor-error readback; physical pose back to the visual rig.
- `src/sim/rules.ts` (new): `RuleObserver`.
  - Ground-contact region labels: solved floor manifolds, plus achieved-pose limb probes for proxies.
  - Influence history; progress window; sideline plane; frozen event spot (`ballRef` from `ballLocal`).
  - `disable(reason)`; per-tick trace row; condensed `progressWindow`/`groundTouch` events.
- `src/sim/simulation.ts`:
  - representation runtime and atomic batch conversion (step 1 of section 13);
  - diagnostic conversion requests;
  - a rejected candidate keeps the Gate 3 falling proxy and logs `handoffRejected`;
  - per-substep `ragStats`;
  - rule observer wiring (step 11): intent override to braking after an ending, settle window, then stop;
  - `invalidHandoff` label;
  - exports carry the rule profile, `ruleEnding` and per-row `rule`.
- `src/sim/arms.ts`: grip and clamp handling through a conversion.
  - Grip remap onto the converted target; passive palm link for a converted owner, so an active and a passive force never act on one grip.
  - Clamp remap onto the converted target; a converted owner's clamps end with `ownerRagdoll`.
  - `endPlay()` releases everything with `playEnded` and blocks new acquisitions.
- `src/sim/physics.ts`: the contact-filter hook now runs. It is stepped with an `EventQueue` (Limitations 1).
- `src/sim/profiles.ts`: `SOLVER_G4`, `RagdollProfile`/`RAGDOLL_G4`, `RuleProfile`, `RULES_FOOTBALL`, `RULES_LAB_CORE`.
- `src/sim/fixture.ts`: fixture `ragdoll`, `rules`, `diagnostics.conversions`.
- `src/sim/controllers/wrap.ts`: intercept lead and approach velocity used by the Gate 4 line tackles.
- `src/sim/pose.ts`: physical ragdoll pose drives the visual rig while converted.
- `src/sim/fixtures/gate4.ts` (new, 31 fixtures); `src/sim/fixtures/index.ts`.
- `src/lab/views.ts`: `RuleOverlay` (cosmetic ball, yellow event-spot ring and pole, sideline ground line).
- `src/lab/main.ts`:
  - info panel sections for handoff, ragdoll and rules;
  - engine body/joint/collider/grip/clamp counts (the debug count display required by section 13);
  - representation change resets interpolation;
  - event-log vectors and id lists are now printed. They were blank before this session.
- `tests/gate4.test.ts` (new, 48 tests).
- Probes: `scripts/probe/g4*.ts`.

## Source-to-ragdoll mapping

| Proxy part | Ragdoll segment(s) | Notes |
| --- | --- | --- |
| torso box + pelvis box | `core` (2 colliders, 48 kg) | rigid core (Limitations) |
| head sphere | `head` (8 kg), neck revolute ±35° | |
| visual arms (IK pose) | upper arm 4 kg, forearm 3 kg + palm collider | spherical shoulder, elbow 0..145° |
| support + visual legs | thigh 10 kg, shin 5 kg + shoe collider | spherical hip, knee 0..150° |
| total | 100.00 kg, 10 bodies, 9 joints, 15 colliders | read back from Rapier (`g4blueprint.ts`) |

The candidate pose is taken from the achieved pose (the visual rig's solved limbs on the actual proxy transform).

- Arm and leg alternatives are used only when the achieved limb pose fails penetration.
- Each choice is logged with the handoff.
- The new assembly COM differs from the proxy COM (G4-F1: 4.1 cm lower, 3.7 cm forward) because the mass distribution differs. L is computed about the new COM, as section 9 specifies.
- Extra cosmetic limb-swing velocity is omitted (common bulk motion only).

## Quantitative boundary and integrity audits

Columns:

- **sep**: worst joint-anchor separation, sampled every substep.
- **hinge**: worst hinge excursion past a limit / in the reverse direction.
- **pair pen**: deepest cross-owner overlap while either player is a ragdoll.
- **ΔKE**: instantaneous energy change at the switch.
- At the switch itself: anchor error 0.00 mm, landmark error 0.00 mm and new external penetration ≤ 0.6 mm for every accepted handoff, except G4-F4-ownerOnly/simultaneous D, which has 7.2 mm. That is under the 15 mm tolerance; it is D's forearm against R and comes from the existing contact.

| Fixture | Player, trigger | sep (mm) | floor pen (mm) | hinge over / reverse (°) | v max (m/s) | pair pen (mm) | ΔKE J (limit) | P / L rel err |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G4-F1 | R diagnostic | 2.9 | 2.9 | 2.4 / 1.3 | 4.40 | 0 | 0.0 (10) | 0 / 0 |
| G4-F2-yaw90-spin | R diagnostic | 5.3 | 5.3 | 1.1 / 1.9 | 10.84 | 0 | 7.0 (400) | 2.5e-8 / 6.5e-8 |
| G4-F2-yaw225-tumble | R diagnostic | 8.5 | 6.3 | 2.7 / 1.4 | 7.04 | 0 | −7.5 (204) | 1.0e-8 / 1.2e-7 |
| G4-F2-yaw0-tilt20 | R diagnostic | 7.9 | 4.4 | 2.9 / 0.5 | 6.15 | 0 | 12.0 (161) | 1.5e-8 / 4.2e-8 |
| G4-F3-twoArm | R lossOfSupport | **22.7** | 6.0 | 2.7 / 1.3 | **11.32** | 0 | 21.1 (395) | 3.3e-9 / 2.1e-8 |
| G4-F3-oneArm | R / D lossOfSupport | 3.0 / 1.2 | 5.1 / 0.2 | 0.4 / 1.2 | 6.75 | 0.4 | 2.7 / 16.6 | ≤ 2.0e-8 |
| G4-F4-targetOnly | R diag., D lossOfSupport | 5.0 / 2.7 | 5.6 | 2.4 / 2.2 | 5.24 | 0.5 | 0.0 / 2.3 | ≤ 1.4e-8 |
| G4-F4-ownerOnly | D diagnostic | 2.2 | 2.6 | 2.7 / 0.3 | 3.72 | 6.5 | 0.0 | ≤ 2.6e-11 |
| G4-F4-simultaneous | D + R diagnostic | 1.5 | 1.9 | 0.7 / 1.5 | 4.87 | 6.5 | 0.0 | ≤ 2.6e-11 |
| G4-F4-invalidSurface | R diagnostic | 2.5 | 2.8 | 2.6 / 1.2 | 4.31 | 0.1 | 0.0 | ≤ 9.6e-12 |
| G4-F10-targetOnly | R diagnostic | 3.2 | 2.6 | 1.1 / 1.1 | 3.78 | 1.9 | 1.1 (29) | ≤ 7.9e-8 |
| G4-F10-ownerOnly | D diagnostic | 1.6 | 1.0 | 1.1 / 0.5 | 4.83 | 0 | 3.6 (36) | ≤ 1.9e-8 |
| G4-F10-simultaneous | D + R diagnostic | 4.4 | 6.7 | 2.4 / 1.0 | 4.98 | 6.6 | 3.6 / 1.1 | ≤ 7.9e-8 |
| G4-F5-standingOpponent | R diag., D lossOfSupport | 3.4 / 1.5 | 4.6 | 2.8 / 0.7 | 6.90 | 3.7 | 4.5 / 9.5 | ≤ 4.4e-8 |
| G4-F5-twoRagdolls | R + D diagnostic | 2.4 / 2.2 | 4.3 | **5.4** / 2.8 | 6.10 | 4.4 | 4.1 / 6.9 (225) | ≤ 7.5e-8 |
| G4-F7-limbFirst | R diagnostic | 3.2 | 2.6 | 1.1 / 1.7 | 4.33 | 0.2 | 1.1 | ≤ 7.9e-8 |
| G4-F7-groundedThenTouched | R diagnostic | 5.0 | **8.5** | 2.3 / 1.6 | 4.50 | 0.7 | 0.0 | 0 |
| G4-F7-defenderFallsAlone | D diagnostic | 2.3 | 2.0 | 2.6 / 1.0 | 5.06 | 0 | 6.1 | ≤ 5.8e-8 |

- G4-F6-jointMismatch is rejected (`jointAnchor,landmarkDiscontinuity`). G4-F6-crowded is rejected (`externalPenetration`).
- G4-F7-labCore and G4-F7-untouched are F1 under rule profiles; their rows equal F1.

**Worst accepted case: G4-F3-twoArm at 1.1833 s, when R's core hits the floor.**

- Joint separation is 22.7 mm inside the substeps; at the end of the tick it is 8.4 mm (left elbow).
- The peak segment speed of 11.3 m/s is a forearm whip.
- R's mechanical energy falls through the impact (KE + PE 1626 J → 731 J in 50 ms), so this is not a launch.

**Solver justification** (`g4solver.ts`, worst over each fixture's accepted ragdolls):

| Substeps | Worst sep (mm) | Worst hinge over (°) | Worst hinge reverse (°) | Worst floor pen (mm) |
| --- | --- | --- | --- | --- |
| 1 × 1/60 | 37.6 (F10-simultaneous) | 20.8 (F4-targetOnly) | 14.8 (F5-twoRagdolls) | 37.6 (F2-yaw90) |
| 2 × 1/120 | 28.8 (F10-ownerOnly) | 11.4 | 7.1 | 14.3 |
| 4 × 1/240 | 22.7 (F3-twoArm), others ≤ 8.5 | 5.4 | 2.8 | 8.5 |

- Result labels are identical under all three solvers.
- Four substeps is the declared Gate 4 solver. Gate 1 to 3 fixtures are unchanged.

## Fixture results

**F3: contact-driven falls** (same code for all three; only the line speeds and the arm plan differ).

- twoArm (D 7 m/s, R 4 m/s, both arms wrap):
  - R loses support at 0.904 s: `recoveryEnvelope`, lean 38.1°, projected 55.9°. The relevant contacts are D's clamps and shoulder contact.
  - The handoff is accepted. Both D clamps `clampRemap` onto `R:core:torso`, then release with `contactLost` by 1.004 s.
  - `groundDown` at 1.150 s: pelvis, physical contact, influence active from D's clamps and contacts.
- oneArm: R and D both lose support and both convert. `groundDown` at 1.108 s, pelvis.
- failed (D 3 m/s):
  - the wrap forms (one- and two-arm hold, alternating) and R stays supported;
  - D leaves the practice area at 2.667 s, giving `practiceOutOfBounds`;
  - no ending, no handoff.

**F4: palm grips through a conversion** (`g4grips.ts`).

- targetOnly: both grips `gripRemap` core→core with anchor error 0 m. They keep loading R and release with `invalidPose` at 1.175 and 1.188 s. D later loses support (1.742 s).
- ownerOnly: both grips become `gripPassive` (palm gap 0) and release with `separation` at 0.958 s (exposure 0.036 s).
- simultaneous: remap plus passive on both grips. They release with `separation` at 0.975 s.
- invalidSurface (labelled diagnostic edit, core shifted 3 cm): `gripRemap ok:false` (surface distance 0.03 m) and an immediate `gripRelease invalidSurface` on both arms. No force follows.
- Test: active shoulder force and passive palm force never act on one grip in the same step (all F4 cases).

**F10: forearm clamps through a conversion.**

- targetOnly: `clampRemap` on both arms. The clamps keep loading the fallen R until `contactLost` at 1.56 s.
- ownerOnly and simultaneous: `clampEnd ownerRagdoll` on both arms at 1.200 s and never again. No palm anchor is created (grips stay 0). After that, only physical forearm colliders touch R.

**F5: continuing interaction** (`g4f5num.ts`).

| Fixture | Cross-owner contacts | Pair impulse | Deepest overlap | Divergence from solo run |
| --- | --- | --- | --- | --- |
| standingOpponent | 110 | 266 N·s | 3.7 mm | R 1.43 m, D 1.01 m |
| twoRagdolls | 14 | 56 N·s | 4.4 mm | R 1.53 m, D 1.79 m |

- standingOpponent: the standing D keeps executing bounded drive (≤ 464 N, cap 1400 N) until D itself loses support (1.458 s).
- No same-owner contact is ever solved (test).

**F7/F11: completion matrix** (`g4end.ts`; `*` marks an eligible region).

| Fixture | Profile | Result | Ending | Ground touches |
| --- | --- | --- | --- | --- |
| F7-labCore | labCoreOnly | runnerCoreDown | 1.012 s | hand 0.98, pelvis* 1.01 |
| F7-untouched | football | duration | none | pelvis* 1.01 with `groundWithoutInfluence` |
| F7-footBrace | football | duration | none | trace labels only `foot?`, `footSupport` |
| F7-limbFirst | football | groundDown | 1.571 s, shin | shin* 1.57 (core still up) |
| F7-groundedThenTouched | football | groundDown | 3.633 s | pelvis* 0.81 without influence, then D's later touch |
| F7-defenderFallsAlone | football | duration | none | none (runner) |
| F7-unopposedStationary / wallNoOpponent / freeRun | football | duration | none | no progressStopped |
| F11-heldUp | football | progressStopped | 1.038 s (window from 0.288 s) | none; both players supported |
| F11-resumed | football | practiceOutOfBounds | none | the window ends when D steps aside; R advances |
| F11-sidelineFoot | football | sidelineOut | 0.167 s | foot touch at z ≥ 4 while COM z < 4 |
| F11-sidelineClear | football | duration | none | run 0.25 m inside the line: no touch |

Observer-level coverage:

- Hand/wrist exclusion: palm and the 0.03 m wrist band never end the play; mid-forearm does. This uses a synthetic frame on a real ragdoll pose (Limitations 7).
- Diagnostic NaN injection gives `numericalFailure`, which is not an ending.
- A rejected runner handoff gives `invalidHandoff`, with the observer disabled.

## F8: lifecycle and reproducibility

- **Resets:** 35 reset cycles over 6 fixtures reach the supported, holding, one-converting, both-converting and completed states. Body, joint, collider, grip and clamp counts return to the fixture baseline, with no orphan handles (test).
- **Render rate and palette:** 30 Hz and 144 Hz render rates and the `alt` palette give identical traces.
- **Same runtime:** a repeat in the same runtime gives identical traces (F2 test).
- **Reversed player/transition order** (`g4rev.ts`): result labels and ending kinds are identical for all 31 fixtures. Positions deviate:
  - F10-simultaneous 0.377 m; F5-twoRagdolls 0.273 m; F3-oneArm 0.160 m; F10-targetOnly 0.142 m; F3-twoArm 0.124 m. Every other fixture is ≤ 0.066 m, and 18 are 0.
  - Ending times shift: F3-twoArm 1.150 → 1.179 s; F3-oneArm 1.108 → 1.092 s.
  - Divergence starts at the first arm contact (0.47–0.60 s, arm processing order) or at ragdoll body creation (0.35 s, F5-twoRagdolls).
  - This is solver-order sensitivity. No cross-platform bitwise determinism is claimed.

## F9: visual review (inspected in Chrome on 5197, this session)

- **G4-F3-twoArm, side view** (least stable accepted case):
  - stepped tick by tick from 0.900 to 0.950 s, across the 0.904 s handoff;
  - then every 2 ticks to 1.267 s.
  - No T-pose, no jump at the switch. The limbs continue from the proxy's visual pose.
  - The event ring and pole appear at 1.15 s.
- **G4-F3-twoArm, oblique view:**
  - stepped 1.00 to 1.25 s every 3 ticks;
  - overhead at 0.933 s (D's arms around R);
  - oblique at 1.4 s with overlays: ball, spot, and the rules panel showing `ENDING groundDown @1.150 s spot (2.07, 1.26) pelvis`.
- **G4-F3-twoArm at 0.25× slow motion,** oblique, 8 samples from 0.85 to 1.35 s. Continuous fall, landing on the pelvis and then the torso. The runner stays on top of the ground plane.
- **Wrap that breaks:**
  - same run: D's forearms touch R's back while the clamps live (0.90–0.95 s). After the last `contactLost` (1.004 s), D's hands visibly separate from R.
  - G4-F3-failed at 1×, oblique, 10 samples: the wrap forms, both keep running, and the runner stays upright. Side still at 0.2 s.
- **Simultaneous fall, G4-F10-simultaneous:** side view stepped from 1.18 to 1.52 s; oblique and overhead at 1.6 s. R collapses onto D's legs with no visible interpenetration.
- **G4-F5-twoRagdolls:** 1×, side view, 6 samples to 1.52 s.
- **Palm grips, G4-F4-ownerOnly:** front view at 0.93 s, passive palm links. D's hands sit on R's torso surface. The oblique view hides them behind R.

In every inspected frame:

- elbows and knees bend only within their hinge sense (largest measured reverse excursion 2.8°);
- no body visibly passes through the ground or the other player (measured: floor ≤ 8.5 mm, cross-owner ≤ 6.6 mm).

Not inspected (U):

- continuous normal-speed motion and fall rhythm. Screenshots during playback are samples, not a watched sequence;
- G4-F1/F2/F6/F7/F11 were not viewed in the lab this session; their evidence is numeric and in tests.

## Rubric

| ID | Grade | Evidence |
| --- | --- | --- |
| G4-R1 Valid articulated body | 2 | Blueprint read back from Rapier: 10 bodies, 100.00 kg, 9 joints, hinge limits set on the engine joints (test). F1 accepted with 0.00 mm anchor and landmark error. F6: joint mismatch rejected (`jointAnchor`, `landmarkDiscontinuity`); crowded rejected (`externalPenetration`). Each rejected player stays a falling proxy: no shrink, move or collision disable. Shoulder pivot change declared (Decisions 1). |
| G4-R2 Continuity and atomicity | 2 | Each tick R owns exactly 1 or 10 bodies and world counts match (test). Audits: mass difference 0; P relative error ≤ 3.3e-8 and L ≤ 1.2e-7 (limits 1e-5 / 1e-4); ΔKE ≤ 21.1 J against limits ≥ 10 J. F1: mechanical energy never rises after the handoff; the ragdoll settles. F2: three yaws plus a 20° tilt; direction is retained and no extra impulse is added. |
| G4-R3 Contact-driven falling | 2 | F3 twoArm/oneArm: loss comes from the Gate 3 envelope under D's contact and clamps, the handoff follows the actual pose and motion, and `groundDown` comes from the observer. Failed attempt: same code, slower line, the runner stays mobile, no ending. |
| G4-R4 Grip/wrap survival and failure | 2 | F4 per-arm events above: remap with 0 m anchor error; passive link; releases with reasons (`invalidPose`, `separation`, `invalidSurface`). Shoulder and palm forces are never applied to one grip in the same step. |
| G4-R5 Continuing mutual interaction | 2 | F5: solved segment-to-proxy and segment-to-segment contacts (110 and 14); bounded overlap ≤ 4.4 mm; the standing D keeps executing bounded drive; each fall diverges ≥ 1 m from its solo run. |
| G4-R6 Honest football ending subset | 2 | Every F7 row is met physically, except hand/wrist brace, which is observer-level (the foot/ankle half of that row is physical). F11: held up, resumed, sideline foot vs clear. Influence and predicate traces are in the export. The stored spot stays frozen while bodies settle for 0.5 s (test). No fall timer selects an ending; duration and practice edge are separate labels. |
| G4-R7 Lifecycle/regression | 2 | F8 above. tsc, 93 tests, 120-fixture export and build all ran. Gate 1 to 3 fixtures keep their profiles (test) and their 45 tests pass. |
| G4-R8 Readable physical presentation | 2 (stepped stills, slow-motion and 1× samples) / U (continuous normal-speed motion) | F9 list above. The limitations required by the spec are listed below. |
| G4-R9 Correct forearm-clamp transition | 2 | F10: a supported owner's clamps continue on the fallen target (remapped) until `contactLost`. A converting owner's clamps end with `ownerRagdoll` at the boundary and never return. No palm anchor; only physical forearm contact afterwards (test). |

No hard failure observed:

- old and new colliders never coexist in a solve, and there is never no collider;
- no pose reset or launch: energy falls at the worst impact;
- mass, P and L continuity hold within the audits;
- no duplicated force: one force law per grip, and a converted owner gets no virtual clamp;
- no remote or through-body grip: invalid surfaces release;
- inter-player contact is never disabled; only same-owner pairs are filtered;
- no completion flag without an observer event;
- every fallback is reported (`handoffRejected`, `invalidHandoff`);
- no inspection is claimed beyond the list above.

## Decisions for you

1. **Shoulder pivot ±0.26 → ±0.20 m for every Gate 4 body.**
   - Why: at 0.26 the pivot sits outside the torso face (half-width 0.25). With an opponent pressed on the runner's side, no arm pose fits the 15 mm handoff tolerance, so contact tackles were rejected.
   - Options:
     - (a) keep 0.20 (current);
     - (b) return to 0.26 and accept more rejected handoffs on side contact;
     - (c) narrower upper-arm radius at 0.26.
2. **Ball carry position.**
   - The cosmetic ball sits at the core-frame offset (0.20, 0.30, 0.12), upper chest by the right shoulder. In upright views it reads as held high next to the hand.
   - The event spot uses this point.
   - Options:
     - (a) keep;
     - (b) lower it to a tucked carry (for example y ≈ 0.05). This changes every exported spot by a few centimetres.
3. **Slow one-arm lines reject the real handoff** (Reproduce 2). The runner then falls as the Gate 3 proxy and the trial is labelled `invalidHandoff`. This is the honest outcome under the current rules. Options:
   - (a) keep;
   - (b) give the candidate search more leg alternatives (still validated, no hidden moves);
   - (c) give the supported proxy physical leg colliders, so legs cannot enter the defender before the switch. This is a bigger change and alters Gates 1 to 3.

## Limitations / open items

1. **Self-collision is disabled and was silently not disabled before this session's fix.**
   - Ragdoll same-owner pairs are filtered by a contact-filter hook.
   - Rapier 0.21 runs physics hooks only when `world.step` receives an `EventQueue`. Earlier code passed `undefined`, so the hook was never called and same-owner pairs collided.
   - `physics.ts` now steps with an internal queue whenever a filter is set; same-owner contacts are 0.
   - Numbers recorded before the fix (joint separation 44 mm at 1 substep, 6–11 mm at 4) are void. This document has the post-fix numbers.
2. **Coarse articulation.**
   - Shoulders and hips are unlimited spherical joints (loose).
   - The core is rigid (torso and pelvis are one body).
   - No active recovery, bracing or get-up. A converted player is fully passive.
3. **Transient integrity.**
   - Substep joint separation reaches 22.7 mm at the hardest impact (8.4 mm at tick end).
   - Hinge excursions up to 5.4° past a limit and 2.8° reverse.
   - Floor penetration up to 8.5 mm.
4. **Solver cost.** `solver-g4-4x60` steps four times per tick. One substep roughly doubles joint separation and triples hinge overshoot (table above).
5. **The supported proxy has no limb colliders.** Its legs and arms are visual. This is why handoff candidates can find legs inside the opponent (Decisions 3).
6. **Clamp chatter** (pre-existing since Gate 2). Clamps end and re-begin almost every substep while sliding, and the wrap status alternates between one-arm and two-arm hold (G4-F3-failed). Forces stay within budget, but the event log is noisy.
7. **Hand/wrist brace is observer-level only.** A passive ragdoll never produces a hand-only brace. Pushed-over bench attempts gave shin endings or rejected candidates. The foot brace is physical.
8. **Reversed iteration order** moves bodies by up to 0.38 m, while labels and kinds stay identical (F8).
9. **The proxy-to-ragdoll COM shift** (about 4 cm) is inherent in the different mass distributions. P and L are conserved about the new COM; KE changes are recorded.
10. **Prototype scope.** This is a two-player local prototype. It claims nothing about full-game scalability or realistic athlete recovery.
11. **Normal-speed playback was not watched continuously** (R8, U).

## Reproduce the least attractive cases

1. **Worst accepted handoff.** G4-F3-twoArm, R's core–floor impact (22.7 mm substep separation, 11.3 m/s forearm whip).
   - Lab: http://127.0.0.1:5197/?fixture=G4-F3-twoArm&t=1.18&cam=side&zoom=0.75 (Step through 1.15–1.27 s).
   - Headless: `npx vite-node scripts/probe/g4worst2.ts G4-F3-twoArm`, `npx vite-node scripts/probe/g4energy.ts G4-F3-twoArm 1.1 1.35`.
2. **Rejected real handoff.** `npx vite-node scripts/probe/g4rej.ts`: a one-arm line at D 2 m/s and at D 2.5 m/s.
   - At 2 m/s, R's right-shoe collider is 16.7 mm inside D's support (limit 15 mm).
   - At 2.5 m/s, R's right thigh is 60.4 mm inside D's support.
   - In both, R continues as the Gate 3 falling proxy, the observer is disabled and the result is `invalidHandoff`. D later converts normally.
