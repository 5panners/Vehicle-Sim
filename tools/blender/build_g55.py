"""Low-poly Ginetta G55 GT4-style coupe for Vehicle Sim (replaces the GT Coupe).

Run inside Blender: exec(open(path).read()).  Rebuilds the "G55" collection each run.
Conventions as the other cars: front faces -Y, +Z up, +X = car's left, origin on the ground midway between the axles,
wheels are separate objects (G55_Wheel_FL ...) with their origin at the hub, calipers (G55_Caliper_*) steer but do not spin.
Sponsors on the livery are fictional.
"""
import os, ast, math
HERE = os.path.dirname(os.path.abspath(globals().get("__file__", "/Users/paul/Documents/Game Design/Vehicle Sim/tools/blender/x.py")))
exec(open(os.path.join(HERE, "bl_helpers.py")).read())

def _pull(fname, names):
    src = open(os.path.join(HERE, fname)).read()
    for n in ast.parse(src).body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names:
            exec(compile(ast.get_source_segment(src, n), fname, "exec"), globals())
_pull("build_caterham_620r.py", {"full_loop", "loft", "solidify", "bevel", "lathe", "torus", "ruled_text", "cat_wheel", "make_bvh", "drape_rect", "Acc", "join"})
_pull("build_sp300r.py", {"drape_quad"})

COLL = "G55"
AX = 1.325                      # half wheelbase
TF, TR = 0.80, 0.80             # tyre centre-plane half track
RF, WF, RIMF = 0.34, 0.255, 0.235
RR, WR, RIMR = 0.34, 0.285, 0.24
NOSE_Y, TAIL_Y = -2.30, 2.30
ORANGE = (0.9, 0.26, 0.005)
BLUE = (0.012, 0.03, 0.30)


def gmat():
    M = {}
    M['paint'] = mat("G55_Paint", (0.74, 0.75, 0.74), 0.16, 0.0, coat=1.0)
    M['blue'] = mat("G55_Blue", BLUE, 0.2, 0.0, coat=0.6)
    M['orange'] = mat("G55_Orange", ORANGE, 0.25, 0.0, coat=0.5)
    M['white'] = mat("G55_White", (0.82, 0.82, 0.8), 0.3)
    M['black'] = mat("G55_Black", (0.012, 0.012, 0.013), 0.5, coat=0.3)
    M['matte'] = mat("G55_Matte", (0.006, 0.006, 0.007), 0.8)
    M['carbon'] = mat("G55_Carbon", (0.03, 0.032, 0.033), 0.4, coat=0.3)
    M['glass'] = mat("G55_Glass", (0.01, 0.016, 0.016), 0.04, 0.0, alpha=0.82)
    M['interior'] = mat("G55_Interior", (0.02, 0.022, 0.024), 0.85)
    M['lamp'] = mat("G55_Headlight", (0.6, 0.62, 0.65), 0.05, 0.3, emit=(0.9, 0.93, 1.0), emit_strength=0.15)
    M['lamphouse'] = mat("G55_LampHousing", (0.01, 0.012, 0.014), 0.2, 0.4)
    M['tail'] = mat("G55_Taillight", (0.5, 0.012, 0.01), 0.1, emit=(1.0, 0.03, 0.01), emit_strength=0.9)
    M['tire'] = mat("G55_Tire", (0.022, 0.022, 0.022), 0.85)
    M['rim'] = mat("G55_Rim", (0.07, 0.07, 0.075), 0.3, 0.7)
    M['lip'] = mat("G55_RimLip", (0.14, 0.14, 0.15), 0.3, 0.8)
    M['disc'] = mat("G55_BrakeDisc", (0.3, 0.3, 0.3), 0.45, 1.0)
    M['caliper'] = mat("G55_Caliper", (0.9, 0.55, 0.02), 0.35)
    M['chrome'] = mat("G55_Metal", (0.6, 0.6, 0.62), 0.25, 1.0)
    M['well'] = mat("G55_Well", (0.01, 0.01, 0.011), 0.9)
    M['mirror'] = mat("G55_Mirror", (0.75, 0.78, 0.8), 0.04, 0.9)
    return M


