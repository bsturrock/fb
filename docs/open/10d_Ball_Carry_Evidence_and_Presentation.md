# 10d — Ball carry evidence and presentation

Repository-aligned plan • 2026-11-08 • Not started. Part of the [codebase review milestones](10_Codebase_Review_Milestones.md); read its evidence labels and ground rules first. Repairs plan [08a](08a_Ball_Carry_Pose_and_Placement.md) evidence before its visual acceptance.

**Goal:** the 08a contracts are proven by tests with an independent reference, the hand and ball look right on achieved arms, and the lab stops allocating per frame. The carry math itself needs no change: it matches the donor to about 1e-16, mirrors exactly, and the calibration roll holds. One football per scene, interpolation reset and slerp sign handling were also checked.

**Summary impact:** none from the tests. D3 and D4 can move the ball seat on achieved arms, and with it the rules ball reference and spots in L3/L4; record each change.

## D1. Circular carry contract tests (P2, Checked)

In `tests/ball-carry.test.ts`:

- **(a) :295–319, "rule reference, drawn ball and official spot agree":** `ref` is `lm.carriedBall` (`src/sim/rules.ts:186`) and "drawn" is `carriedBall(R.pose)` (`src/sim/pose.ts:59-62`). Both come from the same forearm frame and seat, so the 1e-6 match always holds. The test never reaches the lab's drawn ball (`src/lab/main.ts:764-772`, `src/lab/views.ts:326-328`) or exported evidence, and it covers only `slice(0, 12)` of the L3 fixtures.

  Fix: compare `ballRef` with exported evidence (ending ball spot and any per-tick ball trace) on every tick. Move the lab's ball choice into a pure function and test that it returns `carriedBall` at alpha = 1.
- **(b) :216–219 and :227–233, "ball stays seated" and "blocked arm carries the ball where the arm went":** `dist(ball, elbow) == hypot(along, out)` holds by construction of `seatBallLocal`. The blocked-arm case filters rows with residual over 0.05 and then compares the ball with itself; it would pass with the ball placed from the unachieved request.

  Fix: rebuild the requested-arm ball from `carryRequest`, the shoulder and segment lengths, and assert the drawn ball is about the residual away from it. Check the ball against the achieved forearm and hand landmarks without going through `seatBallLocal`.
- **(c) :321–337, "render blend stays seated":** uses `mid.q = f1.rotationWorld`, not a blend, then asserts an identity.

  Fix: export the lab's `lerpPose` (`src/lab/main.ts:131-146`) and test `carriedBall(lerpPose(a, b, t))` against the blended palm and the rig.
- **(d) :394–402, "reset reproduces a fresh run":** runs two fresh `Simulation.create` runs and never calls `reset()`.

  Fix: run to the end, `reset()`, run again, and compare seat and ball on every row.
- **(e) :339–349, "historical fixtures publish no carry data":** passes only because of `.slice(0, 40)`. 22 L4 fixtures inherit `CARRY_L3` through `asL4(l3(...))` (`src/sim/fixtures/falls.ts:63-165`).

  Fix: filter the historical milestones (G, L1, L2, RH, HC) with no slice, and separately assert that L4 inherits the carry on purpose.

## D2. Mesh seating controls are too weak (P2, Reported)

**Problem:** `tests/ball-carry-mesh.test.ts:110-127` uses loose criteria (fore > −0.05, foreMax < 0.02, front < 0.02, tip < 0.04) and controls shifted 8–10 cm.

**Evidence (Reported):**

- Still passing when wrong: a ball moved 5 cm along its axis, moved ±5 cm sideways, rotated 90° about its axis, or tilted 30°.
- Roll errors (±π/2, 0, and the legacy rig without roll or flex) fail only on the 4 cm tip threshold.
- The donor's axis-offset check and its blend-against-rise correlation check were dropped.

**Fix:**

