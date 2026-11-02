# Gate 2 handoff — reach, breakable grips, forearm clamps, two-arm wrap

Date: 2026-11-02. Status: G2-A..D implemented; 12 Gate 2 tests pass alongside the 17 Gate 1 tests. Visual review: stills and stepped frames only (see R3, R7).

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | no errors |
| Tests | `npx vitest run` | 29 passed (17 Gate 1 + 12 Gate 2), 0 failed |
| Evidence export | `npm run fixtures` | Gate 1 + 20 Gate 2 fixtures, all `duration`; `evidence/traces/<id>.json`, `evidence/summary.json` |
| Production build | `npm run build` | ok (chunk-size warning: Rapier WASM inlined) |
| Force audit | `npx vite-node scripts/probe/ledger.ts <ids…>` | table below |
| Per-tick arm trace | `npx vite-node scripts/probe/arm.ts <id> [every]` | events + palm/arm summary |
| Lab | `npm run dev`, http://127.0.0.1:5197/ | `?fixture=<id>&t=<s>&cam=side\|front\|oblique\|overhead&zoom=<k>` |

Versions unchanged from Gate 1 (three 0.170.0, rapier3d-compat 0.21.0, vite 6.4.5, vitest 3.2.7, TypeScript 5.9.3, Node 26.9.0). Schema `tackling-v1.1`. Arm profile `arm-g2-v1` (declared variants `arm-g2-v1-cap350`, `arm-g2-v1-mu03`).

## Files

- `src/sim/arms.ts` (new) — the arm authority: collision-aware reach (palm sweep ≤ 0.02 m per check with bisection + one slide; relative body motion replayed against the palm), two-bone pose with fixed lengths and pose validity, palm surface holds (grips), forearm clamps (normal law + compliant friction with elastic memory), shared per-owner vector budget, reciprocal force pairs, release reasons, re-arm rule, wrap classification, force ledger.
- `src/sim/profiles.ts` — `ArmProfile`, `ARM_G2`, `ArmSetup`.
- `src/sim/simulation.ts` — arm stage 6 (preStep) and stage 9/10 (postStep); arms + wrap in snapshot, trace rows and fixture export.
- `src/sim/contracts.ts` — snapshot `arms`, `wrap`.
- `src/sim/controllers/base.ts` — scripted arm segments (`focus`/`self`/`world` frames).
- `src/sim/controllers/wrap.ts` (new) — `WrapAttemptController`: per-arm ready → spread → arc → close → sustain (+ recover); `palmFlank` plan; requests only, phases advance on observed hand position / clamp contact.
- `src/sim/fixtures/gate2.ts` (new) — F1–F12 (20 fixtures).
- `src/sim/pose.ts` — accepts achieved arms (shoulder/elbow/wrist/palm); hand mesh centred one palm radius inside the palm landmark.
- `src/lab/{main,views}.ts`, `index.html` — achieved arms rendered from `ArmSystem.obs()`, re-expressed in the interpolated body frame; overlays (below); `front` camera, `zoom`.
- `tests/gate2.test.ts` (new); `scripts/probe/{arm,ledger,f6sweep,shapeq,res}.ts`.

Lab overlays (toggle `overlays`): yellow = requested hand target + line from the achieved palm; green = achieved palm landmark; magenta = grip anchor + outward normal, palm→anchor link whitening→red with tension/ceiling; orange = clamp contact + normal force arrow (1/1000 m per N), cyan = clamp friction arrow and wrap azimuth ray from the runner's centre. Per-hand tag: phase, grip/clamp, actual force. Info panel per arm: mode, phase/action, pose validity, grip ID, raw/actual tension, allocated capacity, overload exposure, clamp N / friction / cap / xT, last release reason; owner budget (demand, scale, actual / 1000 N); wrap status, azimuths, failing reasons.

## Force audit (from `scripts/probe/ledger.ts`)

| Fixture | Max owner sum (N) | Min shared scale | Pair sum | Friction over μN | Wrap statuses | Releases |
| --- | --- | --- | --- | --- | --- | --- |
| G2-F2 | 564 | 1.000 | 0 | — | noHold, oneArmHold | — |
| G2-F3-separation | 700 | 1.000 | 0 | — | oneArmHold | 0.950 unreachable |
| G2-F3-overload (cap 350) | 350 | 1.000 | 0 | — | oneArmHold | 1.250 overload |
| G2-F3-turn | 618 | 1.000 | 0 | — | oneArmHold | 0.817 invalidPose |
| G2-F3-reacquire | 0.01 | 1.000 | 0 | — | oneArmHold | 0.800 voluntary |
| G2-F4 | 302 | 1.000 | 0 | — | twoArmHold (±17°) | — |
| G2-F5 | 597 | 1.000 | 0 | 0 | wrapped from 0.767 s (az −98/+111) | — |
| G2-F6-separation (0.35 m) | 231 | 1.000 | 0 | 0 | oneArmHold, twoArmHold | — |
| G2-F6-far (0.45 m) | 0 | — | — | — | noHold only | — |
| G2-F7 | 729 | 1.000 | 0 | 0 | wrapped → oneArmHold/twoArmHold | right clamp slips first (1.43 s…), left later (1.57 s) |
| G2-F8 | 1000 | 0.714 | 0 | — | twoArmHold | both overload at 1.183 |
| G2-F8-mixed | 401 | 1.000 | 0 | 0 | twoArmHold (clamp + grip) | — |
| G2-F10 / -noClose | 597 / 0 | 1.000 | 0 | 0 | wrapped / noHold only | — |
| G2-F11 (μ 0.8) / mu0.3 | 597 / 594 | 1.000 | 0 | 0 | both wrapped then slip | last clamp 1.83 s / 1.73 s |
| G2-F12 | 668 | 1.000 | 0 | 0 | wrapped ↔ twoArmHold, re-closes | — |

