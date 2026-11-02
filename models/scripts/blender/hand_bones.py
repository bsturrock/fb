# Adds thumb and mitten bones under each hand of a rebound player glb, and reweights the wrist and glove.
#
# Run headless (does not touch any open Blender session):
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
#     --python scripts/blender/hand_bones.py -- models/bew-v3.glb models/bew-v4.glb
#
# The 25 existing joints keep their rest pose, node pose and inverse bind matrices, so the body profile and the
# sim are unchanged; the new bones are only available to the presentation (see docs/rig.md). Per hand:
#   mixamorig:<Side>HandThumb1/2   thumb root (in the palm) and the free thumb past the split
#   mixamorig:<Side>HandIndex1/2   the mitten (all four fingers as one), knuckle and second segment
# Every new bone's local Z points to the palm and local X runs across it, so +X rotation curls toward the palm.
# The forearm gets an extra ring 3 cm before the wrist, and the wrist ramp is made even: 0 % hand 7 cm before the
# joint, 50 % on it, 100 % 3.5 cm past it. Inside the hand, weights come from bone heat on the glove alone.
# Morph targets of the input (e.g. v6 `lean`, `heavy`) come in as shape keys; bmesh carries them through the added
# forearm ring (new vertices interpolate every key), and they export again without morph normals.

import sys
import bpy
import bmesh
from mathutils import Vector

IN, OUT = sys.argv[sys.argv.index('--') + 1:][:2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
skinned = [x for x in bpy.data.objects if x.type == 'MESH' and x.vertex_groups]
o = bpy.data.objects.get('geometry_0') or max(skinned, key=lambda x: len(x.data.vertices))
extras = [x for x in skinned if x is not o]                # e.g. the separate helmet: exported unchanged
for x in list(bpy.data.objects):
    if x not in (arm, o, *extras):
        bpy.data.objects.remove(x, do_unlink=True)
vl = bpy.context.view_layer
AW, AWi = arm.matrix_world, arm.matrix_world.inverted()
W = o.matrix_world
amod = next(m for m in o.modifiers if m.type == 'ARMATURE')
amod.show_viewport = amod.show_render = False

SIDES = ('Left', 'Right')
def name(side, part):
    return 'mixamorig:%s%s' % (side, part)

# Hand frame per side (world, rest): wrist, along the hand, across the palm, palm normal.
frames = {}
for side in SIDES:
    b = arm.data.bones[name(side, 'Hand')]
    h, t = AW @ b.head_local, AW @ b.tail_local
    along = (t - h).normalized()
    palm = Vector((0, 0, -1))                       # T-pose: palms face down
    palm = (palm - along * palm.dot(along)).normalized()
    frames[side] = (h, along, along.cross(palm).normalized() * -1, palm)

def local(p, side):
    h, al, ac, pn = frames[side]
    q = p - h
    return q.dot(al), q.dot(ac), q.dot(pn)

def hand_side(p):
    for side in SIDES:
        h, al, _, _ = frames[side]
        q = p - h
        if q.dot(al) > -0.12 and (q - al * q.dot(al)).length < 0.15:
            return side
    return None

me = o.data
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)

# Extra forearm ring 3 cm before each wrist (interpolates UVs and weights).
for side in SIDES:
    h, al, _, _ = frames[side]
    faces = [f for f in bm.faces if all(hand_side(W @ v.co) == side and -0.09 < local(W @ v.co, side)[0] < 0.01 for v in f.verts)]
    geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
    co = W.inverted() @ (h - al * 0.03)
    no = (W.inverted().to_3x3() @ al).normalized()
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-4)

# Thumb / mitten split: the glove part past the wrist separates into two pieces some way along the hand.
def split(side):
    verts = [v for v in bm.verts if hand_side(W @ v.co) == side and local(W @ v.co, side)[0] > 0]
    for ts in [x / 200 for x in range(4, 40)]:
        s = {v for v in verts if local(W @ v.co, side)[0] >= ts}
        seen, parts = set(), []
        for v in s:
            if v in seen:
                continue
            st, part = [v], []
            seen.add(v)
            while st:
                x = st.pop(); part.append(x)
                for e in x.link_edges:
                    y = e.other_vert(x)
                    if y in s and y not in seen:
                        seen.add(y); st.append(y)
            parts.append(part)
        if len(parts) == 2:
            thumb, mitten = sorted(parts, key=len)
            return ts, thumb, mitten
    raise SystemExit('hand_bones: no thumb/mitten split found on the %s hand' % side)

def centroid(vs):
    return sum((W @ v.co for v in vs), Vector()) / len(vs)

def tip(vs, side):
    return max(vs, key=lambda v: local(W @ v.co, side)[0])

