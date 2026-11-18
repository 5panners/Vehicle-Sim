"""Low-poly Caterham 620R-style Seven for Vehicle Sim (shape matched to reference renders).

Run inside Blender: exec(open(path).read()).  Rebuilds the "CAT" collection each run.

Conventions (match the game / glTF export):
  Blender: front of car faces -Y, +Z up, +X = car's left (the car is right-hand drive, wheel at -X).
  Origin = ground plane, midway between the axles.  Wheels are separate objects with their origin at the
  hub centre (CAT_Wheel_FL ...), the front cycle wings ride on CAT_Caliper_FL/FR so they steer but do not spin.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(globals().get("__file__", "/Users/paul/Documents/Game Design/Vehicle Sim/tools/blender/x.py")))
exec(open(os.path.join(HERE, "bl_helpers.py")).read())

COLL = "CAT"
AX_F, AX_R = -1.2, 1.2
TF, TR = 0.62, 0.64                       # tyre centre-plane half track
RF, WF, RIMF = 0.285, 0.205, 0.196        # front tyre radius / width / rim radius
RR, WR, RIMR = 0.300, 0.260, 0.205
NOSE_Y, TAIL_Y = -1.52, 1.59

GREEN = (0.005, 0.036, 0.014)
YELLOW = (0.62, 0.27, 0.004)


def cmat():
    M = {}
    M['paint'] = mat("CAT_Paint", GREEN, 0.16, 0.0, coat=1.0)
    M['yellow'] = mat("CAT_Yellow", YELLOW, 0.25, 0.0, coat=0.5)
    M['white'] = mat("CAT_White", (0.72, 0.72, 0.70), 0.3)
    M['carbon'] = mat("CAT_Carbon", (0.028, 0.03, 0.03), 0.42, 0.0, coat=0.3)
    M['black'] = mat("CAT_Black", (0.012, 0.012, 0.013), 0.55)
    M['grille'] = mat("CAT_Grille", (0.006, 0.006, 0.007), 0.8)
    M['chrome'] = mat("CAT_Metal", (0.58, 0.58, 0.6), 0.3, 1.0)
    M['tire'] = mat("CAT_Tire", (0.024, 0.024, 0.024), 0.85)
    M['rim'] = mat("CAT_Rim", (0.02, 0.02, 0.022), 0.4, 0.5)
    M['lip'] = mat("CAT_RimLip", (0.62, 0.62, 0.62), 0.28, 0.9)
    M['disc'] = mat("CAT_BrakeDisc", (0.30, 0.30, 0.30), 0.45, 1.0)
    M['lamp'] = mat("CAT_Headlight", (0.5, 0.52, 0.55), 0.05, 0.3, emit=(0.85, 0.9, 1.0), emit_strength=0.12)
    M['tail'] = mat("CAT_Taillight", (0.5, 0.012, 0.01), 0.1, emit=(1.0, 0.03, 0.01), emit_strength=0.9)
    M['clear'] = mat("CAT_ClearLens", (0.62, 0.64, 0.66), 0.08, 0.2)
    M['amber'] = mat("CAT_Indicator", (0.9, 0.45, 0.02), 0.1, emit=(1.0, 0.5, 0.05), emit_strength=0.25)
    M['seat'] = mat("CAT_Seat", (0.016, 0.016, 0.018), 0.85)
    M['dash'] = mat("CAT_Dash", (0.03, 0.032, 0.034), 0.5)
    M['gauge'] = mat("CAT_Gauge", (0.75, 0.78, 0.8), 0.4)
    M['red'] = mat("CAT_Red", (0.7, 0.03, 0.02), 0.4)
    M['mirror'] = mat("CAT_Mirror", (0.75, 0.78, 0.8), 0.04, 0.9)
    M['pipe'] = mat("CAT_Exhaust", (0.5, 0.5, 0.5), 0.35, 1.0)
    M['floor'] = mat("CAT_Floor", (0.02, 0.022, 0.024), 0.9)
    return M


# ---------------------------------------------------------------- generic geometry helpers
def full_loop(half):
    """half profile bottom-centre -> top-centre (x >= 0) -> closed loop around the section"""
    return list(half) + [(-x, z) for (x, z) in reversed(half[1:-1])]


def loft(name, coll, stations, mats, mat_of=None, caps=(True, True), smooth=40):
    """stations: [(y, loop [(x, z)...])], same point count; mat_of(i_station, j_point) -> material index of the quad"""
    n = len(stations[0][1])
    verts, faces, fm = [], [], []
    for y, loop in stations:
        for (x, z) in loop:
            verts.append((x, y, z))
    for i in range(len(stations) - 1):
        for j in range(n):
            k = (j + 1) % n
            faces.append([i * n + j, i * n + k, (i + 1) * n + k, (i + 1) * n + j])
            fm.append(mat_of(i, j) if mat_of else 0)
    if caps[0]:
        faces.append(list(range(n))[::-1]); fm.append(caps[0] if isinstance(caps[0], int) and caps[0] is not True else 0)
    if caps[1]:
        last = (len(stations) - 1) * n
        faces.append([last + j for j in range(n)]); fm.append(caps[1] if isinstance(caps[1], int) and caps[1] is not True else 0)
    ob = mesh_obj(name, verts, faces, coll, mats, face_mats=fm, smooth_angle=smooth)
    fix_normals(ob)
    return ob


def solidify(ob, t, offset=-1.0):
    mod = ob.modifiers.new("solid", 'SOLIDIFY')
    mod.thickness = t
    mod.offset = offset
    mod.use_even_offset = True
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.remove(mod)
    ob.data = new
    new.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def bevel(ob, w, seg=1, angle=40):
    mod = ob.modifiers.new("bev", 'BEVEL')
    mod.width = w
    mod.segments = seg
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.remove(mod)
    ob.data = new
    new.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def lathe(B, profile, segs, mi, axis, center, flip=False):
    """revolve (axial, radius) profile around an axis through center; axis in 'x','y','z'"""
    n = len(profile)
    vs, fs = [], []
    cx, cy, cz = center
    for s in range(segs):
        a = 2 * math.pi * s / segs
        ca, sa = math.cos(a), math.sin(a)
        for (ax, r) in profile:
            if axis == 'x':
                vs.append((cx + ax, cy + r * ca, cz + r * sa))
            elif axis == 'y':
                vs.append((cx + r * ca, cy + ax, cz + r * sa))
            else:
                vs.append((cx + r * ca, cy + r * sa, cz + ax))
    for s in range(segs):
        s2 = (s + 1) % segs
        for i in range(n - 1):
            f = [s * n + i, s * n + i + 1, s2 * n + i + 1, s2 * n + i]
            fs.append(f[::-1] if flip else f)
    B.add(vs, fs, mi, None)


def torus(B, center, R, r, rot, mi, segs=20, sides=6):
    """ring of radius R, tube radius r; rot = matrix turning the ring's local XY plane"""
    vs, fs = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        for j in range(sides):
            b = 2 * math.pi * j / sides
            p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            vs.append(tuple(Vector(center) + rot @ p))
    for i in range(segs):
        for j in range(sides):
            i2, j2 = (i + 1) % segs, (j + 1) % sides
            fs.append([i * sides + j, i2 * sides + j, i2 * sides + j2, i * sides + j2])
    B.add(vs, fs, mi, 'c')


