"""Reads the house model and the derived geometry (stdlib only) and normalises them for the furniture pipeline.

Sources: `model/house.json` (furniture[], outdoor[], clearHeight, ...) and `generated/derived.json` (net rooms, openings,
walls). The reader accepts the `concept/1` derived format (rooms[].cleanRects) as well as `netRooms` with polygons or
rectangles, so that the pipeline can run on a concept stub until the real files exist.
"""
import hashlib
import json
import os
import zlib

from . import geom2d as G

VERSION = 'furniture-pipeline/1'


def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _poly_rects(r):
    """Rectangles of one room from whichever geometry key it carries."""
    for key in ('cleanRects', 'rects'):
        if r.get(key):
            return [list(map(float, q)) for q in r[key]]
    for key in ('polygons', 'polys'):
        if r.get(key):
            out = []
            for p in r[key]:
                pts = p.get('pts', p) if isinstance(p, dict) else p
                out += G.polygon_to_rects([tuple(q) for q in pts])
            return out
    for key in ('polygon', 'poly', 'pts', 'points', 'outline'):
        if r.get(key):
            pts = r[key]
            pts = pts.get('pts', pts) if isinstance(pts, dict) else pts
            return G.polygon_to_rects([tuple(q) for q in pts])
    if r.get('bbox'):
        b = r['bbox']
        return [[b['x0'], b['y0'], b['x1'], b['y1']]] if isinstance(b, dict) else [list(b)]
    return []


def rooms_from(derived):
    src = derived.get('netRooms') or derived.get('rooms') or []
    rooms = []
    for r in src:
        rects = _poly_rects(r)
        if not rects:
            continue
        rooms.append({'id': r['id'], 'name': r.get('name', r['id']), 'type': r.get('type', 'room'),
                      'floor': r.get('floor'), 'region': G.Region(rects)})
    return rooms


def openings_from(derived, house):
    wall_t = {}
    for w in derived.get('walls', []):
        wall_t[w.get('id')] = w.get('t')
    spec_t = house.get('wall', {})
    default_t = {'exterior': spec_t.get('ext', 0.5), 'bearing': spec_t.get('bearing', 0.3), 'partition': spec_t.get('part', 0.15)}
    out = []
    for o in derived.get('openings', []):
        orient = o['orient']
        if 'axis' in o:
            axis, c = o['axis'], o.get('c', o['cx'] if orient == 'h' else o['cy'])
        else:
            axis, c = (o['cy'], o['cx']) if orient == 'h' else (o['cx'], o['cy'])
        a, b = o.get('from', c - o['w'] / 2), o.get('to', c + o['w'] / 2)
        t = wall_t.get(o.get('wallId')) or default_t.get(o.get('wallKind'), 0.3)
        out.append({'id': o['id'], 'kind': o['kind'], 'orient': orient, 'axis': axis, 'c': c, 'from': a, 'to': b, 'w': o['w'],
                    'sill': o.get('sill', 0), 'head': o.get('head', 2.1), 'swing': o.get('swing'), 'hinge': o.get('hinge'),
                    't': t, 'room': o.get('room'), 'connects': o.get('connects'), 'exterior': bool(o.get('exterior')),
                    'swingRoom': o.get('swingRoom'), 'azimuth': o.get('azimuth')})
    return out


def furniture_from(house, derived=None):
    """Furniture entries; sizes the model does not override are taken from derived.furniture (the kernel's catalog is the
    single source of defaults), with a note when catalog.json disagrees (see Layout)."""
    dfur = (derived or {}).get('furniture') or []
    out = []
    for k, f in enumerate(house.get('furniture', [])):
        d = dfur[k] if k < len(dfur) and dfur[k].get('type') == f['type'] else {}
        out.append({'type': f['type'], 'x': float(f['x']), 'y': float(f['y']), 'rot': float(f.get('rot', 0)),
                    'w': f.get('w') if f.get('w') is not None else d.get('w'),
                    'd': f.get('d') if f.get('d') is not None else d.get('d'),
                    'modelW': f.get('w'), 'modelD': f.get('d'), 'id': f.get('id'), 'index': k})
    return out


def piece_id(f):
    """Stable id of a furniture entry: the model id if present, else type and a hash of its placement."""
    if f.get('id'):
        return str(f['id'])
    key = '%s|%.3f|%.3f|%d' % (f['type'], f['x'], f['y'], int(round(f['rot'])) % 360)
    return '%s-%08x' % (f['type'], zlib.crc32(key.encode()) & 0xFFFFFFFF)


def seed_of(text):
    return zlib.crc32(text.encode('utf-8')) & 0xFFFFFFFF


class Model:
    """Normalised inputs."""

    def __init__(self, house, derived, catalog, rules, house_path='', derived_path=''):
        self.house, self.derived, self.catalog, self.rules = house, derived, catalog, rules
        self.house_path, self.derived_path = house_path, derived_path
        self.rooms = rooms_from(derived)
        self.room_by_id = {r['id']: r for r in self.rooms}
        self.openings = openings_from(derived, house)
        self.furniture = furniture_from(house, derived)
        self.outdoor = house.get('outdoor', [])
        self.ceiling = float(house.get('clearHeight', 2.75))
        self.walls = derived.get('walls', [])

    def room_at(self, x, y):
        for r in self.rooms:
            if r['region'].contains(x, y):
                return r
        return None

    def outdoor_at(self, x, y):
        for o in self.outdoor:
            if G.contains(o['rect'], x, y):
                return o
        return None

    def input_hash(self):
        def rnd(v):
            if isinstance(v, float):
                return round(v, 4)
            if isinstance(v, (list, tuple)):
                return [rnd(i) for i in v]
            if isinstance(v, dict):
                return {k: rnd(i) for k, i in v.items()}
            return v
        payload = {
            'v': VERSION,
            'furniture': rnd([{k: f[k] for k in ('type', 'x', 'y', 'rot', 'w', 'd', 'id')} for f in self.furniture]),
            'rooms': rnd([{'id': r['id'], 'type': r['type'], 'rects': r['region'].rects} for r in self.rooms]),
            'openings': rnd([{k: o[k] for k in ('id', 'kind', 'orient', 'axis', 'from', 'to', 'swing', 'hinge', 'head')} for o in self.openings]),
            'outdoor': rnd(self.outdoor), 'ceiling': self.ceiling,
            'catalog': self.catalog, 'rules': self.rules,
        }
        blob = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        return hashlib.sha256(blob).hexdigest()[:16]


def load(house_path, derived_path, here):
    house = read_json(house_path)
    derived = read_json(derived_path)
    catalog = read_json(os.path.join(here, 'catalog.json'))
    rules = read_json(os.path.join(here, 'decor_rules.json')) if os.path.exists(os.path.join(here, 'decor_rules.json')) else {}
    return Model(house, derived, catalog, rules, house_path, derived_path)
