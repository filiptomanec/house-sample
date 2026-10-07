"""Cycles settings: GPU (Metal, CUDA, OptiX, HIP, oneAPI) with a CPU fallback, OIDN denoising with albedo and normal guides,
fixed seed, AgX colour management, a gentle glare in the compositor (Blender 5: compositing_node_group)."""
from __future__ import annotations

import os

from .util import log


def pick_device(sc, want=None):
    """Enable the best GPU backend; returns a short description. RENDER_DEVICE=cpu forces the CPU."""
    import bpy
    want = (want or os.environ.get("RENDER_DEVICE") or "auto").lower()
    if want == "cpu":
        sc.cycles.device = "CPU"
        return "CPU (forced)"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
            except Exception:
                continue
            gpus = [d for d in prefs.devices if d.type == backend]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == backend
                sc.cycles.device = "GPU"
                return "%s: %s" % (backend, ", ".join(d.name for d in gpus))
    except Exception as e:  # pragma: no cover
        log("GPU setup failed:", e)
    sc.cycles.device = "CPU"
    return "CPU (no GPU found)"


def setup(cfg, device=None):
    import bpy
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy, c = sc.cycles, cfg["cycles"]
    dev = pick_device(sc, device)
    cy.use_denoising = True
    cy.denoiser = c["denoiser"]
    cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cy.denoising_prefilter = "ACCURATE"
    for attr, val in (("denoising_quality", "HIGH"), ("denoising_use_gpu", True)):
        try:
            setattr(cy, attr, val)
        except Exception:
            pass
    cy.max_bounces = c["maxBounces"]
    cy.diffuse_bounces = c["diffuseBounces"]
    cy.glossy_bounces = c["glossyBounces"]
    cy.transmission_bounces = c["transmissionBounces"]
    cy.volume_bounces = c["volumeBounces"]
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_indirect = c["clampIndirect"]
    cy.sample_clamp_direct = c["clampDirect"]
    cy.blur_glossy = c["blurGlossy"]
    cy.use_adaptive_sampling = True
    cy.use_animated_seed = False
    sc.render.use_persistent_data = True          # the scene is synced once; only camera, sky, lamps and blinds change
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.color_mode = "RGB"
    lk = cfg["look"]
    sc.view_settings.view_transform = lk["viewTransform"]
    try:
        sc.view_settings.look = lk["look"]
    except Exception as e:
        log("look %r not available (%s)" % (lk["look"], e))
    sc.view_settings.exposure = lk["exposure"]
    sc.display_settings.display_device = "sRGB"
    try:
        sc.render.use_stamp = False
    except Exception:
        pass
    return dev


def setup_glare(cfg):
    """Soft glow around bright lamps and the sun disc. Compositor API of Blender 5 (a node group assigned to the scene);
    returns True when it could be built."""
    import bpy
    g = cfg["look"]["glare"]
    sc = bpy.context.scene
    try:
        grp = bpy.data.node_groups.new("render_glare", "CompositorNodeTree")
        n_in = grp.nodes.new("CompositorNodeRLayers")
        n_glare = grp.nodes.new("CompositorNodeGlare")
        n_out = grp.nodes.new("NodeGroupOutput")
        grp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        n_glare.glare_type = "FOG_GLOW"
        for key, val in (("Threshold", g["threshold"]), ("Mix", g["mix"]), ("Size", g["size"]), ("Strength", 0.4)):
            if key in n_glare.inputs:
                n_glare.inputs[key].default_value = val
        grp.links.new(n_in.outputs["Image"], n_glare.inputs["Image"])
        grp.links.new(n_glare.outputs["Image"], n_out.inputs[0])
        sc.compositing_node_group = grp
        return True
    except Exception as e:
        log("compositor glare skipped:", e)
        return False


def apply_mode(sc, mode_cfg, seed):
    sc.cycles.samples = int(mode_cfg["samples"])
    sc.cycles.adaptive_threshold = float(mode_cfg["threshold"])
    sc.cycles.seed = int(seed)
    sc.render.image_settings.quality = int(mode_cfg["quality"])
