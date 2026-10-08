"""Frame QA (`photo.py --qa`): the acceptance numbers of a rendered frame (docs/PIPELINE-RENDER.md, section 8).

After a frame is written, a second, cheap render replaces every material by a flat key colour (emission, no lights matter):
the facade plaster red, the glazing green, the sky blue, everything else black. That key image is an exact pixel mask of the
frame, so the numbers are measured on the picture as the viewer sees it (the JPEG, display-referred, white balance included).
"Plaster" means the white surfaces: the facade plaster outside, the interior plaster and the ceilings inside.

* `meanGrey`: mean luma of the frame (Rec. 709 weights on the sRGB values);
* `skyBR`: mean blue over mean red of the sky pixels (a milky sky is near 1.0);
* `plasterChroma`: the largest deviation of a channel from the grey of the shaded plaster (the darker 60 % of the plaster
  pixels, linear light): a colour cast of the white walls;
* `glassEv`: how many stops the glazing is brighter than the plaster (linear light): lit windows at dusk;
* `skyShare`, `plasterShare`, `glassShare`: the shares of the frame.
The results go to `<out>/qa.json` (one entry per frame file) and to the log.
"""
from __future__ import annotations

import json
import math
import os
import tempfile

KEYS = {"plaster": (1.0, 0.0, 0.0), "plaster_in": (1.0, 0.0, 0.0), "ceiling": (1.0, 0.0, 0.0), "glass": (0.0, 1.0, 0.0)}
SKY = (0.0, 0.0, 1.0)


def _emission(nt, color):
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1.0)
    em.inputs["Strength"].default_value = 1.0
    return em


def key_render(size, keep=None):
    """Renders the key image at `size` and returns it as a float array (h, w, 3), rows top to bottom. `keep`: a path to save
    the key image to (EXR, for checking the masks)."""
    import bpy
    import numpy as np
    sc = bpy.context.scene
    saved_links = []
    added = []
    for m in bpy.data.materials:
        if not m.use_nodes or not m.node_tree:
            continue
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or \
            next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None:
            continue
        for sock in ("Surface", "Volume", "Displacement"):
            for l in list(out.inputs[sock].links):
                saved_links.append((nt, l.from_socket, out.inputs[sock]))
                nt.links.remove(l)
        em = _emission(nt, KEYS.get(m.name.split(".")[0], (0.0, 0.0, 0.0)))
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        added.append((nt, em))
    w_nt = sc.world.node_tree
    w_out = next(n for n in w_nt.nodes if n.type == "OUTPUT_WORLD")
    w_saved = [(l.from_socket, l.to_socket) for l in w_out.inputs["Surface"].links]
    for l in list(w_out.inputs["Surface"].links):
        w_nt.links.remove(l)
    bg = w_nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*SKY, 1.0)
    w_nt.links.new(bg.outputs[0], w_out.inputs["Surface"])
    vs, cy, rd = sc.view_settings, sc.cycles, sc.render
    saved = (vs.view_transform, vs.look, vs.exposure, getattr(vs, "use_white_balance", False), cy.samples, cy.use_denoising,
             cy.use_adaptive_sampling, rd.image_settings.file_format, rd.image_settings.color_depth, rd.filepath,
             rd.use_motion_blur, cy.max_bounces)
    vs.view_transform, vs.look, vs.exposure = "Standard", "None", 0.0
    if hasattr(vs, "use_white_balance"):
        vs.use_white_balance = False
    cy.samples, cy.use_denoising, cy.use_adaptive_sampling, cy.max_bounces = 4, False, False, 0
    rd.image_settings.file_format, rd.image_settings.color_depth = "OPEN_EXR", "32"
    rd.use_motion_blur = False
    tmp = os.path.join(tempfile.gettempdir(), "render_qa_%d.exr" % os.getpid())
    rd.filepath = tmp
    glare = sc.compositing_node_group if hasattr(sc, "compositing_node_group") else None
    if glare is not None:
        sc.compositing_node_group = None
    try:
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)[::-1, :, :3]
        bpy.data.images.remove(img)
    finally:
        if glare is not None:
            sc.compositing_node_group = glare
        for nt, em in added:
            nt.nodes.remove(em)
        for nt, a, b in saved_links:
            nt.links.new(a, b)
        w_nt.nodes.remove(bg)
        for a, b in w_saved:
            w_nt.links.new(a, b)
        (vs.view_transform, vs.look, vs.exposure, wb, cy.samples, cy.use_denoising, cy.use_adaptive_sampling,
         rd.image_settings.file_format, rd.image_settings.color_depth, rd.filepath, rd.use_motion_blur, cy.max_bounces) = saved
        if hasattr(vs, "use_white_balance"):
            vs.use_white_balance = wb
        try:
            if keep:
                os.replace(tmp, keep)
            else:
                os.remove(tmp)
        except OSError:
            pass
    return px


def load_jpeg(path):
    """The written frame as float sRGB values (h, w, 3), rows top to bottom."""
    import bpy
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]
    bpy.data.images.remove(img)
    return px


def metrics(frame, key):
    """The numbers of the module doc from the frame (sRGB, 0..1) and its key image."""
    import numpy as np
    lin = np.where(frame <= 0.04045, frame / 12.92, ((frame + 0.055) / 1.055) ** 2.4)
    luma = frame @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    llin = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sky = (key[..., 2] > 0.5) & (key[..., 0] < 0.5) & (key[..., 1] < 0.5)
    plaster = (key[..., 0] > 0.5) & (key[..., 1] < 0.5) & (key[..., 2] < 0.5)
    glass = (key[..., 1] > 0.5) & (key[..., 0] < 0.5) & (key[..., 2] < 0.5)
    n = float(frame.shape[0] * frame.shape[1])
    out = {"meanGrey": round(float(luma.mean()), 4), "skyShare": round(float(sky.sum() / n), 4),
           "plasterShare": round(float(plaster.sum() / n), 4), "glassShare": round(float(glass.sum() / n), 4)}
    if sky.sum() > 50:
        out["skyBR"] = round(float(frame[sky][:, 2].mean() / max(frame[sky][:, 0].mean(), 1e-4)), 3)
    if plaster.sum() > 50:
        pl = llin[plaster]
        shaded = plaster & (llin <= np.percentile(pl, 60))
        c = lin[shaded].mean(axis=0)
        g = float(c.mean())
        out["plasterChroma"] = round(float(np.abs(c / max(g, 1e-6) - 1.0).max()), 4)
        out["plasterRGB"] = [round(float(v), 4) for v in c]
        if glass.sum() > 50:
            out["glassEv"] = round(math.log2(max(float(llin[glass].mean()), 1e-6) / max(float(pl.mean()), 1e-6)), 2)
    return out


def measure(path, size):
    """Key render + metrics of the frame written at `path` (RENDER_QA_KEEP=1 keeps the key image as `<path>.key.exr`)."""
    keep = path + ".key.exr" if os.environ.get("RENDER_QA_KEEP") else None
    return metrics(load_jpeg(path), key_render(size, keep))


def append_report(out_dir, file_id, data):
    path = os.path.join(out_dir, "qa.json")
    rep = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                rep = json.load(f)
        except (OSError, ValueError):
            rep = {}
    rep[file_id] = data
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, sort_keys=True)
