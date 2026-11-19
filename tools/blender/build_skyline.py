"""Nissan Skyline GT-R (R34) for Vehicle Sim (replaces the Ginetta G55).

Run inside Blender: exec(open(path).read()).  Rebuilds the "SKY" collection each run.
Conventions as the other cars: front faces -Y, +Z up, +X = car's left, origin on the ground midway between the axles,
wheels are separate objects (SKY_Wheel_FL ...) with their origin at the hub, calipers (SKY_Caliper_*) steer but do not spin.
Real dimensions: 4600 x 1785 x 1360 mm, wheelbase 2665 mm, track 1480/1490 mm, 245/40 R18.
"""
import os, ast, math
HERE = os.path.dirname(os.path.abspath(globals().get("__file__", "/Users/paul/Documents/Game Design/Vehicle Sim/tools/blender/x.py")))
exec(open(os.path.join(HERE, "bl_helpers.py")).read())


def _pull(fname, names):
    src = open(os.path.join(HERE, fname)).read()
    for n in ast.parse(src).body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names:
            exec(compile(ast.get_source_segment(src, n), fname, "exec"), globals())
_pull("build_caterham_620r.py", {"full_loop", "loft", "solidify", "bevel", "lathe", "torus", "ruled_text", "make_bvh", "drape_rect", "Acc", "join"})
_pull("build_sp300r.py", {"drape_quad"})

COLL = "SKY"
AX = 1.3325                     # half wheelbase (2665 mm)
TF, TR = 0.74, 0.745            # tyre centre-plane half track (1480 / 1490 mm)
RT = 0.3266                     # 245/40 R18 overall radius
RIM = 0.2286 - 0.004
WT = 0.245
NOSE_Y, TAIL_Y = -2.24, 2.36
HWMAX = 0.8925


def smat():
    M = {}
    M['paint'] = mat("SKY_Paint", (0.0, 0.085, 0.55), 0.18, 0.15, coat=1.0)
    M['black'] = mat("SKY_Black", (0.012, 0.012, 0.013), 0.5, coat=0.2)
    M['matte'] = mat("SKY_Matte", (0.006, 0.006, 0.007), 0.8)
    M['glass'] = mat("SKY_Glass", (0.012, 0.018, 0.02), 0.04, 0.0, alpha=0.72)
    M['interior'] = mat("SKY_Interior", (0.02, 0.022, 0.024), 0.85)
    M['seat'] = mat("SKY_Seat", (0.035, 0.037, 0.04), 0.8)
    M['lamp'] = mat("SKY_Headlight", (0.30, 0.32, 0.35), 0.04, 0.3, emit=(0.9, 0.93, 1.0), emit_strength=0.15)
    M['lamphouse'] = mat("SKY_LampHousing", (0.012, 0.012, 0.014), 0.25, 0.5)
    M['reflector'] = mat("SKY_Reflector", (0.5, 0.52, 0.55), 0.15, 1.0)
    M['tail'] = mat("SKY_Taillight", (0.5, 0.012, 0.01), 0.1, emit=(1.0, 0.03, 0.01), emit_strength=0.9)
    M['amber'] = mat("SKY_Indicator", (0.9, 0.32, 0.02), 0.15, emit=(1.0, 0.35, 0.02), emit_strength=0.25)
    M['amberlens'] = mat("SKY_Amber", (0.8, 0.3, 0.03), 0.2)
    M['tire'] = mat("SKY_Tire", (0.022, 0.022, 0.022), 0.85)
    M['rim'] = mat("SKY_Rim", (0.30, 0.30, 0.31), 0.3, 0.85)
    M['lip'] = mat("SKY_RimLip", (0.45, 0.45, 0.46), 0.25, 0.9)
    M['disc'] = mat("SKY_BrakeDisc", (0.3, 0.3, 0.3), 0.45, 1.0)
    M['caliper'] = mat("SKY_Caliper", (0.9, 0.62, 0.02), 0.35)
    M['chrome'] = mat("SKY_Metal", (0.6, 0.6, 0.62), 0.25, 1.0)
    M['mesh'] = mat("SKY_Mesh", (0.35, 0.36, 0.38), 0.4, 0.9)
    M['well'] = mat("SKY_Well", (0.01, 0.01, 0.011), 0.9)
    M['mirror'] = mat("SKY_Mirror", (0.75, 0.78, 0.8), 0.04, 0.9)
    M['red'] = mat("SKY_Badge", (0.55, 0.01, 0.02), 0.3, 0.4)
    M['plate'] = mat("SKY_Plate", (0.85, 0.85, 0.82), 0.4)
    M['cage'] = mat("SKY_Cage", (0.45, 0.45, 0.47), 0.35, 0.8)
    M['dashlit'] = mat("SKY_Dial", (0.75, 0.75, 0.72), 0.5)
    return M


# ---------------------------------------------------------------- body: one loft along the car
_PCH = {}


def pl(tab, y):
    """smooth monotone-cubic (PCHIP) interpolation of a (y, value) table"""
    key = id(tab)
    if key not in _PCH:
        xs = [p[0] for p in tab]; ys = [p[1] for p in tab]
        n = len(xs)
        h = [xs[i + 1] - xs[i] for i in range(n - 1)]
        d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        _PCH[key] = (xs, ys, h, m)
    xs, ys, h, m = _PCH[key]
    if y <= xs[0]: return ys[0]
    if y >= xs[-1]: return ys[-1]
    i = max(0, min(len(xs) - 2, bisect.bisect_right(xs, y) - 1))
    s = (y - xs[i]) / h[i]
    s2, s3 = s * s, s * s * s
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h[i] * m[i + 1]


# nose: a superellipse in plan (flat across the middle, tight corners), then the side of the car
_YC, _D, _A, _N = -1.90, 0.34, 0.83, 3.0
NOSE_ANG = [8, 15, 23, 31, 39, 47, 55, 63, 71, 79, 86, 90]
NOSE_PTS = [(_YC - _D * math.cos(math.radians(a)) ** (2 / _N), _A * math.sin(math.radians(a)) ** (2 / _N)) for a in NOSE_ANG]
HW = NOSE_PTS + [(-1.75, 0.862), (-1.55, 0.884), (-1.3325, HWMAX), (-1.10, 0.885), (-0.85, 0.862), (-0.4, 0.848), (0.3, 0.848), (0.8, 0.858),
                 (1.1, 0.886), (1.3325, HWMAX), (1.55, 0.886), (1.8, 0.866), (2.05, 0.83), (2.25, 0.79), (2.36, 0.76)]
