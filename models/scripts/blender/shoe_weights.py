# The shoe is rigid on the foot (sim-5 M1): every vertex of a shoe-coloured face (key colour 030303, docs/rig.md colour
# regions; this includes the collar ring the shoe shares with the sock, and the sock's copy of each collar vertex) moves
# its shin (Leg) weight onto the foot bone of its side, keeping its Foot/ToeBase split. With the reference weights the
# collar carried up to 44 % shin weight and the heel 12-25 %, so a bent ankle lifted the heel counter about 2.5 cm off the foot in the `ready` crouch (shin 47 deg
# forward) and the shoe no longer matched its foot colliders. The sock above the collar keeps its blend and takes the
# bend. Above the collar the leg follows the shin: the reference weights spread Foot weight up to mid-calf and ToeBase
# weight onto the sock, so a bent ankle (hinge 7 cm under the collar, docs/rig.md "Ankle") swung the calf off the shin
# and a flexed toe moved the sock. A non-shoe vertex keeps at most 1 - (height above its shoe's collar top) / FADE of
# Foot weight (its ToeBase weight counts as Foot; the toe hinges only the shoe), the rest goes to the shin, so the sock
# takes the bend between the collar and FADE above it. The shoe's own Foot/ToeBase split follows the ball hinge
# (docs/rig.md "Ball"; stretch_rig.py places it at the first metatarsal head): a shoe vertex's foot weight goes to the
# toe by its distance ahead of the hinge (along the shoe's forward axis, as the physical hinge turns about the shoe's
# x axis), linear over BAND, so the shoe bends where the foot does rather than at the art's toe-box crease. Run on the pad_weights output, in place:
#   Blender --background --factory-startup --python scripts/blender/shoe_weights.py -- models/bew-v6.glb models/bew-v6.glb
# Morph targets pass through as shape keys, as in pad_weights.py.
import sys
import bpy

IN, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
SHOE = (3, 3, 3)
FADE = 0.10  # m above the collar top where the sock is all shin
BAND = 0.02  # m along the foot over which a shoe vertex passes from the foot to the toe bone, centred on the hinge

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
skinned = [x for x in bpy.data.objects if x.type == 'MESH' and x.vertex_groups]
o = bpy.data.objects.get('geometry_0') or max(skinned, key=lambda x: len(x.data.vertices))
extras = [x for x in skinned if x is not o]

# The painted texture (the body material's base colour image), sampled at each face's UV centroid. Blender's UV and
# pixel origins are both bottom left.
img = next(n.image for m in o.data.materials for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
w, h = img.size
px = img.pixels[:]
def key(u, v):
    x = min(w - 1, max(0, int(u * w))); y = min(h - 1, max(0, int(v * h)))
    i = (y * w + x) * img.channels
    return tuple(round(px[i + k] * 255) for k in range(3))

uv = o.data.uv_layers.active.data
shoe = set()
for poly in o.data.polygons:
    n = len(poly.loop_indices)
    u = sum(uv[li].uv.x for li in poly.loop_indices) / n
    v = sum(uv[li].uv.y for li in poly.loop_indices) / n
    if all(abs(a - b) <= 2 for a, b in zip(key(u, v), SHOE)):
        shoe.update(poly.vertices)
# The mesh is split along colour seams: a sock vertex at the same place as a shoe vertex moves with it, or the collar
# would tear open as the ankle bends.
at = lambda vi: tuple(round(c, 5) for c in o.data.vertices[vi].co)
places = {at(vi) for vi in shoe}
shoe.update(vi for vi in range(len(o.data.vertices)) if at(vi) in places)

moved = 0
for side in ('Left', 'Right'):
    leg, foot = o.vertex_groups[f'mixamorig:{side}Leg'], o.vertex_groups[f'mixamorig:{side}Foot']
    for vi in shoe:
        wl = next((g.weight for g in o.data.vertices[vi].groups if g.group == leg.index), 0.0)
        if wl <= 0:
            continue
        leg.remove([vi])
        foot.add([vi], wl, 'ADD')
        moved += 1

mw = o.matrix_world
head = lambda b: arm.matrix_world @ arm.data.bones[f'mixamorig:{b}'].head_local
split = 0
for side, sgn in (('Left', 1), ('Right', -1)):
    foot, toe = o.vertex_groups[f'mixamorig:{side}Foot'], o.vertex_groups[f'mixamorig:{side}ToeBase']
    ball = head(f'{side}ToeBase')
    for vi in shoe:
        p = mw @ o.data.vertices[vi].co
        if sgn * p.x <= 0:
            continue
        w = {g.group: g.weight for g in o.data.vertices[vi].groups}
        wf = w.get(foot.index, 0.0) + w.get(toe.index, 0.0)
        if wf <= 0:
            continue
        t = min(1.0, max(0.0, 0.5 + (ball.y - p.y) / BAND))  # Blender -Y is the glTF/runtime forward +Z
        foot.add([vi], wf * (1 - t), 'REPLACE') if t < 1 else foot.remove([vi])
        toe.add([vi], wf * t, 'REPLACE') if t > 0 else toe.remove([vi])
        split += 1

height = lambda vi: (mw @ o.data.vertices[vi].co).z  # Blender is +Z up
eased = 0
for side, sgn in (('Left', 1), ('Right', -1)):
    leg, foot, toe = (o.vertex_groups[f'mixamorig:{side}{b}'] for b in ('Leg', 'Foot', 'ToeBase'))
    top = max(height(vi) for vi in shoe if sgn * (mw @ o.data.vertices[vi].co).x > 0)
    for v in o.data.vertices:
        if v.index in shoe or sgn * (mw @ v.co).x <= 0:
            continue
        w = {g.group: g.weight for g in v.groups}
        wf, wt = w.get(foot.index, 0.0), w.get(toe.index, 0.0)
        if wf + wt <= 0:
            continue
        keep = min(wf + wt, max(0.0, 1 - (height(v.index) - top) / FADE))
        if wt > 0:
            toe.remove([v.index])
        foot.add([v.index], keep, 'REPLACE') if keep > 0 else foot.remove([v.index])
        leg.add([v.index], wf + wt - keep, 'ADD')
        eased += 1

vl = bpy.context.view_layer
bpy.ops.object.select_all(action='DESELECT')
for x in (o, *extras):
    x.select_set(True)
arm.select_set(True); vl.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_rest_position_armature=False,
                          export_morph=True, export_morph_normal=False, export_yup=True)
print('shoe_weights: wrote', OUT, len(shoe), 'shoe vertices,', moved, 'moved off the shin,', split, 'split at the ball,', eased, 'sock/shin vertices onto the shin')
