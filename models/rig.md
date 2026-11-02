# Player rig: bew-v6

`models/bew-v6.glb`: one skinned body mesh (flat shaded, painted 2048² texture) with morph targets `lean` and `heavy`
(relative to Basis; no morph normals), a rigid helmet mesh (100 % Head, 1024² texture), the Mixamo skeleton at 6'2"
(Hips 1.039 m, knee 0.553, ankle 0.106 ("Ankle" below), shoulder 1.512; mesh top 1.894) plus thumb and mitten bones per hand.

## Build

`npm run build-model` (scripts/build-v6.sh) runs Blender headless:
1. `stretch_rig.py -- reference/bew-elbowfix.glb build/tall-ref.glb 0.182 0.089 0.106 0.126`: the 6'2" reference skeleton
   with the functional ankle and the ball hinge ("Ankle" below).
2. `prep_art.py`: helper objects out, textures relinked to art/textures, shape keys at rest.
3. `swap_armature.py`: the art meshes onto that skeleton.
4. `rebind.py`: mirror applied with every shape key (each key evaluated with the mirror, re-added), weights from the
   reference surface at Basis, painted textures kept, morphs exported.
5. `hand_bones.py`: thumb/mitten bones, wrist ring (interpolates every key) and wrist weights.
6. `pad_weights.py`: shoulder pads ride the shoulders: above the shoulder joint and within the pad overhang a vertex
   keeps at most 60 % arm weight, the rest goes to the shoulder (clavicle) bone, so a raised arm turns partly under the
   pad (less pinches the pad top into a peak once the arms drop from the T-pose rest). It fades out toward the front
   (the front of the pad stays with the arm, or it folds into dark wedges on the chest when the arms come in).
   The torso wall under the armpit (inside the shoulder joint, behind its front) keeps at most 10 % arm weight, the
   rest to the spine, so the arm coming forward stretches the armpit instead of caving in the side of the back.
   The upper-arm clearance is measured on the outer half of the upper arm, as the solver samples it, so pad corners
   riding the arm do not widen it.
7. `shoe_weights.py`: the shoe is rigid on the foot. Every vertex of a shoe-coloured face (030303), and the sock's
   copy of each collar vertex, moves its shin (Leg) weight onto the Foot bone, so a bent ankle no longer lifts the
   heel counter off the foot (it did by about 2.5 cm in `ready`); the sock above the collar takes the bend. Above the
   collar the leg follows the shin: Foot weight (ToeBase weight counts as Foot) fades to zero 10 cm above the collar top,
   so a bent ankle bends the sock instead of swinging the calf, and toe flex moves only the shoe.
Then `npm run fit-shapes` regenerates `src/body/shapeFits.ts` and `npm test` checks the model.

Art source: `art/player-v6.blend` (the user's `wip_player_8_shapes`, from creator `fb5aa63`, 2026-10-28): `geometry_0` with
shape keys Basis, heavy, lean (both relative to Basis), Mirror + Armature modifiers; the helmet `geometry_0.001`.
Edit shapes as shape keys only; a key must keep the centre vertices on x = 0 (the mirror merge must not change).

## Ankle

The Foot joint is the functional ankle hinge: 0.106 m above the stud tips at 6'2", on the knee-to-ankle shin line,
inside the boot (sole-plate top 0.035 m, collar top 0.175-0.180 m; heel 0.09 m behind it, toe tip 0.21 m ahead). The
inherited Mixamo joint sat at 0.191 m, above the collar and outside the shoe, so the drawn foot and the simulated shoe
pitched about a point in the sock. Basis: the sole plate plus the US Army men (1988) mean lateral malleolus height,
6.71 cm (SD 0.55; DOD-HDBK-743A table 113a, milestones/m3/references/dod-743a-lateral-malleolus.pdf), scaled by the
barefoot stature (1.859 / 1.756 m): 0.035 + 0.071 = 0.106 m. The malleolus is a barefoot bony landmark that the
talocrural axis passes close to (about 1 cm), not the joint centre itself; it locates the hinge, the shoe adds the sole.
`stretch_rig.py` moves only the joint (bind matrices rewritten, mesh and ball/toe joints in place), so the rest art is
unchanged; generated bodies scale it with the foot (s × 0.106 m), like every other foot offset.

The ToeBase joint is the ball hinge, 0.126 m ahead of the ankle at 6'2" (0.285 of the anatomical foot length behind the
malleoli midpoint, scripts/blender/stretch_rig.py), at stud-tip height under the forefoot stud row. The shoe art was
shortened to anatomical length for M1 (commit bedb040, `art/player-v6.blend`; before/after in
milestones/m1/references): about the ankle, forward of it scaled by 0.72 and behind it by 0.85 below the collar, the sock
band 0.18-0.24 m tapered with it, so the toe tip is 0.21 m ahead (was 0.294) and the heel 0.09 m behind (was 0.107),
about 0.30 m overall, and the forefoot studs sit over the hinge. The heavy/lean keys keep their original shoe offsets.
Generated bodies scale the hinge with the foot (s × 0.126 m), left = right (tests/colliders.test.ts).

