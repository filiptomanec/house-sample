"""Rule-driven decor: reads decor_rules.json by room type and places plants, lamps, rugs, curtains, art ... around the
furniture of the model. Nothing here knows a room id or a coordinate: positions come from the furniture, the room
polygon, the openings and the free floor. Seeds come from piece ids (piece rules) or room id + rule key (room rules),
so adding one piece does not change the decor of the others.
"""
import math
import fnmatch
import numpy as np

from . import assemble, geom2d as G, mesh as M, freespace as FS
from .compose import Item
from .decor_items import ITEMS
from .inputs import seed_of
from .piece import Piece

TERRACE = 'terrace'


# ---- helpers -----------------------------------------------------------------------------------------------------------

def _rng(seed):
    return np.random.default_rng(seed)


def _count(spec, rng):
    if isinstance(spec, (list, tuple)):
        return int(rng.integers(int(spec[0]), int(spec[1]) + 1))
    return int(spec if spec is not None else 1)


def _params(params, rng):
    out = {}
    for k, v in (params or {}).items():
        out[k] = float(rng.uniform(v[0], v[1])) if isinstance(v, list) and len(v) == 2 and all(isinstance(q, (int, float)) for q in v) else v
    return out


def _match_piece(pat, p):
    pats = pat if isinstance(pat, list) else [pat]
    for q in pats:
        t, _, var = q.partition(':')
        if fnmatch.fnmatch(p['type'], t) and (not var or p.get('variant') == var):
            return True
    return False


def _item_size(meta):
    if 'size' in meta:
        return meta['size']
    return (2 * meta['r'], 2 * meta['r'])


class Ctx:
    def __init__(self, scene):
        self.scene = scene
        self.model = scene.model
        self.rules = scene.model.rules.get('rooms', {})
        self.hi = scene.hi
        self.zones = {}
        self.occ = {}
        self.pieces = {}
        self.skipped = scene.decor_report['skipped']
        self.placed = scene.decor_report['placed']
        slider_zones = []
        for o in self.model.openings:
            if o['kind'] == 'slider':
                for q in G.door_zone_rects(o, o['t'], clear=0.5):
                    slider_zones.append({'id': o['id'], 'rect': q})
        all_zones = scene.layout.zones + slider_zones
        for rec in scene.placed:
            p = rec['p']
            self.pieces.setdefault(p['zone'], []).append(rec)
        for zone in set(list(self.pieces) + [r['id'] for r in self.model.rooms]):
            region = self.model.room_by_id[zone]['region'] if zone in self.model.room_by_id else None
            o = FS.Occupancy(region, all_zones if region else [])
            for rec in self.pieces.get(zone, []):
                o.add_rect(rec['p']['rect'])
            self.occ[zone] = o

    def room_of(self, zone):
        return self.model.room_by_id.get(zone)

    def skip(self, rule, zone, reason, item=None):
        self.skipped.append({'rule': rule.get('key') or rule.get('do'), 'item': item or rule.get('item'), 'zone': zone, 'reason': reason})

    def add(self, soup, boxes, zone, name, parent=None, pos=None, rule=None, kind='decor'):
        room = zone if zone in self.model.room_by_id else None
        it = Item('decor:%s:%d' % (name, len(self.scene.items)), 'decor:' + name, zone, room, soup, boxes, 'decor', parent=parent)
        self.scene.items.append(it)
        self.placed.append({'item': name, 'zone': zone, 'rule': (rule or {}).get('key') or (rule or {}).get('do'),
                            'at': [round(float(q), 2) for q in pos] if pos is not None else None, 'parent': parent})
        return it


def build_item(ctx, name, seed, outdoor, params=None, ceiling=None):
    meta = ITEMS[name]
    pc = Piece('decor:' + name, hi=ctx.hi, outdoor=outdoor, seed=seed)
    kw = dict(params or {})
    kw.setdefault('ceiling', ceiling if ceiling is not None else ctx.model.ceiling)
    meta['fn'](pc, **kw)
    return pc, meta


def place_soup(pc, Mx):
    s = M.Soup()
    s.extend(pc.soup, Mx)
    return s


# ---- rule kinds --------------------------------------------------------------------------------------------------------

