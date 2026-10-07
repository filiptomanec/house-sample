"""Physical sky (Sky Texture, multiple scattering) with the sun where render-inputs.json puts it. The position of the sun is
never computed here: `shot.sun.blender.sunRotationRad` / `sunElevationRad` and `shot.sun.elevationDeg` come from the data."""
from __future__ import annotations

import math

from .util import smoothstep


class Sky:
    def __init__(self, inputs, cfg):
        import bpy
        self.cfg = cfg
        self._key = None
        self._ev = 0.0
        self.world = bpy.data.worlds.new("sky")
        self.world.use_nodes = True
        nt = self.world.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        self.sky = nt.nodes.new("ShaderNodeTexSky")
        s = inputs["sky"]
        self.sky.sky_type = s["model"]
        self.sky.altitude = s.get("altitudeM", 0.0)
        self.sky.air_density = s.get("airDensity", 1.0)
        self.sky.aerosol_density = s.get("aerosolDensity", 1.0)
        self.sky.ozone_density = s.get("ozoneDensity", 1.0)
        self.sky.sun_disc = True
        self.bg = nt.nodes.new("ShaderNodeBackground")
        out = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(self.sky.outputs[0], self.bg.inputs[0])
        nt.links.new(self.bg.outputs[0], out.inputs[0])
        bpy.context.scene.world = self.world

    def apply(self, sun):
        """Set the sky for `sun` (the `sun` object of a shot). Returns the exposure offset (EV) that the twilight needs."""
        lk = self.cfg["look"]
        key = (sun["elevationDeg"], sun["blender"]["sunRotationRad"], sun["blender"]["sunElevationRad"])
        if key == self._key:
            return self._ev
        self._key = key
        elev_deg = float(sun["elevationDeg"])
        strength = lk["skyStrength"]
        hold = lk["belowHorizonHoldDeg"]
        if elev_deg >= hold:
            elev = float(sun["blender"]["sunElevationRad"])
            self.sky.sun_disc = True
        else:
            # Sky Texture colours go odd below the horizon: keep the glow direction at the hold angle, fade the sky out
            elev = math.radians(hold)
            strength *= 10 ** ((elev_deg - hold) * lk["belowHorizonFalloff"])
            self.sky.sun_disc = False
        self.sky.sun_elevation = elev
        self.sky.sun_rotation = float(sun["blender"]["sunRotationRad"])
        self.bg.inputs["Strength"].default_value = strength
        d = lk["dusk"]
        self._ev = d["ev"] * smoothstep(d["fromElevationDeg"], d["toElevationDeg"], elev_deg)
        return self._ev
