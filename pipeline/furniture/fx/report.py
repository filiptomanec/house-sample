"""furniture-report.json: what was placed, what could not be, budgets and warnings (stdlib only)."""
import json


def make(scene, node_info, detail, extra=None):
    m = scene.model
    items = scene.items
    furn = [i for i in items if i.kind == 'furniture']
    decor = [i for i in items if i.kind == 'decor']
    by_zone = {}
    for it in items:
        z = by_zone.setdefault(str(it.zone), {'furniture': 0, 'decor': 0, 'triangles': 0})
        z['furniture' if it.kind == 'furniture' else 'decor'] += 1
        z['triangles'] += it.soup.tris()
    by_type = {}
    for it in furn:
        by_type[it.type] = by_type.get(it.type, 0) + 1
    rep = {
        'schema': 'furniture-report/1',
        'inputHash': m.input_hash(),
        'modelHash': m.derived.get('inputHash'),
        'detail': detail,
        'counts': {'furniture': len(furn), 'decor': len(decor), 'byType': by_type},
        'triangles': {'total': sum(i.soup.tris() for i in items), 'furniture': sum(i.soup.tris() for i in furn),
                      'decor': sum(i.soup.tris() for i in decor)},
        'zones': by_zone,
        'issues': scene.layout.issues,
        'qa': scene.qa,
        'decor': scene.decor_report,
        'timing': scene.timing,
        'pieces': [{'id': p['id'], 'type': p['type'], 'variant': p['variant'], 'room': p['room'], 'zone': p['zone'],
                    'x': round(p['x'], 3), 'y': round(p['y'], 3), 'rot': p['rot'], 'w': round(p['w'], 3), 'd': round(p['d'], 3),
                    'wall': [k for k, v in p['wall'].items() if v]} for p in scene.layout.pieces],
        'nodes': node_info,
    }
    if extra:
        rep.update(extra)
    return rep


def write(path, rep):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, indent=1, ensure_ascii=False)
        f.write('\n')


def footprints(scene, boxes, trimmed, dropped):
    return {
        'schema': 'furniture-footprints/1',
        'inputHash': scene.model.input_hash(),
        'modelHash': scene.model.derived.get('inputHash'),
        'units': 'm',
        'frame': 'house frame: x east, y north; box = [x0, y0, x1, y1]; h = height of the highest part in the body zone',
        'note': 'Walk-mode colliders of floor-standing furniture and decor taller than 0.3 m; door clear zones are cut out.',
        'items': boxes,
        'trimmed': trimmed,
        'leftOut': dropped,
    }
