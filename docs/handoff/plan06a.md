# Plan 06a handoff: physical ride height and support

**Date:** 2026-11-05.
**Status:** implemented in the accepted 06a/07 checkpoint; the measurements below retain the original RH profile baseline. The user's decisions and force model are in. The acceptance checks the user asked for pass:
- the isolated defender stays up across starting phases;
- tackles, side hits and an over-capacity lean still defeat balance;
- crouch heights and vertical handoffs were rechecked.

Waiting for the user's visual acceptance.
**Plan:** [06a — Physical ride height and support](../open/06a_Physical_Ride_Height_and_Support.md).

**Follow-up disposition:** [Plan 07 — Support recovery and contact footwork](../open/07_Procedural_Contact_Footwork.md) repairs the load-release rebound and one-arm `hingeLimit` rejection under explicit new profiles; its implementation passed independent closeout review. The measurements below remain the incoming baseline, not evidence those failures are resolved. Changed tackle outcomes and an upright carrier within finite support capacity are not required to match legacy. Visual-flight suspension remains an explicit approximation beyond 07; toe-off residuals and valid plants belong to 07.

New RH fixtures opt into a ground-probed, bounded suspension (`support-suspension-rh-v1`).
- Locomotion requests a root height.
- The suspension force decides how the body moves. It is clamped to [0, 3.5 mg], then split: up to body weight acts at the turf below the body's calibrated legacy pivot, and the excess acts through the COM.
- Poses, contacts, rules and rendering read the solved motion.

Nothing sets a position or velocity. There is no pelvis offset and no bone stretching, and no handoff tolerance was widened.

Every historical fixture keeps the named legacy support (`support-capsuleFloor-v1`). All 143 pre-existing `evidence/summary.json` entries are byte-identical to HEAD.

## User decisions (2026-11-05) and how they are implemented

| # | Decision | Implementation |
| --- | --- | --- |
| 1 | **Balance ceiling at the nominal body weight.** Keep the absolute and combined torque ceilings, compute posture compensation from the actual load and the solved geometry, and give zero balance authority without support or once falling. Drive and yaw stay load-limited. | `SuspensionSupport.balanceCeiling: 'nominalWeight'`: min(240, m g r) = 240 N m while the probe is valid and control is supported, otherwise 0. The combined 300 N m ceiling is unchanged. Drive and yaw scale with clamp(N / m g, 0, 1). The superseded instantaneous rule min(240, N r) is kept as `'appliedLoad'` for comparison probes only. |
| 1b | **Force split after the clamp:** pivot force = min(F, m g), COM force = F − pivot force. Use this body's calibrated legacy pivot, not a hard-coded lever. Record both components and their torque. | `SuspensionSupport.application: { pivot: 'legacyHemisphere', excess: 'throughCom' }`; `splitSupportForce` in `support.ts`. Details in Design below. |
| 2 | **Sprint: keep the reduced bob provisionally.** A push-only support cannot follow downward acceleration beyond gravity, and more force capacity would not help. | The bound is unchanged (≤ 0.75 g down). Sprint at its nominal rate keeps 0.343 of its two-harmonic amplitude. See the warning below the table. |
| 3 | **Standing 0.89 m provisionally** as the initial athletic stance for this model. This is the root height; the hips are at about 0.921 m. It is subject to visual review and is not a universal maximum. | Doc comment on `standingHeightM`. It is the highest height whose feet reach the turf with bent knees **under the current foot placement and knee/soft-reach policy**. |
| 4 | **Keep the invalid-surface bump-stop collapse.** Leaving probe travel removes support and motor authority at once but is not itself a ragdoll conversion. Re-acquiring support is allowed before falling begins and never after. | `unsupportedBottomOut` loss reason (tested). The `beyondTravel` status means zero force and zero drive, yaw and balance authority from the next substep (forces use the probe of the last solved state). Re-acquisition happens only while `supported`; a falling player gets nothing (RH-F5-playerBelow, RH-F5-noRescue). |
| 5 | **Keep the visual-flight support; defer toe-off residuals to plan 07.** | Unchanged and declared. Neither is described as physical running or successful foot planting. |