def ruled_text(txt, size, x, y, z, face, mi_obj, coll, mats, name, bold_x=1.0, rot=0.0, flipx=False):
    """flat text decal on a plane; face = '+y' / '-y' / '+x' / '-x' (outward direction)"""
    verts2, faces2 = text_tris(txt, size, bold_x)
    vs = []
    for (u, v) in verts2:
        if flipx:
            u = -u
        c, s = math.cos(rot), math.sin(rot)
        u, v = u * c - v * s, u * s + v * c
        if face == '+y':     # on the tail, read from behind: u runs toward -x
            vs.append((x - u, y, z + v))
        elif face == '-y':
            vs.append((x + u, y, z + v))
        elif face == '+x':   # on the left flank, read from outside: u runs toward -y (towards the rear = +y reading direction for the left side)
            vs.append((x, y + u, z + v))
        else:                # '-x' right flank: read from outside, u runs toward -y
            vs.append((x, y - u, z + v))
    fs = [list(f) for f in faces2]
    ob = mesh_obj(name, vs, fs, coll, mats, smooth_angle=None)
    # normals out
    nrm = {'+y': (0, 1, 0), '-y': (0, -1, 0), '+x': (1, 0, 0), '-x': (-1, 0, 0)}[face]
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    fl = [f for f in bm.faces if Vector(f.normal).dot(Vector(nrm)) < 0]
    bmesh.ops.reverse_faces(bm, faces=fl)
    bm.to_mesh(ob.data); bm.free()
    return ob


# ---------------------------------------------------------------- body
BONNET = [  # y, half width, top z, bottom z
    (-1.52, 0.235, 0.565, 0.325), (-1.50, 0.255, 0.600, 0.312), (-1.45, 0.278, 0.636, 0.302), (-1.36, 0.306, 0.664, 0.292),
    (-1.2, 0.335, 0.684, 0.285), (-1.0, 0.382, 0.706, 0.265), (-0.8, 0.425, 0.722, 0.25), (-0.55, 0.462, 0.738, 0.24),
    (-0.3, 0.488, 0.752, 0.235), (-0.1, 0.502, 0.762, 0.23), (0.02, 0.506, 0.766, 0.228),
]
STRIPE_X = (0.098, 0.087, 0.075)          # white pinstripe outer/inner edge, yellow half width


def bonnet_half(hw, zt, zb):
    h = zt - zb
    zc = lambda x: zt - 0.10 * h * (x / hw) ** 2
    pts = [(0, zb), (0.6 * hw, zb), (0.93 * hw, zb + 0.10 * h), (hw, zb + 0.42 * h), (0.975 * hw, zb + 0.75 * h),
           (0.84 * hw, zc(0.84 * hw)), (0.66 * hw, zc(0.66 * hw))]
    for x in STRIPE_X:
        pts.append((x, zc(x)))
    pts.append((0, zt))
    return pts


def build_bonnet(coll, M):
    stations = [(y, full_loop(bonnet_half(hw, zt, zb))) for (y, hw, zt, zb) in BONNET]
    n = len(stations[0][1])
    half_n = len(bonnet_half(0.3, 0.7, 0.3))          # 12 -> indices 0..11 on the +x side; mirrored after
    # segment j goes from point j to j+1; top rows are the last four segments of the half and their mirrors
    def mat_of(i, j):
        if j >= half_n - 1:                           # mirrored side: segment j <-> half segment (n - 1 - j)
            jj = n - 1 - j
        else:
            jj = j
        # half segments: ... 6->7 green, 7->8 white, 8->9 green, 9->10?? see below
        t = half_n - 2 - jj                           # 0 = the centre segment
        if t == 0: return 2                           # yellow
        if t == 1: return 0                           # gap
        if t == 2: return 3                           # white
        return 0
    body = loft("CAT_Bonnet", coll, stations, [M['paint'], M['grille'], M['yellow'], M['white']], mat_of, caps=(1, 0), smooth=50)
    return body


