"""Triangle-soup geometry in plain numpy.

Generators return (V, F, N): vertices (n, 3), triangles (m, 3) and per-vertex normals (n, 3). A `Soup` collects parts
(one generator call = one part, one material) and keeps per-corner positions and normals, which is what the glTF
export needs. Units are metres; z is up.
"""
import math
import numpy as np


# ----------------------------------------------------------------------------------------------------------------------
# matrices
# ----------------------------------------------------------------------------------------------------------------------

def T(x=0.0, y=0.0, z=0.0):
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 1], m[1, 0], m[1, 1] = c, -s, s, c
    return m


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[1, 1], m[1, 2], m[2, 1], m[2, 2] = c, -s, s, c
    return m


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c
    return m


def Sc(sx, sy=None, sz=None):
    m = np.eye(4)
    m[0, 0], m[1, 1], m[2, 2] = sx, (sx if sy is None else sy), (sx if sz is None else sz)
    return m


def align_z(d):
    """Rotation matrix taking +z to the direction d."""
    d = np.asarray(d, float)
    L = np.linalg.norm(d)
    if L < 1e-12:
        return np.eye(4)
    d = d / L
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(z, d)
    c = float(np.dot(z, d))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(4) if c > 0 else Rx(math.pi)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    R = np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))
    m = np.eye(4)
    m[:3, :3] = R
    return m


def apply(M, V):
    return V @ M[:3, :3].T + M[:3, 3]


def apply_n(M, N):
    A = np.linalg.inv(M[:3, :3]).T
    out = N @ A.T
    n = np.linalg.norm(out, axis=-1, keepdims=True)
    return out / np.maximum(n, 1e-12)


# ----------------------------------------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------------------------------------

def quads_to_tris(Q):
    Q = np.asarray(Q, np.int64).reshape(-1, 4)
    return np.concatenate([Q[:, [0, 1, 2]], Q[:, [0, 2, 3]]], axis=0)


def orient_outward(V, F, N):
    """Flip triangles whose geometric normal points against the mean vertex normal."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    gn = np.cross(b - a, c - a)
    vn = N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]]
    bad = np.einsum('ij,ij->i', gn, vn) < 0
    F = F.copy()
    F[bad] = F[bad][:, [0, 2, 1]]
    return F


def smooth_normals(V, F):
    """Area-weighted vertex normals of an indexed mesh."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    fn = np.cross(b - a, c - a)
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    n = np.linalg.norm(N, axis=1, keepdims=True)
    return N / np.maximum(n, 1e-12)