> **Warning (decision 2):** the RH-F3 tracking numbers measure how well the body follows the **attenuated** target. They do not show that the clip's original motion (8.1 cm Sprint bob) is preserved.

## Reproduced baseline (step 1)

Source: `37e6c3026f5c` plus this working tree (`scripts/probe/rh-baseline.ts`).

| Profile | Identity |
| --- | --- |
| body | `upperBodyCompound/100kg-std-sr25-sh20+bew-v6:5aaab36942e3` |
| motor | `motor-g1-default` |
| solver | `solver-g4-4x60` |
| stance | `stance-g3-free` |
| balance | `balance-g3-v1` |
| ragdoll | `ragdoll-g4-v1+bew-v6:5aaab36942e3` |
| run clips | `run-clips:fast-run@9d9ad0197d33+sprint@f2aa3627a75d` |
| support | `support-capsuleFloor-v1` (legacy) / `support-suspension-rh-v1` (RH) |

Coordinates: world Y is up and the turf is at y = 0. Body-local means the proxy-origin frame (bew-v6 GLB rest − (0, 0.95, −0.059)).

| Quantity (legacy rest, t = 0) | Value |
| --- | --- |
| Proxy origin (root) | 0.9500 |
| Hip landmark (UpLeg joint midpoint) | 0.9806 (plan: 0.981) |
| Straight-leg hip height (leg 0.8796) | 0.9855 (plan: 0.986) |
| COM | 1.1708 |
| Flat-shoe ankle | 0.1058 |
| Lowest shoe point L / R | 0.048 / 0.298 (legacy procedural rest pose) |
| Support capsule | radius 0.16, half-height 0.65, centre (0, −0.14, 0); lower hemisphere centre (the legacy pivot) at (0, −0.79, 0), 1.011 m below the COM |
| Mass, local COM | 100 kg, (0, 0.2209, 0.0080) |
| Principal inertia | (2.2215, 16.3633, 16.8025) kg m² |

Clip pelvis-to-ground trajectories (hip-joint height in calibrated player leg units; root = hip − 0.03069):

| Clip | Hip min..max (mean) | Root min..max (mean) | Bob harmonics 1–4 (m) | Vertical acceleration at rate 1 |
| --- | --- | --- | --- | --- |
| Fast Run | 0.8838..0.9230 (0.9107) | 0.8531..0.8923 (0.8800) | 0.0078, 0.0092, 0.0034, 0.0063 | −37.7..+50.3 m/s² |
| Sprint | 0.8633..0.9440 (0.8942) | 0.8327..0.9133 (0.8635) | 0.0168, 0.0302, 0.0045, 0.0012 | −40.7..+35.4 m/s² |

Known failures were reproduced and kept as baseline. `G4-F10-simultaneous-M` rejects both candidates for `externalPenetration` under both supports.

## Design

### Support geometry (`physics.ts createProxy`, suspension only)

- The support capsule keeps its geometry and mass, so player–player body collision is unchanged.
- The capsule is removed from static ground by collision groups (`GROUP_STATIC`; turf and obstacles join that group via `markStatic`).
- A massless **guard ball** (radius 0.12 m, bottom 0.62 m below the origin) is the bump stop and the falling contact with static ground. A contact hook filters out its contacts with players.
- Mass and COM are bit-identical to legacy. Inertia matches to float32 rounding (≤ 1e-6 relative).

### Ground probe (`support.ts classifyProbe`, `simulation.ts updateProbe1`)

- One vertical ray from the proxy origin per substep, on the solved state.
- Targets: static colliders plus other players' live bodies. The player's own colliders are never targets.
- Status, first match wins:

| Status | Meaning |
| --- | --- |
| `obstructed` | the ray hit another player first (a player is never ground) |
| `invalidSurface` | the hit is not turf |
| `invalidNormal` | the normal is more than 20° from vertical |
| `beyondTravel` | the ground is more than 1.0 m below; re-acquired below 0.99 m |
| `none` | no hit |
| `ok` | valid turf within travel |

