# Retargets a non-Mixamo capture clip (the 61-bone "Newton" rig: Hips, Spine1-4, Thigh/Shin/Foot/Toe, FingerN...)
# onto this project's skeleton, using one of our Mixamo FBX files as the target rig (models/bew-v6 retargeted, the
# same import convention bake_clip.py expects), and writes an FBX on our rig:
#   - trimmed to frames [start, end] of the source;
#   - root motion removed: the hips' horizontal travel is zeroed (height and the body's turn are kept), and the clip is
#     yawed so the entrance runs straight along Mixamo forward (-Y in Blender);
#   - re-grounded: video captures drift vertically, so each foot contact (ball low and slow) is put back on the floor,
#     linearly between contacts;
#   - lightly smoothed (Gaussian, sigma 1 frame) against capture jitter;
#   - each stance foot pinned to one floor point (two-bone leg IK, ramped in and out over 2 frames), computed with the
#     root motion still in, so the planted ball doesn't slide or hover;
#   - limbs and spine follow the source's joint directions; hips, shoulders, hands, head and feet take the source
#     bone's rotation from rest (both rigs rest in a T-pose facing -Y).
# Run: Blender --background --factory-startup --python scripts/blender/retarget_clip.py -- src.fbx target_rig.fbx out.fbx start end
import bpy, sys, math
from mathutils import Matrix, Quaternion, Vector

src_path, rig_path, out_path, start, end = sys.argv[sys.argv.index('--') + 1:]
start, end = int(start), int(end)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

bpy.ops.import_scene.fbx(filepath=src_path)
src_objs = list(bpy.context.selected_objects)
S = [o for o in src_objs if o.type == 'ARMATURE'][0]
bpy.ops.import_scene.fbx(filepath=rig_path)
T = [o for o in bpy.context.selected_objects if o.type == 'ARMATURE'][0]
if T.animation_data: T.animation_data.action = None
for pb in T.pose.bones: pb.matrix_basis = Matrix()
P = 'mixamorig:'

# target bone: (source bone whose rotation from rest it takes, source joint its direction follows or None)
MAP = {'Hips': ('Hips', None), 'Spine': ('Spine2', 'Spine3'), 'Spine1': ('Spine3', 'Spine4'), 'Spine2': ('Spine4', 'Neck'),
       'Neck': ('Neck', 'Head'), 'Head': ('Head', None)}
for s in ('Left', 'Right'):
    MAP.update({s + 'Shoulder': (s + 'Shoulder', None), s + 'Arm': (s + 'Arm', s + 'ForeArm'),
                s + 'ForeArm': (s + 'ForeArm', s + 'Hand'), s + 'Hand': (s + 'Hand', None),
                s + 'UpLeg': (s + 'Thigh', s + 'Shin'), s + 'Leg': (s + 'Shin', s + 'Foot'),
                s + 'Foot': (s + 'Foot', None), s + 'ToeBase': (s + 'Toe', None)})

def rot(m): return m.to_3x3().normalized().to_quaternion()
def src_world(name): return S.matrix_world @ S.pose.bones[name].matrix
def src_head(name): return S.matrix_world @ S.pose.bones[name].head

# --- source analysis: ground track from foot contacts, entrance heading ---
frames = list(range(start, end + 1))
ball = {s: [] for s in ('Left', 'Right')}
hips_src = []
for f in frames:
    sc.frame_set(f)
    for s in ball: ball[s].append(src_head(s + 'Toe').copy())
    hips_src.append(src_head('Hips').copy())
BALL_REST = (S.matrix_world @ S.data.bones['LeftToe'].head_local).z
contacts = []  # (first, last, lowest index, ground height): the ball slow (one fast frame inside a stance is noise)
for s, pts in ball.items():
    slow = [False] + [(pts[i] - pts[i - 1]).xy.length * sc.render.fps < 1.6 for i in range(1, len(pts))]
    slow[0] = slow[1]
    for i in range(1, len(slow) - 1):
        if not slow[i] and slow[i - 1] and slow[i + 1]: slow[i] = True
    i = 0
    while i < len(pts):
        if slow[i]:
            j = i
            while j + 1 < len(pts) and slow[j + 1]: j += 1
            k = min(range(i, j + 1), key=lambda n: pts[n].z)
            contacts.append((i, j, k, pts[k].z - BALL_REST, s))
            i = j + 1
        else: i += 1
