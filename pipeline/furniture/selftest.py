"""Self-test of the furniture pipeline on a tiny synthetic house (python3 + numpy, no Blender):

    python3 pipeline/furniture/selftest.py

Checks the geometry helpers, variant resolution, wall contact, validation, determinism and the stability of decor seeds
(adding a piece must not change the decor of the others).
"""
import copy
import math
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fx import geom2d as G, inputs, layout, compose, mesh as M, qa  # noqa: E402

FAILS = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


def tiny():
    house = {
        'schema': 'house/1', 'clearHeight': 2.75, 'wall': {'ext': 0.5, 'bearing': 0.3, 'part': 0.15}, 'outdoor': [
            {'id': 'O1', 'type': 'terrace', 'covered': False, 'rect': [0.0, -3.0, 4.0, -0.2]}],
        'furniture': [
            {'type': 'bed160', 'x': 1.0, 'y': 2.0, 'rot': 0},
            {'type': 'shelf', 'x': 0.3, 'y': 0.9, 'rot': 90, 'w': 0.45, 'd': 0.35},
            {'type': 'wardrobe', 'x': 3.1, 'y': 2.7, 'rot': 180, 'w': 1.5},     # front towards the north wall: turned
            {'type': 'shelf', 'x': 6.0, 'y': 2.7, 'rot': 0, 'w': 2.0},
            {'type': 'car', 'x': 6.0, 'y': 1.2, 'rot': 0},
            {'type': 'chair', 'x': 2.0, 'y': -1.2, 'rot': 0},
            {'type': 'sofa3', 'x': 3.0, 'y': 1.5, 'rot': 0},                      # blocks the door zone of D1 (x about 3.6)
        ],
    }
    derived = {
        'inputHash': 'test', 'walls': [{'id': 'W1', 'orient': 'v', 'at': 4.1, 'from': 0, 'to': 3, 't': 0.2}],
        'netRooms': [{'id': 'A', 'type': 'bedroom', 'floor': 'oak', 'rects': [[0.0, 0.0, 4.0, 3.0]]},
                     {'id': 'G', 'type': 'garage', 'floor': 'concrete', 'rects': [[4.2, 0.0, 8.0, 3.0]]}],
        'openings': [{'id': 'D1', 'kind': 'door', 'orient': 'v', 'cx': 4.1, 'cy': 1.5, 'w': 0.9, 'sill': 0, 'head': 2.1, 'swing': '-',
                      'hinge': '-', 'c': 1.5, 'axis': 4.1, 'from': 1.05, 'to': 1.95, 'wallId': 'W1', 'connects': ['A', 'G'], 'room': None},
                     {'id': 'S1', 'kind': 'slider', 'orient': 'h', 'cx': 2.0, 'cy': 0.0, 'w': 2.0, 'sill': 0, 'head': 2.4, 'c': 2.0, 'axis': 0.0,
                      'from': 1.0, 'to': 3.0, 'wallId': 'W0', 'room': 'A', 'exterior': True}],
    }
    import json
    cat = json.load(open(os.path.join(HERE, 'catalog.json')))
    rules = json.load(open(os.path.join(HERE, 'decor_rules.json')))
    return inputs.Model(house, derived, cat, rules)


def main():
    # geometry helpers
    L = [(0, 0), (4, 0), (4, 2), (2, 2), (2, 4), (0, 4)]
    rects = G.polygon_to_rects(L)
    reg = G.Region(rects)
    check(abs(reg.area() - 12.0) < 1e-9, 'L polygon decomposes into rectangles of area 12 m2')
    check(abs(reg.covered_area([1, 1, 3, 3]) - 3.0) < 1e-9, 'covered area of a box over the L notch is 3 m2')
    check(len(reg.corners()) >= 5, 'convex corners of the L found')
    z = G.door_zone_rects({'orient': 'v', 'axis': 4.1, 'from': 1.05, 'to': 1.95}, 0.2)[0]
    check(abs((z[2] - z[0]) - (0.2 + 1.1)) < 1e-9, 'door zone reaches 0.55 m on both sides of the wall')
    z = G.door_zone_rects({'orient': 'v', 'axis': 4.1, 'from': 1.05, 'to': 1.95}, 0.2, lining=0.05)[0]
    check(abs((z[3] - z[1]) - 0.8) < 1e-9, 'the door zone is the clear passage: the opening minus the lining on both sides')
    sw = G.swing_polygon({'orient': 'v', 'axis': 4.1, 'c': 1.5, 'w': 0.9, 'swing': '-', 'hinge': '-', 'kind': 'door'}, 0.2)
    check(sw is not None and max(p[0] for p in sw) <= 4.1 + 1e-6, 'door swing opens to the - side')

    # layout
    m = tiny()
    lay = layout.Layout(m)
    by = {}
    for p in lay.pieces:
        by.setdefault(p['type'], []).append(p)
    check(by['shelf'][0]['variant'] == 'bedside', 'a small shelf next to a bed in a bedroom is a bedside table')
    check(by['shelf'][1]['variant'] == 'rack', 'a shelf in a garage is a rack')
    check(by['chair'][0]['outdoor'] and by['chair'][0]['variant'] == 'outdoor', 'a chair on the terrace is an outdoor chair')
    check(by['wardrobe'][0]['rot'] == 0 and any(i['code'] == 'rot-corrected' for i in lay.issues), 'a wardrobe facing the wall is turned')
    check(any(i['code'] == 'door-zone' and i.get('opening') == 'D1' for i in lay.issues), 'the sofa in front of the door is reported')
    check(by['car'][0]['zone'] == 'G', 'the car belongs to the garage')

    # composition, determinism, decor seed stability
    s1 = compose.compose(m, hi=True, decor=True)
    s2 = compose.compose(tiny(), hi=True, decor=True)
    check(s1.triangles() == s2.triangles() and len(s1.items) == len(s2.items), 'two runs give identical triangle counts')
    check(len(s1.items) > len(m.furniture), 'decor was added')
    m3 = tiny()
    m3.furniture.append({'type': 'armchair', 'x': 1.0, 'y': -2.0, 'rot': 0, 'w': None, 'd': None, 'id': None, 'index': 99})
    s3 = compose.compose(m3, hi=True, decor=True)
    keep = lambda s: sorted((p['item'], p['parent'], tuple(p['at'])) for p in s.decor_report['placed'] if p['parent'] and 'bed' in str(p['parent']))
    check(keep(s1) == keep(s3), 'adding a piece keeps the piece-bound decor of the others')
    lite = compose.compose(tiny(), hi=False, decor=True)
    check(lite.triangles() < s1.triangles() * 0.8, 'lite has clearly fewer triangles than high (%d vs %d)' % (lite.triangles(), s1.triangles()))

    # materials: terrace uses t_*, rooms f_*
    bad = []
    for it in s1.items:
        for part in it.soup.parts:
            if (it.zone == 'terrace') != part['mat'].startswith('t_'):
                bad.append((it.type, part['mat']))
    check(not bad, 'terrace items use t_* and room items f_* materials %s' % bad[:3])

    # soup sanity
    sane = [qa.sanity(it.soup) for it in s1.items]
    check(all(q['nonfinite_parts'] == 0 for q in sane), 'no non-finite geometry')
    V, F, N = M.gen_rbox(0.5, 0.3, 0.2, 0.05, 1)
    check(len(F) == 108, 'rounded box has 108 triangles')

    print('\n%d failure(s)' % len(FAILS) if FAILS else '\nOK')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
