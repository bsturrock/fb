# Shortens the stylised shoe to the athlete's foot (docs/rig.md "Ball"). The art's shoe is 0.40 m from heel to toe at
# 6'2", about 1.4 x the 0.286 m anthropometric foot, and its forefoot stud row sits about 5 cm ahead of the first
# metatarsal head, so the ground support it gives the foot is about 40 % too far from the ankle. Every vertex below the
# collar moves along the shoe's forward axis toward the functional ankle: ahead of it by FRONT, behind it by BACK
# (continuous at the ankle). Above the collar top the move fades to zero over FADE so the sock follows the collar.
# Heights, widths, the rest skeleton and the shape keys' offsets from Basis are unchanged; every key gets the Basis
# move. Run on the pad_weights output, before shoe_weights.py:
#   Blender --background --factory-startup --python scripts/blender/shoe_scale.py -- in.glb out.glb
# Basis (foot length 0.2697 m and heel to first metatarsal head 0.727 of it, DOD-HDBK-743A tables 68a/99a; heel to the
# malleoli midpoint 0.285 of it; scaled by stature to 0.2855 m):
#   FRONT 0.72: the forefoot stud row (0.181 m ahead of the ankle) comes to 0.130 m, over the first metatarsal head and
#   the ball hinge (0.126 m), and the toe tip (0.294 m) to 0.212 m, 0.8 cm beyond the anatomical toe tip (0.204 m).
#   BACK 0.85: the heel back (0.107 m behind the ankle) comes to 0.091 m, the anatomical heel (0.081 m) plus 1 cm of
#   heel cup.
import sys
import bpy

IN, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
FRONT, BACK = 0.72, 0.85
COLLAR = 0.18  # m: the collar top above the stud tips at 6'2" (docs/rig.md "Ankle": 0.175-0.180 m)
FADE = 0.06  # m above the collar top where the sock no longer moves

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
o = max([x for x in bpy.data.objects if x.type == 'MESH' and x.vertex_groups], key=lambda x: len(x.data.vertices))
others = [x for x in bpy.data.objects if x.type == 'MESH' and x is not o]
mw, mwi = o.matrix_world, o.matrix_world.inverted()
ankle_fwd = {s: -(arm.matrix_world @ arm.data.bones[f'mixamorig:{s}Foot'].head_local).y for s in ('Left', 'Right')}

# Blender +Z up, -Y is the glTF/runtime forward +Z; +X is the athlete's left.
moves = {}
for v in o.data.vertices:
    p = mw @ v.co
    f = min(1.0, max(0.0, 1 - (p.z - COLLAR) / FADE))
    if f <= 0:
        continue
    a = ankle_fwd['Left' if p.x > 0 else 'Right']
    d = -p.y - a
    moved = d * (FRONT if d > 0 else BACK) - d
    if moved != 0:
        moves[v.index] = f * moved
keys = o.data.shape_keys.key_blocks if o.data.shape_keys else []
for i, m in moves.items():
    for co in [o.data.vertices[i].co] + [kb.data[i].co for kb in keys]:
        w = mw @ co
        w.y -= m
        co[:] = mwi @ w

vl = bpy.context.view_layer
bpy.ops.object.select_all(action='DESELECT')
for x in (o, *others):
    x.select_set(True)
arm.select_set(True); vl.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_rest_position_armature=False,
                          export_morph=True, export_morph_normal=False, export_yup=True)
print('shoe_scale: wrote', OUT, len(moves), 'vertices moved; front %.2f back %.2f' % (FRONT, BACK))