def side_outline():
    return [(0.0, 0.22), (0.9, 0.22), (1.2, 0.27), (1.59, 0.29), (1.59, 0.745), (1.2, 0.745), (0.95, 0.745), (0.9, 0.64), (0.82, 0.565),
            (0.7, 0.545), (0.32, 0.545), (0.2, 0.575), (0.12, 0.70), (0.05, 0.765), (0.0, 0.765)]


def build_tub(coll, M):
    parts = []
    for s in (1, -1):
        lo, hi = (0.486, 0.5) if s > 0 else (-0.5, -0.486)
        parts.append(prism("CAT_Side", side_outline(), 'x', lo, hi, coll, M['paint']))
    for s in (1, -1):
        lo, hi = (0.47, 0.487) if s > 0 else (-0.487, -0.47)
        parts.append(prism("CAT_SideLining", side_outline()[:], 'x', lo, hi, coll, M['dash']))
    tail = [(-0.5, 0.35), (-0.3, 0.30), (0, 0.285), (0.3, 0.30), (0.5, 0.35), (0.5, 0.706), (-0.5, 0.706)]
    parts.append(prism("CAT_Tail", tail, 'y', 1.572, 1.59, coll, M['paint']))
    return parts


def join(objs, name, coll):
    """merge objects (keeping all their material slots) into one"""
    bpy.context.view_layer.update()
    vs, fs, mats, fm = [], [], [], []
    for o in objs:
        me = o.data
        base = len(vs)
        vs += [tuple(o.matrix_world @ v.co) for v in me.vertices]
        omats = [m for m in me.materials]
        for p in me.polygons:
            fs.append([base + i for i in p.vertices])
            m = omats[p.material_index] if p.material_index < len(omats) else None
            if m not in mats:
                mats.append(m)
            fm.append(mats.index(m))
    for o in objs:
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(d)
    ob = mesh_obj(name, vs, fs, coll, mats, face_mats=fm, smooth_angle=None)
    return ob


# ---------------------------------------------------------------- rear fenders and front cycle wings
def build_rear_fenders(coll, M):
    """rear wings: a plain arch wrapping the top of each rear tyre with a small rolled lip, body coloured"""
    r0 = RR + 0.03
    th0, th1, nth = math.radians(14), math.radians(166), 18
    prof = [(-0.168, -0.045), (-0.158, -0.018), (-0.125, 0.0), (0.125, 0.0), (0.158, -0.018), (0.168, -0.045)]
    objs = []
    for s in (1, -1):
        verts, faces = [], []
        for i in range(nth + 1):
            th = th0 + (th1 - th0) * i / nth
            for (u, dr) in prof:
                rr = r0 + dr
                verts.append((s * TR + u, AX_R - math.cos(th) * rr, RR + math.sin(th) * rr))
        m = len(prof)
        for i in range(nth):
            for j in range(m - 1):
                p0, p1 = i * m + j, i * m + j + 1
                faces.append([p0, p1, p1 + m, p0 + m])
        ob = mesh_obj("CAT_RearFender", verts, faces, coll, [M['paint']], smooth_angle=60)
        solidify(ob, 0.010, 1.0)
        objs.append(ob)
    return objs


def build_front_wings(coll, M, hubs):
    """cycle wings: thin carbon arcs over each front tyre; origin at the hub so they ride on the steering node"""
    res = []
    for nm, loc, s in hubs:
        r0 = RF + 0.022
        th0, th1 = math.radians(24), math.radians(166)
        nth = 14
        prof = [(-0.133, -0.038), (-0.124, -0.014), (-0.098, 0.0), (0.098, 0.0), (0.124, -0.014), (0.133, -0.038)]
        verts, faces = [], []
        for i in range(nth + 1):
            th = th0 + (th1 - th0) * i / nth
            # front lip rolls out a bit
            for (u, dr) in prof:
                rr = r0 + dr
                verts.append((u, -math.cos(th) * rr, math.sin(th) * rr))
        m = len(prof)
        for i in range(nth):
            for j in range(m - 1):
                a, b = i * m + j, i * m + j + 1
                faces.append([a, b, b + m, a + m])
        ob = mesh_obj("CAT_Caliper_" + nm, verts, faces, coll, [M['carbon']], smooth_angle=60, loc=loc)
        solidify(ob, 0.010, 1.0)
        # stays: from the hub up to the wing, inboard of the tyre
        B = Builder()
        for (ya, za, yb, zb_) in ((0.0, 0.0, -0.20, 0.22), (0.0, 0.0, 0.18, 0.24)):
            B.tube([(-s * 0.14, ya, za), (-s * 0.14, yb, zb_), (-s * 0.12, yb, zb_ + 0.04)], 0.007, 0, 5)
        st = B.obj("tmp_stay", coll, [M['black']], smooth=None, loc=loc)
        wing = join([ob, st], "CAT_Caliper_" + nm, coll)
        wing.location = loc
        # join() baked world coords; move the origin back to the hub
        for v in wing.data.vertices:
            v.co -= Vector(loc)
        res.append(wing)
    return res


