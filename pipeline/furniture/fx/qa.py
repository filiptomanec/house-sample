"""Geometry QA (numpy only): coplanar overlapping faces (they render black / z-fight) and basic mesh sanity."""
import numpy as np


def coplanar(soup, tol=3e-4, min_area=2e-5):
    """Pairs of parts that have axis-aligned faces in the same plane, facing the same way, with overlapping extents.
    Returns a list of dicts {a, b, axis, coord, area} (parts as indices into soup.parts)."""
    planes = {}
    for pi, p in enumerate(soup.parts):
        pos = p['pos']
        n = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
        ln = np.linalg.norm(n, axis=1)
        ok = ln > 1e-10
        n = n / np.maximum(ln[:, None], 1e-12)
        for ax in range(3):
            c = pos[:, :, ax]
            flat = ok & (np.abs(n[:, ax]) > 0.9999) & ((c.max(1) - c.min(1)) < 1e-5)
            for t in np.nonzero(flat)[0]:
                sgn = 1 if n[t, ax] > 0 else -1
                if ax == 2 and sgn < 0:
                    continue          # undersides are never seen
                key = (ax, sgn, int(round(c[t].mean() / tol)))
                o = [k for k in range(3) if k != ax]
                rect = (pos[t][:, o[0]].min(), pos[t][:, o[1]].min(), pos[t][:, o[0]].max(), pos[t][:, o[1]].max())
                planes.setdefault(key, []).append((pi, rect))
    out = []
    seen = set()
    for key, lst in planes.items():
        if len(lst) < 2:
            continue
        # neighbours in the next bucket count as the same plane
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                (a, ra), (b, rb) = lst[i], lst[j]
                if a == b:
                    continue
                w = min(ra[2], rb[2]) - max(ra[0], rb[0])
                h = min(ra[3], rb[3]) - max(ra[1], rb[1])
                if w > 1e-4 and h > 1e-4 and w * h > min_area:
                    k = (min(a, b), max(a, b), key[0], key[2])
                    if k in seen:
                        continue
                    seen.add(k)
                    out.append({'a': a, 'b': b, 'axis': 'xyz'[key[0]], 'coord': round(key[2] * tol, 4), 'area': round(w * h, 5),
                                'mats': (soup.parts[a]['mat'], soup.parts[b]['mat'])})
    return out


def sanity(soup):
    """Counts of NaN positions or normals and zero-area triangles."""
    bad = 0
    degenerate = 0
    for p in soup.parts:
        if not (np.isfinite(p['pos']).all() and np.isfinite(p['nrm']).all()):
            bad += 1
        pos = p['pos']
        area = np.linalg.norm(np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0]), axis=1)
        degenerate += int((area < 1e-12).sum())
    return {'nonfinite_parts': bad, 'degenerate_triangles': degenerate}
