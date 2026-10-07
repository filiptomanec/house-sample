"""Placement of the model's furniture: rooms, variants, wall contact and validation (stdlib only)."""
import math

from . import geom2d as G
from .inputs import piece_id, seed_of

SIDES = ('back', 'front', 'left', 'right')


def rect_of(f, w, d):
    """House-frame AABB of a piece centred at (x, y) turned by rot (multiples of 90 swap w and d)."""
    a = math.radians(f['rot'])
    c, s = abs(math.cos(a)), abs(math.sin(a))
    hw, hd = (w * c + d * s) / 2, (w * s + d * c) / 2
    return [f['x'] - hw, f['y'] - hd, f['x'] + hw, f['y'] + hd]


def _match(when, ctx):
    for k, v in when.items():
        if k == 'roomType':
            if ctx['roomType'] not in v:
                return False
        elif k == 'outdoor':
            if bool(v) != ctx['outdoor']:
                return False
        elif k == 'maxSide':
            if min(ctx['w'], ctx['d']) > v + 1e-9:
                return False
        elif k == 'minSide':
            if min(ctx['w'], ctx['d']) < v - 1e-9:
                return False
        elif k == 'nearType':
            within = when.get('within', 1.0)
            if not any(o['type'] in v and math.hypot(o['x'] - ctx['x'], o['y'] - ctx['y']) <= within for o in ctx['others']):
                return False
        elif k == 'within':
            continue
        elif k == 'carIndex':
            if (ctx['sameIndex'] % 2 == 0) != (v == 'even'):
                return False
        else:
            raise ValueError('unknown variant condition %r' % k)
    return True


def resolve_variant(spec, ctx):
    for rule in spec.get('variants', []):
        if rule.get('default') or _match(rule['when'], ctx):
            return rule['variant']
    return None


def wall_contact(region, x, y, rot_deg, w, d, probe=0.07):
    """Which local sides of a piece touch a wall: the room boundary lies within `probe` metres beyond that side
    (at least two of three probe points along the side fall outside the clear floor)."""
    a = math.radians(rot_deg)
    u = (math.cos(a), math.sin(a))            # local +x in the plan
    v = (-math.sin(a), math.cos(a))           # local +y (the back) in the plan
    neg = lambda q: (-q[0], -q[1])
    sides = {'back': (v, d / 2, u, w / 2), 'front': (neg(v), d / 2, u, w / 2),
             'left': (neg(u), w / 2, v, d / 2), 'right': (u, w / 2, v, d / 2)}
    out = {}
    for side, (n, h, t, ht) in sides.items():
        hits = 0
        for k in (-1, 0, 1):
            px = x + n[0] * (h + probe) + t[0] * k * ht * 0.6
            py = y + n[1] * (h + probe) + t[1] * k * ht * 0.6
            if not region.contains(px, py):
                hits += 1
        out[side] = hits >= 2
    return out


