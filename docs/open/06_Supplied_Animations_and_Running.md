# Supplied animations and running

Repository-aligned plan • 2026-11-05 • Implemented 2026-11-05; smoothness and carry-arm pass 2 the same day; waiting for the user's visual acceptance. Evidence, inventory, settings and open artifacts: [plan 06 handoff](../handoff/plan06.md).

Previous: [model integration](../closed/05_Review_and_Model_Integration_Plan.md). Next: [contact footwork](07_Procedural_Contact_Footwork.md).

## Baseline and scope

Gates 1–4 and the model retrofit already exist. Do not rebuild them. `src/sim/pose.ts` owns `PhysicalPose`, `buildProxyPose`, fixed-length `twoBone`/`hingeChain`, clearance-aware procedural limbs and actual-speed `advanceGait`. `Simulation.updatePoses` publishes that pose; `convertBatch` consumes it for the ten-body ragdoll. `src/lab/rig-adapter.ts` maps the same segment frames onto the model before and after conversion. `ModelAsset` already loads and clones the rig, but does not retain/sample `gltf.animations`.

Reuse `src/sim/model/bew-v6.calibration.json`, model profiles, `boneKey`, `RIG_MAP`, `sideSignX`, `checkLimbContract` and the existing model tests. The calibrated anatomical sides take precedence over the imported plans' blanket right=+X assumption. Do not repeat calibration or introduce another canonical skeleton/pose contract.

The new work is supplied run-clip intake and deterministic sampling into the existing pose. Keep procedural gait as the fallback. No animation generation, physical walking, independent foot bodies, spine, get-up, morph controls or new dependency is required.

## Existing acceptance debt

Read `../handoff/gate4.md` and the implementation-status table in document 05 before changes. Three model fixture cases have rejected handoffs; supported limb overlaps, long-hand clamp churn, the changed failed-tackle outcome and initially-out sideline shoe remain documented. Continuous normal-speed visual acceptance is incomplete. These do not justify rebuilding the gates or weakening candidate audits. Reproduce the cases as baseline results; acceptance of new locomotion requires valid representative transitions and explicit reporting of remaining failures.

## Supplied assets (2026-11-05)

Fast Run and Sprint are now committed-ready repository assets in [models/animations](../../models/animations/README.md), with original FBXs, extracted joint samples and intake metadata. Both derivatives are in-place. Asset availability is no longer the blocker; compatible sampling, nominal-speed/stance calibration and visual retargeting still need implementation and acceptance.

## Implementation

1. Inventory actual supplied clips before coding playback. The current model loader is not proof of an available usable run clip. Record asset/hash, clip name/duration/tracks, rest axes/scale, root-motion policy and nominal speed. Preserve originals. Final clip acceptance is blocked until a compatible supplied run cycle exists; synthetic samples may test plumbing only.
2. Reuse the installed Three loader/interpolants or a small normalized track buffer. Keep decoding separate from simulation state so headless fixtures need no DOM or visible rig. Share immutable clip data, own phase per player, and pass ready data explicitly into simulation initialization. Rendering must never be the source of pose sampling.
3. Remove accumulated root travel/yaw and scale changes from working samples. Keep physical core/hips/shoulders authoritative; suppress conflicting pelvis bob. Reconstruct sampled leg targets around calibrated hip anchors using existing limb lengths and hinge frames. Keep shoes rigidly attached to shins, as in the current candidate and adapter; independent ankle animation would require a separate physical-contract change.
4. Advance playback once per actual simulation substep from solved horizontal travel and bounded speed scaling. Store nominal speed, playback bounds, stance intervals (half-open normalized phases) and phase-zero meaning with the clip. Calibrate in-place speed rather than infer it from duration. Preserve flight phases. Stop/airborne behavior uses an explicit bounded fallback.
5. Extend `buildProxyPose` only where sampled targets are needed. Preserve clearance checks and achieved arm precedence. Optional free-arm swing enters the existing arm request/pose path; it cannot overwrite a reached/held arm or the runner's carry assignment. Publish the resulting `PhysicalPose` through the current interpolation and handoff path.
6. Reset/dispose playback state with its player. Export clip/profile identity and phase using existing trace/export facilities. Add only diagnostic fields needed to explain sampling and residuals.

## Files and verification

Touch `src/sim/pose.ts`, `src/sim/simulation.ts` and a small sampling module if warranted; use existing asset/calibration tooling for normalization. Change `src/lab/player-model.ts` only if runtime clip intake uses that loader. Keep `RigAdapter` a consumer. Register new fixtures in `src/sim/fixtures/index.ts`; add focused sampling tests alongside `tests/model.test.ts` coverage.

Retain historical fixture prefix `L1-` for this document (the prefix is not its document number). Cover constant speed, acceleration/braking, collision slowdown, two independent phases, root-motion removal, loop seams, held-arm precedence, render-rate independence, reset and missing/invalid asset errors. Verify finite fixed-length limbs, unchanged physical root/forces before conversion, and passing candidate/transfer audits for representative sampled poses. Pose changes may legitimately change later articulated falls.

Run `npm test`, `npm run typecheck` and `npm run build` when implementing. Review the supplied model at 1× and 0.25×; record clip availability, profile settings, fixture results and unresolved artifacts. Do not claim supplied-clip acceptance from the procedural fallback.

## Optional implementation reference

[Ossos — SketchpunkLabs](https://github.com/sketchpunklabs/ossos): Consult its retargeting implementation for source/target bind-pose corrections and bone mapping if a concrete clip-adaptation problem arises. Continue the implementation already underway; this reference adds no prerequisite or restart. Treat it as a reference, not a required dependency. Compatibility with our assets has not been tested.