def flat_mesh(V, F):
    """Un-weld an indexed mesh and give every triangle its own face normal (hard edges)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    fn = np.cross(b - a, c - a)
    fn = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    V2 = np.concatenate([a, b, c], axis=0)
    m = len(F)
    F2 = np.stack([np.arange(m), np.arange(m) + m, np.arange(m) + 2 * m], axis=1)
    N2 = np.concatenate([fn, fn, fn], axis=0)
    return V2, F2, N2


# ----------------------------------------------------------------------------------------------------------------------
# generators
# ----------------------------------------------------------------------------------------------------------------------

def gen_box(hx, hy, hz):
    """Plain box centred at the origin, hard edges (24 vertices, 12 triangles)."""
    X, Y, Z = hx, hy, hz
    faces = [
        ((X, -Y, -Z), (X, Y, -Z), (X, Y, Z), (X, -Y, Z), (1, 0, 0)),
        ((-X, Y, -Z), (-X, -Y, -Z), (-X, -Y, Z), (-X, Y, Z), (-1, 0, 0)),
        ((X, Y, -Z), (-X, Y, -Z), (-X, Y, Z), (X, Y, Z), (0, 1, 0)),
        ((-X, -Y, -Z), (X, -Y, -Z), (X, -Y, Z), (-X, -Y, Z), (0, -1, 0)),
        ((-X, -Y, Z), (X, -Y, Z), (X, Y, Z), (-X, Y, Z), (0, 0, 1)),
        ((-X, Y, -Z), (X, Y, -Z), (X, -Y, -Z), (-X, -Y, -Z), (0, 0, -1)),
    ]
    V, N, Q = [], [], []
    for i, f in enumerate(faces):
        V += list(f[:4])
        N += [f[4]] * 4
        Q.append([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3])
    return np.array(V, float), quads_to_tris(Q), np.array(N, float)



def gen_cbox(hx, hy, hz, r):
    """Chamfered box with smooth (bevel-like) shading: every face keeps its own normal and the 45 degree strips between
    faces interpolate them, so the edges read as rounded for 44 triangles."""
    r = min(r, 0.45 * min(hx, hy, hz))
    if r < 5e-4:
        return gen_box(hx, hy, hz)
    h = np.array([hx, hy, hz])
    V, N, idx = [], [], {}
    # face vertices: face (axis a, sign s), corner signs (u, v) on the two other axes
    for a in range(3):
        b, c = [k for k in range(3) if k != a]
        for s in (-1, 1):
            n = np.zeros(3)
            n[a] = s
            for u in (-1, 1):
                for v in (-1, 1):
                    p = np.zeros(3)
                    p[a], p[b], p[c] = s * h[a], u * (h[b] - r), v * (h[c] - r)
                    idx[(a, s, b, u, c, v)] = len(V)
                    V.append(p)
                    N.append(n)

    def fv(a, s, k1, s1, k2, s2):
        """Vertex of face (a, s) at corner (axis k1 sign s1, axis k2 sign s2) (axes in any order)."""
        b, c = [k for k in range(3) if k != a]
        sb = s1 if k1 == b else s2
        sc = s1 if k1 == c else s2
        return idx[(a, s, b, sb, c, sc)]
    F = []
    for a in range(3):
        b, c = [k for k in range(3) if k != a]
        for s in (-1, 1):
            q = [fv(a, s, b, u, c, v) for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            F += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
    # edge strips between faces (a, sa) and (b, sb): the shared edge runs along the third axis c
    for a in range(3):
        for b in range(a + 1, 3):
            c = 3 - a - b
            for sa in (-1, 1):
                for sb in (-1, 1):
                    A = [fv(a, sa, b, sb, c, w) for w in (-1, 1)]
                    B = [fv(b, sb, a, sa, c, w) for w in (-1, 1)]
                    F += [(A[0], A[1], B[1]), (A[0], B[1], B[0])]
    # corner triangles
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                F.append((fv(0, sx, 1, sy, 2, sz), fv(1, sy, 0, sx, 2, sz), fv(2, sz, 0, sx, 1, sy)))
    V = np.array(V)
    N = np.array(N)
    F = np.array(F, np.int64)
    return V, orient_outward(V, F, np.array([v / np.linalg.norm(v) for v in V])), N


_LATTICE_CACHE = {}


def _rbox_topology(s):
    """Surface lattice of a rounded box: vertex ids per lattice index and the triangles (outward by construction)."""
    if s in _LATTICE_CACHE:
        return _LATTICE_CACHE[s]
    n = 2 * s + 2
    ids = -np.ones((n, n, n), np.int64)
    k = 0
    pts = []
    for i in range(n):
        for j in range(n):
            for l in range(n):
                if i in (0, n - 1) or j in (0, n - 1) or l in (0, n - 1):
                    ids[i, j, l] = k
                    pts.append((i, j, l))
                    k += 1
    Q = []
    for i in range(n - 1):
        for j in range(n - 1):
            for face in (0, n - 1):
                Q.append((ids[face, i, j], ids[face, i + 1, j], ids[face, i + 1, j + 1], ids[face, i, j + 1]))
                Q.append((ids[i, face, j], ids[i + 1, face, j], ids[i + 1, face, j + 1], ids[i, face, j + 1]))
                Q.append((ids[i, j, face], ids[i + 1, j, face], ids[i + 1, j + 1, face], ids[i, j + 1, face]))
    out = (np.array(pts, np.int64), quads_to_tris(Q))
    _LATTICE_CACHE[s] = out
    return out


def gen_rbox(hx, hy, hz, r, s=1):
    """Rounded box centred at the origin: half sizes hx, hy, hz, corner radius r, `s` lattice steps per face side
    of every corner (s=1: the 90 degree arc is cut in two segments). Smooth analytic normals."""
    r = min(r, 0.49 * min(hx, hy, hz))
    if r < 5e-4:
        return gen_box(hx, hy, hz)
    pts, F = _rbox_topology(s)
    h = np.array([hx, hy, hz])
    c = h - r
    k = np.arange(s + 1) / s
    axes = []
    for a in range(3):
        axes.append(np.concatenate([-h[a] + r * k, c[a] + r * k]))
    Q = np.stack([axes[0][pts[:, 0]], axes[1][pts[:, 1]], axes[2][pts[:, 2]]], axis=1)
    P = np.clip(Q, -c, c)
    v = Q - P
    N = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    V = P + r * N
    return V, orient_outward(V, F, N), N


def gen_lathe(prof, seg=16, close=False):
    """Surface of revolution about z. prof: list of (r, z) or (r, z, 'h') points bottom to top; 'h' makes the point a
    hard crease (two vertex rings with the normals of the two adjoining segments). The outside lies at +r."""
    pts = [(float(p[0]), float(p[1]), len(p) > 2 and p[2] == 'h') for p in prof]
    n = len(pts)
    # per-segment 2D outward normals (dz, -dr)
    segn = []
    for i in range(n - 1):
        dr, dz = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        L = math.hypot(dr, dz) or 1.0
        segn.append((dz / L, -dr / L))
    if close:
        dr, dz = pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]
        L = math.hypot(dr, dz) or 1.0
        segn.append((dz / L, -dr / L))
    rings = []   # (r, z, nr, nz) per ring
    link = []    # ring index of point i at its lower segment / upper segment
    for i, (r, z, hard) in enumerate(pts):
        prev = segn[i - 1] if i > 0 else (segn[-1] if close else None)
        nxt = segn[i] if (i < n - 1 or close) else None
        if prev is None:
            prev = nxt
        if nxt is None:
            nxt = prev
        if hard:
            rings.append((r, z, prev[0], prev[1]))
            rings.append((r, z, nxt[0], nxt[1]))
            link.append((len(rings) - 2, len(rings) - 1))
        else:
            a = (prev[0] + nxt[0], prev[1] + nxt[1])
            L = math.hypot(*a) or 1.0
            rings.append((r, z, a[0] / L, a[1] / L))
            link.append((len(rings) - 1, len(rings) - 1))
    V, N, ring_idx = [], [], []
    ang = 2 * math.pi * np.arange(seg) / seg
    ca, sa = np.cos(ang), np.sin(ang)
    base = 0
    for (r, z, nr, nz) in rings:
        if r < 1e-7:
            V.append((0.0, 0.0, z))
            N.append((0.0, 0.0, 1.0 if nz >= 0 else -1.0))
            ring_idx.append((base, 1))
            base += 1
        else:
            for k in range(seg):
                V.append((r * ca[k], r * sa[k], z))
                N.append((nr * ca[k], nr * sa[k], nz))
            ring_idx.append((base, seg))
            base += seg
    F = []
    for i in range(n - 1):
        a_i = link[i][1]
        b_i = link[i + 1][0]
        (ba, na), (bb, nb) = ring_idx[a_i], ring_idx[b_i]
        for k in range(seg):
            k1 = (k + 1) % seg
            if na == 1 and nb == 1:
                continue
            if na == 1:
                F.append((ba, bb + k1, bb + k))
            elif nb == 1:
                F.append((ba + k, ba + k1, bb))
            else:
                F.append((ba + k, ba + k1, bb + k1))
                F.append((ba + k, bb + k1, bb + k))
    if close:
        (ba, na), (bb, nb) = ring_idx[link[-1][1]], ring_idx[link[0][0]]
        for k in range(seg):
            k1 = (k + 1) % seg
            F.append((ba + k, ba + k1, bb + k1))
            F.append((ba + k, bb + k1, bb + k))
    V = np.array(V, float)
    N = np.array(N, float)
    F = np.array(F, np.int64).reshape(-1, 3)
    return V, orient_outward(V, F, N), N


def gen_tube(p0, p1, r0, r1=None, seg=8, caps=True):
    """Cone or cylinder between two points."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    L = float(np.linalg.norm(p1 - p0))
    r1 = r0 if r1 is None else r1
    prof = [(0, 0, 'h'), (r0, 0, 'h'), (r1, L, 'h'), (0, L, 'h')] if caps else [(r0, 0), (r1, L)]
    V, F, N = gen_lathe(prof, seg)
    M = T(*p0) @ align_z(p1 - p0)
    return apply(M, V), F, apply_n(M, N)


