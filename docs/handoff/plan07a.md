# Plan 07a handoff: ragdoll handoff during player contact

**Date:** 2026-11-05.
**Status:** accepted by the user on 2026-11-05 for checkpoint commit, including both review fixes. Incoming checkpoint: `89c21c1`. Plan 08 is cleared to start. Every required natural-contact case ends as an audited ragdoll:
- RH-F6-simultaneous: both players.
- RH-F5-playerBelow: the upper player, and both players in the both-falling variants.
- L2-F14-oneArmFeet: the defender.

All 22 HC variants convert where a fall happens; nobody ends as a rigid falling proxy. The intended diagnostics still fail safely: RH-F5-noRescue and L2-F8-noRescue (`jointAnchor`), an invalid candidate inside a batch, and a strict transfer audit. The tolerances, contact pairs and audits are unchanged. User acceptance covers the scoped contact continuity and conversion behavior; the declared locomotion and anatomical limits retain their later owners.

**Plan:** [07a — Ragdoll handoff during player contact](../open/07a_Ragdoll_Contact_Handoff.md). **Previous:** [plan 07 handoff](plan07.md).

## Review closeout fixes (2026-11-05)

Both review findings are repaired and included in the accepted checkpoint. **239 tests, the build and 238 regenerated fixtures pass; all 143 historical summaries remain unchanged.** User acceptance is recorded above. The sections after this closeout preserve the original 07a implementation measurements; this section records the current corrections and outcome changes.

### Final reach direction

The original `stableReach` limited its internal held direction, then blended toward the request by distance. In `HC-F2-offset`, that blend's weight grew from 0.0034 to 0.1625 in one 4.17 ms substep. From 0.5375 to 0.5417 s, A's ankle moved 12.0 cm and its knee 13.0 cm in the body frame. An outer-tick second-difference test did not catch this actual substep displacement.

`stableReach` now limits the final direction that is shown and remembers that direction. One per-leg flag keeps the turn limit active beyond the minimum-reach band until it catches up, avoiding a second release jump at the band's edge. A target exactly at the hip retains the shown direction at the flexion limit instead of losing it to `twoBone`'s fallback. Fixed bone lengths, hinge limits, push-out budget, collision checks and candidate validation remain unchanged.

In the reproduced substep, the ankle now moves **5.24 cm** and the knee **1.04 cm**. Over the complete offset fixture, the largest substep movement is **5.24 cm ankle / 5.21 cm knee**. Its right-leg one-tick second difference falls from 27.8 cm to 12.8 cm. Tests now check the final direction through the reach band and its exit, zero-distance targets, and actual knee/ankle displacement at physics substeps. The substep regression uses the existing 5 cm push-out plus nominal/fast correction rates; the previous implementation fails it. The existing outer-tick tests are retained.

### First solved response

The post-switch test and `p07a-post.ts` now seed momentum and mechanical energy from the transfer audit's **after** state, before the first solve, rather than initializing from the first solved state. A one-substep regression on `HC-F4-clear-falling` measures about 2.1 BW of initial external impulse; the old helper reported zero over that interval. All impulse caps and audit tolerances are unchanged.

For `HC-F2-bothFallL2` B, the formerly omitted first response is **13.6 BW and +37.2 J**. Including it raises the measured maximum mechanical energy gain from 207.4 J to **244.6 J** over the first 24 substeps; the largest external impulse remains about 19 BW. This is corrected measurement, not an added force or a velocity correction.

### Outcome and validation changes

The three required cases still articulate with passing audits, including both simultaneous players and the one-arm-footwork defender. The latter now converts at 1.567 s (previously 1.488 s). The corrected runner pose changes later ragdoll contacts: defenders remain supported in `RH-F6-oneArm`, `L2-F14-oneArm`, `HC-F3-mirror` and `HC-F3-phase0`. They do not become rejected or rigid falling proxies. Other one-arm variants still convert where support is lost. Tests require audited conversion for every actual fall, retain the strict required-case assertions and explicitly exercise a late defender conversion; they do not force a defender to fall to match the previous pose.

Compared with the pre-review working-tree evidence, 21 summaries change in positions, events, gaps or defender representation. Every result label is unchanged, and no historical summary changes. No braking, suspension, balance, collision-pair or transfer-tolerance setting changed. Three new regressions bring the suite from 236 to 239 tests. The user accepted the repaired contact motion and named handoffs; subsequent locomotion composition belongs to 08 and anatomical restrictions/active falls to 09.

