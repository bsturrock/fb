# Gate 3 handoff — balance, finite upright control, loss of support

Date: 2026-11-02. Status: G3-A..C implemented. 16 Gate 3 tests pass alongside 17 Gate 1 and 12 Gate 2 tests. Visual review used stepped stills, plus four stills sampled during 1× playback. Continuous normal-speed motion was not watched (see R6).

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | no errors |
| Tests | `npx vitest run` | 45 passed (17 G1 + 12 G2 + 16 G3), 0 failed |
| Evidence export | `npm run fixtures` | 89 fixtures, all `duration`; `evidence/traces/<id>.json`, `evidence/summary.json` |
| Production build | `npm run build` | ok (chunk-size warning: Rapier WASM inlined) |
| Gate 3 summary | `npx vite-node scripts/probe/sum3.ts` | table below |
| Per-tick balance | `npx vite-node scripts/probe/bal.ts <id\|f2:deg[:radius]> [every]` | lean/rate/projected/torque rows |
| Post-loss arms | `npx vite-node scripts/probe/post3.ts <id>[-balanced] [every]` | grips, ledger, drive per tick |
| Finish trace | `npx vite-node scripts/probe/fin3.ts <id> [every]` | finish mode, arms, wrap status |
| Posture trace | `npx vite-node scripts/probe/post10.ts <id> [every]` | requested/desired/actual lean |
| Lab | `npm run dev`, http://127.0.0.1:5197/ | `?fixture=<id>&t=<s>&cam=side\|front\|oblique\|overhead&zoom=<k>` |

Versions are unchanged: three 0.170.0, rapier3d-compat 0.21.0, vite 6.4.5, vitest 3.2.7, TypeScript 5.9.3, Node 26.9.0. Schema `tackling-v1.1`. Profiles:

- Stance `stance-g3-free` (no rotation lock).
- Balance `balance-g3-v1`: kp 1200, kd 220, max 240 N·m, combined ceiling 300 N·m, look-ahead 0.18 s, thresholds 25/55/70°, confirm 2 substeps, posture ≤ 12° at 30°/s, falling arm budget 0.35.
- Declared variant `balance-g3-v1-cap70` (max 168 N·m).
- Body `upperBodyCompound/100kg-std-sr25` (see Decisions 1).
- Solver unchanged at `solver-g1-1x60`: one 1/60 s substep. The optional 2×1/120 s was not needed.

Every export carries the balance profile, body profile (including the support radius), stance and solver.

## Files

- `src/sim/balance.ts` (new): pure mechanics. Lean measurement, projected lean, envelope step with confirmation counter, available torque `min(max, m·g·r)`, desired-up from posture, PD balance torque with cap, combined support ceiling, drive lean scale.
- `src/sim/simulation.ts`:
  - Balance runtime per player and posture desired-up rate limit.
  - Support torque, with the balance and yaw motors combined under 300 N·m and applied only while supported.
  - Envelope evaluation after the arms postStep. The `lossOfSupport` event is applied as `controlMode → falling` at the start of the next substep.
  - Support friction passive while falling; `initialLean` and `diagnosticImpulse` at reset only.
  - Snapshot `balance`; trace `lean {deg, rate, proj, tauB, tauReq, s, cnt, post, dev}`.
  - The only orientation writes are reset-time placement and initial lean.
- `src/sim/arms.ts`: falling owner rules:
  - intent frozen; no voluntary release, pull shortening or new grips;
  - clamps survive only on the same contact patch;
  - owner budget × 0.35.
- `src/sim/profiles.ts`: `STANCE_G3_FREE`, `BalanceProfile`, `BALANCE_G3`, `supportRadiusM` body variant.
- `src/sim/contracts.ts`: `BalanceState`, snapshot `balance`; `PostureIntent` (bounded lean request).
- `src/sim/fixture.ts`: initial `leanDeg`/`leanDirWorld`, `diagnosticImpulse`, fixture `balance`.
- `src/sim/controllers/base.ts`: scripted `posture` segments.
- `src/sim/controllers/wrap.ts`: section 9.1 finish requests:
  - drive along an explicit field direction while matching the runner across it;
  - one-arm lateral reposition toward the free arm;
  - facing adjustment when progress stalls;
  - recover/pursue when contact is lost;
  - the `removeAfterConnect` control.
  - It reads only snapshot observations: own arm retention and body contacts, never wrap status.
