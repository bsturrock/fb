# Prepares the player art file for the build: removes helper objects (anything that is not the armature or a mesh
# parented to it, e.g. the Icosphere, camera and light), relinks the painted textures to art/textures/, and sets every
# shape key to its rest state (pin off, Basis active, values 0), so later steps see the Basis shape. The art file
# itself is not changed; the result is written to <out.blend>.
#
#   Blender --background art/player-v6.blend --python-exit-code 1 --python scripts/blender/prep_art.py -- <out.blend>

import os
import sys
import bpy

OUT = sys.argv[sys.argv.index('--') + 1:][0]
arm = bpy.data.objects['Armature']
for x in list(bpy.data.objects):
    if x is not arm and not (x.type == 'MESH' and x.parent is arm):
        print('prep_art: removed', x.name)
        bpy.data.objects.remove(x, do_unlink=True)
tex_dir = os.path.join(os.path.dirname(bpy.data.filepath), 'textures')
for img in bpy.data.images:
    if img.filepath:
        img.filepath = os.path.join(tex_dir, os.path.basename(img.filepath))
        img.reload()
        assert img.size[0] > 0, 'prep_art: missing texture ' + img.filepath
        print('prep_art: %s -> %s (%dx%d)' % (img.name, img.filepath, img.size[0], img.size[1]))
for x in bpy.data.objects:
    keys = x.data.shape_keys if x.type == 'MESH' else None
    if keys:
        x.show_only_shape_key = False
        x.active_shape_key_index = 0
        for kb in keys.key_blocks:
            kb.value = 0.0
        print('prep_art: %s shape keys %s' % (x.name, [kb.name for kb in keys.key_blocks]))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT))