# ---------------------------------------------------------------- body: one loft along the car, greenhouse included
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


# measured from the reference photos (side view 400 px/m, top view scaled to a 1.95 m overall width); y runs front (-) to rear (+)
HW = [(-2.220, 0.100), (-2.210, 0.179), (-2.195, 0.281), (-2.175, 0.373), (-2.150, 0.459), (-2.120, 0.540), (-2.085, 0.615), (-2.045, 0.684), (-2.000, 0.746), (-1.950, 0.799), (-1.900, 0.840), (-1.850, 0.869), (-1.800, 0.888), (-1.750, 0.898), (-1.70, 0.93), (-1.55, 1.01), (-1.325, 1.03), (-1.1, 1.01), (-0.9, 0.975), (-0.6, 0.95), (-0.28, 0.955), (0.31, 0.96), (0.85, 0.965), (1.05, 1.0), (1.325, 1.04), (1.6, 1.015), (1.8, 0.97), (2.0, 0.91), (2.15, 0.85), (2.27, 0.79)]
BELT = [(-2.22, 0.30), (-2.17, 0.37), (-2.10, 0.45), (-2.0, 0.53), (-1.9, 0.60), (-1.7, 0.67), (-1.4, 0.74), (-1.0, 0.76), (-0.45, 0.80), (0.6, 0.80), (1.0, 0.82), (1.5, 0.87), (1.87, 0.885), (2.15, 0.92), (2.27, 0.95)]
HOOD = [(-2.22, 0.30), (-2.17, 0.36), (-2.10, 0.43), (-2.0, 0.51), (-1.9, 0.58), (-1.7, 0.66), (-1.4, 0.74), (-1.0, 0.77), (-0.45, 0.81), (1.87, 0.89), (2.05, 0.905), (2.17, 0.925), (2.27, 0.955)]
ROOF = [(-0.5, 0.80), (-0.2, 1.01), (0.16, 1.17), (0.5, 1.22), (0.97, 1.14), (1.4, 1.02), (1.87, 0.89)]
CAB = [(-0.52, 0.0), (0.16, 1.0), (0.97, 1.0), (1.87, 0.0)]
BW = [(-2.22, 0.08), (-2.09, 0.13), (-1.2, 0.50), (-0.37, 0.77), (-0.2, 0.66), (0.2, 0.62), (1.0, 0.56), (1.6, 0.34), (1.9, 0.28), (2.27, 0.26)]
FB = [(-2.0, 0.0), (-1.7, 0.04), (-1.325, 0.075), (-0.95, 0.04), (-0.7, 0.0), (0.8, 0.0), (1.05, 0.05), (1.325, 0.09), (1.6, 0.06), (1.95, 0.0)]      # fender crowns above the bonnet / deck line
STATIONS = [-2.220, -2.210, -2.195, -2.175, -2.150, -2.120, -2.085, -2.045, -2.000, -1.950, -1.900, -1.850, -1.800, -1.750, -1.72, -1.65, -1.58, -1.5, -1.42, -1.325, -1.23, -1.14, -1.05, -0.95, -0.9, -0.75, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.33, 0.5, 0.7, 0.9, 1.0, 1.1, 1.25, 1.4, 1.55, 1.7, 1.85, 1.98, 2.1, 2.2, 2.27]
SIDE_GLASS = (-0.12, 0.80)       # the side window runs between these stations; behind it the quarter panel is black