HOOD = [(-2.24, 0.76), (-2.15, 0.785), (-2.0, 0.81), (-1.7, 0.862), (-1.3, 0.915), (-0.95, 0.952), (-0.8, 0.96), (-0.4, 0.965), (0.5, 0.985), (1.0, 1.0), (1.7, 1.03), (2.1, 1.04), (2.36, 1.025)]
BELT = [(y, z - 0.03) for (y, z) in HOOD]
FB = [(-2.0, 0.0), (-1.7, 0.025), (-1.3325, 0.06), (-0.95, 0.035), (-0.7, 0.0), (0.8, 0.0), (1.1, 0.03), (1.3325, 0.05), (1.7, 0.02), (2.1, 0.0)]
BW = [(-2.24, 0.25), (-2.0, 0.40), (-1.2, 0.55), (-0.8, 0.62), (0.0, 0.60), (1.0, 0.56), (2.36, 0.30)]
ROOF = [(-0.80, 0.96), (-0.5, 1.17), (-0.23, 1.31), (0.1, 1.345), (0.35, 1.355), (0.7, 1.34), (0.9, 1.31), (1.3, 1.17), (1.72, 1.04)]
STATIONS = [p[0] for p in NOSE_PTS] + [-1.85, -1.75, -1.65, -1.55, -1.45, -1.3325, -1.22, -1.1, -1.0, -0.9, -0.8, -0.65, -0.5, -0.35, -0.2, -0.05, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.1, 1.2,
                                              1.3325, 1.45, 1.55, 1.65, 1.78, 1.9, 2.0, 2.1, 2.2, 2.3, 2.36]
STATIONS = sorted(set(round(s, 4) for s in STATIONS + [-1.95, -1.8, -1.7, -1.6, -1.5, -1.4, -1.27, -1.17, -1.05, -0.95, -0.72, -0.57, -0.43, -0.27, -0.12, 0.17, 0.32, 0.47, 0.62, 0.78, 0.92, 1.05, 1.15, 1.27, 1.4, 1.5, 1.6, 1.7, 1.83, 1.95, 2.05, 2.15, 2.25, 2.33]))


def half_profile(y):
    """the lower body and its top surface (bonnet, belt line, deck); the greenhouse is a separate loft (build_cabin)"""
    hw = pl(HW, y); fb = pl(FB, y)
    zb = pl(BELT, y) + fb * 0.8; zh = pl(HOOD, y); bw = pl(BW, y)
    zf = 0.17
    ft = pl([(-2.24, 0.16), (-2.05, 0.07), (-1.8, 0.0)], y)       # the chin tucks under the nose
    tk = pl([(1.0, 0.0), (1.5, 0.02), (1.9, 0.08), (2.1, 0.13), (2.36, 0.17)], y)
    s1 = 1 - 0.8 * tk
    low = [(0, zf), (0.70 * hw * (1 - ft), zf), (0.89 * hw * (1 - ft), zf + 0.03 + ft * 0.05), (0.965 * hw * (1 - 0.8 * ft), 0.25 + ft * 0.04), (0.995 * hw, 0.36), (hw, 0.50),
           (0.992 * hw * (1 - 0.3 * tk), 0.64), ((0.965 - 0.8 * tk) * hw, zb - 0.16), ((0.935 - 0.9 * tk) * hw, zb - 0.07), ((0.90 - 1.2 * tk) * hw, zb)]
    crown = lambda x, z0: z0 - 0.04 * (x / max(hw, 0.2)) ** 2
    sc = 1 - 1.2 * tk
    top = [(0.93 * hw * sc, zh + fb * 0.95 - 0.03), (0.86 * hw * sc, zh + fb * 0.85), (0.78 * hw * sc, zh + fb * 0.45), (0.66 * hw * sc, zh + fb * 0.12),
           (min(bw, 0.6 * hw), crown(min(bw, 0.6 * hw), zh)), (min(0.2, 0.2 * hw), crown(0.2, zh)), (0.07, zh), (0.04, zh), (0.0, zh)]
    pts = low + top
    for k in range(len(low) + 1, len(pts) - 1):
        px = pts[k - 1][0]
        pts[k] = (min(pts[k][0], px * 0.86), pts[k][1])
    pts[-1] = (0.0, pts[-1][1])
    return pts, 0.0


def build_body(coll, M):
    stations = [(y, full_loop(half_profile(y)[0])) for y in STATIONS]
    half_n = len(half_profile(0.0)[0])
    n = len(stations[0][1])

    def mat_of(i, j):
        jj = j if j <= half_n - 2 else (n - 1) - j
        if jj in (0, 1): return 1                                       # floor and its corner: black
        return 0
    return loft("SKY_Body", coll, stations, [M['paint'], M['black']], mat_of, caps=(True, True), smooth=50)


CABIN_ST = [-0.80, -0.74, -0.66, -0.57, -0.47, -0.36, -0.24, -0.1, 0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 1.05, 1.2, 1.35, 1.5, 1.62, 1.72]
SIDE_GLASS = [(-0.46, 0.46), (0.66, 1.16)]


def build_cabin(coll, M):
    """the greenhouse: A-pillars, windscreen, side glass, roof and rear window, as one loft sitting on the belt line"""
    def prof(y):
        fb = pl(FB, y)
        zbase = pl(HOOD, y) + fb * 0.85 - 0.03
        zr = max(pl(ROOF, y), zbase + 0.002)
        h = zr - zbase
        wg = min(0.80, 0.93 * pl(HW, y))
        k = min(1.0, h / 0.35)
        pts = [(0, zbase - 0.04), (wg, zbase - 0.04), (wg, zbase), (wg - 0.035 * k, zbase + 0.40 * h), (0.665 + 0.1 * (1 - k), zbase + 0.80 * h),
               (0.60 + 0.1 * (1 - k), zr - 0.02 * k), (min(0.52, 0.52), zr - 0.005), (0.2, zr), (0.07, zr), (0.04, zr), (0.0, zr)]
        for q in range(3, len(pts)):
            if pts[q][0] > pts[q - 1][0] - 0.003: pts[q] = (max(0.0, pts[q - 1][0] - 0.003), pts[q][1])
        pts[-1] = (0.0, pts[-1][1])
        return pts
    stations = [(y, full_loop(prof(y))) for y in CABIN_ST]
    half_n = len(prof(0.0))
    n = len(stations[0][1])
    PAINT, BLACK, GLASS = 0, 1, 2

    def mat_of(i, j):
        jj = j if j <= half_n - 2 else (n - 1) - j
        y = (CABIN_ST[i] + CABIN_ST[i + 1]) / 2
        if jj in (0, 1): return PAINT
        if jj in (2, 3):
            return GLASS if any(a < y < b for a, b in SIDE_GLASS) else BLACK
        if jj == 4: return PAINT
        if jj >= 5:
            if y < -0.24 or y > 0.92: return GLASS if jj >= 6 else BLACK
            return PAINT
        return PAINT
    return loft("SKY_Cabin", coll, stations, [M['paint'], M['black'], M['glass']], mat_of, caps=(True, True), smooth=48)