def gen_sphere(radius=1.0, us=12, vs=8):
    prof = []
    for i in range(vs + 1):
        a = -math.pi / 2 + math.pi * i / vs
        prof.append((radius * math.cos(a), radius * math.sin(a)))
    return gen_lathe(prof, us)


def _ear_clip(poly):
    """Triangulate a simple polygon (list of (x, y), any winding) -> list of index triples, CCW."""
    n = len(poly)
    idx = list(range(n))
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    if area < 0:
        idx.reverse()
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= -1e-12 and cross(b, c, p) >= -1e-12 and cross(c, a, p) >= -1e-12
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        ear = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            ear = True
            break
        if not ear:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def gen_prism(poly, z0, z1, caps=True):
    """Polygon (x, y) extruded between z0 and z1, hard edges."""
    poly = [tuple(map(float, p)) for p in poly]
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    if area < 0:
        poly = poly[::-1]
    V, F = [], []
    for i in range(n):
        j = (i + 1) % n
        k = len(V)
        V += [(poly[i][0], poly[i][1], z0), (poly[j][0], poly[j][1], z0), (poly[j][0], poly[j][1], z1),
              (poly[i][0], poly[i][1], z1)]
        F += [(k, k + 1, k + 2), (k, k + 2, k + 3)]
    V = np.array(V, float)
    F = np.array(F, np.int64)
    Vf, Ff, Nf = flat_mesh(V, F)
    if caps:
        tris = _ear_clip(poly)
        for z, up in ((z1, True), (z0, False)):
            k = len(Vf)
            Vf = np.concatenate([Vf, np.array([(p[0], p[1], z) for p in poly])])
            Nf = np.concatenate([Nf, np.tile([0.0, 0.0, 1.0 if up else -1.0], (n, 1))])
            for t in tris:
                Ff = np.concatenate([Ff, np.array([[k + t[0], k + t[1], k + t[2]] if up else [k + t[0], k + t[2], k + t[1]]])])
    return Vf, Ff, Nf