# New bones (armature space), parented to the hand.
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); vl.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
chains = {}
for side in SIDES:
    h, al, ac, pn = frames[side]
    ts, thumb, mitten = split(side)
    mc = centroid(mitten)
    m_axis_off = (mc - h) - al * (mc - h).dot(al)       # mitten centre line, off the hand axis
    t_far = local(W @ tip(thumb, side).co, side)[0]
    t_tip = centroid([v for v in thumb if local(W @ v.co, side)[0] > t_far - 0.012])
    m_len = local(W @ tip(mitten, side).co, side)[0]
    t_root = h + al * (ts * 0.5) + ((centroid(thumb) - h) - al * (centroid(thumb) - h).dot(al)) * 0.6
    t_mid = centroid(thumb) - al * 0.01
    pts = {
        'HandThumb1': (t_root, t_mid),
        'HandThumb2': (t_mid, t_tip),
        'HandIndex1': (h + al * ts + m_axis_off, h + al * (ts + (m_len - ts) * 0.5) + m_axis_off),
        'HandIndex2': (h + al * (ts + (m_len - ts) * 0.5) + m_axis_off, h + al * m_len + m_axis_off),
    }
    parent = eb[name(side, 'Hand')]
    made = {}
    for part, (a, b) in pts.items():
        bone = eb.new(name(side, part))
        bone.head, bone.tail = AWi @ a, AWi @ b
        bone.align_roll(AWi.to_3x3() @ pn)             # local Z to the palm, so +X curls toward it
        bone.parent = made.get('HandThumb1') if part == 'HandThumb2' else made.get('HandIndex1') if part == 'HandIndex2' else parent
        bone.use_connect = part in ('HandThumb2', 'HandIndex2')
        made[part] = bone
    chains[side] = (ts, {v.index for v in thumb}, {v.index for v in mitten})
bpy.ops.object.mode_set(mode='OBJECT')

if 'custom_normal' in me.attributes:
    me.attributes.remove(me.attributes['custom_normal'])
bm.to_mesh(me); bm.free()
me.shade_flat()

# Bone heat on the glove alone (hand chain only), then the even wrist ramp on top.
for side in SIDES:
    hand_chain = [name(side, p) for p in ('Hand', 'HandThumb1', 'HandThumb2', 'HandIndex1', 'HandIndex2')]
    glove_idx = [v.index for v in me.vertices if hand_side(W @ v.co) == side and local(W @ v.co, side)[0] > -0.005]
    tmp = o.copy(); tmp.data = me.copy(); tmp.modifiers.clear(); tmp.vertex_groups.clear()
    bpy.context.scene.collection.objects.link(tmp)
    tbm = bmesh.new(); tbm.from_mesh(tmp.data); tbm.verts.ensure_lookup_table()
    keep = set(glove_idx)
    bmesh.ops.delete(tbm, geom=[v for v in tbm.verts if v.index not in keep], context='VERTS')
    tbm.to_mesh(tmp.data); tbm.free()
    order = sorted(keep)                                # bmesh.delete keeps the survivors' order
    saved = {b.name: b.use_deform for b in arm.data.bones}
    for b in arm.data.bones:
        b.use_deform = b.name in hand_chain
    bpy.ops.object.select_all(action='DESELECT')
    tmp.select_set(True); arm.select_set(True); vl.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for b in arm.data.bones:
        b.use_deform = saved[b.name]
    heat = {}
    for tv, src in zip(tmp.data.vertices, order):
        ws = {tmp.vertex_groups[g.group].name: g.weight for g in tv.groups if g.weight > 1e-4}
        tot = sum(ws.values())
        heat[src] = {n: w / tot for n, w in ws.items()} if tot > 0 else {name(side, 'Hand'): 1.0}
    bpy.data.objects.remove(tmp, do_unlink=True)

    groups = {g.name: g for g in o.vertex_groups}
    for n in hand_chain:
        if n not in groups:
            groups[n] = o.vertex_groups.new(name=n)
    fore = groups[name(side, 'ForeArm')]
    for v in me.vertices:
        p = W @ v.co
        if hand_side(p) != side:
            continue
        t = local(p, side)[0]
        if t < -0.075:
            continue
        others = [g for g in v.groups if o.vertex_groups[g.group].name not in hand_chain + [fore.name] and g.weight > 1e-3]
        if others:
            continue                                    # leave anything that is not a forearm/hand vertex alone
        wh = 0.0 if t <= -0.07 else 0.5 * (t + 0.07) / 0.07 if t <= 0 else min(1.0, 0.5 + 0.5 * t / 0.035)
        for n in hand_chain:
            groups[n].remove([v.index])
        fore.add([v.index], 1 - wh, 'REPLACE') if wh < 1 else fore.remove([v.index])
        split_w = dict(heat.get(v.index, {name(side, 'Hand'): 1.0})) if t > -0.005 else {name(side, 'Hand'): 1.0}
        # Heat bleeds the thumb into the wrist and palm; fade finger bones in over 1-5 cm past the joint.
        s = min(1.0, max(0.0, (t - 0.01) / 0.04))
        moved = sum(w for n, w in split_w.items() if n != name(side, 'Hand')) * (1 - s)
        split_w = {n: (w * s if n != name(side, 'Hand') else w) for n, w in split_w.items()}
        split_w[name(side, 'Hand')] = split_w.get(name(side, 'Hand'), 0.0) + moved
        top = sorted(((w, n) for n, w in split_w.items()), reverse=True)[:3 if wh < 1 else 4]
        tot = sum(w for w, _ in top)
        for w, n in top:
            if wh * w / tot > 1e-3:
                groups[n].add([v.index], wh * w / tot, 'REPLACE')
    print('hand_bones: %s split at %.3f m, thumb %d / mitten %d tip verts' % (side, chains[side][0], len(chains[side][1]), len(chains[side][2])))

amod.show_viewport = amod.show_render = True
bpy.ops.object.select_all(action='DESELECT')
for x in (o, *extras):
    x.select_set(True)
arm.select_set(True); vl.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True,
                          export_animations=False, export_rest_position_armature=False,
                          export_morph=True, export_morph_normal=False, export_yup=True)
print('hand_bones: wrote', OUT, len(me.vertices), 'vertices,', len(arm.data.bones), 'bones')
