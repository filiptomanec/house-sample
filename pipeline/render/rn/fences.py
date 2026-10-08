"""The boundary (C3): one slat fence, the sliding drive gate, the walk gate and the technical pillar, built from the resolved
plot (`site.fences` with posts, slat spec and plinth; `site.gates` with posts, closed leaf, park span or swing arc;
`site.pillars` with size, footprint and items). Nothing is typed in per fence or gate: dimensions are data, the product details
the model does not give (frame profile, carriage) are in `config.json` `siteParts`.

* Fence: a graphite precast plinth, graphite steel posts and horizontal light timber slats between them (one shared slat
  builder `slat_rows`, used by the fence bays and both gate leaves). Each bay stands on the ground under its middle.
* Sliding gate: a cantilever leaf (graphite frame, the same slats) with its counterweight tail and a ground beam, on two
  carriages behind the park-side post. Per shot it opens by `gates[access]` x leaf width towards its park span.
* Walk gate: a framed slat leaf on its hinge post with a lever handle; per shot it swings by `gates[access]` along its arc.
* Pillar: graphite concrete with a steel cap; on the street face the items of the data from the bottom up (meter-box door,
  mailbox, intercom, backlit house-number plate); the pillar light is a lamp (lights.py).
Everything is real geometry (a few ten thousand triangles), so close cameras see real slats.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .util import hex_to_linear, log


# ------------------------------------------------------------------ mesh helpers
class MeshBuilder:
    """Collects boxes (8 vertices, 6 quads) with box UVs (metres / tile) and builds one mesh with material slots."""

    def __init__(self):
        self.v, self.f, self.uv, self.mi = [], [], [], []

    def box(self, center, ax, ay, az, size, mat=0, tile=1.0):
        c = Vector(center)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        pts = []
        for sz in (-1, 1):
            for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pts.append(c + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz))
        quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        i0 = len(self.v)
        self.v.extend(pts)
        for q in quads:
            self.f.append(tuple(i0 + j for j in q))
            self.mi.append(mat)
            # box mapping: the two largest extents of the face
            fp = [pts[j] for j in q]
            e1, e2 = fp[1] - fp[0], fp[3] - fp[0]
            u_ax = e1.normalized() if e1.length > 1e-9 else Vector((1, 0, 0))
            v_ax = e2.normalized() if e2.length > 1e-9 else Vector((0, 0, 1))
            self.uv.append([((p - fp[0]).dot(u_ax) / tile, (p - fp[0]).dot(v_ax) / tile) for p in fp])

    def quad(self, pts, mat=0):
        i0 = len(self.v)
        self.v.extend(Vector(p) for p in pts)
        self.f.append(tuple(range(i0, i0 + len(pts))))
        self.mi.append(mat)
        self.uv.append([(0, 0), (1, 0), (1, 1), (0, 1)][:len(pts)])

    def object(self, name, materials, collection):
        import bpy
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        for m in materials:
            me.materials.append(m)
        uvl = me.uv_layers.new(name="UVMap")
        for poly, uvs, mi in zip(me.polygons, self.uv, self.mi):
            poly.material_index = mi
            for li, loop in enumerate(poly.loop_indices):
                uvl.data[loop].uv = uvs[li]
        me.update()
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


def slat_rows(mb, a, b, z_bottom, z_top, slat, offset=Vector((0, 0, 0)), mat=0, tile=1.8):
    """Horizontal (or vertical) timber slats between the points a and b (plan, z ignored) filling z_bottom..z_top, aligned to
    the top: `slat` = {orient, board, gap, depth}. The one slat builder of the fence and the gates."""
    d = Vector((b.x - a.x, b.y - a.y, 0))
    L = d.length
    if L < 0.02 or z_top - z_bottom < 0.02:
        return 0
    d.normalize()
    nrm = Vector((-d.y, d.x, 0))
    up = Vector((0, 0, 1))
    board, gap, depth = float(slat["board"]), float(slat["gap"]), float(slat["depth"])
    mid = (Vector((a.x, a.y, 0)) + Vector((b.x, b.y, 0))) / 2 + offset
    n = 0
    if slat.get("orient", "h") == "v":
        k = int((L + gap) // (board + gap))
        x0 = -((k * (board + gap) - gap) / 2) + board / 2
        for i in range(k):
            c = mid + d * (x0 + i * (board + gap))
            c.z = (z_bottom + z_top) / 2
            mb.box(c, d, nrm, up, (board, depth, z_top - z_bottom), mat, tile)
            n += 1
        return n
    z = z_top
    while z - board >= z_bottom - 1e-6:
        c = mid.copy()
        c.z = z - board / 2
        mb.box(c, d, nrm, up, (L, depth, board), mat, tile)
        z -= board + gap
        n += 1
    return n


def _material(name, hex_color, rough=0.5, metal=0.0):
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    return m


def _materials(scn):
    """(wood, steel, plinth, dark, stainless, acrylic) from the style roles of the plot (C3 `fence_wood`, `fence_post`,
    `fence_plinth`); the timber reuses the textured house cladding material when the colours agree."""
    from . import surfaces
    c3 = scn.c3
    hbcfg = scn.house["cfg"]
    wood = surfaces.role_material("wood_cladding", hbcfg)
    if c3.color("fence_wood").lower() != c3.color("wood_cladding").lower():
        wood = _material("fence_wood", c3.color("fence_wood"), float(c3.material_spec("fence_wood").get("roughness", 0.7)))
    steel = surfaces.steel_material(c3, "fence_steel", "fence_post")
    plinth = surfaces.role_material("slab", hbcfg)
    if c3.color("fence_plinth").lower() != c3.color("slab").lower():
        plinth = _material("fence_plinth", c3.color("fence_plinth"), 0.85)
    dark = _material("site_dark", "#16181a", 0.6)
    stainless = _material("site_stainless", "#b9bcbd", 0.28, 1.0)
    acrylic = bpy_acrylic()
    return wood, steel, plinth, dark, stainless, acrylic


def bpy_acrylic():
    """Opal acrylic of the backlit house number: translucent, lit from behind by its lamp."""
    import bpy
    m = bpy.data.materials.get("site_opal")
    if m is not None:
        return m
    m = bpy.data.materials.new("site_opal")
    m.use_nodes = True
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    bs = nt.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (0.92, 0.92, 0.9, 1)
    bs.inputs["Roughness"].default_value = 0.3
    tl = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = (0.95, 0.93, 0.88, 1)
    mx = nt.nodes.new("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.7
    nt.links.new(bs.outputs[0], mx.inputs[1])
    nt.links.new(tl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


# ------------------------------------------------------------------ fence
def _bays(part, posts, tol=0.04):
    """Bays of a fence part: (a, b, post_at_a, post_at_b) between the vertices of the polyline and the posts on it."""
    out = []
    for i in range(len(part) - 1):
        a, b = Vector((*part[i], 0)), Vector((*part[i + 1], 0))
        d = b - a
        L = d.length
        if L < 1e-6:
            continue
        u = d / L
        ts = []
        for p in posts:
            q = Vector((p[0], p[1], 0)) - a
            t = q.dot(u)
            if -tol <= t <= L + tol and abs(q.cross(u).z) < tol:
                ts.append(min(max(t, 0.0), L))
        pts = sorted(set([0.0, L] + [round(t, 4) for t in ts]))
        on_post = lambda t: any(abs(t - s) < tol for s in ts)  # noqa: E731
        for k in range(len(pts) - 1):
            t0, t1 = pts[k], pts[k + 1]
            if t1 - t0 < 0.05:
                continue
            out.append((a + u * t0, a + u * t1, on_post(t0) or (k == 0 and i > 0), on_post(t1) or (k == len(pts) - 2 and i < len(part) - 2)))
    return out


def build_fence(scn, terrain, col, mats):
    wood, steel, plinth_m = mats[0], mats[1], mats[2]
    sp = scn.cfg["siteParts"]["fence"]
    up = Vector((0, 0, 1))
    n_bays = 0
    for fi, f in enumerate(scn.c3.fences()):
        slat = f.get("slat") or {"orient": "h", "board": 0.09, "gap": 0.015, "depth": 0.02}
        h = float(f["height"])
        ph = float(f.get("plinthHeight") or 0.0)
        ps = float(f.get("postSize") or 0.06)
        th = float(f.get("thickness") or 0.05)
        posts = [(p["x"], p["y"]) for p in (f.get("posts") or [])]
        mb = MeshBuilder()
        for pi, part in enumerate(f["parts"]):
            for a, b, pa, pb in _bays(part, posts):
                d = (b - a).normalized()
                nrm = Vector((-d.y, d.x, 0))
                a2 = a + d * (ps / 2 + sp["slatInsetFromPost"] if pa else 0.0)
                b2 = b - d * (ps / 2 + sp["slatInsetFromPost"] if pb else 0.0)
                mid = (a2 + b2) / 2
                g = terrain.z(mid.x, mid.y)
                L = (b2 - a2).length
                if L < 0.03:
                    continue
                if ph > 0:
                    c = Vector((mid.x, mid.y, g + (ph - sp["plinthBelow"]) / 2))
                    mb.box(c, d, nrm, up, (L, max(th, 0.05), ph + sp["plinthBelow"]), 2, 1.0)
                slat_rows(mb, a2, b2, g + ph + float(slat["gap"]), g + h, slat, mat=0)
                n_bays += 1
        for (x, y) in posts:
            g = terrain.z(x, y)
            top = g + h + sp["postCap"]
            # the post faces follow the fence direction at the post: use the nearest part segment
            d = _dir_at(f["parts"], x, y)
            nrm = Vector((-d.y, d.x, 0))
            mb.box(Vector((x, y, (g - 0.1 + top) / 2)), d, nrm, up, (ps, ps, top - g + 0.1), 1, 1.0)
        mb.object("fence_%d" % fi, [wood, steel, plinth_m], col)
    return n_bays


def _dir_at(parts, x, y):
    best, bd = Vector((1, 0, 0)), 1e9
    p = Vector((x, y, 0))
    for part in parts:
        for i in range(len(part) - 1):
            a, b = Vector((*part[i], 0)), Vector((*part[i + 1], 0))
            ab = b - a
            if ab.length < 1e-9:
                continue
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            dist = (a + ab * t - p).length
            if dist < bd:
                bd, best = dist, ab.normalized()
    return best


# ------------------------------------------------------------------ gates
class SlidingGate:
    """Cantilever sliding gate: the leaf object moves along its park direction by `open` x leaf width."""

    def __init__(self, g, scn, terrain, col, mats, slat):
        wood, steel, _, dark = mats[0], mats[1], mats[2], mats[3]
        gp = scn.cfg["siteParts"]["gate"]
        self.access = g.get("access")
        poly = [Vector((p[0], p[1], 0)) for p in g["leafPolygon"]]
        park = g["park"]
        u = Vector((park["to"][0] - park["from"][0], park["to"][1] - park["from"][1], 0)).normalized()
        v = Vector((-u.y, u.x, 0))
        c = sum(poly, Vector()) / len(poly)
        s = [(p - c).dot(u) for p in poly]
        w = [(p - c).dot(v) for p in poly]
        s0, s1 = min(s), max(s)
        mid_v = (min(w) + max(w)) / 2
        origin = c + u * s0 + v * mid_v                    # closed: the leaf end at the far post, on the leaf centre line
        self.u, self.leaf = u, float(g["leaf"])
        z0 = float(g["z"])
        h = float(g["height"])
        fr, beam, clr = gp["frame"], gp["beam"], gp["clearance"]
        total = s1 - s0
        leaf = self.leaf
        up = Vector((0, 0, 1))
        X, Y = Vector((1, 0, 0)), Vector((0, 1, 0))
        mb = MeshBuilder()
        th = float(g.get("thickness") or 0.06)
        # local frame: x along u from the leaf end, y across, z up from the ground at the gate
        # ground beam over the whole length (leaf + tail)
        mb.box(Vector((total / 2, 0, clr + beam / 2)), X, Y, up, (total, th, beam), 1)
        # leaf frame: two verticals, top rail
        for x in (fr / 2, leaf - fr / 2):
            mb.box(Vector((x, 0, (clr + h) / 2)), X, Y, up, (fr, th, h - clr), 1)
        mb.box(Vector((leaf / 2, 0, h - fr / 2)), X, Y, up, (leaf, th, fr), 1)
        # infill: the slats of the fence, inside the frame
        slat_rows(mb, Vector((fr, 0, 0)), Vector((leaf - fr, 0, 0)), clr + beam, h - fr, slat, mat=0)
        # counterweight tail: top rail falling to the beam end (a diagonal) and a short end post
        tail = total - leaf
        if tail > 0.2:
            a = Vector((leaf, 0, h - fr / 2))
            b = Vector((total - fr / 2, 0, clr + beam + 0.25))
            dv = b - a
            ax = dv.normalized()
            az = ax.cross(Y).normalized()
            mb.box((a + b) / 2, ax, Y, az, (dv.length, th * 0.8, fr), 1)
            mb.box(Vector((total - fr / 2, 0, clr + beam + 0.125)), X, Y, up, (fr, th, 0.25), 1)
        self.ob = mb.object("gate_sliding", [wood, steel], col)
        self.base = Matrix.Translation((origin.x, origin.y, z0)) @ Matrix(((u.x, v.x, 0, 0), (u.y, v.y, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
        self.ob.matrix_world = self.base
        # fixed parts: two carriages under the beam behind the park-side end of the opening, a catcher at the far post
        fx = MeshBuilder()
        car = gp["carriage"]
        for k in (0.35, 0.35 + max(1.0, tail - 0.6)):
            p = origin + u * (leaf + k)
            fx.box(Vector((p.x, p.y, z0 + car[2] / 2 - 0.02)), u, v, up, (car[0], car[1], car[2]), 0)
        fx.object("gate_carriages", [dark], col)
        self.state = None

    def apply(self, state, shot):
        t = state["gates"].get(self.access, 0.0)
        if t == self.state:
            return
        self.state = t
        self.ob.matrix_world = Matrix.Translation(self.u * (self.leaf * t)) @ self.base


class SwingGate:
    """Walk gate on its hinge post: rotates by `open` x the angle of its swing arc."""

    def __init__(self, g, scn, terrain, col, mats, slat):
        wood, steel, dark, stainless = mats[0], mats[1], mats[3], mats[4]
        gp = scn.cfg["siteParts"]["gate"]
        self.access = g.get("access")
        sw = g["swing"]
        hinge = Vector((*sw["hinge"], 0))
        ce = Vector((*sw["closedEnd"], 0)) - hinge
        oe = Vector((*sw["openEnd"], 0)) - hinge
        self.angle = math.atan2(ce.x * oe.y - ce.y * oe.x, ce.dot(oe))
        u = ce.normalized()
        v = Vector((-u.y, u.x, 0))
        leaf = ce.length
        z0 = float(g["z"])
        h = float(g["height"])
        th = float(g.get("thickness") or 0.06)
        fr, clr = gp["frame"], gp["clearance"]
        X, Y, up = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
        mb = MeshBuilder()
        for x in (fr / 2, leaf - fr / 2):
            mb.box(Vector((x, 0, (clr + h) / 2)), X, Y, up, (fr, th, h - clr), 1)
        for z in (clr + fr / 2, h - fr / 2):
            mb.box(Vector((leaf / 2, 0, z)), X, Y, up, (leaf, th, fr), 1)
        slat_rows(mb, Vector((fr, 0, 0)), Vector((leaf - fr, 0, 0)), clr + fr, h - fr, slat, mat=0)
        # lock box and lever handles on both faces at the free end
        hz = gp["handleHeight"]
        mb.box(Vector((leaf - fr - 0.06, 0, hz)), X, Y, up, (0.1, th + 0.02, 0.2), 2)
        for side in (-1, 1):
            mb.box(Vector((leaf - fr - 0.12, side * (th / 2 + 0.035), hz + 0.03)), X, Y, up, (0.13, 0.02, 0.02), 3)
        self.ob = mb.object("gate_swing", [wood, steel, dark, stainless], col)
        self.base = Matrix.Translation((hinge.x, hinge.y, z0)) @ Matrix(((u.x, v.x, 0, 0), (u.y, v.y, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
        self.ob.matrix_world = self.base
        self.state = None

    def apply(self, state, shot):
        t = state["gates"].get(self.access, 0.0)
        if t == self.state:
            return
        self.state = t
        self.ob.matrix_world = self.base @ Matrix.Rotation(self.angle * t, 4, "Z")


def build_gate_posts(g, terrain, col_builder, h_extra=0.05):
    up = Vector((0, 0, 1))
    al = Vector((*g["along"], 0)).normalized()
    nrm = Vector((-al.y, al.x, 0))
    ps = float(g.get("postSize") or 0.1)
    for p in g.get("posts") or []:
        z = float(p.get("z", terrain.z(p["x"], p["y"])))
        top = z + float(g["height"]) + h_extra
        col_builder.box(Vector((p["x"], p["y"], (z - 0.15 + top) / 2)), al, nrm, up, (ps, ps, top - z + 0.15), 0)


# ------------------------------------------------------------------ pillar
def build_pillar(pl, scn, col, mats):
    wood, steel, plinth_m, dark, stainless, opal = mats
    pp = scn.cfg["siteParts"]["pillar"]
    al = Vector((*pl["along"], 0)).normalized()
    inw = Vector((*pl["inward"], 0)).normalized()
    up = Vector((0, 0, 1))
    w, dpt, h = (float(x) for x in pl["size"])
    z0 = float(pl["z"])
    c = Vector((*pl["center"], 0))
    mb = MeshBuilder()
    mb.box(Vector((c.x, c.y, z0 + (h - 0.1) / 2)), al, inw, up, (w, dpt, h + 0.1), 0, 1.2)
    cap = pp["cap"]
    mb.box(Vector((c.x, c.y, z0 + h + cap / 2)), al, inw, up, (w + 0.04, dpt + 0.04, cap), 1)
    face = c - inw * (dpt / 2)                       # the street face
    out = -inw
    for item in pl.get("items") or []:
        spec = pp["items"].get(item)
        if not spec:
            continue
        iw, ih = min(float(spec["w"]), w - 0.08), float(spec["h"])
        zc = z0 + float(spec["zf"]) * h + ih / 2
        if item == "meter-box":
            # a flush door with a shadow gap and a lock
            for (cx, cz, sw_, sh_) in ((0, ih / 2, iw, 0.008), (0, -ih / 2, iw, 0.008), (iw / 2, 0, 0.008, ih), (-iw / 2, 0, 0.008, ih)):
                p = face + al * cx + out * 0.001
                mb.box(Vector((p.x, p.y, zc + cz)), al, inw, up, (sw_, 0.004, sh_), 3)
            p = face + al * (iw / 2 - 0.06) + out * 0.006
            mb.box(Vector((p.x, p.y, zc)), al, inw, up, (0.03, 0.012, 0.03), 4)
        elif item == "mailbox":
            d = float(spec.get("d", 0.03))
            p = face + out * (d / 2)
            mb.box(Vector((p.x, p.y, zc)), al, inw, up, (iw, d, ih), 1)
            p2 = face + out * (d + 0.0005)
            mb.box(Vector((p2.x, p2.y, zc + ih * 0.3)), al, inw, up, (iw * 0.7, 0.002, 0.025), 3)
        elif item == "intercom":
            p = face + out * 0.006
            mb.box(Vector((p.x, p.y, zc)), al, inw, up, (iw, 0.012, ih), 4)
            p2 = face + out * 0.0125
            mb.box(Vector((p2.x, p2.y, zc - ih * 0.2)), al, inw, up, (0.03, 0.003, 0.03), 3)
            mb.box(Vector((p2.x, p2.y, zc + ih * 0.28)), al, inw, up, (0.02, 0.003, 0.02), 3)
        elif item == "house-number":
            p = face + out * 0.006
            mb.box(Vector((p.x, p.y, zc)), al, inw, up, (iw, 0.012, ih), 5)
    mb.object("pillar", [plinth_m, steel, wood, dark, stainless, opal], col)


# ------------------------------------------------------------------ all
def build(scn, terrain):
    import bpy
    col = bpy.data.collections.new("boundary")
    bpy.context.scene.collection.children.link(col)
    mats = _materials(scn)
    n_bays = build_fence(scn, terrain, col, mats)
    fences = scn.c3.fences()
    slat = (fences[0].get("slat") if fences else None) or {"orient": "h", "board": 0.09, "gap": 0.015, "depth": 0.02}
    posts = MeshBuilder()
    gates = []
    for g in scn.c3.gates():
        build_gate_posts(g, terrain, posts)
        if g.get("kind") == "sliding" and g.get("park") and g.get("leafPolygon"):
            gates.append(SlidingGate(g, scn, terrain, col, mats, slat))
        elif g.get("swing"):
            gates.append(SwingGate(g, scn, terrain, col, mats, slat))
    if posts.v:
        posts.object("gate_posts", [mats[1]], col)
    for pl in scn.c3.pillars():
        build_pillar(pl, scn, col, mats)
    scn.movables.extend(gates)
    log("boundary: fence with %d bays, %d gates, %d pillars" % (n_bays, len(gates), len(scn.c3.pillars())))
