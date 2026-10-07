"""Vegetation of the render: trees (scanned model plus a procedural crown filler, a procedural pine), shrubs, hedges, topiary,
grasses, the lawn blades and the trees of the neighbourhood. Everything stands on the terrain mesh (ray cast) and uses its own
seeded random numbers, so adding one plant never moves another."""
from __future__ import annotations

import math
import zlib

from mathutils import Vector

from . import leafy, plants
from .lawn import make_patches, scatter
from .util import hex_to_linear, log, rng

def ty_(tr, ly, a, ring, cw):
    return tr["y"] + ly + math.sin(a) * ring * cw * 0.5 * 0.85


def _shade(hex_color, f):
    c = hex_color.lstrip("#")
    return "#" + "".join("%02x" % max(0, min(255, int(int(c[i:i + 2], 16) * f))) for i in (0, 2, 4))


TREE_MODEL = "tree_small_02"
REF_GREEN = "#6a8b45"


class Vegetation:
    def __init__(self, scn, terrain):
        import bpy
        self.scn, self.t = scn, terrain
        self.inputs, self.cfg = scn.inputs, scn.cfg
        self.col = bpy.data.collections.new("vegetation")
        bpy.context.scene.collection.children.link(self.col)
        self.hints = {}
        self._species = {}
        self._mats = {}
        self.stats = plants.model_stats(TREE_MODEL)

    # ------------------------------------------------------------------ helpers
    def _link(self, ob):
        self.col.objects.link(ob)
        return ob

    def _mat(self, key, factory):
        if key not in self._mats:
            self._mats[key] = factory()
        return self._mats[key]

    def _tree_collection(self, species, leaf, copies):
        """Library collection of one species: the scanned tree with tinted leaves, `copies` = number of rotated copies on
        one trunk (1 = as scanned, 3 = a full crown)."""
        key = (species, leaf, copies)
        if key not in self._species:
            cp = [(0.0, 1.0, 0.0, 0.0), (125.0, 0.93, 0.0, 0.0), (250.0, 0.86, 0.0, 0.0)][:copies]
            self._species[key] = plants.species_collection(TREE_MODEL, species, plants.leaf_tint(leaf, REF_GREEN), "tree", copies=cp)
        return self._species[key]

    # ------------------------------------------------------------------ trees
    def trees(self):
        hint = self.inputs["vegetation"]
        for tr in hint["trees"]:
            self._tree(tr)

    def _tree(self, tr):
        form = tr.get("form", "broadleaf-round")
        if form == "conifer-pine":
            return self._pine(tr)
        st = self.stats
        copies = {"birch-airy": 2, "orchard-round": 1, "orchard-oval": 1, "broadleaf-oval": 2}.get(form, 3)
        col = self._tree_collection(tr["species"], tr["leaf"], copies)
        r = rng("tree", tr["seed"])
        sxy = tr["crown"] / st["crown"] * tr.get("scale", 1.0)
        sz = tr["height"] / st["height"] * tr.get("scale", 1.0)
        # the crown base of the data: the model's lowest leaves sit at z0; stretch the trunk so that they start at crownBase
        sz = max(sz, 0.5 * sxy) if form.startswith("orchard") else sz
        loc = (tr["x"], tr["y"], self.t.z(tr["x"], tr["y"], tr["z"]) - 0.05)
        self._link(plants.instance(col, loc, (sxy, sxy, sz), tr.get("yawDeg", r.uniform(0, 360)), "tree_%s" % tr["species"]))

    def _pine(self, tr):
        """A Scots pine: leaning bare trunk, a ragged crown of a few flattened leafy clusters at the top."""
        import bmesh
        import bpy
        r = rng("pine", tr["seed"])
        h, cw = tr["height"], tr["crown"]
        z0 = self.t.z(tr["x"], tr["y"], tr["z"]) - 0.05
        bark = self._mat("bark", lambda: leafy.leaf_material("bark", "#5a4a3c", dark=0.55, light=1.0, scale=40.0, bump=1.0,
                                                               rough=0.9))
        bm = bmesh.new()
        seg = 14
        lean = Vector((r.uniform(-0.04, 0.04), r.uniform(-0.04, 0.04), 0))
        rings = []
        for k in range(seg + 1):
            t = k / seg
            rad = 0.26 * (1 - 0.75 * t) + 0.04
            c = Vector((lean.x * h * t * t, lean.y * h * t * t, h * 0.9 * t))
            ring = []
            for a in range(10):
                an = a / 10 * 2 * math.pi
                ring.append(bm.verts.new(c + Vector((math.cos(an) * rad, math.sin(an) * rad, 0))))
            rings.append(ring)
        for k in range(seg):
            for a in range(10):
                bm.faces.new((rings[k][a], rings[k][(a + 1) % 10], rings[k + 1][(a + 1) % 10], rings[k + 1][a]))
        me = bpy.data.meshes.new("pine_trunk")
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(bark)
        trunk = bpy.data.objects.new("pine_trunk", me)
        trunk.location = (tr["x"], tr["y"], z0)
        self._link(trunk)
        mat = self._mat("pine", lambda: leafy.leaf_material("pine_needles", "#35523f", dark=0.35, light=1.0, scale=22.0,
                                                              bump=1.4, rough=0.7))
        top = h * 0.97
        base = max(tr.get("crownBase", h * 0.5), h * 0.52)
        # a rounded irregular crown at the top: clumps of needles inside an ellipsoid, the lower ones wider, the top ones small
        cz = 0.5 * (base + top)
        rz = 0.5 * (top - base)
        for k in range(15):
            a = r.uniform(0, 2 * math.pi)
            u = r.random() ** 0.6
            v = r.uniform(-1, 1)
            ring = math.sqrt(max(0.0, 1 - v * v)) * u
            zc = cz + v * rz * 0.9
            rad = cw * 0.5 * r.uniform(0.28, 0.42) * (1.1 - 0.35 * (zc - base) / (top - base))
            lx = lean.x * h * (zc / h) ** 2
            ly = lean.y * h * (zc / h) ** 2
            ob = leafy.ball("pine_clump_%d" % k, rad, mat, tr["seed"] + k, squash=0.62, subdiv=4, amp=0.34)
            ob.location = (tr["x"] + lx + math.cos(a) * ring * cw * 0.5 * 0.85, ty_(tr, ly, a, ring, cw), z0 + zc)
            ob.rotation_euler = (0, 0, r.uniform(0, 6.28))
            self._link(ob)

    # ------------------------------------------------------------------ shrubs and hedges
    def shrubs(self):
        for s in self.inputs["vegetation"]["shrubs"]:
            form = s.get("form")
            if form == "grass-tuft":
                self._grass(s)
            elif form == "topiary-ball":
                self._ball(s, "#2b4533", dark=0.45, scale=24.0)
            elif form == "shrub-round":
                self._ball(s, s["leaf"], flower=(s.get("flower", "#e8e6dc"), 0.34), dark=0.5, scale=9.0, amp=0.1)
            else:  # perennial-mound (lavender): grey-green foliage with many violet flower spikes
                self._ball(s, _shade(s["leaf"], 0.55), flower=(s.get("flower", "#8d78b5"), 0.5), dark=0.5, scale=70.0,
                           amp=0.2, squash=0.8)

    def _ball(self, s, leaf, flower=None, dark=0.45, scale=14.0, amp=0.06, squash=None):
        w = s["width"]
        sq = squash if squash is not None else min(1.4, s["height"] / (w * 0.5))
        key = ("ball", s["species"], leaf)
        mat = self._mat(key, lambda: leafy.leaf_material("leaf_%s" % s["species"], leaf, dark=dark, scale=scale, flower=flower))
        ob = leafy.ball("%s_%s" % (s["species"], s["seed"]), w * 0.5, mat, s["seed"] % 1000, squash=sq, subdiv=5, amp=amp)
        ob.location = (s["x"], s["y"], self.t.z(s["x"], s["y"], s["z"]) - 0.04)
        ob.rotation_euler = (0, 0, math.radians(s.get("yawDeg", 0)))
        self._link(ob)

    def _grass(self, s):
        """Miscanthus: a clump of tufts of the grass model, scaled to the height of the data."""
        r = rng("grass", s["seed"])
        col = plants.species_collection("grass_medium_02", s["species"], plants.leaf_tint(s["leaf"], "#808060"), "grass",
                                        recolor=True)
        objs = list(col.objects)
        base_h = max(plants.bounds(o)[1][2] for o in plants.load_model("grass_medium_02"))
        z = self.t.z(s["x"], s["y"], s["z"]) - 0.03
        for k in range(5):
            src = objs[r.randrange(len(objs))]
            o = src.copy()
            o.location = (s["x"] + r.uniform(-1, 1) * s["width"] * 0.28, s["y"] + r.uniform(-1, 1) * s["width"] * 0.28, z)
            sc = s["height"] / max(0.3, base_h) * r.uniform(0.7, 1.05)
            o.scale = (sc * 1.2, sc * 1.2, sc)
            o.rotation_euler = (0, 0, r.uniform(0, 6.28))
            self._link(o)

    def hedges(self):
        for k, h in enumerate(self.inputs["site"]["hedges"]):
            leaf = h["leaf"]
            mat = self._mat(("hedge", leaf), lambda: leafy.leaf_material("hedge_%d" % k, leaf, dark=0.5, scale=22.0, bump=0.7))
            ob = leafy.hedge("hedge_%d" % k, h["path"], lambda x, y: self.t.z(x, y), h["height"], h["width"], mat, k + 3)
            self._link(ob)

    # ------------------------------------------------------------------ lawn and the neighbourhood
    def lawn(self):
        dens = self.cfg["ground"]["grassDensityPerM2"][self.scn.mode] * self.cfg.q["grassDensity"]
        patches = make_patches(self.cfg)
        scatter(self.t.near, patches, dens, 0.8, 1.15, 11, "lawn", -0.005)

    def neighbourhood(self):
        """Trees in the neighbour gardens and a tree line on the horizon (not on the street, the plot or the field)."""
        z = self.inputs["site"]["zones"]
        from .terrain import _pip
        import numpy as np
        centre = Vector(self.inputs["house"]["center"] + [0.0])
        r = rng("neighbourhood", 1)
        blocked = [self.inputs["site"]["plot"]["polygon"], z["street"]["verge"], z["street"]["carriageway"]]
        for n in self.inputs.get("neighbours", []):
            blocked.append([tuple(p) for p in n["footprint"]])
        cols = {}
        for i, hexc in enumerate(("#5f8a3a", "#6a9442", "#52803a", "#7a9a4a")):
            cols[i] = self._tree_collection("far%d" % i, hexc, 2)
        placed = []

        def ok(x, y):
            if any(_pip(poly, np.array([x]), np.array([y]))[0] for poly in blocked):
                return False
            return all(math.hypot(x - a, y - b) > 6.0 for a, b in placed)
        # garden trees of the neighbours: inside the neighbour plots, away from their houses
        for np_ in z["neighbourPlots"]:
            xs = [p[0] for p in np_["polygon"]]
            ys = [p[1] for p in np_["polygon"]]
            got = 0
            for _ in range(80):
                if got >= 7:
                    break
                x, y = r.uniform(min(xs), max(xs)), r.uniform(min(ys), max(ys))
                if _pip(np_["polygon"], np.array([x]), np.array([y]))[0] and ok(x, y):
                    placed.append((x, y))
                    self._far_tree(cols, r, x, y, r.uniform(5.5, 9.0))
                    got += 1
        n_far = int(self.cfg.q["farTrees"])
        tries = 0
        k = 0
        while k < n_far and tries < n_far * 30:
            tries += 1
            a = r.uniform(0, 2 * math.pi)
            d = r.uniform(70, 330)
            x, y = centre.x + math.cos(a) * d, centre.y + math.sin(a) * d
            if not ok(x, y):
                continue
            placed.append((x, y))
            self._far_tree(cols, r, x, y, r.uniform(8.0, 16.0))
            k += 1

    def _far_tree(self, cols, r, x, y, height):
        col = cols[r.randrange(len(cols))]
        st = self.stats
        s = height / st["height"]
        z = self.t.z(x, y, 0.0) - 0.1
        self._link(plants.instance(col, (x, y, z), (s * r.uniform(1.0, 1.35), s * r.uniform(1.0, 1.35), s), r.uniform(0, 360),
                                   "far_tree"))

    def build(self):
        from .extras import skipped
        sk = skipped()
        if "trees" not in sk:
            self.trees()
        self.shrubs()
        self.hedges()
        if "lawn" not in sk:
            self.lawn()
        if "far" not in sk:
            self.neighbourhood()
        log("vegetation: %d objects" % len(self.col.objects))