def rule_surface(ctx, zone, rule, idx):
    for rec in ctx.pieces.get(zone, []):
        p, pc0 = rec['p'], rec['pc']
        if not _match_piece(rule['on'], p):
            continue
        anchor = pc0.anchors.get(rule.get('anchor', 'top'))
        if not anchor or 'rect' not in anchor:
            ctx.skip(rule, zone, 'no anchor %s on %s' % (rule.get('anchor', 'top'), p['type']))
            continue
        rng = _rng(seed_of('%s|surface|%d' % (p['id'], idx)))
        chosen = [it for it in rule['items'] if rng.random() < it.get('chance', 1.0)][:rule.get('max', 3)]
        if not chosen:
            continue
        x0, y0, x1, y1 = anchor['rect']
        z = anchor['z']
        W, D = x1 - x0, y1 - y0
        metas = [ITEMS[c['item']] for c in chosen]
        radii = [m['r'] for m in metas]
        mode = rule.get('mode', 'line')
        along_x = W >= D
        L = W if along_x else D
        short = D if along_x else W
        margin = rule.get('margin', 0.05)
        slots = []
        if mode == 'ends':
            n = len(chosen)
            for k in range(n):
                span = W - 2 * radii[k] - 2 * margin
                slots.append(x0 + radii[k] + margin + max(span, 0.0) * (0.5 if n == 1 else k / (n - 1)))
        elif mode == 'center':
            slots = [(x0 + x1) / 2 if along_x else (y0 + y1) / 2] * len(chosen)
        else:
            need = sum(2 * r for r in radii) + margin * (len(chosen) + 1)
            while chosen and need > L and len(chosen) > 1:
                chosen.pop()
                radii.pop()
                metas.pop()
                need = sum(2 * r for r in radii) + margin * (len(chosen) + 1)
            if need > L + 0.02:
                ctx.skip(rule, zone, 'surface of %s too small' % p['type'], chosen[0]['item'])
                continue
            free = max(L - need, 0.0)
            cur = (x0 if along_x else y0) + margin + (rng.uniform(0, free) if mode == 'line' else free / 2)
            for r in radii:
                cur += r
                slots.append(cur)
                cur += r + margin + (free / max(len(chosen), 1) * 0.3)
        Ma = rec['M'] @ anchor['T']
        for k, c in enumerate(chosen):
            meta = metas[k]
            a = slots[k]
            cross = ((y0 + y1) / 2 if along_x else (x0 + x1) / 2) + float(rng.uniform(-0.2, 0.2)) * max(0.0, short / 2 - meta['r'])
            px, py = (a, cross) if along_x else (cross, a)
            if mode == 'ends':
                px, py = a, y1 - meta['r'] - 0.03
            elif mode == 'center':
                px, py = (x0 + x1) / 2, (y0 + y1) / 2
            rot = float(rng.uniform(0, 2 * math.pi)) if c.get('spin', True) else 0.0
            seed = seed_of('%s|%s|%d' % (p['id'], c['item'], k))
            pc, _ = build_item(ctx, c['item'], seed, p['outdoor'], _params(c.get('params'), rng))
            Mx = Ma @ M.T(px, py, z) @ M.Rz(rot)
            ctx.add(place_soup(pc, Mx), [], zone, c['item'], parent=p['id'], pos=(Mx[0, 3], Mx[1, 3], Mx[2, 3]), rule=rule)


