# Plan 07 handoff: support recovery and contact footwork

**Follow-up ownership:** [Plan 07a](../open/07a_Ragdoll_Contact_Handoff.md) owns the remaining simultaneous-contact rejection and large contact-clearance limb corrections before plan 08. Player-below and `L2-F14-oneArmFeet` conversions currently succeed and must remain successful. Earlier rejected falls below are incoming evidence. [Plan 08](../open/08_Locomotion_Transitions_and_Tackle_Integration.md) owns ordinary transition smoothing, natural idle posture and procedural walking arm swing.

**Later disposition (2026-11-05):** the user accepted 07a and its two review fixes for commit. Required natural-contact handoffs now articulate, with 239 tests/build/238 fixtures passing and the 143 historical summaries unchanged. The 07 measurements below remain the incoming checkpoint evidence; [08](../open/08_Locomotion_Transitions_and_Tackle_Integration.md) is cleared to start.

**Date:** 2026-11-05.
**Status:** implementation accepted by independent review on 2026-11-05 for the 06a/07 checkpoint. All four closeout items pass code and numeric review: 218 tests and the build pass, all 216 fixtures regenerate, and the 143 historical summary records match HEAD. Continuous visual acceptance remains open; this is clearance to start 07a, not a claim of finished locomotion realism.

**Independent closeout review:** reproduced runStop at 0.801 m root height at the clip-to-procedural crossing, five final steps, no overlapping lifted steps or achieved two-foot flight, and a stop in 1.48 s over 3.31 m with peak deceleration 5.5 m/s². All 12 controlled stopping phases have zero overlapping lifted steps, two-foot flight, drags and failed proposals; both feet finish planted. The observed runStop has 17 confirmed and sustained plants, no failed proposals, 95% eligible-stance plant coverage per foot, and held error at most 0.99 cm. Build and fixture regeneration also pass.

**Remaining presentation work:** the clip toe-off release changes knee motion abruptly (one-tick second difference 11.8 cm in the observed stop, up to 14.4 cm in a phase variant); this is not a measured 14.4 cm teleport. Substep tracing shows continuous positions with a sharp reversal at release. Plan 08 owns smoothing ordinary clip/plant transitions, run-start quick-step transitions, final cadence and free-arm balance presentation. Plan 07a owns the much larger contact-clearance corrections and remaining simultaneous conversion rejection. No force cap or audit tolerance was changed for this review.

**Plan:** [07 — Support recovery and contact footwork](../open/07_Procedural_Contact_Footwork.md). **Incoming baseline:** [06a handoff](plan06a.md). Its numbers are unchanged and still describe the `support-suspension-rh-v1` RH fixtures.

New profile identities:

| Profile | Identity | Used by |
| --- | --- | --- |
| support | `support-suspension-rh-v2` (`SUSPENSION_L2`) = `support-suspension-rh-v1` + `recovery: { approachBrakeG: 0.5 }` | L2 fixtures without the controlled-braking profile |
| braking support | `support-suspension-rh-v3` (`SUSPENSION_L2_BRAKE`) = v2 + the bounded 0.80 m braking stance | controlled-braking L2 fixtures; details in Fix 4 |
| footwork | `footwork-l2-v2` (`FOOTWORK_L2`; v1 + travel-side lead foot and drag steps) | L2 fixtures with `footwork` |
| motor | `motor-g1-default+brake-5.5` / `motor-g1-sprint…+brake-5.5` (`withBrakingLimit`) = the fixture motor + `braking: { maxDecelMps2: 5.5 }` | L2 locomotion fixtures F1–F7, F11, F12 (not the tackle copies F8 or the repairs F13–F15) |

The RH fixtures keep `support-suspension-rh-v1` and their motors, so the 06a support evidence stays reproducible. The 143 historical `evidence/summary.json` entries are byte-identical to HEAD.

