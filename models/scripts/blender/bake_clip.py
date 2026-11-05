# Bakes one Mixamo FBX clip to the JSON the animation layer reads (src/anim/clips/<name>.json): world joint positions
# per frame in this project's axes (x left, y up, z forward; Blender's Mixamo import faces -Y with Z up), metres; the
# rest (bind) joints (`rest`); and per frame each bone's world rotation relative to its rest (`rot`, quaternion x y z w
# in project axes): the full bone rotations the production clip pose plays (src/anim/clipPose.ts). A world rotation
# from rest does not depend on the bones' local axis conventions, so it carries to any rig with the same rest pose.
# Run headless: Blender --background --factory-startup --python scripts/blender/bake_clip.py -- in.fbx out.json
# (npm run bake-clips does every clip in reference/movement/mixamo/). Re-baking an edited clip is all a swap needs.
import bpy, sys, json, os
from mathutils import Matrix
args = sys.argv[sys.argv.index('--') + 1:]
in_place = '--in-place' in args
if in_place: args.remove('--in-place')
src, out = args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
act = arm.animation_data.action
f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
sc = bpy.context.scene
JOINTS = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End']
for s in ('Left', 'Right'):
    JOINTS += [s + j for j in ('UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End', 'Shoulder', 'Arm', 'ForeArm', 'Hand', 'HandIndex1', 'HandThumb1')]
# Blender world -> project axes (x, z, -y).
C = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
Rw = arm.matrix_world.to_3x3().normalized()
def proj_rot(m3):
    q = (C @ Rw @ m3 @ Rw.inverted() @ C.transposed()).to_quaternion().normalized()
    return [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)]
rest = {}
for j in JOINTS:
    b = arm.data.bones.get('mixamorig:' + j)
    if b is None: continue
    h = arm.matrix_world @ b.head_local
    rest[j] = [round(h.x, 4), round(h.z, 4), round(-h.y, 4)]
frames, rots = [], []
for f in range(f0, f1 + 1):
    sc.frame_set(f)
    fr, ro = {}, {}
    for j in JOINTS:
        b = arm.pose.bones.get('mixamorig:' + j)
        if b is None: continue
        h = arm.matrix_world @ b.head
        fr[j] = [round(h.x, 4), round(h.z, 4), round(-h.y, 4)]
        ro[j] = proj_rot(b.matrix.to_3x3().normalized() @ b.bone.matrix_local.to_3x3().normalized().inverted())
    frames.append(fr)
    rots.append(ro)
# Remove net horizontal travel, preserving stride sway and vertical bob.
if in_place:
    assert len(frames) > 1 and all('Hips' in f for f in frames)
    travel = [frames[-1]['Hips'][i] - frames[0]['Hips'][i] for i in (0, 2)]
    for index, frame in enumerate(frames):
        t = index / (len(frames) - 1)
        for point in frame.values():
            for axis, delta in zip((0, 2), travel):
                point[axis] = round(point[axis] - t * delta, 4)
    assert all(abs(frames[-1]['Hips'][i] - frames[0]['Hips'][i]) < 1e-4 for i in (0, 2))
json.dump({'name': os.path.splitext(os.path.basename(src))[0], 'fps': sc.render.fps, 'frames': frames, 'rest': rest, 'rot': rots}, open(out, 'w'), separators=(',', ':'))
print('baked', src, f0, f1)
