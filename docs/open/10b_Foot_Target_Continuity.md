# 10b — Foot target continuity

Repository-aligned plan • 2026-11-08 • Not started. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first. Follows [10a](10a_Test_Gate_and_Evidence_Integrity.md).

**Goal:** the composed foot planner publishes targets with continuous motion inside an ownership as well as across it, with step state that matches what was published. The [08 closeout](08_Review_Closeout.md) contracts stay in force: same-time 1 cm composition limit, planner vertical speed and follow-offset recovery at most 1.5 m/s, and no snapping to the destination when a timer expires.

**Summary impact:** L3 summaries and the L4 fixtures built from L3 change; record each. The 238 committed summaries stay unchanged, except under B7 if the user rules (U3).

## B1. Composed steps stop dead when the late stretch expires (P2, Checked)

**Problem:** in `advanceStep` (`src/sim/footwork.ts`):

- `quinticStep` returns `{ p: dest, v: 0, a: 0 }` whenever `T <= dt` (1293).
- Once `remainS <= 0`, `horizonS = max(lateS, dt)` (1355).
- `lateS` is re-armed to `C.arriveS` only when the destination is at least 1 mm away, and counts down every substep (1354, 1356).

When it runs out with the foot still moving, for example after the speed cap held it back, the target jumps to the destination and its velocity is zeroed in one substep.

**Evidence (code checked; numbers Reported):**

- `L3-F3-side`, D left foot, 0.0583 s: target speed 20.51 m/s to 0.00, second difference 8.55 cm.
- Also R 0.2708 s (8.1 cm), D left 0.3333 s (8.0 cm), `L3-F1-phase0` 0.6708 s (4.1 cm).
- 156 substeps with a target second difference over 1 cm across `L3-F3-side`, `L3-F1-phase0`, `L3-F16-runStop`, `L3-F7-phase0` and `L3-F14-walkRunStop`; 62 of them in the late stretch.

**Why the audit misses it:**

- The owner does not change, so no boundary is compared.
- `stepStopM` (`src/sim/simulation.ts:1884-1886`) builds the old reference with the same instant stop.
- This is very likely the "unexplained 20.89 m/s" ankle peak in the plan 08 handoff.

**Fix:**

- Never let the quintic horizon fall to one substep while the foot is moving or the speed cap is active. Keep `lateS` armed while capped, or bound the horizon below by |v| / aMax.
- Arrive at rest only when both distance and speed are below declared epsilons.
- Keep `stepV`/`stepA` consistent with the accepted motion.
- If the destination is unreachable within the caps, use the existing explicit release/failure path rather than a snap.
- Correct the `stepStopM` reference at its source.

Declare aMax in the footwork profile, derived from the existing swing limits, and justify it in the handoff; do not take it from current output.

**Regression:**

- A per-owner bound on the step target's second difference at every substep of every L3 fixture.
- The four reproductions above.
- Record which audit corrections disappear once the reference is fixed.

## B2. Composed steps keep a stale vertical velocity (P2, Checked)

**Problem:** the composed branch of `advanceStep` writes `f.stepV = v3(x.v, f.stepV.y, z.v)` and the same for `stepA` (`src/sim/footwork.ts:1379-1384`), so y is carried forward. The published y comes from the lift-rate clamp (1403). `stepV.y` is rewritten only in the `why === 'continue'` branch (1404–1412); every other composed step keeps its seed `ankleV.y` from `seedStep` (718) for life.

**Who reads the stale value:** `canFollow` (550, the handover decision), `chase` (587, its vertical quintic seed), and the lift damper (757, and `startStep` 1185).

**Evidence (Reported):**

- `L3-F1-phase6`, D right, 1.1417 s, liftoff: stored 2.140 m/s while the published target moves at −1.041 m/s.
- `L3-F9-noProbe-exit`, D left, 0.6875 s chase start: the target's vertical rate flips by about 0.95 m/s in one substep (about 230 m/s²).
- 11 chase starts affected across F1, F3, F9, F16-runStop and F16-kick.