Nothing sets a root position or velocity. Bones are not stretched, and no tolerance or validation threshold was widened. Foot state never reaches physics: it is pose-only (see [Invariance](#enabled-vs-disabled-invariance)).

## Code-review closeout (implemented 2026-11-05)

### Incoming (review, before the closeout)

Independent review ran 191 tests and the build successfully and compared the 143 historical summary records against HEAD with no changes. It reproduced:

- Fast Run: 21 plant events, 11 released in the confirmation substep; runStop: 21 events, 5 such releases across the drill. Current minimum-count and surviving-plant drift checks do not establish sustained contact. Plan 07 owns confirmed touchdown semantics and duration/coverage evidence.
- A braking limit of −5.5 m/s² produces +550 N for a 100 kg player moving at +6 m/s with a zero velocity request. Infinite Sprint stance width produces six non-finite leg landmarks after a tick while the trial remains `running`. Plan 07 owns validation before physics construction, including player motor overrides.
- `RH-F5-playerBelow` still has large body-local one-tick second differences: A's right ankle 65.9 cm at 0.517 s and B's left wrist 60.6 cm at 0.667 s. Both the documented upper-player leg case and the lower-player procedural arm case belong to 07a. These are diagnostic second differences, not literal measured per-tick displacements.

After the two 07 fixes, update evidence, complete continuous visual review and checkpoint 07; then execute 07a. Player-below and one-arm-footwork conversions currently succeed and must stay successful. Simultaneous upper-arm overlap remains a real conversion failure; intentional `noRescue` validation failure remains a safety regression.

Cause of the false plants (`p07-confirm.ts --events`, before the fix): every same-substep release was a clip re-plant late in the stance, after a `reach` release. The touchdown used the previous substep's achieved ankle and gap while the hip had moved on (about 2.5 cm per substep at 6 m/s). The plant solve (roll at the toe, corner pivot) then needed a 3–8 cm soft-reach clamp and up to 8 cm of floor lift, and `observeFeet` released it in the same substep. Each such attempt also published one substep of that clamped leg before the foot rejoined the clip.

### Fix 1: plants are confirmed from the achieved pose (`footwork.ts`)

The existing path is reused: `planFeet` → `buildProxyPose` → `observeFeet`, with the same per-substep event buffer.

- **Proposal.** A touchdown (clip stance, reactive step completion, initialization) is a *proposal*: the foot is `planted` with `tentative` set and sends the plant request to this substep's solve. Nothing is emitted yet.
- **Confirmation.** `observeFeet` confirms it only when the achieved solve used the primary leg candidate (no clearance alternative), the request's soft-reach clamp is ≤ 0.01 m and the contact-feature error (horizontal error and shoe gap combined) is ≤ 0.01 m. Support and stance eligibility were checked by the planner in the same substep. Only then does it emit `footPlant` (with the achieved `errM`); the interval starts at the confirming substep.
- **Failure.** Otherwise the foot continues from the achieved ankle (rejoining its request at the bounded offset-decay rate; a reactive foot starts a new step from there) and a `footPlantFailed` event records the reason (`clearance`, `reach`, `separation`, `slide`, or a planner reason such as `supportLost` for an initialization proposal released before its solve), the anchor and the errors. No anchor, marker, `footPlant` or `footRelease` is left. The same rule applies to clip touchdowns, reactive steps and initialization.
- **No stale retries.** After a failed proposal the foot is `stale`: no new proposal until a fresh (non-plant) solve has been observed. A clip proposal also needs the anchor within the plant reach of the *current* hip (`plan.reachM`, the same limit the planner releases on); initialization needs it within the reach margin.
- **Sustained intervals.** A confirmed plant counts the solves it survives (`solves`, in `footRelease`). An interval is sustained once it survives one later solve.
- **Coverage.** Per foot, eligible stance time (clip: inside the clip stance interval at the plant contact weight; reactive: supported and not in a planner step) and its confirmed-planted part accumulate in `stats.cover`.
- **Diagnostics.** `stats` adds proposals, confirmed, failed, the largest measured failed-proposal error and sustained; `stats.plantErrM` is now over confirmed samples that kept the plant (the releasing sample's error is in its `footRelease`: `featureErrM`, and `driftM` includes it). Trace `ft.tn` marks an unconfirmed proposal (initial row only). The lab feet line shows a proposal, per-foot failures and the last failure reason, plus a plants line (confirmed / proposed, failed, sustained, eligible stance planted).

Nothing lengthens a stride, lowers the body, adds motor authority or widens a tolerance. Valid heel/toe roll, the corner pivot, bounded target motion, explicit releases and early reach releases are unchanged.

**Results** (corrected meaning; `npx vite-node scripts/probe/p07-confirm.ts`). Sustained durations are per foot, from confirmation to release (or the trial end); eligible stance planted is the confirmed-planted share of eligible stance time. Held error is the largest error of a sample that kept its plant; release-sample error is the largest error of a sample that ended one.

| Fixture (player) | Proposals | Confirmed | Failed (reasons; max err cm) | Sustained L/R | Sustained s L (min/med/max) | Sustained s R | Eligible stance planted L/R | Held err max (cm) | Release-sample err max (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L2-F1-stand (R) | 2 | 2 | 0 | 1/1 | 2.996/2.996/2.996 | 2.996/2.996/2.996 | 100% / 100% | 0.14 | — |
| L2-F1-stagger (R) | 5 | 5 | 0 | 3/2 | 0.892/1.013/1.200 | 0.692/2.608/2.608 | 100% / 100% | 0.31 | 0.31 |
| L2-F1-crouch (R) | 2 | 2 | 0 | 1/1 | 3.996/3.996/3.996 | 3.996/3.996/3.996 | 100% / 100% | 0.14 | — |
| L2-F1-crouchHandoff (R) | 2 | 2 | 0 | 1/1 | 1.500/1.500/1.500 | 1.500/1.500/1.500 | 100% / 100% | 0.14 | — |
| L2-F2-loaded (R) | 2 | 2 | 0 | 1/1 | 3.996/3.996/3.996 | 3.996/3.996/3.996 | 100% / 100% | 0.14 | — |
| L2-F3-walkStop (R) | 15 | 15 | 0 | 8/7 | 0.133/0.204/0.758 | 0.183/0.196/1.288 | 100% / 100% | 0.98 | 0.98 |
| L2-F3-runStop (R) | 16 | 16 | 0 | 8/8 | 0.075/0.125/1.321 | 0.113/0.175/1.121 | 92% / 93% | 0.99 | 1.10 |
| L2-F4-drag (R) | 12 | 12 | 0 | 7/5 | 0.204/0.204/0.642 | 0.204/0.204/1.179 | 100% / 100% | 0.60 | 0.60 |
| L2-F5-sidePosX (R) | 11 | 11 | 0 | 6/5 | 0.163/0.254/0.888 | 0.183/0.208/1.138 | 100% / 100% | 0.14 | 0.14 |
| L2-F5-sideNegX (R) | 11 | 11 | 0 | 5/6 | 0.183/0.208/1.138 | 0.163/0.254/0.888 | 100% / 100% | 0.14 | 0.14 |
| L2-F5-yawPosX (R) | 4 | 4 | 0 | 2/2 | 0.767/2.033/2.033 | 0.637/2.163/2.163 | 100% / 100% | 0.17 | 0.17 |
| L2-F5-yawNegX (R) | 4 | 4 | 0 | 2/2 | 0.637/2.163/2.163 | 0.767/2.033/2.033 | 100% / 100% | 0.17 | 0.17 |
| L2-F6-hop (R) | 10 | 10 | 0 | 5/5 | 0.150/0.204/0.588 | 0.117/0.212/0.721 | 100% / 100% | 0.99 | 0.99 |
| L2-F7-shove (R) | 7 | 7 | 0 | 4/3 | 0.096/0.929/1.092 | 0.262/1.129/1.208 | 100% / 100% | 0.14 | 0.14 |
| L2-F8-sideLoss (D) | 14 | 13 | 1 (clearance 1; 3.37) | 6/7 | 0.037/0.042/0.054 | 0.012/0.037/0.042 | 100% / 98% | 0.95 | 0.95 |
| L2-F8-sideLoss (R) | 6 | 5 | 1 (reach 1; 1.49) | 2/3 | 0.029/0.058/0.058 | 0.037/0.067/0.112 | 95% / 100% | 0.76 | 0.76 |
| L2-F8-noRescue (R) | 2 | 2 | 0 | 1/1 | 0.500/0.500/0.500 | 0.500/0.500/0.500 | 100% / 100% | 0.14 | 0.14 |
| L2-F8-outOfRange (R) | 14 | 14 | 0 | 7/7 | 0.092/0.112/0.117 | 0.046/0.113/0.171 | 100% / 100% | 1.00 | 1.00 |
| L2-F11-fastRun (R) | 9 | 9 | 0 | 5/4 | 0.038/0.088/0.092 | 0.104/0.108/0.108 | 61% / 64% | 1.00 | 1.17 |
| L2-F11-sprint (R) | 9 | 9 | 0 | 5/4 | 0.133/0.133/0.133 | 0.129/0.129/0.129 | 100% / 91% | 0.95 | 1.09 |
| L2-F12-slowForward (R) | 13 | 13 | 0 | 7/6 | 0.150/0.217/0.588 | 0.204/0.217/0.721 | 100% / 100% | 0.99 | 0.99 |
| L2-F12-slowSide (R) | 14 | 14 | 0 | 7/7 | 0.163/0.200/0.625 | 0.067/0.200/0.779 | 100% / 100% | 0.15 | 0.14 |
| L2-F12-slowBack (R) | 14 | 14 | 0 | 7/7 | 0.013/0.204/0.775 | 0.171/0.204/0.621 | 100% / 100% | 0.98 | 0.98 |
| L2-F14-oneArmFeet (D) | 3 | 3 | 0 | 1/2 | 0.158/0.158/0.158 | 0.079/0.138/0.138 | 42% / 58% | 0.97 | 1.20 |
| L2-F14-oneArmFeet (R) | 2 | 2 | 0 | 1/1 | 0.125/0.125/0.125 | 0.150/0.150/0.150 | 39% / 65% | 0.94 | 1.05 |

| Fixture | Incoming touchdown events (released in the same substep) | Proposals / confirmed / failed / sustained (closeout) |
| --- | --- | --- |
| L2-F11-fastRun | 21 (11) | 9 / 9 / 0 / 9 |
| L2-F3-runStop | 21 (5) | 16 / 16 / 0 / 16 |

- No confirmed plant is released in its confirmation substep in any footwork fixture (test), and `p07-churn.ts` reports 0 same-substep releases everywhere.
- The reach pre-check removes only infeasible proposals (`p07-precheck.ts`, pre-check off vs on): Fast Run 22 proposals, 9 confirmed, 13 failed (largest 2.19 cm) vs 9 / 9 / 0; runStop 22 / 16 / 6 (1.70 cm) vs 16 / 16 / 0; Sprint 9 / 9 / 0 both. One Fast Run right-foot plant (0.029 s) is not proposed with the pre-check (coverage 0.458 s vs 0.429 s).
- Remaining failed proposals are reactive touchdowns in contact: L2-F8-sideLoss D (clearance alternative, 3.37 cm) and R (reach, 1.49 cm). Before the closeout both were reported as plants and released at once.
- Controlled reachable stances (standing, crouch, loaded, stagger, walking and slow steps) plant 100% of their eligible stance time. Supplied running stances do not: Fast Run 61% / 64%, Sprint 100% / 91%, runStop 92% / 93%. The unplanted part is the reach-limited end of the clip stance (released on `reach`), an explicit residual, not a hidden failure.

### Fix 2: braking limits and stance widths are validated before physics

- `validateMotorBraking` (`profiles.ts`): an explicitly supplied `braking.maxDecelMps2` must be a finite number > 0; absent `braking` keeps the historical drive. It runs where the limit is authored (`withBrakingLimit`) and where motors are consumed: `Simulation` construction, before any physics body, for the fixture motor and every player motor override. There is no per-frame check.
- `validateRunClipProfile` (`run-clip.ts`, already run at construction): every `stanceWidthAddM` entry must be a finite number. Signed and zero widths stay valid (the editor's inward adjustments included).

The review's reproductions now throw before construction (`p07-validate.ts`):

- `withBrakingLimit(DEFAULT_MOTOR, -5.5)`: `withBrakingLimit: motor profile motor-g1-default+brake--5.5: braking.maxDecelMps2 must be a finite number > 0 (got -5.5)`.
- Sprint with `stanceWidthAddM: { sprint: Infinity }`: `run clip run-clips:fast-run@9d9ad0197d33+sprint@f2aa3627a75d: stanceWidthAddM.sprint must be a finite number (got Infinity)`.
- A player override with braking 0: `fixture L2-F3-runStop player R motor: motor profile motor-g1-default: braking.maxDecelMps2 must be a finite number > 0 (got 0)`.

Tests cover negative, zero, NaN and ±Infinity limits, an invalid per-player override, ±Infinity and NaN widths, valid signed/zero widths, a valid limit and absent fields (the absent-width trial is bit-identical, as before). The stop and steering force-cap tests are unchanged.

### Evidence after the closeout

**Independent review and user follow-up:** the confirmation/validation reproductions now pass, Fast Run has 9 confirmed contacts and runStop 16 with zero same-substep releases, and all 212 fixture summaries were regenerated. The user's observed hop is a separate remaining defect: both non-drag procedural steps start at 3.16667 s (clip weight 0, horizontal speed 2.88 m/s), with durations 0.200/0.215 s. Both remain lifted swings through 3.35 s (12 trace ticks). The reactive-entry loop starts a step for each following foot before the normal one-foot scheduler. The code fixes are accepted, but the requested commit is withheld until that targeted 07 repair passes review. The initial split left lower braking stance to 08; the user has now moved it into 07 item 4. Final cadence styling and free arms out for balance remain in 08.

- All 143 historical `evidence/summary.json` entries are byte-identical to HEAD.
- Against the pre-closeout evidence (regenerated from the incoming tree), only the `events` totals of four L2 entries change: L2-F3-runStop 62 → 47, L2-F8-sideLoss 87 → 85, L2-F11-fastRun 62 → 26, L2-F14-oneArmFeet 187 → 173. Results, ticks, end states and `minPairGap` are identical. The differences are foot events: fewer plant/release/rejoin events, and two `footPlantFailed` in sideLoss. Conversion times and audits match the incoming handoff (L2-F14-oneArmFeet R 0.8625 s, D 1.425 s accepted; sideLoss R 0.850 s).
- No RH entry changes (RH fixtures have no footwork).
- Poses change only where a failed attempt used to publish its clamped plant solve and the decay after it; physics is unchanged before conversion (invariance test). Some extremes move slightly: the runStop shoe penetration is 3.0 mm (was 2.6 mm; limit 10 mm), Fast Run's drift 0.0098 m (was 0.0086).
- Limb snaps (`p07-churn.ts`, continuity on): no one-tick second difference over 10 cm in runStop, Fast Run or Sprint; L2-F14-oneArmFeet worst 18 cm, L2-F8-sideLoss 26 cm.

### Fix 3: stopping feet transfer one step at a time (closeout item 3)

**Incoming:** the hop described in the previous section (both feet start non-drag steps at 3.16667 s, 0.200/0.215 s, both lifted for 12 ticks).

**Cause.** Two things combined.

1. **Entry loop.** At the first reactive substep after clip playback, the reactive-entry loop in `planFeet` started a step for every following foot. At 3.16667 s both clip feet were following (one in its clip swing, one released on `reach` late in its clip stance), so both lifted together.
2. **Short stance window.** In runStop the hip is at 0.921 m (0.815 m vertical from the hip to the standing ankle) and the plant reach is 0.843 m. A planted foot can therefore sit only about ±0.21 m horizontally from its hip. `destination()` limits its lead to reach minus two margins, which is 0 here (`p07-crossgeo.ts`), so a reactive step lands under the predicted hip. Its stance then lasts about 0.075 s at 2.9 m/s. A 0.2 s step outlasts the other foot's stance, so that foot is reach-released while the stepping foot is still in the air, and it drags: 0.27 s of drag in runStop, mostly in the stop.

**Change (`footwork.ts`).**

- **The crossing.** The crossing is the first reactive substep after a clip substep (`plan.clipLast`). Each foot carries its state over:
  - **Confirmed clip plant.** It stays planted and is checked on its achieved solve like any plant. It is `inherited`, which exempts it from the flat-heel hard reach check: that check reads a rolled clip contact as a flat heel and puts it out of reach. Its own solve (slide, separation, clearance) or yaw still releases it. The flag clears on release or on the next confirmation.
  - **Following foot in the air** (gap > 1 cm). It continues its clip swing as a planner step (`footSwing` reason `continue`, with `p0`). The step starts at the clip's swing progress (`playbackSwingProgress`), from the current target. The remaining time comes from the remaining distance and descent under the speed and lift-rate caps. The foot's extra height above the arc blends out over the rest of the step. There is no restart and no second clearance arc.
  - **Following foot on the ground, plant within reach.** It proposes a plant where it is; the solve confirms or fails it as in Fix 1.
  - **Following foot on the ground, out of reach.** It waits: its target is held (no plant, no motion) until the other foot is held. Then it takes the next ordinary step. If both feet wait, the one farther from home steps first.
- **One step at a time.** Ordinary steps still start through the existing one-foot scheduler (both feet held, none swinging). A waiting foot is served first.
- **Quick steps** (the user's "it can be a lot of little steps if needed"):
  - **Trigger.** The other foot is a confirmed plant that will run out of reach before this step lands (`reachTimeLeft`, from the actual velocity).
  - **Retime.** The step's remaining time shrinks to fit, with a floor of 0.25 × minS (0.05 s). Progress keeps its fraction, so nothing restarts.
  - **Landing.** The destination is recomputed for the shorter time. A retimed step may touch down short of its destination once its target is on the ground and within reach.
- **Drags.** A drag starts only from a genuine release:
  - the reach/yaw hard release;
  - a confirmed plant released by its own solve while the other foot is not planted.

  A drag becomes an ordinary lifted step once the other foot is a confirmed plant. The clip fade never starts a drag.
- **Probe switches.** `FOOT_DEBUG.legacyEntry` + `noQuick` reproduce the pre-item-3 planner: with both set, every fixture summary matches the pre-item-3 evidence. Probes use them for comparison; nothing in the simulation sets them.

**Unchanged:** the braking profile (5.5 m/s²), the support height policy, plant confirmation, the swing speed/lift/yaw caps, clearance and foot separation. Proxy physics stays identical with the planner on and off up to the first conversion, on all 24 footwork fixtures (`p07-invariance.ts`, also a test).

**New fixture:** `L2-F3-runStopHard` is runStop with the original motor (no braking limit: 13.6 m/s² peak, rest 1.23 s over 1.63 m). `L2-F3-runStop` is unchanged as a fixture (same definition, now built by `runStop(id, brakeS, controlled)`).

**Results** (old = pre-item-3 planner, through the switches; `p07-item3-compare.ts`):

| Fixture (player) | Both lifted in planner steps (s) | Drag (s) | Steps started while the other foot was in a lifted step | Steps (shortest s) | Confirmed / failed |
| --- | --- | --- | --- | --- | --- |
| L2-F3-runStop (R) | 0.196 → 0 | 0.271 → 0.008 | 1 → 0 | 8 (0.200) → 9 (0.051) | 16 / 0 → 18 / 0 |
| L2-F3-runStopHard (R) | 0 → 0 | 0.275 → 0.008 | 0 → 0 | 6 (0.200) → 6 (0.051) | 14 / 0 → 16 / 0 |
| L2-F6-hop (R) | 0.196 → 0.196 | 0.479 → 0.062 | 2 → 2 | 13 → 14 | 10 / 0 → 10 / 1 |
| L2-F7-shove (R) | 0 → 0 | 0.196 → 0.017 | 0 → 0 | 5 (0.200) → 7 (0.050) | 7 / 0 → 9 / 0 |
| L2-F8-sideLoss (D) | 0 → 0 | 2.379 → 0.558 | 0 → 0 | 14 (0.200) → 33 (0.050) | 13 / 1 → 31 / 1 |
| L2-F8-sideLoss (R) | 0.196 → 0.196 | 0.417 → 0.250 | 2 → 1 | 7 (0.200) → 12 (0.050) | 5 / 1 → 9 / 2 |
| L2-F8-outOfRange (R) | 0.196 → 0.196 | 2.208 → 0 | 2 → 2 | 17 → 23 | 14 / 0 → 20 / 0 |
| L2-F14-oneArmFeet (D) | 0.021 → 0.021 | 0 → 0 | 1 → 0 | 2 (0.200) → 2 (0.028) | 3 / 0 → 3 / 0 |

- **runStop, from the crossing (3.167 s):** no drag, no overlapping lifted steps, and achieved shoes both more than 2 cm up for 0.017 s at most. Both feet end planted; the last step starts at 4.04 s. The stop's last 0.5 s has no step.
- **Both-lifted intervals that remain** are not the stop.
  - In hop and outOfRange, both feet are genuinely airborne and land together after `supportRegained`: two `settle` steps start at once and last 0.2 s.
  - In sideLoss R, it is the fixture-start initialization.
  - These paths are unchanged by item 3 (`p07-crossing.ts`).
- **Coverage is unchanged:** runStop 92% / 92% of eligible stance planted (was 92% / 93%); runStopHard 96% / 94%; sideLoss R 95% / 100%. Held error ≤ 1.0 cm everywhere, with no same-substep release (`p07-confirm.ts`, `p07-churn.ts`).

**Run phases** (`p07-stopphases.ts`). The zero-velocity request is moved from 2.6 s to each brake time, so the clip-to-procedural crossing lands at a different run phase; both motors are swept. "Crossing L/R" is each foot's state at the crossing (F = following, with its shoe gap in metres; P = planted). Shoes up = both achieved shoes more than 2 cm off the ground at once.

| Brake s | Motor | Crossing s (speed m/s) | Crossing L/R | Overlapping lifted steps s | Both shoes up s | Steps started during a lifted step | Drags after the crossing (s after: reason; total s) | Steps (last start s) | Final L/R | Min gap cm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.2 | controlled | 2.771 (2.87) | F0.002/F0.039 | 0 | 0 | 0 | — | 6 (3.700) | P/P | 0.14 |
| 2.25 | controlled | 2.817 (2.88) | F0.001/F0.058 | 0 | 0 | 0 | — | 7 (3.658) | P/P | 0.14 |
| 2.3 | controlled | 2.867 (2.88) | F0.005/F0.095 | 0 | 0.046 | 0 | — | 6 (3.696) | P/P | 0.14 |
| 2.35 | controlled | 2.917 (2.88) | F0.009/F0.001 | 0 | 0 | 0 | — | 7 (4.171) | P/P | −0.05 |
| 2.4 | controlled | 2.975 (2.88) | F0.044/F0.005 | 0 | 0 | 0 | — | 7 (3.913) | P/P | 0.12 |
| 2.45 | controlled | 3.021 (2.88) | F0.043/F0.002 | 0 | 0 | 0 | — | 6 (3.892) | P/P | 0.13 |
| 2.5 | controlled | 3.067 (2.88) | F0.069/F0.002 | 0 | 0 | 0 | — | 7 (4.004) | P/P | 0.13 |
| 2.55 | controlled | 3.117 (2.88) | F0.102/F0.004 | 0 | 0 | 0 | 0.042: reach; 0.046 | 7 (4.162) | P/P | 0.14 |
| 2.6 | controlled | 3.167 (2.88) | F0.058/F0.008 | 0 | 0.017 | 0 | — | 7 (4.037) | P/P | 0.14 |
| 2.65 | controlled | 3.217 (2.88) | F0.006/P | 0 | 0 | 0 | 0.004: step; 0.050 | 7 (4.042) | P/P | 0.14 |
| 2.7 | controlled | 3.271 (2.88) | F0.003/F0.027 | 0 | 0 | 0 | — | 6 (4.258) | P/P | 0.13 |
| 2.75 | controlled | 3.317 (2.88) | F0.001/F0.043 | 0 | 0 | 0 | — | 7 (4.175) | P/P | 0.11 |
| 2.2 | original | 2.567 (1.89) | F0.062/F0.004 | 0 | 0 | 0 | — | 5 (3.308) | P/P | 0.14 |
| 2.25 | original | 2.608 (1.83) | F0.001/F0.004 | 0 | 0 | 0 | — | 5 (3.954) | P/P | 0.05 |
| 2.3 | original | 2.646 (1.80) | F0.001/F0.005 | 0 | 0 | 0 | — | 3 (3.308) | P/P | 0.12 |
| 2.35 | original | 2.700 (1.81) | F0.001/P | 0 | 0 | 0 | — | 4 (3.321) | P/P | 0.06 |
| 2.4 | original | 2.754 (1.88) | F0.001/P | 0 | 0 | 0 | — | 4 (3.383) | P/P | 0.09 |
| 2.45 | original | 2.813 (1.87) | F0.002/F0.042 | 0 | 0 | 0 | — | 5 (3.446) | P/P | 0.14 |
| 2.5 | original | 2.858 (1.80) | F0.004/F0.044 | 0 | 0 | 0 | — | 4 (3.533) | P/P | 0.14 |
| 2.55 | original | 2.900 (1.77) | F0.004/F0.006 | 0 | 0 | 0 | — | 4 (3.558) | P/P | 0.11 |
| 2.6 | original | 2.950 (1.80) | P/F0.001 | 0 | 0 | 0 | — | 4 (3.567) | P/P | 0.12 |
| 2.65 | original | 3.004 (1.82) | P/F0.001 | 0 | 0 | 0 | — | 4 (3.625) | P/P | 0.13 |
| 2.7 | original | 3.063 (1.88) | F0.022/F0.002 | 0 | 0 | 0 | — | 5 (3.779) | P/P | 0.13 |
| 2.75 | original | 3.121 (1.84) | F0.051/F0.003 | 0 | 0 | 0 | — | 4 (3.821) | P/P | 0.14 |

The two remaining drags (brakes 2.55 and 2.65, about 0.05 s each) are genuine releases. In each, a stance foot is released (on reach, and by its own solve) while the other foot is in the air; the drag lifts as soon as that foot lands. No sweep case fails a proposal.

**Foot accelerations** (`p07-accel.ts`: largest one-tick second difference of a knee or ankle, cm, old → item 3). Quick steps trade drags for faster feet.

| Fixture | Before the brake | Brake to 3.6 s | After 3.6 s |
| --- | --- | --- | --- |
| L2-F3-runStop | 7.1 → 12.0 (at 0.750 s) | 9.3 → 9.7 | 1.3 → 1.5 |
| L2-F3-runStopHard | 7.1 → 12.0 (at 0.750 s) | 6.2 → 6.2 | 0.8 → 0.5 |
| L2-F7-shove | 3.3 → 12.4 (at 1.267 s) | — | — |
| L2-F6-hop | 2.1 → 4.0 | — | — |
| L2-F8-outOfRange, L2-F11-fastRun | unchanged (6.6, 7.1) | — | — |

The stop itself is about as before. The new peaks come where a drag used to be:

- **runStop run start:** at 0.633 s a 0.05 s quick step starts from standing, before the clip fades in. At 0.750 s the left foot is mid-step when the clip takes over, and it switches to following the clip.
- **Shove:** its lead/trailing steps.

`p07-churn.ts` (continuity on) now counts 2 one-tick second differences over 10 cm in runStop, worst 12 cm, both at the run start (was 0). Quick steps also reach the swing speed cap: 11.0 m/s in runStop, where the cap is 3.5 + 2.5 × speed. The cap holds, so the smallest speed margin is now 0 (runStop, runStopHard, shove, sideLoss), where it was 1.26 m/s.

**Limits and other measurements:** limb length error ≤ 8.3e-16 m, knee ≤ 133.5°, shoe penetration ≤ 3.0 mm (runStop), drift ≤ 0.00997 m, every confirmed plant ≤ 0.01 m (`p07-feet.ts`; the every-fixture test).

**Changed evidence** (`evidence/summary.json` against the pre-item-3 evidence; all 143 historical entries byte-identical to HEAD; no RH entry changes):

| Entry | Change | Why |
| --- | --- | --- |
| L2-F3-runStop | events 47 → 52 | 1 more step and 2 more confirmed plants; the two-foot hop and 0.26 s of drag are gone. End state identical. |
| L2-F3-runStopHard | new (44 events) | the original-motor stop |
| L2-F6-hop | events 37 → 40 | 1 more step, 1 failed proposal (reach, 3.48 cm); drag 0.479 → 0.062 s |
| L2-F7-shove | events 18 → 24 | 2 quick steps replace a 0.18 s drag; 2 more plants |
| L2-F8-sideLoss | events 85 → 156; R's ragdoll end (3.62, 0.27, 1.15) → (3.33, 0.21, 1.20) | D (7 m/s): 33 quick steps and 31 plants replace 1.8 s of drag. R: 5 more steps, 4 more plants, 1 more failed proposal (clearance). R converts at 0.850 s in both (accepted); its legs at conversion differ, so the articulated fall differs. |
| L2-F8-outOfRange | events 46 → 64 | 6 more steps and plants replace 2.2 s of drag |
| L2-F14-oneArmFeet | events 173 → 177; D's ragdoll end (3.12, 0.75, 1.29) → (3.14, 0.73, 1.30) | D's clip-to-procedural crossing continues its swing (0.028 s) instead of starting a 0.2 s step. Conversions unchanged: R 0.863 s, D 1.425 s, both accepted. D's legs at conversion differ, so its fall differs. |

**Tests** (12 new; `tests/footwork.test.ts`, "L2 clip-to-procedural crossing"):

- **Synthetic planner substeps (no physics):**
  - An airborne foot continues its clip swing (reason `continue`, its clip phase) while the grounded foot plants where it is. There is no target jump, progress is monotonic, no other step starts, and the stance foot stays planted until the airborne foot's confirmed touchdown.
  - Both feet airborne: each continues with its own phase, with no new arcs and no plant requests, and they touch down at different times.
  - A grounded foot out of reach waits on a held target (no plant, no drag) until the other foot is held, then takes one ordinary lifted step.
  - A carried-over plant whose solve slides 2 cm is released (`slide`), drags while the other foot is in the air, and lifts once that foot lands.
- **Run stops** (runStop, runStopHard, controlled brakes 2.3 / 2.45 / 2.55 / 2.65, original brakes 2.3 / 2.45). From the crossing:
  - no two lifted planner steps at once;
  - achieved shoes never both more than 2 cm up for minS/2 (0.1 s) or longer;
  - no ordinary step starts while the other foot is in a lifted step;
  - every drag follows that foot's own `footRelease`; runStop has none;
  - held plants stay within 1 cm;
  - both feet end planted, with no step in the last 0.5 s.
- **Sensitivity:** with the pre-item-3 switches set, 10 of the 12 fail: all four synthetic tests, runStop (0.2 s of overlapping lifted steps), controlled 2.3 / 2.45 / 2.55 and original 2.3 / 2.45. runStopHard and controlled 2.65 have no hop under the old planner either.
- **Drag window:** a drag must follow that foot's `footRelease` within one substep.

### Fix 4: lower physical braking stance (closeout item 4)

**Incoming:** item 3's stop at run ride height. The root is at 0.891 m at the crossing, a reactive plant reaches only ±0.21 m from its hip, and the runStop stop takes 4 quick steps after the crossing (shortest 0.065 s) at the 11 m/s swing cap (limitation 14).

**Profile.** `support-suspension-rh-v3` (`SUSPENSION_L2_BRAKE`) = `support-suspension-rh-v2` + `brakingStance: { heightM: 0.80, fullSpeedMps: 3.0, frequencyHz: 2.5, maxRatePerS: 4, maxAccelPerS2: 32 }`. 0.80 m is the doc's starting candidate (the validated intermediate crouch), not a measured result. The profile is used by every L2 fixture whose motor has the braking limit (`braked()`: F1–F7, F11, F12 and the new runStop variants). `L2-F3-runStopHard` (original motor), the tackle copies F8 and the repairs F13–F15 keep `rh-v2`; RH fixtures keep `rh-v1`; historical fixtures keep theirs.

**Change (`support.ts`, `simulation.ts`).**

- **Demand** (`brakingDemand`), from locomotion intent and solved travel only:

  demand = clamp(effort × max(0, |v| − req·v̂) / τ ÷ maxDecel, 0, 1) × smoothstep(|v| / fullSpeedMps)

  - v is the solved horizontal proxy velocity; req is the requested velocity, clamped to the motor's maximum requested speed;
  - τ is the motor's velocity response time; maxDecel is its braking limit (5.5 m/s²).

  The first factor is the deceleration the drive asks for, as a fraction of the braking limit. The second fades the stance out as the body slows, so the root rises back to ready as it stops. A motor without a braking limit gives no stance. No fixture time, clip phase or foot state is read.
- **Blend b** (`advanceBraking`): a critically damped 2.5 Hz filter toward the demand, with |b′| ≤ 4/s, |b″| ≤ 32/s² and b in [0, 1]. While the player is not supported and grounded (airborne, falling), there is no braking state to derive and b holds.
- **Composition** (`composeTarget`): raw0 is the existing stance/run blend (stance + (run − stance) × clip weight w). The target is raw0 + (min(heightM, stance) − raw0) × b.
  - **Effective at full clip weight.** b blends the run height and bob out, so the request reaches 0.80 m while w = 1.
  - **No double phase advance.** The run phase advances once, as before; only its contribution is weighted.
  - **A lower stance request wins.** The 0.72 m crouch, for example, takes precedence through the min.
  - **Bounded.** The result passes the existing 1.5 m/s slew limit. The feedforward acceleration includes the blend's derivative terms, so the target, its rate and its acceleration stay continuous.
  - **At b = 0 the target is bit-identical** to `rh-v2` (test).
- **Physics unchanged otherwise:** support controller, force split and caps, support loss, irreversible falling and the 5.5 m/s² braking limit. There is no root or velocity write and no render-only pelvis offset. The clip ankle is retargeted ground-relative (sole + clip lift), so a lower root bends the knees.
- **Foot planner unchanged.** It reads the achieved hip. At a 0.80 m root (about 0.725 m from the hip down to the ankle) a plant reaches about ±0.43 m horizontally (was ±0.21 m), so steps land ahead of the hip and last longer. Arms are untouched.
- **Trace:** `sup.bk` (b) and `sup.bkw` (the demand; null while held).
- **Lab editor:** a "braking stance" panel (`index.html` `#brake`) has sliders for height (0.72–0.89 m) and for the speed at which full depth is reached (0.5–6 m/s). It also has a copy line (`brakingStance: { heightM, fullSpeedMps }`) and a reset. A change reloads the fixture with the edited profile (id `…+brake(…)`).

**New fixtures** (all braked, `rh-v3`):
- `L2-F3-runStopReaccel`: brake at 1.6 s, request 6 m/s again at 2.0 s, brake again at 2.8 s.
- `L2-F3-runStopKick`: brake at 2.0 s; a 3 kN upward push at 2.6–2.7 s gives a genuine airborne phase and landing.
- `L2-F3-runStopHandoff`: brake at 2.0 s; an audited conversion is requested at 2.6 s, during the lower stance.

**runStop timeline** (brake at 2.617 s, `p07-brakestance.ts 'runStop 2.6' --trace`):

| t (s) | speed (m/s) | clip weight | b | root h (m) |
| --- | --- | --- | --- | --- |
| 2.650 | 5.72 | 1.00 | 0.04 | 0.862 |
| 2.850 | 4.62 | 1.00 | 0.73 | 0.822 |
| 2.950 | 4.07 | 1.00 | 0.91 | 0.807 |
| 3.150 | 2.97 | 0.08 | 0.99 | 0.801 |
| 3.250 | 2.42 | 0 | 0.99 | 0.801 |
| 3.450 | 1.32 | 0 | 0.71 | 0.827 |
| 3.650 | 0.59 | 0 | 0.23 | 0.870 |
| 3.850 | 0.26 | 0 | 0.04 | 0.887 |
| 4.050 | 0.12 | 0 | 0.005 | 0.890 |

The body lowers to 0.807 m while the clip is still at full weight. It holds 0.801 m through the crossing and rises from about 2.4 m/s. It reaches 0.890 m by 4.05 s and never goes above it. The high stance runs at 0.88–0.89 m over the same interval.

**Results** (`p07-brakestance.ts`: rh-v2 → rh-v3, same motor and requests; steps are counted from the crossing):

| Case | Crossing h (m) | Min h braking (m) | Stop s / m | F BW min–max | max target v (m/s) / a (m/s²) | Steps (shortest s; quick) | Drag s | Both shoes up s | Max leg 2nd diff cm (at s) | Knee ° |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runStop 2.6 (observed) | 0.891 → 0.801 | 0.865 → 0.800 | 1.48 / 3.31 → 1.48 / 3.31 | 0.65–1.55 → 0.74–1.28 | 0.23 / 4.2 → 0.24 / 1.9 | 7 (0.065; 4) → 5 (0.089; 1) | 0 → 0 | 0.017 → 0 | 9.7 (3.183) → 11.8 (3.083) | 22–133 → 32–133 |
| runStop 2.3 | 0.891 → 0.801 | 0.873 → 0.801 | 1.48 / 3.33 → 1.48 / 3.31 | 0.53–1.29 → 0.80–1.14 | 0.14 / 2.8 → 0.27 / 3.7 | 6 (0.091; 4) → 5 (0.130; 1) | 0 → 0 | 0.046 → 0 | 12.5 → 12.5 | 21–129 → 34–138 |
| runStop 2.45 | 0.890 → 0.801 | 0.863 → 0.800 | 1.48 / 3.33 → 1.48 / 3.31 | 0.46–1.47 → 0.46–1.37 | 0.26 / 3.6 → 0.37 / 5.9 | 6 (0.065; 3) → 4 (0.189; 1) | 0 → 0 | 0 → 0 | 9.3 → 6.9 | 21–133 → 24–139 |
| runStop 2.55 | 0.890 → 0.801 | 0.866 → 0.800 | 1.48 / 3.31 → 1.48 / 3.31 | 0.73–1.81 → 0.85–1.43 | 0.21 / 4.0 → 0.29 / 4.3 | 7 (0.106; 3) → 5 (0.108; 1) | 0.046 → 0 | 0 → 0 | 9.3 (3.133) → 14.4 (3.100) | 21–133 → 35–134 |
| runStop 2.65 | 0.890 → 0.801 | 0.864 → 0.800 | 1.48 / 3.31 → 1.48 / 3.31 | 0.60–1.41 → 0.60–1.18 | 0.16 / 4.4 → 0.27 / 3.8 | 7 (0.050; 3) → 4 (0.186; 1) | 0.050 → 0 | 0 → 0 | 10.5 → 10.0 | 23–127 → 24–133 |
| runStop 1.6 (slower) | 0.890 → 0.801 | 0.865 → 0.801 | 1.47 / 3.22 → 1.47 / 3.22 | 0.62–1.62 → 0.67–1.21 | 0.25 / 4.6 → 0.30 / 3.0 | 6 (0.104; 2) → 4 (0.192; 1) | 0 → 0 | 0 → 0 | 10.1 → 9.8 | 21–123 → 22–133 |
| runStop 1.2 (slower) | 0.889 → 0.801 | 0.878 → 0.801 | 1.40 / 2.87 → 1.42 / 2.97 | 0.55–1.25 → 0.24–1.25 | 0.23 / 4.1 → 0.43 / 7.2 | 7 (0.071; 4) → 5 (0.166; 1) | 0 → 0 | 0 → 0 | 10.1 → 8.7 | 20–124 → 38–126 |
| walkStop (slow stop) | — | 0.890 → 0.881 | 0.60 / 0.25 → same | 1.00 → 0.66–1.15 | 0 / 0 → 0.10 / 2.9 | 13 (0.126; 9) → same | 0 → 0 | 0 → 0 | 1.6 → 1.6 | 38–63 → 38–65 |
| runStopHard (original motor, rh-v2 in both) | 0.891 | 0.864 | 1.05 / 1.62 | 0.72–1.60 | 0.22 / 3.8 | 4 (0.174; 1) | 0 | 0 | 6.2 | 25–133 |
| runStopReaccel | 0.890 → 0.801 | 0.863 → 0.801 | 2.67 / 9.39 → 2.67 / 9.40 | 0.26–1.67 → 0.26–1.57 | 0.26 / 5.2 → 0.36 / 4.9 | 7 (0.050; 3) → 4 (0.180; 1) | 0.050 → 0 | 0 → 0 | 10.9 → 10.0 | 20–133 → 18–137 |
| runStopKick | 0.890 → 0.801 | 0.863 → 0.776 | 2.02 / 4.71 → 2.02 / 4.73 | 0.00–3.50 → 0.00–3.50 | 0.21 / 4.4 → 0.35 / 5.7 | 12 (0.077; 2) → 10 (0.122; 1) | 0.067 → 0.071 | 0.617 → 0.525 | 11.9 → 12.4 | 6–133 → 10–135 |
| runStopHandoff (converts 2.6 s) | 0.890 → 0.801 | 0.864 → 0.800 | — | 0.60–1.49 → 0.74–1.32 | 0.21 / 4.4 → 0.35 / 5.7 | 1 → 1 | 0 → 0 | 0 → 0 | 11.5 → 12.4 | 21–133 → 32–135 |

Stop time is to speed ≤ 0.1 m/s and staying below it; distance runs from the brake. The lowest shoe gap in any case is −0.28 cm (2.8 mm of penetration). Overlapping lifted planner steps are 0 in every case except the kick's landing (0.196 s in both profiles). No case overshoots its final standing target after the stop (0.00 cm).

- **Stop time and distance are unchanged** (to 0.02 s / 0.02 m) at every phase from 1.6 s on. The braking limit sets them; the stance does not extend them. The 1.2 s brake (lower speed at the brake) stops 0.02 s / 0.10 m later. There the support force drops to 0.24 BW for a moment while the body lowers early in a shorter stop. Its target rate (0.43 m/s) and acceleration (7.2 m/s²) are the largest of the sweep, inside the 1.5 m/s slew limit.
- **Support load:** 0.74–1.28 BW in the observed runStop (was 0.65–1.55). The lowering itself unloads the support a little, and holding a steady lower height smooths the bob-driven peaks.
- **Steps:** after the crossing every phase takes 4–5 steps, one of them quick (was 6–7, with 2–4 quick). The shortest is 0.089–0.192 s (was 0.050–0.106 s). Step cadence follows the reach window, with no step count forced: in walkStop the stance barely engages (b ≤ 0.10, 0.9 cm), and its 13 steps are unchanged.
- **Phase sweep** (`p07-stopphases.ts`, controlled motor, brakes 2.2–2.75 s): 0 overlapping lifted steps, 0 achieved two-foot flight, 0 drags, 0 failed proposals and both feet end planted in all 12 cases (item 3 had 0.017–0.046 s of two-foot flight in two cases and drags in two). The 12 original-motor rows are unchanged (they keep `rh-v2`).
- **Reacceleration:** the root lowers to 0.804 m, rises back to the run height as the body reaccelerates (b < 0.02 and h > 0.85 at 2.75 s), then lowers again on the second brake.
- **Airborne recovery (kick):** while airborne b holds at 0.99 and the support force is 0. The body lands into the held 0.80 m target, compresses to 0.776 m at the 3.5 BW cap and recovers. Its 0.196 s of overlapping lifted steps and 0.525 s of both shoes up are the airborne phase and the existing landing `settle` path (limitation 15); one proposal fails on reach (6.07 cm) on landing.
- **Audited conversion during the lower stance:** `L2-F3-runStopHandoff` converts at 2.600 s at h 0.800 (b 0.99), accepted in both profiles (`p07-handoffs.ts`). The ragdoll is seeded from the lower, more bent pose, so it falls differently: its end core position differs by 33 cm. `L2-F1-crouchHandoff` is identical.
- **Leg second differences:** the largest one-tick knee/ankle second difference during the stop is 6.9–14.4 cm (was 9.3–12.5 cm). The peak is the toe-off release of a clip plant on `reach` while the clip still plays: during braking the clip's playback rate sits at its minimum, so the clip stance foot moves forward relative to the hips. The lower hips make the leg's angle change at that release larger. The same peak appears with the pre-item-3 planner (`p07-accel.ts`: 11.8 cm at 3.083 s, old and item 3 alike), so it does not come from the step scheduler. `p07-churn.ts` (continuity on) adds this one jump over 10 cm to runStop (3 in total, worst 12 cm; the other two are the run start). Recorded, not patched (limitation 16).

**Effect on every `rh-v3` fixture** (`p07-brakedelta.ts`: each fixture against itself with `rh-v2` swapped in):

| Fixture (player) | First difference s | Max b | Lowest h rh-v2 / rh-v3 (m) | Max height diff cm | Max horizontal diff cm | End diff cm | Conversion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L2-F3-runStop (R) | 2.617 | 0.994 | 0.863 / 0.800 | 9.02 | 0.07 | 0.01 | — |
| L2-F3-runStopReaccel (R) | 1.617 | 0.993 | 0.863 / 0.801 | 8.98 | 0.80 | 0.77 | — |
| L2-F3-runStopHandoff (R) | 2.017 | 0.994 | 0.863 / 0.800 | 9.00 | 0.47 | 33.13 | 2.600 / 2.600 |
| L2-F3-runStopKick (R) | 2.017 | 0.994 | 0.863 / 0.776 | 9.00 | 1.37 | 1.37 | — |
| L2-F7-shove (R) | 1.017 | 0.627 | 0.890 / 0.833 | 5.67 | 0.12 | 0.04 | — |
| L2-F4-drag (R) | 0.600 | 0.100 | 0.890 / 0.881 | 0.90 | 0.01 | 0.01 | — |
| L2-F3-walkStop (R) | 2.517 | 0.097 | 0.890 / 0.881 | 0.88 | 0.04 | 0.01 | — |
| L2-F5-sidePosX / sideNegX (R) | 2.017 | 0.034 | 0.890 / 0.887 | 0.31 | 0.02 | 0.01 | — |
| L2-F11-fastRun (R) | 0.583 | < 0.0005 | 0.863 / 0.863 | 0.00 | 0.00 | 0.00 | — |

The other 12 `rh-v3` fixtures are identical tick for tick: stand, stagger, crouch, crouchHandoff, loaded, yawPosX/NegX, hop, sprint, slowForward/Side/Back.

- **Shove:** the 3 kN sideways push leaves the body travelling against a zero request, so the drive brakes it and the stance engages (b 0.63, down to 0.833 m). This follows the same intent-and-travel rule; the user decides whether a shoved player should crouch this way. It takes 5 steps (was 7), and its largest knee/ankle second difference is 13.7 cm at 1.167 s (was 12.4).
- **Drag, walkStop, side:** the request opposes travel only briefly, which gives a 0.3–0.9 cm dip.
- **fastRun:** a numerical trace of demand (b < 0.0005) during a velocity overshoot, which causes no measurable height change.
- **Tackle fixtures:** none of them uses `rh-v3`, so all tackle and RH outcomes are unchanged. The only handoff that changes is the new runStopHandoff's articulated fall.

**Invariance:** with the planner on and off, physics is identical up to the first conversion on all 27 footwork fixtures (`p07-invariance.ts`), including the stance blend, its demand and the support force. The new test repeats this on reaccel, kick and shove.

**Other checks:** every confirmed plant ≤ 0.01 m and none released in its confirmation substep. runStop has 17 proposals, all confirmed (`p07-confirm.ts`). Limb length error ≤ 8.3e-16 m, knee ≤ 137.0° (runStopReaccel; limit 149.5°), penetration ≤ 2.8 mm and drift ≤ 0.00975 m (`p07-feet.ts`). No fixture is over a hinge limit (`p07-hinge-sweep.ts`, 216 fixtures).

**Changed evidence** (`evidence/summary.json` against the post-item-3 evidence; all 143 historical entries byte-identical to HEAD; no RH entry changes):

| Entry | Change | Why |
| --- | --- | --- |
| L2-F3-runStop | events 52 → 47 | steps 9 → 7, confirmed plants 18 → 17, releases 16 → 15, clip rejoins 8 → 7 (wider reach window). End state identical. |
| L2-F7-shove | events 24 → 18 | the stance engages while the drive brakes the shove; steps 7 → 5, plants 9 → 7, releases 7 → 5 |
| L2-F3-runStopReaccel | new (45 events, end (7.12, 0.89, 0)) | interrupted braking and reacceleration |
| L2-F3-runStopHandoff | new (34 events, R ragdoll end (4.25, 0.20, −0.26)) | audited conversion during the lower stance |
| L2-F3-runStopKick | new (54 events, end (4.83, 0.89, 0)) | genuine airborne phase during braking |

**Tests** (9 new; `tests/footwork.test.ts`, "L2 braking stance (closeout item 4)"):
- **Profile:** identity and opt-in scope (rh-v2/rh-v1/historical profiles have no stance; runStopHard keeps rh-v2 and the original motor).
- **Demand formula:** no limit, zero speed, aligned request, opposing request, effort and the speed fade.
- **Filter:** bounded rate and acceleration, the [0, 1] clamp, and the hold while unsupported.
- **Composition:** bit-identical at b = 0; settles to 0.80 m at full clip weight; a lower crouch request wins.
- **runStop:**
  - b is 0 before the brake;
  - root below 0.83 m during the clip phase and below 0.81 m at the crossing, never below 0.79 m;
  - target rate, acceleration and support force bounded; the player stays supported;
  - no rebound above 0.893 m after rest; final height 0.89 m.
- **Phases 1.2 / 1.6 / 2.3 / 2.45 / 2.55 / 2.65:** crossing below 0.81 m (high stance above 0.88 m); stop time within 0.05 s of the high stance. walkStop stays above 0.87 m. runStopHard has b = 0.
- **Reacceleration:** b < 0.02 and h > 0.85 at 2.75 s, then lower again.
- **Kick and handoff:**
  - kick: b holds while airborne with zero support force; the landing target is below 0.82 m;
  - handoff: accepted at 2.6 s with h < 0.81 m, then falling.
- **Planner on/off:** identical for reaccel, kick and shove.

## Review round 1 (2026-11-05)

The user's first visual review, the decisions they made, and what changed. Look values were not invented: the stance width is an editor value the user sets.

| Finding | Change | Measured |
| --- | --- | --- |
| Side steps lead with the inside foot (sidePosX; L2-F7-shove reads as a hop) | Planner: when the actual lateral speed is ≥ 0.2 m/s and ≥ half the speed, the travel-side foot steps first and the feet alternate (`leadLateralMps`, `leadLateralFrac`). A hard reach release while the other foot is not planted is a **drag step** (zero clearance, event `drag: true`, trace `dr`). | sidePosX: left foot (travel side for +X) steps first, then alternation; mirrored in sideNegX and slowSide. Shove: the lead foot takes a 0.61 m catch step, the trailing foot drags 0.12 m, then closes. No tick has both feet in a lifted swing (test). |
| Heels lift in the crouch and on the stagger's back foot | Ankle dorsiflexion 45° (was 30°) for ground-relative legs only (`ANKLE_DORSI`); legacy L1 clip legs keep 30° (`ANKLE_DORSI_LEGACY`) so historical evidence holds. | Heel lift (`p07-heel.ts`): crouch 2.4 → 0.1 cm, stagger back foot 6.8 → 0.3 cm. |
| The crouch is barely a crouch | User's levels: ready 0.89, intermediate 0.80, crouch 0.72 m. L2-F1-crouch steps through all three; new **L2-F1-crouchHandoff** holds 0.72 m and converts (labelled diagnostic) at 1.5 s. | At 0.72 m: support height within 0.01 m, planted error 1.4 mm, knee ≤ 85.7°, shoe/leg clearance ≥ 0 (no turf penetration), heel lift 0.1 cm, ragdoll handoff accepted (`audit.ok`). Lineman stances (0.65 m) stay deferred, as the user decided. |
| The run stop is too quick, only a couple of tiny steps | User's choice: cap braking. `MotorProfile.braking` (optional) caps the drive component against the actual travel at m × 5.5 m/s² after the force cap; opt-in per fixture (`braked`). L2-F3-runStop runs 5.5 s (the stop needs the time). | L2-F3-runStop (`p07-stop.ts`): from 5.91 m/s at 2.62 s, rest (< 0.05 m/s) after **1.65 s over 3.32 m**, peak deceleration 5.5 m/s², 7 sustained plants while braking (closeout meaning; incoming: 8 touchdown events). Before: 1.05 s / 1.62 m / 13.6 m/s² (RH-F3-accelBrake, unchanged motor). Walk stop: 0.78 s / 0.27 m. |
| Limbs snap and search for a place in contact (L2-F14 D's legs; oneArmFeet; RH-F5-playerBelow, RH-F6-simultaneous) | **Limb continuity** for ground-relative poses (see below). Falling proxies' legs follow the body (`ground.bodyRelative`): the ground-relative request below a lying body folded the legs over the torso. | One-tick body-frame jumps of knee/ankle/elbow/wrist (`p07-snap.ts`, `p07-churn.ts`, continuity off → on): L2-F14-oneArm worst 109 → 18 cm, jumps > 10 cm 106 → 20; oneArmFeet 108 → 18 cm; RH-F6-twoArm 75 → 19 cm; RH-F6-failed 94 → 14 cm; RH-F6-simultaneous 142 → 26 cm (the 26 cm is the arm system's achieved grip arm, outside the pose path); RH-F5-playerBelow 94 → 66 cm (one forced step remains, below). |
| Sprint feet a touch close together | `RunClipProfile.stanceWidthAddM` (optional, per clip id, m per foot outward), applied to the clip ankle and its planted contact, blended between clips. Absent: bit-identical (tested). Lab: a **stance width** slider per clip (shown for fixtures with run clips) rebuilds the fixture and shows a copyable `stanceWidthAddM: { … }` line. | No value is set: the profile change waits for the user's slider value, which goes in verbatim. Test: 0.04 m on sprint widens the planted stance by 0.06–0.10 m. |
| L2-F13-load: heels off at the bottom | Ankle range as above. | Full squat at the guard (h 0.619 m, knee 108°): heel lift 13.7 → 3.9 cm. The remaining lift is the ankle range at that depth (rigid shoe, no toe joint). |
| L2-F6-hop bounces, not a real jump | None. | The fixture is a labelled 2600 N upward push, not a jump: there is no jump design. A 7 cm landing dip recovers in 0.25 s. A jump needs a design (user). |
| Walk arms, idle stance | None (user: later milestone, plan 08). | — |
| Rejected handoffs | None (user: own milestone, plan 07a). | Continuity changed some outcomes; none newly rejected (below). |

### Limb continuity (`pose.ts`, ground-relative poses only)

Cause of the snapping: each substep picks a limb candidate (primary or one of 10 leg / 8 arm alternatives), and the pick demanded a fully clear (≤ 4 mm) previous choice. Near an opponent two alternatives alternated every few substeps, and each switch moved the ankle or palm target up to about 1 m in one substep.

Now, per limb:
- **Hysteresis:** the previous choice is kept while physically valid (≤ 12 mm, `HARD_OK`); the primary still wins back when fully clear.
- **Rate-limited departure:** memory keeps the shown target's departure from the ordinary request (variant offset, plant correction, floor lift; body frame) and the knee/elbow pole. Each substep moves toward the chosen candidate at ≤ 2.5 m/s (legs), 3 m/s (arms), 8 rad/s (pole).
- **Push-out:** an intermediate pose that penetrates is moved along the contact normals (`PoseClearance.push`, ≤ 5 cm per pose, recomputed from the current contacts) and the shown, pushed target is the next pose's start.
- **Validity guard:** while the player can still convert, an intermediate pose may not penetrate more than the chosen candidate (or 12 mm); otherwise it advances (bisection) to the smallest valid step. This keeps the handoff audit valid. After a rejected handoff (final) or without a ragdoll profile, the guard is off.
- **Request jumps** (ready hands, clip arm, support lost): faster than 15 m/s, the shown target is held and blends to the new request.
- **Plants:** a primary planted foot within 5 cm of the shown state is shown exactly (the 0.01 m drift contract).

Legacy body-relative poses (no support profile) keep no continuity state and are bit-identical (tested). Handoff outcomes, continuity off → on: RH-F5-playerBelow A rejected → **accepted**, L2-F15-playerBelow and -overload A rejected → **accepted**, L2-F14-oneArmFeet D rejected → **accepted** (1.425 s); RH-F6-simultaneous D and R stay rejected (upper arms overlapping, plan 07a); no fixture newly rejected. The one remaining large step: RH-F5-playerBelow A's right leg at 0.517 s (66 cm), where no valid intermediate exists while A can still convert.

Plant churn (a plant released in the same substep) rose slightly in the clip regime: L2-F11-fastRun 8 → 11, L2-F3-runStop 3 → 5 (reach-limited clip stance, limitation 2). The closeout removes it: plants are confirmed from the achieved solve, and churn is 0 in every fixture.

## Repair 1: load-release recovery (L2-F13)

**Cause.** The 06a law is F = m(g + a_t) + k(h_t − h) + c(v_t − v), with no integral term. After the guard bottoms (h ≈ 0.62, about 0.27 m below the target), the spring term asks for 3.5 BW. Once the load releases, that force accelerates the body up through the target faster than the damper can brake it, and the root launches to 1.21 m. That is the stored compression error turned into upward speed. It is not windup.

**Change** (`support.ts suspensionForce`, active only when the profile has `recovery`). The law is written as F = m(g + a_t) + c(v_ref − v), with v_ref = v_t + (k / c) e and e = h_t − h. Below the target (e > 0), the approach speed is bounded:

v_ref ≤ v_t + sqrt(2 · a_b · e), with a_b = 0.5 g.

- This is the speed from which the body still stops at the target under gravity's share alone.
- The bound comes from the solved state (e and v) only, never from the load schedule.
- It is inactive for e ≤ 13 mm, so normal tracking and bob are bit-identical (tested).
- The force stays push-only with the same caps and split. There is no downward force, no root or velocity write, and no forced conversion.
- Trace: `sup.vl` records the approach limit (m/s) when it binds.

**Results** (fixed standing request 0.89 m; `tests/footwork.test.ts`):

| Fixture | Load | Peak above request | Settle after release (\|e\| ≤ 0.01) | Out of travel | Compressed: saturated / bottomed ticks |
| --- | --- | --- | --- | --- | --- |
| RH-F4-load (06a, v1) | 3000 N, 0.5–1.0 s | **+0.3199 m** | 0.78 s (settled 1.78 s) | 1.204–1.625 s | 42 / 14 |
| L2-F13-load | 3000 N, 0.5–1.0 s | +0.0002 m | 0.283 s | 0 | 29 / 14 |
| L2-F13-loadShort | 3000 N, 0.5–0.7 s | +0.0002 m | 0.283 s | 0 | 11 / 0 |
| L2-F13-loadLong | 3000 N, 0.5–1.5 s | +0.0002 m | 0.283 s | 0 | 59 / 44 |
| L2-F13-load2600 | 2600 N, 0.5–1.0 s | +0.0002 m | 0.283 s | 0 | 29 / 3 |
| L2-F13-load3400 | 3400 N, 0.5–1.0 s | +0.0002 m | 0.283 s | 0 | 30 / 17 |

- The load still overcomes the support: it saturates at 3.5 BW and bottoms on the guard.
- L2-F13-kickUp: an imparted upward impulse may still leave travel, with zero force and authority outside it. L2-F13-kickDown recovers.
- Normal bob still passes: RH-F3 tracking is unchanged, and the bound is inactive at the bob's error sizes.

## Repair 2: one-arm defender hinge rejection (L2-F14)

**Reproduced** (RH-F6-oneArm, 06a):
- D loses support at 1.500 s.
- The candidate is rejected for `hingeLimit` with right knee 167.8°. The allowed interval is [0, 150]°.
- First invalid supported pose: 1.467 s (right knee 166.2°; 144.4° at 1.450 s).
- The achieved pose already violated the contract before conversion. The candidate only measured it.

**Cause.** `twoBone` clamped the reach to [|a − b| + ε, a + b − ε] only, so a target close to the hip folded the knee to about 178°. The ragdoll limit is 150°. The same was true for the procedural elbow (145°): the L1-F6/F7 procedural elbows went past it.

**Fix** (`pose.ts`, shared by every pose):
- `twoBone` takes a `minReach`.
- Legs and the procedural arm pass `flexReach(a, b, maxFlexRad)`, from the law of cosines: d_min = sqrt(a² + b² + 2ab cos θmax), with θmax = limit − `straightBendDeg`.
- The solved hinge therefore never exceeds the ragdoll limit, and the achieved pose and candidate agree.

Folded legs at the limit can no longer shorten to lift a shoe. Two changes cover that:
- the floor lift now also moves the target out along the bend direction (it unfolds the leg);
- it runs up to 8 iterations and keeps the least-penetrating one.

Without these, falling proxies in RH-F5-playerBelow (4.7 cm) and RH-F6-simultaneous (2.3 cm) pushed shoes into the turf.

**Results:**
- RH-F6-oneArm and L2-F14-oneArm: D converts at 1.500 s and the handoff is accepted (ragdoll knees 128° / 130°).
- Hinge sweep over all 211 fixtures (`p07-hinge-sweep.ts`): the maximum supported-pose knee is 149.5°, the maximum elbow 144.5°, with no frame over a limit. Before the fix, supported poses went over the limits in fixtures including L1-F6/F7, RH-F5-playerBelow / noRescue and RH-F6-oneArm / simultaneous (knees up to 179.2°).
- Regression: `twoBone` at minimum reach yields the limit angle.
- A genuinely bad candidate is still rejected: L2-F8-noRescue is rejected for `jointAnchor` and falls back to the falling proxy.

## Repair 3: loaded player baseline (L2-F15)

| Fixture | A | B |
| --- | --- | --- |
| L2-F15-playerBelow | `obstructed` / falling, F = 0 N on every tick; loses support 0.646 s and converts (accepted since the limb continuity; before it, rejected for `externalPenetration` and a falling proxy) | carries A through body contact: saturated 22 ticks, never bottoms, stays `supported` and upright (lean ≤ 4.9°); the ragdoll A's impacts give one-tick contact peaks up to 10 BW (proxy A before the change: 2.54 BW) |
| L2-F15-overload (+2500 N down on B, 0.6–1.0 s) | the same; loses support 0.650 s, converts (accepted) | capacity overcome: saturated 33 ticks, bottomed on the guard 13 ticks |

There is no automatic collapse on player contact. Changed defeat outcomes against 06a, measured with `rh-defeat.ts`:

- **one-arm:** D is now an accepted conversion. This was the defect.
- **Unchanged:** collision, two-arm (D holds), the slow line (both stay up), side-recover (R 1.171 s), side-loss, and both 14° leans.

## Foot planner (`src/sim/footwork.ts`)

Each foot is `planted`, `swing` or `airborne`. Feet carry a world anchor (heel point, heading, roll fraction, lateral edge), bounded swings, and an explicit release reason.

The planner runs once per substep in `Simulation.updatePoses`, after the solved state, and only for players with a footwork profile. Its output is a `FootRequest` per leg (`plant` / `target` / `offset`). The existing ground-relative leg solve consumes it: `twoBone` / `hingeChain` / `legShapes` with soft reach and the floor lift.

**Clip regime** (supplied run clip weight > 0):
- Stance comes from the clip's contact intervals, blended across clips (`playbackStance`).
- A stance foot proposes a plant when all of these hold (the solve then confirms or fails it, see [Fix 1](#fix-1-plants-are-confirmed-from-the-achieved-pose-footworkts)):
  - the clip contact weight is ≥ 0.95;
  - the clip foot is within 1 cm of the solved foot;
  - the sole is within 1 cm of the turf in a fresh solve (not a failed proposal's);
  - the anchor is within the plant reach of the current hip.
- It releases at the end of the interval (`liftoff`) or when the hip can no longer reach the anchor (`reach`).
- Swing feet follow the clip, with the offset from a released plant decaying at 1.5 m/s.
- With foot requests, the planner owns stance contact, so the clip's own contact IK is skipped.

**Reactive regime** (procedural gait, standing, braking, dragging, side steps):
- Step triggers:
  - home error > 0.14 m (home: under the hip, at sole height, with stagger);
  - yaw > 30°;
  - a reach margin;
  - a settle step at < 0.15 m/s with error > 0.06 m.
- One foot swings at a time.
- The destination leads the actual root velocity by 0.12 s, so steps follow real travel, not the request.
- Hard release on reach or yaw > 55°.

**Swing:**
- Minimum-jerk progress over 0.2–0.34 s, with sin² clearance (7 cm).
- Speed cap 3.5 + 2.5·|v_travel| m/s; lift rate ≤ 1.5 m/s; yaw rate ≤ 360°/s.
- Feet keep at least 14 cm separation.

**Loss of support and falling:**
- Losing support, falling or a ragdoll releases every plant (`supportLost`, `falling`, `ragdoll`).
- No new authoritative plant forms without valid support; an unconfirmed proposal ends as a failed proposal.
- Plants never create support force.

**Plant validity and the contact feature:**
- The anchored feature is the sole point at the roll fraction (and lateral edge), not the ankle.
- Error = hypot(horizontal feature error, contact gap), where the contact gap is the height of the lowest shoe-box corner above the turf.
- When the rigid shoe would dip below the floor (pitch at the ankle range, a tilted shin), the plant IK pivots on that corner. The footprint's lowest corner sits on the anchor, and the rest of the sole lifts. The roll fraction then lies outside [0, 1].

**Outputs:**
- Events: `footPlant` (confirmed, with its achieved error), `footRelease` (with reason, drift including the releasing sample, solves survived), `footPlantFailed` (a proposal the solve did not hold: reason, anchor, errors) and `footSwing` (mode `swing` with source `step` / `rejoin`, or mode `airborne`).
- Trace: `ft` per player (mode, anchor, errors, gap, drift, residual, swing progress, speeds, target, release reason; `tn` for an unconfirmed proposal).
- Stats: proposals, confirmed, failed, sustained, eligible stance coverage per foot (`FootPlan.stats`).
- Reset reproduces both.

**Lab additions:**
- the "L2 · support recovery and footwork" group;
- a `feet` info line (mode, error/drift, swing progress and speed, residual, last release, failed proposals) and a plants line (confirmed / proposed, failed, sustained, eligible stance planted);
- anchor markers: green for a planted contact feature, amber for a step destination.

## Fixtures (`src/sim/fixtures/footwork.ts`, 37 L2 fixtures)

Measured with `scripts/probe/p07-feet.ts` (per foot; R = runner unless noted). Plants are confirmed plants (closeout meaning; re-measured after the closeout: L2-F3-runStop, L2-F11-fastRun and L2-F8-sideLoss changed, every other row is unchanged). This table is from before item 3. Item 3 changes the runStop, hop, shove, sideLoss, outOfRange and oneArmFeet rows and adds L2-F3-runStopHard; see [Fix 3](#fix-3-stopping-feet-transfer-one-step-at-a-time-closeout-item-3). Item 4 changes the runStop, shove, walkStop, drag and side rows (the braking stance) and adds runStopReaccel, runStopKick and runStopHandoff; see [Fix 4](#fix-4-lower-physical-braking-stance-closeout-item-4). Drift and error are measured at the contact feature while planted. Penetration covers the whole shoe volume. Durations and coverage are in the [closeout table](#fix-1-plants-are-confirmed-from-the-achieved-pose-footworkts).

| Fixture | Confirmed plants L/R | Releases | Max drift (m) | Max step speed (m/s, margin below cap) | Shoe pen (m) | Knee range (°) |
| --- | --- | --- | --- | --- | --- | --- |
| L2-F1-stand | 1/1 | — | 0.0014 | — | 0.0000 | 44.7 |
| L2-F1-stagger | 3/2 | settle, reach | 0.0031 | 1.45 (2.05) | 0.0000 | 42.5–71.0 |
| L2-F1-crouch (0.89 / 0.80 / 0.72 m) | 1/1 | — | 0.0014 | — | 0.0000 | 44.7–85.7 |
| L2-F1-crouchHandoff (0.72 m, converts 1.5 s) | 1/1 | ragdoll | 0.0014 | — | 0.0000 | 44.7–85.7 |
| L2-F2-loaded (700 N, 3 s) | 1/1 | — (no marching) | 0.0014 | — | 0.0000 | 44.7–45.8 |
| L2-F3-walkStop | 8/7 | reach, step, settle | 0.0097 | 4.12 (2.03) | 0.0000 | 35.9–63.7 |
| L2-F3-runStop (clip, braking 5.5 m/s², 5.5 s) | 8/8 | reach 13, settle | 0.0099 | 6.75 (1.91) | 0.0030 | 20.4–133.3 |
| L2-F4-drag (forward request, pulled back) | 7/5 | step, reach, settle | 0.0055 | 2.84 (2.30) | 0.0000 | 39.9–63.6 |
| L2-F5-sidePosX / sideNegX | 6/5, 5/6 (mirrored; travel-side foot first) | reach, step, settle | 0.0014 | 3.10 (1.93) | 0.0004 | 41.5–63.7 |
| L2-F5-yawPosX / yawNegX | 2/2 | yaw (mirrored) | 0.0017 | 1.25 (2.25) | 0.0003 | 42.9–51.8 |
| L2-F6-hop (both airborne) | 5/5 | reach, step | 0.0095 | 3.75 (2.17) | 0.0000 | 2.2–75.7 |
| L2-F7-shove (3 kN sideways) | 4/3 | reach, step, settle (lead step + drag) | 0.0014 | 6.66 (1.26) | 0.0005 | 34.9–63.8 |
| L2-F8-sideLoss (R) | 2/3 (+1 failed proposal) | reach, step, ragdoll | 0.0061 | 11.34 (2.76) | 0.0005 | 27.1–70.8 |
| L2-F8-noRescue | 1/1 | falling | 0.0014 | — | 0.0000 | 34.1–115.5 (falling legs follow the body) |
| L2-F8-outOfRange | 7/7 | reach, step | 0.0100 (0.00996) | 5.60 (2.71) | 0.0000 | 5.1–63.6 |
| L2-F11-fastRun (clip) | 5/4 | reach 8 | 0.0098 | follow ≤ 1.08 | 0.0028 | 20.2–133.3 |
| L2-F11-sprint (clip) | 5/4 | liftoff 5, reach 4 | 0.0078 | follow ≤ 1.20 | 0.0017 | 30.0–132.8 |
| L2-F12-slowForward | 7/6 | step, reach | 0.0095 | 3.76 (2.17) | 0.0000 | 36.5–63.6 |
| L2-F12-slowSide | 7/7 | step, reach | 0.0015 | 3.10 (2.21) | 0.0005 | 41.3–63.7 |
| L2-F12-slowBack | 7/7 | step, reach | 0.0092 | 3.28 (2.03) | 0.0000 | 36.8–63.4 |

Every fixture also meets these (re-measured after the closeout):
- limb length error ≤ 7.8e-16 m, against a limit of 0.001;
- knee ≤ 149.5° while supported (max 133.3°);
- no swing over its cap (smallest margin 1.26 m/s, L2-F7-shove's lead step; after item 3 quick steps reach the cap, margin 0);
- drift ≤ 0.00996 m, against a limit of 0.01;
- shoe penetration ≤ 0.0030 m;
- no confirmed plant released in its confirmation substep, every confirmed plant's error ≤ 0.01 m.

Swing speeds are world speeds, so feet under a 7 m/s runner (L2-F8-sideLoss) reach about 14 m/s inside a 21 m/s cap.

**L2-F9 and L2-F10 are tests, not fixtures:**
- **L2-F9:** `twoBone` singularities (zero distance, full extension, target on the pole axis) and extreme plant requests through `buildProxyPose` stay finite. Hinges stay within limits and residuals are recorded. Tests also cover the moonwalk fix and the standing sole height.
- **L2-F10:** 30 / 60 / 144 Hz driver rates, a pause, and reset ×3 give the same planner trace and events at equal tick counts. Liftoff and touchdown alternate with no duplicates.

## Enabled vs disabled invariance

`scripts/probe/p07-invariance.ts` (also a test on five fixtures) compares each player's state on every tick, footwork on against off, with the same support profile:
- translation, rotation and velocities;
- support force;
- control mode and grounding;
- the applied drive / yaw / balance record.

Physics is **identical up to the first conversion on all 23 footwork fixtures** (re-run after the review round). Differences after conversion come from the changed leg pose that seeds the ragdoll:

| Fixture | Difference after conversion |
| --- | --- |
| L2-F14-oneArmFeet | R converts at 0.863 s in both runs. R's candidate legs (planted footwork pose) differ, so R's articulated fall differs. D converts (accepted) at 1.425 s with footwork, 1.375 s without. Both runs end `groundDown`; rule observations differ. |
| L2-F1-crouchHandoff | Conversion at 1.5 s in both; only ragdoll `grounded` events differ. |
| L2-F8-sideLoss | Only the ragdoll R's `grounded` events differ (conversion at 0.850 s in both runs); the result is the same. |

## Changes to the shared pose and their effect on existing evidence

| Change | Scope | Effect |
| --- | --- | --- |
| `twoBone` `minReach` (repair 2) | every leg and the procedural arm | Only pose and candidate are affected, never pre-conversion physics. RH-F6-oneArm D is now accepted; other RH loss times are unchanged. |
| Floor lift unfold + best of 8 | ground-relative legs | Removes the 2–5 cm shoe penetration of folded falling-proxy legs. The RH-F6-collision evidence row changed after conversion only (end positions, `minPairGap` −0.0064 → −0.0037, 73 → 84 events); both losses are still at 0.792 / 0.863 s and accepted. |
| Plant corner pivot, clip contact IK skipped with foot requests | footwork fixtures only | none outside L2 |
| Ankle dorsiflexion 45° | ground-relative legs (RH, L2); legacy clip legs keep 30° | RH poses (pose-only). Without the split, L1-F7-failed's post-conversion row changed; with it the row is identical. |
| Limb continuity, pick hysteresis, falling legs follow the body, push-out | ground-relative poses (RH, L2) | pose-only before conversion (invariance identical); RH and L2 post-conversion rows change with the ragdoll seed pose; handoff changes listed under [Limb continuity](#limb-continuity-posets-ground-relative-poses-only) |
| Braking limit, stance width | opt-in profile fields | absent on every historical and RH fixture |

All 143 historical entries in `evidence/summary.json` are byte-identical to HEAD (checked after the review round). The RH entries keep the 06a support behaviour (RH-F4-load still launches to +0.32 m under v1, as the 06a evidence requires); their post-conversion outcomes change with the pose changes above (RH-F6-oneArm D accepted; RH-F5-playerBelow A accepted; RH-F6-collision end positions).

## Visual review (lab `npm run dev`, http://localhost:5197/?fixture=L2-F13-load)

Frames captured at 1× playback in the lab (Chrome). These are not a continuous recording.

| Fixture | Observed |
| --- | --- |
| L2-F13-load | compressed onto the bump stop at 0.98 s (h 0.62); back at 0.89 by 1.22 s with no launch; standing through 3 s |
| L2-F3-walkStop | alternating short steps with the amber destination ahead of the swing foot and green plants under stance; braking ends in settle steps with both feet planted |
| L2-F11-sprint | clip stride, a green plant under the stance foot, flight between plants |
| L2-F14-oneArm | D falls over R and converts at 1.500 s (accepted, 10 bodies) |
| L2-F4-drag | the body slides back while the request is forward; step destinations land behind (z −0.17, −0.44, −0.72) |

The user's first review (2026-11-05) is answered in [Review round 1](#review-round-1-2026-11-05). Visual acceptance is the user's.

## Tests

`tests/footwork.test.ts` has 59 tests (24 + 8 from the review round + 6 from the closeout + 12 from closeout item 3 + 9 from closeout item 4):
- **Repairs 1–3:** L2-F13 recovery and kicks; profile identity and bit-identical small-error behaviour.
- **Hinge:** the cause regression; RH-F6-oneArm and L2-F14 accepted; noRescue still rejected.
- **L2-F15:** carry within capacity; the overload bottoms B.
- **Planner:** F1–F12 behaviour (direction, settle, mirror, airborne, release reasons, no new plants while falling).
- **Reproducibility:** rates, pause and reset (F10).
- **Invariance:** physics unchanged before conversion.
- **Every footwork fixture:** limb length, knee, penetration, caps and drift.
- **Review round:** travel-side lead foot and alternation (sidePosX/NegX, slowSide, shove); crouch levels with heel lift ≤ 1 cm, leg clearance and support height; crouch handoff accepted; braking (`computeDrive` cap, opt-in scope, runStop time/distance/peak/plants); stance width (widening, absent bit-identical); limb continuity (no one-tick limb jump > 0.3 m on six contact fixtures; legacy poses keep no continuity state).
- **Closeout item 3:** the clip-to-procedural crossing (synthetic substeps and eight run stops); see [Fix 3](#fix-3-stopping-feet-transfer-one-step-at-a-time-closeout-item-3).
- **Closeout item 4:** the braking stance (profile, demand, filter, composition, six phases, slow stop, reacceleration, kick, handoff, planner on/off); see [Fix 4](#fix-4-lower-physical-braking-stance-closeout-item-4).
- **Closeout:** synthetic plan/solve regressions where the last solve looks eligible but the next solve is out of reach or takes a clearance alternative (clip touchdown, reactive step touchdown, initialization): no plant emitted or retained, the failure recorded, no stale retry, no proposal with the anchor out of reach, then one confirmed and sustained plant; support loss before and after confirmation. Integration checks count sustained intervals (runStop run and braking, Fast Run / Sprint), report per-foot durations, coverage, held and release-sample errors and failed proposals, and check on every footwork fixture that no confirmed plant is released in its confirmation substep. Validation: braking limits and stance widths (above). L2-F2-loaded covers the whole eligible stance (100%).

## Commands (actually run)

| Purpose | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | no errors |
| Tests | `npx vitest run` | 218 passed (159 before 07 + 59), 0 failed |
| Build | `npm run build` | ok; chunk-size warning only |
| Evidence | `npm run fixtures` | 216 fixtures; 143 historical entries byte-identical to HEAD; 37 L2 entries |
| Braking | `npx vite-node scripts/probe/p07-stop.ts [id regex]` | stop time, distance, peak deceleration, confirmed / sustained plants, failed proposals |
| Plant confirmation | `npx vite-node scripts/probe/p07-confirm.ts [id regex] [--events]`, `p07-precheck.ts [id regex]` | closeout table; pre-check off vs on |
| Validation | `npx vite-node scripts/probe/p07-validate.ts` | the review's invalid values rejected (messages above) |
| Heel lift | `npx vite-node scripts/probe/p07-heel.ts` | heel numbers above |
| Snapping | `npx vite-node scripts/probe/p07-snap.ts [id regex] [--list]`, `p07-churn.ts`, `p07-legtrace.ts <id> <player:limb> <from> <to>` | continuity numbers above |
| Handoffs | `npx vite-node scripts/probe/p07-handoffs.ts [id regex]`, `p07-nofeet-handoffs.ts <id>` | handoff list |
| Foot metrics | `npx vite-node scripts/probe/p07-feet.ts [--timeline] [--events] [id regex]` | table above |
| Invariance | `npx vite-node scripts/probe/p07-invariance.ts [id regex]` | identical before conversion on all 27 |
| Stop crossing (item 3) | `npx vite-node scripts/probe/p07-crossing.ts [id] [from] [to] [--sub]`, `p07-crossgeo.ts`, `p07-stopphases.ts`, `p07-item3-compare.ts`, `p07-accel.ts` | Fix 3 tables |
| Braking stance (item 4) | `npx vite-node scripts/probe/p07-brakestance.ts [case regex] [--trace from to]`, `p07-brakedelta.ts [id regex]` | Fix 4 tables |
| Hinge sweep | `npx vite-node scripts/probe/p07-hinge-sweep.ts` | no fixture over a limit |
| Loaded player | `npx vite-node scripts/probe/p07-loaded.ts [id]` | L2-F15 numbers |
| Load release | `npx vite-node scripts/probe/p07-load.ts`, `p07-support-delta.ts` | L2-F13 diagnosis |
| One-arm | `npx vite-node scripts/probe/p07-onearm.ts`, `p07-onearm-legs.ts` | repair 2 reproduction |
| RH regression | `rh-probe.ts`, `rh-defeat.ts` | 06a tables reproduced |

## Files

New:
- `src/sim/footwork.ts`;
- `src/sim/fixtures/footwork.ts`;
- `tests/footwork.test.ts`;
- `scripts/probe/p07-*.ts`.

Changed:
- `support.ts`: the recovery bound;
- `profiles.ts`: `SUSPENSION_L2`;
- `pose.ts`: `twoBone` `minReach`, `flexReach` / `maxFlexRad`, foot requests, the plant IK with corner pivot, floor-lift unfold and best-of-8, `legInfo`;
- `run-clip.ts`: `playbackStance`, sampled contact roll;
- `simulation.ts`: the planner per substep, foot events, the trace `ft`, reset, export; pose `dtS`, `handoffPossible`, falling `bodyRelative`, `PoseClearance.push`; clip `widthAddM`;
- `motors.ts` / `profiles.ts`: `MotorProfile.braking`, `withBrakingLimit`;
- `run-clip.ts`: `stanceWidthAddM`, `playbackWidthAddM`;
- `pose.ts` (review round): limb continuity, pick hysteresis, push-out, falling body-relative legs, ankle 45° (ground-relative);
- `fixture.ts`: `footwork`;
- closeout: `footwork.ts` (touchdown proposals confirmed from the achieved solve, `footPlantFailed`, stale guard, reach pre-check, sustained/coverage stats, `FOOT_DEBUG`), `profiles.ts` (`validateMotorBraking`, used by `withBrakingLimit`), `run-clip.ts` (`stanceWidthAddM` validation), `simulation.ts` (motor validation at construction, trace `tn`), `lab/main.ts` (failed proposals, plants line);
- closeout item 3: `footwork.ts` (the clip-to-procedural crossing: carried-over plants, continued swings, waiting feet; quick steps; drag only from genuine releases; `FOOT_DEBUG.legacyEntry` / `noQuick`; trace `wt`), `run-clip.ts` (`playbackSwingProgress`), `simulation.ts` (clip `swingP` in the planner input), `fixtures/footwork.ts` (`runStop(id, brakeS, controlled)`, `L2-F3-runStopHard`), `tests/footwork.test.ts`, probes `p07-crossgeo.ts`, `p07-stopphases.ts`, `p07-item3-compare.ts`, `p07-accel.ts`;
- closeout item 4: `profiles.ts` (`SuspensionSupport.brakingStance`, `SUSPENSION_L2_BRAKE` = `support-suspension-rh-v3`), `support.ts` (`brakingDemand`, `advanceBraking`, the blend in `composeTarget` and its feedforward, runtime `brakeWant` / `brakeB` / `brakeV` / `brakeA`), `simulation.ts` (demand from intent and solved travel per substep, hold while unsupported, trace `sup.bk` / `sup.bkw`), `fixtures/footwork.ts` (`braked()` selects rh-v3; `runStopVariant`: runStopReaccel, runStopHandoff, runStopKick), `lab/main.ts` + `index.html` (the braking stance editor), `tests/footwork.test.ts`, probes `p07-brakestance.ts`, `p07-brakedelta.ts`;
- `fixtures/index.ts`;
- `lab/main.ts`: the L2 group, feet line and markers, the stance width editor (`index.html` panel).

## Limitations and open items

1. **Rigid shoe:** there is no toe or subtalar joint. A plant that would dip a sole corner pivots on that corner (the roll fraction leaves [0, 1]) instead of bending the foot. At the deep squat guard (h 0.62 m, knee 108°) the heels lift 3.9 cm.
2. **Running stance reach:** at running ride height the stance leg cannot reach the clip's whole stance.
   - Fast Run plants release on `reach` (8 of 8); confirmed plants cover 61% / 64% of the eligible clip stance.
   - Sprint holds full-stance plants on one side only (5 `liftoff`, 4 `reach`; 100% / 91% coverage).
   - Swing residuals reach 7.5 cm (Fast Run; re-measured after the closeout, the incoming text said 6.5 cm) and 2.9 cm (Sprint).
   - Plant churn (release in the same substep as the plant) was 11 (Fast Run) and 5 (runStop) before the closeout; it is 0 now.

   This is the 06a stance residual, now explicit and recorded, not hidden.
3. **Reactive steps are one foot at a time,** with no crossover. Side travel leads with the travel-side foot and alternates. Since item 3, a step that would outlast the other foot's stance is retimed into a quick step (down to 0.05 s) instead of letting that foot drag; L2-F7-shove still drags for 0.017 s in total, and the 7 m/s L2-F8-sideLoss defender for 0.558 s (was 2.379 s).
4. **Post-conversion differences with footwork** follow from the planted leg pose seeding the ragdoll (L2-F14-oneArmFeet D converts at 1.425 s instead of 1.375 s). Candidate placement is plan 07a.
5. **Visual-flight support, attenuated Sprint bob and load-limited drive** remain the declared 06a approximations.
6. **No automatic run/contact selection:** that is plan 08.
7. **Continuity limits:** while a player can still convert, a pose with no valid path to the chosen candidate still steps (RH-F5-playerBelow A's right leg, 66 cm at 0.517 s). The arm system's achieved grip arms are outside the pose path (up to 26 cm one-tick moves in RH-F6-simultaneous). *(Plan 07a: the guard no longer advances toward an invalid candidate, and opponents' published limbs are in the clearance. A's leg is now 10.7 cm and the simultaneous grip arms are ≤ 6.9 cm; see the [plan 07a handoff](plan07a.md).)*
8. **Rejected handoffs:** RH-F6-simultaneous D and R (upper arms overlapping) and L2-F8-noRescue R (`jointAnchor`) stay rejected. The user takes these as their own milestone (plan 07a). *(Plan 07a: RH-F6-simultaneous D and R are accepted at 1.200 s. L2-F8-noRescue stays a safe rejection, as intended.)*
9. **Jumping:** L2-F6-hop is a labelled push, not a jump; there is no jump design.
10. **Stance width:** the profile field and the lab editor exist; no value is set until the user picks one.
11. **Walk arms and idle stance:** the user's later milestone (plan 08).
12. **Lineman stances** (support height 0.65 m and below) are deferred by the user; they need their own support, clearance and handoff validation.
13. **Ragdoll impact peaks:** after A converts in L2-F15-playerBelow, B's one-tick contact load peaks at about 10 BW (9853 N). This is ragdoll contact, not support force.
14. **Reactive stance window at run ride height (item 3):** at the 0.921 m run hip, a reactive plant reaches only about ±0.21 m from its hip, and steps land under the predicted hip. Braking from 2.9 m/s therefore needs a step about every 0.075 s per foot. Those quick steps run at the swing speed cap (11 m/s world in runStop). They raise one-tick leg second differences to 12 cm at the runStop run start and 12.4 cm in shove (were 7.1 and 3.3); the stop window itself is 9.7 cm (was 9.3). A lower physical braking stance is now required by 07 item 4; step-destination/cadence styling remains in 08. The measurements here describe the higher stance used by item 3 and do not claim the lowering is implemented. *(Coder, item 4: with the 0.80 m braking stance the window is about ±0.43 m, and the stop takes 4–5 steps after the crossing, one of them quick; see [Fix 4](#fix-4-lower-physical-braking-stance-closeout-item-4). Quick steps at the run start and in shove remain.)*
15. **Landing from genuine flight:** after `supportRegained`, both airborne feet start `settle` steps together (0.2 s both lifted in L2-F6-hop and L2-F8-outOfRange). This is the pre-item-3 landing path and is unchanged; there is no jump design (item 9).
16. **Toe-off release while braking (item 4):** during braking the clip's playback rate sits at its minimum, so a clip stance foot moves forward relative to the hips until it is released on `reach`. At the lower braking hips that release moves the knee by up to 11.8 cm in one tick in runStop (3.083 s) and 14.4 cm with the brake at 2.55 s (was 9.3–12.5 cm at the run height). The same peak appears with the pre-item-3 planner. It is recorded, not patched: the clip/procedural hand-over cadence is 08 work.
17. **Braking stance tuning (item 4):** 0.80 m and the full depth from 3 m/s are the starting candidate, not a measured athlete stance; the lab editor changes both. With the brake at 1.2 s (lower speed) the stop is 0.02 s / 0.10 m longer, and the support force dips to 0.24 BW while the body lowers. The stance also engages when the drive brakes a shove (L2-F7-shove, down to 0.833 m). Whether a shoved player should lower this way is the user's call.
