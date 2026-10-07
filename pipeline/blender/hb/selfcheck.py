"""Cheap geometric self-checks on the collected polygons (pure Python): non-finite coordinates, degenerate or non-planar
faces, and duplicated faces (the usual cause of z-fighting). Returns (errors, warnings)."""
from __future__ import annotations

import math

from . import geom as G


def check(ms, planar_tol=2e-3):
    errors, warnings = [], []
    seen = {}
    for nd in ms.sorted_nodes():
        for fi, f in enumerate(nd.faces):
            pts = [nd.verts[i] for i in f]
            tag = "%s face %d" % (nd.name, fi)
            if any(not math.isfinite(c) for p in pts for c in p):
                errors.append("%s: non-finite coordinate" % tag)
                continue
            n = G.newell(pts)
            ln = G.length(n)
            if ln < 1e-9:
                errors.append("%s: degenerate (zero area)" % tag)
                continue
            nn = G.mul(n, 1.0 / ln)
            d0 = G.dot(nn, pts[0])
            dev = max(abs(G.dot(nn, p) - d0) for p in pts)
            if dev > planar_tol:
                errors.append("%s: not planar (deviation %.4f m)" % (tag, dev))
            if len(nd.uvs[fi]) != len(pts) or any(not math.isfinite(c) for q in nd.uvs[fi] for c in q):
                errors.append("%s: bad UVs" % tag)
            # duplicates: same vertex set (rounded to 0.1 mm) in the same winding
            key = tuple(sorted(tuple(round(c, 4) for c in p) for p in pts))
            prev = seen.get(key)
            if prev is not None:
                same = G.dot(prev[1], nn) > 0
                msg = "%s duplicates %s%s" % (tag, prev[0], "" if same else " (opposite winding)")
                (errors if same else warnings).append(msg)
            else:
                seen[key] = (tag, nn)
    return errors, warnings
