"""Low-poly Caterham SP/300.R-style Le Mans roadster prototype for Vehicle Sim (the 'Track Prototype').

Run inside Blender: exec(open(path).read()).  Rebuilds the "SP" collection each run.
Conventions as the other cars: front faces -Y, +Z up, +X = car's left, origin on the ground midway between the axles,
wheels are separate objects (SP_Wheel_FL ...) with their origin at the hub, calipers (SP_Caliper_*) steer but do not spin.
"""
import os, ast
HERE = os.path.dirname(os.path.abspath(globals().get("__file__", "/Users/paul/Documents/Game Design/Vehicle Sim/tools/blender/x.py")))
exec(open(os.path.join(HERE, "bl_helpers.py")).read())

# reuse the generic helpers of the Caterham build (loft, solidify, bevel, lathe, torus, text, wheel, drape ...)
_src = open(os.path.join(HERE, "build_caterham_620r.py")).read()
_tree = ast.parse(_src)
_want = {"full_loop", "loft", "solidify", "bevel", "lathe", "torus", "ruled_text", "cat_wheel", "make_bvh", "drape_rect", "Acc", "join"}
for _n in _tree.body:
    if isinstance(_n, (ast.FunctionDef, ast.ClassDef)) and _n.name in _want:
        exec(compile(ast.get_source_segment(_src, _n), "caterham_helper", "exec"))

COLL = "SP"
AX_F, AX_R = -1.375, 1.375
TF, TR = 0.825, 0.80
RF, WF, RIMF = 0.33, 0.30, 0.235
RR, WR, RIMR = 0.34, 0.35, 0.24
TIP_Y, TAIL_Y = -2.30, 2.04
ORANGE = (0.9, 0.22, 0.005)


def smat():
    M = {}
    M['paint'] = mat("SP_Paint", (0.62, 0.64, 0.64), 0.2, 0.0, coat=1.0)
    M['orange'] = mat("SP_Orange", ORANGE, 0.3, 0.0, coat=0.4)
    M['white'] = mat("SP_White", (0.8, 0.8, 0.78), 0.35)
    M['black'] = mat("SP_Black", (0.014, 0.014, 0.015), 0.45, coat=0.3)
    M['matte'] = mat("SP_Matte", (0.006, 0.006, 0.007), 0.8)
    M['carbon'] = mat("SP_Carbon", (0.03, 0.032, 0.033), 0.4, coat=0.3)
    M['interior'] = mat("SP_Interior", (0.02, 0.022, 0.024), 0.8)
    M['seat'] = mat("SP_Seat", (0.012, 0.012, 0.014), 0.85)
    M['lamp'] = mat("SP_Headlight", (0.5, 0.55, 0.6), 0.05, 0.3, emit=(0.85, 0.9, 1.0), emit_strength=0.12)
    M['lamphouse'] = mat("SP_LampHousing", (0.01, 0.012, 0.014), 0.2, 0.4)
    M['tail'] = mat("SP_Taillight", (0.5, 0.012, 0.01), 0.1, emit=(1.0, 0.03, 0.01), emit_strength=0.9)
    M['tire'] = mat("SP_Tire", (0.022, 0.022, 0.022), 0.85)
    M['rim'] = mat("SP_Rim", (0.03, 0.03, 0.034), 0.35, 0.6)
    M['lip'] = mat("SP_RimLip", (0.18, 0.18, 0.2), 0.3, 0.8)
    M['disc'] = mat("SP_BrakeDisc", (0.3, 0.3, 0.3), 0.45, 1.0)
    M['caliper'] = mat("SP_Caliper", ORANGE, 0.35)
    M['mirror'] = mat("SP_Mirror", (0.75, 0.78, 0.8), 0.04, 0.9)
    M['chrome'] = mat("SP_Metal", (0.55, 0.55, 0.58), 0.3, 1.0)
    M['well'] = mat("SP_Well", (0.01, 0.01, 0.011), 0.9)
    return M