# The floor is one height: where two contacts overlap and disagree (capture depth error), keep the lower foot's.
keys = []
for c in contacts:
    beaten = any(o is not c and o[0] <= c[1] and c[0] <= o[1] and o[3] < c[3] for o in contacts)
    print('contact', c[4], frames[c[0]], frames[c[1]], 'ground %.3f' % c[3], '(dropped: overlaps a lower contact)' if beaten else '')
    if not beaten: keys.append((c[2], c[3]))
keys.sort()
def ground(i):
    if i <= keys[0][0]: return keys[0][1]
    for (a, ga), (b, gb) in zip(keys, keys[1:]):
        if i <= b: return ga + (gb - ga) * (i - a) / (b - a)
    return keys[-1][1]
n_in = min(6, len(frames) - 1)
v_in = (hips_src[n_in] - hips_src[0]).xy
yaw = Vector((0, -1)).angle_signed(v_in)  # rotate the entrance onto -Y
ALIGN = Matrix.Rotation(-yaw, 4, 'Z')
print('entrance heading corrected by %.1f deg' % (-yaw * 57.2958))

# --- rest data ---
def leg(arm, a, b, c): return (arm.data.bones[b].head_local - arm.data.bones[a].head_local).length * arm.matrix_world.to_scale()[0] + \
    (arm.data.bones[c].head_local - arm.data.bones[b].head_local).length * arm.matrix_world.to_scale()[0]
K = leg(T, P + 'LeftUpLeg', P + 'LeftLeg', P + 'LeftFoot') / leg(S, 'LeftThigh', 'LeftShin', 'LeftFoot')
src_rest = {n: rot(S.matrix_world @ S.data.bones[n].matrix_local) for n in S.data.bones.keys()}
src_rest_hip_z = (S.matrix_world @ S.data.bones['Hips'].head_local).z
TW = T.matrix_world
tgt_rest = {b.name: rot(TW @ b.matrix_local) for b in T.data.bones}
tgt_rest_dir = {}
for tn, (sn, child) in MAP.items():
    b = T.data.bones[P + tn]
    if child: tgt_rest_dir[tn] = (TW @ b.children[0].head_local - TW @ b.head_local).normalized() if b.children else None
tgt_hip_rest = TW @ T.data.bones[P + 'Hips'].head_local
print('leg scale %.3f' % K)

order = sorted(MAP.keys(), key=lambda n: len(T.pose.bones[P + n].parent_recursive))
N = len(frames)

# --- pass 1: each target bone's world rotation per frame (from the source alone), the hips with their travel ---
Rw = {tn: [] for tn in order}
hips_w = []
for i, f in enumerate(frames):
    sc.frame_set(f)
    for tn in order:
        sn, child = MAP[tn]
        D = rot(ALIGN @ src_world(sn)) @ src_rest[sn].inverted()
        R = D @ tgt_rest[P + tn]
        if child and tgt_rest_dir.get(tn) is not None:
            want = (ALIGN @ src_head(child) - ALIGN @ src_head(sn)).normalized()
            R = (D @ tgt_rest_dir[tn]).rotation_difference(want) @ R
        Rw[tn].append(R)
    h, h0 = ALIGN @ hips_src[i], ALIGN @ hips_src[0]
    hips_w.append(Vector(((h.x - h0.x) * K + tgt_hip_rest.x, (h.y - h0.y) * K + tgt_hip_rest.y,
                          (hips_src[i].z - ground(i)) * K + (tgt_hip_rest.z - src_rest_hip_z * K))))

# --- pass 2: light temporal smoothing (Gaussian, sigma SMOOTH frames) against capture jitter ---
SMOOTH = 1.0
W = [math.exp(-0.5 * (d / SMOOTH) ** 2) for d in range(-3, 4)]
def smooth(vals, add, scale):
    out = []
    for i in range(N):
        acc, ws = None, 0.0
        for d, w in zip(range(-3, 4), W):
            v = vals[min(max(i + d, 0), N - 1)]
            acc = scale(v, w) if acc is None else add(acc, scale(v, w)); ws += w
        out.append(scale(acc, 1 / ws))
    return out
for tn in order:
    q = [r.copy() for r in Rw[tn]]
    for i in range(1, N):
        if q[i].dot(q[i - 1]) < 0: q[i].negate()
    Rw[tn] = [Quaternion(v).normalized() for v in smooth([Vector(x) for x in q], lambda a, b: a + b, lambda a, w: a * w)]
hips_w = smooth(hips_w, lambda a, b: a + b, lambda a, w: a * w)

def pose(i):
    for tn in order:
        pb = T.pose.bones[P + tn]
        head = hips_w[i] if tn == 'Hips' else TW @ pb.head
        pb.matrix = TW.inverted() @ Matrix.LocRotScale(head, Rw[tn][i], None)
        if tn != 'Hips': pb.location = (0, 0, 0)
        bpy.context.view_layer.update()