def half_profile(y):
    """the lower body and its top surface (bonnet, belt line, deck); the greenhouse is a separate loft on top (build_cabin)"""
    hw = pl(HW, y); fb = pl(FB, y)
    zb = pl(BELT, y) + fb * 0.8; zh = pl(HOOD, y); bw = pl(BW, y)
    zf = 0.14 if abs(y) > 2.1 else 0.10
    tk = pl([(1.0, 0.0), (1.5, 0.02), (1.9, 0.08), (2.1, 0.13), (2.27, 0.17)], y)      # the tail tucks in above the sill
    low = [(0, zf), (0.75 * hw, zf), (0.96 * hw, 0.12), (hw, 0.27), (hw, 0.46), (hw * (1 - 0.5 * tk), 0.60), ((0.995 - 0.9 * tk) * hw, zb - 0.09), ((0.975 - 1.4 * tk) * hw, zb)]
    crown = lambda x, z0: z0 - 0.045 * (x / max(hw, 0.2)) ** 2
    sc = 1 - 1.4 * tk
    top = [(0.93 * hw * sc, zh + fb * 0.95 - 0.03), (0.86 * hw * sc, zh + fb * 0.85), (0.78 * hw * sc, zh + fb * 0.45), (0.66 * hw * sc, zh + fb * 0.12),
           (min(bw, 0.6 * hw), crown(min(bw, 0.6 * hw), zh)), (min(0.2, 0.2 * hw), crown(0.2, zh)), (0.07, zh), (0.04, zh), (0.0, zh)]
    pts = low + top
    for k in range(len(low), len(pts)):
        x = pts[k][0]
        if k > len(low) and x > pts[k - 1][0] - 0.003: x = max(0.0, pts[k - 1][0] - 0.003)
        pts[k] = (x, pts[k][1])
    pts[-1] = (0.0, pts[-1][1])
    return pts, 0.0


def build_body(coll, M):
    stations = [(y, full_loop(half_profile(y)[0])) for y in STATIONS]
    half_n = len(half_profile(0.0)[0])
    n = len(stations[0][1])
    PAINT, BLUE_, ORANGE_, BLACK, GLASS, WHITE = 0, 1, 2, 3, 4, 5

    def mat_of(i, j):
        jj = j if j <= half_n - 2 else (n - 1) - j
        y = (STATIONS[i] + STATIONS[i + 1]) / 2
        if jj in (0, 1): return BLACK                                   # floor and its corner
        if jj == 3: return BLUE_ if -0.95 < y < 2.0 else PAINT          # blue lower band: from the front wheel arch back, none on the front          # blue lower band
        if jj == 4: return ORANGE_ if -0.95 < y < 2.1 else PAINT        # orange flank stripe (none on the front)
        if jj == 12: return BLUE_ if -2.2 < y < 2.2 else PAINT          # blue centre panel (its width follows BW)
        if jj == 13: return BLUE_ if -2.2 < y < 2.2 else PAINT
        if jj == 15: return ORANGE_                                      # the centre stripe
        return PAINT
    return loft("G55_Body", coll, stations, [M['paint'], M['blue'], M['orange'], M['black'], M['glass'], M['white']], mat_of, caps=(True, True), smooth=50)


CABIN_ST = [-0.52, -0.44, -0.35, -0.26, -0.17, -0.08, 0.02, 0.12, 0.25, 0.4, 0.6, 0.8, 0.98, 1.1, 1.25, 1.4, 1.55, 1.7, 1.85, 1.92]


