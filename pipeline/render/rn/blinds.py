"""External venetian blinds (raffstore) on every glazed opening of a heated room (`blinds.items`, one product spec:
`blinds.product` or `house.shading.blinds.product`; docs/HOUSE-FORMAT.md section 4.4). The same construction as the web
(src/lib/three/extBlinds.ts), so a still and the 3D model agree:

* An opening wider than `maxSectionWidth` gets equal sections (`derived.openings[].blindSections`) with a shared rail.
* The head box sits in the wall above the opening and is not visible; only a dark slot under the head shows. The curtain and
  the guide rails stand in the reveal, `reveal` behind the outer wall face.
* Slats: C-profile aluminium (a shallow arc with rolled edges), `slatWidth` x `slatThickness`, at `slatPitch`, hanging from
  `head - 0.1` down over `drop` of the opening; lowered, the slat pack shows under the head.
* Tilt `slatAngleDeg`: 0 = horizontal (open) .. 90 = closed; the **outer edge goes down** as the slats close (the chord turns
  from the outward normal towards -up), like the web and every real blind: a cut-off angle blocks the sun and still shows the
  ground from inside.
The slat meshes are rebuilt only when the state of a section changes (`shot.blinds[i]` = {drop, slatAngleDeg}).
"""
from __future__ import annotations

import math

from mathutils import Vector

from .util import hex_to_linear, log

PACK = 0.1            # height of the slat pack under the head (as the web: slats hang from head - 0.1)
SLOT = 0.025          # the visible slot of the hidden head box


def _material(c3):
    import bpy
    spec = c3.material_spec("frame")
    m = bpy.data.materials.new("blind")
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear(spec.get("color", "#383e42")), 1)
    bs.inputs["Metallic"].default_value = 0.6
    bs.inputs["Roughness"].default_value = 0.35
    return m


def _dark():
    import bpy
    m = bpy.data.materials.get("blind_slot") or bpy.data.materials.new("blind_slot")
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (0.01, 0.011, 0.012, 1)
    bs.inputs["Roughness"].default_value = 0.8
    return m


def _box(verts, faces, center, ax, ay, az, size):
    c = Vector(center)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    i0 = len(verts)
    for sz in (-1, 1):
        for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(c + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz))
    for q in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        faces.append(tuple(i0 + j for j in q))


def c_profile(width, thick, sag_frac=0.075, curl_frac=0.05, n=8):
    """Closed 2D loop (u along the chord, v along the slat normal) of a C-profile slat: top arc, rolled edges, bottom arc."""
    sag, curl = width * sag_frac, width * curl_frac
    top, bot = [], []
    for i in range(n + 1):
        u = -width / 2 + width * i / n
        v = sag * (1 - (2 * u / width) ** 2)
        top.append((u, v + thick / 2))
        bot.append((u, v - thick / 2))
    # rolled edges: the outer ends curl down by `curl`
    left = [(-width / 2 - thick * 0.3, -curl * 0.5), (-width / 2 + thick * 0.2, -curl)]
    right = [(width / 2 + thick * 0.3, -curl * 0.5), (width / 2 - thick * 0.2, -curl)]
    return top + right + list(reversed(bot))[0:] + [left[1], left[0]]


def slat_basis(n, angle_deg):
    """(chord, normal) of a slat tilted by `angle_deg` with the outer edge down: chord = n cos a - up sin a."""
    a = math.radians(angle_deg)
    up = Vector((0, 0, 1))
    chord = n * math.cos(a) - up * math.sin(a)
    normal = up * math.cos(a) + n * math.sin(a)
    return chord, normal


def slat_heights(head, sill, drop, pitch):
    """Centre heights of the slats of a section (the web's slatHeights)."""
    travel = max(0.0, drop * (head - sill - PACK))
    out = []
    z = head - PACK - pitch / 2
    while z >= head - PACK - travel - 1e-9:
        out.append(z)
        z -= pitch
    return out


