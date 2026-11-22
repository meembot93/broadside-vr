"""Tiny signed-distance-field sculpting kit for game characters.

A character is a list of primitives (capsules, ellipsoids, boxes, ...) blended with smooth
unions / subtractions. Each primitive carries a colour (constant or a function of position)
and optional surface displacement (folds, strands, warts). The field is sampled on a grid,
turned into a dense mesh with marching cubes, and coloured per vertex by evaluating the same
field at the vertex positions (so painted details are sharp even where the grid is coarse).

Coordinates: metres, y up, the character faces +Z, feet at y = 0.
"""
import numpy as np

def _len(*a):
    return np.sqrt(sum(x * x for x in a))

def rot(rx=0.0, ry=0.0, rz=0.0):
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def hexrgb(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], dtype=np.float32) / 255.0

# ---------- noise ----------
_rng = np.random.default_rng(7)
_PERM = _rng.random((64, 64, 64)).astype(np.float32)
def vnoise(x, y, z):
    """Smooth value noise, period 64."""
    xi, yi, zi = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
    fx, fy, fz = x - xi, y - yi, z - zi
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    def g(i, j, k): return _PERM[(xi + i) & 63, (yi + j) & 63, (zi + k) & 63]
    a = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * fx
    b = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * fx
    c = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * fx
    d = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * fx
    return (a + (b - a) * fy) + ((c + (d - c) * fy) - (a + (b - a) * fy)) * fz
def fbm(x, y, z, o=3):
    s, w, f = 0.0, 0.5, 1.0
    for _ in range(o):
        s = s + w * vnoise(x * f, y * f, z * f); w *= 0.5; f *= 2.0
    return s

# ---------- primitives ----------
class Prim:
    """op: 'add' | 'sub' | 'paint' (colour only, within `paint_d` of the surface)."""
    def __init__(self, color=None, k=0.01, op='add', ck=None, disp=None, bounds=None, name=''):
        self.color, self.k, self.op, self.disp, self.name = color, k, op, disp, name
        self.ck = k * 0.5 if ck is None else ck   # colour blend width (crisper than the shape blend)
        self._bounds = bounds
    def colour(self, x, y, z):
        if callable(self.color):
            return self.color(x, y, z)
        c = hexrgb(self.color) if isinstance(self.color, int) else np.asarray(self.color, dtype=np.float32)
        return np.broadcast_to(c, np.broadcast(x, y, z).shape + (3,))
    def dist(self, x, y, z):
        d = self._d(x, y, z)
        if self.disp is not None:
            d = d - self.disp(x, y, z)
        return d

