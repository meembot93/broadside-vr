# Making a high-detail pirate (no outside tools)

The crew and enemy pirates in `models/pirates/` are built entirely from code: sculpted as a
signed distance field in Python, turned into a dense mesh, then simplified, textured and
rigged in Blender (run headless as the `bpy` Python module). The sources are in
`tools/characters/`.

## One-time setup (cloud container or any Linux/Mac with Python 3.13)

    pip install bpy scikit-image scipy numpy

(`bpy` is Blender 5.x as a Python module: no Blender app or display is needed.)

## Make or change a character

1. Each character is a small file in `tools/characters/` with a `LOOK` dict, e.g. `hawkins.py`:
   height, bulk, belly, skin, eyes, hair (+ style: short, long, ponytail, braid, bald),
   beard (full, big, goatee, stubble) and its colour, hat ('tricorn') or bandana colour,
   coat / vest / shirt / sleeves ('long', 'rolled'), sash, belt, pants, boots, nose size,
   patch, female. `HEAD_KEEP` (0..1, lower = more triangles kept on the head).
2. Quick look (6 mm voxels, a few seconds): see `preview()` in `make.py`, or run
   `python3 make.py NAME 0.006` and open the GLB.
3. Full build (3 mm voxels, ~2 minutes):

       cd tools/characters && python3 make.py NAME

   It writes `out/NAME.glb`: ~14k triangles, 2048 colour + 1024 normal JPEG textures, ~1.1 MB,
   19-bone skeleton with the same bone names as the Tripo lady (hips, spine, chest, neck, head,
   shoulder/upperarm/forearm/hand .L/.R, thigh/shin/foot .L/.R).
4. Copy it to `models/pirates/`, add it to `MODELS` in `js/rigged.js` (with `armDrop: 0.56`),
   and point a pirate type at it (`MODEL_FOR` in `js/people.js`) or a crew member at it
   (`model:` in `js/crew.js`).
5. Check it: `tools/rigs.html?types=m:NAME` (add `&pose=walk|steer|aim|haul|attack|cheer|sit|dead`,
   `&view=front|side|back|close`).

## How the pipeline works

* `sdf.py`: primitives (ellipsoid, round cone, rounded box, any function) blended with smooth
  union / subtraction, each with a colour (constant or a function of position, e.g. fabric
  noise, an eye with iris and pupil) and optional surface displacement (folds, hair strands).
  `paint` primitives change colour only. Sampled on a 3 mm grid, marching cubes gives a
  ~1M-triangle mesh; vertex colours come from evaluating the field at each vertex.
* `pirate.py`: the parametric pirate. Arms are modelled in an A-pose (38 degrees out) so the
  skin weights separate cleanly; the game lowers them (`armDrop`).
* `build.py` (Blender):
  - decimate to the triangle budget, keeping more on the head (vertex-group weighted);
  - Smart UV project with the head blown up 1.75x first, so the face gets ~3x the texture detail;
  - bake (Cycles, CPU): colour (emission from the dense mesh's vertex colours), tangent-space
    normals (dense -> low), and soft ambient occlusion (dense mesh hidden) multiplied in;
  - armature from the joint positions; skin weights computed in Python (inverse distance to
    each bone segment, limbs only on their own side, head above the neck, coat skirts follow
    the hips). Blender's automatic weights fail on these meshes.
  - export GLB (JPEG textures, no animation clips).
* In the game (`js/rigged.js`): models without clips are animated procedurally (walk cycle,
  breathing, looking about) and every work pose / sword swing / cheer / fall is a bone turn on
  top. Shader colour variations recolour red cloth (`red`) and blonde hair (`hair`).

## Pitfalls

* Do not flip the marching-cubes winding: inward normals make the bake rays go through the body
  and paint the back onto the front.
* Hide the dense mesh before the AO bake, or it shadows everything (blotchy "giraffe" spots).
* Don't name a script `inspect.py` (it shadows the standard library and crashes bpy).
* Budgets for the Quest: 12-15k triangles per pirate, one material, 2048 colour texture.