- `src/sim/fixtures/gate3.ts` (new); `src/sim/fixtures/index.ts`.
- `src/sim/pose.ts`: visual ankle kept ≥ 0.10 m above the floor when tilted or lying down (presentation only).
- `src/lab/{main,views}.ts`, `index.html`: balance overlay and info panel (below). The stale hand-request marker is hidden while the owner falls.
- `tests/gate3.test.ts` (new); `scripts/probe/{bal,sweep3,one3,exp3,balvar,post3,fin3,post10,sum3}.ts`.

Lab (toggle `overlays`):

- Arrows from each COM: white = world up; actual body up, coloured green → red as projected lean approaches the 55° envelope; blue = rate-limited desired posture up.
- Tag: lean, projected lean, FALLING.
- Info panel per player:
  - lean, outward rate, projected lean, with thresholds and confirmation counter;
  - supporting contact, control mode, posture desired/max;
  - balance torque requested → applied / cap with SAT; yaw torque; combined |τ| / 300 and scale;
  - drive lean scale;
  - loss time, reason, lean and projected lean.

## Fixture results (`scripts/probe/sum3.ts`; peak lean while supported)

| Fixture | Peak lean (supported) | Peak balance τ | Loss |
| --- | --- | --- | --- |
| G3-F1 rest 5 s, run 5 m/s, brake | R 0.02° | 1 | none |
| G3-F2 10° initial lean | R 10.0° → < 5° at 0.50 s | 209 | none |
| G3-F2-sr16 (spec radius 0.16) | R 10.0° → < 5° at 0.70 s | 157 (cap) | none |
| G3-F2-sr16-14deg | R 37.5° | 157 (cap) | R 0.467 s recoveryEnvelope 37.5°/57.8° |
| G3-F3-side-recover (runner 2 m/s) | D 12.2°, R 14.5° | 240 | none |
| G3-F3-side-loss (runner 4 m/s) | D 12.0°, R 40.1° | 240 | R 0.917 s recoveryEnvelope 40.1°/59.4° |
| G3-F3-collision-headOn (5 m/s) | 4.9° / 4.9° | 240 | none (flush hits barely tip) |
| G3-F5-cap240 / cap168 (14° start) | 14.0° / 39.3° | 240 / 168 | none / R 0.517 s recoveryEnvelope 39.3°/59.9° |
| G3-F9-sustained / removed | D 6.2° / 0.2° | 108 / 31 | none |
| G3-F9-partial-improve / fail | D 6.3° / 9.1° | 102 / 151 | none |
| G3-F10-lean0 / 6 / 12 | D 2.9° / 3.8° / 5.6° | 79 / 79 / 132 | none |
| G2-F5-balanced (wrap) | D 1.1°, R 2.7° | 57 | none, wrapped |
| G2-F8-balanced (two palms, runner escapes) | D 30.0° | 240 | D 1.133 s recoveryEnvelope 30.0°/61.5° |
| G2-F2-balanced (one palm) | D 38.7° | 240 | D 1.517 s recoveryEnvelope 38.7°/59.8° |
| G2-F4-balanced | D 37.0° (leaning on the runner) | 240 | none |
| G2-F7 / F10 / F11 / F12 balanced | ≤ 8.1° | ≤ 173 | none |

The balanced reruns of Gate 2 fixtures are reported here as separate results. They are not compared to the locked runs as if nothing changed. The locked Gate 1/2 fixtures still reproduce under their preserved profiles: 29/29 earlier tests pass.

## Rubric