def rule_cushions(ctx, zone, rule, idx):
    """Leaning cushions at the ends of a seat anchor, optional folded throw."""
    for rec in ctx.pieces.get(zone, []):
        p, pc0 = rec['p'], rec['pc']
        if not _match_piece(rule['on'], p):
            continue
        anchor = pc0.anchors.get('seat')
        if not anchor:
            continue
        rng = _rng(seed_of('%s|cushions|%d' % (p['id'], idx)))
        x0, y0, x1, y1 = anchor['rect']
        n = _count(rule.get('count', [2, 3]), rng)
        Ma = rec['M'] @ anchor['T']
        cols = rule.get('colors') or ['f_sage', 'f_sand', 'f_blue', 'f_clay', 'f_linen', 'f_greige']
        for k in range(n):
            pcs = Piece('cushion', hi=ctx.hi, outdoor=p['outdoor'], seed=seed_of('%s|cu%d' % (p['id'], k)))
            s = float(rng.uniform(0.38, 0.48))
            mat = pcs.pick(cols)
            if k == 0 or n == 1:
                px = x0 + s / 2 + 0.06
            elif k == 1:
                px = x1 - s / 2 - 0.06
            else:
                px = float(rng.uniform(x0 + 0.4, x1 - 0.4))
            with pcs.at(0, 0, s * 0.47, rx=math.radians(-72 + float(rng.uniform(-6, 6))), rz=float(rng.uniform(-0.12, 0.12))):
                pcs.cushion(s, s * 0.95, 0.12, mat, seed=k * 2.0)
            Mx = Ma @ M.T(px, y1 - 0.2 - (0.04 if k > 1 else 0), anchor['z'])
            ctx.add(place_soup(pcs, Mx), [], zone, 'cushion', parent=p['id'], pos=(Mx[0, 3], Mx[1, 3], Mx[2, 3]), rule=rule)
        if rule.get('throw') and rng.random() < rule['throw']:
            pct, _ = build_item(ctx, 'throw', seed_of(p['id'] + 'throw'), p['outdoor'], {})
            Mx = Ma @ M.T(x1 - 0.35, (y0 + y1) / 2 - 0.1, anchor['z']) @ M.Rz(math.pi / 2 + 0.1)
            ctx.add(place_soup(pct, Mx), [], zone, 'throw', parent=p['id'], pos=(Mx[0, 3], Mx[1, 3], Mx[2, 3]), rule=rule)


def _floor_candidates(ctx, zone, rule, rad, rng):
    region = ctx.model.room_by_id[zone]['region'] if zone in ctx.model.room_by_id else None
    where = rule.get('where', 'corner')
    cands = []
    if where == 'corner' and region:
        cands = FS.corner_candidates(region, rad)
    elif where == 'wall' and region:
        cands = FS.wall_candidates(region, rad)
    elif where == 'beside':
        for rec in ctx.pieces.get(zone, []):
            if _match_piece(rule['beside'], rec['p']):
                cands += FS.beside_candidates(rec['p'], rad)
    elif where == 'area':
        od = [o for o in ctx.model.outdoor if o['type'] == 'terrace']
        for o in od:
            x0, y0, x1, y1 = o['rect']
            for x in np.arange(x0 + rad + 0.1, x1 - rad, 0.35):
                for y in (y0 + rad + 0.08, y1 - rad - 0.08):
                    cands.append({'x': float(x), 'y': float(y), 'kind': 'edge'})
            for y in np.arange(y0 + rad + 0.1, y1 - rad, 0.35):
                for x in (x0 + rad + 0.08, x1 - rad - 0.08):
                    cands.append({'x': float(x), 'y': float(y), 'kind': 'edge'})
    return cands


def _score(ctx, zone, rule, c, rng):
    s = float(rng.uniform(0, 0.6))
    near = rule.get('near')
    if near:
        kinds = near.split(':', 1)[1].split(',') if ':' in near else ['window', 'slider']
        ds = [math.hypot(c['x'] - (o['c'] if o['orient'] == 'h' else o['axis']), c['y'] - (o['axis'] if o['orient'] == 'h' else o['c']))
              for o in ctx.model.openings if o['kind'] in kinds and (o['room'] == zone or (o['connects'] and zone in o['connects']))]
        if ds:
            s -= min(ds)
    if rule.get('far') == 'door':
        ds = [math.hypot(c['x'] - (o['c'] if o['orient'] == 'h' else o['axis']), c['y'] - (o['axis'] if o['orient'] == 'h' else o['c']))
              for o in ctx.model.openings if o['kind'] in ('door', 'entry') and (o['room'] == zone or (o['connects'] and zone in o['connects']))]
        if ds:
            s += 0.5 * min(ds)
    return s