# ---------------------------------------------------------------- wheels
def cat_wheel(name, coll, M, R, W, RIM, side, loc):
    B = Builder()
    TIRE, RIMM, LIP, HUB, DISC = 0, 1, 2, 3, 4
    h = W / 2
    tp = [(-h * 0.88, RIM + 0.012), (-h, R - 0.052), (-h * 0.97, R - 0.016), (-h * 0.82, R), (h * 0.82, R), (h * 0.97, R - 0.016), (h, R - 0.052), (h * 0.88, RIM + 0.012)]
    B.revolve(tp, 24, TIRE, flip=True)
    B.revolve([(h * 0.88, RIM + 0.012), (h * 0.95, RIM + 0.002), (h * 0.9, RIM - 0.014)], 24, LIP, flip=True)      # polished outer lip
    B.revolve([(h * 0.9, RIM - 0.014), (h * 0.6, RIM - 0.02), (-h * 0.8, RIM - 0.02)], 24, RIMM, flip=True)       # barrel
    B.revolve([(-h * 0.4, RIM - 0.02), (-h * 0.4, 0.04)], 24, RIMM)                                                 # backing disc
    nsp = 5
    for k in range(nsp):
        a = 2 * math.pi * (k + 0.5) / nsp
        for off in (-0.13, 0.13):
            a0 = a + off
            r0, r1 = 0.06, RIM - 0.018
            w0, w1 = 0.014, 0.017
            ax0, ax1 = h * 0.60, h * 0.78
            t = Vector((0, math.cos(a0), math.sin(a0)))
            nrm = Vector((0, -math.sin(a0), math.cos(a0)))
            th = 0.026
            pts = []
            for (rr, ww, ax) in ((r0, w0, ax1), (r1, w1, ax0)):
                for sgn in (-1, 1):
                    pts.append(Vector((ax, 0, 0)) + t * rr + nrm * ww * sgn)
            vs = pts + [p - Vector((th, 0, 0)) for p in pts]
            fs = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4], [1, 5, 7, 3], [2, 3, 7, 6], [0, 4, 5, 1]]
            B.add(vs, fs, RIMM, 'c')
    # centre nut and four wheel nuts (white)
    lathe(B, [(h * 0.80, 0.0), (h * 0.80, 0.036), (h * 0.74, 0.038), (h * 0.56, 0.038)], 6, HUB, 'x', (0, 0, 0))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        lathe(B, [(h * 0.80, 0.0), (h * 0.80, 0.014), (h * 0.7, 0.014)], 6, HUB, 'x', (0, 0.058 * math.cos(a), 0.058 * math.sin(a)))
    lathe(B, [(-h * 0.05, 0.10), (-h * 0.05, RIM - 0.05), (-h * 0.22, RIM - 0.05), (-h * 0.22, 0.10)], 20, DISC, 'x', (0, 0, 0))
    mirror_builder(B, side)
    return B.obj(name, coll, [M['tire'], M['rim'], M['lip'], M['lip'], M['disc']], smooth=40, loc=loc)


# ---------------------------------------------------------------- front end: grille, lamps, suspension
def build_nose_details(coll, M):
    parts = []
    # grille face: dark mesh with horizontal white wires and the 7 badge on the nose cap
    y0 = NOSE_Y - 0.002
    cap = [(-0.17, 0.40), (-0.12, 0.372), (0.12, 0.372), (0.17, 0.40), (0.19, 0.46), (0.17, 0.52), (-0.17, 0.52), (-0.19, 0.46)]
    # (the bonnet cap itself is the dark grille material; wires and badge are added on top)
    B = Builder()
    for z in (0.36, 0.40, 0.44, 0.48, 0.52):
        B.box((0, y0 - 0.002, z), (0.40, 0.004, 0.007), 0)
    wires = B.obj("CAT_GrilleWires", coll, [M['white']], smooth=None)
    parts.append(wires)
    v2, f2 = text_tris("7", 0.19, 1.0)
    vs = [(-u * 0.9, y0 - 0.0045, 0.445 + v) for (u, v) in v2]
    seven = mesh_obj("CAT_Seven", vs, [list(f) for f in f2], coll, [M['white']])
    bm = bmesh.new(); bm.from_mesh(seven.data); bm.normal_update()
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if f.normal.y > 0]); bm.to_mesh(seven.data); bm.free()
    parts.append(seven)
    return parts


def build_front_lamps(coll, M):
    B = Builder()
    BODY, GLASS, ROD, AMB = 0, 1, 2, 3
    for s in (1, -1):
        cx, cy, cz = s * 0.37, -1.36, 0.66
        # pod: a short rounded drum facing forward
        lathe(B, [(0.07, 0.0), (0.07, 0.056), (0.05, 0.073), (-0.02, 0.078), (-0.07, 0.06), (-0.085, 0.03), (-0.09, 0.0)], 14, BODY, 'y', (cx, cy, cz), flip=True)
        lathe(B, [(-0.074, 0.0), (-0.074, 0.058)], 14, GLASS, 'y', (cx, cy, cz))
        B.tube([(s * 0.28, -1.28, 0.58), (s * 0.34, -1.30, 0.62), (s * 0.37, -1.33, 0.60)], 0.007, ROD, 5)
        B.tube([(s * 0.25, -1.44, 0.62), (s * 0.33, -1.38, 0.62), (s * 0.37, -1.36, 0.60)], 0.007, ROD, 5)
        # indicators on the nose sides
        lathe(B, [(0.0, 0.0), (0.0, 0.03), (0.012, 0.027), (0.02, 0.0)], 10, AMB, 'y', (s * 0.43, -1.40, 0.43), flip=True)
        B.tube([(s * 0.3, -1.40, 0.45), (s * 0.43, -1.40, 0.44)], 0.006, ROD, 5)
    return B.obj("CAT_FrontLamps", coll, [M['black'], M['lamp'], M['black'], M['amber']], smooth=40)