class Layout:
    def __init__(self, model):
        self.model = model
        self.pieces = []
        self.issues = []
        self.zones = []             # door zones: dicts id, rect or poly
        self._build()

    # ---- construction ---------------------------------------------------------------------------------------------
    def _issue(self, level, code, msg, piece=None, **kw):
        d = {'level': level, 'code': code, 'message': msg}
        if piece:
            d['piece'] = piece
        d.update(kw)
        self.issues.append(d)

    def _build(self):
        m = self.model
        cat = m.catalog['types']
        raw = []
        for f in m.furniture:
            spec = cat.get(f['type'])
            if not spec:
                self._issue('error', 'unknown-type', 'Unknown furniture type %r' % f['type'])
                continue
            w = float(f['w'] if f['w'] is not None else spec['w'])
            d = float(f['d'] if f['d'] is not None else spec['d'])
            if f.get('modelW') is None and f.get('modelD') is None and f['w'] is not None and \
                    (abs(f['w'] - spec['w']) > 1e-6 or abs(f['d'] - spec['d']) > 1e-6):
                self._issue('info', 'catalog-mismatch', 'catalog.json default size of %s (%.2f x %.2f) differs from the model (%.2f x %.2f); the model wins.'
                            % (f['type'], spec['w'], spec['d'], f['w'], f['d']))
            room = m.room_at(f['x'], f['y'])
            od = None if room else m.outdoor_at(f['x'], f['y'])
            raw.append({'f': f, 'spec': spec, 'w': w, 'd': d, 'room': room, 'outdoor': od,
                        'id': piece_id(f), 'rect': rect_of(f, w, d)})
        ids = [r['id'] for r in raw]
        if len(set(ids)) != len(ids):
            self._issue('warn', 'duplicate-id', 'Two furniture entries share one id (identical type and placement).')
        # sort order for neighbour-based variants: by position, so that inserting a piece elsewhere changes nothing
        for r in raw:
            f = r['f']
            others = [{'type': o['f']['type'], 'x': o['f']['x'], 'y': o['f']['y']} for o in raw if o is not r]
            same = sorted((o for o in raw if o['f']['type'] == f['type'] and self._zone_key(o) == self._zone_key(r)),
                          key=lambda o: (round(o['f']['x'], 3), round(o['f']['y'], 3)))
            ctx = {'roomType': r['room']['type'] if r['room'] else 'outdoor', 'outdoor': bool(r['outdoor']),
                   'w': r['w'], 'd': r['d'], 'x': f['x'], 'y': f['y'], 'others': others,
                   'sameIndex': [o['id'] for o in same].index(r['id'])}
            r['variant'] = resolve_variant(r['spec'], ctx)
            region = r['room']['region'] if r['room'] else None
            r['wall'] = wall_contact(region, f['x'], f['y'], f['rot'], r['w'], r['d']) if region else {}
            r['rot'] = f['rot']
            if region and r['spec'].get('wallBacked') and r['wall'].get('front') and not r['wall'].get('back'):
                r['rot'] = (f['rot'] + 180) % 360
                r['wall'] = wall_contact(region, f['x'], f['y'], r['rot'], r['w'], r['d'])
                self._issue('info', 'rot-corrected', '%s faces the wall; turned by 180 degrees so that its back stands against it.' % f['type'], r['id'])
            zone = r['room']['id'] if r['room'] else ('terrace' if r['outdoor'] else None)
            r['zone'] = zone
            self.pieces.append({
                'id': r['id'], 'type': f['type'], 'builder': r['spec']['builder'], 'variant': r['variant'], 'x': f['x'], 'y': f['y'],
                'rot': r['rot'], 'rotModel': f['rot'], 'w': r['w'], 'd': r['d'], 'rect': r['rect'], 'room': r['room']['id'] if r['room'] else None,
                'roomType': r['room']['type'] if r['room'] else None, 'zone': zone, 'outdoor': bool(r['outdoor']),
                'wall': r['wall'], 'seed': seed_of(r['id']), 'category': r['spec'].get('category'), 'index': f['index']})
        self._zones()
        self._validate()

    def _zone_key(self, r):
        return r['room']['id'] if r['room'] else ('terrace' if r['outdoor'] else None)

    def _zones(self):
        for o in self.model.openings:
            if o['kind'] in ('door', 'entry'):
                for q in G.door_zone_rects(o, o['t']):
                    self.zones.append({'id': o['id'], 'rect': q, 'kind': o['kind']})
                poly = G.swing_polygon(o, o['t'])
                if poly:
                    self.zones.append({'id': o['id'], 'poly': poly, 'kind': 'swing'})

    # ---- validation ------------------------------------------------------------------------------------------------
    def _validate(self):
        P = self.pieces
        for p in P:
            r = p['rect']
            area = G.rect_area(r)
            if p['zone'] is None:
                self._issue('error', 'outside', '%s lies outside every room and outdoor area.' % p['type'], p['id'])
                continue
            if p['room']:
                region = self.model.room_by_id[p['room']]['region']
                inside = region.covered_area(r)
                if inside < area * 0.98:
                    self._issue('warn', 'outside-room', '%s extends %.2f m2 beyond the clear floor of room %s.' % (p['type'], area - inside, p['room']),
                                p['id'], room=p['room'], excess=round(area - inside, 3))
            elif p['outdoor']:
                od = self.model.outdoor_at(p['x'], p['y'])
                if G.inter_area(od['rect'], r) < area * 0.98:
                    self._issue('warn', 'outside-area', '%s extends beyond outdoor area %s.' % (p['type'], od['id']), p['id'])
            if p['type'] != 'car' and p['room'] is not None:
                for z in self.zones:
                    hit = G.rect_hits_polygon(r, z['poly']) if 'poly' in z else G.inter_area(r, z['rect']) > 1e-4
                    if hit:
                        self._issue('warn', 'door-zone', '%s blocks the %s of door %s.' % (p['type'], 'swing' if 'poly' in z else 'clear zone', z['id']),
                                    p['id'], opening=z['id'])
                        break
        for i in range(len(P)):
            for j in range(i + 1, len(P)):
                a, b = P[i], P[j]
                if a['zone'] != b['zone']:
                    continue
                ia = G.inter_area(a['rect'], b['rect'])
                if ia > 0.01 * min(G.rect_area(a['rect']), G.rect_area(b['rect'])) and ia > 2e-3:
                    self._issue('warn', 'collision', '%s and %s overlap by %.2f m2.' % (a['type'], b['type'], ia), a['id'], other=b['id'], area=round(ia, 3))