## Incoming baseline (step 1)

Reproduced at `89c21c1` (the accepted 06a/07 checkpoint) in a separate worktree with the 07a probes.

| Case | Handoffs at `89c21c1` | Largest one-tick body-local limb second difference (first displacement) |
| --- | --- | --- |
| RH-F6-simultaneous | D and R **rejected** at 1.200 s, `externalPenetration`: D's left upper arm 12.4 cm into R's left upper arm. Both continue as rigid falling proxies. | D right elbow 26.0 cm (23.9) at 2.183 s [achieved arm, after the rejection]; R left wrist 8.6 cm |
| RH-F5-playerBelow | A accepted at 0.650 s | A right ankle **65.9 cm (62.2)** at 0.517 s; B left wrist **60.6 cm (60.6)** at 0.667 s |
| L2-F14-oneArmFeet | R 0.863 s, D 1.425 s, both accepted | D right knee 18.0 cm; R left wrist 18.4 cm |
| L2-F15-playerBelow | A accepted at 0.646 s | B left wrist 62.3 cm at 0.650 s |

Where the overlap comes from (`p07a-baseline.ts`, `p07a-contact.ts`): the overlap is already in the published poses; it is not created by turning the proxy into a ragdoll or by composing the batch. A supported proxy has torso, pelvis, head and support colliders but no limb colliders. Each player's procedural arms and legs were therefore cleared against the other player's core only, never against its limbs.
- In RH-F6-simultaneous, R's procedural left arm (variant 2) sat 12.4 cm inside D's achieved clamp arm, so both candidates failed together.
- In RH-F5-playerBelow, B's raised hand sat inside A's legs until A converted. A's legs then became colliders, and B's wrist jumped 60 cm to a clear variant in one tick.

Snap sources (`p07a-snapsrc.ts`, which attributes every one-tick limb jump from the substep pose trace):

- **A's 65.9 cm ankle** has two causes:
  - The plan 07 continuity guard advanced. When no intermediate fraction was valid, it moved to the first valid fraction toward the chosen variant, and that variant was itself invalid. The fraction went from 0.02 to 0.94 of a 0.7 m departure in one substep.
  - The push-out reversed: A's leg was reaching down at 3.7 m/s in the body frame while B's head pushed it up.
- **The achieved grip-arm jumps in RH-F6-simultaneous** were the 26 cm right elbow listed above. It came after the rejection, while D was a falling proxy whose clamp arm followed the solved contact.
- **R's elbow in the simultaneous wrap swung 24.5 cm in one tick.** The requested elbow pole lay on the shoulder–palm line (pole·dir = −1.000), so twoBone's bend plane turned freely.

## Shared fixes

All of these are in the pose and clearance path of ground-relative (suspension) poses, so legacy body-relative poses are untouched. No tolerance, contact pair, collider size, velocity or hold changes. There is no second, conversion-only pose: the candidate is still the published pose.

