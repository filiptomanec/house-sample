"""Vegetation of the render. Everything stands on the terrain mesh (ray cast) and uses its own seeded random numbers, so
adding one plant never moves another. Species map to models by the `form` hint of render.json (`vegetation.species`):

| form | model |
|---|---|
| broadleaf-round, broadleaf-oval, orchard-* | the scanned tree `tree_small_02`: rotated copies on one trunk (`trees.forms[form].copies`), the crown widened by `spread`, a trunk sized from the height (`trunkScale`): the walnut reads as a broad, dense crown on a thick short trunk |
| shrub-round (hydrangea) | procedural (herbs.py): arching stems with opposite leaves and cream panicles (`shrubs.hydrangea`) |
| perennial-mound (lavender) | procedural (herbs.py): a grey-green needle dome with `shrubs.lavenderSpikes` flower spikes |
| grass-tuft (miscanthus) | procedural (herbs.py): a fountain of arching leaves with plumes (`shrubs.miscanthus`) |
| topiary-ball | a clipped ball with a small-leaf shader |

Mulch beds get a planting mix scattered over them (`shrubs.bedPlanting`: perennials `shrub_03`, `shrub_04`, `shrub_01`, ground
cover, grasses). The country around the plot is built from hedgerows along invented field roads (trees with field shrubs,
`shrub_02`, between them), woodlots and a far village edge (`landscape`), not from solitary trees in open fields; the neighbour
gardens get a few trees.
"""
from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

from . import leafy, plants
from .lawn import exclusion_mesh, make_patches, scatter
from .terrain import _pip
from .util import hex_to_linear, log, rng

TREE_MODEL = "tree_small_02"
REF_GREEN = "#6a8b45"


def _shade(hex_color, f):
    c = hex_color.lstrip("#")
    return "#" + "".join("%02x" % max(0, min(255, int(int(c[i:i + 2], 16) * f))) for i in (0, 2, 4))


def _flat_material(name, hex_color, rough=0.8, bump=0.0, scale=40.0, var=0.0):
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes.get("Principled BSDF")
    col = hex_to_linear(hex_color)
    bs.inputs["Base Color"].default_value = (*col, 1)
    bs.inputs["Roughness"].default_value = rough
    if var > 0 or bump > 0:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        if var > 0:
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].color = (*[c * (1 - var) for c in col], 1)
            ramp.color_ramp.elements[1].color = (*[min(1.0, c * (1 + var)) for c in col], 1)
            nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        if bump > 0:
            bu = nt.nodes.new("ShaderNodeBump")
            bu.inputs["Strength"].default_value = bump
            nt.links.new(nz.outputs["Fac"], bu.inputs["Height"])
            nt.links.new(bu.outputs[0], bs.inputs["Normal"])
    return m