def build_cabin(coll, M):
    """the greenhouse: A-pillars, windscreen, side glass, roof and the long rear window, as one loft sitting on the belt line"""
    def prof(y):
        fb = pl(FB, y)
        zbase = pl(HOOD, y) + fb * 0.85 - 0.03
        zr = max(pl(ROOF, y), zbase + 0.002)
        h = zr - zbase
        wg = min(0.86, 0.9 * pl(HW, y)); bw = pl(BW, y)
        k = min(1.0, h / 0.35)
        pts = [(0, zbase - 0.04), (wg, zbase - 0.04), (wg, zbase), (wg - 0.05 * k - 0.0, zbase + 0.40 * h), (0.70 + 0.1 * (1 - k), zbase + 0.80 * h),
               (0.62 + 0.1 * (1 - k), zr - 0.015 * k), (min(0.57, bw), zr - 0.004), (0.2, zr), (0.07, zr), (0.04, zr), (0.0, zr)]
        for q in range(3, len(pts)):                          # (points 0..2 run outwards along the bottom; the rest must keep moving inwards)
            if pts[q][0] > pts[q - 1][0] - 0.003: pts[q] = (max(0.0, pts[q - 1][0] - 0.003), pts[q][1])
        pts[-1] = (0.0, pts[-1][1])
        return pts
    stations = [(y, full_loop(prof(y))) for y in CABIN_ST]
    half_n = len(prof(0.0))
    n = len(stations[0][1])
    PAINT, BLUE_, ORANGE_, BLACK, GLASS = 0, 1, 2, 3, 4

    def mat_of(i, j):
        jj = j if j <= half_n - 2 else (n - 1) - j
        y = (CABIN_ST[i] + CABIN_ST[i + 1]) / 2
        if jj in (0, 1): return PAINT
        if jj in (2, 3):                                               # side glass between the pillars, black A-pillar and quarter
            return GLASS if SIDE_GLASS[0] < y < SIDE_GLASS[1] else BLACK
        if jj == 4: return PAINT                                      # roof rail
        if jj >= 5:
            if -0.52 < y < 0.12 or 0.98 < y < 1.9: return GLASS if jj >= 5 and jj != 5 else PAINT   # windscreen and rear window
            if jj == 6 or jj == 7: return BLUE_                       # roof panel
            if jj == 9: return ORANGE_
            return PAINT
        return PAINT
    return loft("G55_Cabin", coll, stations, [M['paint'], M['blue'], M['orange'], M['black'], M['glass']], mat_of, caps=(True, True), smooth=48)


def arch_cut(body, coll, M):
    for ax in (-AX, AX):
        for s in (1, -1):
            R = RF + 0.07
            cut = prism("CUT_arch", [(R * math.cos(2 * math.pi * k / 40) + ax, R * math.sin(2 * math.pi * k / 40) + RF) for k in range(40)], 'x',
                        (0.55 if s > 0 else -1.2), (1.2 if s > 0 else -0.55), coll, M['well'])
            apply_boolean(body, cut, 'DIFFERENCE')
            bpy.data.objects.remove(cut, do_unlink=True)
    mm = bpy.data.materials.get("CUT_arch")
    if mm and mm.users == 0:
        bpy.data.materials.remove(mm)


# ---------------------------------------------------------------- details
def hit_y(bvh, x, z, from_front=True):
    """where a ray along the car's length meets the shell at (x, z): (y, normal)"""
    o, d = (Vector((x, -4.0, z)), Vector((0, 1, 0))) if from_front else (Vector((x, 4.0, z)), Vector((0, -1, 0)))
    hit = bvh.ray_cast(o, d)
    if hit[0] is None: return (-2.3 if from_front else 2.3), -d
    n = hit[1]
    if n.dot(d) > 0: n = -n
    return hit[0].y, n


def grille_cut(body, coll, M):
    """the wide front opening: a real recess cut into the nose; its walls are the orange bezel"""
    ell = [(0.43 * math.cos(2 * math.pi * k / 40), 0.245 + 0.068 * math.sin(2 * math.pi * k / 40)) for k in range(40)]
    cut = prism("CUT_grille", ell, 'y', -2.6, -2.09, coll, M['orange'])
    n0 = tri_count(body)
    apply_boolean(body, cut, 'DIFFERENCE')
    bpy.data.objects.remove(cut, do_unlink=True)
    return tri_count(body) > 0.5 * n0


def build_nose(coll, M, bvh):
    B = Builder()
    BK, OR = 0, 1
    # front splitter: a slim carbon lip that follows the nose
    ys = [-2.22, -2.19, -2.14, -2.06, -1.97, -1.85, -1.7]
    right = [(pl(HW, y) * 0.97 + 0.03, y - 0.03 if y > -2.2 else y) for y in ys]
    outline = [(-x, y) for (x, y) in right] + [(x, y) for (x, y) in reversed(right)]
    inner = [(0.0, -1.7)]
    B.extrude([(-0.9, -1.7)] + [(-x, y) for (x, y) in right[1:]] + [(x, y) for (x, y) in reversed(right[1:])] + [(0.9, -1.7)], 'z', 0.035, 0.07, BK)
    # the grille: a raised orange bezel with a dark mesh panel inside, laid on the nose along its surface
    n = 48
    outer, inner = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        for (rx, rz, lst, off) in ((0.50, 0.100, outer, 0.010), (0.45, 0.070, inner, 0.004)):
            x, z = rx * math.cos(a), 0.245 + rz * math.sin(a)
            y, nr = hit_y(bvh, x, z)
            lst.append((x, y - off, z))
    B.add(outer + inner, [[k, (k + 1) % n, n + (k + 1) % n, n + k] for k in range(n)], OR, None)
    cy = sum(p[1] for p in inner) / n
    B.add(inner + [(0.0, cy - 0.002, 0.245)], [[(k + 1) % n, k, n] for k in range(n)], BK, None)
    return B.obj("G55_Nose", coll, [M['black'], M['orange']], smooth=None)


