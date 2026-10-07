"""Preview renders of the furnished house (Blender): plan view from above and perspective views into the rooms.

Context geometry (floors, simple walls with openings) is built from the derived geometry; only for self-checking and
documentation images, not exported. Called from build.py (--preview DIR).
"""
import math
import os
import numpy as np
import bpy

from fx import bl, mesh as M, geom2d as G

PV = {  # preview-only materials: name -> (hex, roughness)
    'pv_wall': ('#EFEDE8', 0.9), 'pv_oak': ('#D6C3A2', 0.6), 'pv_tile': ('#D8D5CE', 0.5), 'pv_concrete': ('#B9B7B2', 0.8),
    'pv_stone': ('#CFCAC0', 0.6), 'pv_lawn': ('#9DAF8B', 0.95), 'pv_paving': ('#C9C7C1', 0.8), 'pv_ceiling': ('#F4F2EE', 0.9),
}


def pv_material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexc, rough = PV[name]
    from fx.palette import srgb_to_linear
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*srgb_to_linear(hexc), 1)
    bs.inputs['Roughness'].default_value = rough
    return m


def box_obj(name, x0, y0, z0, x1, y1, z1, mat):
    V, F, N = M.gen_box((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
    pos = V[F] + np.array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    o, _ = bl.mesh_object(name, pos, N[F], 'f_white')
    o.data.materials.clear()
    o.data.materials.append(pv_material(mat))
    return o


def floors(model):
    floor_mat = {'oak': 'pv_oak', 'tile': 'pv_tile', 'concrete': 'pv_concrete', 'stone': 'pv_stone'}
    for r in model.rooms:
        for i, q in enumerate(r['region'].rects):
            box_obj('floor_%s_%d' % (r['id'], i), q[0], q[1], -0.02, q[2], q[3], 0.0, floor_mat.get(r['floor'], 'pv_tile'))
    for o in model.outdoor:
        q = o['rect']
        box_obj('out_' + o['id'], q[0], q[1], -0.03, q[2], q[3], -0.005, 'pv_paving')
    bb = model.derived.get('outline', {}).get('bbox') or {'x0': 0, 'y0': 0, 'x1': 24, 'y1': 12}
    box_obj('lawn', bb['x0'] - 14, bb['y0'] - 14, -0.1, bb['x1'] + 14, bb['y1'] + 14, -0.04, 'pv_lawn')


def walls(model, ceiling):
    ops = model.openings
    for k, w in enumerate(model.walls):
        t = w['t'] - 0.0012 * (k % 5)
        horiz = w['orient'] == 'h'
        a, b = w['from'] - t / 2, w['to'] + t / 2
        top = ceiling + 0.05 + 0.0006 * k
        mine = [o for o in ops if o['orient'] == w['orient'] and abs(o['axis'] - w['at']) < 0.02 and o['from'] >= w['from'] - 0.02 and o['to'] <= w['to'] + 0.02]
        mine.sort(key=lambda o: o['from'])
        segs, cur = [], a
        for o in mine:
            segs.append((cur, o['from'], 0.0, top))
            if o['sill'] > 0.01:
                segs.append((o['from'], o['to'], 0.0, o['sill']))
            segs.append((o['from'], o['to'], o['head'], top))
            cur = o['to']
        segs.append((cur, b, 0.0, top))
        for i, (s0, s1, z0, z1) in enumerate(segs):
            if s1 - s0 < 1e-3 or z1 - z0 < 1e-3:
                continue
            nm = 'wall_%s_%d' % (w['id'], i)
            if horiz:
                box_obj(nm, s0, w['at'] - t / 2, z0, s1, w['at'] + t / 2, z1, 'pv_wall')
            else:
                box_obj(nm, w['at'] - t / 2, s0, z0, w['at'] + t / 2, s1, z1, 'pv_wall')


def setup(res, samples):
    bl.setup_render(res=res, samples=samples, exposure=-0.35)
    bl.setup_world(0.8)
    bl.add_sun(205, 62, 2.2, size_deg=6)


def render_plan(model, path, res=(2400, 1500), samples=40):
    bb = model.derived['outline']['bbox'] if model.derived.get('outline') else None
    x0, y0, x1, y1 = (bb['x0'], bb['y0'], bb['x1'], bb['y1']) if bb else (0, 0, 24, 12)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for o in list(bpy.data.objects):
        if o.type == 'CAMERA':
            bpy.data.objects.remove(o)
    bl.setup_render(res=res, samples=samples, exposure=-0.35)
    # visible region incl. terrace: furniture bbox
    xs = [p['x'] for p in model.furniture_xy] if hasattr(model, 'furniture_xy') else [x0, x1]
    w = (x1 - x0) + 4
    h = w * res[1] / res[0]
    bl.add_camera((cx, cy, 60), (cx, cy, 0), lens=50, ortho=max(w, (y1 - y0 + 4) * res[0] / res[1]))
    bl.render(path)


def room_cameras(model, r):
    """Candidate camera positions in a room: the free bbox corners, looking at the room centre."""
    reg = r['region']
    x0, y0, x1, y1 = reg.bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cands = []
    for (x, y) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        px, py = x + (0.12 if x == x0 else -0.12), y + (0.12 if y == y0 else -0.12)
        if reg.contains(px, py):
            cands.append((px, py))
    return cands, (cx, cy)


def render_terrace(scene, outdir, res, samples):
    model = scene.model
    ter = [o for o in model.outdoor if o['type'] == 'terrace']
    if not ter:
        return
    x0, y0, x1, y1 = ter[0]['rect']
    views = [((x1 + 0.4, y0 - 2.4, 1.6), ((x0 + x1) / 2, (y0 + y1) / 2, 0.6), 17), ((x1 + 0.3, y1 - 0.2, 1.6), ((x0 + x1) / 2 - 1.0, (y0 + y1) / 2 - 0.6, 0.6), 17)]
    for k, (eye, tgt, lens) in enumerate(views):
        for o in list(bpy.data.objects):
            if o.type == 'CAMERA':
                bpy.data.objects.remove(o)
        bl.add_camera(eye, tgt, lens=lens, clip=(0.03, 100))
        bl.render(os.path.join(outdir, 'room-terrace-%d.png' % (k + 1)))


def render_rooms(scene, outdir, only=None, res=(1500, 1000), samples=28, per_room=2):
    model = scene.model
    for r in model.rooms:
        if only and r['id'] not in only:
            continue
        cands, (cx, cy) = room_cameras(model, r)
        taken = [G.grow(p['rect'], 0.55) for p in scene.layout.pieces if p['zone'] == r['id']]
        near_decor = [(d['at'][0], d['at'][1]) for d in scene.decor_report['placed'] if d['at'] and d['zone'] == r['id']]
        cands = [c for c in cands if not any(G.contains(t, c[0], c[1]) for t in taken)
                 and not any(math.hypot(c[0] - dx, c[1] - dy) < 1.1 for dx, dy in near_decor)] or cands
        if not cands:
            continue
        cands.sort(key=lambda p: -math.hypot(p[0] - cx, p[1] - cy))
        for k, (px, py) in enumerate(cands[:per_room]):
            for o in list(bpy.data.objects):
                if o.type == 'CAMERA':
                    bpy.data.objects.remove(o)
            d = math.hypot(cx - px, cy - py)
            bl.add_camera((px, py, 1.55), (cx, cy, 0.8), lens=17 if d < 5 else 22, clip=(0.03, 100))
            bl.render(os.path.join(outdir, 'room-%s-%d.png' % (r['id'], k + 1)))


def render_all(scene, outdir, tex_px):
    model = scene.model
    os.makedirs(outdir, exist_ok=True)
    floors(model)
    walls(model, model.ceiling)
    setup((1500, 1000), 22)
    only = os.environ.get('FURNITURE_PREVIEW_ROOMS')
    only = set(only.split(',')) if only else None
    if not only or 'plan' in only:
        render_plan(model, os.path.join(outdir, 'plan.png'))
        only = only - {'plan'} if only else only
    if only is None or only:
        render_rooms(scene, outdir, only, per_room=int(os.environ.get('FURNITURE_PREVIEW_VIEWS', '2')))
        if only is None or 'terrace' in only:
            render_terrace(scene, outdir, (1500, 1000), 28)
