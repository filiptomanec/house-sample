"""Physical sky with photographed clouds for the camera.

* **Lighting** is the Sky Texture (multiple scattering) alone, with the sun where render-inputs.json puts it
  (`shot.sun.blender.sunRotationRad` / `sunElevationRad`; the position of the sun is never computed here). Below the horizon
  the glow is held at `belowHorizonHoldDeg` and dimmed; the dusk exposure is a smooth step of the sun elevation (`look.dusk`).
* **Clouds** (D3) come from a CC0 "puresky" HDRI (ASSETS.md). They are seen only by camera and glossy rays (Light Path), so
  the glass and the pool reflect them while diffuse and shadow rays still see the physical sky. The HDRI is not used as a
  picture: its cloud layer is extracted once (cached in `assets/cache`): a mask (pixels brighter and greyer than the clear sky
  of their elevation, the HDRI's own sun and the lower hemisphere removed) and a relative brightness. The shader draws the
  clouds as that brightness times the luminance of the physical sky in the same direction, tinted towards the colour of the
  sky at the horizon under the sun and darkened with the dusk curve: the clouds follow the time of day of the physical sky
  (white at noon, warm at golden hour, grey-violet in the blue hour) and never turn the sky grey. They clear a few degrees
  around the visible sun disc. Without the asset the sky is the plain physical sky.
* The sky seen by camera and glossy rays has its own gain and saturation (`look.skyCamera`, a polariser): a deeper blue in
  the picture and in the glazing, while the scene is still lit by the physical sky.
* Settings: `config.json` `look.clouds`, overridden by `render-inputs.sky.clouds` (C3) when present.
"""
from __future__ import annotations

import math
import os

from .util import log, repo_path, smoothstep

CACHE = repo_path("assets", "cache")


def _cloud_settings(inputs, cfg):
    """`look.clouds` of config.json, overridden by `render-inputs.sky.clouds` (C3: `hdri` = the asset path, `rotationDeg`,
    `strength` = a gain on the cloud brightness, `visibleTo` = the ray types that see the clouds; any look key may be given)."""
    c = dict(cfg["look"].get("clouds") or {})
    ic = dict((inputs.get("sky") or {}).get("clouds") or {})
    hdri = ic.pop("hdri", None)
    if hdri:
        c["asset"] = os.path.splitext(os.path.basename(str(hdri)))[0]
    c.update({k: v for k, v in ic.items() if v is not None})
    return c


