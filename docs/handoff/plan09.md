# Plan 09 handoff: active falls, joint limits and role responses

**Date:** 2026-11-07.
**Status:** implemented, uncommitted on `model-integration`, on top of the uncommitted 08 and 08a work. Incoming checkpoint: `736d90a`. Not yet accepted by the user. **Review fixes applied 2026-11-07:** the envelope keeps an energy, exhausted work stops all torque, and impact power counts as a failure (see [Review fixes](#review-fixes-2026-11-07)).

**Plan:** [09 — Active falls](../open/09_Active_Falls_Joint_Limits_and_Role_Responses.md). **Previous:** [plan 08 handoff](plan08.md).

**Result: 675 tests pass, 75 of them in `tests/falls.test.ts`.** Typecheck and build pass. 411 fixtures export, 76 of them L4; the review fixes change 68 L4 summaries. All 335 earlier summaries are byte-identical to their state before this plan, including the 238 committed ones.

**The full suite sometimes prints a vitest error that is not an assertion failure.** Earlier runs reported `[vitest-worker]: Timeout calling "onTaskUpdate"`: once with this plan's tests, three times with `tests/falls.test.ts` excluded, where all 600 earlier tests still passed. So the fall tests do not cause it. The reviewer's run exited unsuccessfully with three of them. The run after the review fixes printed none and exited 0. The likely cause is long synchronous tests starving the worker's event loop, but I did not prove that, and I did not check whether it predates this plan. Vitest warns that such errors can hide failures.

> **Correction ([plan 10a](plan10.md#10a--test-gate-and-evidence-integrity), 2026-11-08):** the clean exit was not repeatable. The 2026-11-08 run of this tree passed all 675 tests and exited 1 on one unhandled `onTaskUpdate` timeout, so "exited 0" described one run, not the gate. Plan 10a paces long synchronous test loops with a wall-time yield and splits the transitions file; three consecutive full runs then exited 0 with no unhandled error.

**Started before 08a's visual acceptance.** The [closeout](../open/08_Review_Closeout.md#visual-review-after-numeric-closeout) asks for that review, and the README recorded it as the next step, but the user declared 08 finished on 2026-11-07 and asked for this plan directly. The 08a review is still outstanding.

## Review fixes (2026-11-07)

An implementation review asked for three fixes before accepting 09. All three are in, each with a regression test that fails when the fault is put back.

1. **Passive twist limits could create energy** (P1). A twisted shoulder swung around a closed path gained 26.3 J with muscles off. Each limit now derives from one energy; see [The limits keep an energy](#the-limits-keep-an-energy). Fixing it raised hip swing stiffness to 3500 N·m/rad.
2. **Exhausted work budgets still allowed positive work** (P2). Effort now stops entirely before the last substep could pass the cap; see [Work stops for good](#work-stops-for-good-before-the-last-substep-could-pass-the-cap).
3. **Impact overruns bypassed the power failure** (P2). Every substep over the ceiling now fails, and an impact guard keeps them from happening; see [Impacts hold effort off](#impacts-hold-effort-off-they-excuse-nothing).

## What changed

| File | Change |
| --- | --- |
| `src/sim/profiles.ts` | `ENVELOPE_L4`, `FALL_L4`, `RAGDOLL_L4`, `SOLVER_G4_ZEROG` and their types |
| `src/sim/ragdoll.ts` | Swing-twist decomposition, the tilted cone, `envelopeMoments` (one energy per limit), `applyEnvelope`, `auditEnvelope`, `initEnvelope`, limit gradients |
| `src/sim/fall-response.ts` (new) | Per-arm tasks, brace prediction, torque pairs, the impact guard, power and work caps, the effort ledger |
| `src/sim/arms.ts` | Shared falling-owner allocator extended with shoulder and elbow demand, `retained(id, side)` |
| `src/sim/simulation.ts` | Substep wiring, labelled `jointLoads` and `limitLoads`, the guard's `closingSpeeds` query, trace `fall` and `lim`, export `fallEffort` and `jointLimits` |
| `src/sim/fixtures/falls.ts` (new) | L4-F1 to L4-F12 |
| `src/lab/main.ts` | L4 fixture group; live `FALL`, `effort N·m` and `limits` lines |
| `tests/falls.test.ts` (new) | L4 evidence |
| `tests/transitions.test.ts` | The opt-in test now skips L4 ids: they start from L3 fixtures on purpose, and `falls.test.ts` covers their own opt-in |

Everything is opt-in through `def.fallResponse` and `def.ragdoll.envelope`. Only L4 fixtures carry either.

## Limits

Elbows, knees and the neck stay native revolute limits; they gained load tests, not replacements. Rapier 0.21 has no spherical cone limit, so shoulders and hips use a soft envelope: a one-sided spring-damper torque pair on swing and twist. It stays active with every muscle budget at zero.

| Joint | Mode | Stated load | Settled overshoot (last 0.4 s of load) | Peak while arriving |
| --- | --- | --- | --- | --- |
| Shoulder swing | soft | 30 N·m | 1.15° | 2.8° |
| Shoulder twist | soft | 15 N·m | 2.25–3.24° (mean 2.09°) | 11.6° |
| Hip swing | soft | 60 N·m | 1.08° | 2.0° |
| Hip twist | soft | 30 N·m | 2.2° | 3.4° |
| Elbow | native | 30 N·m | 0.65° | 0.65° |
| Knee | native | 40 N·m | 0.03° | 0.03° |

The 5° target applies to the settled column and passes. Settled is the largest excursion over the last 0.4 s. Shoulder twist is lightly damped and still rings there between about 1° and 3.2°; its mean is the 2.15° that 15 N·m over 400 N·m/rad predicts, and the test checks that mean. The shoulder twist peak is an arrival and rebound transient, not the stated load, and is over 5°.

> **Correction ([plan 10b](plan10.md#envelope-stiffness-exposed-by-10b), 2026-11-08):** hip twist stiffness is now 1600 N·m/rad (`envelope-l4-v2`). Under the same 30 N·m the hip twist settles at 1.47° left and 1.34° right (mean 1.06°, the load over the new stiffness), with a 4.7° peak while arriving (right). The test now derives each expected mean from the profile.

**Natural falls are not held to 5°.** Across every L4 fall the largest excursion is 31.6° (`L4-F10-wrap-on`, runner right shoulder, a defender landing on it) and the longest run past tolerance is 0.19 s (`L4-F3-run-off`, right hip), against the 0.25 s persistent limit, which a test now enforces on every L4 fall. Native hinges reach 6.8° past the knee limit at impact (`L4-F10-knee-on`). None of this is a hard guarantee at arbitrary impact, as the plan says.

> **Correction ([plan 10b](plan10.md#envelope-stiffness-exposed-by-10b), 2026-11-08):** after plan 10b's L3 changes, `L4-F3-run-on` (and `L4-F9-free`) came to rest with the runner's right hip 7.2° past its twist range for 0.65 s, its shoe held by friction against about 100 N·m of the 800 N·m/rad twist spring; the persistence test caught it. With hip twist at 1600 N·m/rad the longest run is 0.175 s (`L4-F3-run-off`, right hip) and the largest excursion 34.4° (`L4-F9-defenderFalling`, runner right shoulder).

### The swing range is a tilted cone

The first design used four quadrant limits with radial torque. It failed: in the passive fall the limit dropped from 124° to 60° under a limb sliding around the boundary at about 125°, which is a non-conservative force, and it added 320 J. Loss terms and gain caps only moved that; both were tried and removed.

The range is now a cone about a tilted centre with an elliptical boundary, and the extents therefore differ from the first quadrant numbers:

| Joint | Forward | Out | Back | In |
| --- | --- | --- | --- | --- |
| Shoulder | 166.75° | 166.75° | 76° | 76° |
| Hip | 128.75° | 61.25° | 39° | 45° |

Twist: shoulder ±100° about neutral 180°, hip ±50°. All of these are engineering settings.

A joint that starts outside the range keeps slack, so conversion adds no kick. Slack only tightens: it follows the limb inward and decays at 30°/s. Among the fixtures this occurs once, in twist, in `L4-F9-crowded` (0.89 rad); swing slack is covered by a direct test only. While slack runs out it raises the stored limit energy. That happens once per joint after conversion, because slack never refills, so it cannot cycle; the closed-path test below uses no slack.

### The limits keep an energy

The review found the first envelope could add energy with muscles off. The twist excess is scaled by cos(swing / 2) so that it fades toward the swing pole, but the torque had no swing component for that fading. Around a closed path (swing 20–120°, twist 5–25° past the shoulder limit) that gained 26.3 J. Two smaller leaks of the same kind showed up once tested: the swing torque used the normalized gradient rather than the exact one (4.9 J around a hip loop past its elliptical boundary), and a cap on the summed torque did not derive from any energy (2.7 J).

Each limit now has one energy, the integral of min(k × excess, cap) over its excess. The torque is that spring times the exact gradient of the excess: the twist gradient analytically, including the swing term the fading needs, and the swing gradient by central differences of the same excess function. Damping acts along the same gradient, and the moment is clamped to between zero and the cap, so it can only remove energy. Twist wraps half a turn from the middle of its range, where both sides' excess is equal, so the energy stays continuous for any range.

`tests/falls.test.ts` integrates the spring around closed paths at rest: the review's shoulder path, the hip past its elliptical cone, and both hip limits with the swing spring at its cap. Each returns under 0.01 J. Each of the three leaks, put back, fails that test.

An honest consequence: the energy-consistent fade pushes a limb that is far past its twist limit slightly further in swing, because the twist energy shrinks as swing grows. The push grows with the square of the twist excess, so it matters only in deep folds.

**Hip swing stiffness rose from 2500 to 3500 N·m/rad.** With the fixed energy, a leg folded under the body sat 5–6.5° past its swing range under about 250 N·m for 0.25 s (`L4-F5-twoClamp-off` defender) and 0.275 s (`L4-F3-run-off`), at or over the 0.25 s persistence limit. With 2500 N·m/rad, the earlier 0.18 s was luck: each variant of the change put some fall between 0.25 and 0.32 s. A test now holds every L4 fall, on and off, under the persistence limit, which nothing checked before.

## Effort

| Item | Value |
| --- | --- |
| Ceilings | Shoulder 15, elbow 10, hip 18, knee 22 N·m |
| Arm allocation | Shoulder/upper arm + elbow/forearm + grasp tension, scaled together under the owner's falling budget (350 N) |
| Power and work | 150 W, 100 J, 5% tolerance on every realized substep, impact or not; planned to 135 W; negative work logged and not refunded |
| Impact guard | No effort on a limb meeting a contact closing over 0.5 m/s, or after a contact impulse over 10 N·s; core or head holds the whole body |
| Window | 0.04 s delay, 0.08 s ramp, fade from 0.8 s over 0.2 s, once per episode |
| Start | Only on `handoff.accepted`: a rejected conversion stays a proxy, a failed transfer stays diagnostic |

Over 53 responses in the L4 falls:

- **Power:** 0 substeps over the 157.5 W ceiling, impact or not; the largest realized substep is 148.4 W. **0 episodes over the work cap.** Peak work 46.6 J with the labelled load (`L4-F7-overcome`), 45.1 J in natural falls.
- **Momentum:** L4-F8 conserves net momentum, and energy change is explained by logged work within 1.5 J.

> **Correction ([plan 10c](plan10.md#10c--active-fall-contract-repairs) C7, 2026-11-08):** the effort ledger's `pairSum`, asserted to be 0 in `tests/falls.test.ts`, was the commanded torque plus its own negation, so it was 0 by construction and showed nothing; the arm force ledger's was the same for grasp forces. Both are removed. Equal and opposite torque pairs rest on this L4-F8 momentum test. Grasp force pairs rest on the construction only (the owner receives the target's force negated in the same call); no zero-gravity grasp test exists.
- **Zero cap:** `L4-F7-zeroCap` matches its motor-off twin exactly.
- **Braces:** 30 palm contacts (one of them in `L4-F7-overcome`), 24 misses (9 late, 7 too far, 7 obstructed, 1 expired), the same counts as before the review fixes. No forearm-first contacts occurred.

> **Correction ([plan 10c](plan10.md#10c--active-fall-contract-repairs) C4, 2026-11-08):** after plan 10b's L3 changes the counts were 31 palm contacts and 24 misses (13 late, 5 too far, 5 obstructed, 1 expired). The `obstructed` label was sticky: one arm contact with the opponent or an obstacle at any time, by any task, the arm's own hold included, marked the next miss. It now needs a seeking brace blocked within its shortest prediction horizon, never a hold. After 10c: 31 palm contacts, 23 misses (13 late, 5 too far, 4 obstructed, 1 expired); `L4-F6-break` D left, touched only by its own hold, reads `late`, and `L4-F12-carryLeft` is gone.

### Impacts hold effort off; they excuse nothing

Caps are set before the solve, and a contact changes joint speeds during it. Before the review fix, 12 substeps across the L4 falls realized more than the 157.5 W ceiling, up to 225 W. They were counted apart as impacts and passed. Now every substep over the ceiling counts in `overPowerSubsteps` and fails, and `impactPowerSubsteps` only tags why.

To stay under the ceiling without correcting any velocity:

- **Impact guard.** Before each solve the host reads each segment's geometry against the floor, obstacles and the other players. Effort holds off a limb when a contact closes faster than 0.5 m/s within 1.5 substeps, or after a solve that gave it a contact impulse over 10 N·s. A core or head impact holds the whole body. A segment hit at speed v changes its joint speed by roughly 3v/L, so 1 m/s was too loose: a torso closing at 0.9993 m/s then hit the floor with 42.8 N·s. Of the 12 old overruns, 10 began at such a contact (pelvis 235 N·s, shoe 31 N·s, forearm 24.5 N·s).
- **Planning headroom.** Planned power is held to 90% of the cap (135 W). The per-joint prediction leaves out how one joint's torque moves its neighbours, which caused the other 2 overruns, 6–8% over prediction with no contact. Planning to 100% fails the audit with the final settings.

The guard holds some limb in 17.1% of active substeps (1843 of 10781) and the whole body in 6.0%. Brace outcomes are unchanged: 30 palm contacts and the same 24 misses.

### Work stops for good before the last substep could pass the cap

Before the fix, exhaustion only zeroed commands predicted to add energy; absorbing ones stayed on, and contact turned them positive. `L4-F3-forward-on` did 0.91 J with no work allowed and 1.55 J with 1 J. Now effort stops entirely once less work remains than one substep at the tolerated power could use (157.5 W × 1/240 s = 0.66 J). If the power audit holds, the total cannot pass the cap. Caps of 0 and 0.5 J apply no torque at all; at 1, 2, 5 and 20 J the total stays at or under the cap.

## Role decisions

| Case | Result |
| --- | --- |
| Runner, carry arm | Protects. Never braces. |
| Retained hold | Holds; no automatic brace on that arm |
| Free arm | Braces |
| Hold lost | Brace from the achieved pose, or passive if the core is down. A new hold never forms. |
| Miss | `tooFar`, `late`, `obstructed` or `expired`; stays a miss, and the arm goes passive |

## Fixtures

| ID | Evidence | Note |
| --- | --- | --- |
| L4-F1 | Six limit loads, muscles off | See Limits |
| L4-F2 | Knee only, forward/back/side, on and off, plus installed-player twins | Forward folds past the target by itself, so the flexor does about 0.2 J |
| L4-F3 | Free arm brace, carry arm protects, on and off, plus installed-player twins | Palm contact forward and oblique; the installed player's sideways fall misses `late` |
| L4-F4 | tooFar, late, fast, obstructed, occupied | No remote anchor; a box takes the hand in `obstructed` |
| L4-F5 | Two palms, one palm, two clamps, one clamp | See disclosures |
| L4-F6 | Last hold breaks | Switches from the achieved pose; no palm acquired |
| L4-F7 | Zero cap, passive, overcome | |
| L4-F8 | Airborne pairs in labelled zero gravity | Gameplay gravity unchanged |
| L4-F9 | Run, prep, contact, exit, low, rising, falling, both, crowded, rejected, transfer failed | Boundary audits match the L3 originals |
| L4-F10 | Knee, elbow, wrap, palm endings | Result frozen at the event |
| L4-F11 | Settle, disturbed, exhausted | No refill |
| L4-F12 | Mirror, left carry, render rates, pause, 20 resets | Same fixed-step trace |

> **Correction ([plan 10c](plan10.md#10c--active-fall-contract-repairs) C2 and C8, 2026-11-08):** `L4-F12-carryLeft` declared the profile's carry arm left while the ball stayed on the runner's right forearm, so the protecting arm held no ball. It is removed (U5); the protect arm is now the arm the ball is on, and a profile declaring another arm fails at the conversion. The 20-reset test's checks straight after each reset (no episodes, an empty ledger) were always true, because `reset()` builds a new fall response and arm system; each cycle is now compared at the same tick in the fall (counts and a trace hash) as well as over the whole run.

Mutation check: 17 deliberate faults in the response, envelope and allocator. Two survived the first pass, because no fixture exercised a failed transfer or a limb returning inside its slack. Both gaps now have tests, and all 17 fail the suite.

The review fixes were checked the same way, on the final settings. Each of these nine, put back, fails the suite: the twist torque without its swing term, the normalized swing axis, a cap on the summed envelope torque, absorbing commands left on after exhaustion, the impact guard switched off, the guard off together with the old impact exemption, the guard at 1 m/s, planning to 100% of the power cap, and hip swing stiffness back at 2500 N·m/rad.

## Motor-on and motor-off review

Reviewed in the lab on the installed model as still frames at stated times, plus one fall played at 0.25× (`L4-F3-model-oblique-on`). The browser tool only samples frames, so **continuous playback at normal and slow speed has not been watched.** This is my review, not user acceptance. **That review predates the review fixes,** which change 68 L4 runs; it was not repeated. The knee table and event times below are re-measured.

Only 16 of the first 62 L4 fixtures drew the installed model, and no tipped fall did. That is why the `L4-F2-model-*` and `L4-F3-model-*` twins exist.

Knee angles, left/right, installed player:

| Fixture | 0.3 s | 0.5 s | 1.0 s | Final |
| --- | --- | --- | --- | --- |
| forward on | 100/58 | 112/65 | 150/150 | 150/150 |
| forward off | 100/57 | 101/54 | 92/30 | about 36/30 |
| back on | 59/30 | 27/0 | 47/35 | 0/0 |
| back off | 58/22 | 1/67 | 0/150 | 0/150 |
| side on | 93/33 | 87/34 | 114/79 | 114/77 |
| side off | 91/23 | 69/0 | 54/0 | 0/0 |

What the frames show:

- **Hands:** in `L4-F3-model-forward-on` the arm is straight with the hand on the turf at 0.45 s, and the arm yields by 0.8 s. In the off twin it trails. Sideways the hand arrives late and does not take the fall.
- **Shoes:** stay on their shins throughout.
- **Both players:** in `L4-F10-wrap-on` the defender converts at 1.41 s, after the ending at 1.18 s, and braces on free arms because its clamps ended at 1.09 s. It stays on its hands, where the off twin lies across the runner.

Differences a reviewer should look at:

- **Forward falls end with heels on the seat.** The on case holds the knees bent; the shin passes vertical, and gravity then folds it to the 150° limit. That is physical, but it looks like a tuck rather than a landing. With hip flexion on, the final pose in `L4-F3-model-forward-on` is a curled heap.
- **A leg can fold passively.** `L4-F2-model-back-off` folds its right knee to 150° on landing, while the on twin ends straight. Outcomes differ by contact, and the response does not always look more composed.

## Disclosures

- **`L4-F5-twoPalm-on` loses its holds.** Both break by `overload` at 1.72 s, under the budget now shared with shoulder and elbow effort, while the off twin keeps them. The plan allows this ("can persist or break"), but a reviewer may want holds to last longer.

  > **Correction ([plan 10c](plan10.md#10c--active-fall-contract-repairs) C1, 2026-11-08):** the hold arm's own effort broke these holds, not their load. Its shoulder and elbow effort was added to the grasp demand before the owner budget was shared, and the scaling that caused counted as overload exposure. That contradicts the plan's "a holding defender prioritizes its valid hold". Grasps are now allocated first and effort gets only what is left (U4); `L4-F5-twoPalm-on` keeps both holds to the end of the window with no overload exposure, as its off twin does.
- **The knee is flexor only.** It never drives extension, but it does resist extension, which is where most of its negative work comes from.
- **The elbow ending occurs only in the off twin.** The on case ends on another eligible region. Rule regions were not changed.
- **The defaults are not calibrated.** Ceilings and gains are initial engineering settings, not athlete strengths.

## Reproduce

```bash
npx vitest run tests/falls.test.ts
npm run fixtures
npx vite-node scripts/probe/p09-final.ts      # headline numbers
npx vite-node scripts/probe/p09-settled.ts    # limit table
npx vite-node scripts/probe/p09-knees.ts model # knee table
npx vite-node scripts/probe/p09-table.ts '^L4-F3' # per-fixture tasks, work, limits
npx vite-node scripts/probe/p09-impact.ts     # substeps over 150 W realized, by joint
npx vite-node scripts/probe/p09-guard.ts      # guard rules evaluated offline (written for the pre-guard code)
npx vite-node scripts/probe/p09-persist.ts    # longest runs past the envelope tolerance
npm run dev
```

Lab URL form: `http://localhost:5197/?fixture=L4-F3-model-forward-on&speed=0.25&cam=oblique`. `?t=0.45` runs to that time and pauses.

## Known limits

The plan's limits stand: a small rule-based controller, a fixed core without a spine, simplified hands and ankles, no injury model, no physical gait or get-up, and an initial handoff without relative limb-swing velocities. This does not claim general biomechanical realism.
