# Puts the meshes of an edited player .blend on the skeleton of another glb (e.g. one made by stretch_rig.py), so
# rebind.py can rebind them to that skeleton. Every mesh parented to `Armature` keeps its world placement; the old
# armature is removed and the imported one takes its name.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background <edited>.blend \
#     --python scripts/blender/swap_armature.py -- <skeleton.glb> <out.blend>

import sys
import bpy

REF, OUT = sys.argv[sys.argv.index('--') + 1:][:2]

if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
old = bpy.data.objects['Armature']
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is old]
placed = {o.name: o.matrix_world.copy() for o in meshes}

before = set(bpy.data.objects.keys())
bpy.ops.import_scene.gltf(filepath=REF)
imported = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
arm = next(x for x in imported if x.type == 'ARMATURE')
for x in imported:
    if x is not arm:
        bpy.data.objects.remove(x, do_unlink=True)

for o in meshes:
    o.parent = arm
    o.matrix_world = placed[o.name]
    for m in o.modifiers:
        if m.type == 'ARMATURE':
            m.object = arm
bpy.data.objects.remove(old, do_unlink=True)
arm.name = 'Armature'
bpy.ops.wm.save_as_mainfile(filepath=OUT, copy=True)
print('swap_armature: %d meshes on %s -> %s' % (len(meshes), REF, OUT))
