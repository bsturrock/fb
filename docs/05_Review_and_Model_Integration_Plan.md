# Gates 1–4 review and supplied-player integration plan

Reviewed 2026-11-02 against commit `28cb44d`. The text below is the review and plan as written. The implementation status follows.

## Implementation status (2026-11-02, uncommitted working tree on `28cb44d`)

| Step | Status | Evidence |
| --- | --- | --- |
| Fix 1: passive grasp direction | Done | `n` passed unchanged. Every passive force entry is tensile (test). ownerOnly holds to 2.2 s; simultaneous right grip releases at 1.3125 s (`docs/handoff/gate4.md`). |
| Fix 2: failed transfer audit | Done | `transferFailed` outcome, `handoffAuditFailure`, observer disabled, result `invalidTransfer`. Test uses a copied profile with `energyGainFraction: 0.01`. |
| Fix 3: one ball | Done | When a rule profile exists, the rule overlay draws the only ball, at the observer's carry reference. |
| Fix 4: field/model resource lifecycle | Done | Field reused or disposed. Model clones and the asset own and release their resources. Browser counts are stable across loads, resets and toggles. |
| 1. Baseline | Done | 113 tests pass (93 existing + 1 failed-audit + 19 model). Of the 120 existing fixtures, only G4-F4-ownerOnly/simultaneous changed (fix 1). The changed release times are recorded and no assertion was fitted to old numbers. |
| 2. Load once, clone per player | Done | `src/lab/player-model.ts`. Two independent instances checked in dev and in `vite build --base /lab/` preview, with the GLB at `/lab/assets/bew-v6-<hash>.glb`. No new dependency. |
| 3. One measured geometry contract | Done | Calibration record plus model body/arm/ragdoll/rule profiles. Explicit lengths everywhere (`labelLimbPoint`, `checkLimbContract`). Measured side basis (`sideSignX`). Labelled single-right-arm test. 15 G4-M fixtures. |
| 4. Bones from the achieved pose | Done | `src/lab/rig-adapter.ts`, mapping table in `models/rig.md`. Landmark agreement 1e-4 m before and after handoff, no side swap (tests). |
| 5. Appearance, palette, ball | Done | Embedded textures. Exact key-colour recolour cached per palette/role. Basis morphs only (the file's default weights are 1/1 and are zeroed). |
| 6. Acceptance and default switch | Done, with open items | Model is the default view for calibrated fixtures, primitives is the diagnostic view. Evidence re-exported (135 fixtures). Model visual review is listed in `docs/handoff/gate4.md`. Open items: three G4-M handoff rejections, failed tackle now knocks the runner over, sideline foot out at the start, clamp churn with the long model hand (all in the handoff). Continuous normal-speed playback was sampled, not watched. |

## Review result

The four gates have working mechanics and substantial fixture coverage. The controller → intent → bounded actuator → physics → achieved pose boundary is suitable for adding the supplied skinned player. Gate 4 needs the fixes below before its retention and handoff results can be accepted.

| Gate | Implemented | Review status |
| --- | --- | --- |
| 1 | Bounded drive/yaw, mutual impact, body variants, coached entry, traces | 17 tests pass. No additional mechanics defect confirmed. Normal/slow-speed visual acceptance remains incomplete in its handoff. |
| 2 | Achieved reach, breakable palm grips, pressure/friction clamps, shared arm budget, observed wraps | 12 tests pass. Its handoff explicitly leaves runner-arm visual overlap unresolved and presentation criterion R7 at 1. |
| 3 | Free rotation, finite balance torque, recovery envelope, loss of support, continued bounded finish | 16 tests pass. Continuous normal-speed visual review remains unverified. |
| 4 | Ten-body ragdoll, candidate validation, momentum transfer, grip/clamp transitions, completion observer | 48 tests pass, but passive grasp direction and failed-audit handling are incorrect. Continuous normal-speed review remains unverified. |

Assumed use: the specified two-player local tackle lab. This review does not establish 22-player performance or complete football rules.

### Must fix

1. **P1: Passive grasps push the players apart.** `src/sim/arms.ts:483`, consumed at line 736.

   The passive-grasp branch defines `n` from the owner's palm toward the target, then stores `-n` in the demand. The shared hold allocator negates it again when applying the force. The target is pushed away from the hand, increasing the separation that should produce retention.

   Reproduction: run `g4f4('ownerOnly')` and `g4f4('simultaneous')`, inspect passive ledger entries with `actual > 1 N`, and evaluate `dot(forceOnTarget, pointOnTarget - pointOnOwner)`. All 26 owner-only entries and all 32 simultaneous entries are positive. A tensile grasp requires a negative result at nonzero separation.

   Smallest fix: pass `n` unchanged to the shared allocator. Add a force-direction assertion to the existing owner-conversion tests, then remeasure grasp duration and separation. Equal-and-opposite forces and capped magnitudes alone do not catch this bug. Leaving it creates artificial separation after conversion and invalidates the passive-grasp evidence.

2. **P2: A failed transfer audit can still count as a valid tackle.** `src/sim/simulation.ts:968–993`; `src/sim/ragdoll.ts:497–532`.

   The switch removes the proxy before auditing, then `convertBatch` marks the handoff accepted regardless of `audit.ok`. A failure only emits `handoffAuditFailure`; the observer can still award completion.

   Reproduction: run `g4f3TwoArm()` with a copied ragdoll validation profile setting only `energyGainFraction: 0.01`. R transfers with +21.1364 J against the resulting 10 J limit. Its audit is false, its handoff is accepted, and the trial ends `groundDown`. The default profile's 50% allowance passes this case; the demonstrated defect is failure handling, not a claim that the default case exceeds its own limit.

   Smallest safe fix: give a failed transfer a distinct invalid outcome and prevent referee completion. The already-switched assembly can remain as diagnostic state. Preserving the old proxy on transfer failure would require moving the audit before the destructive switch; that is a larger follow-up, not required merely to prevent false success. Add one failed-audit test. This matters when new model dimensions change inertia.

3. **P2: Rule fixtures render two different balls.** `src/lab/views.ts:202–206,273–276,529–533`; `src/lab/main.ts:543`.

   `PlayerView` puts a ball at the achieved right palm. `RuleOverlay` independently draws another at the observer's fixed core offset. In `G4-F3-twoArm` at 0.9 s the two centers are 0.400 m apart. Both are added to the scene, so the visible carry and official spot have competing references.

   Smallest fix: retain one cosmetic ball, using the rule observer's carry reference whenever a rule profile exists. Keep the event marker in `RuleOverlay`; do not move the official spot after the event. Verify the selected carry pose against the glove when fitting the new model. Leaving it makes visual spot review misleading.

### Should fix

4. **P2: Fixture changes abandon the old field's GPU resources.** `src/lab/main.ts:137–140`, with allocations in `buildField` at lines 43–75.

   Every fixture load builds a new ground plane and line geometries, while the old field is only removed from the scene. Its geometries and materials are never disposed. Three's installed `WebGLGeometries` releases buffers on geometry disposal, not scene removal. Repeated fixture browsing therefore retains field buffers. Player and overlay cleanup also needs material ownership addressed before adding shared GLB resources.

   Smallest fix: reuse the field while practice bounds match, and dispose its unique resources whenever it is replaced. Verify stable `renderer.info.memory` after repeated load/render cycles. Existing lifecycle tests count Rapier objects and cannot detect this. No browser memory measurement was performed in this review.

### Checks performed

- `rtk npm test`: 93/93 tests passed across all four gate test files, about 32 seconds.
- `rtk npm run build`: TypeScript and production build passed; existing large-JavaScript-chunk warning remains.
- Temporary targeted probes confirmed findings 1–3; they were removed from the repository after recording the results.
- Read gate specifications/handoffs, the simulation loop, actuators, pose generation, rule observer, candidate/transfer code, rendering lifecycle, fixtures and connected tests.
- Parsed both supplied GLBs and evaluated skeleton node transforms; inspected asset build scripts and the current Vite output.

Verdict: fix 1–3 before Gate 4 sign-off; include 4 in model-loading lifecycle work. Passing tests do not close the already-declared visual acceptance gaps.

## What the supplied assets contain

| Asset | Intended role |
| --- | --- |
| `models/bew-v6.glb` | Runtime player. 807,312 bytes, 33 joints, body and helmet skinned to the same skeleton, two embedded PNG textures, 3,107 triangles total. Body morphs are named `heavy` and `lean`. No animation clips. |
| `models/reference/bew-elbowfix.glb` | Older reference for the build pipeline: 25 joints, one mesh, no morphs or animation clips. Not a second runtime player variant. |
| `models/art/player-v6.blend` and `art/textures/` | Editable artwork and source textures. |
| `models/bew-v6-mixamo.fbx` | Interchange asset. Its rig/animation contents were not inspected. |
| `models/scripts/build-v6.sh` and `scripts/blender/` | Existing GLB rebuild pipeline. Preserve and reuse it when artwork actually changes. |

`models/rig.md` documents an earlier host application's `src/body`, `src/rig`, generated shape fits, belly correction and tests. Those modules are absent here. Its `npm run build-model` and `npm run fit-shapes` commands also do not exist in this package. The actual shell rebuild script is present; loading the committed GLB needs none of the missing modules.

Both assets use metre-scale coordinates with Y up and Z forward. Asset `Left*` joints lie on +X, while the current simulation labels +X as right. Treat side naming as an explicit integration issue.

### Measured mismatch with the current player

Lengths below come from the final GLB's world-space rest joints, not its T-pose mesh width.

| Joint span | `bew-v6.glb` | Current simulation |
| --- | --- | --- |
| Upper arm | 0.360 m | 0.350 m |
| Forearm to wrist | 0.232 m | 0.340 m |
| Thigh | 0.431 m | 0.440 m |
| Shin to ankle | 0.448 m | 0.360 m |

The GLB's hips root is at Y=1.03948 m; hip joints are near 0.98069 m, arm pivots at 1.512 m, and ankle joints at 0.106 m. The body reaches about 1.894 m and the helmet about 1.920 m. Gate 4's existing shoulders are at X=±0.20 m; the GLB arm pivots are X=±0.22818 m.

A single uniform scale cannot reconcile these proportions. Stretching the forearms to the old solver would require roughly 46% extra length. A faithful replacement needs an asset-derived body/arm/ragdoll profile as well as a rendering adapter.

## Integration plan

### 1. Repair and freeze the baseline

Fix findings 1–3 with focused regression checks; fix resource cleanup while updating the view lifecycle. Rerun the existing tests, refresh the affected Gate 4 evidence, and record any changed release times or outcomes rather than adjusting assertions to the old numbers.

Keep the existing gate profiles and historical fixtures available. New geometry will legitimately change collision, reach, balance and handoff outcomes; give it an explicit new profile identity and its own fixture results.

### 2. Load the final GLB once and clone its skeleton per player

Add one small module such as `src/lab/player-model.ts`, using the already-installed Three `GLTFLoader` and `SkeletonUtils.clone`. Cache the source load, clone body and helmet together, and give each player independent bones and morph weights. Share immutable geometry/textures; copy materials only where player colors differ. Dispose each cloned skeleton's bone texture on teardown and dispose shared asset resources only when the cache is retired.

Integrate initialization and visible load-error handling into `src/lab/main.ts`; create views only when both the simulation and asset are ready. Guard fixture changes during loading so a late promise cannot install a stale view. Retain the existing collider/force/contact overlays. Keep primitive presentation for legacy capsule and deliberately altered diagnostic profiles where a normal human mesh would be misleading.

Vite already serves `models` as the public directory, so the current runtime URL is `/bew-v6.glb`. For the final integration, import that GLB with Vite's `?url` handling and stop copying the entire `models` directory as public output. It currently copies the Blend, FBX, reference GLB, scripts and documentation into `dist`; only the final GLB is required at runtime. Check the built asset URL under a non-root base path.

Exit check: two independent player instances load in development and the production build; posing or disposing one does not affect the other. No extra dependency is needed.

### 3. Establish one measured geometry contract

Record the GLB rest joint positions, bind-frame corrections, palm contact location, torso/pelvis dimensions, helmet extent and shoe offsets in one small asset calibration record. Fit dimensions in body-local coordinates using the committed GLB. Verify glove and sole landmarks on the actual mesh rather than inferring them from bone names. Use the Basis shape initially; leave `heavy` and `lean` at zero.

Create a new model-derived body, arm and ragdoll profile. Use the same limb lengths in `ArmSystem`, `buildProxyPose`, candidate construction, ground-region classification and presentation. Currently `pose.ts` and `rules.ts` read global `LIMB` constants while the ragdoll reads `RagdollProfile.lengths`; simply changing the ragdoll profile would produce inconsistent endpoints and rejected handoffs. Update those consumers and pass explicit lengths to `labelLimbPoint` and its tests.

Resolve anatomical side naming in this same step. For new model profiles, preserve the GLB's anatomical Right/Left labels and measured coordinates. Replace assumptions that right always means +X in arm rest targets, elbow poles, procedural pose and wrap-controller side selection with the selected body's measured side/basis. Existing profiles retain their current coordinates and regression behavior. Add a labelled single-right-arm pose to catch accidental bone-side swaps.

Keep the coarse ten-body physics model initially: rigid core, one head, upper/lower arms and upper/lower legs. Feet/toes and fingers can follow their owning simulated segment with calibrated rest offsets. Independent foot bodies, a spine solver and physical fingers are outside this replacement.

Exit check: one new fixture has consistent shoulder/elbow/wrist/hip/knee/ankle positions across query arms, physical pose, candidate bodies and rendered bones. Re-run momentum/energy and penetration audits with the new mass distribution; do not transplant the old numerical outcomes.

### 4. Drive bones from the simulation-owned achieved pose

Use `PlayerRuntime.pose` and the existing interpolated `PhysicalPose` passed to `PlayerView.update`. Never pose the rig from requested arm targets or let an animation clip move physics.

| Simulation source | Rig mapping |
| --- | --- |
| Core frame and pelvis landmark | Hips root; spine chain and clavicles retain calibrated rest offsets within the rigid core |
| Head segment at neck pivot | Neck/Head with bind offset; helmet follows the same Head bone |
| Shoulder and upper-arm segment | `*Arm` bone, not the more medial `*Shoulder` clavicle bone |
| Elbow and forearm segment | `*ForeArm`; hand uses the solved wrist and calibrated palm offset |
| Hip and thigh segment | `*UpLeg` |
| Knee and shin segment | `*Leg`; Foot and ToeBase follow calibrated ankle/shoe rest transforms |
| Fingers/mitten bones | Fixed initial carry/open pose; no new contact authority |

For each target bone, combine the solved segment world transform with its calibrated bind-frame correction, then convert to parent-local coordinates with the inverse of the parent's current world matrix. Apply targets in hierarchy order. Apply character-root placement once. Preserve segment twist from the provided quaternion; aiming only along two landmarks would discard that information.

Use the same adapter before and after proxy-to-ragdoll conversion, preserving the current interpolation reset at the boundary. Keep the same loaded mesh and skeleton through conversion. Keep the simulation's head/core and supported-limb limitations explicit.

Exit check: idle, running, reach, hold, clamp and post-handoff bones agree with the achieved pose. No T-pose reset, double root movement or left/right swap occurs.

### 5. Preserve appearance, palette controls and the event spot

Use the embedded body/helmet textures and existing flat-shaded artwork. A uniform material tint would recolor skin, gloves, pants and facemask together. Preserve the existing role/palette feature by recoloring only the exact atlas regions listed in `models/rig.md`, with textures cached by palette/role. Keep facemask and other unaffected regions intact.

Render one ball at the chosen carry reference. Align the initial right-hand pose around it without changing a solved tackling arm. The observer must keep using its simulation-owned reference, and the frozen event spot must remain independent of subsequent mesh motion.

Do not enable body morph controls in the first release: silhouette changes require their own fitted collision geometry and regression evidence. The older project's generated belly/flex helpers are not prerequisites for the Basis model.

### 6. Acceptance and default switch

Add focused asset/adapter tests for required bones and morph names, independent skeleton clones, side mapping, parent-local transforms, and landmark agreement under translated/yawed roots. Use a real GLB handoff fixture to check continuity, valid mass/P/L/energy transfer, grip direction, clamp transition and ground/boundary classification. Repeat load/reset/dispose cycles in the browser and inspect geometry/texture counts after caches are warm.

Run all existing tests and the production build. Export fresh model-profile fixtures. Review continuous 1× and 0.25× motion from side/oblique views and inspect overhead wrapping, including idle/run/brake, unreachable reach, one-arm grasp, forearm wrap, slip, failed tackle, both players falling, worst handoff, ground completion and sideline touch. The legacy handoff documents' visual U/1 grades are not automatically cleared by changing artwork.

Make the supplied model the default for the new calibrated fixtures once these checks pass. Retain primitive geometry as the diagnostic view and for historical profiles whose deliberate dimensions differ.

## Files the work must reach

| Area | Files |
| --- | --- |
| Review fixes | `src/sim/arms.ts`, `src/sim/simulation.ts`, `src/lab/views.ts`, `src/lab/main.ts`, existing Gate 4 tests |
| Asset loading and bone adapter | New `src/lab/player-model.ts`, `src/lab/views.ts`, `src/lab/main.ts` |
| Shared geometry and profile identity | `src/sim/profiles.ts`, `src/sim/pose.ts`, `src/sim/rules.ts`, profile-aware arm/controller side assumptions; candidate and renderer consumers |
| Model fixtures and exports | `src/sim/fixtures/`, fixture registry, focused tests; use existing trace/export machinery and include calibration/profile identity |
| Runtime packaging | `vite.config.ts`; existing Three add-ons only; no new package dependency |
| Asset documentation | `models/rig.md`, updated handoff evidence, this plan |

Not checked at review time: live browser rendering/memory, continuous playback, FBX contents, or a Blender rebuild. Browser rendering and memory were checked during implementation (status above). The FBX and a Blender rebuild remain unchecked.