def arch_cut(body, coll, M):
    for ax, r in ((-AX, RT), (AX, RT)):
        for s in (1, -1):
            R = r + 0.065
            cut = prism("CUT_arch", [(R * math.cos(2 * math.pi * k / 40) + ax, R * math.sin(2 * math.pi * k / 40) + RT) for k in range(40)], 'x',
                        (0.55 if s > 0 else -1.2), (1.2 if s > 0 else -0.55), coll, M['well'])
            apply_boolean(body, cut, 'DIFFERENCE')
            bpy.data.objects.remove(cut, do_unlink=True)
    mm = bpy.data.materials.get("CUT_arch")
    if mm and mm.users == 0:
        bpy.data.materials.remove(mm)


# ---------------------------------------------------------------- draping helpers: decals / panels laid on the shell
def rrect(hx, hz, p=3.0, slant=0.0):
    """boundary of a rounded rectangle (superellipse) as fn(angle) -> (dx, dz)"""
    def f(a):
        c, s = math.cos(a), math.sin(a)
        x = hx * math.copysign(abs(c) ** (2 / p), c)
        z = hz * math.copysign(abs(s) ** (2 / p), s)
        return (x, z + slant * x)
    return f


def _ray(bvh, mode, sg, u, v):
    if mode == 'f': o, d = Vector((u, -4.0, v)), Vector((0, 1, 0))
    elif mode == 'r': o, d = Vector((u, 4.0, v)), Vector((0, -1, 0))
    elif mode == 's': o, d = Vector((sg * 1.6, u, v)), Vector((-sg, 0, 0))
    else: o, d = Vector((u, v, 2.6)), Vector((0, 0, -1))
    hit = bvh.ray_cast(o, d)
    if hit[0] is None:
        return None, d
    n = Vector(hit[1])
    if n.dot(d) > 0: n = -n
    return (hit[0], n), d


def patch(B, bvh, c, rings, mi, off, mode, sg=1, segs=26):
    """a shape draped on the shell. rings: [(fn, t)] from the centre outwards (t=0 -> the centre point); c = centre (u, v)"""
    vs, fs = [], []
    rows = []
    d0 = None
    for (fn, t) in rings:
        if t == 0:
            r, d0 = _ray(bvh, mode, sg, c[0], c[1])
            if r is None: return
            vs.append(tuple(r[0] + r[1] * off)); rows.append(('c', len(vs) - 1)); continue
        row = []
        for k in range(segs):
            dx, dz = fn(2 * math.pi * k / segs)
            r, d0 = _ray(bvh, mode, sg, c[0] + t * dx, c[1] + t * dz)
            if r is None:
                row.append(None); continue
            vs.append(tuple(r[0] + r[1] * off)); row.append(len(vs) - 1)
        rows.append(('r', row))
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for k in range(segs):
            k2 = (k + 1) % segs
            if a[0] == 'c':
                q = [a[1], b[1][k], b[1][k2]]
            else:
                q = [a[1][k], a[1][k2], b[1][k2], b[1][k]]
            if None in q: continue
            fs.append(q)
    if fs:
        B.add(vs, fs, mi, lambda cc, d=d0: cc - d * 12)


def disc(B, bvh, c, fn, mi, off, mode, sg=1, segs=26, rings=3):
    rings = max(rings, 3)
    patch(B, bvh, c, [(fn, 0.0)] + [(fn, (i + 1) / rings) for i in range(rings)], mi, off, mode, sg, segs)


def ring_patch(B, bvh, c, fn_out, fn_in, mi, off, mode, sg=1, segs=26):
    patch(B, bvh, c, [(fn_out, 1.0), (fn_in, 1.0)], mi, off, mode, sg, segs)


