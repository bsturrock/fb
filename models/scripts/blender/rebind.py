# Rebinds a hand-edited player mesh to the game rig: weights and texture are taken from a reference glb.
#
# Run headless on the edited .blend (does not touch any open Blender session):
#   /Applications/Blender.app/Contents/MacOS/Blender --background wip_player_2.blend \
#     --python scripts/blender/rebind.py -- models/bew-elbowfix.glb models/bew-v2.glb [glove hex color]
#
# The .blend holds `geometry_0` (parented to `Armature`, optionally with a Mirror modifier) in the reference's
# rest shape. Steps: apply the mirror, rebuild every bone weight from the nearest reference surface (so a
# mirrored half follows its own side's bones), give the mesh a fresh UV layout and bake the reference texture
# onto it (the reference atlas has many small islands, so copied UVs smear across seams), flat shading, export
# with the reference's node pose so joints and inverse bind matrices match (see docs/rig.md).
# Any other mesh parented to `Armature` with an Armature modifier (the separate helmet) is rebound the same way,
# with its own texture, and exported as its own mesh named `helmet`. It is rigid: every vertex goes 100 % to the
# bone that leads the nearest-surface weights over the whole mesh (Head), so a low rim never follows the pads.
# A helmet with its own texture (an image not shared with geometry_0, e.g. one painted in Blender) keeps its UVs,
# material and image; otherwise it gets a fresh layout and a bake like the body.
# The body keeps its UVs and texture the same way when its image is a saved file (painted in Blender, e.g.
# body_paint.png; a texture imported from a glb has no file path). Then there is no bake and no glove fill.
# Shape keys on the body survive: each key is evaluated with the mirror on its own (show_only_shape_key), the keys are
# re-added to the mirrored mesh, and they export as glTF morph targets (no morph normals; the game draws flat shading).
# Weights come from the Basis positions.

import sys
import bpy
import bmesh
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

args = sys.argv[sys.argv.index('--') + 1:]
REF, OUT = args[:2]
# Optional third argument: glove color as hex (e.g. ebebeb), applied to everything past the wrist joints.
HAND_COLOR = tuple(int(args[2][i:i + 2], 16) / 255 for i in (0, 2, 4)) if len(args) > 2 else None

o = bpy.data.objects['geometry_0']
arm = bpy.data.objects['Armature']
extras = [x for x in bpy.data.objects if x.type == 'MESH' and x is not o and x.parent is arm
          and any(m.type == 'ARMATURE' for m in x.modifiers)]
vl = bpy.context.view_layer
for x in (o, arm, *extras):
    x.hide_set(False); x.hide_viewport = False; x.hide_select = False; x.hide_render = False
with bpy.context.temp_override(active_object=o, object=o, selected_objects=[o]):
    if o.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

def key_coords(x):
    """Mirror-applied vertex positions of every shape key of x (armature already off), by key name; {} without keys."""
    keys = x.data.shape_keys.key_blocks if x.data.shape_keys else []
    out = {}
    x.show_only_shape_key = True
    for i, kb in enumerate(keys):
        x.active_shape_key_index = i
        vl.update()
        ev = x.evaluated_get(bpy.context.evaluated_depsgraph_get())
        m = ev.to_mesh()
        out[kb.name] = [v.co.copy() for v in m.vertices]
        ev.to_mesh_clear()
    x.active_shape_key_index = 0  # the evaluated mesh below is then the Basis shape
    vl.update()
    return out

def apply_mirror(x):
    """Apply the mirror alone (armature off so the pose is not baked in), keeping shape keys. Returns the replaced mesh."""
    amod = next(m for m in x.modifiers if m.type == 'ARMATURE')
    amod.show_viewport = amod.show_render = False
    mirror = next((m for m in x.modifiers if m.type == 'MIRROR'), None)
    keys = key_coords(x)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(x.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old_mesh = x.data
    x.data = me
    if mirror:
        x.modifiers.remove(mirror)
    if keys:
        n = len(me.vertices)
        bad = {k: len(c) for k, c in keys.items() if len(c) != n}
        assert not bad, 'rebind: %s shape keys changed the mirror merge (vertex counts %s, Basis %d)' % (x.name, bad, n)
        if me.shape_keys:
            x.shape_key_clear()
        for name, co in keys.items():
            kb = x.shape_key_add(name=name, from_mix=False)
            kb.data.foreach_set('co', [c for v in co for c in v])
        x.show_only_shape_key = False
        print('rebind: %s shape keys %s' % (x.name, list(keys)))
    # bmesh keeps the shape-key layers, so the merge below applies to every key.
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me); bm.free()
    return amod, old_mesh

