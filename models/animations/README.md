# Built-in animation assets

Imported from `Fast Run (3).fbx`, supplied on 2026-11-05. The original is preserved in `source/`; hashes and intake metadata are in `manifest.json`.

The extracted clip has 17 samples at 30 FPS (0.5333 s between first and last sample), with 29 named joint positions and world rotations relative to bind pose. Coordinates are metres, Y up, +Z forward, anatomical left +X, matching the existing baker convention. `rest` records source proportions; playback must adapt these to the calibrated player, not replace its limb lengths.

Fast Run was supplied in-place. Duration alone does not establish its nominal speed (see the intake record below).

Plan 13d (2026-11-09): Fast Run is the one run clip, for every run speed from a jog to top speed; below its slowest cadence the stride shortens. `Sprint.fbx`, supplied with it, was removed with its bake, manifest entry and intake record, on the user's ruling ([plan 13d](../../docs/open/13d_Fast_Run_Base_Clip.md)); it is in the repository history before that commit.

`Standard Walk.fbx`, supplied on 2026-11-06, is `walk`: 36 samples at 30 FPS, a closed in-place cycle of 1.1667 s, nominal 1.59 m/s. It joins the run clips only on the L3 path (`runClipsL3`). `Start Walking (1).fbx` and `Idle To Sprint (1).fbx` were used as templates for speed curves and are not in this directory.

Rebuild from repository root using the installed Blender executable:

```sh
Blender --background --factory-startup --python models/scripts/blender/bake_clip.py -- models/animations/source/fast-run.fbx models/animations/fast-run.json
```

Checked: frame/joint consistency, finite positions/rotations, normalized quaternions and zero net horizontal hip travel.

Plan 06 wires the run clips into the simulator ([handoff](../../docs/handoff/plan06.md)). After re-baking, run `npm run intake-clips`. It regenerates `src/sim/model/run-clips.record.json`, which holds:
- hashes;
- the closed cycle and seam;
- the nominal speed, from the planted toe rather than the duration;
- the half-open stance intervals;
- phase zero = left touchdown;
- the flight fraction;
- the playback bounds.

The simulator refuses a record that no longer matches these files, and `tests/locomotion.test.ts` checks the committed record against them. The physics-owned pose stays authoritative: the clips drive leg targets around the calibrated hips and free-arm swing only. Visual acceptance of the retargeted run is pending.

## Idle

`source/idle.fbx` was supplied for plan 08. Its bake, `idle.json`, has 251 frames at 30 FPS (8.33 s), in place, with a measured seam of 0. Hashes and intake metadata are in `manifest.json`.

Policy: cycle (plan 13e; static before it). `npm run intake-clips` (`scripts/model/idle-intake.ts`) measures the cycle and writes one representative frame, 71, and the whole cycle to `src/sim/model/idle-pose.record.json`: per frame, each arm's upper and forearm directions in the chest (Spine2) frame, the head's rotation in the chest relative to frame 71 (at most 1.02 degrees), and the hips' horizontal offset from the loop mean (at most 0.97 cm). A standing player on the player model plays the loop at its own phase (from simulation time and its index in the fixture): the arms and head are drawn from it, and the hips offset drives the body as a small velocity request while the feet stay planted. Frame 71 gives the stance width and stagger, and is what the arms blend from as the player starts to move ([plan 08 handoff](../../docs/handoff/plan08.md), [plan 13 handoff](../../docs/handoff/plan13.md)).
