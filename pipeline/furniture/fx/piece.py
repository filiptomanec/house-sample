"""Piece: the drawing context every builder works in.

A builder receives a `Piece` whose local frame has its origin at the centre of the piece footprint on the floor,
+x along the width, +y towards the back (the wall side for rot 0) and +z up. It draws with box/cyl/tube/lathe/... in
metres; `at(...)` pushes a transform for sub-assemblies. Detail comes from `hi` (desktop) or lite (phones).
"""
import math
from contextlib import contextmanager
import numpy as np

from . import mesh as M
from . import soft as S
from .palette import sem, check, PALETTE


class Piece:
    def __init__(self, kind, hi=True, outdoor=False, seed=0, ctx=None, params=None):
        self.kind = kind
        self.hi = hi
        self.outdoor = outdoor
        self.seed = int(seed)
        self.rng = np.random.default_rng(self.seed)
        self.ctx = ctx or {}
        self.params = params or {}
        self.soup = M.Soup()
        self._st = [np.eye(4)]
        self.anchors = {}
        self.fp = None            # explicit footprint boxes [(x0, y0, x1, y1, h)] in the local frame
        self.notes = []

    # ---- context helpers ------------------------------------------------------------------------------------------
    @property
    def lite(self):
        return not self.hi

    def n(self, hi, lo):
        """Pick a count/size by detail level."""
        return hi if self.hi else lo

    def m(self, name):
        """Material for a semantic or concrete name (interior or terrace)."""
        return check(sem(name, self.outdoor))

    def rand(self, a=0.0, b=1.0):
        return float(self.rng.uniform(a, b))

    def pick(self, seq):
        return seq[int(self.rng.integers(len(seq)))]

    @property
    def T(self):
        return self._st[-1]

    @contextmanager
    def at(self, x=0.0, y=0.0, z=0.0, rz=0.0, rx=0.0, ry=0.0, s=None):
        m = M.T(x, y, z)
        if rz:
            m = m @ M.Rz(rz)
        if ry:
            m = m @ M.Ry(ry)
        if rx:
            m = m @ M.Rx(rx)
        if s is not None:
            m = m @ (M.Sc(*s) if isinstance(s, (tuple, list)) else M.Sc(s))
        self._st.append(self._st[-1] @ m)
        try:
            yield self
        finally:
            self._st.pop()

    def anchor(self, name, **kw):
        """Remember a surface or point in the piece frame (decor rules read these)."""
        kw['T'] = self._st[-1].copy()
        self.anchors[name] = kw

    def footprint(self, boxes):
        self.fp = [tuple(b) for b in boxes]

    # ---- primitives -----------------------------------------------------------------------------------------------
    def _add(self, mat, V, F, N, extra=None):
        T = self.T if extra is None else self.T @ extra
        self.soup.add(self.m(mat), V, F, N, T)

    def box(self, x0, y0, z0, x1, y1, z1, mat, r=0.0, s=0, keep=False):
        """Axis-aligned box between two corners. r rounds the edges: s=0 a smooth-shaded chamfer (44 triangles), s>=1 true
        arcs (s=1: 108 triangles). In lite mode r is dropped unless keep (then a chamfer)."""
        hx, hy, hz = abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2
        if hx < 1e-6 or hy < 1e-6 or hz < 1e-6:
            return
        if r <= 0 or (not self.hi and not keep):
            V, F, N = M.gen_box(hx, hy, hz)
        elif s >= 1 and self.hi:
            V, F, N = M.gen_rbox(hx, hy, hz, r, s)
        else:
            V, F, N = M.gen_cbox(hx, hy, hz, r)
        self._add(mat, V, F, N, M.T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

    def cyl(self, cx, cy, z0, z1, rad, mat, seg=None, r=0.0, rad1=None):
        """Vertical cylinder (cone if rad1), optional rounded rim of radius r."""
        seg = seg or self.n(20, 10)
        r = min(r, rad * 0.45, abs(z1 - z0) * 0.45) if self.hi else 0.0
        top = rad if rad1 is None else rad1
        if r > 5e-4:
            c = math.cos(math.pi / 4)
            prof = [(0, z0, 'h'), (rad - r, z0, 'h'), (rad - r + r * c, z0 + r * (1 - c)), (rad, z0 + r),
                    (top, z1 - r), (top - r + r * c, z1 - r * (1 - c)), (top - r, z1, 'h'), (0, z1, 'h')]
        else:
            prof = [(0, z0, 'h'), (rad, z0, 'h'), (top, z1, 'h'), (0, z1, 'h')]
        V, F, N = M.gen_lathe(prof, seg)
        self._add(mat, V, F, N, M.T(cx, cy, 0))

    def lathe(self, prof, mat, cx=0.0, cy=0.0, z=0.0, seg=None, close=False):
        V, F, N = M.gen_lathe(prof, seg or self.n(20, 10), close)
        self._add(mat, V, F, N, M.T(cx, cy, z))

    def tube(self, p0, p1, r, mat, r1=None, seg=None, caps=True):
        V, F, N = M.gen_tube(p0, p1, r, r1, seg or self.n(10, 6), caps)
        self._add(mat, V, F, N)

    def chain(self, pts, r, mat, seg=None, r1=None):
        """Tubes through a polyline (joints are not rounded)."""
        for a, b in zip(pts[:-1], pts[1:]):
            self.tube(a, b, r, mat, seg=seg)

    def sphere(self, c, radii, mat, us=None, vs=None):
        rx, ry, rz = (radii, radii, radii) if np.isscalar(radii) else radii
        V, F, N = M.gen_sphere(1.0, us or self.n(14, 8), vs or self.n(10, 6))
        self._add(mat, V, F, N, M.T(*c) @ M.Sc(rx, ry, rz))

    def prism(self, poly, z0, z1, mat):
        """Plan polygon (x, y) extruded between z0 and z1."""
        V, F, N = M.gen_prism(poly, z0, z1)
        self._add(mat, V, F, N)

    def prism_xz(self, poly, y0, y1, mat):
        """Side profile (x, z) extruded along y from y0 to y1."""
        V, F, N = M.gen_prism(poly, y0, y1)
        P = np.array([[1.0, 0, 0, 0], [0, 0, 1.0, 0], [0, 1.0, 0, 0], [0, 0, 0, 1.0]])
        self._add(mat, V, F, N, P)

    def prism_yz(self, poly, x0, x1, mat):
        """Front profile (y, z) extruded along x from x0 to x1."""
        V, F, N = M.gen_prism(poly, x0, x1)
        P = np.array([[0, 0, 1.0, 0], [1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 0, 1.0]])
        self._add(mat, V, F, N, P)

    def surf(self, P, mat, closed_u=False, closed_v=False, flip=False):
        V, F, N = M.gen_grid(P, closed_u, closed_v, flip)
        self._add(mat, V, F, N)

    def sheet(self, P, thick, mat, closed_u=False, closed_v=False):
        V, F, N = M.gen_sheet(P, thick, closed_u, closed_v)
        self._add(mat, V, F, N)


    def softbox(self, x0, y0, z0, x1, y1, z1, mat, r=0.03, wr=0.0, puff=0.0, seed=0.0, s=1, sub=None, fall=0.0):
        """Cushion-like rounded box whose top is rippled (wr, m) and domed (puff, m); `fall` droops the top towards
        the +-x ends (m). Lite mode keeps a plain rounded box."""
        hx, hy, hz = abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2
        cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
        if self.hi:
            if sub is None:
                sub = (int(min(10, max(1, round(2 * hx / 0.12)))), int(min(10, max(1, round(2 * hy / 0.12)))), 1)
            V, F, N = S.gen_rbox_sub(hx, hy, hz, r, s, sub)
            if wr or puff or fall:
                wgt = np.clip((N[:, 2] - 0.2) / 0.8, 0, 1)
                dz = np.zeros(len(V))
                if wr:
                    dz += S.wrinkle(V, seed, wr)
                if puff:
                    dz += puff * np.clip(1 - (V[:, 0] / hx) ** 2, 0, 1) * np.clip(1 - (V[:, 1] / hy) ** 2, 0, 1)
                if fall:
                    dz -= fall * (np.abs(V[:, 0]) / hx) ** 3
                D = np.zeros_like(V)
                D[:, 2] = dz * wgt
                V, F, N = S.displace(V, F, D)
        else:
            V, F, N = M.gen_cbox(hx, hy, hz, r)
        self._add(mat, V, F, N, M.T(cx, cy, cz))

    def cushion(self, lx, ly, h, mat, seed=0.0, wr=0.004, e_plan=0.38, e_vert=0.62, nu=None, nv=None):
        """Puffy pillow centred at the origin of the current frame, lying in the xy plane."""
        V, F, N = S.gen_cushion(lx, ly, h, nu or self.n(20, 12), nv or self.n(9, 5), e_plan, e_vert,
                                wr if self.hi else 0.0, seed)
        self._add(mat, V, F, N)

    def leaf(self, L, W, mat, droop=0.15, fold=0.12, curl=0.0, nl=None, shape=0.8, tip=1.0):
        """Leaf along +x from the current frame origin."""
        V, F, N = S.gen_leaf(L, W, droop, fold, curl, nl or self.n(6, 4), 3, shape, tip)
        self._add(mat, V, F, N)

    def mesh(self, V, F, N, mat, extra=None):
        self._add(mat, V, F, N, extra)

    def sub(self, other, extra=None):
        """Add another piece's soup (already in its own frame) under the current transform."""
        T = self.T if extra is None else self.T @ extra
        self.soup.extend(other.soup, T)

    def tris(self):
        return self.soup.tris()