def rear_recess(body, coll, M):
    """the big recessed panel across the rear bumper that holds the lamps and the plate"""
    n, hx, hz, r, cz = 40, 0.68, 0.17, 0.09, 0.60
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        c, s = math.cos(a), math.sin(a)
        # superellipse-ish rounded rectangle
        x = hx * math.copysign(abs(c) ** 0.45, c); z = cz + hz * math.copysign(abs(s) ** 0.55, s)
        pts.append((x, z))
    cut = prism("CUT_rear", pts, 'y', 2.10, 2.5, coll, M['paint'])
    apply_boolean(body, cut, 'DIFFERENCE')
    bpy.data.objects.remove(cut, do_unlink=True)
    mm = bpy.data.materials.get("CUT_rear")
    if mm and mm.users == 0:
        bpy.data.materials.remove(mm)


def build_lights(coll, M, bvh):
    B = Builder()
    HO, GL, TL, BK, CH = 0, 1, 2, 3, 4
    for s in (1, -1):
        # headlights: three round lamps in dark bezels sitting on the curve of the front fender, behind the nose
        def surf(x, y):
            hit = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)))
            return hit[0].z if hit[0] is not None else 0.7
        for (dx, dy, r) in ((0.0, 0.0, 0.050), (0.115, 0.035, 0.040), (0.215, 0.07, 0.032)):
            x, y = s * (0.50 + dx), -1.86 + dy
            z = surf(x, y)
            lathe(B, [(-0.012, 0.0), (-0.012, r * 1.35), (0.0, r * 1.35)], 18, HO, 'z', (x, y, z - 0.004))          # dark bezel ring
            lathe(B, [(0.0, 0.0), (0.0, r), (0.016, r * 0.8), (0.022, 0.0)], 18, GL, 'z', (x, y, z - 0.002))       # domed lens
        # mirrors on stalks, door handles
        B.tube([(s * 0.78, -0.50, 0.82), (s * 0.90, -0.58, 0.88)], 0.008, BK, 5)
        B.add(box_verts(Vector((s * 0.96, -0.58, 0.89)), (0.17, 0.07, 0.10)), BOX_FACES, BK, 'c')
        B.box((s * 0.972, 0.07, 0.70), (0.03, 0.17, 0.035), CH)
        # round tail lights sit in the recessed panel
        for dx in (0.29, 0.58):
            y, nr = hit_y(bvh, s * dx, 0.60, False)
            lathe(B, [(0, 0), (0, 0.070), (0.010, 0.065), (0.020, 0.045)], 18, TL, 'y', (s * dx, y - 0.004, 0.60), flip=False)
    for dx in (-0.075, 0.075):
        lathe(B, [(0, 0.06), (0, 0.05), (0.08, 0.05), (0.08, 0.06)], 14, CH, 'y', (dx, TAIL_Y - 0.02, 0.26))
    y, nr = hit_y(bvh, 0, 0.60, False)
    B.box((0, y - 0.004, 0.60), (0.30, 0.012, 0.14), BK)                                     # number-plate panel
    return B.obj("G55_Lights", coll, [M['lamphouse'], M['lamp'], M['tail'], M['black'], M['chrome']], smooth=40)