def _background(a, reduce, block):
    """Block-wise `reduce` (min or max) of a 2D array, smoothed (3 x 3 blocks) and interpolated back to its size."""
    import numpy as np
    h, w = a.shape
    bh, bw = max(1, h // block), max(1, w // block)
    small = reduce(reduce(a[:bh * block, :bw * block].reshape(bh, block, bw, block), axis=3), axis=1)
    pad = np.pad(small, 1, mode="edge")
    sm = sum(pad[i:i + bh, j:j + bw] for i in range(3) for j in range(3)) / 9.0
    yi = (np.arange(h) + 0.5) / block - 0.5
    xi = (np.arange(w) + 0.5) / block - 0.5
    y0 = np.clip(np.floor(yi).astype(int), 0, bh - 1)
    x0 = np.clip(np.floor(xi).astype(int), 0, bw - 1)
    y1 = np.clip(y0 + 1, 0, bh - 1)
    x1 = np.clip(x0 + 1, 0, bw - 1)
    fy = np.clip(yi - y0, 0, 1)[:, None]
    fx = np.clip(xi - x0, 0, 1)[None, :]
    top = sm[y0][:, x0] * (1 - fx) + sm[y0][:, x1] * fx
    bot = sm[y1][:, x0] * (1 - fx) + sm[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def _cloud_layer(asset):
    """The cloud layer of an HDRI as a float image (R = relative brightness, G = mask), cached as EXR. None without the asset."""
    import bpy
    import numpy as np
    src = os.path.join(repo_path("assets", "hdri"), asset + ".exr")
    if not os.path.exists(src):
        log("clouds: %s not found (assets/hdri, see ASSETS.md): plain physical sky" % asset)
        return None
    out = os.path.join(CACHE, asset + "_clouds.exr")
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return bpy.data.images.load(out, check_existing=True)
    im = bpy.data.images.load(src, check_existing=True)
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]               # Blender rows: bottom to top
    lum = px[:, :, 0] * 0.2126 + px[:, :, 1] * 0.7152 + px[:, :, 2] * 0.0722
    ratio = px[:, :, 2] / np.maximum(px[:, :, 0], 1e-5)
    del px
    el = (np.arange(h, dtype=np.float32) + 0.5) / h * 180.0 - 90.0      # elevation of each row (bottom row = -90)
    # the clear sky around a pixel: block minimum of the luminance (block maximum of the blue ratio) over about 8 degrees,
    # smoothed and brought back to full size; clouds are local features brighter and greyer than that, the smooth glow
    # around the sun is not
    sky_l = _background(lum, np.min, w // 48)
    sky_r = _background(ratio, np.max, w // 48)
    rel = lum / np.maximum(sky_l, 1e-5)

    def ss(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)
    bright = ss(1.15, 1.9, rel) * ss(sky_r * 0.97, sky_r * 0.75, ratio)
    grey = ss(sky_r * 0.8, sky_r * 0.6, ratio) * ss(1.45, 1.8, sky_r)   # grey cloud bases against a blue sky
    mask = np.maximum(bright, grey)
    # the HDRI's own sun (and its blown-out surroundings): fade the mask within 30 to 46 degrees of the brightest point
    j0, i0 = np.unravel_index(np.argmax(np.where(el[:, None] > 0, lum, 0)), lum.shape)
    lon = (np.arange(w, dtype=np.float32) + 0.5) / w * 2 * math.pi
    la = np.radians(el)[:, None]
    lo = lon[None, :]
    la0, lo0 = math.radians(el[j0]), lon[i0]
    cosd = np.sin(la) * math.sin(la0) + np.cos(la) * math.cos(la0) * np.cos(lo - lo0)
    mask *= ss(math.cos(math.radians(30)), math.cos(math.radians(46)), cosd)
    mask *= ss(1.0, 7.0, el)[:, None]                 # nothing below the horizon, soft at it
    mask = np.clip(mask, 0.0, 1.0).astype(np.float32)
    sel = mask > 0.5
    norm = float(np.median(rel[sel])) if sel.any() else 1.0
    shade = np.clip(rel / max(norm, 1e-3), 0.25, 3.0).astype(np.float32)
    img = np.zeros((h, w, 4), dtype=np.float32)
    img[:, :, 0] = shade
    img[:, :, 1] = mask
    img[:, :, 3] = 1.0
    bpy.data.images.remove(im)
    os.makedirs(CACHE, exist_ok=True)
    cl = bpy.data.images.new(asset + "_clouds", w, h, alpha=True, float_buffer=True)
    cl.pixels.foreach_set(img.ravel())
    cl.filepath_raw = out
    cl.file_format = "OPEN_EXR"
    try:
        cl.save()
    except Exception as e:  # pragma: no cover - the layer still works from memory
        log("clouds: cache not written (%s)" % e)
    log("clouds: layer of %s extracted (%d x %d, %.0f %% cloud)" % (asset, w, h, 100.0 * float(sel.mean())))
    return cl


class Sky:
    def __init__(self, inputs, cfg):
        import bpy
        self.cfg = cfg
        self._key = None
        self._ev = 0.0
        self._dusk = 0.0
        self.world = bpy.data.worlds.new("sky")
        self.world.use_nodes = True
        nt = self.world.node_tree
        N, L = nt.nodes, nt.links
        for n in list(N):
            N.remove(n)
        s = dict(inputs["sky"])
        s.update(cfg["look"].get("atmosphere") or {})      # calibration only (RENDER_LOOK); the data is render.json `sky`

        def sky_node():
            k = N.new("ShaderNodeTexSky")
            k.sky_type = s["model"]
            k.altitude = s.get("altitudeM", 0.0)
            k.air_density = s.get("airDensity", 1.0)
            k.aerosol_density = s.get("aerosolDensity", 1.0)
            k.ozone_density = s.get("ozoneDensity", 1.0)
            return k
        self.sky = sky_node()
        self.sky.sun_disc = True
        self.sky_nodes = [self.sky]           # every Sky Texture that follows the sun of the shot
        self.grade = self._grade_group()
        self.haze = self._haze_group(sky_node)
        self.bg = N.new("ShaderNodeBackground")
        out = N.new("ShaderNodeOutputWorld")
        L.new(self.sky.outputs[0], self.bg.inputs[0])
        self.clouds = None
        cs = _cloud_settings(inputs, cfg)
        layer = _cloud_layer(cs["asset"]) if cs.get("asset") and float(cs.get("coverage", 0)) > 0 else None
        if layer is None:
            L.new(self.bg.outputs[0], out.inputs[0])
        else:
            self.clouds = self._cloud_nodes(nt, layer, cs, sky_node, out)
        bpy.context.scene.world = self.world

    def _grade_group(self):
        """Colour grade of the sky as the camera sees it (shared by the world and the haze): saturation (`skyCamera`) and,
        in the twilight, a blend of the sky colour towards its own luminance in the `twilight` colour (`amount` x dusk), so
        the blue hour stays blue above a glowing horizon."""
        import bpy
        g = bpy.data.node_groups.new("sky_grade", "ShaderNodeTree")
        g.interface.new_socket("Color", in_out="INPUT", socket_type="NodeSocketColor")
        g.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
        N, L = g.nodes, g.links
        gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
        hsv = N.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = float((self.cfg["look"].get("skyCamera") or {}).get("saturation", 1.0))
        L.new(gi.outputs[0], hsv.inputs["Color"])
        bw = N.new("ShaderNodeRGBToBW")
        L.new(gi.outputs[0], bw.inputs[0])
        tw = self.cfg["look"].get("twilight") or {}
        from .util import hex_to_linear
        tc = hex_to_linear(tw.get("color", "#7f9ccf"))
        lum_t = 0.2126 * tc[0] + 0.7152 * tc[1] + 0.0722 * tc[2]
        sc = N.new("ShaderNodeVectorMath")
        sc.operation = "SCALE"
        sc.inputs[0].default_value = tuple(c / max(lum_t, 1e-6) for c in tc)
        L.new(bw.outputs[0], sc.inputs["Scale"])
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[0].default_value = 0.0
        L.new(hsv.outputs[0], mix.inputs[6])
        L.new(sc.outputs[0], mix.inputs[7])
        L.new(mix.outputs[2], go.inputs[0])
        self.grade_mix = mix
        return g

    def _haze_group(self, sky_node):
        """Aerial perspective for camera rays: the surface fades into the graded sky of the horizon in the direction of the
        view, by 1 - exp(-distance / `haze.distanceM`). The far ground then meets the sky without a seam, and the woodlots,
        the village edge and the fields recede like in a photograph. One Sky Texture inside the group serves every
        material (`apply_haze`)."""
        import bpy
        hz = self.cfg["look"].get("haze") or {}
        g = bpy.data.node_groups.new("aerial_haze", "ShaderNodeTree")
        g.interface.new_socket("Surface", in_out="INPUT", socket_type="NodeSocketShader")
        g.interface.new_socket("Surface", in_out="OUTPUT", socket_type="NodeSocketShader")
        N, L = g.nodes, g.links
        gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
        geo = N.new("ShaderNodeNewGeometry")
        neg = N.new("ShaderNodeVectorMath")
        neg.operation = "SCALE"
        neg.inputs["Scale"].default_value = -1.0
        L.new(geo.outputs["Incoming"], neg.inputs[0])
        sep = N.new("ShaderNodeSeparateXYZ")
        L.new(neg.outputs[0], sep.inputs[0])
        mz = N.new("ShaderNodeMath")
        mz.operation = "MAXIMUM"
        mz.inputs[1].default_value = math.sin(math.radians(float(hz.get("horizonDeg", 2.0))))
        L.new(sep.outputs["Z"], mz.inputs[0])
        cmb = N.new("ShaderNodeCombineXYZ")
        L.new(sep.outputs["X"], cmb.inputs["X"])
        L.new(sep.outputs["Y"], cmb.inputs["Y"])
        L.new(mz.outputs[0], cmb.inputs["Z"])
        nrm = N.new("ShaderNodeVectorMath")
        nrm.operation = "NORMALIZE"
        L.new(cmb.outputs[0], nrm.inputs[0])
        sky = N.new("ShaderNodeTexSky")
        for attr in ("sky_type", "altitude", "air_density", "aerosol_density", "ozone_density"):
            setattr(sky, attr, getattr(self.sky, attr))
        sky.sun_disc = False
        L.new(nrm.outputs[0], sky.inputs["Vector"])
        self.sky_nodes.append(sky)
        grade = N.new("ShaderNodeGroup")
        grade.node_tree = self.grade
        L.new(sky.outputs[0], grade.inputs[0])
        em = N.new("ShaderNodeEmission")
        L.new(grade.outputs[0], em.inputs["Color"])
        self.haze_strength = em.inputs["Strength"]
        lp = N.new("ShaderNodeLightPath")
        dv = N.new("ShaderNodeMath")
        dv.operation = "DIVIDE"
        dv.inputs[1].default_value = float(hz.get("distanceM", 5000.0))
        L.new(lp.outputs["Ray Length"], dv.inputs[0])
        ex = N.new("ShaderNodeMath")
        ex.operation = "EXPONENT"
        neg2 = N.new("ShaderNodeMath")
        neg2.operation = "MULTIPLY"
        neg2.inputs[1].default_value = -1.0
        L.new(dv.outputs[0], neg2.inputs[0])
        L.new(neg2.outputs[0], ex.inputs[0])
        one = N.new("ShaderNodeMath")
        one.operation = "SUBTRACT"
        one.inputs[0].default_value = float(hz.get("amount", 1.0))
        L.new(ex.outputs[0], one.inputs[1])
        cam = N.new("ShaderNodeMath")
        cam.operation = "MULTIPLY"
        L.new(one.outputs[0], cam.inputs[0])
        L.new(lp.outputs["Is Camera Ray"], cam.inputs[1])
        clamp = N.new("ShaderNodeClamp")
        L.new(cam.outputs[0], clamp.inputs["Value"])
        mix = N.new("ShaderNodeMixShader")
        L.new(clamp.outputs[0], mix.inputs[0])
        L.new(gi.outputs[0], mix.inputs[1])
        L.new(em.outputs[0], mix.inputs[2])
        L.new(mix.outputs[0], go.inputs[0])
        return g

    def apply_haze(self, m):
        """Puts the aerial-haze group between the surface shader of material `m` and its output (once)."""
        if m is None or not m.use_nodes or m.get("haze") or not self.cfg["look"].get("haze"):
            return False
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or \
            next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None or not out.inputs["Surface"].links:
            return False
        src = out.inputs["Surface"].links[0].from_socket
        g = nt.nodes.new("ShaderNodeGroup")
        g.node_tree = self.haze
        nt.links.new(src, g.inputs[0])
        nt.links.new(g.outputs[0], out.inputs["Surface"])
        m["haze"] = 1
        return True

    def _cloud_nodes(self, nt, layer, cs, sky_node, out):
        """Camera and glossy rays: physical sky mixed with the extracted clouds (module doc)."""
        N, L = nt.nodes, nt.links

        def math_node(op, a=None, b=None):
            m = N.new("ShaderNodeMath")
            m.operation = op
            for k, v in ((0, a), (1, b)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    m.inputs[k].default_value = float(v)
                else:
                    L.new(v, m.inputs[k])
            return m.outputs[0]

        def vec_node(op, a, b=None):
            m = N.new("ShaderNodeVectorMath")
            m.operation = op
            L.new(a, m.inputs[0])
            if b is not None:
                if isinstance(b, tuple):
                    m.inputs[1].default_value = b
                else:
                    L.new(b, m.inputs[1])
            return m
        tc = N.new("ShaderNodeTexCoord")
        mp = N.new("ShaderNodeMapping")
        mp.vector_type = "VECTOR"
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(float(cs.get("rotationDeg", 0.0))))
        L.new(tc.outputs["Generated"], mp.inputs["Vector"])
        env = N.new("ShaderNodeTexEnvironment")
        env.image = layer
        env.interpolation = "Cubic"
        L.new(mp.outputs[0], env.inputs["Vector"])
        sep = N.new("ShaderNodeSeparateColor")
        L.new(env.outputs["Color"], sep.inputs[0])
        shade, mask = sep.outputs[0], sep.outputs[1]
        # clear a cone around the visible sun: dot(direction, sun) against cos(sunClearDeg)
        self.sun_dir = N.new("ShaderNodeCombineXYZ")
        dot = vec_node("DOT_PRODUCT", tc.outputs["Generated"], self.sun_dir.outputs[0])
        clr = N.new("ShaderNodeMapRange")
        clr.inputs["From Min"].default_value = math.cos(math.radians(float(cs.get("sunClearDeg", 9.0))))
        clr.inputs["From Max"].default_value = math.cos(math.radians(float(cs.get("sunClearDeg", 9.0)) * 0.45))
        clr.inputs["To Min"].default_value = 1.0
        clr.inputs["To Max"].default_value = 0.0
        L.new(dot.outputs["Value"], clr.inputs["Value"])
        sepd = N.new("ShaderNodeSeparateXYZ")
        L.new(tc.outputs["Generated"], sepd.inputs[0])
        hz = N.new("ShaderNodeMapRange")
        hz.inputs["From Min"].default_value = 0.0
        hz.inputs["From Max"].default_value = math.sin(math.radians(float(cs.get("horizonFadeDeg", 4.0))))
        L.new(sepd.outputs["Z"], hz.inputs["Value"])
        m = math_node("MULTIPLY", mask, clr.outputs[0])
        m = math_node("MULTIPLY", m, hz.outputs[0])
        self.coverage = N.new("ShaderNodeValue")
        self.coverage.outputs[0].default_value = float(cs.get("coverage", 0.85))
        m = math_node("MULTIPLY", m, self.coverage.outputs[0])
        # brightness: relative cloud shade x luminance of the physical sky there x gain x (1 - darken x dusk)
        bw = N.new("ShaderNodeRGBToBW")
        L.new(self.sky.outputs[0], bw.inputs[0])
        self.gain = N.new("ShaderNodeValue")
        lumv = math_node("MULTIPLY", math_node("MULTIPLY", shade, bw.outputs[0]), self.gain.outputs[0])
        # tint: the sky colour at the horizon under the sun, normalised to unit luminance, mixed in by glowTint
        glow = sky_node()
        glow.sun_disc = False
        self.glow = glow
        self.glow_dir = N.new("ShaderNodeCombineXYZ")
        L.new(self.glow_dir.outputs[0], glow.inputs["Vector"])
        gbw = N.new("ShaderNodeRGBToBW")
        L.new(glow.outputs[0], gbw.inputs[0])
        inv = math_node("DIVIDE", 1.0, math_node("MAXIMUM", gbw.outputs[0], 1e-6))
        gnorm = vec_node("SCALE", glow.outputs[0])
        L.new(inv, gnorm.inputs["Scale"])
        # the lit side of a cloud is white with a little of the blue of the sky around it (`skyTint`): a white cloud on a
        # blue sky, never a grey veil; towards sunset the glow colour takes over (`glowTint`, faded in below `glowBelowDeg`)
        inv_sky = math_node("DIVIDE", 1.0, math_node("MAXIMUM", bw.outputs[0], 1e-6))
        snorm = vec_node("SCALE", self.sky.outputs[0])
        L.new(inv_sky, snorm.inputs["Scale"])
        base = N.new("ShaderNodeMix")
        base.data_type = "RGBA"
        base.inputs[0].default_value = float(cs.get("skyTint", 0.0))
        base.inputs[6].default_value = (1.0, 1.0, 1.0, 1.0)
        L.new(snorm.outputs[0], base.inputs[7])
        tint = N.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.inputs[0].default_value = float(cs.get("glowTint", 0.45))
        L.new(base.outputs[2], tint.inputs[6])
        L.new(gnorm.outputs[0], tint.inputs[7])
        self.tint = tint
        col = vec_node("SCALE", tint.outputs[2])
        L.new(lumv, col.inputs["Scale"])
        # in the twilight the clouds take the colour of the sky behind them (shade x gain x sky colour): they stay in the
        # blue of the blue hour instead of turning the glow colour brown
        dusk_col = vec_node("SCALE", self.sky.outputs[0])
        L.new(math_node("MULTIPLY", shade, self.gain.outputs[0]), dusk_col.inputs["Scale"])
        self.dusk_mix = N.new("ShaderNodeMix")
        self.dusk_mix.data_type = "RGBA"
        L.new(col.outputs[0], self.dusk_mix.inputs[6])
        L.new(dusk_col.outputs[0], self.dusk_mix.inputs[7])
        # same strength as the sky background (the cloud colour is emitted through a Background node of strength 1)
        self.cloud_strength = N.new("ShaderNodeValue")
        col2 = vec_node("SCALE", self.dusk_mix.outputs[2])
        L.new(self.cloud_strength.outputs[0], col2.inputs["Scale"])
        bg2 = N.new("ShaderNodeBackground")
        g_cl = N.new("ShaderNodeGroup")
        g_cl.node_tree = self.grade
        L.new(col2.outputs[0], g_cl.inputs[0])
        L.new(g_cl.outputs[0], bg2.inputs["Color"])
        bg2.inputs["Strength"].default_value = 1.0
        # the sky that the camera (and the glazing) sees: `look.skyCamera` gain and saturation, like a photographer's
        # polariser; the light of the scene stays the physical sky
        sk = self.cfg["look"].get("skyCamera") or {}
        g_sky = N.new("ShaderNodeGroup")
        g_sky.node_tree = self.grade
        L.new(self.sky.outputs[0], g_sky.inputs[0])
        self.bg_cam = N.new("ShaderNodeBackground")
        L.new(g_sky.outputs[0], self.bg_cam.inputs["Color"])
        self.cam_gain = float(sk.get("gain", 1.0))
        mix_c = N.new("ShaderNodeMixShader")
        L.new(m, mix_c.inputs[0])
        L.new(self.bg_cam.outputs[0], mix_c.inputs[1])
        L.new(bg2.outputs[0], mix_c.inputs[2])
        lp = N.new("ShaderNodeLightPath")
        rays = {"camera": "Is Camera Ray", "glossy": "Is Glossy Ray", "transmission": "Is Transmission Ray"}
        want = [rays[k] for k in (cs.get("visibleTo") or ("camera", "glossy")) if k in rays] or ["Is Camera Ray"]
        cam_or_gloss = lp.outputs[want[0]]
        for name in want[1:]:
            cam_or_gloss = math_node("MAXIMUM", cam_or_gloss, lp.outputs[name])
        final = N.new("ShaderNodeMixShader")
        L.new(cam_or_gloss, final.inputs[0])
        L.new(self.bg.outputs[0], final.inputs[1])
        L.new(mix_c.outputs[0], final.inputs[2])
        L.new(final.outputs[0], out.inputs[0])
        self.cs = cs
        log("clouds: on (%s rays), coverage %.2f" % ("+".join(cs.get("visibleTo") or ("camera", "glossy")),
                                                     self.coverage.outputs[0].default_value))
        return True

    @property
    def dusk(self):
        """0 in daylight .. 1 in the blue hour (the smooth step of `look.dusk`), for the lamps and the white balance."""
        return self._dusk

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
        rot = float(sun["blender"]["sunRotationRad"])
        for k in self.sky_nodes:
            k.sun_elevation = elev
            k.sun_rotation = rot
        self.bg.inputs["Strength"].default_value = strength
        self.haze_strength.default_value = strength * float((lk.get("skyCamera") or {}).get("gain", 1.0))
        d = lk["dusk"]
        self._dusk = smoothstep(d["fromElevationDeg"], d["toElevationDeg"], elev_deg)
        self._ev = d["ev"] * self._dusk
        self.grade_mix.inputs[0].default_value = float((lk.get("twilight") or {}).get("amount", 0.0)) * self._dusk
        if self.clouds:
            cs = self.cs
            # the sun direction of the data (`sun.direction`, house frame = world)
            sd = sun.get("direction") or [math.sin(rot) * math.cos(elev), math.cos(rot) * math.cos(elev), math.sin(elev)]
            for k, v in zip(("X", "Y", "Z"), sd):
                self.sun_dir.inputs[k].default_value = float(v)
            self.glow.sun_elevation = elev
            self.glow.sun_rotation = rot
            g = (math.sin(rot), math.cos(rot), math.sin(math.radians(2.0)))
            for k, v in zip(("X", "Y", "Z"), g):
                self.glow_dir.inputs[k].default_value = float(v)
            self.gain.outputs[0].default_value = (float(cs.get("gain", 1.25)) * float(cs.get("strength", 1.0))
                                                  * (1.0 - float(cs.get("duskDarken", 0.5)) * self._dusk))
            self.cloud_strength.outputs[0].default_value = strength
            self.bg_cam.inputs["Strength"].default_value = strength * self.cam_gain
            self.dusk_mix.inputs[0].default_value = self._dusk
            self.tint.inputs[0].default_value = float(cs.get("glowTint", 0.45)) * smoothstep(
                float(cs.get("glowBelowDeg", 20.0)), float(cs.get("glowBelowDeg", 20.0)) * 0.25, elev_deg)
            cov = float(cs.get("coverage", 0.85))
            self.coverage.outputs[0].default_value = cov + (float(cs.get("duskCoverage", cov)) - cov) * self._dusk
        return self._ev