def line(B, bvh, pts, w, mi, off, mode, sg=1, subdiv=4):
    """thin strip along a polyline of (u, v) points draped on the shell"""
    pp = []
    for i in range(len(pts) - 1):
        for k in range(subdiv):
            f = k / subdiv
            pp.append((pts[i][0] * (1 - f) + pts[i + 1][0] * f, pts[i][1] * (1 - f) + pts[i + 1][1] * f))
    pp.append(pts[-1])
    vs, fs, d0 = [], [], None
    rows = []
    for i, (u, v) in enumerate(pp):
        a = pp[max(i - 1, 0)]; b = pp[min(i + 1, len(pp) - 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / l * w / 2, tx / l * w / 2
        r1, d0 = _ray(bvh, mode, sg, u + nx, v + nz)
        r2, d0 = _ray(bvh, mode, sg, u - nx, v - nz)
        if r1 is None or r2 is None:
            rows.append(None); continue
        vs.append(tuple(r1[0] + r1[1] * off)); vs.append(tuple(r2[0] + r2[1] * off))
        rows.append(len(vs) - 2)
    for i in range(len(rows) - 1):
        if rows[i] is None or rows[i + 1] is None: continue
        a, b = rows[i], rows[i + 1]
        fs.append([a, a + 1, b + 1, b])
    if fs:
        B.add(vs, fs, mi, lambda cc, d=d0: cc - d * 12)


def loop_line(B, bvh, fn, c, w, mi, off, mode, sg=1, n=24):
    pts = []
    for k in range(n + 1):
        dx, dz = fn(2 * math.pi * k / n)
        pts.append((c[0] + dx, c[1] + dz))
    line(B, bvh, pts, w, mi, off, mode, sg, subdiv=1)


def dome(B, c, r, h, dirv, mi, segs=14, rings=2):
    """a shallow dome (lens) at c, bulging toward dirv"""
    dirv = Vector(dirv).normalized()
    a = Vector((0, 0, 1)) if abs(dirv.z) < 0.9 else Vector((1, 0, 0))
    u = dirv.cross(a).normalized(); v = dirv.cross(u)
    vs = [tuple(Vector(c) + dirv * h)]
    for i in range(1, rings + 1):
        t = i / rings
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            vs.append(tuple(Vector(c) + (u * math.cos(ang) + v * math.sin(ang)) * r * t + dirv * h * (1 - t * t)))
    fs = [[0, 1 + k, 1 + (k + 1) % segs] for k in range(segs)]
    for i in range(1, rings):
        for k in range(segs):
            k2 = (k + 1) % segs
            fs.append([1 + (i - 1) * segs + k, 1 + (i - 1) * segs + k2, 1 + i * segs + k2, 1 + i * segs + k])
    B.add(vs, fs, mi, lambda cc, d=dirv: cc + d * 12)


def ellipsoid(B, c, r, mi, lat=6, lon=12):
    vs = [(c[0], c[1], c[2] + r[2])]
    for i in range(1, lat):
        th = math.pi * i / lat
        for k in range(lon):
            ph = 2 * math.pi * k / lon
            vs.append((c[0] + r[0] * math.sin(th) * math.cos(ph), c[1] + r[1] * math.sin(th) * math.sin(ph), c[2] + r[2] * math.cos(th)))
    vs.append((c[0], c[1], c[2] - r[2]))
    fs = [[0, 1 + (k + 1) % lon, 1 + k] for k in range(lon)]
    for i in range(1, lat - 1):
        for k in range(lon):
            k2 = (k + 1) % lon
            fs.append([1 + (i - 1) * lon + k, 1 + (i - 1) * lon + k2, 1 + i * lon + k2, 1 + i * lon + k])
    last = len(vs) - 1
    fs += [[last, 1 + (lat - 2) * lon + k, 1 + (lat - 2) * lon + (k + 1) % lon] for k in range(lon)]
    B.add(vs, fs, mi, 'c')


DET = ['black', 'paint', 'lamphouse', 'lamp', 'mesh', 'red', 'plate', 'amber', 'amberlens', 'tail', 'chrome', 'reflector', 'mirror', 'matte', 'dashlit', 'glass']
DI = {k: i for i, k in enumerate(DET)}


def det_obj(B, name, coll, M, smooth=None):
    return B.obj(name, coll, [M[k] for k in DET], smooth=smooth)


def flat_line(B, a, b, w, mi, nrm):
    pass


# ---------------------------------------------------------------- the front end
def bands(B, mi, y0, y1, z0, z1, k, out):
    """a dark bumper band hugging the plan outline of the body between two stations (front: y0<y1<0; rear: 0<y0<y1)"""
    n = 14
    sgn = -1 if y0 < 0 else 1
    ys = [min(max(y0 + (y1 - y0) * i / n, NOSE_Y), TAIL_Y) for i in range(n + 1)]
    right = [(pl(HW, y) * k + out, y + sgn * out) for y in ys]
    inner = [(x * 0.7, y) for (x, y) in right]
    outer_loop = [(-x, y) for (x, y) in right[::-1]] + [(x, y) for (x, y) in right]
    inner_loop = [(-x, y) for (x, y) in inner[::-1]] + [(x, y) for (x, y) in inner]
    n_o = len(outer_loop)
    vs, fs = [], []
    for z in (z0, z1):
        vs += [(x, y, z) for (x, y) in outer_loop] + [(x, y, z) for (x, y) in inner_loop]
    m = 2 * n_o
    for i in range(n_o - 1):
        fs.append([i, i + 1, m + i + 1, m + i])
        fs.append([n_o + i, m + n_o + i, m + n_o + i + 1, n_o + i + 1])
        fs.append([m + i, m + i + 1, m + n_o + i + 1, m + n_o + i])
        fs.append([i, n_o + i, n_o + i + 1, i + 1])
    fs.append([0, m, m + n_o, n_o]); fs.append([n_o - 1, n_o + n_o - 1, m + n_o + n_o - 1, m + n_o - 1])
    B.add(vs, fs, mi, 'c')


def build_front(coll, M, bvh):
    B = Builder()
    K = DI
    # front splitter, and the black lower bumper band that follows the nose in plan
    ys = [-2.24, -2.225, -2.2, -2.16, -2.1, -2.03, -1.95, -1.88]
    right = [(min(pl(HW, y) * 0.97 + 0.02, 0.86), y - 0.012) for y in ys]
    L = [(-x, y) for (x, y) in right]
    B.extrude(L[::-1] + right, 'z', 0.115, 0.15, K['black'])
    bands(B, K['black'], -2.25, -1.83, 0.15, 0.255, 1.0, 0.004)
    for s in (1, -1):
        line(B, bvh, [(-1.92, 0.60), (-1.90, 0.45), (-1.88, 0.27)], 0.004, K['black'], 0.0025, 's', s, subdiv=3)
        disc(B, bvh, (s * 0.80, 0.215), rrect(0.03, 0.012, 2.5), K['chrome'], 0.012, 'f', segs=10, rings=1)
    disc(B, bvh, (0.0, 0.205), rrect(0.05, 0.016, 3.0), K['chrome'], 0.012, 'f', segs=10, rings=1)    # tow-hook cover
    # upper grille: painted frame, dark opening, mesh and the GT-R badge
    ring_patch(B, bvh, (0.0, 0.655), rrect(0.395, 0.085, 3.0), rrect(0.355, 0.06, 3.0), K['paint'], 0.014, 'f', segs=36)
    disc(B, bvh, (0.0, 0.655), rrect(0.355, 0.06, 3.0), K['black'], 0.002, 'f', segs=36, rings=1)
    for k in range(-5, 6):
        line(B, bvh, [(k * 0.062, 0.598), (k * 0.062, 0.712)], 0.0045, K['mesh'], 0.006, 'f', subdiv=2)
    for z in (0.63, 0.655, 0.68):
        line(B, bvh, [(-0.34, z), (0.34, z)], 0.0045, K['mesh'], 0.0075, 'f', subdiv=8)
    disc(B, bvh, (0.0, 0.655), rrect(0.05, 0.02, 3.0), K['red'], 0.016, 'f', segs=16, rings=1)
    # intercooler opening and its core
    disc(B, bvh, (0.0, 0.325), rrect(0.37, 0.125, 6.0), K['black'], 0.003, 'f', segs=40, rings=1)
    for k in range(-14, 15):
        line(B, bvh, [(k * 0.0245, 0.215), (k * 0.0245, 0.435)], 0.0055, K['mesh'], 0.0075, 'f', subdiv=3)
    for z in (0.24, 0.285, 0.33, 0.375, 0.415):
        line(B, bvh, [(-0.355, z), (0.355, z)], 0.006, K['chrome'], 0.0095, 'f', subdiv=6)
    ring_patch(B, bvh, (0.0, 0.325), rrect(0.385, 0.138, 6.0), rrect(0.36, 0.12, 6.0), K['black'], 0.009, 'f', segs=40)
    for s in (1, -1):
        # headlamp cluster: dark housing, clear lens, two projector eyes with domed lenses
        cx, cz = s * 0.625, 0.70
        shp = rrect(0.175, 0.058, 2.8, 0.10 * s)
        disc(B, bvh, (cx, cz), shp, K['lamphouse'], 0.004, 'f', segs=34, rings=1)
        disc(B, bvh, (cx, cz), rrect(0.162, 0.047, 2.8, 0.10 * s), K['lamp'], 0.008, 'f', segs=34, rings=1)
        loop_line(B, bvh, shp, (cx, cz), 0.006, K['chrome'], 0.0065, 'f', n=34)
        for (ex, er) in ((s * 0.565, 0.040), (s * 0.69, 0.033)):
            ez = cz + 0.10 * s * (ex - cx)
            r, d = _ray(bvh, 'f', 1, ex, ez)
            if r is not None:
                ring_patch(B, bvh, (ex, ez), rrect(er * 1.25, er * 1.25, 2.0), rrect(er * 0.95, er * 0.95, 2.0), K['lamphouse'], 0.011, 'f', segs=16)
                disc(B, bvh, (ex, ez), rrect(er * 0.95, er * 0.95, 2.0), K['chrome'], 0.010, 'f', segs=16, rings=2)
                dome(B, r[0] + r[1] * 0.012, er * 0.6, 0.012, r[1], K['lamp'], 12, 2)
        # indicator under the cluster
        disc(B, bvh, (s * 0.52, 0.63), rrect(0.03, 0.014, 2.5), K['amber'], 0.006, 'f', segs=12, rings=1)
        # fog lamp in a dark bezel, lower corner intake with slats
        disc(B, bvh, (s * 0.665, 0.455), rrect(0.062, 0.042, 3.0), K['black'], 0.004, 'f', segs=20, rings=1)
        disc(B, bvh, (s * 0.665, 0.455), rrect(0.048, 0.03, 3.0), K['lamp'], 0.007, 'f', segs=20, rings=1)
        disc(B, bvh, (s * 0.64, 0.275), rrect(0.115, 0.048, 3.0), K['black'], 0.004, 'f', segs=24, rings=1)
        for z in (0.255, 0.275, 0.295):
            line(B, bvh, [(s * 0.535, z), (s * 0.745, z)], 0.005, K['mesh'], 0.0065, 'f', subdiv=4)
        # fender side-marker and a small vent behind the wheel
        disc(B, bvh, (-0.98, 0.60), rrect(0.034, 0.013, 2.5), K['amber'], 0.005, 's', s, segs=12, rings=1)
    # hood: panel shut lines, bonnet seam, the small black duct triangle and two washer jets
    for s in (1, -1):
        line(B, bvh, [(s * 0.50, -2.12), (s * 0.70, -1.95), (s * 0.80, -1.5), (s * 0.82, -0.85)], 0.0045, K['black'], 0.0015, 't', subdiv=6)
    line(B, bvh, [(-0.81, -0.84), (0.0, -0.835), (0.81, -0.84)], 0.0045, K['black'], 0.0015, 't', subdiv=8)
    line(B, bvh, [(-0.48, -2.135), (0.0, -2.14), (0.48, -2.135)], 0.0045, K['black'], 0.0015, 't', subdiv=8)
    r, d = _ray(bvh, 't', 1, 0.35, -1.43)
    if r is not None:
        p0 = r[0] + r[1] * 0.003
        B.add([tuple(p0 + Vector((0, -0.07, 0))), tuple(p0 + Vector((-0.04, 0.05, 0))), tuple(p0 + Vector((0.04, 0.05, 0)))], [[0, 1, 2]], K['black'], lambda cc: cc + Vector((0, 0, 12)))
    return det_obj(B, "SKY_Details_Front", coll, M, smooth=None)


# ---------------------------------------------------------------- flanks: door lines, handles, mirrors
def build_sides(coll, M, bvh):
    B = Builder()
    K = DI
    for s in (1, -1):
        # door (front edge, rear edge, sill line, belt line) and the arch lines of the fenders
        line(B, bvh, [(-0.88, 0.25), (-0.89, 0.60), (-0.86, 0.94)], 0.004, K['black'], 0.002, 's', s, subdiv=3)
        line(B, bvh, [(0.60, 0.25), (0.595, 0.60), (0.58, 0.95)], 0.004, K['black'], 0.002, 's', s, subdiv=3)
        line(B, bvh, [(-0.88, 0.245), (0.0, 0.235), (0.60, 0.25)], 0.004, K['black'], 0.002, 's', s, subdiv=5)
        line(B, bvh, [(-0.86, 0.945), (0.0, 0.955), (0.58, 0.96)], 0.003, K['black'], 0.002, 's', s, subdiv=5)
        # side skirt crease
        line(B, bvh, [(-0.80, 0.31), (-0.2, 0.30), (0.8, 0.31)], 0.006, K['black'], 0.0012, 's', s, subdiv=5)
        # door: chrome window-sill trim, rub strip, character line, lock, pull-handle shadow, B-pillar seam
        line(B, bvh, [(-0.84, 0.975), (0.0, 0.985), (0.62, 0.99)], 0.012, K['chrome'], 0.003, 's', s, subdiv=6)
        line(B, bvh, [(-0.82, 0.42), (0.0, 0.41), (0.56, 0.42)], 0.045, K['black'], 0.0025, 's', s, subdiv=6)
        disc(B, bvh, (0.44, 0.835), rrect(0.012, 0.012, 2.0), K['black'], 0.004, 's', s, segs=10, rings=1)
        loop_line(B, bvh, rrect(0.095, 0.035, 3.0), (0.34, 0.865), 0.004, K['black'], 0.002, 's', s, n=20)
        line(B, bvh, [(-0.30, 0.55), (-0.10, 0.5), (0.2, 0.52), (0.5, 0.56)], 0.004, K['black'], 0.0015, 's', s, subdiv=3)
        # door handle: recess and the handle
        disc(B, bvh, (0.34, 0.86), rrect(0.072, 0.024, 3.0), K['black'], 0.003, 's', s, segs=18, rings=1)
        disc(B, bvh, (0.34, 0.865), rrect(0.062, 0.012, 3.0), K['paint'], 0.016, 's', s, segs=18, rings=1)
        disc(B, bvh, (0.485, 0.868), rrect(0.012, 0.012, 2.0), K['chrome'], 0.004, 's', s, segs=10, rings=1)
        # small red badge on the fender
        disc(B, bvh, (-0.99, 0.43), rrect(0.025, 0.012, 3.0), K['red'], 0.004, 's', s, segs=10, rings=1)
        # rear quarter: fuel flap (left only)
        if s > 0:
            loop_line(B, bvh, rrect(0.095, 0.115, 4.0), (1.46, 0.80), 0.004, K['black'], 0.002, 's', s, n=26)
        # door mirror: painted shell, dark face, on a short stalk
        mx, my, mz = s * 0.955, -0.60, 1.03
        ellipsoid(B, (mx, my, mz), (0.092, 0.058, 0.066), K['paint'], 7, 16)
        B.add([(mx - s * 0.03, my + 0.052, mz - 0.045), (mx + s * 0.03, my + 0.052, mz - 0.045), (mx + s * 0.03, my + 0.052, mz + 0.045), (mx - s * 0.03, my + 0.052, mz + 0.045)] if False else
              [(mx - s * 0.075, my + 0.045, mz - 0.042), (mx + s * 0.075, my + 0.045, mz - 0.042), (mx + s * 0.075, my + 0.045, mz + 0.042), (mx - s * 0.075, my + 0.045, mz + 0.042)],
              [[0, 1, 2, 3]], K['mirror'], lambda cc: Vector((cc.x, 10, cc.z)))
        B.tube([(s * 0.80, -0.55, 0.95), (s * 0.88, -0.58, 1.00)], 0.012, K['black'], 5)
        B.tube([(s * 0.80, -0.50, 0.93), (s * 0.88, -0.58, 1.00)], 0.008, K['black'], 5)
    return det_obj(B, "SKY_Details_Sides", coll, M, smooth=None)


# ---------------------------------------------------------------- the tail
def build_rear(coll, M, bvh):
    B = Builder()
    K = DI
    # black lower valance, with the plate recess
    bands(B, K['black'], 1.95, 2.37, 0.15, 0.28, 1.0, 0.004)
    line(B, bvh, [(-0.84, 0.64), (0.84, 0.64)], 0.004, K['black'], 0.0125, 'r', subdiv=10)
    for s in (1, -1):
        disc(B, bvh, (s * 0.74, 0.40), rrect(0.03, 0.03, 2.0), K['reflector'], 0.012, 'r', segs=10, rings=1)
    for s in (1, -1):
        # round lamps: dark ring, red lens (brake light), inner amber indicator, hot-spot dome
        for (dx, dz, r, lens) in ((0.625, 0.83, 0.098, K['tail']), (0.435, 0.825, 0.072, K['amberlens'])):
            c = (s * dx, dz)
            ring_patch(B, bvh, c, rrect(r * 1.12, r * 1.12, 2.0), rrect(r, r, 2.0), K['black'], 0.007, 'r', segs=28)
            disc(B, bvh, c, rrect(r, r, 2.0), lens, 0.009, 'r', segs=28, rings=2)
            rr, d = _ray(bvh, 'r', 1, c[0], c[1])
            if rr is not None:
                dome(B, rr[0] + rr[1] * 0.012, r * 0.55, 0.014, rr[1], lens, 14, 2)
                ring_patch(B, bvh, c, rrect(r * 0.62, r * 0.62, 2.0), rrect(r * 0.55, r * 0.55, 2.0), K['black'], 0.0125, 'r', segs=20)
        # bumper reflectors, lamp-panel outline, trunk-lid shut line
        disc(B, bvh, (s * 0.50, 0.40), rrect(0.07, 0.024, 3.0), K['amberlens'] if s > 0 else K['tail'], 0.006, 'r', segs=14, rings=1)
        loop_line(B, bvh, rrect(0.19, 0.12, 3.5), (s * 0.53, 0.825), 0.004, K['black'], 0.002, 'r', n=30)
    # trunk lid outline, centre roundel, key, badges, spoiler lip
    line(B, bvh, [(-0.30, 0.98), (-0.30, 0.74), (0.30, 0.74), (0.30, 0.98)], 0.004, K['black'], 0.002, 'r', subdiv=3)
    ring_patch(B, bvh, (0.0, 0.84), rrect(0.05, 0.05, 2.0), rrect(0.04, 0.04, 2.0), K['chrome'], 0.008, 'r', segs=20)
    disc(B, bvh, (0.0, 0.84), rrect(0.04, 0.04, 2.0), K['black'], 0.006, 'r', segs=20, rings=1)
    disc(B, bvh, (0.0, 0.84), rrect(0.062, 0.016, 3.0), K['chrome'], 0.0045, 'r', segs=14, rings=1)
    disc(B, bvh, (-0.25, 0.80), rrect(0.032, 0.032, 2.0), K['black'], 0.004, 'r', segs=12, rings=1)
    disc(B, bvh, (-0.45, 0.70), rrect(0.04, 0.02, 3.0), K['red'], 0.005, 'r', segs=12, rings=1)
    disc(B, bvh, (0.0, 0.97), rrect(0.13, 0.014, 3.0), K['tail'], 0.006, 'r', segs=14, rings=1)
    # number plate
    ring_patch(B, bvh, (0.0, 0.415), rrect(0.185, 0.095, 6.0), rrect(0.168, 0.082, 6.0), K['black'], 0.005, 'r', segs=24)
    disc(B, bvh, (0.0, 0.415), rrect(0.168, 0.082, 6.0), K['plate'], 0.006, 'r', segs=24, rings=1)
    # exhaust: oval surround, two chrome tips and their dark bores (left side)
    ex = 0.60
    disc(B, bvh, (ex, 0.235), rrect(0.115, 0.05, 3.0), K['matte'], 0.006, 'r', segs=22, rings=1)
    for dx in (-0.05, 0.05):
        for (rad, mi_, yoff) in ((0.044, K['chrome'], 0.0), ):
            B.tube([(ex + dx, TAIL_Y - 0.075, 0.235), (ex + dx, TAIL_Y + 0.045, 0.235)], rad, mi_, 12)
        B.add([(ex + dx + 0.034 * math.cos(2 * math.pi * k / 12), TAIL_Y + 0.044, 0.235 + 0.034 * math.sin(2 * math.pi * k / 12)) for k in range(12)], [list(range(12))], K['black'], lambda cc: Vector((cc.x, 10, cc.z)))
        B.add([(ex + dx + 0.044 * math.cos(2 * math.pi * k / 12), TAIL_Y + 0.045, 0.235 + 0.044 * math.sin(2 * math.pi * k / 12)) for k in range(12)] +
              [(ex + dx + 0.034 * math.cos(2 * math.pi * k / 12), TAIL_Y + 0.045, 0.235 + 0.034 * math.sin(2 * math.pi * k / 12)) for k in range(12)],
              [[k, (k + 1) % 12, 12 + (k + 1) % 12, 12 + k] for k in range(12)], K['chrome'], lambda cc: Vector((cc.x, 10, cc.z)))
    # diffuser fins under the bumper
    for x in (-0.50, -0.30, -0.10, 0.10, 0.30):
        B.extrude([(2.12, 0.16), (2.34, 0.16), (2.34, 0.23), (2.12, 0.20)], 'x', x - 0.006, x + 0.006, K['black'])
    return det_obj(B, "SKY_Details_Rear", coll, M, smooth=None)


# ---------------------------------------------------------------- GT wing
def build_wing(coll, M):
    parts = []
    B = Builder()
    BK, PA = 0, 1
    # blade: a thin aerofoil section with a gurney lip, on two swept uprights between end plates
    prof = [(1.935, 1.215), (1.975, 1.238), (2.06, 1.252), (2.17, 1.243), (2.235, 1.226), (2.243, 1.216), (2.205, 1.204), (2.11, 1.2), (2.0, 1.2)]
    B.extrude(prof, 'x', -0.72, 0.72, BK)
    for s in (-1, 1):
        B.extrude([(1.925, 1.17), (2.0, 1.285), (2.255, 1.285), (2.255, 1.17)], 'x', s * 0.725 - 0.007, s * 0.725 + 0.007, PA)
        B.extrude([(1.97, 1.03), (2.14, 1.03), (2.12, 1.205), (2.02, 1.205)], 'x', s * 0.50 - 0.011, s * 0.50 + 0.011, PA)
    parts.append(B.obj("SKY_Wing", coll, [M['black'], M['paint']], smooth=None))
    return parts


def hit_y(bvh, x, z, from_front=True):
    o, d = (Vector((x, -4.0, z)), Vector((0, 1, 0))) if from_front else (Vector((x, 4.0, z)), Vector((0, -1, 0)))
    hit = bvh.ray_cast(o, d)
    if hit[0] is None: return (-2.3 if from_front else 2.3), -d
    return hit[0].y, Vector(hit[1])


# ---------------------------------------------------------------- wheels (five-spoke 18"), brake discs, calipers
def sky_wheel(name, coll, M, side, loc):
    B = Builder()
    TIRE, RIMM, LIP, HUB, DISC, RED = 0, 1, 2, 3, 4, 5
    h = WT / 2
    G = 0.007
    prof = [(-h * 0.88, RIM + 0.005), (-h, RIM + 0.045), (-h * 1.0, RT - 0.060), (-h * 0.96, RT - 0.018), (-h * 0.80, RT - 0.004),
            (-h * 0.74, RT), (-h * 0.50, RT), (-h * 0.46, RT - G), (-h * 0.30, RT - G), (-h * 0.26, RT),
            (h * 0.26, RT), (h * 0.30, RT - G), (h * 0.46, RT - G), (h * 0.50, RT), (h * 0.74, RT), (h * 0.80, RT - 0.004),
            (h * 0.96, RT - 0.018), (h * 1.0, RT - 0.060), (h, RIM + 0.045), (h * 0.88, RIM + 0.005)]
    B.revolve(prof, 26, TIRE, flip=True)
    B.revolve([(h * 0.88, RIM + 0.005), (h * 0.94, RIM - 0.004), (h * 0.9, RIM - 0.016)], 24, LIP, flip=True)          # polished outer lip
    B.revolve([(h * 0.9, RIM - 0.016), (h * 0.5, RIM - 0.022), (-h * 0.7, RIM - 0.022)], 24, RIMM, flip=True)          # barrel
    B.revolve([(-h * 0.7, RIM - 0.022), (-h * 0.5, 0.05)], 24, RIMM)                                                       # inner dish
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        u = Vector((math.cos(a), math.sin(a))); v = Vector((-math.sin(a), math.cos(a)))
        for (w0, w1, w2) in ((0.058, 0.044, 0.078),):
            pts = [(-w0 / 2, 0.04), (w0 / 2, 0.04), (w1 / 2, 0.12), (w2 / 2, RIM - 0.016), (-w2 / 2, RIM - 0.016), (-w1 / 2, 0.12)]
            out = [tuple(u * r + v * t) for (t, r) in pts]
            B.extrude(out, 'x', h * 0.46, h * 0.62, RIMM)
    # hub face, centre cap with the red badge, five nuts
    B.revolve([(h * 0.46, 0.0), (h * 0.46, 0.058), (h * 0.62, 0.058), (h * 0.66, 0.045), (h * 0.66, 0.0)], 20, RIMM)
    B.revolve([(h * 0.66, 0.0), (h * 0.66, 0.026)], 14, HUB)
    B.revolve([(h * 0.665, 0.0), (h * 0.665, 0.014)], 12, RED)
    for k in range(5):
        a = 2 * math.pi * k / 5
        lathe(B, [(h * 0.62, 0.0), (h * 0.62, 0.0085), (h * 0.69, 0.0085), (h * 0.69, 0.0)], 6, LIP, 'x', (0, 0.043 * math.cos(a), 0.043 * math.sin(a)))
    # brake disc (slotted rotor and its hat)
    B.revolve([(-h * 0.20, 0.060), (-h * 0.20, 0.158), (h * 0.02, 0.158), (h * 0.02, 0.060)], 24, DISC)
    B.revolve([(h * 0.02, 0.060), (h * 0.02, 0.0)], 20, DISC)
    mirror_builder(B, side)
    return B.obj(name, coll, [M['tire'], M['rim'], M['lip'], M['lip'], M['disc'], M['red']], smooth=40, loc=loc)


def build_calipers(coll, M):
    for nm, ax, th, side in (("FL", -AX, TF, 1), ("FR", -AX, TF, -1), ("RL", AX, TR, 1), ("RR", AX, TR, -1)):
        B = Builder()
        ang = math.radians(18) * (1 if ax < 0 else -1)
        c = Vector((-side * WT * 0.12, 0.17 * math.cos(ang), 0.17 * math.sin(ang)))
        B.add(box_verts(c, (0.06, 0.17, 0.13), Matrix.Rotation(-ang, 3, 'X').to_quaternion()), BOX_FACES, 0, 'c')
        B.add(box_verts(c + Vector((side * 0.0, 0, 0.0)), (0.062, 0.05, 0.075), Matrix.Rotation(-ang, 3, 'X').to_quaternion()), BOX_FACES, 0, 'c')
        B.obj("SKY_Caliper_" + nm, coll, [M['caliper']], smooth=None, loc=(side * th, ax, RT))


# ---------------------------------------------------------------- interior and roll cage
def build_interior(coll, M):
    B = Builder()
    IN, SE, DL, CG, MT = 0, 1, 2, 3, 4
    B.box((0, -0.55, 0.80), (1.62, 0.34, 0.20), IN)                          # dash
    B.box((0, -0.40, 0.90), (1.55, 0.2, 0.10), IN)
    for sx in (-0.34, 0.34):
        B.box((sx, -0.545, 0.945), (0.34, 0.12, 0.17), IN)                    # instrument hood
        if sx < 0:
            for dx in (-0.075, 0.075):
                lathe(B, [(0.0, 0.0), (0.0, 0.06)], 16, DL, 'y', (sx + dx, -0.602, 0.925), flip=True)
    B.box((0.0, -0.18, 0.50), (0.22, 0.6, 0.34), IN)                         # centre console / tunnel
    B.box((0.0, 0.70, 0.45), (0.28, 1.2, 0.26), IN)
    for sx in (-0.37, 0.37):
        B.box((sx, 0.05, 0.40), (0.46, 0.46, 0.14), SE)                       # bucket seats: base, back, headrest
        B.add(box_verts(Vector((sx, 0.27, 0.78)), (0.46, 0.12, 0.62), Matrix.Rotation(math.radians(-12), 3, 'X').to_quaternion()), BOX_FACES, SE, 'c')
        B.box((sx, 0.30, 1.14), (0.24, 0.08, 0.20), SE)
        B.box((sx - math.copysign(0.2, sx), 0.05, 0.50), (0.07, 0.42, 0.2), SE)
        B.box((sx + math.copysign(0.2, sx), 0.05, 0.50), (0.07, 0.42, 0.2), SE)
    B.box((0, 1.00, 0.50), (1.45, 0.45, 0.14), SE)                            # rear bench
    B.add(box_verts(Vector((0, 1.24, 0.84)), (1.45, 0.12, 0.55), Matrix.Rotation(math.radians(-10), 3, 'X').to_quaternion()), BOX_FACES, SE, 'c')
    for sx in (-0.70, 0.70):                                                  # door cards
        B.box((sx, 0.0, 0.62), (0.04, 1.4, 0.4), IN)
        B.box((sx, 1.05, 0.62), (0.04, 0.9, 0.4), IN)
    B.box((0, 0.0, 0.17), (1.5, 3.3, 0.02), MT)                               # floor
    nrm = Vector((0, 0.80, 0.60)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix()
    torus(B, (-0.36, -0.30, 0.95), 0.185, 0.016, rot, SE, 22, 6)             # steering wheel (right-hand drive)
    B.tube([(-0.36, -0.30, 0.95), (-0.36, -0.44, 0.88)], 0.02, IN, 6)
    # roll cage: main hoop behind the door, rear hoop, A-pillar bars, roof rails, diagonal
    for y, zt in ((0.58, 1.27), (1.12, 1.19)):
        B.tube([(-0.75, y, 0.40), (-0.75, y, zt - 0.14), (-0.62, y, zt), (0.62, y, zt), (0.75, y, zt - 0.14), (0.75, y, 0.40)], 0.017, CG, 8)
    for s in (-1, 1):
        B.tube([(s * 0.74, -0.52, 0.90), (s * 0.70, -0.40, 1.10), (s * 0.63, -0.15, 1.28), (s * 0.62, 0.58, 1.27), (s * 0.62, 1.12, 1.19)], 0.017, CG, 8)
        B.tube([(s * 0.74, -0.52, 0.90), (s * 0.78, -0.45, 0.45)], 0.017, CG, 8)
    B.tube([(-0.75, 0.58, 1.05), (0.75, 1.12, 0.45)], 0.014, CG, 8)
    B.tube([(0.75, 0.58, 1.05), (-0.75, 1.12, 0.45)], 0.014, CG, 8)
    B.tube([(-0.62, 0.0, 1.28), (0.62, 0.0, 1.28)], 0.017, CG, 8)
    return B.obj("SKY_Interior", coll, [M['interior'], M['seat'], M['dashlit'], M['cage'], M['matte']], smooth=45)


def build_wipers(coll, M, cabin_bvh):
    B = Builder()
    for (x0, y0, z0, x1, y1, z1) in ((0.72, -0.76, 0.975, 0.10, -0.60, 1.02), (-0.06, -0.76, 0.975, -0.66, -0.58, 1.03)):
        B.tube([(x0, y0, z0), (x1, y1, z1)], 0.006, 0, 4)
    B.tube([(0.30, 1.70, 1.045), (-0.25, 1.52, 1.095)], 0.005, 0, 4)
    return B.obj("SKY_Details_Wipers", coll, [M['black']], smooth=None)


def build_undertray(coll, M):
    parts = []
    parts.append(prism("SKY_Undertray", [(-0.60, -1.95), (0.60, -1.95), (0.68, 2.1), (-0.68, 2.1)], 'z', 0.10, 0.125, coll, M['matte']))
    return parts


# ---------------------------------------------------------------- assemble
def build():
    coll = get_coll(COLL)
    M = smat()
    body = build_body(coll, M)
    cabin = build_cabin(coll, M)
    arch_cut(body, coll, M)
    bvh = make_bvh([body])
    cabin_bvh = make_bvh([cabin])
    build_front(coll, M, bvh)
    build_sides(coll, M, bvh)
    build_rear(coll, M, bvh)
    build_wing(coll, M)
    build_interior(coll, M)
    build_wipers(coll, M, cabin_bvh)
    build_undertray(coll, M)
    for nm, y, xh, side in (("FL", -AX, TF, 1), ("FR", -AX, TF, -1), ("RL", AX, TR, 1), ("RR", AX, TR, -1)):
        sky_wheel("SKY_Wheel_" + nm, coll, M, side, (side * xh, y, RT))
    build_calipers(coll, M)
    mm = bpy.data.materials.get("CUT_arch")
    if mm and mm.users == 0:
        bpy.data.materials.remove(mm)
    for o in list(coll.objects):
        if o is not body:
            o.parent = body
            o.matrix_parent_inverse.identity()
    stats = {o.name: tri_count(o) for o in coll.objects}
    stats["TOTAL_TRIS"] = sum(stats.values())
    return stats


if __name__ == "__main__" or True:
    result = build()
