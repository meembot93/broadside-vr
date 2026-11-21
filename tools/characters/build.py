"""Turn a sculpted character (dense coloured mesh) into a Quest-ready rigged GLB with Blender.

    build(name, verts, faces, colors, joints, out_glb, tris=12000)

verts/faces/colors: dense mesh from sdf.Sculpt.mesh() (y up, facing +Z, metres, sRGB colours)
joints: {bone: (head_xyz, tail_xyz, parent)} in the same coordinates
Steps: dense mesh -> decimated low mesh -> smart UVs -> bake colour (x soft AO) and normals
from the dense mesh -> armature with automatic weights -> GLB (JPEG textures).
"""
import os, time
import numpy as np
import bpy, bmesh

def _bl(p):  # y-up, +Z forward  ->  Blender z-up, -Y forward
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)

def _srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def _mesh_obj(name, v, f):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v)); me.vertices.foreach_set('co', v.astype(np.float32).ravel())
    me.loops.add(f.size); me.loops.foreach_set('vertex_index', f.astype(np.int32).ravel())
    me.polygons.add(len(f)); me.polygons.foreach_set('loop_start', np.arange(0, f.size, 3, dtype=np.int32)); me.polygons.foreach_set('loop_total', np.full(len(f), 3, dtype=np.int32))
    me.update(); me.validate()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob

def _select(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[-1]

def _segdist(P, a, b):
    a, b = np.asarray(a), np.asarray(b); ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)

def skin_weights(P, joints, power=6, keep=3):
    names = list(joints.keys())
    D = np.stack([_segdist(P, h, t) for (h, t, _) in joints.values()], 1)
    # limbs only take vertices on their own side of the body
    for j, n in enumerate(names):
        if n.endswith('.L'): D[P[:, 0] < -0.02, j] = 9
        if n.endswith('.R'): D[P[:, 0] > 0.02, j] = 9
    # everything above the neck bone's top belongs to the head
    hh = np.array(joints['head'][0]); D[P[:, 1] > hh[1] + 0.03, :] = 9; D[P[:, 1] > hh[1] + 0.03, names.index('head')] = 0.001
    # a coat skirt (well outside the legs) mostly follows the hips
    if 'thigh.L' in joints:
        kneeY = joints['thigh.L'][1][1]; hipY = joints['thigh.L'][0][1]
        legx = abs(joints['thigh.L'][0][0])
        rleg = np.minimum(np.hypot(P[:, 0] - legx, P[:, 2]), np.hypot(P[:, 0] + legx, P[:, 2]))
        sk = (P[:, 1] < hipY) & (P[:, 1] > kneeY - 0.15) & (rleg > 0.1)
        D[sk, names.index('hips')] *= 0.5
    W = 1.0 / np.maximum(D, 1e-3) ** power
    # keep the strongest few
    idx = np.argsort(-W, axis=1)[:, keep:]
    np.put_along_axis(W, idx, 0, axis=1)
    return W / W.sum(1, keepdims=True)

