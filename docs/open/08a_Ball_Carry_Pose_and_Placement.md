# Ball carry pose and placement from sim-6

Repository-aligned plan • 2026-11-07 • Implemented, uncommitted, as carry profile `carry-sim6-v1`. **The separate leg composition repair passes the transition audit: 0 of 2450 boundaries over 1 cm, peak 0.893 cm.** User visual acceptance is outstanding. Evidence in the [08a handoff section](../handoff/plan08.md#plan-08a-ball-carry).

Related: [08 — Locomotion integration](08_Locomotion_Transitions_and_Tackle_Integration.md), [08 review closeout](08_Review_Closeout.md), [07a — Ragdoll handoff](07a_Ragdoll_Contact_Handoff.md).

## Intended result

Repurpose sim-6's right-arm carry: the ball lies lengthwise against the forearm, its front nose under the hand, and the carrying arm moves between the user's back and forward poses with the running gait. Standing and walking keep a settled, believable hold. Preserve sim-7's achieved-pose, clearance and handoff contracts.

This is a focused carry improvement on the L3 path. It does not replace 08's closeout work or start 09. Implementation and user visual review are separate from this plan. The user declared 08 finished on 2026-11-07 before this work began.

## Verified source and current gaps

The sibling checkout `../football-sim-6` is the read-only reference:

| Source | Reuse |
| --- | --- |
| `src/anim/ballCarry.ts`: `CARRY`, `mixKey`, `rightCarry` | User-tuned back/forward directions, gait-dependent shoulder swing, forearm seat, ball tilt and wrist flex |
| `src/movement/football.ts`: `createFootball` | Football shape, dimensions and laces; long axis +Y, half-length 0.14 m, radius 0.085 m |
| `tests/ballCarry.test.ts`, `src/rig/carryProbe.ts` | Full-cycle swing, fixed-length and skinned-mesh seating checks |
| `reference/movement/ball-carry/` | The reference images used to fit the donor carry |

Both checkouts' `models/bew-v6.glb` have SHA-256 `5aaab36942e3ec558715bad264702b3419dd14f8368cf037cd72af23cc8792d3`. No replacement model, animation asset or dependency is needed. The donor animation is procedural: two authored arm/ball poses driven by the sampled arms, rather than a separate carry clip.

In sim-7, `carryPalmLocal` and `CLIP_CARRY` supply palm targets and add a share of the sampled hand excursion. The ball is centred on that palm, rather than seated along the forearm. `PlayerView` and `RuleOverlay` create different ellipsoids; the former follows the core's rotation and the latter does not receive a ball rotation. `RigAdapter` drives the hand rigidly from the forearm, and ragdoll palm landmarks assume a straight wrist. Copying the donor palm target alone will not reproduce its hold.

## Scope and boundaries

- Port the donor's carry data and necessary math into this repository using the existing vector/quaternion helpers. Keep no runtime dependency on sim-6 and import none of its movement, contact, editor or possession systems.
- Start with the back/forward carry and gait swing. Keep the free left arm on its current path. Two-hand covering, trunk lean, hip lowering and automatic defensive bracing from the donor remain separate work.
- Retain the current arm-ownership priorities. Achieved reaching/held arms retain authority; carry composition cannot overwrite their solves. Exercise ready-hand assignment explicitly.
- Keep fixed segment lengths, anatomical side conventions, reach/hinge limits, clearance, continuity memory, support and force budgets. Use the current body's calibrated dimensions, not donor world-space joint positions.
- Opt the new carry and ball reference into L3 explicitly. Preserve earlier profiles, fixture IDs and all 238 committed summaries. Record changes to L3 endings, spots and handoffs rather than tuning outcomes back into place.
- The football remains a cosmetic prop with an authoritative location for existing rules. No ball collider, mass, fumbles, switching hands, finger animation or new wrist physics joint.

## Implementation order

### 1. Port the carry request and establish its fit

Extract the small calculation behind `rightCarry`, including the two `CARRY` keys and their original swing parameters. Keep those values as the initial fit. Map anatomical +X/−X through sim-7's body convention and place the chain from its calibrated shoulder and segment lengths.

Drive the blend from the sampled upper-arm pitch difference, as the donor does, before replacing the right-arm request. Fade with the existing shown clip weight into a static carry when the clip is absent; use the current gait for walking/run transitions. Advance no second animation clock and change no foot phase.

Feed the desired palm and bend plane through `buildProxyPose`'s existing arm solve, clearance and continuity path. Derive the final ball placement from the achieved carrying arm after corrections. A blocked arm must not leave the ball at an unachieved request or receive a hidden second solve for appearance. Report an infeasible fit rather than moving the core, stretching the limb or bypassing clearance.

### 2. Represent the hand and ball in the canonical pose

Add only the pose data needed for the donor's hand-relative rotation/palm offset and carried-ball position/orientation. The wrist bends over the front nose; the ball's seat direction and tilt follow the achieved forearm. Preserve the segment hinge frames and lengths. Use the same achieved hand/palm geometry in primitive drawing, model mapping and clearance queries.

Update `RigAdapter` to apply that hand pose about the calibrated wrist, retaining its existing bind corrections and legacy behavior when carry data is absent. Do not pose the mesh independently of `PhysicalPose`.

Interpolate the new data alongside the compatible achieved poses in `src/lab/main.ts`; derive the displayed seat from the interpolated arm where needed so the ball stays attached between ticks. Preserve interpolation reset at representation changes.

### 3. Unify the prop and rule reference

Reuse the donor football geometry in one shared lab helper, used by both `PlayerView` and `RuleOverlay`. Both receive the achieved ball transform, including orientation, and each scene draws exactly one football.

Add an explicit carry-pose ball source for opted-in rule profiles. Keep existing `coreOffset` and `carryPalm` semantics intact. `RuleObserver.ballRef`, live overlays and exported evidence must agree on the new ball centre; the recorded official spot remains frozen after an ending. Cover both fixtures with rules and carrier drills without rules.

### 4. Preserve the hold through falling and reset

Carry the achieved hand/palm relationship and ball transform into the candidate as forearm-local data. Keep the existing ten-body representation: the hand and cosmetic football follow their owning forearm after conversion, without continued gait animation.

Update candidate palm geometry and ragdoll landmarks together so validation sees what was published. Preserve hand/ball continuity at the switch, candidate/transfer/first-solve audits, retained grip/clamp remapping and genuine rejection fallback. Clear carry memory with player reset; never clear continuity memory at a locomotion transition to conceal a pop.

## Change surface

| Area | Expected reach |
| --- | --- |
| Carry calculation | A small helper beside `src/sim/pose.ts`, donor keys/math only |
| Pose and sampling | `src/sim/pose.ts`, sampled arm data in `src/sim/run-clip.ts` only if the existing sample lacks the required directions, `Simulation.updatePoses` and copied transition-audit inputs |
| Opt-in and rules | Existing L3 profiles/fixtures, `src/sim/profiles.ts`, `src/sim/rules.ts`; export the adopted identity/policy |
| Falling | `src/sim/ragdoll.ts`: candidate palm placement, frozen forearm-local hand/ball data and `ragdollPose` |
| Presentation | `src/lab/rig-adapter.ts`, pose cloning/interpolation and overlay calls in `src/lab/main.ts`, ball creation/update in `src/lab/views.ts` |
| Evidence | Focused carry tests; extend existing model, locomotion, transition, rule and handoff regressions where their contracts change |

Keep optional pose data absent on historical paths. Do not introduce a general animation framework or editor.

## Verification and acceptance

1. **Donor fit:** test both carry keys and a complete settled run cycle on the supplied model. The ball axis stays along the forearm within the donor's authored tilt; the arm reaches both keys and swings opposite the free arm. Check shoulder–elbow and elbow–wrist lengths against the active profile.
2. **Mesh seating:** adapt the donor's CPU skinning probe to the current rig adapter. Measure torso/upper-arm overlap, forearm seating, hand-to-front-nose gap and tip distance through the cycle, standing and walking. Start from the donor's measured tolerances and publish the results; do not weaken existing physical clearance or handoff tolerances. Include a deliberately shifted ball and wrong hand rotation that fail the seating checks.
3. **Composition:** reuse L3-F13 carrier idle, L3-F14 carrier walk/walk-run-stop, L3-F16 start/stop/sprint/kick and existing contact/recontact fixtures. Add only a focused variant when an existing fixture does not exercise the carrying arm. Assert ownership actually occurs and measure arm/hand/ball continuity at every relevant substep, including ownership changes. Keep the 1 cm same-time transition limit and separate achieved-motion measurements.
4. **Authority and rules:** the new carry changes no drive, support or left-arm request. Compare physical traces until the first pose-dependent conversion or rule ending. Verify the drawn and observed ball reference agree, render rates do not alter state, one ball is drawn, and the official spot remains frozen.
5. **Handoff and lifecycle:** convert during idle, both run extremes and contact. Require hand/palm/ball continuity, passing candidate/transfer/first-solve checks, preserved retained relations, and no fresh carry motion after falling. Reset reproduces a fresh run. Historical profiles retain their previous behavior.
6. **Complete checks:** run focused tests, the full suite, typecheck/build and fixture export. Compare all 238 committed summaries and report every changed L3 result, ball spot and handoff. Record the carry profile identity and donor provenance in the 08 handoff.

Review complete cycles and transitions at normal speed and 0.25×, from front, side and oblique views, beside the donor carry. Look for the nose under the hand, ball seated against the forearm, natural shoulder swing, stable idle, and no detachment or twist at contact, stop or conversion. User visual acceptance of the port remains explicit; numerical checks alone do not establish a good hold.

Done means the carry and prop work together through the existing pose pipeline, with the above evidence and a separately recorded visual decision. This plan does not resolve or waive other open 08 closeout findings.