| ID | Grade | Evidence |
| --- | --- | --- |
| G3-R1 Finite upright authority | 2 | Source: the free stance has no `enabledRotations` lock; the only orientation writes are reset placement and initial lean. Torque law: `min(240, m·g·r)` cap; the 300 N·m combined ceiling with yaw is checked every substep in every Gate 3 test (`motorBounds`). F1: rest lean < 2° (measured 0.0°), no vertical launch (< 0.05 m), no nonfinite state. F2: 10° recovers below 5° at 0.50 s with no later rise above 5°; pitch/roll angular velocity > 0.1 rad/s proves the axis is free; torque decays to < 20 N·m. |
| G3-R2 Valid loss calculation | 2 | F4 unit tests: radians/degrees; 24.9/25.1, 54.9/55.1 and 69.9/70.1° boundaries; 2-substep confirmation and counter reset; inward rate does not inflate projected lean; zero tilt, pure yaw and yaw on top of tilt stay finite and never lose support. F3 event: projected = lean + max(0, rate)·0.18 reproduced from the logged fields. |
| G3-R3 Causal mechanics | 2 | F3: the same profiles and controllers; only runner speed differs (2 vs 4 m/s), giving recover vs loss. F5: only `maxBalanceTorqueNm` differs (fixture JSON equal otherwise); 168 binds from the first tick and loses support, 240 recovers. F6: a balanced wrap (G2-F5) gives no loss; an unwrapped side collision gives loss under the same criterion. F2-sr16-14deg: a 157 N·m cap below the gravity torque falls. |
| G3-R4 Symmetric capabilities | 2 | Defender loses support in G2-F8-balanced and G2-F2-balanced; runner loses support in F3/F5. It is the same code path and the same event fields (checked in test). |
| G3-R5 Correct post-loss execution | 2 | While falling: drive and support torque are 0 every substep; posture and yaw are off; support friction is passive. Falling arms do no pull shortening (desired grip length never decreases after loss) and create no new grips; allocation is ≤ 350 N per owner, with passive retention present (175 + 175 N). Both grips then release through the normal `invalidPose` check at 1.167 s. The runner keeps driving (> 100 N) and stays supported. |
| G3-R6 Visible correspondence | 2 (stepped stills) / U (normal-speed rhythm) | Stills follow below. |
| G3-R7 Reproduction / regression | 2 | F8 resets ×2 for F3-side-loss and G2-F8-balanced: identical events/traces; supported mode, counter 0, no pending loss, no grips after reset. 30 vs 120 Hz display: identical traces and events. Eight balanced Gate 2 reruns complete (above). Exports carry the profiles; tsc, tests, fixtures export and build all ran. |
| G3-R8 Football finish remains a contest | 2 | F9 sustained vs removed: identical traces until first clamp (0.70 s). Removed: drive cap 0, no arm ledger after connection, runner ends at z 0.15. Sustained: bounded drive ≤ cap (up to ~840 N) plus closure, wrapped from 0.77 s, runner pushed to z 0.93, but the runner's 3 m/s escape breaks the wrap and both runners end at x ≈ 6. F9 partial: a one-arm start in both cases. Improve: reposition then re-wrap at 1.70 s, runner carried to z 1.47. Fail: the runner accelerates at 1.1 s, the single clamp slips, it never wraps. Palm speed ≤ 4 m/s in the owner frame and reach ≤ 0.72 m every substep (no paired snap). F10: desired posture is exactly 0/6/12° (bounded). Actual lean stays at 2.9/3.8/5.6° while engaged (opposed by contact; deviation up to 11.3°). Runner push-back and cut requests stay active. Projected lean equals the world-lean formula on every row. |

Stills behind R6:

- G3-F2 side view at t = 0.02 / 0.30 / 1.00: tilt 9.9° → 6.9° → 2.1° visible.
- G3-F3-side-loss:
  - side view at 0.95 s: runner 44°, FALLING;
  - oblique view at 0.80 / 1.00 / 1.60 s (rolls past horizontal, see Limitations);
  - side view at 2.5 s, lying.