def images(x):
    return {n.image for m in x.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
painted = {x.name for x in extras if images(x) and not images(x) & images(o)}
if any(i.filepath for i in images(o)):
    painted.add(o.name)
parts = [(x, *apply_mirror(x)) for x in (o, *extras)]

# Reference surface in world space (rest shape).
before = set(bpy.data.objects.keys())
bpy.ops.import_scene.gltf(filepath=REF)
imported = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
ref = next(x for x in imported if x.type == 'MESH' and x.vertex_groups)
for m in ref.modifiers:
    if m.type == 'ARMATURE':
        m.show_viewport = m.show_render = False
rbm = bmesh.new(); rbm.from_mesh(ref.data); rbm.transform(ref.matrix_world)
rbm.faces.ensure_lookup_table()
bvh = BVHTree.FromBMesh(rbm)
rdl = rbm.verts.layers.deform.active
rname = {g.index: g.name for g in ref.vertex_groups}

def rebuild_weights(x, rigid=False):
    """Interpolate the nearest reference face, keep the top 4 influences, normalize (rigid: one bone for all)."""
    W, me = x.matrix_world, x.data
    x.vertex_groups.clear()
    groups = {b.name: x.vertex_groups.new(name=b.name) for b in arm.data.bones}
    far, total, per = 0.0, {}, []
    for v in me.vertices:
        loc, _, fi, dist = bvh.find_nearest(W @ v.co)
        far = max(far, dist)
        f = rbm.faces[fi]
        acc = {}
        for rv, w in zip(f.verts, poly_3d_calc([c.co for c in f.verts], loc)):
            for gi, gw in rv[rdl].items():
                acc[rname[gi]] = acc.get(rname[gi], 0.0) + gw * w
        for n, w in acc.items():
            total[n] = total.get(n, 0.0) + w
        per.append(acc)
    lead = max(total, key=total.get)
    for v, acc in zip(me.vertices, per):
        top = [(1.0, lead)] if rigid else sorted(((w, n) for n, w in acc.items() if w > 1e-4), reverse=True)[:4]
        tot = sum(w for w, _ in top)
        for w, n in top:
            groups[n].add([v.index], w / tot, 'REPLACE')
    print('rebind: %s max distance to reference surface (m): %.4f%s' % (x.name, far, ', rigid on ' + lead if rigid else ''))

def bake(x, image_name, size):
    """Fresh UVs, reference albedo baked across (selected to active)."""
    me = x.data
    for u in list(me.uv_layers):
        me.uv_layers.remove(u)
    me.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT')
    x.select_set(True); vl.objects.active = x
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    tex = bpy.data.images.new(image_name, size, size)
    mat = ref.data.materials[0].copy()
    img_node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    img_node.image = tex
    mat.node_tree.nodes.active = img_node
    me.materials.clear(); me.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
    bk = sc.render.bake
    bk.use_selected_to_active = True; bk.cage_extrusion = 0.05; bk.max_ray_distance = 0.12; bk.margin = 8
    bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
    ref.select_set(True); x.select_set(True); vl.objects.active = x
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    return tex, mat

for x, _, _ in parts:
    rebuild_weights(x, rigid=x is not o)
def own(x):
    mat = x.data.materials[0]
    tex = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    print('rebind: %s keeps its own texture %s' % (x.name, tex.name))
    return tex, mat
tex, mat = own(o) if o.name in painted else bake(o, 'Image_0', 1024)
extra_mats = [own(x) if x.name in painted else bake(x, 'Image_%d' % (k + 1), 512) for k, x in enumerate(extras)]
baked = {id(t) for x, (t, _) in zip(extras, extra_mats) if x.name not in painted}
me, W = o.data, o.matrix_world

# Optional glove color: faces past each wrist joint (along the hand bone) are filled flat. The bake cannot
# reach geometry that extends past the reference mitten, so a modeled glove needs its own color.
if HAND_COLOR and o.name in painted:
    print('rebind: body is painted, glove color ignored')
elif HAND_COLOR:
    import numpy as np
    size = tex.size[0]
    px = np.array(tex.pixels[:], dtype=np.float32).reshape(size, size, 4)
    owner = np.full((size, size), -1, dtype=np.int32)  # face index covering each texel, -1 = empty atlas
    AW = arm.matrix_world
    wrists = []
    for side in ('Left', 'Right'):
        b = arm.data.bones['mixamorig:%sHand' % side]
        h, t = AW @ b.head_local, AW @ b.tail_local
        wrists.append((h, (t - h).normalized()))
    def past_wrist(p):
        return any((p - h).dot(d) >= -0.003 for h, d in wrists if (p - h).dot(d) > -0.1 and (p - h).length < 0.35)
    glove = set()
    uvd = me.uv_layers.active.data
    for poly in me.polygons:
        if all(past_wrist(W @ me.vertices[vi].co) for vi in poly.vertices):
            glove.add(poly.index)
        uv = np.array([uvd[li].uv[:] for li in poly.loop_indices]) * size - 0.5
        for k in range(1, len(uv) - 1):
            tri = uv[[0, k, k + 1]]
            x0, y0 = np.floor(tri.min(0)).astype(int).clip(0, size - 1)
            x1, y1 = np.ceil(tri.max(0)).astype(int).clip(0, size - 1)
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            (ax, ay), (bx, by), (cx, cy) = tri
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            inside = (l1 >= -1e-3) & (l2 >= -1e-3) & (1 - l1 - l2 >= -1e-3)
            owner[ys[inside], xs[inside]] = poly.index
    mask = np.isin(owner, list(glove))
    # Grow into empty atlas only (never into other faces), so filtering at the glove's edges stays white.
    grown = mask.copy()
    for _ in range(6):
        g = grown.copy()
        g[1:] |= grown[:-1]; g[:-1] |= grown[1:]; g[:, 1:] |= grown[:, :-1]; g[:, :-1] |= grown[:, 1:]
        grown = g & ((owner == -1) | mask)
    px[grown, :3] = HAND_COLOR
    tex.pixels[:] = px.ravel()
    print('rebind: glove faces', len(glove))
# The helmet has no skin: where its bake reached the reference face through a reshaped facemask, the texels come out
# skin-toned. Those become the facemask gray (the median gray the bake did find on the helmet).
def unskin(t):
    import numpy as np
    px = np.array(t.pixels[:], dtype=np.float32).reshape(-1, 4)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    skin = (r > g + 0.04) & (g > b + 0.02) & (r > 0.1)
    gray = (np.abs(r - g) < 0.03) & (np.abs(g - b) < 0.03) & (r > 0.2)
    if skin.any() and gray.any():
        px[skin, :3] = np.median(px[gray, :3], axis=0)
        t.pixels[:] = px.ravel()
    print('rebind: %s skin texels recolored to facemask gray: %d' % (t.name, int(skin.sum())))
tex.pack()
for t, _ in extra_mats:
    if id(t) in baked:
        unskin(t)
    t.pack()

# Flat shading like the reference; drop stale custom normals from the import.
for x, _, _ in parts:
    if 'custom_normal' in x.data.attributes:
        x.data.attributes.remove(x.data.attributes['custom_normal'])
    x.data.shade_flat()

ref_mesh, ref_mats = ref.data, list(ref.data.materials)
for x in imported:
    bpy.data.objects.remove(x, do_unlink=True)
for d in [old for _, _, old in parts] + [ref_mesh]:
    if not d.users:
        bpy.data.meshes.remove(d)
for m in ref_mats:
    if not m.users:
        bpy.data.materials.remove(m)
for _, amod, _ in parts:
    amod.show_viewport = amod.show_render = True
mat.name = 'Material_0'
me.name = 'geometry_0'
for k, x in enumerate(extras):
    x.name = x.data.name = 'helmet' if k == 0 else 'helmet_%d' % k
    extra_mats[k][1].name = 'Material_%d' % (k + 1)
bpy.ops.object.select_all(action='DESELECT')
for x, _, _ in parts:
    x.select_set(True)
arm.select_set(True); vl.objects.active = arm
# Current pose = the reference's node pose (the glTF importer's pose), so the export matches it.
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_rest_position_armature=False,
                          export_morph=True, export_morph_normal=False, export_yup=True)
print('rebind: wrote', OUT, ', '.join('%s %d vertices' % (x.name, len(x.data.vertices)) for x, _, _ in parts))