def build_aero(coll, M):
    parts = []
    B = Builder()
    BK = 0
    # rear wing: carbon plane on two swan-neck uprights between tall end plates
    parts.append(prism("G55_Wing", [(1.93, 1.07), (2.27, 1.12), (2.28, 1.145), (1.95, 1.115)], 'x', -0.90, 0.90, coll, M['carbon']))
    for sx in (-0.30, 0.30):
        parts.append(prism("G55_Upright", [(1.98, 0.86), (2.10, 0.86), (2.09, 1.10), (2.01, 1.10)], 'x', sx - 0.012, sx + 0.012, coll, M['black']))
    for sx in (-0.905, 0.905):
        parts.append(prism("G55_WingPlate", [(1.92, 1.0), (2.28, 1.02), (2.28, 1.22), (1.95, 1.2)], 'x', sx - 0.01, sx + 0.01, coll, M['black']))
    # diffuser fins and undertray
    for x in (-0.62, -0.31, 0.31, 0.62):
        B.extrude([(1.6, 0.12), (2.26, 0.34), (2.3, 0.34), (2.3, 0.12)], 'x', x - 0.01, x + 0.01, BK)
    B.extrude([(1.6, 0.30), (2.3, 0.36), (2.3, 0.38), (1.6, 0.32)], 'x', -0.85, 0.85, BK)
    parts.append(B.obj("G55_Diffuser", coll, [M['matte']], smooth=None))
    parts.append(prism("G55_Undertray", [(-0.80, -1.5), (0.80, -1.5), (0.84, 1.6), (-0.84, 1.6)], 'z', 0.07, 0.10, coll, M['matte']))
    return parts


def build_interior(coll, M):
    B = Builder()
    IN, SE, CG = 0, 1, 2
    B.box((0, -0.55, 0.52), (1.6, 0.35, 0.16), IN)                         # dash
    for sx in (-0.34, 0.34):
        B.box((sx, 0.30, 0.46), (0.46, 0.46, 0.10), SE)                    # seat bases
        B.add(box_verts(Vector((sx, 0.55, 0.78)), (0.46, 0.10, 0.60), Matrix.Rotation(math.radians(-14), 3, 'X').to_quaternion()), BOX_FACES, SE, 'c')
    B.box((0, 0.2, 0.30), (0.40, 1.0, 0.30), IN)                           # tunnel
    # cage hoops
    for y in (0.62, 1.1):
        B.tube([(-0.78, y, 0.50), (-0.70, y, 1.05), (0.70, y, 1.05), (0.78, y, 0.50)], 0.016, CG, 8)
    B.tube([(-0.74, -0.55, 0.78), (-0.66, 0.0, 1.10), (-0.66, 0.62, 1.05)], 0.016, CG, 8)
    B.tube([(0.74, -0.55, 0.78), (0.66, 0.0, 1.10), (0.66, 0.62, 1.05)], 0.016, CG, 8)
    # steering wheel on the right
    nrm = Vector((0, 0.82, 0.57)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix()
    torus(B, (-0.34, -0.2, 0.80), 0.13, 0.014, rot, SE, 20, 6)
    return B.obj("G55_Interior", coll, [M['interior'], M['interior'], M['black']], smooth=45)


# ---------------------------------------------------------------- livery (draped on the shell)
def build_livery(coll, M, bvh):
    A = Acc()
    WH, BK, OR, BL = 0, 1, 2, 3
    for s in (1, -1):
        flip = s < 0
        # race-number board over the rear wheel, black louvres behind the front wheel, door shut line
        A.add(drape_quad(bvh, [(0.42, 0.10), (0.87, 0.10), (0.42, 0.54), (0.87, 0.54)], 6, 6, 0.003, s), WH, flip)
        for k in range(5):
            y0 = -0.86 + k * 0.085
            A.add(drape_quad(bvh, [(y0, 0.27), (y0 + 0.05, 0.27), (y0 + 0.09, 0.47), (y0 + 0.14, 0.47)], 1, 4, 0.003, s), BK, flip)
        A.add(drape_quad(bvh, [(-0.34, 0.20), (-0.325, 0.20), (-0.30, 0.78), (-0.285, 0.78)], 1, 6, 0.0025, s), BK, flip)
        A.add(drape_quad(bvh, [(0.86, 0.20), (0.875, 0.20), (0.86, 0.80), (0.875, 0.80)], 1, 6, 0.0025, s), BK, flip)
        # big dark bonnet vents either side
        A.add(drape_rect(bvh, 'z', s * 0.30, s * 0.64, -1.50, -1.05, 6, 8, 0.003), BK, s < 0)
    ob = mesh_obj("G55_Livery", A.v, A.f, coll, [M['white'], M['black'], M['orange'], M['blue']], face_mats=A.m, smooth_angle=None)
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if (Vector(f.normal).dot(Vector((math.copysign(1, f.calc_center_median().x), 0, 0))) < 0 and f.calc_center_median().z < 0.9 and abs(f.calc_center_median().y) < 2.1)
                                       or (Vector(f.normal).dot(Vector((0, 0, 1))) < 0 and f.calc_center_median().z >= 0.9)])
    bm.to_mesh(ob.data); bm.free()
    parts = [ob]
    for s in (1, -1):
        t = ruled_text("48", 0.30, 0, 0.645, 0.28, '+x' if s > 0 else '-x', 0, coll, [M['black']], "G55_Number", 1.0)
        for v in t.data.vertices:
            v.co.x = s * (pl(HW, v.co.y) + 0.006)
        parts.append(t)
        t2 = ruled_text("HAWKFORD CLASSICS", 0.085, 0, 0.0, 0.335, '+x' if s > 0 else '-x', 0, coll, [M['white']], "G55_Sponsor", 1.0)
        for v in t2.data.vertices:
            v.co.x = s * (pl(HW, v.co.y) + 0.006)
        parts.append(t2)
    return parts


