# 10c — Active fall contract repairs

Repository-aligned plan • 2026-11-08 • Not started. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first. Repairs plan [09](09_Active_Falls_Joint_Limits_and_Role_Responses.md) before its user review.

**Goal:** the response obeys its own role priorities, tasks act on the real carry and real contacts, and the effort evidence measures something. The power, work, envelope and momentum audits stay as they are; they were checked and are sound.

**Summary impact:** L4 summaries change; C6 may touch HC fixtures. Record every change, including brace contact and miss counts (currently 30 palm contacts; 24 misses: 9 late, 7 too far, 7 obstructed, 1 expired).

## C1. A hold arm's own effort overloads and releases its grasp (P2, Checked; decision U4)

**Problem:**

- A hold arm drives toward its conversion pose at `holdScale` gain (`src/sim/fall-response.ts:401`).
- `ArmSystem` converts that torque to a force equivalent (shoulder N·m / upper-arm length + elbow N·m / forearm length) and adds it to the grasp demand before sharing the owner budget (`src/sim/arms.ts:764-786`).
- Any scaling caused by that effort then counts as grip overload exposure (801–811).
- `release(..., 'overload')` follows (864).

**Evidence (Reported numbers):**

- `L4-F5-twoPalm-on` converts at 0.9 s. Per arm: grasp about 126–138 N plus equivalent about 50–55 N; total about 370 N against the 350 N owner budget, shared scale 0.94–0.97 in 176 of 362 ledger entries.
- Overload exposure starts at about 1.43 s and both grips release `overload` at 1.717 s; the fall task then goes hold to passive with `holdLost`.
- The response-off twin keeps exposure at 0 throughout.

The plan 09 handoff (:176) discloses this as allowed ("can persist or break"), but the plan also requires that "a holding defender prioritizes its valid hold" and forbids "a held tackler reflexively dropping a wrap".

**Options (U4):**

- (a) Allocate grasp first within the same owner budget and give hold-arm torque only what remains. Recommended: it keeps the single shared budget the plan requires and gives the hold priority.
- (b) Make the hold task damping-only.
- (c) Measure overload exposure against the allocation the grasp would have without effort.

**Regression:** across every L4 on/off twin, a hold that survives with the response off survives with it on, unless the ledger shows grasp demand alone over the budget. Include `L4-F5-twoPalm-on` explicitly.

## C2. `L4-F12-carryLeft` protects the empty arm (P2, Checked; decision U5)

**Problem:** the runner's protect arm is `this.P.arms.carryArm` (`src/sim/fall-response.ts:219`), a config value. The ball is hard-coded to the right forearm: `src/sim/ragdoll.ts:218` and `:301`, and the carry in `src/sim/pose.ts`.

`L4-F12-carryLeft` (`src/sim/fixtures/falls.ts:255-259`) only sets `carryArm: 'left'` on a mirrored fall. So the empty left arm "protects" while the ball arm braces into the floor. The test asserting `{ left: 'protect', right: 'brace' }` only echoes the config.

**Fix:**