- G2-F8-balanced front view at 1.10 / 1.25 / 1.60 s: defender leans 24° on two grips, falls at 52° with grips released, lies face down.
- G3-F9-sustained oblique view at 1.0 s: two clamps, upright bodies.
- G3-F9-partial-fail overhead view at 1.5 s: one clamp; the free arm reaches while the defender repositions.
- G3-F10-lean12 front view at 1.4 s: the blue desired-up arrow leads the actual up.
- In every inspected still, body tilt matches the proxy (the mesh renders the full rotation) and the arms stay on achieved geometry.
- Four stills were taken during 1× playback of G3-F3-side-loss (t ≈ 0.1 / 0.36 / 0.62 / 0.86 s). Continuous normal-speed motion and recovery rhythm were not watched: U.

No hard failure observed:

- orientation is never overwritten in balanced mode;
- torque is capped;
- no outcome trigger exists (loss comes only from the envelope on measured motion);
- no extra impulse (the diagnostic impulse exists but is unused in canonical fixtures and is logged when used);
- a fall is never declared a completed tackle;
- grips are released by the normal checks;
- no controller touches an opponent;
- wrap status is read by no force path or controller (test greps the source).

## Decisions for you

1. **Support radius 0.16 → 0.25 m (canonical body).** At 0.16 m, `m·g·r` = 157 N·m holds only about 10.3° of static lean. That is below the spec's own 12° posture bound, so the configured 240 N·m maximum can never bind. The comparison fixtures (G3-F2-sr16, -sr16-14deg) keep 0.16. Options:
   - (a) keep 0.25 (current);
   - (b) keep 0.16 and lower the posture maximum to about 9°;
   - (c) keep 0.16 and accept that 12° posture requests self-topple.
2. **Posture gravity hold (deviation from the spec torque formula).** A pure PD settles at Kp·θd / (Kp − m·g·L), which is 3.7× the request, so a 12° posture settled near 44° and fell. I added the feed-forward `m·g·L·sin θd` back toward upright, inside the same cap. It is zero when the target is upright. Options:
   - (a) keep it;
   - (b) drop posture requests;
   - (c) raise kp instead (still biased).
3. **Drive at the COM means running and braking create no pitch.** In F1 the lean stays at 0.02° through 5 m/s acceleration and braking. Contact above the COM tilts pushers backward; posture partly counteracts this. Options:
   - (a) keep (simple, stable);
   - (b) apply drive at the support contact so acceleration and braking pitch the body and the balance motor must catch it. Gate 1 numbers would change.
4. **F9 "requests removed" = locomotion effort 0 plus arm release.** With drive as the only horizontal ground force, the defender then coasts (no passive ground friction while supported). An alternative control is "request zero velocity" (active braking).
5. **Finish direction** is an explicit fixture parameter (+Z, across the runner's path).

## Limitations / open items

- **The falling proxy is a single rigid compound.** After loss it can roll past horizontal: F3-side-loss reaches 105° at 1.6 s before settling at about 84°. Visual legs then fold against the floor clamp. Gate 4's ragdoll handoff replaces this.
- **Head-on flush collisions barely tip either player** (≤ 5°), so the recover/loss pair uses a side hit at shoulder height from a defender leaning 12°.
- **No traction pitch** (Decisions 3). Feet are visual; the floor clamp has no physical effect.
- **Palm endpoint speed in the owner frame** exceeds 4 m/s by at most 1.3e−5 m/s once pitch/roll are free (floating-point rounding). The test tolerance is relative 1e−5.
- **Runner arms are still visual only** (Gate 2 R7 open item, your call).
- **Normal-speed playback was not watched continuously** (R6 U).

## Reproduce the least attractive case

`http://127.0.0.1:5197/?fixture=G3-F3-side-loss&t=1.6&cam=oblique&zoom=0.6` shows the runner after loss tumbling past horizontal (head down) as one rigid proxy. Headless: `npx vite-node scripts/probe/bal.ts G3-F3-side-loss 3`.