def rule_floor(ctx, zone, rule, idx):
    name = rule['item']
    meta = ITEMS[name]
    rng = _rng(seed_of('%s|%s|floor|%d' % (zone, rule.get('key', name), idx)))
    if rng.random() > rule.get('chance', 1.0):
        return
    n = _count(rule.get('count', 1), rng)
    occ = ctx.occ[zone]
    outdoor = zone == TERRACE
    for k in range(n):
        params = _params(rule.get('params'), rng)
        pc, _ = build_item(ctx, name, seed_of('%s|%s|%d' % (zone, rule.get('key', name), k)), outdoor, params)
        w, d = _item_size(meta)
        sized = 'size' in meta
        wallspot = sized and rule.get('where') == 'wall'
        rad = d / 2 if wallspot else (max(w, d) / 2 if sized else meta['r'])
        cands = _floor_candidates(ctx, zone, rule, rad, rng)

        def rect_of(c):
            if wallspot and 'ny' in c and abs(c['ny']) < 0.5:       # wall runs along y: the long side lies along y
                return [c['x'] - d / 2, c['y'] - w / 2, c['x'] + d / 2, c['y'] + w / 2]
            return [c['x'] - w / 2, c['y'] - d / 2, c['x'] + w / 2, c['y'] + d / 2]
        cands = [c for c in cands if (occ.free_rect(rect_of(c)) if sized else occ.free_disc(c['x'], c['y'], rad))]
        if not cands:
            ctx.skip(rule, zone, 'no free %s spot' % rule.get('where', 'corner'), name)
            continue
        cands.sort(key=lambda c: -_score(ctx, zone, rule, c, rng))
        c = cands[0]
        rot = float(rng.uniform(0, 2 * math.pi)) if rule.get('spin', True) else 0.0
        if wallspot and 'nx' in c:
            rot = math.atan2(c['nx'], -c['ny']) + (math.pi if rule.get('facing') == 'wall' else 0.0)
        Mx = assemble.place_matrix(c['x'], c['y'], math.degrees(rot))
        soup = place_soup(pc, Mx)
        boxes = [list(b) for b in assemble.part_boxes(soup)] if meta['h'] >= 0.3 else []
        ctx.add(soup, boxes, zone, name, pos=(c['x'], c['y'], 0), rule=rule)
        if sized:
            occ.add_rect(rect_of(c))
        else:
            occ.add_disc(c['x'], c['y'], rad)


def rule_wall(ctx, zone, rule, idx):
    """Wall decor above pieces (frames) or on free wall spots (shelves, tool racks)."""
    name = rule['item']
    meta = ITEMS[name]
    region = ctx.model.room_by_id[zone]['region'] if zone in ctx.model.room_by_id else None
    if region is None:
        return
    if 'above' in rule:
        for rec in ctx.pieces.get(zone, []):
            p = rec['p']
            if not _match_piece(rule['above'], p) or not p['wall'].get('back'):
                continue
            rng = _rng(seed_of('%s|%s|wall|%d' % (p['id'], name, idx)))
            if rng.random() > rule.get('chance', 1.0):
                continue
            a = math.radians(p['rot'])
            u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
            off = FS.wall_plane_offset(region, p['x'] + v[0] * p['d'] / 2, p['y'] + v[1] * p['d'] / 2, v[0], v[1])
            if off is None:
                ctx.skip(rule, zone, 'wall plane not found', name)
                continue
            n = _count(rule.get('count', 1), rng)
            width = p['w'] if p['w'] < 3 else 3
            for k in range(n):
                prm = _params(rule.get('params'), rng)
                pc, _ = build_item(ctx, name, seed_of('%s|%s|%d' % (p['id'], name, k)), False, prm)
                lx = 0.0 if n == 1 else (k - (n - 1) / 2) * min(0.8, width / n)
                z = rule.get('z', 1.25) + float(rng.uniform(-0.04, 0.06))
                px, py = p['x'] + u[0] * lx + v[0] * (p['d'] / 2 + off - 0.001), p['y'] + u[1] * lx + v[1] * (p['d'] / 2 + off - 0.001)
                Mx = assemble.place_matrix(px, py, p['rot'], z)
                # frames face -y of their frame; the wall is at +y of the piece, i.e. the same orientation as the piece
                ctx.add(place_soup(pc, Mx), [], zone, name, parent=p['id'], pos=(px, py, z), rule=rule)
        return
    rng = _rng(seed_of('%s|%s|wall|%d' % (zone, rule.get('key', name), idx)))
    if rng.random() > rule.get('chance', 1.0):
        return
    w, d = _item_size(meta)
    occ = ctx.occ[zone]
    cands = FS.wall_candidates(region, 0.0, step=0.2, gap=0.0)
    ok = []
    for c in cands:
        # rect of the item footprint along the wall (width w along the wall, depth d into the room)
        if abs(c['ny']) > 0.5:
            r = [c['x'] - w / 2, c['y'] if c['ny'] > 0 else c['y'] - d, c['x'] + w / 2, c['y'] + d if c['ny'] > 0 else c['y']]
        else:
            r = [c['x'] if c['nx'] > 0 else c['x'] - d, c['y'] - w / 2, c['x'] + d if c['nx'] > 0 else c['x'], c['y'] + w / 2]
        if occ.free_rect(r, inflate=rule.get('clear', 0.1)):
            ok.append((c, r))
    if not ok:
        ctx.skip(rule, zone, 'no free wall spot', name)
        return
    ok.sort(key=lambda cr: -_score(ctx, zone, rule, cr[0], rng))
    c, r = ok[0]
    pc, _ = build_item(ctx, name, seed_of('%s|%s' % (zone, rule.get('key', name))), False, _params(rule.get('params'), rng))
    rot = math.degrees(math.atan2(c['nx'], -c['ny']))      # local -y points into the room
    Mx = assemble.place_matrix(c['x'], c['y'], rot, rule.get('z', 0.0))
    ctx.add(place_soup(pc, Mx), [], zone, name, pos=(c['x'], c['y'], 0), rule=rule)
    occ.add_rect(r)