## Colour regions (for future colour customization)

Each region is one exact key colour per mesh, so the texture is its own region mask.

| Region | Mesh | Key colour |
|---|---|---|
| Jersey | body | 081573 |
| Pants | body | DCDCDC |
| Gloves | body | E6E6E6 |
| Socks | body | 081F73 |
| Shoes | body | 030303 |
| Skin | body | F29E5A |
| Helmet shell | helmet | 081F73 |
| Facemask | helmet | FFFFFF |

The empty atlas is 0A4586. Both materials are matte (roughness 1, metallic 0, specular 0). Wanted later: jersey and helmet
in any colour, skin from pale to dark brown (cosmetic; not built).

## Colliders

`npm run fit-shapes` also fits the colliders (src/body/measure.ts `SEGMENTS`): each limb capsule's radius is the
median distance of its bone's dominant vertices from the bone axis, on Basis, lean and heavy. The upper-arm radius
includes the shoulder pad. There is no neck capsule: no vertex is Neck-dominant (Neck to Head is 3 mm).

Helmet and shoe proxies cover their mesh (every vertex within 1 cm, checked at rest and in `ready` for the extreme
builds by tests/articulation.test.ts; the creator's rig lab shows the live values). Regions come from the texture key
colours, not bone weights: the helmet shell (081f73) is a minimum-volume capsule in the Head frame, the facemask
(ffffff, the vertices more than 5 mm outside that shell) an oriented box. Each shoe (030303 on `body_paint`; the sock
above the collar also leans on the Foot bone, so bone dominance alone is not the shoe) is three boxes: heel and
forefoot on the Foot bone, split at the ankle plane and extended to meet, and the toe on the ToeBase bone, so ankle
pitch and toe flex move them with the drawn shoe. With the shortened shoe the forefoot stud row lies on the ball hinge,
so the toe box carries it (with the toe row) and the forefoot box between the ankle and ball planes is the arch: its
raised shank stays off the turf but below the sole-plate top (< 0.035 m × s). The heel and toe boxes carry the sole
within 5 mm of the turf. The physics contact points are the sole samples (`body.colliders.sole`): heel and arch (the `forefoot` part) on the
Foot bone, the forefoot stud row and toe on the ToeBase bone (they turn with the toe hinge).
The shoe vertex indices are written to `V6_SHOE_VERTICES` for the proxy probe (src/rig/proxyProbe.ts).

## Belly corrective (flexL, flexR)

The heavy belly hangs over the hip crease, and the lower belly and side of the hip follow the thigh part of the way,
so a bent hip folds them through the thigh top (about 30 crossing triangle pairs in `ready` at 5'9" 400 lb). Two
runtime morphs push them out: `scripts/fit-flex.ts` (run by `npm run fit-shapes`) bends both thighs of the heavy base
rig to the deepest hip bend the presets reach plus 8 degrees, pushes the torso vertices of every crossing pair out
along the thigh triangle's normal until none cross, and writes rest-space deltas to `src/body/flexFit.ts`, split
left/right by x. `makePlayer` adds them to each player; after every pose each side's weight is heavy x the hip bend
(`src/body/hipFlex.ts`) past the onset angle, 1 at the fit angle. `tests/flex.test.ts` checks the body grid in every
preset has no crossings with it. Refit after any model rebuild (the fit is tied to the vertex count).

## Belly bone

Skinning is rigid, so a forward-leaning torso tipped the heavy belly back into the lap. `src/rig/belly.ts` adds a
`Belly` bone at runtime (after the retarget): at the Spine joint, parented to Spine, taking up to 85 % of each front
torso vertex below it by how far the heavy key moves that vertex, times the build's heavy share (lean and base builds
keep their weights). After each pose it turns back against 60 % of the chest's forward lean (times heavy), so the belly
hangs forward and down. The belly corrective is fitted with the bone in place (fit-flex uses heavy 1).