Reverse player/arm evaluation order (F8): max |raw/actual/allocated| difference 8.0e−6 N (F8) and 3.4e−2 N (F8-mixed); identical release events.

## Rubric

| ID | Grade | Evidence |
| --- | --- | --- |
| G2-R1 Reach and real acquisition | 2 | F1 test: palm ≤ 0.72 m from the shoulder, endpoint speed ≤ 4 m/s in the owner frame, pose valid every substep, beyond-reach request stays > 0.5 m unmet, far-side request never gets behind the runner, grip rejected (palm not facing) and never created. F2: grip born at palm gap ≤ tolerance on an eligible region. Inspected stills: F1 t=1.3 (side; full extension, yellow request unmet) and t=2.0 (overhead + colliders, oblique; palm on the flank, request behind the runner); F2 t=1.2 (overhead; anchor, link, 520 N). |
| G2-R2 Finite reciprocal hold | 2 | F2 vs control: identical until the grip forms (pos diff < 1e−9), then the runner drags the defender > 0.5 m and ends > 0.5 m behind the control; tension ≤ 700 N. Every ledger entry: force pair sums to 0, actual ≤ allocation. F8: shared scale 0.714, owner sum capped at 1000 N. |
| G2-R3 Physical failure/recovery | 2 (numeric) / U (F3 motion) | F3: unreachable, overload (declared variant), invalidPose, voluntary releases; force stops at release, per-tick velocity change < 0.25 m/s at release; no regrip while touching, re-arm only after withdrawal (2.2 s). F7 still inspected at 1.55 s (wrap degraded, two independent clamps, arms outside the body). F3 releases not inspected visually. |
| G2-R4 Actual wrapping | 2 | F4 two front palms = twoArmHold, never wrapped. F5/F10 wrapped only with clamp N > 1 N on both arms, opposite azimuth signs, both ≥ 55°, no grips involved. F6 worse geometry: partial (0.35 m) or miss (0.45 m), never wrapped. F5 inspected at t=1.0 in front, side, overhead (± colliders) and oblique views; stepped frames 0.5/0.6/0.7/0.8 s (oblique) and 0.8 s overhead/front with overlays off: forearms run outside the runner box along both sides, contacts on the far face. |
| G2-R5 Independent arms / shared effort | 2 | F7: wrap degrades to oneArmHold with exactly one pressing clamp, never straight to noHold. F8 shared budget. F8-mixed: clamp + grip share the owner budget. No paired state exists in the code (each arm has its own phase, contact, release). |
| G2-R6 Reproducibility / integration | 2 | F5 reset ×3: identical events and traces, zero grips/ledger after reset, collider tag count unchanged (no orphans). 30 vs 120 Hz display: identical traces. F9 sweep at 8 m/s: palm carried ahead of the runner, never inside the torso footprint, pose valid every substep. Gate 1 17/17 still pass. |
| G2-R7 Presentation agreement | 1 | Defender arms are drawn from the achieved solve (same shoulder/elbow/wrist/palm), visual radii within 3 mm of the query capsules, hand centred inside the palm landmark; stills match in every inspected view. Not met: the runner's arms are visual-only (no collider, no arm system) and visibly overlap the tackler's forearm in F2 t=1.2 and F1 t=2.0. Normal-speed playback not watched (U). |
| G2-R8 Forearm clamp causality | 2 | F10: closing effort 0 gives zero ledger entries, no clamp, noHold; body contact remains. F11: friction ≤ μN + 0.01 every entry, xT ≤ μ·Nreq/kT, zero normal ⇒ zero friction, retention ends by contactLost; μ 0.3 releases earlier (1.73 vs 1.83 s) and the runner ends 0.24 m further. No palm attachment in clamp mode (no grip events). |
| G2-R9 Continued independent execution | 2 | F12: wrap → partial → re-closed wrap several times (wrapStatus 1.27, 1.65, 1.68, 1.70 s); one arm presses alone on some ticks; > 2 clampBegin events. Failed improvement: F7 (right clamp re-closes and slips repeatedly, left later lost) and F11-mu0.3. |

No hard failure observed: no grip without contact (all births at gap ≤ tolerance), no through-body acquisition (F1/F9), force bounded by per-arm and owner caps, no tether (holds release beyond reach + tolerance), no outcome roll or paired lock, wrap status is observation only (no force path reads it), budget shared per owner, both players keep moving.

## Limitations / open items

- **Runner arms are visual only** (R7 = 1). They are not obstacles for the tackler's query arms, so the two can overlap on screen. Options: (a) accept until Gate 4's ten-body ragdoll gives the runner physical arms; (b) add the runner's arms as query obstacles now (arm-vs-arm is outside the Gate 2 spec); (c) pose the runner's visual arms away from opponent forearms (presentation only). This is your call.
- Single-arm overload cannot occur with the 700 N default (reach is lost first), so G2-F3-overload uses the declared 350 N variant.
- The F6 "offset" variant was dropped: separations ≤ 0.30 m still wrap; 0.35 m gives a partial hold and 0.45 m a miss.
- Pitch/roll stay locked; legs and feet are visual; clamp friction is the compliant model (xT memory), not Rapier friction.
- Exposure is per arm and is a slip proxy, not a tackle meter.

## Reproduce the least attractive case

`http://127.0.0.1:5197/?fixture=G2-F7&t=1.55&cam=overhead&zoom=0.3` — runner accelerates and turns away at 1.2 s; the right clamp slips and re-closes repeatedly before both arms lose contact. Headless: `npx vite-node scripts/probe/arm.ts G2-F7 3`.
