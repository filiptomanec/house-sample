"""Camera from the `camera` object of a shot (docs/RENDER-INPUTS.md, section 3)."""
from __future__ import annotations

import math

from mathutils import Quaternion, Vector


def make_camera():
    import bpy
    data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.rotation_mode = "QUATERNION"
    data.sensor_fit = "AUTO"
    data.dof.use_dof = False
    return cam


def camera_pose(c):
    """(location Vector, rotation Quaternion) of a camera dict."""
    quat = Vector(c["forward"]).to_track_quat("-Z", "Y")
    if c.get("roll"):
        quat = quat @ Quaternion((0.0, 0.0, 1.0), math.radians(-float(c["roll"])))
    return Vector(c["position"]), quat


def apply_camera(cam, c, size, min_far=0.0):
    import bpy
    loc, quat = camera_pose(c)
    cam.location = loc
    cam.rotation_quaternion = quat
    d = cam.data
    d.sensor_fit = "AUTO"
    d.sensor_width = float(c.get("sensorWidthMm", 36))
    d.lens = float(c["focalMm"])
    sh = c.get("shift") or [0.0, 0.0]
    d.shift_x, d.shift_y = float(sh[0]), float(sh[1])
    # the far clip reaches the end of the far ground (the renderer's own horizon), whatever the shot asks for
    d.clip_start, d.clip_end = float(c.get("near", 0.1)), max(float(c.get("far", 600)), float(min_far))
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = int(size[0]), int(size[1])
    sc.render.resolution_percentage = 100
    sc.render.pixel_aspect_x = sc.render.pixel_aspect_y = 1.0