def wpos(name): return TW @ T.pose.bones[P + name].head
def wrot(name): return rot(TW @ T.pose.bones[P + name].matrix)
def set_world(name, head, R):
    pb = T.pose.bones[P + name]
    pb.matrix = TW.inverted() @ Matrix.LocRotScale(head, R, None)
    bpy.context.view_layer.update()

# --- pass 3: foot contacts on the result (ball slow and near the floor) -> one pinned floor point per stance ---
BALL_Z = (TW @ T.data.bones[P + 'LeftToeBase'].head_local).z
balls = {s: [] for s in ('Left', 'Right')}
for i in range(N):
    pose(i)
    for s in balls: balls[s].append(wpos(s + 'ToeBase').copy())
pins = {s: [None] * N for s in balls}  # (pin, weight) per frame
RAMP = 2
for s, pts in balls.items():
    slow = [False] + [(pts[i] - pts[i - 1]).xy.length * sc.render.fps < 1.6 and pts[i].z < BALL_Z + 0.15 for i in range(1, N)]
    slow[0] = slow[1]
    for i in range(1, N - 1):  # a slip of up to 2 frames inside a stance is capture noise
        for g in (1, 2):
            if slow[i - 1] and i + g < N and slow[i + g] and not any(slow[i:i + g]): slow[i:i + g] = [True] * g
    i = 0
    while i < N:
        if not slow[i]: i += 1; continue
        j = i
        while j + 1 < N and slow[j + 1]: j += 1
        pin = sum((pts[n] for n in range(i, j + 1)), Vector()) / (j - i + 1); pin.z = BALL_Z
        print('stance', s, i + 1, j + 1, 'pin moves the ball up to %.3f m' % max((pts[n] - pin).length for n in range(i, j + 1)))
        for n in range(max(0, i - RAMP), min(N, j + RAMP + 1)):
            w = 1.0 if i <= n <= j else 1 - (i - n if n < i else n - j) / (RAMP + 1)
            if pins[s][n] is None or w > pins[s][n][1]: pins[s][n] = (pin, w)
        i = j + 1

def leg_ik(s, ankle_goal):
    """Two-bone IK: thigh and shin reach ankle_goal in the knee's current bend plane; the foot keeps its world rotation."""
    up, lo, ft = s + 'UpLeg', s + 'Leg', s + 'Foot'
    Rf = wrot(ft)
    H, Kn, A = wpos(up), wpos(lo), wpos(ft)
    l1, l2 = (Kn - H).length, (A - Kn).length
    to = ankle_goal - H
    d = min(max(to.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    if to.length > l1 + l2: print('  unreachable by %.3f m' % (to.length - l1 - l2))
    u = to.normalized()
    kd = (Kn - H) - u * (Kn - H).dot(u)
    kd = kd.normalized() if kd.length > 1e-6 else Vector((0, -1, 0))
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    K2 = H + u * a + kd * math.sqrt(max(l1 * l1 - a * a, 0))
    set_world(up, H, (Kn - H).rotation_difference(K2 - H) @ wrot(up))
    A_now = wpos(ft)
    set_world(lo, K2, (A_now - K2).rotation_difference(H + u * d - K2) @ wrot(lo))
    set_world(ft, wpos(ft), Rf)

# --- pass 4: pose, pin the stance feet, then remove root motion (hips horizontal travel) and key ---
for i in range(N):
    pose(i)
    for s in pins:
        if pins[s][i] is None: continue
        pin, w = pins[s][i]
        ball = wpos(s + 'ToeBase')
        leg_ik(s, wpos(s + 'Foot') + (pin - ball) * w)
    hp = T.pose.bones[P + 'Hips']
    set_world('Hips', Vector((tgt_hip_rest.x, tgt_hip_rest.y, hips_w[i].z)), wrot('Hips'))
    for tn in order:
        pb = T.pose.bones[P + tn]
        if tn != 'Hips': pb.location = (0, 0, 0)
        pb.keyframe_insert('rotation_quaternion', frame=i + 1)
    hp.keyframe_insert('location', frame=i + 1)

act = T.animation_data.action
act.name = bpy.path.display_name_from_filepath(out_path)
sc.frame_start, sc.frame_end = 1, len(frames)
for o in src_objs: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
T.select_set(True)
for c in T.children: c.select_set(True)
bpy.ops.export_scene.fbx(filepath=out_path, use_selection=True, object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False,
                         bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False, bake_anim_simplify_factor=0)
print('retargeted', src_path, start, end, '->', out_path, len(frames), 'frames')