class Ellipsoid(Prim):
    def __init__(self, c, r, R=None, **kw):
        super().__init__(**kw); self.c = np.array(c, float); self.r = np.array(r, float); self.R = R
    def local(self, x, y, z):
        x, y, z = x - self.c[0], y - self.c[1], z - self.c[2]
        if self.R is not None:
            Ri = self.R.T
            x, y, z = Ri[0, 0] * x + Ri[0, 1] * y + Ri[0, 2] * z, Ri[1, 0] * x + Ri[1, 1] * y + Ri[1, 2] * z, Ri[2, 0] * x + Ri[2, 1] * y + Ri[2, 2] * z
        return x, y, z
    def _d(self, x, y, z):
        x, y, z = self.local(x, y, z); r = self.r
        k0 = _len(x / r[0], y / r[1], z / r[2]); k1 = _len(x / r[0] ** 2, y / r[1] ** 2, z / r[2] ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    def bounds(self):
        e = np.max(self.r) + self.k + 0.02
        return self.c - e, self.c + e

class Cone(Prim):
    """Round cone (capsule with different end radii) from a to b."""
    def __init__(self, a, b, r1, r2, **kw):
        super().__init__(**kw); self.a = np.array(a, float); self.b = np.array(b, float); self.r1, self.r2 = r1, r2
    def _d(self, x, y, z):
        a, b, r1, r2 = self.a, self.b, self.r1, self.r2
        ba = b - a; l2 = ba @ ba; rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2
        px, py, pz = x - a[0], y - a[1], z - a[2]
        yv = px * ba[0] + py * ba[1] + pz * ba[2]
        zv = yv - l2
        qx, qy, qz = px * l2 - ba[0] * yv, py * l2 - ba[1] * yv, pz * l2 - ba[2] * yv
        x2 = qx * qx + qy * qy + qz * qz
        y2 = yv * yv * l2; z2 = zv * zv * l2
        k = np.sign(rr) * rr * rr * x2
        d1 = np.sqrt(x2 * a2 * il2) + yv * rr
        out = (d1) * il2 - r1
        m1 = np.sign(zv) * a2 * z2 > k
        m2 = np.sign(yv) * a2 * y2 < k
        out = np.where(m1, np.sqrt(x2 + z2) * il2 - r2, out)
        out = np.where(m2, np.sqrt(x2 + y2) * il2 - r1, out)
        return out
    def bounds(self):
        e = max(self.r1, self.r2) + self.k + 0.02
        return np.minimum(self.a, self.b) - e, np.maximum(self.a, self.b) + e

class Box(Prim):
    def __init__(self, c, h, R=None, rr=0.0, **kw):
        super().__init__(**kw); self.c = np.array(c, float); self.h = np.array(h, float); self.R = R; self.rr = rr
    def _d(self, x, y, z):
        x, y, z = Ellipsoid.local(self, x, y, z)
        qx, qy, qz = np.abs(x) - self.h[0] + self.rr, np.abs(y) - self.h[1] + self.rr, np.abs(z) - self.h[2] + self.rr
        return _len(np.maximum(qx, 0), np.maximum(qy, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - self.rr
    def bounds(self):
        e = np.linalg.norm(self.h) + self.k + 0.02
        return self.c - e, self.c + e

class Fn(Prim):
    """Any distance function f(x, y, z), with explicit bounds (lo, hi)."""
    def __init__(self, f, lo, hi, **kw):
        super().__init__(**kw); self.f = f; self.lo = np.array(lo, float); self.hi = np.array(hi, float)
    def _d(self, x, y, z): return self.f(x, y, z)
    def bounds(self): return self.lo - self.k, self.hi + self.k

# ---------- the field ----------
class Sculpt:
    def __init__(self, lo=(-0.7, -0.02, -0.35), hi=(0.7, 1.98, 0.38), vox=0.003):
        self.lo, self.hi, self.vox = np.array(lo), np.array(hi), vox
        self.prims = []
    def add(self, p): self.prims.append(p); return p

    def _apply(self, D, C, x, y, z, p):
        if p.op == 'paint':
            # colour only, near the current surface, where p's own distance < 0
            d = p.dist(x, y, z)
            w = np.clip(0.5 - d / max(p.ck, 1e-4), 0, 1)[..., None]
            near = (np.abs(D) < 0.02)[..., None]
            C[...] = np.where(near, C * (1 - w) + p.colour(x, y, z) * w, C)
            return
        d = p.dist(x, y, z)
        if p.op == 'sub':
            b = -d
            h = np.clip(0.5 + 0.5 * (b - D) / p.k, 0, 1)
            Dn = D * (1 - h) + b * h + p.k * h * (1 - h)
            if p.color is not None:
                hc = np.clip(0.5 + 0.5 * (b - D) / max(p.ck, 1e-4), 0, 1)[..., None]
                C[...] = C * (1 - hc) + p.colour(x, y, z) * hc
            D[...] = Dn
            return
        h = np.clip(0.5 + 0.5 * (D - d) / p.k, 0, 1)
        Dn = D * (1 - h) + d * h - p.k * h * (1 - h)
        hc = np.clip(0.5 + 0.5 * (D - d) / max(p.ck, 1e-4), 0, 1)[..., None]
        D[...] = Dn
        C[...] = C * (1 - hc) + p.colour(x, y, z) * hc

    def grid(self):
        lo, vox = self.lo, self.vox
        n = np.ceil((self.hi - lo) / vox).astype(int) + 1
        D = np.full(n, 1.0, dtype=np.float32)
        C = np.zeros(tuple(n) + (3,), dtype=np.float32)
        ax = [lo[i] + np.arange(n[i]) * vox for i in range(3)]
        for p in self.prims:
            blo, bhi = p.bounds()
            i0 = np.clip(np.floor((blo - lo) / vox).astype(int), 0, n - 1)
            i1 = np.clip(np.ceil((bhi - lo) / vox).astype(int) + 1, 0, n)
            if np.any(i1 <= i0):
                continue
            sl = tuple(slice(i0[i], i1[i]) for i in range(3))
            x = ax[0][sl[0]][:, None, None]; y = ax[1][sl[1]][None, :, None]; z = ax[2][sl[2]][None, None, :]
            x, y, z = np.broadcast_arrays(x, y, z)
            Dv, Cv = D[sl], C[sl]
            self._apply(Dv, Cv, x, y, z, p)
        return D, C

    def points(self, P):
        """Field and colour at arbitrary points (N, 3)."""
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        D = np.full(len(P), 1.0, dtype=np.float64); C = np.zeros((len(P), 3))
        for p in self.prims:
            blo, bhi = p.bounds()
            m = np.all((P >= blo) & (P <= bhi), axis=1)
            if not m.any():
                continue
            Dm, Cm = D[m].copy(), C[m].copy()
            self._apply(Dm, Cm, x[m], y[m], z[m], p)
            D[m], C[m] = Dm, Cm
        return D, C

    def mesh(self):
        from skimage.measure import marching_cubes
        D, _ = self.grid()
        v, f, _, _ = marching_cubes(D, 0.0, spacing=(self.vox,) * 3)
        v = v + self.lo
        # colour each vertex from the exact field there
        _, col = self.points(v)
        return v.astype(np.float32), f.astype(np.int32), np.clip(col, 0, 1).astype(np.float32)