# ---------------------------------------------------------------- centre spine: nose, tub, engine cover
SPINE = [  # y, half width of the tub, top z, bottom z, outer width of the lower flank (the side pods between the wheels)
    (-2.30, 0.14, 0.37, 0.20, 0.14), (-2.22, 0.17, 0.42, 0.14, 0.17), (-2.05, 0.21, 0.46, 0.11, 0.21), (-1.75, 0.26, 0.50, 0.10, 0.26),
    (-1.35, 0.30, 0.54, 0.10, 0.30), (-1.02, 0.38, 0.62, 0.10, 0.38), (-0.90, 0.44, 0.70, 0.10, 0.72), (-0.6, 0.46, 0.77, 0.10, 0.78),
    (-0.2, 0.46, 0.80, 0.10, 0.78), (0.1, 0.46, 0.80, 0.10, 0.78), (0.4, 0.45, 0.77, 0.10, 0.78), (0.62, 0.43, 0.74, 0.10, 0.72),
    (0.80, 0.42, 0.72, 0.10, 0.42), (1.2, 0.38, 0.65, 0.10, 0.38), (1.6, 0.34, 0.58, 0.12, 0.34), (2.04, 0.30, 0.52, 0.16, 0.30),
]
BLACK_Y = (-0.82, 1.10)      # the black lower flank panel runs between these stations


def spine_half(hw, zt, zb, W):
    h = zt - zb
    zs = zb + 0.43 * h
    zc = lambda x: zt - 0.05 * h * (x / hw) ** 2
    d1, d2 = min(0.06, (W - hw) * 0.4), (W - hw) * 0.3
    return [(0, zb), (0.75 * W, zb), (W, zb + 0.05 * h), (W, zs), (W - d1, zs + 0.03 * h), (hw + d2, zs + 0.14 * h), (hw, zs + 0.30 * h),
            (hw, zb + 0.85 * h), (0.88 * hw, zc(0.88 * hw)), (0.098, zc(0.098)), (0.008, zc(0.008)), (0, zt)]


def build_spine(coll, M):
    stations = [(y, full_loop(spine_half(hw, zt, zb, W))) for (y, hw, zt, zb, W) in SPINE]
    n = len(stations[0][1])
    half_n = 12

    def mat_of(i, j):
        jj = j if j <= half_n - 2 else (n - 1) - j
        yk = (SPINE[i][0] + SPINE[i + 1][0]) / 2
        if jj == 9: return 1                                # orange stripe
        if jj == 10: return 2                               # black pin line down the middle
        if jj == 0: return 2                                # floor
        if jj in (1, 2) and BLACK_Y[0] <= yk <= BLACK_Y[1]: return 2   # black lower flank
        return 0
    body = loft("SP_Spine", coll, stations, [M['paint'], M['orange'], M['black']], mat_of, caps=(2, 2), smooth=50)
    return body


# ---------------------------------------------------------------- wheel pods (the big front and rear fenders)
def build_pod(coll, M, front):
    if front:
        ys = [-2.12, -2.0, -1.8, -1.55, -1.375, -1.2, -1.0, -0.85]
        crown = [0.32, 0.46, 0.64, 0.745, 0.76, 0.75, 0.70, 0.62]
        wid = [0.76, 0.84, 0.90, 0.96, 0.985, 0.985, 0.97, 0.94]
        hub = (AX_F, RF)
    else:
        ys = [0.55, 0.75, 0.95, 1.15, 1.375, 1.6, 1.85, 2.04]
        crown = [0.50, 0.66, 0.74, 0.77, 0.78, 0.76, 0.70, 0.60]
        wid = [0.86, 0.94, 0.98, 0.99, 0.99, 0.97, 0.90, 0.80]
        hub = (AX_R, RR)
    x0, zb = 0.26, 0.10
    objs = []
    for s in (1, -1):
        stations = []
        for y, c, w in zip(ys, crown, wid):
            k = (c - zb)
            loop = [(x0, zb), (w - 0.04, zb), (w, zb + 0.10 * k), (w, zb + 0.55 * k), (w - 0.07, zb + 0.90 * k), (w - 0.22, c), (w - 0.45, c - 0.005),
                    (x0 + 0.16, c - 0.10 * k), (x0 + 0.01, zb + 0.55 * k)]
            stations.append((y, [(s * x, z) for (x, z) in loop]))
        ob = loft("SP_Pod", coll, stations, [M['paint']], None, caps=(True, True), smooth=50)
        # wheel arch: a cylinder around the hub axis, cut through the pod (the cut face is black like the arch liner)
        R = (RF if front else RR) + 0.045
        cut = prism("CUT_arch", [(R * math.cos(2 * math.pi * k / 40) + hub[0], R * math.sin(2 * math.pi * k / 40) + hub[1]) for k in range(40)], 'x',
                    s * 0.30 if s > 0 else -1.2, 1.2 if s > 0 else s * 0.30, coll, M['well'])
        apply_boolean(ob, cut, 'DIFFERENCE')
        bpy.data.objects.remove(cut, do_unlink=True)
        objs.append(ob)
    return objs