- Controls at 3–5 cm lateral and axial offsets, a 30° tilt and a 90° roll, each required to fail.
- An axis-alignment check of the ball axis against the forearm within the authored seat tilt.
- A roll check that does not rest on the tip alone.
- Restore the donor's two checks.

If the real carry fails a restored donor check, report it; do not loosen it.

## D3. An achieved right arm still gets the carry roll and flex (P3, Checked)

**Problem:**

- `carryArm` is computed even when the right arm is achieved (`given`: reaching or held). Then `seat = given ? { ...carryArm.seat, flexRad: 0 } : carryArm.seat` is published (`src/sim/pose.ts:954-957`, out at 1235).
- The simulation palm landmark is not overwritten (it uses `reach`, 772). But `RigAdapter` (`src/lab/rig-adapter.ts:135-143`) rolls the achieved forearm and hand by the request's roll, about −1.2 to −1.9 rad, so a reaching or holding hand is drawn twisted palm-in with the ball on it.
- At an ownership change, flex jumps between the seat value and 0 in one frame (about 8 cm at the drawn palm, Reported), and roll snaps.

**Fix:** decide where the ball sits while the right arm is achieved; rules still need a ball location. Publish a roll derived from the achieved frame, or none. Blend roll and flex over a declared interval (about 0.15 s) at ownership changes.

**Regression:** the hand stays continuous across ownership changes, measured on the published landmarks and on the rig.

## D4. The seat is set in the request frame and placed in the achieved frame (P3, Reported)

**Problem:** `rollRad = atan2(dot(inside, hz), −dot(inside, hx))` is computed from the request chain (`src/sim/pose.ts:764`, 822–847). The ball is placed in the achieved `chain.frameB`, whose X is the hinge axis `cross(upper, fore)`. When the achieved arm is an `ARM_ALTS` alternative (470–480) or the near-straight hinge fallback, that axis can swing far from the request, or be arbitrary when the arm is nearly straight. The ball's inside direction then turns with it and can sit outside the arm or in the torso. The ball is not in clearance, and an infeasible fit shows only as `targetResidualM`.

**Fix:** set the seat's inside direction against a chest-inside reference in the achieved frame. Add the ball capsule to clearance, reporting an infeasible fit rather than allowing penetration.

**Regression:** alternative and near-straight arm cases with the ball outside the torso.

## D5. Lab hot paths and blend mismatch (Polish, Reported)

- `src/lab/rig-adapter.ts:123` and `:128` allocate `Matrix4`, `Vector3` and `Quaternion` per driven bone per frame.
- `forwardBallQ` in `src/lab/football.ts` allocates per call, and `capturePrev` in `src/lab/main.ts` runs a `structuredClone` every tick.

  Fix: reuse scratch members for both.
- `lerpV` and `slerpQ` in `src/lab/main.ts:118-124` duplicate `vec.ts`, and `slerpQ` allocates two three.js quaternions per segment per frame.
- `lerpPose` blends landmarks linearly but segments by slerp, so mid-frame the primitive hand and palm can differ from the ball and model by a few millimetres. Derive the drawn landmarks from the blended segments, or blend the seat from the blended forearm consistently.
- A material shared by football instances is disposed twice (harmless in three 0.170). Dispose once.

## D6. 08a handoff corrections (Docs, Checked)

Update the 08a section of `docs/handoff/plan08.md`:

- "reset reproduces a fresh run" (D1 d);
- "drawn ball equals rule reference equals evidence" (D1 a);
- "carry profile exported" ([10a A3](10a_Test_Gate_and_Evidence_Integrity.md#a3-exports-name-the-carry-profile-but-omit-its-values-p2-checked));
- the mesh negative controls (D2).

## Acceptance

- Every D1 test fails when its contract is broken on purpose. Demonstrate this once per test in the handoff.
- D2's controls fail.
- Ownership changes are continuous on the hand.
- Changed L3/L4 ball spots and endings are listed.
- Then the user's 08a visual review beside the donor.
