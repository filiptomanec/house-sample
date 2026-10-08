"""Shading helpers shared by the scene parts.

`desaturate_bounces`: green light bounced from the lawn and the foliage tints the shaded white walls (an olive cast,
review renders-09). A real camera sees it too, but a photographer would correct it and our eye discounts it. The vegetation
therefore shows its true colour to camera and glossy rays and a desaturated one to diffuse rays (Light Path "Is Diffuse Ray"):
the walls receive the brightness of the bounce without its saturation (`look.bounceSaturation`)."""
from __future__ import annotations

COLOR_INPUTS = {"BSDF_PRINCIPLED": "Base Color", "BSDF_TRANSLUCENT": "Color", "BSDF_DIFFUSE": "Color"}


def desaturate_bounces(m, sat):
    """Inserts the diffuse-ray desaturation in front of every colour input of the BSDFs of material `m` (once)."""
    if m is None or not m.use_nodes or m.get("bounce_desat") is not None:
        return False
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    lp = None
    done = False
    for node in list(N):
        name = COLOR_INPUTS.get(node.type)
        if not name or name not in node.inputs:
            continue
        sock = node.inputs[name]
        lp = lp or N.new("ShaderNodeLightPath")
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        hsv = N.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = sat
        if sock.links:
            src = sock.links[0].from_socket
            L.new(src, hsv.inputs["Color"])
            L.new(src, mix.inputs[6])
        else:
            hsv.inputs["Color"].default_value = sock.default_value
            mix.inputs[6].default_value = sock.default_value
        L.new(lp.outputs["Is Diffuse Ray"], mix.inputs[0])
        L.new(hsv.outputs[0], mix.inputs[7])
        L.new(mix.outputs[2], sock)
        done = True
    m["bounce_desat"] = sat
    return done


def materials_of(objects):
    """Materials of the objects, including those of instanced collections (recursively)."""
    seen, out = set(), []

    def visit(ob, depth=0):
        if ob.instance_type == "COLLECTION" and ob.instance_collection and depth < 4:
            for o in ob.instance_collection.all_objects:
                visit(o, depth + 1)
        for slot in getattr(ob, "material_slots", []):
            m = slot.material
            if m is not None and m.name not in seen:
                seen.add(m.name)
                out.append(m)
        for mod in getattr(ob, "modifiers", []):
            ng = getattr(mod, "node_group", None)
            if ng is None:
                continue
            for n in ng.nodes:
                col = n.inputs["Collection"].default_value if n.type == "COLLECTION_INFO" else None
                if col is not None:
                    for o in col.all_objects:
                        visit(o, depth + 1)
    for ob in objects:
        visit(ob)
    return out
