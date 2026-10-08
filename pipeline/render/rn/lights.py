"""Lamps from render-inputs.json (`lights.items`): one Blender light per lamp, scaled per shot by the level of its group.

* Energy = `watts` x `lamps.scale` x level x (1 + `duskBoost` x dusk) for the room lamps (`exteriorDuskBoost` for the garden
  and facade lights): the dusk factor is the smooth step of the sun elevation that also drives the dusk exposure, so the lit
  rooms keep their glow against the sky in the blue hour while the facade is not floodlit.
* Colour: black body of `kelvin` (2700 to 3000 K), mixed `colorMix` of the way from white.
* Ceiling spots in a room whose decor lamps (pendants, floor and table lamps) are on run at `spotsWithDecor.level` and its colour
  temperature: the room is lit by its lamps, not floodlit.
* Room lamps do not light the ground (light linking): their light through the glazing would tint the facade green at dusk.
* Garden lights (C3 kinds `pool`, `garden`, `pillar`): when the inputs do not list them yet, they are derived from the data
  here (`config.json` `fallbackLights`): underwater spots on the far long wall of every pool, uplights at the trees marked
  `uplight`, step lights along the outer edge of the pool deck and a downlight on the street face of every pillar.
Only the power changes per shot: hiding lights makes Cycles rebuild the scene, a change of power costs nothing.
"""
from __future__ import annotations

import math

from mathutils import Vector

GARDEN_KINDS = ("pool", "garden", "pillar")
# the item kinds of render-inputs.json that cover a garden light group (the C3 group names and the kinds the TypeScript writer
# uses): when one of them is present, no fallback light of that group is derived
KIND_GROUPS = {
    "pool": ("pool", "pool_light"),
    "garden": ("garden", "uplight", "step_light", "tree_uplight", "deck_step"),
    "pillar": ("pillar", "pillar_light"),
}


def present_groups(kinds):
    """The garden light groups (`pool`, `garden`, `pillar`) that the inputs already contain."""
    return {g for g, ks in KIND_GROUPS.items() if any(k in kinds for k in ks)}