**Fix:** after computing y, always set `stepV.y = (y − prev.y) / dt`, and `stepA.y` from it (0 when the lift clamp held), as the horizontal cap branch already does. Prefer separate horizontal and vertical step state so a partial write cannot recur ([10f F10](10f_Cleanup_and_Module_Structure.md#f10-split-footworkts-change)).

**Regression:**

- At every substep, stored `stepV.y` equals the published vertical rate within epsilon.
- No chase start flips vertical rate beyond the declared lift acceleration.

## B3. Unbounded leg-request jump at contact entry (P3, Reported)

**Problem:** in every `L3-F7` variant at 0.575 s (prep to contact), the sampled clip leg request has a 1.06–1.75 cm second difference in one substep (about 600–1000 m/s²). It is identical in the old and new compositions (sampler weight 1.000, same speed and phase), so the audit correction at `src/sim/simulation.ts:1879-1883` is valid for the comparison. 16 boundaries in `L3-F1-phase0`–`phase3` and `L3-F7-*` pass only through that correction (raw 1.01–2.17 cm). Example: `L3-F1-phase2`, D, 1.2875 s: raw 2.17, delta 0.40, jump 2.18 cm.

**Problem with that:** the shared snap itself is unbounded and its source is not established. It may be the impact velocity feeding `strideScale` (unverified). Nothing tests it, and the handoff does not mention it.

**Fix:** find the source and bound it at that source. Keep the audit correction.

**Regression:** a per-substep check on the leg request's own second difference.

## B4. The walk ramp is skipped outside free mode (P3, Checked)

**Problem:** `rampWalkRequest` (`src/sim/simulation.ts:1959-1976`) ramps only when `pl.loco.mode === 'free'`; in prep, contact and exit the request passes through unramped. It also reads `pl.loco.mode` before `advanceLocoMode` updates it later in the substep, so it uses last substep's mode.

**Fix:** the closeout kept the contact and run bypass on purpose. Confirm against plan 08 whether prep and exit belong to that bypass. If not, ramp in prep and exit. Read the mode after it is decided.

**Regression:** a request change issued during prep or exit, with ramp progress asserted on return to free.

## B5. Hard-coded hip half-width and a duplicated stance fade (P3, Checked)

**Problem:** `HIP_HALF_WIDTH_M = 0.1125` (`src/sim/locomotion.ts:62`) matches only the bew-v6 body (`hipRight.x` −0.11249). On stock bodies (hip 0.13; for example `L3-F4-gripTarget`) the idle stance becomes 2·(0.13 + 0.0473) = 0.355 m instead of the fitted 0.32 m. The speed fade `1 − min(1, speed / 1.5)` is duplicated in `src/sim/pose.ts:705-708` and `src/sim/simulation.ts:2012`, with a comment saying they must agree.

**Fix:** compute the width addition at use from the body's `|hipLocal(body, s).x|`. Share one fade helper.

**Regression:** idle stance width equals the fitted width on both bodies.

## B6. `braceW` clamped without `braceV` (P3, Reported)

`advanceLoco` (`src/sim/locomotion.ts:110-143`) clamps the brace weight but leaves its rate, so the next substep integrates from a velocity the clamp has already overridden. Zero or clamp the rate with the weight.

## B7. The coached controller aims with the previous phase (P3, Reported; decision U3)

`src/sim/controllers/coached.ts:129` and `:162` compute aim and heading before the phase update at 166–200, so every phase change lags one decision interval (0.05 s by default). This file is unchanged since `736d90a`; fixing it changes committed summaries. Either fix it behind a controller option opted in on L3 and later, or fix it everywhere on the user's ruling.

## B8. Transition tests that do not establish their claims (P3)

- **`tests/transitions.test.ts:782` (Checked):** the "shifted anchor" negative control is `dist(p, p + 0.02 x) > surfaceTolM`, which is true by construction and runs no project check. Shift a real anchor and pass it through the check the retention test relies on.
- **715–786 (Reported):** `held()` measures `ArmSystem` observations, not the published pose's held-arm landmarks. They agree today to about 3e-16. Measure the pose landmarks so a pose-side displacement fails.
- **432 (Reported):** the `L3-F1` "anchors held at entry" test never asserts that a contact entry happened. Assert it.
- **795 (Reported):** audit purity compares trace positions and events on five fixtures. Also compare full trace rows and snapshots of the foot plans, sampler and pose memory, on all L3 fixtures or a stated sample.
- **1076 (Reported):** the reseed gap bound is 0.1 m, ten times the transition limit. Derive it from the contract or tighten it.
- **Minor (Reported):** `trialOf` (`src/sim/footwork.ts:555`) makes a shallow copy, and `chase` (580–590) does not refresh `moveV`. Confirm neither leaks state across the trial.

## B9. Intake script robustness (P3)

- **Checked:** `scripts/model/clip-intake.ts:80` uses `clips.find((c) => c.isWalk)!.rec`, which throws an opaque `TypeError` when the manifest lacks a walk. Throw a `RunClipError` naming the missing clip.
- **Reported:** `scripts/model/idle-intake.ts` measures stance width and forward offset on world axes, assuming the clip root faces +Z with no yaw, and takes `restLegM` from the left leg only. Measure in the root frame from both legs, or assert the assumption.

## B10. Plan 08 handoff corrections (Docs, Checked)

Update `docs/handoff/plan08.md` after B1 and B8:

- :148 and :345, "lands on arrival … with no timer": `lateS` is a timer, and it snaps (B1).
- :81, `stepStopM` described as an old-path artifact: the corrected reference applies the same snap.
- :169 and :697, the unexplained 20.89 m/s peak: B1.
- :6/:8 against :570: contradictory current results (599/597 against 600/600).
- :210, "shifted anchor" negative control: B8.

## Acceptance

- The L3 transition audit still has 0 boundaries over 1 cm, with the reference corrected at its source.
- The new per-owner second-difference check passes everywhere.
- Declared vertical and rejoin limits hold at every substep.
- Stopping time, distance, last step, failed plants and support load are reported for the stop fixtures.
- Changed L3/L4 summaries, endings and handoffs are listed in the handoff.