def gen_grid(P, closed_u=False, closed_v=False, flip=False, center=None):
    """Smooth quad grid through points P (nu, nv, 3); normals from finite differences (u x v). With `center` the
    winding is chosen so that the normals point away from that point (closed surfaces)."""
    P = np.asarray(P, float)
    nu, nv = P.shape[:2]

    def diff(axis, closed):
        if closed:
            return (np.roll(P, -1, axis) - np.roll(P, 1, axis))
        d = np.zeros_like(P)
        sl = [slice(None)] * 3
        a = np.take(P, np.arange(2, P.shape[axis]), axis=axis) - np.take(P, np.arange(0, P.shape[axis] - 2), axis=axis)
        idx = [slice(None), slice(None)]
        idx[axis] = slice(1, -1)
        d[tuple(idx)] = a
        lo, hi = [slice(None), slice(None)], [slice(None), slice(None)]
        lo[axis], hi[axis] = 0, -1
        lo2, hi2 = [slice(None), slice(None)], [slice(None), slice(None)]
        lo2[axis], hi2[axis] = 1, -2
        d[tuple(lo)] = np.take(P, 1, axis=axis) - np.take(P, 0, axis=axis)
        d[tuple(hi)] = np.take(P, -1, axis=axis) - np.take(P, -2, axis=axis)
        return d
    du, dv = diff(0, closed_u), diff(1, closed_v)
    N = np.cross(du, dv)
    ln = np.linalg.norm(N, axis=2, keepdims=True)
    bad = ln[..., 0] < 1e-12
    if bad.any():
        # degenerate rows or columns (poles): borrow the mean normal of the neighbouring row
        for axis, count in ((0, nu), (1, nv)):
            for end, nb in ((0, 1), (count - 1, count - 2)):
                row = np.take(bad, end, axis=axis)
                if row.all() and count > 2:
                    src = np.take(N, nb, axis=axis)
                    mean = src.sum(axis=0)
                    mean = mean / max(np.linalg.norm(mean), 1e-12)
                    idx = [slice(None), slice(None)]
                    idx[axis] = end
                    N[tuple(idx)] = mean
        ln = np.linalg.norm(N, axis=2, keepdims=True)
    N = N / np.maximum(ln, 1e-12)
    if center is not None:
        flip = float(np.sum(N * (P - np.asarray(center, float)))) < 0
    if flip:
        N = -N
    ids = np.arange(nu * nv).reshape(nu, nv)
    Q = []
    for i in range(nu if closed_u else nu - 1):
        i1 = (i + 1) % nu
        for j in range(nv if closed_v else nv - 1):
            j1 = (j + 1) % nv
            Q.append((ids[i, j], ids[i1, j], ids[i1, j1], ids[i, j1]))
    F = quads_to_tris(Q)
    if flip:
        F = F[:, [0, 2, 1]]
    return P.reshape(-1, 3), F, N.reshape(-1, 3)


