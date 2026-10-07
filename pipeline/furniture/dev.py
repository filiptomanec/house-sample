"""Look-development renders of single pieces (not part of the build).

    Blender -b --factory-startup --python pipeline/furniture/dev.py -- --items bed160,sofaL --out out.png
        [--detail high|lite] [--cam az,el,dist] [--outdoor] [--room bedroom] [--samples 32] [--res 1400x900]
        [--seed N] [--tz height] [--lens mm] [--rot degrees]

Items: a catalog type, optionally `type:variant` or `type@WxD`, or `decor:<name>` (see fx/decor_items.py). They are placed
in a row with 0.5 m gaps (rot 0: back at +y).
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np                       # noqa: E402
import bpy                               # noqa: E402
from fx import bl, assemble, mesh as M, qa   # noqa: E402
from fx import palette as PAL            # noqa: E402
import pieces                            # noqa: E402


def argv():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {}
    i = 0
    while i < len(a):
        if a[i].startswith('--'):
            if i + 1 < len(a) and not a[i + 1].startswith('--'):
                o[a[i][2:]] = a[i + 1]
                i += 2
            else:
                o[a[i][2:]] = True
                i += 1
        else:
            i += 1
    return o


def main():
    A = argv()
    cat = json.load(open(os.path.join(HERE, 'catalog.json')))['types']
    hi = A.get('detail', 'high') != 'lite'
    outdoor = bool(A.get('outdoor'))
    items = A.get('items', 'bed160').split(',')
    bl.reset()
    bl.setup_render(res=tuple(int(v) for v in A.get('res', '1400x900').split('x')), samples=int(A.get('samples', 32)))
    bl.setup_world(1.0)
    bl.add_sun(210, 48, 2.5)
    entries, x, tri = [], 0.0, 0
    row = []
    for it in items:
        size = None
        if '@' in it:
            it, sz = it.split('@')
            size = tuple(float(v) for v in sz.split('x'))
        variant = None
        if it.startswith('decor:'):
            from fx import decor_items
            meta = decor_items.ITEMS[it[6:]]
            from fx.piece import Piece
            pc = Piece(it, hi=hi, outdoor=outdoor, seed=int(A.get('seed', 11)))
            meta['fn'](pc, ceiling=2.75)
            w = d = max(0.3, 2 * meta['r']) if 'size' not in meta else meta['size'][0]
            if 'size' in meta:
                d = meta['size'][1]
            pc.anchors = {}
            it = it[6:]
        else:
            if ':' in it:
                it, variant = it.split(':')
            c = cat[it]
            w, d = size or (c['w'], c['d'])
            pc = pieces.build(c['builder'], w, d, variant, hi=hi, outdoor=outdoor, seed=11,
                              ctx={'roomType': A.get('room', 'living')})
        tri += pc.tris()
        cp = qa.coplanar(pc.soup)
        if cp:
            summ = {}
            for c in cp:
                k = '%s|%s %s@%s' % (c['mats'][0], c['mats'][1], c['axis'], c['coord'])
                summ[k] = summ.get(k, 0) + 1
            print('[dev] COPLANAR', it, variant, len(cp), list(summ.items())[:8])
        M0 = assemble.place_matrix(x + w / 2, 0.0, float(A.get('rot', 0)))
        s = M.Soup()
        s.extend(pc.soup, M0)
        entries.append(('dev', s))
        row.append((it, w, d, pc.tris()))
        x += w + 0.5
    total = x - 0.5
    for (zone, mat), (pos, nrm, uv) in assemble.bucket(entries).items():
        bl.mesh_object('%s_%s' % (zone, mat), pos, nrm, mat, uv, tex_px=512)
    # floor
    fl = M.gen_box(total / 2 + 1.5, 2.5, 0.01)
    V, F, N = fl
    bl.mesh_object('floor', V[F] + np.array([total / 2, 0, -0.01]), N[F], 'f_greige')
    az, el, dist = (float(v) for v in A.get('cam', '-25,28,%s' % max(4.0, total * 1.1 + 2)).split(','))
    tgt = (total / 2, 0.0, float(A.get('tz', 0.45)))
    a, e = math.radians(az), math.radians(el)
    eye = (tgt[0] + dist * math.sin(a) * math.cos(e), tgt[1] - dist * math.cos(a) * math.cos(e), tgt[2] + dist * math.sin(e))
    bl.add_camera(eye, tgt, lens=float(A.get('lens', 38)))
    bl.render(A.get('out', os.path.join(HERE, '..', 'out', 'dev.png')))
    print('[dev]', row, 'triangles', tri)


main()