def rule_rug(ctx, zone, rule, idx):
    types = rule['under']
    recs = [rec for rec in ctx.pieces.get(zone, []) if _match_piece(types, rec['p'])]
    if not recs:
        return
    rng = _rng(seed_of('%s|rug|%d' % (zone, idx)))
    region = ctx.model.room_by_id[zone]['region'] if zone in ctx.model.room_by_id else None
    if rule.get('mode') == 'piece':
        rec = recs[0]
        p = rec['p']
        pad = rule.get('pad', {'l': 0.55, 'r': 0.55, 'f': 0.8, 'b': 0.0})
        w = p['w'] + pad['l'] + pad['r']
        d = p['d'] + pad['f'] + pad['b']
        cx = (pad['r'] - pad['l']) / 2
        cy = (pad['b'] - pad['f']) / 2
        a = math.radians(p['rot'])
        wx = p['x'] + math.cos(a) * cx - math.sin(a) * cy
        wy = p['y'] + math.sin(a) * cx + math.cos(a) * cy
        rot = p['rot']
    else:
        pad = rule.get('pad', 0.4)
        x0 = min(r['p']['rect'][0] for r in recs) - pad
        y0 = min(r['p']['rect'][1] for r in recs) - pad
        x1 = max(r['p']['rect'][2] for r in recs) + pad
        y1 = max(r['p']['rect'][3] for r in recs) + pad
        if region is not None:
            bb = G.grow(region.bbox, -0.08)
            x0, y0, x1, y1 = max(x0, bb[0]), max(y0, bb[1]), min(x1, bb[2]), min(y1, bb[3])
        w, d = x1 - x0, y1 - y0
        wx, wy, rot = (x0 + x1) / 2, (y0 + y1) / 2, 0.0
    if w < 0.5 or d < 0.5:
        return
    if region is not None and region.covered_area([wx - w / 2, wy - d / 2, wx + w / 2, wy + d / 2]) < 0.9 * w * d and rule.get('mode') != 'piece':
        ctx.skip(rule, zone, 'rug does not fit the room outline', 'rug')
        return
    pc, _ = build_item(ctx, 'rug', seed_of('%s|rug|%d' % (zone, idx)), zone == TERRACE, {'w': w, 'd': d, 'style': rule.get('style'), 'mat': rule.get('mat')})
    Mx = assemble.place_matrix(wx, wy, rot)
    ctx.add(place_soup(pc, Mx), [], zone, 'rug', pos=(wx, wy, 0), rule=rule)


