"""Builds the furniture GLB (Blender 5.1, headless, one detail level per session).

    Blender -b --factory-startup --python pipeline/furniture/build.py -- [--detail high|lite]
        [--house model/house.json] [--derived generated/derived.json] [--style model/style.json]
        [--out public/models/furniture.glb] [--footprints public/models/furniture-footprints.json]
        [--report pipeline/out/furniture-report.json] [--preview DIR] [--no-decor] [--no-export] [--blend FILE]

Default paths are relative to the repository root. The detail level `lite` is for phones (fewer segments, no
rounded edges on small parts, fewer small props); `high` is the desktop file.
"""
import json
import os
import sys
import time

sys.dont_write_bytecode = True      # no __pycache__ in the repository

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

from fx import inputs, compose, report  # noqa: E402

BUDGET = {'high': {'triangles': 200000, 'bytes': 1400000}, 'lite': {'triangles': 80000, 'bytes': 600000}}


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


def log(*a):
    print('[furniture]', *a, flush=True)


def main():
    A = argv()
    detail = {'full': 'high', 'desktop': 'high'}.get(A.get('detail', 'high'), A.get('detail', 'high'))
    if detail not in BUDGET:
        raise SystemExit('detail must be high or lite')
    hi = detail == 'high'
    house = A.get('house') or os.path.join(ROOT, 'model', 'house.json')
    derived = A.get('derived') or os.path.join(ROOT, 'generated', 'derived.json')
    for p in (house, derived):
        if not os.path.exists(p):
            raise SystemExit('missing input %s (use --house / --derived)' % p)
    name = 'furniture.glb' if hi else 'furniture-lite.glb'
    out = A.get('out') or os.path.join(ROOT, 'public', 'models', name)
    fp_path = A.get('footprints') or (os.path.join(ROOT, 'public', 'models', 'furniture-footprints.json') if hi and not A.get('no-export') else None)
    rep_path = A.get('report') or os.path.join(ROOT, 'pipeline', 'out', 'furniture-report%s.json' % ('' if hi else '-lite'))
    t0 = time.time()
    model = inputs.load(house, derived, HERE)
    log('rooms', len(model.rooms), 'furniture entries', len(model.furniture), 'detail', detail)
    scene = compose.compose(model, hi=hi, decor=not A.get('no-decor'))
    boxes, trimmed, dropped = compose.trim_footprints(scene)
    log('triangles', scene.triangles(), 'items', len(scene.items), 'issues', len(scene.layout.issues), 'coplanar pieces', len(scene.qa))
    for i in scene.layout.issues:
        if i['level'] != 'info':
            log(i['level'].upper(), i['code'], i['message'])
    extra = {'budget': BUDGET[detail]}
    node_info = {}
    need_blender = not A.get('no-export') or A.get('preview') or A.get('blend')
    if need_blender:
        import bpy  # noqa: F401
        from fx import bl, export
        bl.reset()
        tex_px = 512 if hi else 256
        root, node_info, dropped_tris = export.make_objects(scene, tex_px)
        export.finish_materials()
        log('objects', len(node_info), 'collapsed triangles dropped', dropped_tris)
        if A.get('preview'):
            import preview
            preview.render_all(scene, A['preview'], tex_px)
        if A.get('blend'):
            bpy.ops.wm.save_as_mainfile(filepath=A['blend'])
        if not A.get('no-export'):
            os.makedirs(os.path.dirname(out), exist_ok=True)
            bpy.context.scene['inputHash'] = model.input_hash()      # scene extras: staleness check against the footprints
            bpy.context.scene['detail'] = detail
            size = export.export_glb(out)
            extra['file'] = os.path.relpath(out, ROOT) if out.startswith(ROOT) else os.path.basename(out)
            extra['bytes'] = size
            log('exported', out, '%d bytes' % size, '(budget %d)' % BUDGET[detail]['bytes'])
            if size > BUDGET[detail]['bytes']:
                log('WARNING: over the size budget')
    tri = scene.triangles()
    if tri > BUDGET[detail]['triangles']:
        log('WARNING: %d triangles over the budget %d' % (tri, BUDGET[detail]['triangles']))
    if fp_path:
        os.makedirs(os.path.dirname(fp_path), exist_ok=True)
        with open(fp_path, 'w', encoding='utf-8') as f:
            json.dump(report.footprints(scene, boxes, trimmed, dropped), f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
        log('footprints', fp_path, len(boxes), 'boxes')
    os.makedirs(os.path.dirname(rep_path), exist_ok=True)
    extra['seconds'] = round(time.time() - t0, 1)
    report.write(rep_path, report.make(scene, node_info, detail, extra))
    log('report', rep_path, '%.1f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
