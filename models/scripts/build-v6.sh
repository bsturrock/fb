#!/bin/sh
# Builds bew-v6.glb from art/player-v6.blend, headless (rig.md "Build"). All paths are relative to the models
# folder (this script's parent), so it runs from any directory. The art file is not changed; intermediates go to
# build/ (not committed).
#   1. stretch_rig: the 6'2" reference (legs +0.182 m at the hip, +0.089 m at the knee, functional ankle 0.106 m, ball hinge 0.126 m ahead of it) from
#      the elbow-fix rig
#   2. prep_art: helper objects out, textures relinked, shape keys at rest
#   3. swap_armature: the art meshes onto that skeleton
#   4. rebind: mirror applied (shape keys kept), weights from the reference, painted textures kept
#   5. hand_bones: thumb and mitten bones, wrist ring and weights
#   6. pad_weights: shoulder pads ride the shoulders
#   7. shoe_weights: the shoe is rigid on the foot (sim-5 M1)
set -e
cd "$(dirname "$0")/.."
B=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build
"$B" --background --factory-startup --python-exit-code 1 --python scripts/blender/stretch_rig.py -- reference/bew-elbowfix.glb build/tall-ref.glb 0.182 0.089 0.106 0.126
"$B" --background art/player-v6.blend --python-exit-code 1 --python scripts/blender/prep_art.py -- build/v6-prep.blend
"$B" --background build/v6-prep.blend --python-exit-code 1 --python scripts/blender/swap_armature.py -- build/tall-ref.glb build/v6-swapped.blend
"$B" --background build/v6-swapped.blend --python-exit-code 1 --python scripts/blender/rebind.py -- build/tall-ref.glb build/v6-rebound.glb
"$B" --background --factory-startup --python-exit-code 1 --python scripts/blender/hand_bones.py -- build/v6-rebound.glb build/v6-hands.glb
"$B" --background --factory-startup --python-exit-code 1 --python scripts/blender/pad_weights.py -- build/v6-hands.glb build/v6-pads.glb
"$B" --background --factory-startup --python-exit-code 1 --python scripts/blender/shoe_weights.py -- build/v6-pads.glb bew-v6.glb
echo "build-v6: wrote $(pwd)/bew-v6.glb"
