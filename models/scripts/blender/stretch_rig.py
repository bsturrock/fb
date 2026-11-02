# Lengthens the legs of a player glb: moves the joints and the skinned mesh by a vertical displacement field and
# rewrites the node translations and inverse bind matrices. Node rotations and scales are kept, so every bone keeps its
# rest orientation and only the leg bones get longer. The output is a consistent reference (mesh, weights, texture,
# skeleton) for rebinding a hand-edited mesh of the new size with scripts/blender/rebind.py.
#
# Run headless with Blender's Python (it has numpy):
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
#     --python scripts/blender/stretch_rig.py -- models/bew-elbowfix.glb <out.glb> 0.182 0.089
#
# Field (glTF +Y up, by rest height y): 0 at and below the ankle joint (Foot), `knee` m at the knee joint (Leg), `hip` m
# at the hip joint (UpLeg) and above; linear in between. So the shin grows by `knee`, the thigh by `hip - knee`, and
# everything from the hips up rises by `hip` unchanged.
#
# Optional 5th argument `ankle` (m): the functional ankle. The inherited Foot joint sits 0.191 m above the stud tips,
# above the boot collar (0.175-0.180 m), outside the shoe. The ankle hinge goes down the shin line (knee to old ankle,
# so every bone keeps its rest rotation) to that height inside the boot; the mesh does not move and the ball/toe joints
# keep their world places. Basis (docs/rig.md "Ankle"): the sole-plate top (0.035 m) plus the US Army men (1988) mean
# lateral malleolus height, 6.71 cm (DOD-HDBK-743A table 113a), scaled by stature: 0.106 m.
#
# Optional 6th argument `ball` (m): the functional ball (toe) hinge, as its forward distance from the functional ankle.
# The inherited ToeBase joint sits 0.188 m ahead of the ankle, at the shoe's toe-box crease, about 6 cm forward of the
# first metatarsal head. The hinge moves along its own horizontal ankle-to-ball line, at its own height, to that
# distance; the mesh and Toe_End do not move (scripts/blender/shoe_weights.py re-splits the shoe at the new hinge).
# Basis (docs/rig.md "Ball"): heel to first metatarsal head 0.727 of foot length (DOD-HDBK-743A tables 68a/99a), heel
# to the malleoli midpoint 0.285 of foot length, foot length 0.2697 m scaled by stature: 0.442 x 0.2855 = 0.126 m.

import json, struct, sys
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:]
IN, OUT, HIP, KNEE = ARGS[:4]
HIP, KNEE = float(HIP), float(KNEE)
ANKLE = float(ARGS[4]) if len(ARGS) > 4 else None
BALL = float(ARGS[5]) if len(ARGS) > 5 else None

d = open(IN, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]
g = json.loads(d[20:20 + jl])
bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]
bin_ = bytearray(d[28 + jl:28 + jl + bl])
nodes = g['nodes']
parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
idx = {n.get('name'): i for i, n in enumerate(nodes)}

def trs(n):
    t = np.array(n.get('translation', [0, 0, 0]), float)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = np.array(n.get('scale', [1, 1, 1]), float)
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4); m[:3, :3] = r * s; m[:3, 3] = t
    return m

def world(i, local):
    m = local[i]
    while i in parent:
        i = parent[i]; m = local[i] @ m
    return m

old_local = [trs(n) for n in nodes]
old_world = [world(i, old_local) for i in range(len(nodes))]
y_of = lambda name: old_world[idx['mixamorig:' + name]][1, 3]
Y_ANKLE, Y_KNEE, Y_HIP = (np.mean([y_of(s + p) for s in ('Left', 'Right')]) for p in ('Foot', 'Leg', 'UpLeg'))

def lift(y):
    """Vertical displacement for a rest height y (vectorized)."""
    return np.interp(y, [Y_ANKLE, Y_KNEE, Y_HIP], [0.0, KNEE, HIP])