def build(name, verts, faces, colors, joints, out_glb, tris=12000, tex=2048, ntex=1024, log=print, head_from=None, head_scale=1.75, head_keep=1.0, vg_factor=1.0):
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    v = _bl(verts); f = faces  # (the axis swap is a rotation: winding and outward normals are kept)
    hi = _mesh_obj(name + '_hi', v, f)
    col = _srgb2lin(np.clip(colors, 0, 1))
    attr = hi.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([col, np.ones((len(col), 1))], axis=1).astype(np.float32).ravel())
    for p in hi.data.polygons: p.use_smooth = True
    log(f'dense mesh {len(f)} tris ({time.time() - t0:.0f}s)')

    # Low mesh
    lo = hi.copy(); lo.data = hi.data.copy(); lo.name = name; sc.collection.objects.link(lo)
    lo.data.color_attributes.remove(lo.data.color_attributes['Col'])
    # The head keeps more of its detail (weight = how much each vertex may be simplified)
    hzz = head_from if head_from is not None else v[:, 2].max() - 0.33
    vg = lo.vertex_groups.new(name='simplify')
    vz = v[:, 2]
    wts = np.where(vz > hzz, head_keep, 1.0)
    for wv in np.unique(wts):
        vg.add([int(i) for i in np.nonzero(wts == wv)[0]], float(wv), 'REPLACE')
    m = lo.modifiers.new('dec', 'DECIMATE'); m.ratio = tris / len(f); m.use_collapse_triangulate = True
    m.vertex_group = 'simplify'; m.vertex_group_factor = vg_factor
    _select(lo); bpy.ops.object.modifier_apply(modifier='dec')
    lo.vertex_groups.clear()
    co_ = np.zeros(len(lo.data.vertices) * 3, dtype=np.float32); lo.data.vertices.foreach_get('co', co_); co_ = co_.reshape(-1, 3)
    pv = np.zeros(len(lo.data.polygons) * 3, dtype=np.int32); lo.data.polygons.foreach_get('vertices', pv)
    log(f'head faces: {int((co_[pv.reshape(-1, 3)][:, :, 2].mean(1) > hzz).sum())} of {len(lo.data.polygons)}')
    log(f'low mesh {len(lo.data.polygons)} faces ({time.time() - t0:.0f}s)')
    # UVs. The face matters most up close, so the head gets ~3x the texture detail: blow it up
    # before unwrapping (islands are sized by their 3D area), then put it back.
    co = np.zeros(len(lo.data.vertices) * 3, dtype=np.float32); lo.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    hz = head_from if head_from is not None else co[:, 2].max() - 0.33
    big = co.copy(); m_h = big[:, 2] > hz
    c0 = np.array([0, 0, hz]); big[m_h] = c0 + (big[m_h] - c0) * head_scale
    lo.data.vertices.foreach_set('co', big.ravel()); lo.data.update()
    _select(lo); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    lo.data.vertices.foreach_set('co', co.ravel()); lo.data.update()

    # Images
    def img(n, size, data=False):
        im = bpy.data.images.new(n, size, size, alpha=False, float_buffer=False)
        if data: im.colorspace_settings.name = 'Non-Color'
        return im
    im_col, im_ao, im_nrm = img(name + '_col', tex), img(name + '_ao', ntex), img(name + '_nrm', ntex, True)

    # Dense mesh shows its vertex colours as emission (for the colour bake)
    mh = bpy.data.materials.new('hi'); mh.use_nodes = True; nt = mh.node_tree; nt.nodes.clear()
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'
    em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(ca.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    hi.data.materials.append(mh)
    # Low mesh: an image node per bake (the active one receives the bake)
    ml = bpy.data.materials.new(name); ml.use_nodes = True; lnt = ml.node_tree
    tnode = lnt.nodes.new('ShaderNodeTexImage')
    lo.data.materials.append(ml)

    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
    bk = sc.render.bake
    bk.use_selected_to_active = True; bk.cage_extrusion = 0.012; bk.max_ray_distance = 0.04; bk.margin = 6
    _select(hi, lo, active=lo)
    def bake(kind, image, samples=1):
        sc.cycles.samples = samples
        tnode.image = image; lnt.nodes.active = tnode
        bpy.ops.object.bake(type=kind)
        log(f'baked {kind} ({time.time() - t0:.0f}s)')
    bake('EMIT', im_col)
    bake('NORMAL', im_nrm)
    bk.use_selected_to_active = False
    _select(lo)
    hi.hide_render = True  # (otherwise the dense copy sitting in the same place shadows everything)
    if not sc.world: sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.12
    bake('AO', im_ao, samples=32)
    # Soft ambient occlusion multiplied into the colour (crevices, under the hat brim...)
    c = np.array(im_col.pixels[:], dtype=np.float32).reshape(tex, tex, 4)
    a = np.array(im_ao.pixels[:], dtype=np.float32).reshape(ntex, ntex, 4)[..., 0]
    if ntex != tex:
        a = np.kron(a, np.ones((tex // ntex, tex // ntex), dtype=np.float32))
    c[..., :3] *= (0.45 + 0.55 * a)[..., None]
    im_col.pixels.foreach_set(c.ravel())

    # Final material: base colour + normal map, matte
    lnt.nodes.clear()
    bsdf = lnt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.inputs['Roughness'].default_value = 0.85
    o2 = lnt.nodes.new('ShaderNodeOutputMaterial'); lnt.links.new(bsdf.outputs['BSDF'], o2.inputs['Surface'])
    tc = lnt.nodes.new('ShaderNodeTexImage'); tc.image = im_col; lnt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    tn = lnt.nodes.new('ShaderNodeTexImage'); tn.image = im_nrm
    nm = lnt.nodes.new('ShaderNodeNormalMap'); lnt.links.new(tn.outputs['Color'], nm.inputs['Color']); lnt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bpy.data.objects.remove(hi)

    # Armature
    arm = bpy.data.armatures.new('Rig'); rig = bpy.data.objects.new('Rig', arm); sc.collection.objects.link(rig)
    _select(rig); bpy.ops.object.mode_set(mode='EDIT')
    for bn, (h, t, par) in joints.items():
        b = arm.edit_bones.new(bn); b.head = _bl(h); b.tail = _bl(t)
    for bn, (h, t, par) in joints.items():
        if par: arm.edit_bones[bn].parent = arm.edit_bones[par]; arm.edit_bones[bn].use_connect = False
    for b in arm.edit_bones: b.roll = 0
    bpy.ops.object.mode_set(mode='OBJECT')
    for bn in ('hips',):
        arm.bones[bn].use_deform = True
    # Skin weights worked out here (Blender's automatic 'bone heat' fails on these meshes):
    # each vertex follows the nearest bones, weighted by inverse distance to the bone segment.
    co = np.zeros(len(lo.data.vertices) * 3, dtype=np.float32); lo.data.vertices.foreach_get('co', co)
    P = co.reshape(-1, 3); P = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)  # back to y-up
    W = skin_weights(P, joints)
    names = list(joints.keys())
    for j, bn in enumerate(names):
        vg = lo.vertex_groups.new(name=bn)
        for i in np.nonzero(W[:, j] > 0.01)[0]:
            vg.add([int(i)], float(W[i, j]), 'REPLACE')
    _select(lo, rig, active=rig)
    bpy.ops.object.parent_set(type='ARMATURE')
    empty = [vg.name for vg in lo.vertex_groups if not any(vg.index == g.group for vv in lo.data.vertices for g in vv.groups)] if False else []
    log(f'rigged ({time.time() - t0:.0f}s)')

    _select(lo, rig, active=rig)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_image_format='JPEG',
                              export_jpeg_quality=88, export_animations=False, export_yup=True, export_skins=True)
    log(f'exported {out_glb} {os.path.getsize(out_glb) / 1e6:.1f} MB ({time.time() - t0:.0f}s)')
