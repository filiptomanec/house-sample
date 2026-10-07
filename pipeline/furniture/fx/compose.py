"""Compose the whole furnished scene (numpy only): build every piece, place it, add decor, derive footprints."""
import math
import time
import numpy as np

import pieces
from . import assemble, geom2d as G, mesh as M, qa
from .layout import Layout


class Item:
    """One placed object (a furniture piece or a decor item) in the house frame."""

    def __init__(self, id, type, zone, room, soup, boxes, kind='furniture', parent=None, **extra):
        self.id, self.type, self.zone, self.room, self.soup, self.boxes = id, type, zone, room, soup, boxes
        self.kind, self.parent, self.extra = kind, parent, extra


class Scene:
    def __init__(self, model, hi):
        self.model, self.hi = model, hi
        self.layout = Layout(model)
        self.items = []
        self.placed = []          # furniture records for decor: piece dict, Piece, placement matrix
        self.decor_report = {'placed': [], 'skipped': []}
        self.timing = {}
        self.qa = []

    def triangles(self):
        return sum(i.soup.tris() for i in self.items)


def build_furniture(scene, only=None):
    m = scene.model
    t0 = time.time()
    for p in scene.layout.pieces:
        if p['zone'] is None or (only and p['zone'] not in only):
            continue      # outside every room and outdoor area: reported by the layout, not drawn
        ctx = {'roomType': p['roomType'], 'wall': p['wall'], 'ceiling': m.ceiling, 'zone': p['zone'], 'room': p['room']}
        pc = pieces.build(p['builder'], p['w'], p['d'], p['variant'], hi=scene.hi, outdoor=p['outdoor'], seed=p['seed'], ctx=ctx)
        Mx = assemble.place_matrix(p['x'], p['y'], p['rot'])
        soup = M.Soup()
        soup.extend(pc.soup, Mx)
        if pc.fp:
            boxes = []
            for b in pc.fp:
                r = assemble.rect_to_house(b, p['x'], p['y'], p['rot'])
                boxes.append(r + [b[4]])
        else:
            boxes = [list(b) for b in assemble.part_boxes(soup)]
        cp = qa.coplanar(pc.soup)
        if cp:
            scene.qa.append({'piece': p['id'], 'type': p['type'], 'coplanar': len(cp),
                             'materials': sorted(set('%s/%s' % c['mats'] for c in cp))[:6]})
        scene.items.append(Item(p['id'], p['type'], p['zone'], p['room'], soup, boxes, 'furniture', variant=p['variant']))
        scene.placed.append({'p': p, 'pc': pc, 'M': Mx})
    scene.timing['furniture'] = round(time.time() - t0, 2)


def compose(model, hi=True, decor=True, only=None):
    scene = Scene(model, hi)
    build_furniture(scene, only)
    if decor:
        t0 = time.time()
        from . import decor as D
        D.run(scene)
        scene.timing['decor'] = round(time.time() - t0, 2)
    return scene


def trim_footprints(scene):
    """Footprint boxes per item with the door zones cut out; returns (boxes list, trimmed notes, dropped notes)."""
    zones = [z['rect'] for z in scene.layout.zones if 'rect' in z]
    zone_ids = [z['id'] for z in scene.layout.zones if 'rect' in z]
    out, trimmed, dropped = [], [], []
    for it in scene.items:
        for b in it.boxes:
            if len(b) < 5 or b[4] < 0.3:
                continue
            parts = [list(b[:4])]
            doors = []
            for z, zid in zip(zones, zone_ids):
                nxt = []
                for a in parts:
                    if G.inter_area(a, z) > 1e-6:
                        doors.append(zid)
                        nxt += G.cut_box(a, z)
                    else:
                        nxt.append(a)
                parts = nxt
            if doors:
                trimmed.append({'id': it.id, 'type': it.type, 'doors': sorted(set(doors))})
            if not parts:
                dropped.append({'id': it.id, 'type': it.type, 'doors': sorted(set(doors)), 'h': round(b[4], 2)})
                continue
            for a in parts:
                out.append({'id': it.id, 'type': it.type, 'kind': it.kind, 'room': it.zone,
                            'box': [round(float(q), 3) for q in a], 'h': round(float(b[4]), 3)})
    return out, trimmed, dropped