def rule_curtains(ctx, zone, rule, idx):
    region = ctx.model.room_by_id[zone]['region'] if zone in ctx.model.room_by_id else None
    if region is None:
        return
    for o in ctx.model.openings:
        if o['kind'] not in rule.get('openings', ['slider', 'window']) or o['room'] != zone or o['w'] < rule.get('minWidth', 1.2):
            continue
        # inward normal: the side of the wall axis where the room lies
        probe = 0.35
        if o['orient'] == 'h':
            n = (0.0, 1.0) if region.contains(o['c'], o['axis'] + probe) else (0.0, -1.0)
            pos = (o['c'], o['axis'] + n[1] * (o['t'] / 2 + 0.07))
        else:
            n = (1.0, 0.0) if region.contains(o['axis'] + probe, o['c']) else (-1.0, 0.0)
            pos = (o['axis'] + n[0] * (o['t'] / 2 + 0.07), o['c'])
        rot = math.degrees(math.atan2(n[0], -n[1]))        # local -y = inward
        rng = _rng(seed_of('%s|%s|curtain' % (zone, o['id'])))
        if rng.random() > rule.get('chance', 1.0):
            continue
        # tall furniture right in front of the opening: skip
        span = [pos[0] - o['w'] / 2 - 0.8, pos[1] - 0.15, pos[0] + o['w'] / 2 + 0.8, pos[1] + 0.15] if o['orient'] == 'h' else \
               [pos[0] - 0.15, pos[1] - o['w'] / 2 - 0.8, pos[0] + 0.15, pos[1] + o['w'] / 2 + 0.8]
        blocked = [rec['p']['type'] for rec in ctx.pieces.get(zone, []) if G.inter_area(span, rec['p']['rect']) > 1e-3 and rec['pc'].tris() and rec['p']['category'] in ('storage', 'kitchen')]
        if blocked:
            ctx.skip(rule, zone, 'tall furniture (%s) at opening %s' % (blocked[0], o['id']), 'curtain_set')
            continue
        h = min(2.62, ctx.model.ceiling - 0.12)
        pc, _ = build_item(ctx, 'curtain_set', seed_of('%s|%s' % (zone, o['id'])), False, {'opening_w': o['w'], 'height': h})
        Mx = assemble.place_matrix(pos[0], pos[1], rot)
        ctx.add(place_soup(pc, Mx), [], zone, 'curtain_set', pos=(pos[0], pos[1], 0), rule=rule)


def rule_pendant(ctx, zone, rule, idx):
    for rec in ctx.pieces.get(zone, []):
        p = rec['p']
        if not _match_piece(rule['over'], p):
            continue
        rng = _rng(seed_of('%s|pendant|%d' % (p['id'], idx)))
        n = max(1, int(round(max(p['w'], p['d']) / rule.get('spacing', 0.9)))) if rule.get('perMeter', True) else 1
        n = min(n, rule.get('max', 3))
        a = math.radians(p['rot'])
        u = (math.cos(a), math.sin(a))
        long_local = p['w'] >= p['d']
        L = (p['w'] if long_local else p['d'])
        for k in range(n):
            t = (k + 0.5) / n - 0.5
            lx, ly = (t * L * 0.8, 0.0) if long_local else (0.0, t * L * 0.8)
            wx = p['x'] + u[0] * lx - u[1] * ly
            wy = p['y'] + u[1] * lx + u[0] * ly
            drop = rule.get('drop', 0.85) + float(rng.uniform(-0.03, 0.03))
            pc, _ = build_item(ctx, 'pendant', seed_of('%s|pd%d' % (p['id'], k)), False, {'drop': drop, 'r': rule.get('r', 0.24), 'kind': rule.get('kind', 'dome')})
            Mx = assemble.place_matrix(wx, wy, 0.0)
            ctx.add(place_soup(pc, Mx), [], zone, 'pendant', parent=p['id'], pos=(wx, wy, ctx.model.ceiling - drop), rule=rule)


DISPATCH = {'surface': rule_surface, 'cushions': rule_cushions, 'floor': rule_floor, 'wall': rule_wall, 'rug': rule_rug,
            'curtains': rule_curtains, 'pendant': rule_pendant}
ORDER = ['rug', 'surface', 'cushions', 'wall', 'pendant', 'curtains', 'floor']


def run(scene):
    ctx = Ctx(scene)
    zones = list(ctx.occ.keys())
    for zone in sorted(zones, key=str):
        rtype = ctx.room_of(zone)['type'] if ctx.room_of(zone) else TERRACE
        rules = list(ctx.rules.get('*', [])) + list(ctx.rules.get(rtype, []))
        if zone == TERRACE:
            rules = list(ctx.rules.get(TERRACE, []))
        indexed = list(enumerate(rules))
        for kind in ORDER:
            for idx, rule in indexed:
                if rule.get('do') == kind:
                    DISPATCH[kind](ctx, zone, rule, idx)
    return ctx
