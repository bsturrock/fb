# Contact motion handoff

Plan: [contact motion](../open/contact-motion/README.md), four milestones, one commit each, each stopped for the user's
lab review before the next starts. User rulings (2026-11-10): plan 14 committed first as its own checkpoint (`2e5344a`);
new profiles on L3, L4 and HC only, with G, L1, L2 and RH byte-identical; knock-on regressions investigated, not pinned
as new baselines (below).

## M1 — Anatomical, continuous limb rotation

Plan: [01-limb-rotation](../open/contact-motion/01-limb-rotation.md). Implemented 2026-11-10 after `2e5344a`.

**Result:**
- **The upper arm's twist is now constrained.** Under `joint-range-v2` (`JOINT_RANGE_V2`: plan 12's ranges plus
  `shoulderTwist: { marginDeg: 2, maxRateRadPs: 12 }`, on every L3, L4 and HC fixture) the supported pose and the
  arm-task arms keep the shoulder's external twist inside the ragdoll envelope's twist range ([-100, 100] deg) less
  2 deg, turning at most 12 rad/s (11.5 deg per tick) from the last shown twist. The palm, the reach and the plan 12 swing
  cone are kept; only the elbow's position around the shoulder-to-palm line changes.
- **Measured on the review fixtures** (L3-F4-twoArm, L3-F3-side, L3-F8-recontact, L4-F9-contact, HC-F3-phase0,
  L3-F6-hold, HC-F1-low, L4-F5-twoClamp-on; `.scratch/cm1/twsum.ts`):

  | Arm | Past the twist range, v1 | v2 | Largest change in one tick, v1 | v2 |
  | --- | --- | --- | --- | --- |
  | Supported pose | 77.7 deg (L3-F3-side D.left, elbow up) | 0 | 96.7 deg (L3-F3-side R.left) | 11.5 deg |
  | Arm task | 1.7 deg | 0 | 32.6 deg | **55.6 deg** (L3-F4-twoArm D.left, 0.867 s; see misses) |
  | Ragdoll | 20.8 deg | 35.9 deg (HC-F3-phase0 R.right, brief; see misses) | 40.3 deg | 33.3 deg |

- **Conversion carries continuity.** The accepted pose now starts inside the twist range, so the ragdoll's start slack
  vanishes where the old pose was rolled: L4-F9-crowded R 51.3 deg to 0, L4-F9-defenderFalling D 32 to 0,
  L4-F9-defenderRising D 16 to 0.
- **Conversions:** no new rejection on L3 or L4 in either body order (with the prerequisite fix below); every invalid
  diagnostic stays invalid. One reversed-order change in a deliberately invalid HC fixture (misses).
- **Evidence.** 411 exported. G, L1, L2 and RH byte-identical; 78 summaries change (HC 17, L3 46, L4 15), no result
  change. **Tests:** 250 in 13 files, all pass. Typecheck and build pass.

### Diagnosis

- **Physical, not rendering.** The rig adapter sets each bone to its segment times a fixed bind correction, so the mesh
  follows the segments exactly; the calibration's rest hinge axes put the left upper arm's X near -Y in the T-pose, so
  elbow flexion folds the forearm forward on both sides. The shown elbows were where the segments put them.
- **The elbow plane was free.** The supported pose and the arm-task arms place the elbow from a pole (two-bone IK); plan 12
  limits only the upper arm's direction (swing). Nothing limited its roll about its own axis, so the elbow could point up
  or backward with the hand where it should be: L3-F3-side D's raised left arm reached -178 deg (elbow straight up).
- **The roll jumped.** A nearly straight free arm (1.9 deg elbow) has no stable pole; when plan 12's cone clamp turned
  it rigidly (the palm target behind the back on an `ARM_ALTS` alternative), the elbow plane swung 80-97 deg in one tick
  (L3-F4-twoArm, L3-F1-phase0, L3-F4-oneArm and HC-F3-phase0 R.left at 0.533 s). Arm-task arms jumped 20-30 deg a tick
  where the pole candidates switched.