def gen_sheet(P, thick, closed_u=False, closed_v=False):
    """Closed slab of the grid P: the surface and its offset copy, joined along the open borders."""
    V1, F1, N1 = gen_grid(P, closed_u, closed_v)
    V2 = V1 - N1 * thick
    n = len(V1)
    F2 = F1[:, [0, 2, 1]] + n
    P = np.asarray(P, float)
    nu, nv = P.shape[:2]
    ids = np.arange(nu * nv).reshape(nu, nv)
    border = []
    if not closed_u:
        border += [list(ids[:, 0]), list(ids[::-1, -1]) if False else list(ids[:, -1][::-1])]
    if not closed_v:
        border += [list(ids[0, :][::-1]), list(ids[-1, :])]
    F = [F1, F2]
    for ring in border:
        for a, b in zip(ring[:-1], ring[1:]):
            F.append(np.array([[a, b, b + n], [a, b + n, a + n]]))
    Fall = np.concatenate(F)
    Vall = np.concatenate([V1, V2])
    Nall = np.concatenate([N1, -N1])
    return Vall, orient_outward(Vall, Fall, Nall), Nall


# ----------------------------------------------------------------------------------------------------------------------
# soup
# ----------------------------------------------------------------------------------------------------------------------

class Soup:
    """Parts of one object: per part a material name, triangle corner positions (n, 3, 3) and normals (n, 3, 3)."""

    def __init__(self):
        self.parts = []      # dicts: mat, pos, nrm, pid
        self._pid = 0

    def add(self, mat, V, F, N, M=None):
        V, N = np.asarray(V, float), np.asarray(N, float)
        if M is not None:
            N = apply_n(M, N)
            V = apply(M, V)
            if np.linalg.det(M[:3, :3]) < 0:
                F = F[:, [0, 2, 1]]
        if len(F) == 0:
            return
        self._pid += 1
        self.parts.append({'mat': mat, 'pos': V[F], 'nrm': N[F], 'pid': self._pid})

    def extend(self, other, M=None):
        for p in other.parts:
            pos, nrm = p['pos'], p['nrm']
            if M is not None:
                pos = apply(M, pos.reshape(-1, 3)).reshape(-1, 3, 3)
                nrm = apply_n(M, nrm.reshape(-1, 3)).reshape(-1, 3, 3)
                if np.linalg.det(M[:3, :3]) < 0:
                    pos, nrm = pos[:, [0, 2, 1]], nrm[:, [0, 2, 1]]
            self._pid += 1
            self.parts.append({'mat': p['mat'], 'pos': pos, 'nrm': nrm, 'pid': self._pid})

    def tris(self):
        return sum(len(p['pos']) for p in self.parts)

    def bounds(self):
        if not self.parts:
            return None
        allp = np.concatenate([p['pos'].reshape(-1, 3) for p in self.parts])
        return allp.min(0), allp.max(0)