def bark_material(hex_color):
    """Bark: the trunk texture of the scanned tree (CC0, ASSETS.md) for its detail, desaturated and tinted to the style `bark`
    colour; a flat noise material without the asset."""
    import glob
    import os
    import bpy
    from .ground_materials import ASSETS
    d = os.path.join(ASSETS, "models", TREE_MODEL, "textures")
    diff = glob.glob(os.path.join(d, TREE_MODEL + "_diff_*.jpg"))
    if not diff:
        return _flat_material("bark", hex_color, 0.9, 0.6, 18.0, 0.18)
    m = bpy.data.materials.new("bark")
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bs = N.get("Principled BSDF")
    uv = N.new("ShaderNodeUVMap")
    tx = N.new("ShaderNodeTexImage")
    tx.image = bpy.data.images.load(diff[0], check_existing=True)
    L.new(uv.outputs[0], tx.inputs[0])
    # tint: the texture's mean grey maps to the style colour
    sm = tx.image.copy()
    sm.scale(8, 8)
    px = list(sm.pixels[:])
    bpy.data.images.remove(sm)
    lin = [((v + 0.055) / 1.055) ** 2.4 for i, v in enumerate(px) if i % 4 != 3]
    level = max(sum(lin) / len(lin), 1e-3)
    target = hex_to_linear(hex_color)
    hs = N.new("ShaderNodeHueSaturation")
    hs.inputs["Saturation"].default_value = 0.35
    L.new(tx.outputs["Color"], hs.inputs["Color"])
    mx = N.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    mx.inputs[7].default_value = (*[min(4.0, c / level) for c in target], 1.0)
    L.new(hs.outputs[0], mx.inputs[6])
    L.new(mx.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.88
    nor = glob.glob(os.path.join(d, TREE_MODEL + "_nor_gl_*.jpg"))
    if nor:
        tn = N.new("ShaderNodeTexImage")
        tn.image = bpy.data.images.load(nor[0], check_existing=True)
        tn.image.colorspace_settings.name = "Non-Color"
        L.new(uv.outputs[0], tn.inputs[0])
        nm = N.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 1.4
        L.new(tn.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs[0], bs.inputs["Normal"])
    return m


class Vegetation:
    def __init__(self, scn, terrain):
        import bpy
        self.scn, self.t = scn, terrain
        self.inputs, self.cfg = scn.inputs, scn.cfg
        self.c3 = scn.c3
        self.col = bpy.data.collections.new("vegetation")
        bpy.context.scene.collection.children.link(self.col)
        self._species = {}
        self._mats = {}
        plants._KEEP[TREE_MODEL] = float(self.cfg["trees"]["keep"][scn.mode])
        self.stats = plants.model_stats(TREE_MODEL)

    # ------------------------------------------------------------------ helpers
    def _link(self, ob):
        self.col.objects.link(ob)
        return ob

    def _mat(self, key, factory):
        if key not in self._mats:
            self._mats[key] = factory()
        return self._mats[key]

    TONES = {"conifer": "#2f4d3a", "dark": "#4f7a30", "mid": "#6a9442", "light": "#86a95a"}

    def _tone(self, leaf):
        """The species colour of the data, reduced to the nearest leaf tone (every tone is one material: the mesh is shared,
        which keeps memory and render time low; an instance varies a little by its random value)."""
        c = hex_to_linear(leaf)
        return min(self.TONES, key=lambda k: sum((a - b) ** 2 for a, b in zip(hex_to_linear(self.TONES[k]), c)))

    def _tree_collection(self, leaf, copies):
        tone = self._tone(leaf)
        key = (tone, copies)
        if key not in self._species:
            cp = [(0.0, 1.0, 0.0, 0.0), (120.0, 0.94, 0.0, 0.0), (-120.0, 0.9, 0.0, 0.0), (60.0, 0.86, 0.0, 0.0)][:copies]
            self._species[key] = plants.species_collection(TREE_MODEL, tone, plants.leaf_tint(self.TONES[tone], REF_GREEN),
                                                           "tree", copies=cp, cutout=False, vary=0.5)
        return self._species[key]

    def _bark(self):
        return self._mat("bark", lambda: bark_material(self.c3.color("bark", "#5a4e44")))

    # ------------------------------------------------------------------ trees of the plot
    def trees(self):
        for tr in self.c3.trees():
            self._tree(tr)

    def _tree(self, tr):
        form = tr.get("form", "broadleaf-round")
        fs = self.cfg["trees"]["forms"].get(form, {"copies": 2, "spread": 1.0, "trunkScale": 1.0})
        st = self.stats
        copies = min(int(fs["copies"]), int(self.cfg["trees"]["copies"][self.scn.mode]))
        col = self._tree_collection(tr["leaf"], copies)
        r = rng("tree", tr["seed"])
        fit = float(self.cfg["trees"]["crownFit"])
        sxy = tr["crown"] / st["crown"] * tr.get("scale", 1.0) * fit * float(fs["spread"])
        sz = tr["height"] / st["height"] * tr.get("scale", 1.0)
        if form.startswith("orchard"):
            sz = max(sz, 0.5 * sxy)
        g = self.t.z(tr["x"], tr["y"], tr["z"])
        loc = (tr["x"], tr["y"], g - 0.05)
        yaw = tr.get("yawDeg", r.uniform(0, 360))
        c = self.inputs["house"]["center"]
        if math.hypot(tr["x"] - c[0], tr["y"] - c[1]) < 22.0:
            # the scanned crown leans to one side: turn it away from the house, so that it does not cover the facade
            away = math.degrees(math.atan2(tr["y"] - c[1], tr["x"] - c[0]))
            lean = math.degrees(math.atan2(st["cy"], st["cx"]))
            yaw = away - lean + r.uniform(-25, 25)
        self._link(plants.instance(col, loc, (sxy, sxy, sz), yaw, "tree_%s" % tr["species"]))
        # crown clusters: smaller copies of the same tree whose foliage sits on a shell inside the crown (their trunks are
        # hidden in it): the thinned scanned crown alone is see-through, a walnut or an apple is dense
        n_cl = int(fs.get("clusters") or 0)
        if n_cl:
            cb = float(tr.get("crownBase") or tr["height"] * 0.3)
            hc = tr["height"] - cb
            k = float(fs.get("clusterScale", 0.5))
            csx, csz = sxy * k, sz * k
            fz = (st["z0"] + st["z1"]) / 2 * csz                  # height of the middle of a copy's foliage above its base
            col_f = self._foliage_collection(tr["leaf"])
            for i in range(n_cl):
                a = 2 * math.pi * (i + r.uniform(-0.3, 0.3)) / n_cl
                rr = tr["crown"] / 2 * r.uniform(0.35, 0.6)
                zc = g + cb + hc * r.uniform(0.35, 0.72)
                x, y = tr["x"] + math.cos(a) * rr, tr["y"] + math.sin(a) * rr
                self._link(plants.instance(col_f, (x, y, zc - fz), (csx, csx, csz), r.uniform(0, 360), "tree_cluster"))
        # a trunk sized from the tree (about 4.5 % of the height, times the form factor), up into the crown, where a big
        # tree forks into a few limbs that spread into the crown (a walnut: a short thick bole and broad scaffold limbs)
        d = tr["height"] * 0.045 * float(fs["trunkScale"])
        cb = float(tr.get("crownBase") or tr["height"] * 0.3)
        h = cb * 1.25
        if d > 0.12:
            self._link(self._trunk("trunk_%s" % tr["species"], (tr["x"], tr["y"], g - 0.1), d, h + 0.1, r))
            n_limbs = int(fs.get("limbs") or 0)
            for k in range(n_limbs):
                a = 2 * math.pi * (k + r.uniform(-0.25, 0.25)) / n_limbs
                tilt = math.radians(r.uniform(28, 42))
                L = tr["crown"] * 0.5 * r.uniform(0.55, 0.75) / math.sin(tilt + 0.35)
                base = (tr["x"], tr["y"], g + cb * r.uniform(0.85, 1.0))
                axis = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
                self._link(self._trunk("limb_%s_%d" % (tr["species"], k), base, d * 0.55, L, r, axis=axis))

    def _trunk(self, name, base, d, h, r, axis=None):
        """A bark-textured tapered tube of diameter `d` and length `h` from `base` along `axis` (default up), with a root
        flare at the ground and a slightly irregular section; UVs in metres of bark (u around, v along)."""
        import bpy
        axis = (axis or Vector((0.0, 0.0, 1.0))).normalized()
        side = axis.cross(Vector((0.0, 0.0, 1.0)))
        side = side.normalized() if side.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        fwd = axis.cross(side).normalized()
        segs, rings = 14, 8
        verts, faces, uvs = [], [], []
        circ = math.pi * d
        flare = axis.z > 0.99
        wob = [r.uniform(-1, 1) for _ in range(6)]
        for k in range(rings + 1):
            t = k / rings
            rad = d / 2 * (1.0 - 0.35 * t)
            if flare:
                rad *= 1.0 + 0.45 * math.exp(-t * h / max(d * 0.9, 0.05))       # buttress-like flare above the ground
            bend = Vector((wob[0], wob[1], 0.0)) * 0.03 * h * t * t
            c = Vector(base) + axis * (h * t) + bend
            for j in range(segs + 1):
                a = 2 * math.pi * j / segs
                irr = 1 + 0.07 * math.sin(3 * a + wob[2] * 3 + t * 2) + 0.04 * math.cos(5 * a + wob[3] * 3)
                p = c + (side * math.cos(a) + fwd * math.sin(a)) * rad * irr
                verts.append(tuple(p))
                uvs.append((j / segs * circ / 0.5, h * t / 0.5))
        for k in range(rings):
            for j in range(segs):
                a0 = k * (segs + 1) + j
                faces.append((a0, a0 + 1, a0 + segs + 2, a0 + segs + 1))
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            poly.use_smooth = True
            for li, vi in zip(poly.loop_indices, poly.vertices):
                uvl.data[li].uv = uvs[vi]
        me.update()
        me.materials.append(self._bark())
        return bpy.data.objects.new(name, me)

    def _foliage_collection(self, leaf):
        """The tree model reduced to its leaves (crown clusters inside a crown must not show trunks or branch stubs)."""
        tone = self._tone(leaf)
        key = ("foliage", tone)
        if key not in self._species:
            self._species[key] = plants.species_collection(TREE_MODEL, tone, plants.leaf_tint(self.TONES[tone], REF_GREEN),
                                                           "foliage", cutout=False, vary=0.5, leaves_only=True)
        return self._species[key]

    # ------------------------------------------------------------------ shrubs
    def shrubs(self):
        for s in self.inputs["vegetation"]["shrubs"]:
            form = s.get("form")
            if form == "grass-tuft":
                self._grass(s)
            elif form == "topiary-ball":
                self._ball(s, s["leaf"], dark=0.45, scale=36.0)
            elif form == "shrub-round":
                self._hydrangea(s)
            else:
                self._lavender(s)

    def _ball(self, s, leaf, flower=None, dark=0.45, scale=14.0, amp=0.06, squash=None):
        w = s["width"]
        sq = squash if squash is not None else min(1.4, s["height"] / (w * 0.5))
        key = ("ball", s["species"], leaf)
        mat = self._mat(key, lambda: leafy.leaf_material("leaf_%s" % s["species"], leaf, dark=dark, scale=scale, flower=flower,
                                                         bump=0.9, ao=0.5))
        ob = leafy.ball("%s_%s" % (s["species"], s["seed"]), w * 0.5, mat, s["seed"] % 1000, squash=sq, subdiv=5, amp=amp)
        ob.location = (s["x"], s["y"], self.t.z(s["x"], s["y"], s["z"]) - 0.04)
        ob.rotation_euler = (0, 0, math.radians(s.get("yawDeg", 0)))
        return self._link(ob)

    def _shrub_model(self, species, leaf, model="shrub_02", value=1.0):
        key = ("shrub", model, species)
        if key not in self._species:
            objs = plants.load_model(model)
            col = plants.species_collection(model, species, plants.leaf_tint(leaf, REF_GREEN), "shrub", cutout=True, vary=0.3,
                                            value=value)
            self._species[key] = (col, objs)
        return self._species[key]

    def _place_variant(self, s, model, leaf, r, height=None, width=None):
        """One object of a multi-variant model, scaled to the data and standing on the ground at the shrub."""
        import bpy
        col, objs = self._shrub_model(s["species"], leaf, model)
        lib = list(col.objects)
        src = lib[r.randrange(len(lib))]
        lo, hi = plants.bounds(src)
        w0 = max(hi[0] - lo[0], hi[1] - lo[1], 0.05)
        h0 = max(hi[2] - lo[2], 0.05)
        sw = (width or s["width"]) / w0
        sh = (height or s["height"]) / h0
        o = src.copy()
        cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
        yaw = math.radians(s.get("yawDeg", r.uniform(0, 360)))
        o.rotation_euler = (0, 0, yaw)
        o.scale = (sw, sw, sh)
        # the variant's own centre is off the origin: move it under the shrub point
        off = Vector((cx * sw, cy * sw, 0.0))
        off.rotate(o.rotation_euler)
        g = self.t.z(s["x"], s["y"], s["z"])
        o.location = (s["x"] - off.x, s["y"] - off.y, g - 0.03)
        self._link(o)
        del bpy
        return o

    def _hydrangea(self, s):
        """Panicle hydrangea (herbs.hydrangea): arching stems, opposite leaves, cream panicles; colours from the data."""
        from . import herbs
        leaf = s["leaf"]
        flower = s.get("flower", "#e8e6dc")
        lm = self._mat(("hyd_leaf", leaf), lambda: herbs.herb_material("hydrangea_leaf", herbs.shade(leaf, 0.7),
                                                                       herbs.shade(leaf, 1.05), 0.3, 0.55, 0.25))
        sm = self._mat(("hyd_stem", leaf), lambda: herbs.herb_material("hydrangea_stem", herbs.shade(leaf, 0.55, 0.6),
                                                                       herbs.shade(leaf, 0.75, 0.6), 0.1, 0.7))
        pm = self._mat(("panicle", flower), lambda: herbs.panicle_material("hydrangea_panicle", flower, leaf))
        z = self.t.z(s["x"], s["y"], s["z"])
        for ob in herbs.hydrangea("hydrangea_%s" % s["seed"], s, z, self.cfg, lm, pm, sm):
            self._link(ob)

    def _lavender(self, s):
        """Needle dome with flower spikes (herbs.lavender), colours from the data (`leaf`, `flower`)."""
        from . import herbs
        leaf = s["leaf"]
        flower = s.get("flower", "#8d78b5")
        lm = self._mat(("lav_leaf", leaf), lambda: herbs.herb_material("lavender_leaf", herbs.shade(leaf, 0.45, 0.8),
                                                                       herbs.shade(leaf, 1.15, 0.85), 0.2, 0.7))
        sm = self._mat(("lav_stem", leaf), lambda: herbs.herb_material("lavender_stem", herbs.shade(leaf, 0.6),
                                                                       herbs.shade(leaf, 0.9), 0.25, 0.7))
        fm = self._mat(("spike", flower), lambda: leafy.leaf_material("lavender_flower", flower, dark=0.6, light=1.08,
                                                                      scale=220.0, bump=1.0))
        z = self.t.z(s["x"], s["y"], s["z"])
        for ob in herbs.lavender("lavender_%s" % s["seed"], s, z, self.cfg, lm, fm, sm):
            self._link(ob)

    def _grass(self, s):
        """Miscanthus: a fountain of arching leaves with plumes (herbs.miscanthus), colours from the data and the config."""
        from . import herbs
        leaf = s["leaf"]
        plume = s.get("flower") or self.cfg["shrubs"]["miscanthus"]["plumeColor"]
        lm = self._mat(("misc_leaf", leaf), lambda: herbs.herb_material("miscanthus_leaf", herbs.shade(leaf, 0.5),
                                                                        herbs.shade(leaf, 1.1, 0.8), 0.35, 0.5))
        pm = self._mat(("misc_plume", plume), lambda: herbs.herb_material("miscanthus_plume", herbs.shade(plume, 0.7),
                                                                          herbs.shade(plume, 1.1), 0.45, 0.6, 0.15, 0.4))
        z = self.t.z(s["x"], s["y"], s["z"])
        for ob in herbs.miscanthus("miscanthus_%s" % s["seed"], s, z, self.cfg, lm, pm):
            self._link(ob)

    # ------------------------------------------------------------------ beds
    def beds(self):
        """A planting mix scattered over the mulch beds (draped bed meshes of surfaces.py)."""
        import bpy
        beds = getattr(self.scn, "bed_objects", [])
        if not beds:
            return
        bp = self.cfg["shrubs"]["bedPlanting"]
        mix = bpy.data.collections.new("V_bed_mix")
        plants._library().children.link(mix)
        groups = []
        for model, weight in (("shrub_03", bp["perennialsPerM2"] * 0.5), ("shrub_01", bp["perennialsPerM2"] * 0.3),
                              ("shrub_04", bp["perennialsPerM2"] * 0.2),
                              ("periwinkle_plant", bp["groundCoverPerM2"]), ("celandine_01", bp["groundCoverPerM2"] * 0.5),
                              ("grass_medium_01", bp["grassesPerM2"])):
            try:
                col = plants.species_collection(model, model, plants.leaf_tint(self.c3.color("foliage_shrub", "#5b7a44"), REF_GREEN),
                                                "bed", cutout=True, vary=0.3, value=1.0, split=True)
            except SystemExit:
                continue
            groups.append((col, weight))
        total = sum(w for _, w in groups)
        if not total:
            return
        # repeat the objects of each group in proportion to its density (Pick Instance picks uniformly)
        for col, w in groups:
            objs = list(col.objects)
            reps = max(1, int(round(w / total * 24 / max(1, len(objs)))))
            for o in objs:
                for _ in range(reps):
                    c = o.copy()                 # shares the mesh: only the weight of the pick changes
                    mix.objects.link(c)
        for i, b in enumerate(beds):
            me = b.data
            if "plant" not in me.attributes:
                a = me.attributes.new("plant", "FLOAT", "FACE")
                a.data.foreach_set("value", np.ones(len(me.polygons), dtype=np.float32))
            lo, hi = bp.get("scale", (1.0, 1.6))
            scatter(b, mix, total, lo, hi, 31 + i, "bed_planting_%d" % i, -0.01, attribute="plant", poisson=True)
        log("beds: planting mix on %d beds (%.1f plants per m2)" % (len(beds), total))

    def hedges(self):
        for k, h in enumerate(self.inputs["site"].get("hedges") or []):
            leaf = h["leaf"]
            mat = self._mat(("hedge", leaf), lambda: leafy.leaf_material("hedge_%d" % k, leaf, dark=0.4, light=0.95, scale=22.0,
                                                                         bump=0.7, ao=0.6))
            self._link(leafy.hedge("hedge_%d" % k, h["path"], lambda x, y: self.t.z(x, y), h["height"], h["width"], mat, k + 3))

    # ------------------------------------------------------------------ lawn
    def lawn(self):
        g = self.cfg["ground"]
        dens = g["grassDensityPerM2"][self.scn.mode] * self.cfg.q["grassDensity"]
        patches = make_patches(self.cfg, self.c3.lawn_colors())
        site = self.inputs["site"]
        polys = [s["polygon"] for s in site["surfaces"]]
        polys.append(self.inputs["house"]["footprint"])
        st = self.c3.street()
        polys += [p for p in (st.get("pavement"), st.get("carriageway")) if p]
        polys += [v for v in self.t.voids]
        for p in self.c3.pools():
            polys.append([(q[0], q[1]) for q in (p.get("polygons") or {}).get("copingOuter", [])] or None)
        for pl in self.c3.pillars():
            polys.append(pl["footprint"])
        ou = self.c3.derived().get("outdoorUnit")
        if ou and ou.get("footprint"):
            polys.append(ou["footprint"])
        ex = exclusion_mesh("no_grass", [p for p in polys if p])
        smin, smax = g["grassScale"]
        scatter(self.t.near, patches, dens, smin, smax, 11, "lawn", -0.004, exclude=ex, gap=float(g["grassEdgeGapM"]),
                xy=(0.9, 1.15))

    # ------------------------------------------------------------------ the country
    def neighbourhood(self):
        """Neighbour gardens, hedgerows along field roads, woodlots and a far village edge (seeded; `landscape`)."""
        z = self.inputs["site"]["zones"]
        ls = self.cfg["landscape"]
        k_far = float(self.cfg.q["farTrees"])
        centre = Vector(self.inputs["house"]["center"] + [0.0])
        r = rng("neighbourhood", 2)
        blocked = [self.inputs["site"]["plot"]["polygon"], z["street"]["verge"], z["street"]["carriageway"]]
        houses = [[tuple(p) for p in n["footprint"]] for n in self.inputs.get("neighbours", [])]
        cols = [self._tree_collection(h, int(self.cfg["trees"]["farCopies"][self.scn.mode]))
                for h in ("#5f8a3a", "#6a9442", "#52803a", "#7a9a4a")]
        placed = []

        def free(x, y, d=4.0):
            px, py = np.array([x]), np.array([y])
            if any(_pip(poly, px, py)[0] for poly in blocked):
                return False
            for hpoly in houses:
                cx = sum(p[0] for p in hpoly) / 4
                cy = sum(p[1] for p in hpoly) / 4
                if math.hypot(x - cx, y - cy) < 9.0:
                    return False
            return all(math.hypot(x - a, y - b) > d for a, b in placed)

        def tree(x, y, h, spread=1.2):
            col = cols[r.randrange(len(cols))]
            s = h / self.stats["height"]
            zz = self.t.z(x, y, 0.0) - 0.1
            self._link(plants.instance(col, (x, y, zz), (s * r.uniform(1.0, spread), s * r.uniform(1.0, spread), s),
                                       r.uniform(0, 360), "far_tree"))
            placed.append((x, y))
        n_bush = [0]
        hb = ls["hedgerows"]["bushM"]

        def bush(x, y):
            hgt = r.uniform(*hb)
            s = {"x": x, "y": y, "z": self.t.z(x, y, 0.0), "width": hgt * r.uniform(1.0, 1.5), "height": hgt,
                 "species": "field_shrub", "yawDeg": r.uniform(0, 360)}
            self._place_variant(s, "shrub_02", self.c3.color("foliage_shrub", "#5b7a44"), r)
            n_bush[0] += 1
        n_in = 0
        # neighbour gardens: a few trees away from their houses
        for np_ in z["neighbourPlots"]:
            xs = [p[0] for p in np_["polygon"]]
            ys = [p[1] for p in np_["polygon"]]
            got = 0
            for _ in range(120):
                if got >= int(ls["neighbourGardenTrees"]):
                    break
                x, y = r.uniform(min(xs), max(xs)), r.uniform(min(ys), max(ys))
                if _pip(np_["polygon"], np.array([x]), np.array([y]))[0] and free(x, y, 6.0):
                    tree(x, y, r.uniform(5.0, 8.0))
                    got += 1
                    n_in += 1
        # hedgerows: lines along invented field roads, bushes between the trees
        hr = ls["hedgerows"]
        n_rows = 0
        for k in range(max(1, int(round(hr["count"] * max(k_far, 0.4))))):
            a = r.uniform(0, 2 * math.pi)
            d0 = r.uniform(hr["minM"], hr["maxM"])
            p0 = centre + Vector((math.cos(a), math.sin(a), 0)) * d0
            ang = a + math.pi / 2 + r.uniform(-0.5, 0.5)
            dirv = Vector((math.cos(ang), math.sin(ang), 0))
            L = r.uniform(*hr["lengthM"])
            steps = int(L / hr["spacingM"])
            for i in range(steps):
                q = p0 + dirv * ((i - steps / 2) * hr["spacingM"]) + Vector((r.uniform(-1, 1), r.uniform(-1, 1), 0)) * hr["jitterM"]
                if (q - centre).length < hr["minM"] * 0.8 or not free(q.x, q.y, 3.0):
                    continue
                if r.random() < float(hr["treeShare"]):
                    tree(q.x, q.y, r.uniform(*hr["heightM"]), 1.3)
                else:
                    bush(q.x, q.y)
                # the understorey between the trees: a field-edge shrub (shrub_02, scaled up)
                b = q + dirv * (hr["spacingM"] * 0.5)
                if free(b.x, b.y, 1.5):
                    bush(b.x, b.y)
            n_rows += 1
        # woodlots: clusters of trees
        wl = ls["woodlots"]
        for k in range(max(1, int(round(wl["count"] * max(k_far, 0.4))))):
            a = r.uniform(0, 2 * math.pi)
            c = centre + Vector((math.cos(a), math.sin(a), 0)) * r.uniform(wl["minM"], wl["maxM"])
            for i in range(int(wl["trees"] * max(k_far, 0.4))):
                rr = wl["radiusM"] * math.sqrt(r.random())
                b = r.uniform(0, 2 * math.pi)
                x, y = c.x + math.cos(b) * rr, c.y + math.sin(b) * rr
                if free(x, y, 3.5):
                    tree(x, y, r.uniform(*wl["heightM"]), 1.25)
        self._village(r, centre, ls["village"], free, tree, k_far)
        log("landscape: %d neighbour-garden trees, %d hedgerows, %d trees and %d field shrubs in all"
            % (n_in, n_rows, len(placed), n_bush[0]))

    def _village(self, r, centre, vs, free, tree, k_far):
        """A far village edge: plain houses with graphite roofs and a few trees along an arc."""
        import bmesh
        import bpy
        a0 = r.uniform(0, 2 * math.pi)
        bm = bmesh.new()
        roof_bm = bmesh.new()
        n = int(vs["houses"] * max(k_far, 0.5))
        for i in range(n):
            a = a0 + math.radians(vs["arcDeg"]) * (i / max(1, n - 1) - 0.5) + r.uniform(-0.02, 0.02)
            d = r.uniform(vs["minM"], vs["maxM"])
            c = centre + Vector((math.cos(a), math.sin(a), 0)) * d
            w, dp, h = r.uniform(8, 12), r.uniform(7, 10), r.uniform(3.0, 3.6)
            g = self.t.z(c.x, c.y, 0.0)
            rot = r.uniform(0, math.pi)
            ax = Vector((math.cos(rot), math.sin(rot), 0))
            ay = Vector((-ax.y, ax.x, 0))
            corners = [c + ax * (sx * w / 2) + ay * (sy * dp / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            lo = [bm.verts.new((p.x, p.y, g - 0.3)) for p in corners]
            hi = [bm.verts.new((p.x, p.y, g + h)) for p in corners]
            for j in range(4):
                bm.faces.new((lo[j], lo[(j + 1) % 4], hi[(j + 1) % 4], hi[j]))
            ridge = h + dp / 2 * math.tan(math.radians(r.uniform(30, 42)))
            o = 0.4
            e = [c + ax * (sx * (w / 2 + o)) + ay * (sy * (dp / 2 + o)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            rv = [roof_bm.verts.new((p.x, p.y, g + h - 0.2)) for p in e]
            r0 = roof_bm.verts.new(tuple(c + ax * (-w / 2 - o) + Vector((0, 0, g + ridge))))
            r1 = roof_bm.verts.new(tuple(c + ax * (w / 2 + o) + Vector((0, 0, g + ridge))))
            roof_bm.faces.new((rv[0], rv[1], r1, r0))
            roof_bm.faces.new((rv[2], rv[3], r0, r1))
            gv = [bm.verts.new((p.x, p.y, g + h)) for p in (corners[0], corners[3])]
            gt = bm.verts.new(tuple(c + ax * (-w / 2) + Vector((0, 0, g + ridge))))
            bm.faces.new((gv[0], gv[1], gt))
            gv2 = [bm.verts.new((p.x, p.y, g + h)) for p in (corners[1], corners[2])]
            gt2 = bm.verts.new(tuple(c + ax * (w / 2) + Vector((0, 0, g + ridge))))
            bm.faces.new((gv2[1], gv2[0], gt2))
        for i in range(int(vs["trees"] * max(k_far, 0.5))):
            a = a0 + math.radians(vs["arcDeg"] * 1.2) * (r.random() - 0.5)
            c = centre + Vector((math.cos(a), math.sin(a), 0)) * r.uniform(vs["minM"] - 20, vs["maxM"])
            if free(c.x, c.y, 8.0):
                tree(c.x, c.y, r.uniform(8, 14), 1.3)
        for name, b, color, rough in (("village_walls", bm, self.c3.color("neighbour_wall", "#d9d5cb"), 0.9),
                                      ("village_roofs", roof_bm, self.c3.color("neighbour_roof", "#565b60"), 0.6)):
            bmesh.ops.recalc_face_normals(b, faces=b.faces)
            me = bpy.data.meshes.new(name)
            b.to_mesh(me)
            b.free()
            me.materials.append(_flat_material(name, color, rough))
            self._link(bpy.data.objects.new(name, me))

    def build(self):
        from .extras import skipped
        sk = skipped()
        if "trees" not in sk:
            self.trees()
        self.shrubs()
        self.hedges()
        if "lawn" not in sk:
            self.lawn()
            self.beds()
        if "far" not in sk:
            self.neighbourhood()
        log("vegetation: %d objects" % len(self.col.objects))