| # | Change | File | Effect |
| --- | --- | --- | --- |
| 1 | **Opponents' published limbs are physical for the pose.** `publishedLimbs()` turns every non-ragdoll player's last published pose into candidate-equivalent limb and shoe shapes (`poseLimbShapes`: the same `armShapes` / `legShapes` the candidate is built from). `poseClearance` adds them to the external set of a suspension player while that opponent can still convert (`!o.rag && !o.handoff`). A ragdoll's limbs are already active colliders. The map is read once per substep before any pose is built, so the player array order cannot decide who yields. | `simulation.ts`, `pose.ts` | RH-F6-simultaneous: R's arm clears D's clamp arm in the published pose, and both candidates validate (D 1.40 cm new penetration from the existing forearm clamp on R's torso, R 0). RH-F5 B's raised arm stays out of A's legs. |
| 2 | **Continuity guard without jumps.** `continuityAlpha` tries, in order: (1) the rate-limited step if valid; (2) a hold, which bisects [0, a0] for the largest valid fraction (hold plus push-out); (3) the fast bound `CONT_FAST_MPS` = 6 m/s, which bisects [a0, aF] for the smallest valid fraction; (4) otherwise, the least deep of {0, a0, aF}. It no longer advances toward an invalid candidate. | `pose.ts` | A's ankle no longer jumps 0.02 → 0.94. In the required cases, the guard never advances more than 1.5 cm past the rate-limited step (tested ≤ 2 cm). |
| 3 | **Stable bend plane (`stablePole`).** The elbow or knee bend plane turns from the previous shown joint toward the requested one by at most the angle that moves the joint `CONT_LEG_MPS` / `CONT_ARM_MPS` about the limb line. Near a degenerate pole (sine < 0.35) that bound is scaled by 1/(1 − s/0.35) and capped at `CONT_FAST_MPS`; the cap also bounds a well-defined pole, so a held plane catches up along a visible orbit instead of releasing at the band edge. A straight limb (small orbit radius) still turns freely. | `pose.ts` | The R elbow orbit (24.5 cm) is gone. The cap removes an 85 cm knee flip in HC-F2-offset, where the plane was held and then released, and the D arm at 70 cm in HC-F3-lowRunner. |
| 4 | **Stable reach direction (`stableReach`).** When push-out drives a limb target inside its minimum reach (maximum flexion), twoBone puts the end at that reach along root → target, and that direction turns arbitrarily fast near the root. A held direction now turns at `CONT_FAST_MPS` of end motion and blends to the requested direction between one and two minimum reaches. | `pose.ts` (legs) | HC-F2-offset: A's ankle moved 13.6 cm in one substep for a 3 cm target move; it now moves continuously (40 → 28 cm one-tick second difference). |
| 5 | **A tangled chosen candidate is shown pushed out.** When the chosen variant itself penetrates another body (> 12 mm, so no variant is clear), the shown limb gets the bounded push-out even after the blend toward it is complete. Before, a finished blend showed the raw variant. | `pose.ts` (legs, arms) | HC-F2-lowCarrier: A's shoe stood 13.3 cm in B's head; now pushed out. L2-F15 A's ankle went from 20.5 to 15.0 cm. |
| 6 | Wrap controller `stance` request (optional; request only, absent everywhere it was before) for the HC low-stance variants. | `controllers/wrap.ts` | — |

What was already in place and was verified, not changed:
- **`convertBatch`** builds every candidate as disabled bodies. It validates them against the representations that stay active, including other candidates and existing ragdolls. In each pass it removes every failing candidate, then revalidates the rest against the surviving proxies. It switches the accepted set atomically and remaps grips once.
- **Falling** turns off support friction and the suspension before `convertBatch`, including during a rejected conversion. `computeDrive` caps at 0 when unsupported.
- **The transfer** uses the proxy's solved bulk velocity, vertical included.

HC-F5-invalidOne exercises the batch revalidation: D's candidate is rejected (`jointAnchor`), and R is revalidated against D's surviving proxy and accepted in the same substep.

## Results

### Handoffs that changed (RH / L2; `p07-handoffs.ts` at `89c21c1` and now)

| Fixture | `89c21c1` | Now | Why |
| --- | --- | --- | --- |
| RH-F6-simultaneous | D, R rejected 1.200 s | **D, R accepted 1.200 s** | Fix 1 |
| RH-F6-twoArm | R 0.850 s; D stays up | R 0.850 s; **D accepted 1.488 s** | R's ragdoll is seeded from its now-clear pose, so D's later contact differs |
| RH-F6-oneArm, L2-F14-oneArm | D 1.375 s | D 1.483 s | same |
| L2-F14-oneArmFeet | D 1.425 s | D 1.488 s | same |

All other RH and L2 handoffs are unchanged (times, outcomes, reasons). RH-F5-noRescue and L2-F8-noRescue stay rejected (`jointAnchor`, intended). The legacy G4-F10-simultaneous-M still rejects both players (`externalPenetration`, legacy support: fix 1 applies to suspension poses only). That is recorded in `tests/ride-height.test.ts` next to its now-accepted suspension pair.

### Transfer audits (`p07a-audit.ts`)

Candidate checks: landmark continuity, new external and floor penetration (the worst pair is named), limb length and joint-anchor error, and the signed knee and elbow hinge angles (L/R knee, L/R elbow). Transfer: mass, relative linear and angular momentum error, energy change against its limit, and the transferred bulk velocity.