- **The ragdoll already had a twist range** (plan 09's soft envelope, 400 N m/rad), so a rolled supported arm became
  start slack at conversion, or a kick where the slack had decayed.

### What changed

- `src/sim/joint-cone.ts`: `limbTwistRad` / `armTwistRad` (the envelope's own swing-twist measure applied to a two-bone
  arm: hanging-limb reference, neutral at 180 deg; checked against the anatomical poses and random hinge frames on both
  sides), `twistWindow` (the range less the margin, intersected with the rate window around the last twist), and
  `fitElbowTwist` (Newton on the elbow's turn about the shoulder-to-palm line, palm and reach kept) and
  `turnForearmTwist` (a final forearm turn about the upper arm, cone unchanged).
- `src/sim/profiles.ts`: `ShoulderTwistProfile`, `JointRangeProfile.shoulderTwist`, `JOINT_RANGE_V2`.
- `src/sim/pose.ts`: the procedural arm fits the twist after the IK and re-applies the plan 12 cone after each fit (two
  passes, then the forearm turn); the shown twist is kept in pose memory for the next window.
- `src/sim/arms.ts`: `solveArm` tries the pole candidates through windows of widening rate (`TWIST_WIDEN`, 1x, 3x and 9x),
  then the range alone, then the plan 12 path unchanged; within a window, candidates nearest the previous elbow first;
  identical fitted elbows are not queried twice (the shape-query budget). Without the profile the order and the queries
  are the old ones.
- Fixtures: `asL3`, `asL4` and the HC `label` set `JOINT_RANGE_V2`.

### Prerequisite fix: the plan 10c deep leg push on L3 and L4

The twist fix moves the arms, the contact and so the conversion moments; six conversions in either order became
rejections for external penetration (L3-F1-phase1 reversed 5.09 cm, L3-F1-phase2 and L3-F4-oneArm 2.08 / 1.88 cm in both
orders, L4-F10-wrap-off 4.87 cm), each a defender's thigh or shin in the runner's ragdoll.

Each is plan 10c C6's class: a convertible player's shown leg past the guard's own 1.2 cm threshold that the ordinary
4-iteration push cannot clear (moving the ankle moves the thigh little). Without the deep push the converting leg sits
past 1.2 cm and sinks over the last substeps (L3-F1-phase1 reversed: 1.16, 1.50 ... 4.97, 5.75 cm; L4-F10-wrap-off to
4.98 cm), and the rejected candidate inherits that depth. `withPoseGuard` (`POSE_GUARD_C6`: 12 iterations within the
same 5 cm per-substep cap), on every HC variant since 10c, now also wraps the ragdoll of every L3 (`asL3`) and L4
(`asL4`) fixture. All six convert (0.00-1.15 cm), and the supported substeps with a leg past 1.2 cm fall (29 to 11,
20 to 6, 17 to 15, 32 to 8). Across all 2243 L3 transition boundaries it changes two: L3-F3-collision D's right shoe
1.410 to 1.478 cm (known limit, below) and L3-F1-phase6 D's right knee 0.922 to 0.956 cm.

### Tests changed

| Check | Was | Now | Why |
| --- | --- | --- | --- |
| New: twist measure and profile scope (body-limits) | | v2 on exactly L3, L4, HC; the measure against the anatomical table and random frames | the new profile |
| New: the fit (body-limits) | | across-chest hand, elbow pole up (140.5 deg) fitted to 98, palm kept, mirrored sides identical | |
| New: sweeps (body-limits) | | across the chest raw 79.5 deg out, fitted in range; straight reach across the pole line raw 123.8 deg jump, fitted 2.87 deg per substep | near-straight continuity |
| New: fixture twist (body-limits) | | supported arms in range and within the rate per tick (L3-F4-twoArm, L3-F3-side, L3-F8-recontact, L4-F9-contact), v1 twins fail; arm-task arms in range, ragdoll start slack no worse than the twin | |
| Ragdoll self-clearance twin (body-limits) | twin without self-clearance | without self-clearance and on joint-range-v1 | L3-F3-recover's v2 twin no longer reaches its trunk |
| Limp-foot held cases (body-limits) | | HC-F1-lowMirror R.right held | the conversion moved |
| 13f leg guard negative control (body-limits) | twins without the leg guard | the same, also without the deep push | the deep push clears that case by itself |
| Slack precondition (falls) | L4-F9-crowded | its joint-range-v1 twin | v2 starts inside |
| 13e fault (l3-contracts) | L3-F6-holdMirror | L3-F6-hold | under v2 the fault shows on the other side (late plants 3.58-3.98 s) |
| Pose guard scope (handoff-contact) | HC only | HC, L3 and L4 | the prerequisite fix |
| `asL3` keys (transitions) | | `ragdoll` (with the pose guard) | |
| Hold exposure, L4-F5-twoPalm (falls) | on <= off | no response effort on a held arm in any over-allocation substep; exposure at most half the release threshold | ruling, below |
| Known limits (falls, l3-pass) | | L4-F5-twoClamp-off R right shoulder 0.5 s; L3-F3-collision D right shoe 1.48 cm | rulings, below |

### Regressions investigated (user ruling: explain, then scope)

- **L3-F3-collision D's right shoe, 1.478 cm** (was bounded at 1.42 in 13f). Twist-only it is 1.410 under either twist
  profile: the deep push moves the same planted leg further before lift-off (13f's mechanism, R closing at about 5 m/s).
  No pop is visible in the lab (front, 0.608-0.617 s). Bound 1.48 cm for this boundary only (`KNOWN_AUDIT`).
- **L4-F5-twoPalm hold exposure, 0.031 s on vs 0.020 s off.** Not the response: in every substep a hold is over its
  allocation (v1 and v2) the held arm has no response effort row (0 N m), and the allocation row confirms grasp tension is
  allocated first. The load is the runner's pull just before it converts (2.02-2.15 s, up to 292 N on a 132 N
  allocation). The runs part at 1.18 s, where the runner's free-arm twist moves its wrist 0.5 mm; the pull then lasts 32
  substeps in one episode instead of 24 in two. The response-off twin's runner never converts (its holds separate at 1.90
  and 1.97 s), so on and off measure different loads. The comparison is replaced by the response's part (no effort on an
  overloaded hold) and a bound (half the 0.1 s release threshold); retention to the window's end and the off twin's
  separation stay checked.
