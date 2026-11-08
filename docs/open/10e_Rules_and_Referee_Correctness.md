# 10e — Rules and referee correctness

Repository-aligned plan • 2026-11-08 • **Implemented 2026-11-08** ([handoff](../handoff/plan10.md#10e--rules-and-referee-correctness)): full suite green; rules revision 2 (`+revision=2`) opted in on every L3 and L4 rule profile, historical exports byte-identical; the settle window keeps stance and yaw effort, influence clears only out of contact, progress counts opposing retention, excluded regions refused; two L3 summaries changed (progress windows only), no ending or spot changed. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first. Uses the ground predicate from [10c C3](10c_Active_Fall_Contract_Repairs.md#c3-three-different-definitions-of-ground-p3-reported-decision-u6).

**Goal:** the settle window keeps what it should, influence and progress follow contact and direction, and ground touch uses the shared ground definition.

**Profile policy (U8):** E2–E4 change rule decisions. Ship them as a new rules profile version opted in on L3 and L4. Historical fixtures keep the current profile unless the user rules otherwise. The official spot stays frozen at the ending, and `ballRef` is unchanged.

## E1. The settle-window override drops the stance request (P3, Checked; decision U9)

**Problem:** after a referee ending, `src/sim/simulation.ts:904-908` replaces the whole intent with `{ locomotion: { desiredVelocityWorld: 0, desiredFacingWorld, effort: 1 } }`. The comment says arm requests and posture lean are dropped on purpose, and that stays. The override also drops `locomotion.stance` (the plan 06a ride height and stagger) and `yawEffort`. A player in a lowered stance therefore returns to the profile's standing height during the settle window.

**Fix:** carry `locomotion.stance` through the override; decide `yawEffort` explicitly. Keep dropping arms and posture.

**Impact:** settle-window motion changes in rule fixtures with stance requests, which may include committed summaries; apply only on the user's ruling (U9), or under the new rules profile.

## E2. Influence clears while the request is zero (P3, Checked)

**Problem:** in `src/sim/rules.ts:268-276`, `along` is set to `rq` when the request is near zero, so `along >= unrestrainedFraction × rq` holds trivially. Any supported, grounded proxy with a zero request therefore counts as moving freely, and influence clears after `clearAfterSupportedS` regardless of contact. `progressStopped` can then flip.

**Fix:** base freedom on contact and retention state together with motion, so a zero request in contact never counts as free.

**Regression:** a runner held in contact with a zero request keeps influence.

## E3. Progress retention uses force magnitude, not direction (P3, Reported)

**Problem:** `src/sim/rules.ts:346-356` projects the runner's request onto the progress axis `this.fwd`, but sums retention forces as a vector and uses its full length. A sideways or forward retention force counts as fully opposing progress.

**Fix:** take the component opposing progress (−`fwd`).

**Regression:** a sideways-only restraint does not count as progress retained.

## E4. Ground touch matches the floor key only (P3, Reported)

**Problem:** `src/sim/rules.ts:204` treats only `other.key === 'floor'` as ground, so a touch on a static obstacle never counts. `EXCLUDED_GROUND_REGIONS` (19) is declared and unused. Only `G4-F7-wallNoOpponent` combines obstacles with rules today, so this is latent.

**Fix:** use the shared ground predicate from 10c C3. Wire in the exclusion list or delete it.

## Acceptance

- Each fix has its regression.
- Historical fixtures are byte-identical unless the user ruled otherwise.
- Changed endings and spots under the new profile are listed per fixture.
- Spots stay frozen after the ending.