skin = g['skins'][0]
joints = skin['joints']
new_world = {}
for i in range(len(nodes)):
    if i in joints:
        m = old_world[i].copy(); m[1, 3] += lift(m[1, 3]); new_world[i] = m
if ANKLE is not None:
    for side in ('Left', 'Right'):
        f, k = idx['mixamorig:%sFoot' % side], idx['mixamorig:%sLeg' % side]
        a, b = new_world[k][:3, 3], new_world[f][:3, 3].copy()
        new_world[f][:3, 3] = b + (a - b) * (ANKLE - b[1]) / (a[1] - b[1])
if BALL is not None:
    for side in ('Left', 'Right'):
        f, t = idx['mixamorig:%sFoot' % side], idx['mixamorig:%sToeBase' % side]
        a, b = new_world[f][:3, 3], new_world[t][:3, 3]
        k = BALL / (b[2] - a[2])  # glTF +Z forward; x scales with z so the hinge stays on its ankle-to-ball line
        new_world[t][0, 3], new_world[t][2, 3] = a[0] + k * (b[0] - a[0]), a[2] + k * (b[2] - a[2])
# Joints keep their world rotation and scale, so each one's local translation is its new position in the parent's
# new frame; non-joint nodes (Armature, the mesh node) do not move.
def new_world_of(i):
    return new_world[i] if i in new_world else old_world[i]
for i in joints:
    p = parent.get(i)
    pw = new_world_of(p) if p is not None else np.eye(4)
    t = np.linalg.inv(pw) @ new_world[i][:, 3]
    nodes[i]['translation'] = [float(v) for v in t[:3]]

def accessor(k):
    a = g['accessors'][k]; bv = g['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    assert a['componentType'] == 5126
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 4 * n)
    assert stride == 4 * n
    return a, off, n

# Inverse bind matrices: bind = jointWorld @ IBM is the same mesh-to-world map before and after.
a, off, _ = accessor(skin['inverseBindMatrices'])
ibm = np.frombuffer(bytes(bin_[off:off + 64 * a['count']]), '<f4').reshape(-1, 4, 4).transpose(0, 2, 1).astype(float)
binds = [old_world[j] @ ibm[k] for k, j in enumerate(joints)]
bind = binds[0]
assert max(np.abs(b - bind).max() for b in binds) < 1e-4, 'joints disagree on the bind matrix'
new_ibm = np.array([np.linalg.inv(new_world[j]) @ bind for j in joints])
bin_[off:off + 64 * a['count']] = new_ibm.transpose(0, 2, 1).astype('<f4').tobytes()

# Skinned vertices: displaced in world space by the same field.
binv = np.linalg.inv(bind)
for mesh in g['meshes']:
    for prim in mesh['primitives']:
        a, off, _ = accessor(prim['attributes']['POSITION'])
        v = np.frombuffer(bytes(bin_[off:off + 12 * a['count']]), '<f4').reshape(-1, 3).astype(float)
        w = (bind[:3, :3] @ v.T).T + bind[:3, 3]
        w[:, 1] += lift(w[:, 1])
        v = (binv[:3, :3] @ w.T).T + binv[:3, 3]
        bin_[off:off + 12 * a['count']] = v.astype('<f4').tobytes()
        a['min'] = [float(x) for x in v.min(0)]; a['max'] = [float(x) for x in v.max(0)]

js = json.dumps(g, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
bin_ += b'\0' * (-len(bin_) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
open(OUT, 'wb').write(out)
top = max(np.asarray(a['max'])[1] for a in [g['accessors'][p['attributes']['POSITION']] for m in g['meshes'] for p in m['primitives']])
print('stretch_rig: ankle %.3f knee %.3f hip %.3f; shin +%.3f, thigh +%.3f; functional ankle %s, ball %s; top %.3f; wrote %s' % (Y_ANKLE, Y_KNEE, Y_HIP, KNEE, HIP - KNEE, ANKLE, BALL, top, OUT))