def build_calipers(coll, M):
    objs = []
    for nm, ax, th, R, W, side in (("FL", -AX, TF, RF, WF, 1), ("FR", -AX, TF, RF, WF, -1), ("RL", AX, TR, RR, WR, 1), ("RR", AX, TR, RR, WR, -1)):
        B = Builder()
        h = W / 2
        ang = math.radians(15)
        c = Vector((-side * h * 0.16, 0.20 * math.cos(ang), 0.20 * math.sin(ang)))
        B.add(box_verts(c, (0.06, 0.10, 0.13), Matrix.Rotation(-ang, 3, 'X').to_quaternion()), BOX_FACES, 0, 'c')
        objs.append(B.obj("G55_Caliper_" + nm, coll, [M['caliper']], smooth=None, loc=(side * th, ax, R)))
    return objs


# ---------------------------------------------------------------- assemble
def build():
    coll = get_coll(COLL)
    M = gmat()
    body = build_body(coll, M)
    cabin = build_cabin(coll, M)
    rear_recess(body, coll, M)
    arch_cut(body, coll, M)
    bvh = make_bvh([body])
    livery = build_livery(coll, M, bvh)
    cabin_bvh = make_bvh([cabin])
    sun = Acc()
    sun.add(drape_rect(cabin_bvh, 'z', -0.52, 0.52, -0.16, 0.0, 6, 2, 0.003), 0)
    so = mesh_obj('G55_Sunstrip', sun.v, sun.f, coll, [M['black']], smooth_angle=None)
    set_smooth(body, 62)
    nose = build_nose(coll, M, bvh)
    lights = build_lights(coll, M, bvh)
    aero = build_aero(coll, M)
    interior = build_interior(coll, M)
    for nm, y, xh, R, W, RIM, side in (("FL", -AX, TF, RF, WF, RIMF, 1), ("FR", -AX, TF, RF, WF, RIMF, -1),
                                       ("RL", AX, TR, RR, WR, RIMR, 1), ("RR", AX, TR, RR, WR, RIMR, -1)):
        cat_wheel("G55_Wheel_" + nm, coll, M, R, W, RIM, side, (side * xh, y, R))
    build_calipers(coll, M)
    for m in ("CUT_arch",):
        mm = bpy.data.materials.get(m)
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