- Derive the protect arm from the actual carry (`pose.carry` side, or the segment of the ragdoll's `carriedBall` landmark).
- Assert in `begin()` that config and carry agree.
- Drop `L4-F12-carryLeft` until a mirrored carry exists. A mirrored carry is outside 08a, which excluded switching hands; it would be its own plan.

## C3. Three different definitions of ground (P3, Reported; decision U6)

**Problem:**

- `coreDown` is set only for contacts with `other.key === 'floor' && other.playerId === null` (`src/sim/fall-response.ts:262-264`).
- Ragdoll `grounded` uses the region `'floor'`, which obstacles also carry (`src/sim/simulation.ts:1429-1440`).
- Rules use `other.key !== 'floor'` ([10e E4](10e_Rules_and_Referee_Correctness.md#e4-ground-touch-matches-the-floor-key-only-p3-reported)).

**Consequence:** a torso or pelvis landing on an obstacle never sets `coreDown`, so `missBrace` (287) never fires and a seeking brace runs until it expires. A lost hold goes to brace instead of passive (271).

**Fix:** one ground predicate keyed on a collider tag or group, shared by fall response, ragdoll grounding and rules. Whether obstacles count as ground is the user's decision (U6).

## C4. `obstructed` is sticky and set by the player's own hold (P3, Checked)

**Problem:** `src/sim/fall-response.ts:265` sets `arms[arm].obstructed = true` for any arm contact with the opponent or an obstacle, at any time in the episode. That includes the defender's own hold contact on the runner. It is never cleared, so line 287 can report a miss as `obstructed` long after the contact ended.

**Fix:**

- Set it only while the arm is in brace/seek.
- Exclude contacts the arm system reports as retained.
- Clear it per substep or after a declared window.

**Regression:** a brace that is obstructed and then clears reports a different miss reason or a contact.

## C5. `rotateToward` skips its rate limit for opposite vectors (P3, Checked)

`src/sim/fall-response.ts:158` returns `to` when `s < 1e-9`, which includes `from ≈ −to`; the brace direction then jumps π in one substep, skipping the 30°/s smoothing. Rotate by `maxRad` about a perpendicular axis, for example the cross product with the least-aligned basis axis.

**Regression:** an antiparallel unit test.

## C6. Natural-contact articulation depends on player order (P3, Checked from the 2026-11-08 test output; decision U7)

**Problem:** the reversed-order test (`tests/handoff-contact.test.ts:368-385`) requires identical results only for diagnostic batches and records natural-fall deviations. In the 2026-11-08 run:

- `HC-F2-bothFallL2` reversed: A goes from accepted to `rejected(externalPenetration)` and ends as a rigid falling proxy.
- `HC-F3-mirror` reversed: D falls and converts where it did not fall before.

So the variant guarantee "nobody ends as a rigid falling proxy" holds for one body order only. The solver's contact order follows body order, which the test acknowledges for timing; a validity flip is a stronger effect.

**Fix:** run the no-proxy assertion of the HC variant test in both orders. Trace the reversed `HC-F2-bothFallL2` rejection at the conversion substep. Do not loosen validation: fix the candidate or, on the user's ruling (U7), declare the limit.

## C7. Effort bookkeeping (P3)

- **`pairSum` is always 0 (Checked):** `src/sim/fall-response.ts:504` builds `onParent = scale(t, −1)` and reports `len(add(t, onParent))`; `src/sim/arms.ts:853` does the same with forces. The `toBe(0)` assertion proves nothing. Equal and opposite application is established by the L4-F8 zero-gravity momentum test, which is valid because `SOLVER_G1`/`G4` damping is 0. Either compute the sum from what each body actually received, or delete the field and assertion and cite L4-F8.
- **`activeSubsteps` counts torque-free substeps (Checked):** `src/sim/fall-response.ts:512` increments unconditionally. Count only substeps with some applied torque.
- **Ledgers grow without bound (Checked):** `keepLedger = true` by default (`src/sim/fall-response.ts:165`, `src/sim/arms.ts:265`), with entries pushed per joint or arm per substep. This grows memory linearly in long lab sessions. Default it off outside tests and export, or use a ring buffer; keep the running totals in stats.
- **Two twist measures (Reported):** `startOutsideDeg` (`src/sim/ragdoll.ts:551`) uses unscaled twist slack; `overDeg` (593) uses the twist excess scaled by cos(swing / 2). Use one measure or report both with labels, and state in the handoff that twist overshoot is the scaled measure.

## C8. Fall tests that do not establish their claims (P3, Reported)

- **20-reset checks:** `episodes.size === 0` and `ledger.length === 0` straight after reset are always true, because `reset()` builds a new `FallResponse` and `ArmSystem`. Compare counts and full trace hashes after running to the same tick on each cycle.
- **"Arm yields once it lands":** measures forearm world translation (`moved > 0.01`), which moves with the falling body anyway. Measure palm motion relative to the floor contact point, or elbow angle change under load after `braceContact`.
- **`tests/falls.test.ts:915` and `:918`:** can pass with zero matching items. Assert a non-zero count first.

## C9. Plan 09 handoff corrections (Docs, Checked)

Update `docs/handoff/plan09.md`:

- holding priority (C1);
- the left carry (C2);
- `pairSum` as evidence (C7);
- the 20-reset claims (C8);
- the clean exit claim ([10a A1](10a_Test_Gate_and_Evidence_Integrity.md#a1-the-test-gate-exits-1-when-every-test-passes-p1-checked)).

## Acceptance

- The power, work, envelope persistence and momentum audits pass at their current limits.
- C1's twin regression holds.
- `L4-F12-carryLeft` is removed or correct.
- Miss reasons are reported before and after C3/C4.
- Changed L4 summaries are listed.
- Then the user's 09 review.
