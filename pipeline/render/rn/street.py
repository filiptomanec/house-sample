"""The street (C3 `zones.street`, `access`): the asphalt of the carriageway draped on the terrain; a full kerb along the
plot-side edge with dropped kerbs (`droppedKerbReveal` high) where the drive and the walk cross it (`access.driveKerb`,
`access.walkKerb`); a kerb on the far edge; the pavement (`zones.street.pavement`) raised to the kerb top with an edge stone
towards the green strip, ramped down to the crossings (`access.driveVerge`, `access.walkVerge`, whose paving is draped by
surfaces.py). The terrain has no grass under the carriageway or the pavement (terrain.py)."""
from __future__ import annotations

from mathutils import Vector

from . import ground_materials as GM
from .fences import MeshBuilder
from .util import log

RAMP = 0.8             # length of the pavement ramp down to a crossing (m)


def asphalt_material(c3):
    return GM.asphalt_material(c3.color("carriageway", "#5c6064"))


def _spans(edge_a, edge_b, polys):
    """Parameter spans (t0, t1) along the edge a-b covered by the given polygons (projection of their points)."""
    d = edge_b - edge_a
    L2 = d.length_squared
    out = []
    for poly in polys:
        if not poly:
            continue
        ts = [((Vector((p[0], p[1], 0)) - edge_a).dot(d)) / L2 for p in poly]
        out.append((max(0.0, min(ts)), min(1.0, max(ts))))
    return sorted(out)


def build(scn, terrain):
    import bpy
    from . import surfaces
    c3 = scn.c3
    st = c3.street()
    acc = c3.access()
    col = bpy.data.collections.new("street")
    bpy.context.scene.collection.children.link(col)
    cw = st["carriageway"]
    col.objects.link(surfaces.drape("asphalt", cw, terrain, 0.004, asphalt_material(c3), max_edge=0.9))
    # the plot-side edge: the carriageway edge nearest to the plot centre
    plot = scn.inputs["site"]["plot"]["polygon"]
    pc = Vector((sum(p[0] for p in plot) / len(plot), sum(p[1] for p in plot) / len(plot), 0))
    edges = [(Vector((*cw[i], 0)), Vector((*cw[(i + 1) % len(cw)], 0))) for i in range(len(cw))]
    edges.sort(key=lambda e: -(e[1] - e[0]).length)
    long_edges = edges[:2]
    near = min(long_edges, key=lambda e: ((e[0] + e[1]) / 2 - pc).length)
    far = max(long_edges, key=lambda e: ((e[0] + e[1]) / 2 - pc).length)
    kh = float(st.get("kerbHeight", 0.12))
    kw = float(st.get("kerbWidth", 0.15))
    reveal = float(acc.get("droppedKerbReveal", 0.02))
    kerb_mat = surfaces.role_material("floor_concrete", scn.house["cfg"])
    if c3.color("kerb"):
        from .fences import _material
        kerb_mat = _material("street_kerb", c3.color("kerb"), float(c3.material_spec("kerb").get("roughness", 0.85)))
    mb = MeshBuilder()
    up = Vector((0, 0, 1))

    def kerb_run(a, b, height, side):
        """Kerb from a to b (the edge points), `side` = which side of the edge it lies on (+1 left of a->b)."""
        d = b - a
        L = d.length
        if L < 0.02:
            return
        u = d / L
        n = Vector((-u.y, u.x, 0)) * side
        k = max(1, int(L / 1.0))                      # 1 m kerb stones following the ground
        for i in range(k):
            p0, p1 = a + d * (i / k), a + d * ((i + 1) / k)
            m = (p0 + p1) / 2 + n * (kw / 2)
            g = min(terrain.z(m.x, m.y), terrain.z((p0 + n * 0.01).x, (p0 + n * 0.01).y))
            mb.box(Vector((m.x, m.y, g + (height - 0.15) / 2)), u, n, up, ((p1 - p0).length - 0.004, kw, height + 0.15), 0)

    # near edge: the kerb lies on the pavement side; cut at the dropped kerbs
    a, b = near
    side = 1 if (Vector((-(b - a).y, (b - a).x, 0))).dot(pc - (a + b) / 2) > 0 else -1
    spans = _spans(a, b, [acc.get("driveKerb"), acc.get("walkKerb")])
    t = 0.0
    for t0, t1 in spans:
        kerb_run(a + (b - a) * t, a + (b - a) * t0, kh, side)
        kerb_run(a + (b - a) * t0, a + (b - a) * t1, reveal, side)
        t = t1
    kerb_run(a + (b - a) * t, b, kh, side)
    a, b = far
    side_f = 1 if (Vector((-(b - a).y, (b - a).x, 0))).dot(pc - (a + b) / 2) < 0 else -1
    kerb_run(a, b, kh, side_f)
    # the pavement: raised to the kerb top, ramped down to the crossings over RAMP metres
    pav = st.get("pavement")
    if pav:
        a, b = near
        u = (b - a).normalized()
        cross = []
        for poly in (acc.get("driveVerge"), acc.get("walkVerge")):
            if poly:
                ts = [(Vector((p[0], p[1], 0)) - a).dot(u) for p in poly]
                cross.append((min(ts), max(ts)))
        high, low = kh - 0.005, reveal - 0.004

        def lift(x, y):
            t = (Vector((x, y, 0)) - a).dot(u)
            dist = min([max(t0 - t, t - t1, 0.0) for t0, t1 in cross] or [1e9])
            f = max(0.0, min(1.0, dist / RAMP))
            return low + (high - low) * f * f * (3 - 2 * f)
        col.objects.link(surfaces.drape("street_pavement", pav, terrain, lift, surfaces.pavement_material(c3), max_edge=0.5))
        # edge stone on the garden side of the pavement (the pavement edge farther from the carriageway)
        pe = [Vector((*p, 0)) for p in pav]
        pedges = sorted([(pe[i], pe[(i + 1) % len(pe)]) for i in range(len(pe))], key=lambda e: -(e[1] - e[0]).length)[:2]
        mid_near = (near[0] + near[1]) / 2
        ga, gb = max(pedges, key=lambda e: _dist_line((e[0] + e[1]) / 2, near[0], near[1]))
        gside = 1 if (Vector((-(gb - ga).y, (gb - ga).x, 0))).dot(pc - (ga + gb) / 2) > 0 else -1
        L = (gb - ga).length
        k = max(1, int(L / 1.0))
        ew = 0.06
        for i in range(k):
            p0, p1 = ga + (gb - ga) * (i / k), ga + (gb - ga) * ((i + 1) / k)
            dd = (p1 - p0).normalized()
            nn = Vector((-dd.y, dd.x, 0)) * gside
            m = (p0 + p1) / 2 - nn * (ew / 2)
            g = terrain.z(m.x, m.y)
            top = lift(m.x, m.y)
            mb.box(Vector((m.x, m.y, g + (top - 0.12) / 2)), dd, nn, up, ((p1 - p0).length - 0.004, ew, top + 0.12), 0)
        del mid_near
    mb.object("kerbs", [kerb_mat], col)
    log("street: asphalt, pavement, kerbs with %d dropped kerbs" % len(spans))


def _dist_line(p, a, b):
    d = (b - a).normalized()
    q = p - a
    return abs(q.x * d.y - q.y * d.x)