| Fixture, player | t (s) | landmark | new ext (worst) | hinge K/E (°) | P / L rel. err | ΔE / limit (J) | bulk v (m/s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RH-F6-simultaneous D | 1.200 | 0.0 mm | 1.40 cm (left forearm > R torso) | 59/44/31/52 | 6e-9 / 4e-8 | 4.2 / 31.7 | (1.10, −0.00, 0.24) |
| RH-F6-simultaneous R | 1.200 | 0.0 | 0 | 44/57/145/109 | 1e-8 / 2e-7 | 0.1 / 24.2 | (0.93, 0.00, 0.33) |
| RH-F5-playerBelow A | 0.650 | 0.0 | 0.61 (right shoe > B torso) | 103/117/109/109 | 5e-9 / 1e-8 | 32.5 / 314.3 | (0.63, **−3.39**, 0.01) |
| L2-F14-oneArmFeet R | 0.862 | 0.0 | 0 | 30/116/68/99 | 2e-9 / 3e-8 | 73.4 / 420.2 | (3.85, −0.33, 1.06) |
| L2-F14-oneArmFeet D | 1.488 | 0.0 | 0.61 (right thigh > R ragdoll torso) | 146/144/102/92 | 1e-8 / 3e-8 | 22.2 / 195.1 | (2.25, −1.38, 0.35) |
| HC-F2-bothFall B, A | 0.487, 0.667 | 0.0 | 0 / 0.91 (A shin > B ragdoll arm) | — | ≤ 3e-8 | 0.0 / 10.0, 42.4 / 522.7 | A (0.27, −4.51, −0.01) |

Every mass difference is 0. Length and anchor errors are 0.00 mm. The tolerances are unchanged: landmark 0.01 m, new penetration 0.015 m. The full table for all HC fixtures is printed by `vite-node scripts/probe/p07a-audit.ts`.

### First solved steps after acceptance (`p07a-post.ts`, 24 substeps)

The worst player penetration in the first step is 1.4 cm: the existing clamp forearm on R's torso in the simultaneous wrap, also at 0.9 and 1.6 s. Anchor separation is ≤ 1.3 mm. External impulse on the bulk is ≤ 5.4 BW per step in the wraps, 13–19 BW where a ragdoll lands on another body (HC-F2-bothFall A 13 BW, bothFallL2 19 BW), and ≤ 6.7 BW in the one-arm tackles. No hand-anchor jumps: no passive grips exist in these cases.

Mechanical energy (KE + m g y) rises after the switch only where another body does work on the ragdoll:
- the supported defender driving through the runner: HC-F3 R up to 82 J, HC-F3-lowRunner R 208 J;
- A landing on B: HC-F2-bothFallL2 B 210 J, which equals A's loss.

The transfer audit bounds the energy change at the switch; no velocity is corrected afterward (`tests/handoff-contact.test.ts`: penetration ≤ 2 cm, anchors ≤ 5 mm, external impulse < 25 BW). The review closeout above corrects this section's original post-solve measurement baseline to include the first response.

### Contact continuity (`p07a-snapsrc.ts`, body-local one-tick second difference, first displacement)

| Case, limb | `89c21c1` | Now | Source now |
| --- | --- | --- | --- |
| RH-F5-playerBelow A right ankle | 65.9 (62.2) cm | 10.7 (11.6) | switch, pushed by B's head |
| RH-F5-playerBelow B left wrist | 60.6 (60.6) | 11.5 (11.6) left elbow | switch |
| RH-F6-simultaneous achieved grip arms | 26.0 (23.9) | 6.9 / 6.6 | achieved (arm system) |
| RH-F6-simultaneous R left arm | 8.6 | 12.0 (5.2) | switch |
| L2-F15-playerBelow B left wrist | 62.3 | 9.9 (2.0) | push |
| L2-F15-playerBelow A right ankle | 15.6 | 15.0 (6.2) | push |
| L2-F14-oneArmFeet D right leg | 18.0 | 21.7 (15.7) | advance 1.5 cm past the rate step, push 5 cm (R and D meet at 7 m/s) |
| L2-F14-oneArmFeet R left arm | 18.4 | 20.0 (15.4) | the bend plane catching up (fix 3) as D's limbs arrive |

Non-contact RH and L2 fixtures have the same count of snaps over 12 cm by source as `89c21c1`. Contact fixtures are equal or lower, except these, recorded here:
- RH-F6-twoArm D's achieved clamp arm: 26.0 cm at 1.467 s (was 12.1), after R's different ragdoll.
- L2-F8-sideLoss D's left ankle: 27.9 cm switch (was 22.4; its 76 clip-request snaps are 08 scope).

Every HC variant stays ≤ 0.3 m. The largest is HC-F2-offset A's knee at 27.8 cm: A's leg folds over B's shoulder while A slides off.

## HC fixtures (`src/sim/fixtures/handoff-contact.ts`, 22)

All are built from the required cases on their adopted profiles: `support-suspension-rh-v1` for RH-F6/RH-F5 and the repaired `SUSPENSION_L2` with `FOOTWORK_L2` for L2-F14. The simulation reads no fixture-specific offset or time. `mirrorZ` reflects a fixture across z = 0:
- positions, velocities and world directions;
- yaw → 180° − yaw; angular velocity (−x, −y, z); body-local lateral flip;
- left and right swapped (arms, plans, segments, clip phase + 0.5);
- rules sideline and ball.

It is an involution on fixtures without clip phases (tested).

| Group | Fixtures | Outcome |
| --- | --- | --- |
| HC-F1 simultaneous wrap | mirror, at 0.9 s, at 1.6 s, low stance (0.78 m), low mirrored | both players accepted at the batch substep in all five |
| HC-F2 stack | lift 1.4 m, lift 3.0 m, offset 0.18 m, low carrier (B 0.78 m), bothFall (RH), bothFallL2 (repaired support) | A converts in lift 1.4 / 3.0 (B also falls at lift 1.4); in offset and lowCarrier, A slides off B and lands on its feet beside B, so there is no fall; both players are audited ragdolls in bothFall(L2) |
| HC-F3 one-arm tackle with feet | mirror, defender clip phase 0 / 0.5 / 0.75, defender converted on its rising / falling bob in contact, low runner | D accepted in all but the low runner, where D stays up (a changed outcome, not prescribed) |
| HC-F4 clear space | Fast Run on the repaired support with feet, rising / falling bob | accepted, vertical bulk velocity transferred (0.06 / −0.07 m/s) |
| HC-F5 diagnostics | invalidOne (5 cm forearm offset on D in the simultaneous batch), strictTransfer (no energy gain allowed) | D rejected and R accepted in the same substep; both players `transferFailed`, `invalidTransfer`, no ending |

The standing wrap has no vertical bob (|v_y| < 0.002 m/s), so the bob variants use the running one-arm tackle and the clear-space run.

## Effect on existing evidence (`npm run fixtures`, 238 summaries)

- **Historical entries:** all 143 (G1–G4, G4-M, L1) are byte-identical to `89c21c1`. Every 07a change is gated on the suspension support or the ground-relative pose.
- **Changed RH and L2 entries (14, original implementation):** every result label is unchanged; changed handoff decisions are listed above. Final positions after a conversion, event counts and closest pair gaps also move. The ragdoll is seeded from the published pose, and that pose differs in contact:
  - RH-F5-playerBelow, RH-F6-collision / twoArm / oneArm / simultaneous / sideRecover / sideLoss;
  - L2-F8-sideLoss, L2-F14-oneArm / oneArmFeet, L2-F15-playerBelow / overload.
- **Single-player runs** RH-F5-invalidNormal and RH-F7-falling move by millimetres. In clear space the bend-plane cap (fix 3) changes published poses by at most 4.6 mm (RH-F3-fastRun and L2-F11-fastRun), 0.9 mm in the run stops and 2.2 mm in RH-F7. Standing, crouch and stagger poses are unchanged.
- **New:** the 22 HC entries.

## Reproducibility and order

- **Same decisions.** Fresh, reset-after-conversion, paused, 30 Hz and 144 Hz runs of RH-F6-simultaneous, L2-F14-oneArmFeet, HC-F2-bothFall and HC-F5-invalidOne give identical events, traces and body/joint/collider/grip counts (tested).
- **Reversed player order.** Batch decisions are identical: RH-F6-simultaneous, HC-F1, HC-F4 and HC-F5-invalidOne match in players, outcomes, substeps and reasons.
- **Natural-fall timing still depends on body order** through the solver's contact order, as recorded in G4-F8. For example, RH-F5-playerBelow A converts at step 156 normally and 295 reversed, and B then falls too. The numbers are identical at `89c21c1`, because the pose never feeds the solver; this is not a 07a change. HC-F2-lowCarrier flips between landing and falling.

## Tests

- **New: `tests/handoff-contact.test.ts` (18 tests):**
  - the required cases are audited ragdolls, with no false support of A on B and no suspension force while falling;
  - the first solved steps after acceptance;
  - mirror involution;
  - every HC variant either converts with an audit or stays up, never ending as a rigid falling proxy;
  - batch revalidation with an invalid candidate, strict transfer, and the noRescue rejections;
  - reset, pause and render-rate reproducibility, and reversed order;
  - continuity: required cases ≤ 0.15 m (L2-F15 ≤ 0.2 m), HC ≤ 0.3 m, guard advance ≤ 2 cm.
- **Changed: `tests/ride-height.test.ts`.** G4-F10-simultaneous-M's known rejection is retained on the legacy support, and its RH-F6-simultaneous pair now accepts.

## Commands (actually run)

```
npx tsc --noEmit
npx vitest run tests/handoff-contact.test.ts
npx vitest run
npm run fixtures
npm run build
vite-node scripts/probe/p07-handoffs.ts '^RH-|^L2-|^HC-'
vite-node scripts/probe/p07a-audit.ts            # candidate / transfer audits
vite-node scripts/probe/p07a-post.ts '^HC-'      # first solved steps after acceptance
vite-node scripts/probe/p07a-snapsrc.ts '^RH-|^L2-|^HC-' --min 12   # snaps by source
vite-node scripts/probe/p07-legtrace.ts <fixture> <player:leftLeg|rightArm...> <from> <to>   # substep pose trace
vite-node scripts/probe/p07a-contact.ts <fixture> <player> <from> <to>   # published-limb overlaps per tick
```

## Files

- `src/sim/pose.ts`: `poseLimbShapes`, `stablePole`, `stableReach`, `continuityAlpha` order, pushed tangled candidates.
- `src/sim/simulation.ts`: `publishedLimbs`, `poseClearance` limbs.
- `src/sim/controllers/wrap.ts`: the `stance` request.
- `src/sim/fixtures/handoff-contact.ts` (new), `src/sim/fixtures/index.ts`, `src/lab/main.ts` (the HC group).
- `tests/handoff-contact.test.ts` (new), `tests/ride-height.test.ts`.
- Probes: `scripts/probe/p07a-{baseline,contact,snapsrc,post,audit}.ts`, `p07-legtrace.ts` (JSON objects).
- Evidence: `evidence/summary.json` (238 summaries).

## Remaining failures and limits

1. **No required natural-contact case falls rigidly.** The rejections that remain are the intended diagnostics: RH-F5-noRescue, L2-F8-noRescue and HC-F5-invalidOne D.
2. **Contact motion, not pose selection.** Limb motion while two bodies meet at speed is bounded but visible: push-out at ≤ 5 cm per substep, and the bend plane and reach direction at ≤ 6 m/s. Examples are L2-F14-oneArmFeet D's leg at 21.7 cm and R's arm at 20.0 cm. A body landing on another folds its legs (HC-F2-offset A's knee at 27.8 cm). These are one-tick second differences, not teleports, and the substep trace names the source of each.
3. **Achieved grip arms belong to the arm system.** They follow the solved contact; for example, RH-F6-twoArm D's clamp arm at 26 cm after R converts. 07a does not change the arm system.
4. **Published limbs are excluded once an opponent has a final handoff record** (rejected, or a ragdoll), because they will not become colliders.
5. **Natural-fall timing depends on body order** (pre-existing; see above).
6. **User acceptance recorded, 2026-11-05.** The scoped checks cover the repaired offset motion (`HC-F2-offset`, around 0.45–0.75 s), stacked-player contact (`RH-F5-playerBelow`), simultaneous conversion (`RH-F6-simultaneous`, around 1.2 s) and one-arm-footwork fall (`L2-F14-oneArmFeet`, defender around 1.57 s). Keep these as visual regressions during 08. The fixtures remain in the lab's **HC · ragdoll handoff during contact** group (`npm run dev`, then `?fixture=<id>`).
