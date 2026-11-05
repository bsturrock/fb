# Built-in animation assets

Imported from `Fast Run (3).fbx` and `Sprint.fbx` supplied on 2026-11-05. Originals are preserved in `source/`; hashes and intake metadata are in `manifest.json`.

Both extracted clips have 17 samples at 30 FPS (0.5333 s between first and last sample), with 29 named joint positions and world rotations relative to bind pose. Coordinates are metres, Y up, +Z forward, anatomical left +X, matching the existing baker convention. `rest` records source proportions; playback must adapt these to the calibrated player, not replace its limb lengths.

Fast Run was supplied in-place. Sprint originally traveled 3.4505 m forward. Its derivative removes linear accumulated horizontal travel from every joint, preserving local stride sway, vertical bob and rotations. Originals are unchanged. This is translation normalization, not a loop-seam or retargeting guarantee. Duration alone does not establish Fast Run's nominal speed; Sprint's original average travel speed is about 6.47 m/s.

Rebuild from repository root using the installed Blender executable:

```sh
Blender --background --factory-startup --python models/scripts/blender/bake_clip.py -- models/animations/source/fast-run.fbx models/animations/fast-run.json
Blender --background --factory-startup --python models/scripts/blender/bake_clip.py -- models/animations/source/sprint.fbx models/animations/sprint.json --in-place
```

Checked: frame/joint consistency, finite positions/rotations, normalized quaternions and zero net horizontal hip travel.

Plan 06 wires both clips into the simulator ([handoff](../../docs/handoff/plan06.md)). After re-baking, run `npm run intake-clips`. It regenerates `src/sim/model/run-clips.record.json`, which holds:
- hashes;
- the closed cycle and seam;
- the nominal speed, from the planted toe rather than the duration;
- the half-open stance intervals;
- phase zero = left touchdown;
- the flight fraction;
- the playback bounds.

The simulator refuses a record that no longer matches these files, and `tests/locomotion.test.ts` checks the committed record against them. The physics-owned pose stays authoritative: the clips drive leg targets around the calibrated hips and free-arm swing only. Visual acceptance of the retargeted run is pending.