def build_suspension(coll, M):
    B = Builder()
    for s in (1, -1):
        hub_in = s * (TF - WF / 2 - 0.045)
        hub = (hub_in, AX_F, RF)
        # lower wishbone (two tubes) and upper wishbone, to the chassis
        for dy in (-0.20, 0.20):
            B.tube([(s * 0.24, AX_F + dy, 0.285), (hub_in, AX_F, 0.215)], 0.0095, 0, 5)
            B.tube([(s * 0.26, AX_F + dy * 0.9, 0.50), (hub_in, AX_F, 0.38)], 0.0085, 0, 5)
        B.tube([(s * 0.18, AX_F - 0.14, 0.42), (hub_in, AX_F - 0.16, 0.34)], 0.007, 0, 5)      # track rod
        # coil-over: damper body + spring
        p0, p1 = Vector((s * 0.40, AX_F + 0.02, 0.255)), Vector((s * 0.285, AX_F + 0.02, 0.49))
        B.tube([p0, p1], 0.019, 1, 7)
        # spring: a slightly fatter section along the top half
        B.tube([p0.lerp(p1, 0.35), p0.lerp(p1, 0.92)], 0.028, 2, 8)
        # upright
        B.tube([(hub_in, AX_F, 0.205), (hub_in, AX_F, 0.395)], 0.016, 0, 6)
        B.tube([(hub_in, AX_F, RF), (s * (TF - WF / 2 + 0.005), AX_F, RF)], 0.02, 0, 6)
    return B.obj("CAT_Suspension", coll, [M['black'], M['chrome'], M['red']], smooth=45)