def build_cockpit_cut(spine, coll, M):
    outline = [(-0.30, -0.93), (0.30, -0.93), (0.375, -0.80), (0.375, -0.05), (0.30, 0.03), (-0.30, 0.03), (-0.375, -0.05), (-0.375, -0.80)]
    cut = prism("CUT_cockpit", outline, 'z', 0.30, 1.3, coll, M['interior'])
    apply_boolean(spine, cut, 'DIFFERENCE')
    bpy.data.objects.remove(cut, do_unlink=True)
    for m in ("CUT_cockpit", "CUT_arch"):
        mm = bpy.data.materials.get(m)
        if mm and mm.users == 0:
            bpy.data.materials.remove(mm)


# ---------------------------------------------------------------- cockpit contents
def build_interior(coll, M):
    B = Builder()
    SE, HE, BK, GA = 0, 1, 2, 3
    for sx in (-0.21, 0.21):
        # seat: cushion, reclined back with side bolsters, padded headrest (white, branded)
        B.box((sx, -0.28, 0.36), (0.38, 0.40, 0.08), SE)
        lean = Matrix.Rotation(math.radians(-22), 3, 'X').to_quaternion()
        B.add(box_verts(Vector((sx, -0.05, 0.63)), (0.40, 0.07, 0.52), lean), BOX_FACES, SE, 'c')
        for bx in (-0.19, 0.19):
            B.add(box_verts(Vector((sx + bx, -0.10, 0.60)), (0.05, 0.16, 0.46), lean), BOX_FACES, SE, 'c')
        B.add(box_verts(Vector((sx, 0.02, 0.90)), (0.20, 0.07, 0.16), lean), BOX_FACES, HE, 'c')
        # roll hoop behind each seat
        B.tube([(sx - 0.12, 0.13, 0.50), (sx - 0.12, 0.15, 0.92), (sx - 0.06, 0.16, 1.0), (sx + 0.06, 0.16, 1.0), (sx + 0.12, 0.15, 0.92), (sx + 0.12, 0.13, 0.50)], 0.014, BK, 8)
    # dashboard and instruments
    B.add(box_verts(Vector((0, -0.84, 0.62)), (0.74, 0.12, 0.20)), BOX_FACES, BK, 'c')
    lathe(B, [(0, 0), (0, 0.045), (-0.01, 0.045)], 14, GA, 'y', (-0.21, -0.775, 0.66))
    # steering wheel (right-hand seat) and column
    nrm = Vector((0, 0.8, 0.6)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix()
    B.tube([(-0.21, -0.82, 0.60), (-0.21, -0.62, 0.70)], 0.014, BK, 6)
    torus(B, (-0.21, -0.60, 0.71), 0.125, 0.014, rot, BK, 20, 6)
    return B.obj("SP_Interior", coll, [M['seat'], M['white'], M['black'], M['gauge'] if 'gauge' in M else M['chrome']], smooth=45)


# ---------------------------------------------------------------- aero
def build_aero(coll, M):
    parts = []
    # front splitter and undertray
    parts.append(prism("SP_Splitter", [(-0.88, -2.02), (-0.5, -2.32), (0.5, -2.32), (0.88, -2.02), (0.92, -1.2), (-0.92, -1.2)], 'z', 0.045, 0.085, coll, M['carbon']))
    parts.append(prism("SP_Undertray", [(-0.4, -1.3), (0.4, -1.3), (0.4, -1.0), (0.76, -1.0), (0.76, 0.7), (0.4, 0.7), (0.4, 1.7), (-0.4, 1.7), (-0.4, 0.7), (-0.76, 0.7), (-0.76, -1.0), (-0.4, -1.0)], 'z', 0.07, 0.10, coll, M['matte']))
    # rear wing: main plane, pylons, striped end plates
    wing = [(1.60, 0.90), (1.82, 0.915), (1.84, 0.925), (1.60, 0.92)]
    parts.append(prism("SP_Wing", [(1.58, 0.905), (1.84, 0.93), (1.85, 0.945), (1.60, 0.93)], 'x', -0.95, 0.95, coll, M['black']))
    parts.append(prism("SP_WingFlap", [(1.78, 0.945), (1.88, 0.99), (1.89, 1.0), (1.8, 0.96)], 'x', -0.95, 0.95, coll, M['black']))
    for sx in (-0.13, 0.13):
        parts.append(prism("SP_Pylon", [(1.66, 0.50), (1.76, 0.50), (1.74, 0.91), (1.64, 0.91)], 'x', sx - 0.012, sx + 0.012, coll, M['black']))
    # end plates: diagonal orange / black stripes built from small faces
    for s in (1, -1):
        nu, nv = 14, 14
        verts, faces, fm = [], [], []
        y0, y1, z0, z1 = 1.52, 1.90, 0.58, 1.04
        for j in range(nv + 1):
            for i in range(nu + 1):
                verts.append((s * 0.965, y0 + (y1 - y0) * i / nu, z0 + (z1 - z0) * j / nv))
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                faces.append([a, a + 1, a + nu + 2, a + nu + 1] if s > 0 else [a + nu + 1, a + nu + 2, a + 1, a])
                fm.append(0 if ((i + j) // 3) % 2 == 0 else 1)
        ep = mesh_obj("SP_EndPlate", verts, faces, coll, [M['orange'], M['black']], face_mats=fm, smooth_angle=None)
        parts.append(ep)
    # diffuser: upswept fins under the tail
    B = Builder()
    for x in (-0.50, -0.22, 0.22, 0.50):
        B.extrude([(1.40, 0.10), (2.04, 0.30), (2.07, 0.30), (2.07, 0.10)], 'x', x - 0.008, x + 0.008, 0)
    B.extrude([(1.40, 0.28), (2.07, 0.34), (2.07, 0.36), (1.40, 0.30)], 'x', -0.62, 0.62, 0)
    parts.append(B.obj("SP_Diffuser", coll, [M['matte']], smooth=None))
    return parts


def build_lights(coll, M):
    B = Builder()
    HO, GL, RD, BK = 0, 1, 2, 3
    for s in (1, -1):
        # headlight cluster on the nose of each front pod: dark housing, big lamp over a smaller one
        c = Vector((s * 0.70, -1.985, 0.455))
        rot = Matrix.Rotation(math.radians(-14 * s), 3, 'Z').to_quaternion()
        B.add(box_verts(c, (0.26, 0.05, 0.20), rot), BOX_FACES, HO, 'c')
        lathe(B, [(0.0, 0.0), (0.0, 0.052), (-0.014, 0.05)], 14, GL, 'y', (s * 0.67, -2.015, 0.50), flip=True)
        lathe(B, [(0.0, 0.0), (0.0, 0.036), (-0.012, 0.034)], 12, GL, 'y', (s * 0.70, -2.015, 0.40), flip=True)
        # mirrors on short stalks at the pod / tub junction
        B.tube([(s * 0.47, -0.86, 0.74), (s * 0.58, -0.92, 0.86)], 0.007, BK, 5)
        B.add(box_verts(Vector((s * 0.60, -0.93, 0.87)), (0.17, 0.05, 0.075)), BOX_FACES, BK, 'c')
        # tail lights: black panels with a red edge on the rear of each pod
        B.box((s * 0.77, TAIL_Y + 0.004, 0.50), (0.27, 0.03, 0.26), BK)
        B.box((s * 0.77, TAIL_Y + 0.02, 0.50), (0.255, 0.012, 0.012), RD)
        for k in range(4):
            B.box((s * 0.77, TAIL_Y + 0.022, 0.40 + k * 0.065), (0.2, 0.01, 0.02), HO)
    # centre rain light and tow nub
    B.box((0, TAIL_Y + 0.01, 0.34), (0.16, 0.03, 0.09), RD)
    # nose intake: black recess
    B.box((0, TIP_Y + 0.02, 0.27), (0.24, 0.05, 0.10), BK)
    return B.obj("SP_Lights", coll, [M['lamphouse'], M['lamp'], M['tail'], M['black']], smooth=40)


# ---------------------------------------------------------------- livery (flank diagonals, lettering, rear vents)
def drape_quad(bvh, c, nu, nv, off, s):
    """quad given by four (y, z) corners on the flank (bilinear grid), ray-cast onto the body from side s"""
    verts, faces = [], []
    (a, b, d, e) = c   # a->b along the bottom, d->e along the top
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            y = (a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + e[0] * u) * v
            z = (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + e[1] * u) * v
            o, dr = Vector((s * 1.5, y, z)), Vector((-s, 0, 0))
            hit = bvh.ray_cast(o, dr)
            if hit[0] is None:
                p, n = Vector((s * 0.46, y, z)), -dr
            else:
                p, n = hit[0], hit[1]
                if n.dot(dr) > 0:
                    n = -n
            verts.append(tuple(p + n * off))
    for j in range(nv):
        for i in range(nu):
            q = j * (nu + 1) + i
            faces.append([q, q + 1, q + nu + 2, q + nu + 1])
    return verts, faces


def hw_at(y):
    for (y0, _a, _b, _c, h0), (y1, _d, _e, _f, h1) in zip(SPINE, SPINE[1:]):
        if y0 <= y <= y1:
            return h0 + (h1 - h0) * (y - y0) / (y1 - y0)
    return SPINE[-1][4]


def build_livery(coll, M, bvh):
    A = Acc()
    for s in (1, -1):
        flip = s < 0
        for (yb, yt) in ((-0.64, -0.30), (-0.43, -0.07)):                    # two orange diagonals on the black flank
            A.add(drape_quad(bvh, [(yb, 0.11), (yb + 0.055, 0.11), (yt, 0.40), (yt + 0.055, 0.40)], 3, 6, 0.0025, s), 0, flip)
        # a thin orange line along the flank edge
        A.add(drape_quad(bvh, [(-0.08, 0.385), (1.05, 0.385), (-0.08, 0.395), (1.05, 0.395)], 20, 1, 0.0025, s), 0, flip)
    ob = mesh_obj("SP_Livery", A.v, A.f, coll, [M['orange']], face_mats=A.m, smooth_angle=None)
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if Vector(f.normal).dot(Vector((math.copysign(1, f.calc_center_median().x), 0, 0))) < 0])
    bm.to_mesh(ob.data); bm.free()
    parts = [ob]
    for s in (1, -1):
        t = ruled_text("SP//300.R", 0.075, 0, 0.30, 0.22, '+x' if s > 0 else '-x', 0, coll, [M['white']], "SP_SideText", 1.0)
        for v in t.data.vertices:
            v.co.x = s * (hw_at(v.co.y) + 0.003)
        parts.append(t)
    return parts


# ---------------------------------------------------------------- calipers
def build_caliper(name, coll, M, R, W, side, loc):
    B = Builder()
    h = W / 2
    ang = math.radians(15)
    c = Vector((-side * h * 0.16, 0.19 * math.cos(ang), 0.19 * math.sin(ang)))
    rot = Matrix.Rotation(-ang, 3, 'X').to_quaternion()
    B.add(box_verts(c, (0.055, 0.10, 0.13), rot), BOX_FACES, 0, 'c')
    return B.obj(name, coll, [M['caliper']], smooth=None, loc=loc)


# ---------------------------------------------------------------- assemble
def build():
    coll = get_coll(COLL)
    M = smat()
    spine = build_spine(coll, M)
    build_cockpit_cut(spine, coll, M)       # needs the cutter material first
    pods = build_pod(coll, M, True) + build_pod(coll, M, False)
    bvh = make_bvh([spine])
    livery = build_livery(coll, M, bvh)
    body = join([spine] + pods, "SP_Body", coll)
    set_smooth(body, 48)
    interior = build_interior(coll, M)
    aero = build_aero(coll, M)
    lights = build_lights(coll, M)
    for nm, y, xh, R, W, RIM, side in (("FL", AX_F, TF, RF, WF, RIMF, 1), ("FR", AX_F, TF, RF, WF, RIMF, -1),
                                       ("RL", AX_R, TR, RR, WR, RIMR, 1), ("RR", AX_R, TR, RR, WR, RIMR, -1)):
        cat_wheel("SP_Wheel_" + nm, coll, M, R, W, RIM, side, (side * xh, y, R))
        build_caliper("SP_Caliper_" + nm, coll, M, R, W, side, (side * xh, y, R))
    for m in ("CUT_arch", "CUT_cockpit"):
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