- **L4-F5-twoClamp-off R's right shoulder, 0.496 s past tolerance** (limit 0.25). The runner lands on its right forearm,
  which carries 16-37 % of its body weight on the floor; the shoulder is held at 112 deg external twist (range 100,
  measured in the envelope's frame as the M1 tests check; 10 deg past after the cos(swing/2) scaling) while the envelope
  pushes 70 N m (cap 500) to reduce it. Removing the forearm's friction does not free it (the weight does); once the load
  leaves at 2.58 s the joint is inside within 0.033 s. On joint-range-v1 the same landing reached 9.5 deg for 0.10 s.
  Scoped known limit beside plan 12's pinned arm (L4-F3-model-oblique-off) and L4-F9-low: 0.5 s for this joint only.

### Remaining misses

- **Arm-task arms can still turn up to 55.6 deg in one tick** (L3-F4-twoArm D.left at 0.867 s). The widened rate windows
  (3x, 9x) are tried only when every candidate in the plain window is collision-invalid (the palm fixed, an obstacle in
  the window); the range itself always holds.
- **Ragdoll twist** peaks higher in HC-F3-phase0 R.right (35.9 deg past in the plain measure, 15.6 deg in the envelope's
  scaled measure, 0.042 s past tolerance; v1 13.0 deg, 0.029 s). The ragdoll keeps plan 09's soft envelope; fast spins of
  a straight ragdoll arm (about 1300 deg/s) are physical, not limited by M1.
- **HC-F5-strictTransfer, reversed order (test-only):** D is rejected for external penetration (left shoe 1.71 cm in R's
  ragdoll palm) instead of failing its transfer audit; the fixture's result (`invalidTransfer`) and forward order are
  unchanged.
- **Ending times move.** 30 `groundDown` endings shift by -0.10 to +0.08 s, mostly 1-5 ticks later: the runner loses
  support 1-2 ticks later (L3-F1-phase0 0.775 to 0.800 s). Not traced to one cause: the defender's forearm clamps on
  the runner re-acquire every few milliseconds in both versions (a flicker M3 will meet), and their impulse is somewhat
  higher in v2. Defenders that now fall and convert where they stayed up: HC-F3-phase0 and L3-F1-phase3 and L3-F1-low
  (both orders), HC-F3-lowRunner, L3-F1-phase0 and L3-F1-phase5 (forward), L3-F1-phase2 and L3-F4-oneArm (reversed);
  the defender now stays up in reversed HC-F3-lowRunner, L3-F1-phase5 and L3-F1-mirror0.

### Lab review (M1)

Before: `2e5344a`; after: this commit. In the lab (`?fixture=<id>&cam=front|side&speed=0.25&t=<s>`):

| Fixture | Look at | Profiles |
| --- | --- | --- |
| L3-F3-side | D's reaching left arm at about 0.83 s (side): elbow down, forearm angled up to R; before, the elbow rolled up level with the shoulder | joint-range-v2 |
| L3-F4-twoArm | R.left at 0.533 s (front/side): no roll as the cone turns the straight arm; D's wrap arms | joint-range-v2 |
| L3-F8-recontact | D2's arms through the recontact | joint-range-v2 |
| HC-F3-phase0 | R's free arm before and through conversion; D's arm task | joint-range-v2, poseGuard-v1 |
| L3-F1-phase2, L4-F10-wrap-off | the defender's conversion (accepted again) | poseGuard-v1 |

### Evidence

- `.scratch/cm1/` (untracked): `twist.ts`, `twsum.ts` (the table), `out-v1.txt` / `out-v2pg.txt` (outcomes in both
  orders), `legdepth.ts` (the deep push), `auditall.ts` with `audit-nopg.txt` / `audit-pg.txt`, `expo*.ts` and `div.ts`
  (hold exposure), `pin.ts` / `pin2.ts` (pinned shoulder), `test-e.log` (the closing run), `fixtures.log`.

## Contact-motion prerequisites (before M2; in progress, not yet accepted)

The physical-leg, arm-clearance and guard repairs the user ruled must land before M2. The full write-up comes with
acceptance; recorded here so far: the coverage note the user asked for and the known issues found on the way.

### 13f coverage: what proves the prediction

The predictive leg guard's evidence is the constructed closing body in the 13f describe (`tests/body-limits.test.ts`):
on the same thrown body, V2 with the prediction converts (1.12 cm new penetration) and V2 without it (`noLegAhead`) and
the twin without the guard are rejected (2.09 cm). The production fixtures do not show the prediction's benefit: under
the production profile (V3, physical legs) the prediction makes no measurable difference there (V3 with `noLegAhead`
also converts, 0.05-0.39 cm), because the physical leg colliders stop the closing body on the defender's thigh first.
They show collision protection. The prediction stays (user ruling 2026-11-10): those cases mask it, they don't show it
unneeded.

### D4 and D5 reverted (user ruling 2026-11-10)

D4 (a plant at its reach limit keeps its pivot against the clip's roll toward the heel) and D5 (a step too far from the
request lands at any clip weight) are reverted together. D5 only repaired what D4 broke on L3-F7-loadRelease.

- **Why:** D4 made L3-F1-phase6 D's right plant release for slide at 0.525 s, not for reach at 0.5625 s. Its next step
  became a drag step that never touched down: it hovered until support was lost at 1.342 s, with neither of D's feet
  down from 0.525 s. The hover mechanism is old (see the known issues), but D4 brought it to this fixture.
- **What D4 still bought on the current tree:** one substep. L3-F7-phase50 R's left plant releases for reach at 1.7208 s
  without it, 1.7250 s with it, and phase50's off-ground time is 0.150 s either way. In s10, before D4, it was 0.333 s;
  later changes did the rest.
- **After the revert:**
  - L3-F1-phase6 D's right step lands at 0.958 s, as in s10. That plant then slides off at 1.008 s, where s10 holds it
    to 1.146 s. This is during R's contact with the leg, which runs from 1.02 s. The next step, due at 1.243 s, is held
    off for cause: from 1.18 s its path runs within 0-8 cm of R's ragdoll, and the leg takes clearance variant 9 with
    its ankle 0.4-0.58 m up. D converts at 1.471 s (s10: 1.446 s, the drag step also in the air).
  - L3-F7-loadRelease off-ground time is 0.117 s. It was 0.150 s with D4 and D5, and 0.217 s with D4 alone.
  - Fixture summaries: G/L1/L2/RH identical, 72 L3/L4/HC summaries changed.
  - Suite: no new failure. The palm transition row passes again (a trajectory change, not a fix). The leg-placement
    fixture sample (L3-F1-phase6 forward D) no longer reaches 100 N s; its swap is in progress.
- **Leg matrix against s10:**
  - 527 of 610 player rows are identical, and who-falls matches s10 except two runs that already differed in s15:
    L4-F9-crowded forward D and HC-F3-phase75 reversed D, both supported.
  - The runs over 50 N s are s10's set plus L3-F1-phase0 reversed D, which was already over in s15.
- **Two peaks rise, for visual review:**
  - **L3-F1-phase0 reversed D:** 17.9 N s in s10, 62.6 in s15, 94.3 now. D, still supported at 4.6 m/s, runs its legs
    into R's fallen pelvis at 1.196-1.213 s: about 149 N s over the event in s15, 199 now. From 1.25 s it is held up on
    R's body (support probe obstructed on player:R, 0.39 m), and it converts on the recovery envelope at 1.333 s. The
    run diverges from s10 by 1.04 s: there D re-enters contact at 1.042 s and tips over on the recovery envelope at
    1.200 s, before reaching the pelvis. The divergence is already in s13, so it is not from the revert. No rule converts
    a supported player on leg impulse; the fall response's impact guard acts on a ragdoll's segments.
  - **HC-F3-phase75 forward D:** 55.2 N s in s10 (an early event at 0.504 s), 79.5 now. A new late event at 1.5458 s:
    D, supported at 1.6 m/s, steps into R's fallen torso, and one solve lifts D's proxy 0.8 m/s. Injected energy is
    small (0.028 J for the run). In s15, D converted at 1.433 s, before this.

### Known issues (tracked, not M1 blockers; user ruling 2026-11-10)

- **A late planner step can hover while its body runs on.** Footwork defect, resolved on L3-F1-phase6 by the D4
  revert but not in `footwork.ts`. Recorded from L3-F1-phase6 D's right foot under D4 (s15):
  - **Clear but not resuming:** R obstructs the step only at 0.67-0.75 s (R supported; clearance variants 1/3/9),
    1.02-1.05 s and from 1.28 s. From 0.87 to 1.10 s the leg is on its primary placement, R's ragdoll is at least 16 cm
    from it, and the straight path from ankle to destination is 37-82 cm clear.
  - **Moving destination:** each late stretch (`arriveS`, 0.05 s) holds the destination still. The next one moves it
    0.2-0.33 m, because D runs at about 6 m/s and the destination sits at the leg's reach (hip to destination 0.76-1.02
    m against 0.843 m). The target gets within 3 cm and is moved again. The shown ankle trails its target by 5-40 cm.
  - **Touchdown conditions never met:** `advanceStep` needs the target within 1 mm of the destination, or a `little`
    step whose ankle is `settled` (it and its path move no more than the plant tolerance a substep). The plan 10b
    `settled` clause covers this hover for a still foot (the L3-F4-twoArm case it cites), not for a running one.
  - **s10:** the same right step is not a drag step (0.39 s, 2.15 m). It lands on time at 0.958 s, on its destination.
  - Probes: `.scratch/b2/` (untracked): `held.ts`, `held2.ts`, with their logs on s15 and s10.
- **The clip's roll toward the heel can take a plant past its reach (L3-F7-phase50 R's left foot, 1.7208 s).** The
  mechanism D4 targeted, left in place by the revert. A plant at its reach limit takes the clip's roll. The pivot jumps
  from the ball of the foot to the clip's, which lowers the ankle the hip already barely reaches: before D4, rollF went
  1.69 to 1.00, the ankle 4.6 cm lower, 0.893 m needed against the 0.843 m reach. The plant is then released for reach.
  phase50's off-ground time (0.150 s) is within the 0.25 s limit.
- **D's left foot never lands in L3-F1-phase6 (older, separate).** Its 2.59 m continued clip swing starts at 0.479 s
  and is still swinging when D goes ragdoll: 1.475 s after the revert, 1.342 s under D4, 1.45 s on s10. It is present with
  and without D4.
