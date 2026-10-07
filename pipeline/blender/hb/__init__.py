"""House builder: procedural, data-driven model of the house for Blender.

Everything here is driven by `generated/derived.json`, `model/house.json` and `model/style.json`; no coordinates or
dimensions of the house live in the code. Geometry modules are pure Python (importable without Blender) and collect
polygons in a `MeshSet`; only `mesh.to_blender`, `materials` and the exporters import `bpy`.
House frame: x east, y north, z up, metres; z = 0 is the top of the finished floor.
"""