def kelvin_to_rgb(k):
    """Linear RGB of a black body (Tanner Helland's fit), normalised so that the largest channel is 1."""
    t = max(1000.0, min(40000.0, k)) / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    srgb = [max(0.0, min(255.0, c)) / 255.0 for c in (r, g, b)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    m = max(lin)
    return tuple(c / m for c in lin)


def _item(kind, pos, spec, direction=None, sub=None):
    it = {"kind": kind, "group": "exterior", "pos": [float(v) for v in pos], "room": None, "space": sub or kind,
          "lumens": spec["lumens"], "watts": spec["lumens"] * spec.get("wattsPerLumen", 0.1), "kelvin": spec["kelvin"],
          "radius": spec.get("radius", 0.03), "spot": None}
    if direction is not None:
        d = Vector(direction).normalized()
        it["spot"] = {"direction": list(d), "coneDeg": spec.get("coneDeg", 60), "blend": spec.get("blend", 0.6)}
    return it


def fallback_items(c3, cfg, present_kinds, ground, covered=lambda x, y: False):
    """Garden light items derived from the data for the kinds the inputs lack (module doc). `ground(x, y)` = terrain height,
    `covered(x, y)` = True on paving or inside the house."""
    fb = cfg["fallbackLights"]
    out = []
    if "pool" not in present_kinds:
        s = fb["pool"]
        for p in c3.pools():
            x0, y0, x1, y1 = p["water"]
            c = c3.inp["house"]["center"]
            long_x = (x1 - x0) >= (y1 - y0)
            # the long wall farther from the house shines towards it: the camera side sees lit water, not the lamp face
            if long_x:
                far_y = y0 if abs(y0 - c[1]) > abs(y1 - c[1]) else y1
                inward = (0.0, 1.0 if far_y == y0 else -1.0)
                pts = [(x0 + (x1 - x0) * f, far_y + inward[1] * 0.03) for f in (1 / 3, 2 / 3)][:int(s["perPool"])]
            else:
                far_x = x0 if abs(x0 - c[0]) > abs(x1 - c[0]) else x1
                inward = (1.0 if far_x == x0 else -1.0, 0.0)
                pts = [(far_x + inward[0] * 0.03, y0 + (y1 - y0) * f) for f in (1 / 3, 2 / 3)][:int(s["perPool"])]
            z = float(p["waterZ"]) - float(s["depthBelowWater"])
            for (x, y) in pts:
                out.append(_item("pool", (x, y, z), s, (inward[0], inward[1], -0.25)))
    if "garden" not in present_kinds:
        s = fb["treeUplight"]
        hc = c3.inp["house"]["center"]
        for t in c3.trees():
            if not t.get("uplight"):
                continue
            # two uplights on the side of the trunk that faces the house, aimed up into the crown
            a0 = math.atan2(hc[1] - t["y"], hc[0] - t["x"])
            n = int(s["perTree"])
            for k in range(n):
                a = a0 + (k - (n - 1) / 2.0) * math.radians(70)
                x, y = t["x"] + math.cos(a) * s["offsetM"], t["y"] + math.sin(a) * s["offsetM"]
                d = (t["x"] - x, t["y"] - y, 3.2 * s["offsetM"])
                out.append(_item("garden", (x, y, ground(x, y) + 0.05), s, d, sub="tree_uplight"))
        s = fb["deckStep"]
        for p in c3.pools():
            deck = (p.get("polygons") or {}).get("deck") or {}
            ring = deck.get("outer")
            if not ring:
                continue
            n = len(ring)
            cx = sum(q[0] for q in ring) / n
            cy = sum(q[1] for q in ring) / n
            for i in range(n):
                a, b = Vector((*ring[i], 0)), Vector((*ring[(i + 1) % n], 0))
                L = (b - a).length
                inward_e = Vector((cx, cy, 0)) - (a + b) / 2
                normal = Vector((-(b - a).y, (b - a).x, 0)).normalized()
                if normal.dot(inward_e) > 0:
                    normal = -normal
                probe = (a + b) / 2 + normal * 0.25
                if covered(probe.x, probe.y):
                    continue            # the edge joins another paved area (the terrace): no step there
                cnt = max(1, int(L / s["spacingM"]))
                for k in range(cnt):
                    q = a.lerp(b, (k + 0.5) / cnt)
                    pos = q - normal * s["inset"]
                    out.append(_item("garden", (pos.x, pos.y, ground(pos.x, pos.y) + s["height"]), s, None, sub="deck_step"))
    if "pillar" not in present_kinds:
        s = fb["pillar"]
        for pl in c3.pillars():
            size = pl["size"]
            inw = Vector((*pl["inward"], 0))
            c = Vector((*pl["center"], 0)) - inw * (size[1] / 2 + 0.06)
            out.append(_item("pillar", (c.x, c.y, pl["z"] + size[2] - 0.12), s, (-inw.x * 0.3, -inw.y * 0.3, -1.0)))
    return out


class Lamps:
    def __init__(self, inputs, cfg, c3=None, ground=None, covered=None):
        import bpy
        self.cfg = cfg
        lc = cfg["lamps"]
        self.items = []
        self._last = {}
        col = bpy.data.collections.new("lamps")
        bpy.context.scene.collection.children.link(col)
        self.collection = col
        items = list(inputs["lights"]["items"])
        if c3 is not None:
            kinds = present_groups({it["kind"] for it in items})
            extra = fallback_items(c3, cfg, kinds, ground or (lambda x, y: 0.0), covered or (lambda x, y: False))
            items += extra
            self.fallback = len(extra)
        else:
            self.fallback = 0
        # rooms with decor lamps: their ceiling spots are dimmed when the decor is on
        decor_rooms = {it["room"] for it in items if it["kind"] in lc["decorKinds"] and it.get("room")}
        mix = float(lc["colorMix"])
        for i, it in enumerate(items):
            spot = it.get("spot")
            dim = it["kind"] in lc["spotKinds"] and it.get("room") in decor_rooms
            kelvin = lc["spotsWithDecor"]["kelvin"] if dim else it["kelvin"]
            data = bpy.data.lights.new("lamp_%03d_%s" % (i, it["kind"]), "SPOT" if spot else "POINT")
            data.color = tuple(1.0 + (c - 1.0) * mix for c in kelvin_to_rgb(kelvin))
            data.shadow_soft_size = float(it.get("radius", 0.05))
            if spot:
                data.spot_size = math.radians(min(179.0, float(spot["coneDeg"])))
                data.spot_blend = float(spot["blend"])
            ob = bpy.data.objects.new(data.name, data)
            ob.location = it["pos"]
            if spot:
                ob.rotation_mode = "QUATERNION"
                ob.rotation_quaternion = Vector(spot["direction"]).to_track_quat("-Z", "Y")
            # a lamp is not seen by the camera (the glow of fixtures comes from the geometry) but lights everything
            ob.visible_camera = False
            col.objects.link(ob)
            self.items.append((ob, it, lc["spotsWithDecor"]["level"] if dim else 1.0))

    def exclude_from_room_lamps(self, objects):
        """Light linking: the interior lamps do not light `objects` (terrain, far ground)."""
        import bpy
        if not self.cfg["lamps"].get("excludeGroundFromRoomLamps") or not objects:
            return 0
        col = bpy.data.collections.new("no_room_light")
        for o in objects:
            col.objects.link(o)
        n = 0
        for ob, it, _ in self.items:
            if it["group"] != "interior":
                continue
            try:
                ob.light_linking.receiver_collection = col
                n += 1
            except AttributeError:      # pragma: no cover - Blender without light linking
                return 0
        for co in col.collection_objects:
            co.light_linking.link_state = "EXCLUDE"
        return n

    def apply(self, interior, exterior, dusk=0.0):
        """Levels 0..1 of the two groups (shot.lights); below 2 percent a group is off; `dusk` 0..1 boosts every lamp."""
        lc = self.cfg["lamps"]
        boost = {"interior": 1.0 + float(lc["duskBoost"]) * dusk,
                 "exterior": 1.0 + float(lc.get("exteriorDuskBoost", 0.0)) * dusk}
        n_on = 0
        decor_on = interior > 0.02
        for i, (ob, it, dim) in enumerate(self.items):
            level = interior if it["group"] == "interior" else exterior
            f = dim if decor_on else 1.0
            scale = float(lc["scale"]) * boost.get(it["group"], 1.0)
            energy = float(it["watts"]) * scale * level * f if level > 0.02 else 0.0
            energy = round(energy, 3)
            if self._last.get(i) != energy:
                ob.data.energy = energy
                self._last[i] = energy
            n_on += energy > 0
        return n_on