# ---------------------------------------------------------------- cockpit
def build_cockpit(coll, M):
    objs = []
    # scuttle / dashboard: a carbon cowl across the tub, face sloping toward the driver
    dash = [(0.0, 0.45), (0.0, 0.79), (0.09, 0.795), (0.2, 0.67), (0.235, 0.58), (0.23, 0.45)]
    d = prism("CAT_Dash", dash, 'x', -0.488, 0.488, coll, M['dash'])
    bevel(d, 0.008)
    objs.append(d)
    # floor, tunnel, rear bulkhead
    objs.append(prism("CAT_Floor", [(0.0, 0.22), (0.0, 0.25), (0.9, 0.25), (0.9, 0.22)], 'x', -0.486, 0.486, coll, M['floor']))
    objs.append(prism("CAT_Tunnel", [(0.2, 0.25), (0.3, 0.42), (0.85, 0.40), (0.88, 0.25)], 'x', -0.14, 0.14, coll, M['dash']))
    objs.append(prism("CAT_Bulkhead", [(0.84, 0.25), (0.88, 0.25), (0.9, 0.745), (0.86, 0.745)], 'x', -0.486, 0.486, coll, M['dash']))
    B = Builder()
    G, K, S, CH, RED, ST = 0, 1, 2, 3, 4, 5
    # gauges: three round dials in front of the driver (the right seat), switch bank to the left
    for (x, z, r) in ((-0.17, 0.60, 0.040), (-0.28, 0.60, 0.040), (-0.39, 0.60, 0.032), (-0.34, 0.69, 0.024)):
        lathe(B, [(0.0, 0.0), (0.0, r), (-0.012, r), (-0.016, r * 0.85)], 16, G, 'y', (x, 0.221 - (0.60 - z) * 0.0, z))
    for row, z in enumerate((0.64, 0.70)):
        for k in range(6):
                x = 0.05 + k * 0.058
                lathe(B, [(0.0, 0.0), (0.0, 0.006), (0.032, 0.005)], 6, S, 'y', (x, 0.2 - (z - 0.55) * 0.22, z))
                lathe(B, [(0.034, 0.0), (0.034, 0.011), (0.04, 0.011)], 6, K, 'y', (x, 0.2 - (z - 0.55) * 0.22, z + 0.0))
    # steering column + wheel (right-hand drive)
    B.tube([(-0.255, 0.16, 0.50), (-0.255, 0.30, 0.575)], 0.014, K, 6)
    rot = Matrix.Rotation(math.radians(-62), 3, 'X') @ Matrix.Rotation(math.radians(90), 3, 'X') @ Matrix.Rotation(math.radians(-90), 3, 'X')
    # ring in the plane facing the driver (normal tilted back toward +y)
    nrm = Vector((0, 0.80, 0.60)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix()
    torus(B, (-0.255, 0.30, 0.575), 0.135, 0.013, rot, K, 24, 6)
    for a in (0, 2.1, 4.2):
        p = rot @ Vector((0.135 * math.cos(a), 0.135 * math.sin(a), 0))
        B.tube([Vector((-0.255, 0.30, 0.575)), Vector((-0.255, 0.30, 0.575)) + p], 0.007, K, 5)
    lathe(B, [(0, 0), (0, 0.03), (0.02, 0.03)], 10, K, 'y', (-0.255, 0.30, 0.575))
    # gear lever and handbrake
    B.tube([(-0.02, 0.55, 0.40), (-0.02, 0.52, 0.52)], 0.007, CH, 5)
    lathe(B, [(0, 0), (0, 0.02), (0.02, 0.02), (0.04, 0.0)], 8, K, 'z', (-0.02, 0.52, 0.50))
    B.tube([(-0.16, 0.62, 0.40), (-0.16, 0.45, 0.50)], 0.008, K, 5)
    # pedals
    for x in (-0.33, -0.27, -0.21):
        B.box((x, 0.015, 0.34), (0.045, 0.01, 0.07), K)
    # harness / seat belts: skip; the seats
    for sx in (-0.255, 0.255):
        # base cushion
        B.box((sx, 0.67, 0.30), (0.34, 0.34, 0.07), ST)
        # back: tilted slab and headrest, with side bolsters
        for (dz, w, th) in ((0.00, 0.34, 0.07),):
            c = Vector((sx, 0.88, 0.60)); r = Matrix.Rotation(math.radians(-17), 3, 'X').to_quaternion()
            B.add(box_verts(c, (w, th, 0.62), r), BOX_FACES, ST, 'c')
        for bx in (-0.18, 0.18):
            c = Vector((sx + bx, 0.84, 0.58)); r = Matrix.Rotation(math.radians(-17), 3, 'X').to_quaternion()
            B.add(box_verts(c, (0.04, 0.12, 0.60), r), BOX_FACES, ST, 'c')
        for bx in (-0.18, 0.18):
            B.box((sx + bx, 0.67, 0.34), (0.04, 0.34, 0.15), ST)
    objs.append(B.obj("CAT_Cockpit", coll, [M['gauge'], M['black'], M['chrome'], M['chrome'], M['red'], M['seat']], smooth=45))
    return objs


# ---------------------------------------------------------------- roll hoop, scuttle blade, mirrors, exhaust
def build_hoop(coll, M):
    B = Builder()
    C = 0
    top_z, top_y = 1.03, 0.80
    for s in (1, -1):
        # main hoop leg: from the top corner forward-down into the tub side
        B.tube([(s * 0.36, top_y + 0.04, top_z - 0.04), (s * 0.40, top_y, top_z - 0.12), (s * 0.45, 0.76, 0.80), (s * 0.475, 0.70, 0.56)], 0.0145, C, 8)
        # rear stay: from the top bar back and down to the deck
        B.tube([(s * 0.20, top_y + 0.06, top_z - 0.01), (s * 0.20, 1.05, 0.90), (s * 0.20, 1.34, 0.76)], 0.0125, C, 8)
        # inner brace to the bulkhead
        B.tube([(s * 0.36, top_y + 0.04, top_z - 0.06), (s * 0.30, 0.86, 0.75)], 0.011, C, 6)
    B.tube([(-0.36, top_y + 0.04, top_z - 0.04), (-0.30, top_y + 0.07, top_z), (-0.1, top_y + 0.08, top_z + 0.004), (0.1, top_y + 0.08, top_z + 0.004), (0.30, top_y + 0.07, top_z), (0.36, top_y + 0.04, top_z - 0.04)], 0.0145, C, 8)
    return B.obj("CAT_Hoop", coll, [M['black']], smooth=50)


def build_scuttle(coll, M):
    """black wind deflector strip across the scuttle with side blades, and the two mirrors"""
    parts = []
    B = Builder()
    K, MI, RD = 0, 1, 2
    # curved strip across the scuttle
    n = 14
    top, bot = [], []
    for i in range(n + 1):
        x = -0.5 + i / n
        u = abs(x) / 0.5
        z0 = 0.795 + 0.05 * u ** 2
        top.append((x, 0.055, z0 + 0.055 - 0.02 * u))
        bot.append((x, 0.085, z0 - 0.002))
    vs = top + bot
    fs = []
    for i in range(n):
        fs.append([i, i + 1, n + 1 + i + 1, n + 1 + i])
    B.add(vs, fs, K, None)
    # thick it up a touch
    for s in (1, -1):
        blade = [(-0.06, 0.74), (0.03, 0.775), (0.14, 0.935), (0.095, 0.95), (0.01, 0.84), (-0.07, 0.775)]
        lo, hi = (0.495, 0.508) if s > 0 else (-0.508, -0.495)
        B.extrude(blade, 'x', lo, hi, K)
        # mirror stalk and head
        B.tube([(s * 0.50, 0.11, 0.935), (s * 0.54, 0.13, 0.975)], 0.005, K, 5)
        c = Vector((s * 0.545, 0.14, 0.99)); r = Matrix.Rotation(math.radians(8 * s), 3, 'Z').to_quaternion()
        B.add(box_verts(c, (0.075, 0.018, 0.05), r), BOX_FACES, K, 'c')
        c2 = Vector((s * 0.545, 0.1505, 0.99))
        B.add(box_verts(c2, (0.062, 0.002, 0.04), r), BOX_FACES, MI, 'c')
    parts.append(B.obj("CAT_Scuttle", coll, [M['carbon'], M['mirror'], M['black']], smooth=50))
    return parts


def build_exhaust(coll, M):
    B = Builder()
    P = 0
    s = -1     # right-hand side exit
    B.tube([(s * 0.43, -0.78, 0.40), (s * 0.53, -0.66, 0.35), (s * 0.565, -0.56, 0.30), (s * 0.565, -0.45, 0.27), (s * 0.565, -0.1, 0.27)], 0.026, P, 8)
    B.tube([(s * 0.43, -0.74, 0.35), (s * 0.52, -0.62, 0.32), (s * 0.565, -0.52, 0.29)], 0.022, P, 8)
    lathe(B, [(-0.12, 0.0), (-0.12, 0.046), (-0.09, 0.062), (0.35, 0.062), (0.4, 0.045), (0.42, 0.0)], 14, 1, 'y', (s * 0.565, 0.14, 0.27))
    B.tube([(s * 0.565, 0.56, 0.27), (s * 0.565, 0.72, 0.265), (s * 0.57, 0.82, 0.235)], 0.02, P, 8)
    B.tube([(s * 0.565, -0.1, 0.27), (s * 0.565, 0.02, 0.27)], 0.026, P, 8)
    # heat shield strap and mounts
    return B.obj("CAT_Exhaust", coll, [M['pipe'], M['pipe']], smooth=45)


def build_rear_details(coll, M):
    B = Builder()
    BK, RD, CL, CAR = 0, 1, 2, 3
    for s in (1, -1):
        # tail-light cluster on the rear of each fender: clear | red | clear
        cx = s * 0.40
        B.box((cx, 1.592, 0.60), (0.205, 0.03, 0.095), BK)
        B.box((cx - 0.07 * s, 1.612, 0.60), (0.058, 0.012, 0.075), CL)
        B.box((cx, 1.612, 0.60), (0.064, 0.012, 0.075), RD)
        B.box((cx + 0.07 * s, 1.612, 0.60), (0.058, 0.012, 0.075), CL)
        # lower tail lamps (fog / reverse): small boxes on the tail panel
        B.box((s * 0.28, 1.594, 0.40), (0.115, 0.03, 0.062), BK)
        B.box((s * 0.28, 1.612, 0.40), (0.095, 0.01, 0.046), CL if s > 0 else RD)
    # tow eye / bumper nub
    B.box((0, 1.60, 0.285), (0.13, 0.06, 0.04), BK)
    # fuel filler
    lathe(B, [(0, 0), (0, 0.062), (0.01, 0.066), (0.02, 0.05), (0.022, 0.0)], 20, BK, 'y', (-0.33, 1.592, 0.60), flip=True)
    return B.obj("CAT_RearDetails", coll, [M['black'], M['tail'], M['clear'], M['carbon']], smooth=40)


def build_deck(coll, M):
    d = prism("CAT_Deck", [(0.86, 0.706), (1.612, 0.706), (1.612, 0.764), (0.86, 0.764)], 'x', -0.508, 0.508, coll, M['carbon'])
    bevel(d, 0.014, 2)
    # seams and dome-head fasteners
    B = Builder()
    for x in (-0.17, 0.17):
        B.box((x, 1.24, 0.7645), (0.006, 0.74, 0.002), 0)
    for k in range(9):
        y = 0.90 + k * 0.08
        for x in (-0.47, 0.47):
            lathe(B, [(0, 0), (0, 0.007), (0.004, 0.006)], 6, 0, 'z', (x, y, 0.764))
    for x in (-0.34, -0.17, 0.0, 0.17, 0.34):
        lathe(B, [(0, 0), (0, 0.007), (0.004, 0.006)], 6, 0, 'y', (x, 1.612, 0.735))
    seams = B.obj("CAT_DeckBits", coll, [M['black']], smooth=None)
    return [d, seams]


# ---------------------------------------------------------------- livery (stripes, vents, lettering), draped onto the paint
def make_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    vs, fs = [], []
    for o in objs:
        base = len(vs)
        vs += [o.matrix_world @ v.co for v in o.data.vertices]
        fs += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons([tuple(v) for v in vs], fs)


def drape_rect(bvh, mode, u0, u1, v0, v1, nu, nv, off=0.0025, s=1):
    """grid of points over a rectangle, projected onto the paint: mode 'z' (u = x, v = y, from above) or 'x' (u = y, v = z, from the side s)"""
    verts, faces = [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            u = u0 + (u1 - u0) * i / nu
            v = v0 + (v1 - v0) * j / nv
            if mode == 'z':
                o, d = Vector((u, v, 2.0)), Vector((0, 0, -1))
            else:
                o, d = Vector((s * 1.5, u, v)), Vector((-s, 0, 0))
            hit = bvh.ray_cast(o, d)
            if hit[0] is None:
                p = Vector((u, v, 0.7)) if mode == 'z' else Vector((s * 0.5, u, v))
                nrm = -d
            else:
                p, nrm = hit[0], hit[1]
                if nrm.dot(d) > 0:
                    nrm = -nrm
            verts.append(tuple(p + nrm * off))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            q = [a, a + 1, a + 1 + nu + 1, a + nu + 1]
            faces.append(q)
    return verts, faces


class Acc:
    """accumulates draped decal geometry per material"""
    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def add(self, vf, mi, flip=False):
        vs, fs = vf
        b = len(self.v)
        self.v += vs
        for f in fs:
            self.f.append([b + k for k in (f[::-1] if flip else f)])
            self.m.append(mi)


def build_livery(coll, M, bvh):
    A = Acc()
    # materials: 0 yellow, 1 white, 2 black vent
    for s in (1, -1):
        flip = s < 0
        # side stripe on the flank (draped over the bonnet side and the tub): yellow bar, white pinstripes above and below
        A.add(drape_rect(bvh, 'x', -0.80, -0.03, 0.262, 0.335, 14, 5, 0.0022, s), 0, flip)
        A.add(drape_rect(bvh, 'x', -0.80, 0.69, 0.3435, 0.3495, 28, 1, 0.0022, s), 1, flip)
        A.add(drape_rect(bvh, 'x', -0.80, 0.69, 0.2475, 0.2535, 28, 1, 0.0022, s), 1, flip)
        # bonnet louvres: a block of black slots either side of the stripe
        for k in range(14):
            y = -0.99 + k * 0.042
            A.add(drape_rect(bvh, 'z', s * 0.118, s * 0.256, y, y + 0.022, 3, 1, 0.0018), 2, flip)
        for k in range(3):
            y = -0.20 + k * 0.042
            A.add(drape_rect(bvh, 'z', s * 0.118, s * 0.256, y, y + 0.022, 3, 1, 0.0018), 2, flip)
    # nose badge square
    A.add(drape_rect(bvh, 'z', -0.022, 0.022, -1.46, -1.42, 1, 1, 0.003), 1)
    ob = mesh_obj("CAT_Livery", A.v, A.f, coll, [M['yellow'], M['white'], M['black']], face_mats=A.m, smooth_angle=None)
    # make every face point outward-ish: flip the ones facing down / inward
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    fl = []
    for f in bm.faces:
        c = f.calc_center_median()
        out = Vector((c.x * 2.0, 0, 0)) if abs(c.x) > 0.3 and c.z < 0.5 else Vector((0, 0, 1))
        if abs(c.x) > 0.4 and c.z < 0.55:
            out = Vector((math.copysign(1, c.x), 0, 0))
        if f.normal.dot(out) < 0:
            fl.append(f)
    bmesh.ops.reverse_faces(bm, faces=fl)
    bm.to_mesh(ob.data); bm.free()
    parts = [ob]
    # tail stripe and pinstripes (flat on the tail panel)
    B = Builder()
    B.box((0, 1.5915, 0.50), (0.11, 0.003, 0.41), 0)
    for sx in (-1, 1):
        B.box((sx * 0.082, 1.5915, 0.50), (0.008, 0.003, 0.41), 1)
    tail = B.obj("CAT_TailStripe", coll, [M['yellow'], M['white']], smooth=None)
    parts.append(tail)
    # lettering
    mw = M['white']
    for s in (1, -1):
        t = ruled_text("CATERHAM", 0.066, 0, 0.30, 0.298, '+x' if s > 0 else '-x', 0, coll, [mw], "CAT_SideText", 1.0)
        # position: runs from y 0.0 to 0.66 on the flank; place at the flank surface
        xs = s * 0.5025
        for v in t.data.vertices:
            v.co.x = xs
        parts.append(t)
    t2 = ruled_text("CATERHAM", 0.045, 0.30, 1.5925, 0.67, '+y', 0, coll, [mw], "CAT_TailText", 1.0)
    parts.append(t2)
    return parts


# ---------------------------------------------------------------- assemble
def build():
    coll = get_coll(COLL)
    M = cmat()
    bonnet = build_bonnet(coll, M)
    sides = build_tub(coll, M)
    bvh = make_bvh([bonnet] + sides[:2])
    livery = build_livery(coll, M, bvh)
    fenders = build_rear_fenders(coll, M)
    body = join([bonnet] + sides + fenders, "CAT_Body", coll)
    set_smooth(body, 42)
    deck = build_deck(coll, M)
    nose = build_nose_details(coll, M)
    lamps = build_front_lamps(coll, M)
    susp = build_suspension(coll, M)
    cockpit = build_cockpit(coll, M)
    hoop = build_hoop(coll, M)
    scuttle = build_scuttle(coll, M)
    exhaust = build_exhaust(coll, M)
    rear = build_rear_details(coll, M)
    floor = prism("CAT_Undertray", [(-0.49, -1.35), (0.49, -1.35), (0.49, 1.55), (-0.49, 1.55)], 'z', 0.19, 0.215, coll, M['floor'])
    wings = build_front_wings(coll, M, [("FL", (TF, AX_F, RF), 1), ("FR", (-TF, AX_F, RF), -1)])
    wheels = []
    for nm, y, xh, R, W, RIM, side in (("FL", AX_F, TF, RF, WF, RIMF, 1), ("FR", AX_F, TF, RF, WF, RIMF, -1),
                                       ("RL", AX_R, TR, RR, WR, RIMR, 1), ("RR", AX_R, TR, RR, WR, RIMR, -1)):
        wheels.append(cat_wheel("CAT_Wheel_" + nm, coll, M, R, W, RIM, side, (side * xh, y, R)))
    for o in list(coll.objects):
        if o is not body:
            o.parent = body
            o.matrix_parent_inverse.identity()
    for o in coll.objects:
        for p in o.data.polygons:
            pass
    stats = {o.name: tri_count(o) for o in coll.objects}
    stats["TOTAL_TRIS"] = sum(stats.values())
    return stats


if __name__ == "__main__" or True:
    result = build()