- Only `ok` is support.

### Force (`support.ts suspensionForce`, `splitSupportForce`)

1. The law: F = m(g + a_t) + k(h_t − h) + c(v_t − v).
   - k = m(2πf)², c = 2ζm(2πf), with f = 7 Hz and ζ = 0.8.
   - h is the probed root height. v is the root's vertical velocity relative to the ground.
   - F is clamped to [0, 3.5 mg]. The ground never pulls.
2. **Split after the clamp** (decision 1b; a deliberate approximation: excess vertical load supplies lift without additional tipping torque):
   - The **pivot share** Fp = min(F, m g) acts vertically at the turf point below the body's **calibrated legacy pivot**. The pivot is the centre of the support capsule's lower hemisphere. It is computed per body from the proxy geometry when the player is built (`SuspensionRuntime.pivotLocal`, the same point the legacy balance lever uses). For bew-v6 it lies 0.79 m below the root and 1.011 m below the COM.
   - The **COM share** Fm = F − Fp acts vertically through the COM and adds no torque about it.
   - The total vertical force, and so the ride height, is unchanged. The tipping contribution is bounded by the body weight at the legacy lever, so running-bob peaks lift without tipping.
3. **Diagnostics:** trace `sup.F` / `Fc` (applied / commanded), `sup.Fp` / `Fm` (pivot / COM share), and `sup.T` (the pivot share's torque about the COM, N m, world vector). Also saturation, work, impulse and power (both shares). The lab info line shows `pivot … + COM … BW, tip … N m`.

### Authority and loss of support

- **Drive and yaw:** scaled by clamp(N / mg, 0, 1).
- **Balance ceiling:** 240 N m (nominal weight) while supported with a valid probe, otherwise 0. The combined yaw + balance ceiling is 300 N m.
- **Posture gravity hold:** Fp · lever · sin θd, using the actual pivot load and the solved pivot lever.
- **Falling switch:** the suspension is disabled and its state cleared (force and split zero) before any falling force.
- **Collapse rule** (`unsupportedBottomOut`): while supported, the guard touching static ground with an invalid probe is a loss of support.
- **Initial lean:** placed about the pivot's turf point at the fixed root height.

### Height target and legs

These are unchanged from the first pass:
- **Stance request:** a critically damped 2.5 Hz filter, ≤ 4.9 m/s², ≤ 0.6 m/s.
- **Running height:** the clip's calibrated hip-joint mean, plus a two-harmonic bob scaled to ≤ 0.75 g down.
- **Blend:** at the clip weight, clamped to [0.72, 0.96], slew ≤ 1.5 m/s.
- **Feedforward:** off while the clamp or the slew limit holds the target.
- **Phase:** advanced once per substep before the support force.
- **Legs:** ground-relative legs around the achieved hips, with existing lengths, solve and foot IK.

## Settings (`SUSPENSION_RH`, `src/sim/profiles.ts`; frozen before the regression runs)

| Setting | Value | Notes |
| --- | --- | --- |
| `standingHeightM` | 0.89 | Provisional initial athletic stance (decision 3). Hips about 0.921 m, shoe 1.4 mm above the turf, knee 45°. At 0.95 the legs stop 2.6 cm short (`rh-stand-sweep.ts`). |
| `targetRangeM` | [0.72, 0.96] | 0.72: knee about 96°. 0.96: legs near straight. |
| `probeMaxM`, hysteresis | 1.0 m, 0.01 m | |
| normal limit | 20° | Flat static turf only. |
| `guard` | bottom 0.62 m, radius 0.12 m | Bump stop 0.27 m below standing. |
| `frequencyHz`, `dampingRatio` | 7 Hz, 0.8 | |
| `maxForceBW` | 3.5 | |
| `targetSlewMps` | 1.5 | |
| `stance` | 2.5 Hz, 4.9 m/s², 0.6 m/s | |
| `run` | 2 harmonics, 0.75 g | Provisional (decision 2). |
| `balanceCeiling` | `'nominalWeight'` | Decision 1. |
| `application` | `{ pivot: 'legacyHemisphere', excess: 'throughCom' }` | Decision 1b. |

## Fixtures (`src/sim/fixtures/ride-height.ts`, milestone RH, 36 fixtures, lab group "RH · ride height and support")

Measured with `scripts/probe/rh-probe.ts` and the adopted model.

### RH-F1 / F2: standing and stances (rechecked)

| Fixture | Request | Settle | Error after | Force (BW) | Knee | Lowest shoe |
| --- | --- | --- | --- | --- | --- | --- |
| RH-F1-stand | 0.89 | 0 s | 0.0000 | 1.000 constant, no chatter | 44.7° | +1.4 mm |
| RH-F1-drop (+4 cm) | 0.89 | 0.083 s | ≤ 0.0096 | 0..2.16 | 34.7–44.8° | +1.3 mm |
| RH-F1-lean (8°) | 0.89 | 0 s | 0.0000 | 1.004 | 44.8° | +1.3 mm |
| RH-F2-crouch | 0.89, 0.80, 0.89 | 0.267 s each way | ≤ 0.0092 | 0..1.59 | 44.7–74.1° | −0.4 mm |
| RH-F2-stagger | 0.89, 0.82 (+0.3 m stagger), 0.89 | 0.233 s each way | ≤ 0.0091 | 0..1.59 | 44.7–75.2° | −0.5 mm |

### RH-F3: running (ticks at full clip weight after 0.3 s)

| Fixture | RMS | Max error | Lag (% stride) | Amplitude achieved / target (ratio) | h min..max | Bob scale | Force (BW) | Saturated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fastRun | 0.0006 | 0.0011 | −0.6 % | 0.0280 / 0.0275 (1.017) | 0.8627..0.8907 | 1.000 | 0..1.64 | 0 |
| sprint | 0.0007 | 0.0012 | −0.7 % | 0.0284 / 0.0279 (1.021) | 0.8515..0.8799 | 0.343 | 0..1.72 | 0 |
| accelBrake | 0.0006 | 0.0016 | −0.4 % | 0.0271 / 0.0273 (0.992) | 0.8629..0.8900 | 0.669 | 0..1.61 | 0 |

These numbers are agreement with the attenuated target (decision 2), not preservation of the clip's original bob: 3.9 cm for Fast Run and 8.1 cm for Sprint.

Stance foot of the clip (not a plant):

| Fixture | Sole gap median / p95 / max (m) | Stance IK residual p95 / max | Swing residual max |
| --- | --- | --- | --- |
| fastRun | 0.0001 / 0.0020 / 0.0077 | 0.045 / 0.047 | 0.077 |
| sprint | 0.0001 / 0.0073 / 0.033 | 0.035 / 0.038 | 0.030 |
| accelBrake | 0.0000 / 0.0008 / 0.0020 | 0.044 / 0.049 | 0.074 |

**Flight:** the suspension stays on while both drawn feet are up. Fast Run has 41 of 115 ticks of clip flight with F > 0; this is the declared approximation (decision 5). Trace `sup.fl` marks it.

### RH-F4: limits and disturbances

| Fixture | Result |
| --- | --- |
| RH-F4-range (0.60 / 1.10 / 0.89) | Clamped to 0.72 (settled 0.400 s) and 0.96 (0.517 s); back to 0.89 in 0.233 s; force ≤ 1.59 BW. |
| RH-F4-load (−3000 N at COM, 0.5–1.0 s) | Overcomes the support: saturated 42 ticks at 3.5 BW, guard bottoms (h 0.62). **Changed:** the first implementation lost balance at 0.879 s; now the excess load acts through the COM and the player stays upright. **Artifact:** on release, the compressed suspension launches the root to 1.21 m (beyond travel 1.204–1.625 s, no force or authority meanwhile); it settles at 1.78 s. |
| RH-F4-kickDown (250 N s) | 10 ticks at the ceiling, settled 0.500 s after. |
| RH-F4-kickUp (200 N s) | Beyond travel 0.067–0.350 s (zero force and authority on every tick fully out of travel), still `supported`; settled 0.417 s after. |
| Momentum audit | Vertical momentum = support impulse + gravity impulse within 0.05 N s on contact-free fixtures. |

### RH-F5: no false support

| Fixture | Result |
| --- | --- |
| RH-F5-outOfRange | F = 0 while beyond travel; re-acquires at 0.981 m (0.229 s) and settles 0.167 s later. |
| RH-F5-invalidNormal | F = 0 throughout; `unsupportedBottomOut` at 0.204 s; handoff accepted. |
| RH-F5-obstacle | The same, at 0.2125 s. |
| RH-F5-playerBelow | A is `obstructed` with F = 0, falls onto B, and loses support at 0.650 s (envelope; candidate rejected, `externalPenetration`). A then re-acquires valid turf at 0.996 s while falling and gets **no** force. **Changed:** B now carries A (saturated 21 ticks) and stays up; it settles at 1.13 s. Under the first implementation B lost support at 0.838 s. |
| RH-F5-noRescue | Rejected conversion; falling proxy over valid turf with F = 0 throughout. |

### RH-F6: balance — isolated defender, tackles, side hits, lean capacity

**Isolated defender** (`RH-F6-defenderRun-{0,25,50,75}`, `scripts/probe/rh-defender.ts`):
- the L1-F5/F6 defender with no runner: same body, arms, motor and start (7 m/s, 12° lean);
- requests: a 7 m/s +Z line (6.0 m/s motor ceiling) with a 12° posture lean;
- 3 s per run, 5.6 strides.

| Model | Phase 0 | Phase 0.25 | Phase 0.5 | Phase 0.75 |
| --- | --- | --- | --- | --- |
| **Adopted** | up; lean ≤ 13.0°, mean 12.4°; balance at cap 0 % | up; 13.0° | up; 13.0° | up; 13.0° |
| First implementation (applied-load ceiling, probe-depth pivot, all load at pivot) | falls 0.325 s | falls 0.388 s | falls 0.333 s | falls 0.463 s |
| Decision 1 alone (nominal ceiling, probe-depth pivot, all load at pivot) | falls 0.454 s | falls 0.846 s | falls 0.463 s | falls 1.067 s |
| Legacy capsule floor | up; lean ≤ 15.8°; at cap 24 % | up | up | up |

Why decision 1 alone was not enough: at 12° lean the probe-depth pivot (1.10 m lever) tips with about 224 N m at body weight. At the bob's 1.6–1.7 BW peaks that becomes about 370 N m, above the absolute 240 N m ceiling, so lean grows each stride. Even without a bob it fell at 1.58 s.

Variants measured during diagnosis:

| Variant | Lone defender | Defeatable? |
| --- | --- | --- |
| Pivot at the legacy depth only | falls 0.63–1.33 s | — |
| Excess through the COM only | falls in 2 of 4 phases (2.8 s, 3.0 s) | — |
| Support under the hips or the COM | up | **no**: no tackle, side hit or 14° lean ever loses support |

**Defeat cases** (`scripts/probe/rh-defeat.ts`; first loss of support, s):

| Case | Adopted | Legacy (same requests) | First implementation |
| --- | --- | --- | --- |
| RH-F6-collision | R 0.792, D 0.863 (both accepted) | R 0.925, D 0.904 | R 0.783, D 0.833 |
| RH-F6-twoArm | R 0.850; D up (holds the wrap) | R 0.771, D 1.242 | D 0.379 **before contact**, R 0.729 |
| RH-F6-oneArm | R 0.863; D 1.500 (candidate rejected, `hingeLimit`); groundDown | R 0.704; D up | D 0.379 before contact; R rejected (`externalPenetration`); invalidHandoff |
| RH-F6-failed (3 m/s line) | both up; runner keeps running (practiceOutOfBounds) | R 0.900, D 1.321 | R 0.688, D 1.308 |
| RH-F6-sideRecover (2 m/s runner) | R 1.171 | R 0.967 | R 0.863 |
| RH-F6-sideLoss (4 m/s runner) | R 0.850 | R 0.838 | R 0.729 |
| RH-F6-lean14-cap240 | 1.146 | 1.375 | 0.454 |
| RH-F6-lean14-cap168 | 0.329 | 0.442 | 0.287 |
| RH-F6-simultaneous | both rejected (`externalPenetration`, known baseline) | same | same |

Notes on the defeat cases:
- Peak pivot tipping torque while still supported in the tackles was 420–460 N m: tipping grows with lean, so gravity still helps defeat balance.
- The slow-line attempt's outcome matches its fixture description ("the 4 m/s runner stays up and keeps running"), which the legacy L1-F7 did not.
- The side-hit fixtures and lean-capacity fixtures have no registered legacy -M fixture; the legacy column runs the same definition without `support`.

Running and moving pairs (`scripts/probe/rh-compare.ts`), adopted model against legacy:

| Pair | COM y | Balance cap | Drive cap |
| --- | --- | --- | --- |
| RH-F6-idleRunBrake | 1.111 vs 1.170 | — | identical |
| RH-F3-fastRun | — | 240 vs 240 N m | 1152 vs 1399 N (−18 %; load-limited, decision 1) |
| RH-F3-sprint | — | — | 1104 N |
| RH-F3-accelBrake | — | — | 1303 N |

The running peak lean is 0.9–1.9° (legacy 1.9–2.1°).

### RH-F7: handoff while moving vertically (rechecked)

| Fixture | Conversion | Vertical velocity carried (m/s) | Audit |
| --- | --- | --- | --- |
| rising | 0.7125 s | +0.057 | ok |
| falling | 0.600 s | −0.072 | ok |
| top | 0.817 s | −0.002 | ok |
| bottom | 0.700 s | +0.007 | ok |
| both players | the same step | — | both accepted |

- Vertical momentum carries over exactly.
- The suspension is inactive with zero force once converted (no double support).

### RH-F8: fixed-step reproducibility

For RH-F2-crouch, RH-F3-accelBrake and RH-F7-top:
- traces are byte-identical at 30 Hz, 144 Hz, and with pauses;
- reset ×3 reproduces the trace with identical body, collider and joint counts.

The simulation is headless; a hidden-mesh path was not separately exercised.

## Visual review (lab `npm run dev`, http://127.0.0.1:5197/?fixture=RH-F3-sprint)

Stepped frames at normal playback, plus quarter-stride stepping as the slow review:

| Fixture | View | Observed |
| --- | --- | --- |
| RH-F3-sprint | side, front, oblique; quarter-stride stepping | stance foot at the turf, swing leg folds, helmet height steady across phases (no visible bounce) |
| RH-F3-accelBrake | side | full clip at 5.6 m/s; braking blends to short steps (2.2 m/s at 2.9 s); stops in the bent-knee stance with both shoes flat |
| RH-F4-load | side | compressed onto the bump stop at 0.9 s (h 0.62), upright; at 1.4 s launched to 1.21 m with legs hanging (the rebound artifact above) |
| RH-F4-kickDown, RH-F4-kickUp | side | compressed with knees at 85° / airborne with legs hanging, as measured |
| RH-F7-rising, RH-F7-top | side and oblique, around conversion | the ragdoll continues the running pose without a pop, then collapses |
| RH-F6-defenderRun-25 | — | upright at about 12.5° lean through 2.8 s |
| RH-F6-twoArm | oblique | D upright and wrapping at 0.45 s (the first implementation's pre-contact dive is gone); R ragdolled at 0.95 s while D holds |

Earlier session: standing, crouch, stagger, Fast Run side at 0.25×, invalid-surface obstacle.

No GIF was saved. Visual acceptance is the user's.

## Tests (`tests/ride-height.test.ts`, 23)

New in this round:
- **Split unit test:** pivot ≤ body weight, excess through the COM; the superseded `atPivot` keeps all of it.
- **Force-application test** (sprint, load, defender run):
  - the suspension lever equals the legacy balance lever (calibrated pivot);
  - Fp + Fm = F, Fp ≤ W, Fm = max(0, F − W);
  - the torque is horizontal and ≤ Fp · lever;
  - the balance cap is the nominal one while active;
  - the trace carries Fp, Fm and T.
- **Isolated defender:** 4 phases, supported throughout, no contact, more than 5 strides, peak lean under 15°.
- **Defeat cases:** collision (R and D), two-arm (R), one-arm (R), both side hits (R) and both 14° leans lose support.
- **RH-F4-kickUp:** checks zero force and authority on every tick fully beyond travel.

The rest are unchanged: force law, probe, stance and target, clip model, F1/F2, lengths and penetration, F3, F4, F5, F6 pairs, F7, F8.

## Commands (actually run, this round)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | no errors |
| Tests | `npm test` | 159 passed (136 before 06a + 23 RH), 0 failed |
| Build | `npm run build` | ok; chunk-size warning only (Rapier WASM inlined, as before) |
| Evidence | `npm run fixtures` | 179 fixtures. The 143 pre-existing `evidence/summary.json` entries are byte-identical to HEAD; 36 RH entries were added. |
| Tracking | `npx vite-node scripts/probe/rh-probe.ts [id regex]` | RH-F1–F5, F7 tables |
| Lone defender | `npx vite-node scripts/probe/rh-defender.ts` | adopted vs first implementation vs decision 1 alone vs legacy |
| Defeat cases | `npx vite-node scripts/probe/rh-defeat.ts [rh id regex]` | adopted vs first implementation vs legacy; peak lean, pivot torque, COM share |
| Legacy vs suspension | `npx vite-node scripts/probe/rh-compare.ts [rh id regex]` | RH-F6 / F3 pairs |
| Attribution | `npx vite-node scripts/probe/rh-variant.ts <rh id>` | bob, height, force application, superseded models |
| Baseline / standing sweep | `rh-baseline.ts`, `rh-stand-sweep.ts` | reproduced baseline, standing height |

## Files

New:
- `src/sim/support.ts`: support law, probe classification, target composition, force split, runtime state;
- `src/sim/fixtures/ride-height.ts`;
- `tests/ride-height.test.ts`;
- `scripts/probe/rh-*.ts`.

Changed:
- `physics.ts`: guard, collision groups, probe.
- `profiles.ts`: `SUPPORT_LEGACY`, `SUSPENSION_RH` with `balanceCeiling` and `application`.
- `simulation.ts`: probe, force split at the calibrated pivot, authority and balance ceiling, collapse rule, falling switch, reset, lean, trace `sup`.
- `pose.ts`: ground-relative legs.
- `motors.ts`: authority scale.
- `contracts.ts` and `controllers/base.ts`: `StanceRequest`.
- `fixture.ts`.
- `fixtures/index.ts`.
- `lab/main.ts`: RH group and support line with the split.

## Unresolved artifacts

1. **Load-release rebound (RH-F4-load).** After a 3 kN load that bottoms the suspension, release launches the root 0.32 m above standing. That is the stored spring and damper response at the 3.5 BW ceiling. It is physical for this proxy but not a human response. Not addressed.
2. **Changed tackle outcomes vs legacy.**
   - two-arm: D holds and stays up;
   - one-arm: D falls late and its candidate is rejected for `hingeLimit`, a new rejection reason in this drill;
   - slow-line attempt: both stay up;
   - side-recover: R falls later.

   All follow from the adopted model; candidate placement is not in scope.
3. **Drive authority stays load-limited:** −18 % mean drive cap while running (decision 1: assess separately).
4. **Attenuated bob** (decision 2) and **truncated harmonics:** Fast Run's 4th harmonic (6.3 mm) is dropped.
5. **Stance IK residual near toe-off:** p95 3.5–4.5 cm. Stance gaps are not plants (plan 07).
6. **Visual flight is supported** (decision 5).
7. **Inertia** equals legacy only to float32 rounding (≤ 1e-6 relative).
