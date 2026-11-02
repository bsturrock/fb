# Shoulder pads ride the shoulders: moves part of the upper-arm weight off the pad onto the shoulder (clavicle) bone,
# so a raised arm turns partly under the pad instead of dragging the pad's top and back with it (they folded against
# the back when the arm came forward). Not all of it: the rest pose is the T-pose, so a pad held fully by the shoulder
# stays level while the arm drops 60-80 deg into a stance, and its top pinches into a peak with a crease on the inner
# side. Run on the hand_bones output, in place:
#   Blender --background --factory-startup --python scripts/blender/pad_weights.py -- models/bew-v6.glb models/bew-v6.glb
# Per side, a vertex above the shoulder joint and within the pad's overhang keeps at most PAD_ARM_MAX of its arm
# weight (60 %); the rest goes to <Side>Shoulder. It fades in from 4 cm below the joint to 3 cm above, and out over 5-10 cm past
# the joint sideways (the sleeve keeps its weights), and out toward the front over 2-6 cm ahead of the joint: the
# front of the pad stays with the arm, or the pad's front edge and the chest under it fold into dark wedges when the
# arms come in.
# The torso wall under the armpit (below the joint, not out past it) keeps at most WALL_ARM_MAX; the rest goes to
# Spine2 (Spine1 lower down), so the arm coming forward stretches the armpit instead of caving in the side of the back.
# It fades in from 3 to 9 cm below the joint, and out over the last 3 cm inside the joint sideways (the sleeve under the
# joint stays on the arm), and out toward the front over 2 cm either side of the joint (the front armpit and chest
# follow the arm in).
# Morph targets pass through as shape keys, as in hand_bones.py.
import sys
import bpy
from mathutils import Vector

IN, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
PAD_ARM_MAX = 0.6
WALL_ARM_MAX = 0.1
PAD_FRONT = WALL_FRONT = 0.02

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
skinned = [x for x in bpy.data.objects if x.type == 'MESH' and x.vertex_groups]
o = bpy.data.objects.get('geometry_0') or max(skinned, key=lambda x: len(x.data.vertices))
extras = [x for x in skinned if x is not o]
W = o.matrix_world
moved = walled = 0
spine2, spine1 = o.vertex_groups['mixamorig:Spine2'], o.vertex_groups['mixamorig:Spine1']
s2z = (arm.matrix_world @ arm.data.bones['mixamorig:Spine2'].head_local).z
for side in ('Left', 'Right'):
    ga, gs = o.vertex_groups[f'mixamorig:{side}Arm'], o.vertex_groups[f'mixamorig:{side}Shoulder']
    j = arm.matrix_world @ arm.data.bones[f'mixamorig:{side}Arm'].head_local   # Blender world: z up, -y forward
    for v in o.data.vertices:
        a = next((g.weight for g in v.groups if g.group == ga.index), 0.0)
        if a <= min(PAD_ARM_MAX, WALL_ARM_MAX):
            continue
        p = W @ v.co
        if (p.x > 0) != (j.x > 0):
            continue
        t = smoothstep(j.z - 0.04, j.z + 0.03, p.z) * (1 - smoothstep(abs(j.x) + 0.05, abs(j.x) + 0.10, abs(p.x))) \
            * smoothstep(j.y - PAD_FRONT - 0.04, j.y - PAD_FRONT, p.y)
        take = t * (a - PAD_ARM_MAX)
        if take >= 1e-4:
            ga.add([v.index], a - take, 'REPLACE')
            gs.add([v.index], take, 'ADD')
            moved += 1
            continue
        t = smoothstep(j.z - 0.03, j.z - 0.09, p.z) * (1 - smoothstep(abs(j.x) - 0.03, abs(j.x), abs(p.x))) \
            * smoothstep(j.y - WALL_FRONT, j.y + WALL_FRONT, p.y)
        take = t * (a - WALL_ARM_MAX)
        if take >= 1e-4:
            ga.add([v.index], a - take, 'REPLACE')
            (spine2 if p.z > s2z - 0.05 else spine1).add([v.index], take, 'ADD')
            walled += 1

vl = bpy.context.view_layer
bpy.ops.object.select_all(action='DESELECT')
for x in (o, *extras):
    x.select_set(True)
arm.select_set(True); vl.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_rest_position_armature=False,
                          export_morph=True, export_morph_normal=False, export_yup=True)
print('pad_weights: wrote', OUT, moved, 'pad vertices moved toward the shoulders,', walled, 'armpit wall vertices toward the spine')
