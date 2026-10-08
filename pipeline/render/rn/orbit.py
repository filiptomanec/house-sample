"""Orbit: the camera path of a variant is animated (one linear key per frame, closed loop) so that Cycles can blur the camera
motion over a short shutter. At 1.2 degrees per frame the lawn in the foreground moves tens of pixels per frame; without
blur it would strobe in the video. Only the camera moves; the sun, lamps and blinds are fixed for the whole orbit."""
from __future__ import annotations

from . import cameras

F0 = 1000          # first frame number (the animation is evaluated at F0 + index)


def prepare(scn, shots, mode_cfg):
    sc = scn.sc
    variant = shots[0]["variant"]
    v = next(x for x in scn.inputs["orbit"]["variants"] if x["id"] == variant)
    frames = v["frames"]
    cam = scn.cam
    if cam.animation_data:
        cam.animation_data_clear()
    cam.rotation_mode = "QUATERNION"
    first = frames[0]["index"]
    last = frames[-1]["index"]
    step = frames[1]["index"] - first if len(frames) > 1 else 1
    prev = None
    keys = [(F0 + f["index"], f["camera"]) for f in frames]
    # close the loop: one key before the first and one after the last (the neighbours across the seam)
    keys.insert(0, (F0 + first - step, frames[-1]["camera"]))
    keys.append((F0 + last + step, frames[0]["camera"]))
    for frame, c in keys:
        loc, quat = cameras.camera_pose(c)
        if prev is not None:
            quat.make_compatible(prev)
        prev = quat
        cam.location = loc
        cam.rotation_quaternion = quat
        cam.keyframe_insert("location", frame=frame)
        cam.keyframe_insert("rotation_quaternion", frame=frame)
    if cam.animation_data and cam.animation_data.action:
        for fc in _fcurves(cam.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    blur = float(mode_cfg.get("motionBlur", 0.0))
    sc.render.use_motion_blur = blur > 0
    sc.render.motion_blur_shutter = blur
    sc.render.motion_blur_position = "CENTER"


def _fcurves(action):
    """F-curves of an action in Blender 4 and 5 (layered actions keep them in slots / channelbags)."""
    try:
        return list(action.fcurves)
    except AttributeError:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out


def set_frame(scn, shot):
    scn.sc.frame_set(F0 + int(shot["index"]))