class Blinds:
    def __init__(self, scn):
        import bpy
        self.scn = scn
        c3 = scn.c3
        inp = scn.inputs["blinds"]
        self.items = inp["items"]
        self.p = dict(inp.get("details") or {})
        self.p.update(c3.blind_product())
        self.mat = _material(c3)
        self.slot = _dark()
        self.col = bpy.data.collections.new("blinds")
        bpy.context.scene.collection.children.link(self.col)
        self.sections = []           # per item: list of (along, n, start, width, sill, head)
        self.slats = []
        self.state = [None] * len(self.items)
        self.profile = c_profile(float(self.p["slatWidth"]), max(float(self.p["slatThickness"]), 0.0015))
        n_sec = 0
        for it in self.items:
            secs = self._sections(it, c3.blind_sections(it))
            self.sections.append(secs)
            n_sec += len(secs)
            self._fixed(it, secs)
            self.slats.append(self._empty("blind_slats_%s" % it["openingId"]))
        log("blinds: %d openings, %d sections" % (len(self.items), n_sec))

    def _empty(self, name):
        import bpy
        me = bpy.data.meshes.new(name)
        me.materials.append(self.mat)
        ob = bpy.data.objects.new(name, me)
        self.col.objects.link(ob)
        return ob

    def _sections(self, it, count):
        """(along, normal, start, width, sill, head) per section, ordered along `along`. C3 items carry their sections
        (`sections[]` with the centre on the curtain plane and the width); older inputs give a count: equal sections on the
        plane `reveal` behind the face centre."""
        n = Vector(it["normal"]).normalized()
        along = Vector(it.get("along") or (-n.y, n.x, 0)).normalized()
        sill, head = float(it["sill"]), float(it["head"])
        given = it.get("sections")
        if isinstance(given, list) and given:
            out = []
            for sc in given:
                w = float(sc["width"])
                c = Vector(sc["center"])
                c.z = 0.0
                out.append((along, n, c - along * (w / 2), w, sill, head))
            return sorted(out, key=lambda t: t[2].dot(along))
        face = Vector(it.get("planeCenter") or it["faceCenter"])
        if not it.get("planeCenter"):
            face = face - n * float(self.p.get("reveal", 0.051))       # the curtain plane in the reveal
        face.z = 0.0
        w = float(it["width"]) / count
        start = face - along * (float(it["width"]) / 2)
        return [(along, n, start + along * (w * k), w, sill, head) for k in range(count)]

    def _fixed(self, it, secs):
        """Guide rails in the reveal (shared between sections) and the slot of the hidden head box."""
        import bpy
        up = Vector((0, 0, 1))
        p = self.p
        rw, rd = float(p["railWidth"]), float(p["railDepth"])
        v, f = [], []
        along, n, start, w, sill, head = secs[0]
        # a rail at both ends and one shared rail between neighbouring sections
        edges = [s[2] for s in secs] + [secs[-1][2] + along * secs[-1][3]]
        for k, e in enumerate(edges):
            off = rw / 2 if k == 0 else (-rw / 2 if k == len(edges) - 1 else 0.0)
            c = e + along * off
            c.z = (sill + head) / 2
            _box(v, f, c, along, n, up, (rw, rd, head - sill))
        me = bpy.data.meshes.new("blind_rails_%s" % it["openingId"])
        me.from_pydata(v, [], f)
        me.materials.append(self.mat)
        me.update()
        self.col.objects.link(bpy.data.objects.new(me.name, me))
        # the slot: a dark strip under the head across the opening, as deep as the box
        sv, sf = [], []
        width = (edges[-1] - edges[0]).dot(along)
        c = start + along * (width / 2)
        c.z = head - SLOT / 2 + 0.002
        _box(sv, sf, c, along, n, up, (width - 0.01, float(p["boxDepth"]) * 0.8, SLOT))
        me2 = bpy.data.meshes.new("blind_slot_%s" % it["openingId"])
        me2.from_pydata(sv, [], sf)
        me2.materials.append(self.slot)
        me2.update()
        self.col.objects.link(bpy.data.objects.new(me2.name, me2))

    def _slat_mesh(self, secs, drop, angle_deg):
        p = self.p
        rw = float(p["railWidth"])
        pitch = float(p["slatPitch"])
        verts, faces = [], []
        prof = self.profile
        m = len(prof)
        up = Vector((0, 0, 1))
        for (along, n, start, w, sill, head) in secs:
            inner = w - rw - 0.006
            c0 = start + along * (w / 2)
            chord, normal = slat_basis(n, angle_deg)
            zs = slat_heights(head, sill, drop, pitch)
            if not zs:
                continue
            # the pack under the head
            pv = len(verts)
            pc = Vector((c0.x, c0.y, head - PACK / 2))
            _box(verts, faces, pc, along, n, up, (inner, float(p["slatWidth"]) * 0.95, PACK - 0.004))
            del pv
            for z in zs:
                c = Vector((c0.x, c0.y, z))
                i0 = len(verts)
                for side in (-1, 1):
                    e = c + along * (side * inner / 2)
                    for (u, vv) in prof:
                        verts.append(e + chord * u + normal * vv)
                for k in range(m):
                    k2 = (k + 1) % m
                    faces.append((i0 + k, i0 + k2, i0 + m + k2, i0 + m + k))
        return verts, faces

    def apply(self, states):
        """`states` = shot.blinds (one {drop, slatAngleDeg} per item)."""
        for i, (it, st) in enumerate(zip(self.items, states)):
            key = (round(st["drop"], 3), round(st["slatAngleDeg"], 1))
            if key == self.state[i]:
                continue
            self.state[i] = key
            me = self.slats[i].data
            v, f = self._slat_mesh(self.sections[i], st["drop"], st["slatAngleDeg"])
            me.clear_geometry()
            if v:
                me.from_pydata(v, [], f)
                me.update()
                for poly in me.polygons:
                    poly.use_smooth = True
