"""Procedural low-poly 992 GT3 RS-style race car for Vehicle Sim.

Run inside Blender (Text Editor > Run, or exec(open(path).read())).
Rebuilds everything inside the "GT3RS" collection each run.

Conventions (match the game / glTF):
  Blender: front of car faces -Y, +Z up, +X = car's left (LHD driver side).
  glTF export (+Y up) turns that into three.js +Z forward, -X right.
  Origin = ground plane, midway between the axles.
  Wheels are separate objects with their origin at the hub centre.
"""
import bpy, bmesh, math, bisect
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

COLL = "GT3RS"

# --------------------------------------------------------------------------
# real-car dimensions (992 GT3 RS)
FRONT_AXLE_Y, REAR_AXLE_Y = -1.230, 1.227          # wheelbase 2.457
F_TRACK_HALF, R_TRACK_HALF = 0.815, 0.792
F_TIRE_R, F_TIRE_W, F_RIM_R = 0.350, 0.275, 0.254  # 275/35 R20
R_TIRE_R, R_TIRE_W, R_RIM_R = 0.367, 0.335, 0.267  # 335/30 R21
F_ARCH_R, R_ARCH_R = 0.392, 0.408

# --------------------------------------------------------------------------
# body stations: y, then 12 half-profile points (x, z) from bottom centre
# r0 bottom-centre, r1 floor edge, r2 rocker, r3 widest, r4 upper side,
# r5 shoulder, r6 fender crown / belt, r7 hood gutter / belt,
# r8 hood edge / window bottom, r9 hood / A-pillar / roof edge,
# r10 hood / roof inner, r11 top centre
STATIONS = [
    (-2.286, [(0, .24), (.46, .24), (.52, .27), (.55, .36), (.545, .46), (.52, .52), (.46, .545), (.37, .55), (.28, .552), (.19, .553), (.10, .554), (0, .555)]),
    (-2.220, [(0, .15), (.62, .15), (.70, .20), (.745, .36), (.735, .52), (.70, .61), (.63, .655), (.50, .63), (.41, .625), (.29, .628), (.14, .632), (0, .633)]),
    (-2.100, [(0, .13), (.74, .13), (.82, .18), (.86, .36), (.855, .56), (.835, .69), (.75, .77), (.60, .705), (.50, .69), (.35, .692), (.18, .696), (0, .70)]),
    (-1.900, [(0, .12), (.79, .12), (.88, .17), (.915, .36), (.91, .58), (.89, .75), (.78, .835), (.62, .76), (.54, .745), (.38, .748), (.19, .752), (0, .755)]),
    (-1.600, [(0, .12), (.82, .12), (.91, .17), (.94, .40), (.935, .62), (.905, .79), (.79, .855), (.65, .80), (.58, .79), (.41, .795), (.21, .80), (0, .805)]),
    (-1.230, [(0, .12), (.83, .12), (.925, .17), (.95, .42), (.945, .64), (.915, .81), (.80, .87), (.68, .84), (.62, .835), (.44, .842), (.22, .848), (0, .852)]),
    (-0.900, [(0, .12), (.82, .12), (.91, .17), (.935, .42), (.93, .64), (.90, .80), (.82, .885), (.74, .915), (.70, .925), (.66, .93), (.33, .935), (0, .94)]),
    (-0.550, [(0, .12), (.80, .12), (.885, .17), (.91, .42), (.905, .64), (.88, .79), (.83, .88), (.79, .93), (.775, .95), (.62, 1.08), (.32, 1.115), (0, 1.125)]),
    (-0.220, [(0, .12), (.79, .12), (.875, .17), (.90, .42), (.895, .64), (.87, .79), (.825, .88), (.79, .935), (.775, .955), (.575, 1.245), (.30, 1.285), (0, 1.295)]),
    (0.150, [(0, .12), (.79, .12), (.875, .17), (.90, .42), (.895, .64), (.87, .79), (.825, .88), (.795, .94), (.78, .96), (.565, 1.27), (.29, 1.31), (0, 1.32)]),
    (0.500, [(0, .12), (.80, .12), (.89, .17), (.915, .42), (.91, .65), (.885, .80), (.84, .89), (.805, .945), (.79, .965), (.57, 1.24), (.29, 1.285), (0, 1.295)]),
    (0.850, [(0, .12), (.83, .12), (.92, .17), (.945, .43), (.94, .67), (.915, .83), (.87, .92), (.83, .96), (.80, .985), (.59, 1.155), (.30, 1.195), (0, 1.20)]),
    (1.227, [(0, .12), (.85, .12), (.935, .17), (.96, .44), (.955, .69), (.93, .86), (.875, .985), (.75, .975), (.68, 1.02), (.58, 1.05), (.30, 1.075), (0, 1.08)]),
    (1.600, [(0, .12), (.84, .12), (.93, .17), (.955, .45), (.95, .70), (.925, .86), (.865, .965), (.74, .95), (.66, .965), (.55, .975), (.29, .985), (0, .99)]),
    (1.900, [(0, .14), (.80, .14), (.90, .19), (.93, .46), (.925, .70), (.895, .85), (.835, .94), (.72, .935), (.64, .95), (.50, .958), (.26, .962), (0, .965)]),
    (2.100, [(0, .20), (.74, .20), (.85, .24), (.885, .46), (.88, .68), (.855, .82), (.785, .91), (.69, .935), (.60, .942), (.46, .946), (.24, .95), (0, .95)]),
    (2.220, [(0, .24), (.69, .24), (.785, .27), (.82, .46), (.815, .66), (.79, .79), (.73, .865), (.64, .90), (.55, .912), (.42, .917), (.22, .92), (0, .92)]),
    (2.286, [(0, .28), (.60, .28), (.69, .30), (.72, .46), (.715, .64), (.69, .76), (.63, .83), (.54, .86), (.47, .87), (.36, .875), (.18, .88), (0, .88)]),
]
NROW = 12


def pchip(xs, ys):
    """Monotone cubic (Fritsch-Carlson) interpolant: smooth, no overshoot."""
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

    def f(x):
        i = max(0, min(n - 2, bisect.bisect_right(xs, x) - 1))
        hh = h[i]
        t = (x - xs[i]) / hh
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1])
    return f


SY = [s[0] for s in STATIONS]
FX = [pchip(SY, [s[1][r][0] for s in STATIONS]) for r in range(NROW)]
FZ = [pchip(SY, [s[1][r][1] for s in STATIONS]) for r in range(NROW)]


def prof(y):
    return [(FX[r](y) if r not in (0, 11) else 0.0, FZ[r](y)) for r in range(NROW)]


def section_ys(step=0.095):
    ys = [SY[0]]
    for a, b in zip(SY, SY[1:]):
        n = max(1, math.ceil((b - a) / step))
        ys += [a + (b - a) * i / n for i in range(1, n + 1)]
    return ys


# --------------------------------------------------------------------------
# generic helpers
def get_coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    for o in list(c.objects):
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(d, bpy.types.Mesh) and d.users == 0:
            bpy.data.meshes.remove(d)
    return c


def mat(name, color, rough=0.5, metal=0.0, alpha=1.0, emit=None, emit_strength=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Alpha"].default_value = alpha
    p.inputs["Coat Weight"].default_value = coat
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = emit_strength
    else:
        p.inputs["Emission Strength"].default_value = 0.0
    m.diffuse_color = (*color, alpha)
    m.roughness = rough
    m.metallic = metal
    if alpha < 1:
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    return m


def make_mats():
    M = {}
    M['paint'] = mat("GT3_Paint", (0.82, 0.83, 0.84), 0.22, 0.0, coat=1.0)
    M['carbon'] = mat("GT3_Carbon", (0.02, 0.02, 0.022), 0.38, 0.0, coat=0.25)
    M['trim'] = mat("GT3_TrimBlack", (0.012, 0.012, 0.013), 0.55)
    M['grille'] = mat("GT3_Grille", (0.004, 0.004, 0.004), 0.8)
    M['glass'] = mat("GT3_Glass", (0.05, 0.06, 0.07), 0.04, 0.0, alpha=0.32)
    M['lamp'] = mat("GT3_Headlight", (0.08, 0.09, 0.10), 0.05, 0.6, emit=(0.85, 0.9, 1.0), emit_strength=0.4)
    M['tail'] = mat("GT3_Taillight", (0.35, 0.0, 0.0), 0.15, emit=(1.0, 0.02, 0.01), emit_strength=2.0)
    M['tire'] = mat("GT3_Tire", (0.022, 0.022, 0.022), 0.85)
    M['rim'] = mat("GT3_Rim", (0.10, 0.10, 0.11), 0.35, 1.0)
    M['disc'] = mat("GT3_BrakeDisc", (0.30, 0.30, 0.30), 0.45, 1.0)
    M['caliper'] = mat("GT3_Caliper", (0.75, 0.03, 0.02), 0.3)
    M['well'] = mat("GT3_WheelWell", (0.01, 0.01, 0.01), 0.9)
    M['int'] = mat("GT3_Interior", (0.03, 0.03, 0.032), 0.8)
    M['intred'] = mat("GT3_InteriorRed", (0.6, 0.02, 0.02), 0.6)
    M['metal'] = mat("GT3_Metal", (0.6, 0.6, 0.62), 0.25, 1.0)
    return M


def mesh_obj(name, verts, faces, coll, mats, face_mats=None, smooth_angle=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    for m in mats:
        me.materials.append(m)
    if face_mats is not None:
        me.polygons.foreach_set("material_index", face_mats)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    coll.objects.link(ob)
    if smooth_angle is not None:
        set_smooth(ob, smooth_angle)
    return ob


def set_smooth(ob, angle_deg):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    thr = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = not (e.is_manifold and e.calc_face_angle(0) > thr)
    bm.to_mesh(ob.data)
    bm.free()


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def prism(name, outline, axis, lo, hi, coll, m):
    """Closed prism: 2D outline (CCW) extruded along axis between lo and hi."""
    n = len(outline)
    verts = []
    for w in (lo, hi):
        for (a, b) in outline:
            if axis == 'x':
                verts.append((w, a, b))
            elif axis == 'y':
                verts.append((a, w, b))
            else:
                verts.append((a, b, w))
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    ob = mesh_obj(name, verts, faces, coll, [m])
    fix_normals(ob)
    return ob


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def apply_boolean(ob, cutter, op='DIFFERENCE'):
    mod = ob.modifiers.new("bool", 'BOOLEAN')
    mod.operation = op
    mod.solver = 'EXACT'
    mod.object = cutter
    try:
        mod.material_mode = 'TRANSFER'
    except Exception:
        pass
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.remove(mod)
    ob.data = new
    nm = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    new.name = nm


def delete_faces_with_mat(ob, prefix):
    me = ob.data
    bad = {i for i, m in enumerate(me.materials) if m and m.name.startswith(prefix)}
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in bad], context='FACES')
    bm.to_mesh(me)
    bm.free()
    compact_materials(ob)


def remap_mat(ob, prefix, newmat):
    me = ob.data
    for i, m in enumerate(me.materials):
        if m and m.name.startswith(prefix):
            me.materials[i] = newmat
    compact_materials(ob)


def compact_materials(ob):
    me = ob.data
    mats = list(me.materials)
    # merge duplicates + drop unused
    used = sorted({p.material_index for p in me.polygons})
    uniq, remap = [], {}
    for i in used:
        m = mats[i]
        if m in uniq:
            remap[i] = uniq.index(m)
        else:
            remap[i] = len(uniq)
            uniq.append(m)
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in uniq:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)
    me.update()


def orient_faces(ob, inside_point=None, outward=True):
    """Flip faces so normals point away from (outward) or toward an inside point."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    c = Vector(inside_point)
    flip = []
    for f in bm.faces:
        d = f.calc_center_median() - c
        if (f.normal.dot(d) < 0) == outward:
            flip.append(f)
    bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(ob.data)
    bm.free()


# --------------------------------------------------------------------------
# body shell
def build_body(coll, M):
    ys = section_ys()
    ring_rows = list(range(0, 12)) + list(range(10, 0, -1))   # 22 per ring
    R = len(ring_rows)
    verts, faces, fm = [], [], []
    for y in ys:
        p = prof(y)
        for k, r in enumerate(ring_rows):
            x, z = p[r]
            side = -1 if k > 11 else 1
            verts.append((x * side, y, z))
    mats = [M['paint'], M['trim'], M['carbon']]

    def zone(ra, rb, y):
        band = (min(ra, rb), max(ra, rb))
        if band == (0, 1) or band == (1, 2):
            return 1
        if band == (2, 3) and y > 1.95:
            return 1
        if band in ((9, 10), (10, 11)) and -0.22 < y < 0.56:
            return 2
        if band in ((9, 10), (10, 11)) and -2.12 < y < -0.92:
            return 2
        if band == (8, 9) and -0.85 < y < 1.15:
            return 1
        return 0

    for j in range(len(ys) - 1):
        yc = (ys[j] + ys[j + 1]) / 2
        for k in range(R):
            k2 = (k + 1) % R
            a, b = j * R + k, j * R + k2
            faces.append([a, b, b + R, a + R])
            fm.append(zone(ring_rows[k], ring_rows[k2], yc))
    last = (len(ys) - 1) * R
    faces.append(list(range(R))[::-1])
    fm.append(0)
    faces.append(list(range(last, last + R)))
    fm.append(0)
    ob = mesh_obj("GT3RS_Body", verts, faces, coll, mats, fm)
    fix_normals(ob)
    return ob


def wheel_arch_cutters(coll, M):
    cutters = []
    for (y, zc, r, xin) in ((FRONT_AXLE_Y, F_TIRE_R, F_ARCH_R, 0.60),
                             (REAR_AXLE_Y, R_TIRE_R, R_ARCH_R, 0.575)):
        for s in (1, -1):
            n = 40
            outline = [(y + r * math.cos(2 * math.pi * i / n), zc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
            lo, hi = (xin, 1.4) if s > 0 else (-1.4, -xin)
            cutters.append(prism("CUT_arch", outline, 'x', lo, hi, coll, M['cut_arch']))
    # wheel-exit openings behind the rear tyres (lets the tyre show from behind)
    for s in (1, -1):
        out = [(1.25, 0.05), (1.98, 0.05), (1.98, 0.40), (1.25, 0.46)]
        lo, hi = (0.745, 1.4) if s > 0 else (-1.4, -0.745)
        cutters.append(prism("CUT_arch", out, 'x', lo, hi, coll, M['cut_arch']))
    return cutters


def dlo_outline():
    """Side window outline (y, z) between window-bottom row r8 and roof-edge row r9."""
    top, bot = [], []
    y0, y1 = -0.74, 1.12
    n = 34
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        zt = FZ[9](y) - 0.035
        zb = FZ[8](y) + 0.022
        if zt - zb < 0.004:
            zt = zb + 0.004
        top.append((y, zt))
        bot.append((y, zb))
    # pinch the ends to points
    mid0 = ((top[0][1] + bot[0][1]) / 2)
    mid1 = ((top[-1][1] + bot[-1][1]) / 2)
    pts = [(y0 - 0.01, mid0)] + bot[1:-1] + [(y1 + 0.01, mid1)] + top[-2:0:-1]
    return pts


def windshield_outline():
    y0, y1 = -0.875, -0.255
    right, n = [], 10
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        right.append((FX[9](y) - 0.045, y))
    # round the corners a little
    right[0] = (right[0][0] - 0.03, right[0][1])
    right[-1] = (right[-1][0] - 0.03, right[-1][1])
    left = [(-x, y) for (x, y) in reversed(right)]
    # CCW in (x, y): go along right side forward->back, then left side back->forward
    bottom = [(x, y0 - 0.012) for x in (0.3, 0.0, -0.3)]   # slight forward bow at centre
    return right + left + bottom[::-1]


def rear_window_outline():
    y0, y1 = 0.60, 1.17
    right, n = [], 8
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        right.append((FX[9](y) - 0.085 - 0.05 * (y - y0) / (y1 - y0), y))
    right[0] = (right[0][0] - 0.03, right[0][1])
    right[-1] = (right[-1][0] - 0.03, right[-1][1])
    left = [(-x, y) for (x, y) in reversed(right)]
    return right + left


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else pts[::-1]


def window_cutters(coll, M):
    cs = []
    d = ccw(dlo_outline())
    cs.append(prism("CUT_dloR", d, 'x', 0.45, 1.4, coll, M['cut_win']))
    cs.append(prism("CUT_dloL", d, 'x', -1.4, -0.45, coll, M['cut_win']))
    cs.append(prism("CUT_ws", ccw(windshield_outline()), 'z', 0.80, 1.7, coll, M['cut_win']))
    cs.append(prism("CUT_rw", ccw(rear_window_outline()), 'z', 0.95, 1.7, coll, M['cut_win']))
    return cs


# --------------------------------------------------------------------------
# projected decals (lights, intakes, vents ...)
class Projector:
    def __init__(self, ob):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()

    def hit(self, u, v, axis, sign):
        if axis == 'x':
            o, d = Vector((3 * sign, u, v)), Vector((-sign, 0, 0))
        elif axis == 'y':
            o, d = Vector((u, 3 * sign, v)), Vector((0, -sign, 0))
        else:
            o, d = Vector((u, v, 3)), Vector((0, 0, -1))
        loc, nor, idx, dist = self.bvh.ray_cast(o, d)
        if loc is None:
            return None, None
        if nor.dot(d) > 0:
            nor = -nor
        return loc, nor


def strip_grid(top, bot, rows=1):
    """Quad grid between two polylines of equal length (u, v)."""
    n = len(top)
    verts, faces = [], []
    for r in range(rows + 1):
        t = r / rows
        for i in range(n):
            verts.append((top[i][0] * (1 - t) + bot[i][0] * t, top[i][1] * (1 - t) + bot[i][1] * t))
    for r in range(rows):
        for i in range(n - 1):
            a = r * n + i
            faces.append([a, a + 1, a + n + 1, a + n])
    return verts, faces


def ellipse_grid(cu, cv, ru, rv, n=16, rot=0.0, rings=2):
    verts = [(cu, cv)]
    faces = []
    ca, sa = math.cos(rot), math.sin(rot)
    for k in range(1, rings + 1):
        f = k / rings
        for i in range(n):
            a = 2 * math.pi * i / n
            x, y = ru * f * math.cos(a), rv * f * math.sin(a)
            verts.append((cu + x * ca - y * sa, cv + x * sa + y * ca))
    for i in range(n):
        faces.append([0, 1 + i, 1 + (i + 1) % n])
    for k in range(1, rings):
        b0, b1 = 1 + (k - 1) * n, 1 + k * n
        for i in range(n):
            j = (i + 1) % n
            faces.append([b0 + i, b1 + i, b1 + j, b0 + j])
    return verts, faces


class DecalBuilder:
    def __init__(self, proj):
        self.proj = proj
        self.verts, self.faces, self.fm = [], [], []

    def add(self, uv, faces, axis, sign, off, mi, dome=None, mirror=False):
        for flip in ((False, True) if mirror else (False,)):
            base = len(self.verts)
            mp, normals = {}, {}
            for i, (u, v) in enumerate(uv):
                uu = -u if (flip and axis != 'x') else u
                sg = -sign if (flip and axis == 'x') else sign
                loc, nor = self.proj.hit(uu, v, axis, sg)
                if loc is None:
                    continue
                o = off + (dome[i] if dome else 0.0)
                mp[i] = len(self.verts)
                normals[i] = nor
                self.verts.append(tuple(loc + nor * o))
            for f in faces:
                if all(i in mp for i in f):
                    vs = [Vector(self.verts[mp[i]]) for i in f]
                    fn = (vs[1] - vs[0]).cross(vs[2] - vs[0])
                    avg = sum((normals[i] for i in f), Vector())
                    ff = [mp[i] for i in f]
                    if fn.dot(avg) < 0:
                        ff = ff[::-1]
                    self.faces.append(ff)
                    self.fm.append(mi)

    def build(self, name, coll, mats, smooth=40):
        return mesh_obj(name, self.verts, self.faces, coll, mats, self.fm, smooth_angle=smooth)


def build_decals(body, coll, M):
    P = Projector(body)
    mats = [M['trim'], M['grille'], M['lamp'], M['tail'], M['carbon']]
    TRIM, GRILLE, LAMP, TAIL, CARBON = range(5)
    D = DecalBuilder(P)

    HL = (0.745, 0.735)
    # --- headlights: domed ovals on the fender noses (projected from the front)
    uv, fc = ellipse_grid(HL[0], HL[1], 0.112, 0.102, n=20, rings=3)
    dome = [0.028] + [0.028 * (1 - (k / 3) ** 2) for k in range(1, 4) for _ in range(20)]
    D.add(uv, fc, 'y', -1, 0.004, LAMP, dome=dome, mirror=True)
    # chrome-black bezel ring around each headlight
    ring_out = [(HL[0] + 0.126 * math.cos(2 * math.pi * i / 20), HL[1] + 0.116 * math.sin(2 * math.pi * i / 20)) for i in range(21)]
    ring_in = [(HL[0] + 0.112 * math.cos(2 * math.pi * i / 20), HL[1] + 0.102 * math.sin(2 * math.pi * i / 20)) for i in range(21)]
    uv, fc = strip_grid(ring_out, ring_in)
    D.add(uv, fc, 'y', -1, 0.003, TRIM, mirror=True)

    # --- front intakes (front view, u = x, v = z)
    top = [(-0.44 + 0.88 * i / 10, 0.375 - 0.03 * abs(-1 + 2 * i / 10) ** 3) for i in range(11)]
    bot = [(x, 0.165) for (x, _) in top]
    uv, fc = strip_grid(top, bot, rows=2)
    D.add(uv, fc, 'y', -1, 0.003, GRILLE)
    top = [(0.54 + 0.22 * i / 5, 0.43 + 0.03 * i / 5) for i in range(6)]
    bot = [(0.55 + 0.20 * i / 5, 0.19 + 0.01 * i / 5) for i in range(6)]
    uv, fc = strip_grid(top, bot, rows=4)
    D.add(uv, fc, 'y', -1, 0.006, GRILLE, mirror=True)
    # slim DRL/indicator strip above the side intakes
    top = [(0.54 + 0.22 * i / 4, 0.475 + 0.03 * i / 4) for i in range(5)]
    bot = [(x, z - 0.018) for (x, z) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'y', -1, 0.004, LAMP, mirror=True)

    # --- hood nostrils (top view, u = x, v = y)
    top = [(0.10 + 0.30 * i / 4, -1.93 - 0.04 * i / 4) for i in range(5)]
    bot = [(0.12 + 0.30 * i / 4, -1.52 - 0.03 * i / 4) for i in range(5)]
    uv, fc = strip_grid(top, bot, rows=3)
    D.add(uv, fc, 'z', 1, 0.003, GRILLE, mirror=True)
    for k in range(4):   # vent slats
        x0 = 0.14 + k * 0.075
        top = [(x0, -1.93 - 0.01 * k), (x0 + 0.018, -1.93 - 0.01 * k)]
        bot = [(x0 + 0.004, -1.53 - 0.01 * k), (x0 + 0.022, -1.53 - 0.01 * k)]
        uv, fc = strip_grid(top, bot, rows=4)
        D.add(uv, fc, 'z', 1, 0.009, CARBON, mirror=True)

    # --- front fender louvres (top view)
    for k in range(7):
        y0 = -1.46 + k * 0.07
        top = [(0.64 + 0.22 * i / 2, y0) for i in range(3)]
        bot = [(x, y0 + 0.035) for (x, _) in top]
        uv, fc = strip_grid(top, bot)
        D.add(uv, fc, 'z', 1, 0.006, GRILLE, mirror=True)

    # --- rear-fender intake (side view, tilted oval)
    uv, fc = ellipse_grid(0.80, 0.74, 0.135, 0.06, n=14, rot=math.radians(52), rings=2)
    D.add(uv, fc, 'x', 1, 0.003, GRILLE, mirror=True)

    # --- door handle
    uv, fc = ellipse_grid(0.30, 0.86, 0.075, 0.014, n=10, rings=1)
    D.add(uv, fc, 'x', 1, 0.004, TRIM, mirror=True)

    # --- rear: full-width light bar (rear view, u = x, v = z)
    n = 28
    top = [(-0.80 + 1.60 * i / n, 0.862) for i in range(n + 1)]
    bot = [(x, 0.835 if abs(x) < 0.5 else 0.835 - 0.04 * min(1, (abs(x) - 0.5) / 0.15)) for (x, _) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'y', 1, 0.004, TAIL)
    # black rear bumper + diffuser face
    top = [(-0.74 + 1.48 * i / 12, 0.47) for i in range(13)]
    bot = [(x, 0.20) for (x, _) in top]
    uv, fc = strip_grid(top, bot, rows=3)
    D.add(uv, fc, 'y', 1, 0.003, TRIM)
    # engine-lid grille (top view)
    for s0 in (0.05, -0.42):
        top = [(s0 + 0.37 * i / 4, 1.30) for i in range(5)]
        bot = [(x, 1.86) for (x, _) in top]
        uv, fc = strip_grid(top, bot, rows=5)
        D.add(uv, fc, 'z', 1, 0.003, GRILLE)
    return D.build("GT3RS_Details", coll, mats)


# --------------------------------------------------------------------------
# simple solids
def box_verts(c, s, rot=None):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    vs = [Vector((x, y, z)) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]
    if rot:
        R = rot.to_matrix()
        vs = [R @ v for v in vs]
    return [tuple(Vector(c) + v) for v in vs]


BOX_FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]


class Builder:
    """Accumulates geometry; per-face flags control normal fixing:
       'c' = part of a closed solid (recalculated outward),
       (x, y, z) or callable(center)->target = open surface facing that point."""
    def __init__(self):
        self.verts, self.faces, self.fm, self.flags = [], [], [], []

    def add(self, verts, faces, mi, flag=None, fms=None):
        b = len(self.verts)
        self.verts += [tuple(v) for v in verts]
        for i, f in enumerate(faces):
            self.faces.append([b + k for k in f])
            self.fm.append(fms[i] if fms else mi)
            self.flags.append(flag)

    def box(self, c, s, mi, rot=None):
        self.add(box_verts(c, s, rot), BOX_FACES, mi, 'c')

    def extrude(self, outline, axis, lo, hi, mi):
        n = len(outline)
        vs = []
        for w in (lo, hi):
            for (a, b) in outline:
                vs.append((w, a, b) if axis == 'x' else (a, w, b) if axis == 'y' else (a, b, w))
        fs = [list(range(n))[::-1], list(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            fs.append([i, j, n + j, n + i])
        self.add(vs, fs, mi, 'c')

    def tube(self, pts, r, mi, sides=6):
        pts = [Vector(p) for p in pts]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            u = t.cross(a).normalized()
            v = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
        vs = [q for ring in rings for q in ring]
        fs = []
        for i in range(len(pts) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                a, b = i * sides + k, i * sides + k2
                fs.append([a, b, b + sides, a + sides])
        # orient each face away from the centre-line
        b0 = len(self.verts)
        self.add(vs, fs, mi, None)
        for fi in range(len(self.faces) - len(fs), len(self.faces)):
            f = self.faces[fi]
            seg = (f[0] - b0) // sides
            c = sum((Vector(self.verts[k]) for k in f), Vector()) / 4
            axis_pt = (pts[seg] + pts[seg + 1]) / 2
            vs4 = [Vector(self.verts[k]) for k in f]
            n = (vs4[1] - vs4[0]).cross(vs4[3] - vs4[0])
            if n.dot(c - axis_pt) < 0:
                self.faces[fi] = f[::-1]

    def revolve(self, profile, segs, mi, flip=False):
        """profile: list of (axial x, radius) revolved around the X axis."""
        vs, fs = [], []
        n = len(profile)
        for s in range(segs):
            a = 2 * math.pi * s / segs
            ca, sa = math.cos(a), math.sin(a)
            for (ax, r) in profile:
                vs.append((ax, r * ca, r * sa))
        for s in range(segs):
            s2 = (s + 1) % segs
            for i in range(n - 1):
                f = [s * n + i, s * n + i + 1, s2 * n + i + 1, s2 * n + i]
                fs.append(f[::-1] if flip else f)
        self.add(vs, fs, mi, None)

    def obj(self, name, coll, mats, smooth=35, loc=(0, 0, 0)):
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in self.verts]
        closed, oriented = [], []
        for f, mi, fl in zip(self.faces, self.fm, self.flags):
            try:
                bf = bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            bf.material_index = mi
            if fl == 'c':
                closed.append(bf)
            elif fl is not None:
                oriented.append((bf, fl))
        bm.normal_update()
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=closed)
        flip = []
        for bf, fl in oriented:
            c = bf.calc_center_median()
            tgt = Vector(fl(c) if callable(fl) else fl)
            if bf.normal.dot(tgt - c) < 0:
                flip.append(bf)
        if flip:
            bmesh.ops.reverse_faces(bm, faces=flip)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        ob.location = loc
        coll.objects.link(ob)
        if smooth is not None:
            set_smooth(ob, smooth)
        return ob


def offset_line(pts, w):
    """Thicken a 2D centre-line into a closed outline of width w."""
    left, right = [], []
    for i, p in enumerate(pts):
        a = Vector(pts[max(i - 1, 0)])
        b = Vector(pts[min(i + 1, len(pts) - 1)])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        left.append(tuple(Vector(p) + nrm * w / 2))
        right.append(tuple(Vector(p) - nrm * w / 2))
    return left + right[::-1]


def airfoil(chord, le, aoa_deg, thick=1.0):
    """Inverted (downforce) airfoil in (y, z); trailing edge kicked up by aoa."""
    up = [(0, 0), (0.03, -0.022), (0.12, -0.045), (0.3, -0.06), (0.55, -0.05), (0.8, -0.025), (1.0, 0.0)]
    top = [(0.8, 0.008), (0.55, 0.012), (0.3, 0.012), (0.12, 0.010), (0.03, 0.008)]
    pts = up + top
    a = math.radians(aoa_deg)
    out = []
    for (u, v) in pts:
        u, v = u * chord, v * chord * thick
        y = u * math.cos(a) - v * math.sin(a)
        z = u * math.sin(a) + v * math.cos(a)
        out.append((le[0] + y, le[1] + z))
    return out


def build_aero(coll, M):
    B = Builder()
    CARB, TRIM = 0, 1
    span = 0.86
    # rear wing: main plane + upper flap (swan-neck mounted)
    main = airfoil(0.34, (1.86, 1.175), 10)
    flap = airfoil(0.17, (2.13, 1.235), 32)
    B.extrude(main, 'x', -span, span, CARB)
    B.extrude(flap, 'x', -span + 0.01, span - 0.01, CARB)
    # endplates
    ep = [(1.82, 1.10), (2.30, 1.16), (2.33, 1.40), (2.12, 1.39), (1.86, 1.24)]
    for s in (1, -1):
        B.extrude(ep, 'x', s * span, s * (span + 0.012), CARB)
    # swan-neck uprights
    cl = [(1.66, 0.96), (1.72, 1.08), (1.80, 1.21), (1.90, 1.28), (1.99, 1.28), (2.04, 1.24), (2.05, 1.20)]
    neck = offset_line(cl, 0.055)
    for s in (1, -1):
        B.extrude(neck, 'x', s * 0.30, s * 0.32, TRIM)
    # front splitter
    half = [(0.0, -2.335), (0.30, -2.32), (0.58, -2.27), (0.76, -2.18), (0.86, -2.05), (0.88, -1.92), (0.80, -1.90)]
    outline = half + [(-x, y) for (x, y) in reversed(half)]
    B.extrude(ccw(outline), 'z', 0.095, 0.115, CARB)
    # rear diffuser strakes
    for x in (-0.48, -0.24, 0.0, 0.24, 0.48):
        B.box((x, 2.10, 0.165), (0.012, 0.40, 0.09), CARB)
    # side skirt blades
    for s in (1, -1):
        B.box((s * 0.875, -0.10, 0.14), (0.05, 1.62, 0.045), CARB)
    # front dive planes
    for s in (1, -1):
        B.box((s * 0.80, -2.10, 0.30), (0.16, 0.10, 0.012), CARB, rot=None)
    ob = B.obj("GT3RS_Aero", coll, [M['carbon'], M['trim']], smooth=30)
    return ob


def build_exhaust_mirrors(coll, M):
    B = Builder()
    MET, TRIM, PAINT, CARB = 0, 1, 2, 3
    # twin centre exhausts (tubes along +y)
    for x in (-0.075, 0.075):
        prof_ = [(0.0, 0.045), (0.0, 0.055), (0.12, 0.055)]
        sub = Builder()
        sub.revolve(prof_, 14, 0, flip=True)
        R = Matrix.Rotation(math.radians(-90), 4, 'Z')
        vs = [tuple(R @ Vector(v) + Vector((x, 2.33, 0.33))) for v in sub.verts]
        B.add(vs, sub.faces, MET)
        # dark inner disc
        inner = [(x + 0.045 * math.cos(2 * math.pi * k / 14), 2.30, 0.33 + 0.045 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
        B.add(inner, [list(range(14))[::-1]], TRIM)
    # mirrors: pod + stalk
    for s in (1, -1):
        pod = Builder()
        segs, rings = 12, 6
        vs, fs = [], []
        for i in range(1, rings):
            th = math.pi * i / rings
            for k in range(segs):
                ph = 2 * math.pi * k / segs
                vs.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
        top_i, bot_i = len(vs), len(vs) + 1
        vs += [(0, 0, 1), (0, 0, -1)]
        for i in range(rings - 2):
            for k in range(segs):
                k2 = (k + 1) % segs
                fs.append([i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k])
        for k in range(segs):
            k2 = (k + 1) % segs
            fs.append([top_i, k2, k])
            b = (rings - 2) * segs
            fs.append([bot_i, b + k, b + k2])
        sc = Vector((0.11, 0.075, 0.055))
        c = Vector((s * 1.01, -0.50, 1.02))
        vs = [tuple(c + Vector((v[0] * sc.x, v[1] * sc.y * (1.0 if v[1] < 0 else 0.55), v[2] * sc.z))) for v in vs]
        B.add(vs, fs, CARB, 'c')
        # mirror glass on the rear face
        mg = [(s * 1.01 + 0.095 * math.cos(2 * math.pi * k / 12), -0.455, 1.02 + 0.045 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
        B.add(mg, [list(range(12))[::-1]], MET)
        # stalk
        B.box((s * 0.88, -0.52, 0.985), (0.20, 0.035, 0.025), CARB, rot=Matrix.Rotation(math.radians(s * 8), 3, 'Y').to_quaternion())
    ob = B.obj("GT3RS_Trim", coll, [M['metal'], M['trim'], M['paint'], M['carbon']], smooth=50)
    return ob


# --------------------------------------------------------------------------
# wheels
def build_wheel(name, coll, M, R, W, RIM, side, loc, front):
    B = Builder()
    TIRE, RIMM, DISC = 0, 1, 2
    h = W / 2
    # tyre: inner sidewall -> tread -> outer sidewall (axial along x, outward = +x)
    tp = [(-h * 0.88, RIM + 0.012), (-h, R - 0.055), (-h * 0.97, R - 0.018), (-h * 0.82, R),
          (h * 0.82, R), (h * 0.97, R - 0.018), (h, R - 0.055), (h * 0.88, RIM + 0.012)]
    B.revolve(tp, 20, TIRE, flip=True)
    # rim: lip + barrel
    rp = [(h * 0.88, RIM + 0.012), (h * 0.93, RIM + 0.004), (h * 0.90, RIM - 0.012), (h * 0.55, RIM - 0.018), (-h * 0.8, RIM - 0.018)]
    B.revolve(rp, 20, RIMM, flip=True)
    # 10 split spokes, dished toward the hub
    nsp = 10
    for k in range(nsp):
        a = 2 * math.pi * (k + 0.5) / nsp
        for off in (0.0,):
            a0 = a + off
            r0, r1 = 0.075, RIM - 0.016
            w0, w1 = 0.030, 0.022
            ax0, ax1 = h * 0.62, h * 0.80   # hub sits further out than spoke root
            t = Vector((0, math.cos(a0), math.sin(a0)))
            nrm = Vector((0, -math.sin(a0), math.cos(a0)))
            th = 0.022
            pts = []
            for (rr, ww, ax) in ((r0, w0, ax1), (r1, w1, ax0)):
                for sgn in (-1, 1):
                    pts.append(Vector((ax, 0, 0)) + t * rr + nrm * ww * sgn)
            front_ = [p + Vector((0.0, 0, 0)) for p in pts]
            back_ = [p - Vector((th, 0, 0)) for p in pts]
            vs = front_ + back_
            fs = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4], [1, 5, 7, 3], [2, 3, 7, 6], [0, 4, 5, 1]]
            B.add(vs, fs, RIMM, 'c')
    # hub + centre-lock nut
    hubp = [(h * 0.80, 0.012), (h * 0.80, 0.045), (h * 0.74, 0.08), (h * 0.55, 0.085)]
    B.revolve(hubp, 8, RIMM)
    # brake disc (double-sided annulus)
    dr = RIM - 0.05
    dp = [(-h * 0.05, 0.12), (-h * 0.05, dr), (-h * 0.25, dr), (-h * 0.25, 0.12)]
    B.revolve(dp, 16, DISC)
    mirror_builder(B, side)
    return B.obj(name, coll, [M['tire'], M['rim'], M['disc']], smooth=40, loc=loc)


def mirror_builder(B, side):
    if side < 0:   # mirror for the right-hand (-X) side
        B.verts = [(-v[0], v[1], v[2]) for v in B.verts]
        B.faces = [f[::-1] for f in B.faces]


def build_caliper(name, coll, M, RIM, W, side, loc):
    B = Builder()
    h = W / 2
    dr = RIM - 0.05
    # curved block hugging the disc, trailing edge (behind the axle, upper)
    segs = 5
    vs, fs = [], []
    for i in range(segs + 1):
        a = math.radians(30 + 60 * i / segs)   # around the top-rear quadrant
        for (rr) in (dr - 0.07, dr + 0.012):
            for ax in (-h * 0.36, -h * 0.0 + 0.02):
                vs.append((ax, math.cos(a) * rr, math.sin(a) * rr))
    for i in range(segs):
        b0, b1 = i * 4, (i + 1) * 4
        fs += [[b0, b0 + 1, b1 + 1, b1], [b0 + 2, b1 + 2, b1 + 3, b0 + 3],
               [b0, b1, b1 + 2, b0 + 2], [b0 + 1, b0 + 3, b1 + 3, b1 + 1]]
    fs += [[0, 2, 3, 1], [segs * 4, segs * 4 + 1, segs * 4 + 3, segs * 4 + 2]]
    B.add(vs, fs, 0, 'c')
    mirror_builder(B, side)
    return B.obj(name, coll, [M['caliper']], smooth=30, loc=loc)


# --------------------------------------------------------------------------
# interior
def inset_profile(p, d):
    out = []
    n = len(p)
    for i in range(n):
        a = Vector(p[max(i - 1, 0)])
        b = Vector(p[min(i + 1, n - 1)])
        t = (b - a).normalized()
        inward = Vector((-t.y, t.x))
        q = Vector(p[i]) + inward * d
        out.append((max(q.x, 0.0) if i not in (0, 11) else 0.0, q.y))
    return out


def build_interior(coll, M):
    B = Builder()
    INT, RED, MET = 0, 1, 2
    # tub: door panels + floor (rows r0..r8, inset) with a cap to the outer skin
    ys = [-0.80 + 1.60 * i / 8 for i in range(9)]
    rows = list(range(0, 9))
    ring = None
    grid = []
    for y in ys:
        p = prof(y)
        ip = inset_profile(p, 0.035)
        right = [(ip[r][0], y, ip[r][1]) for r in rows] + [(p[8][0] - 0.004, y, p[8][1] - 0.003)]
        left = [(-v[0], v[1], v[2]) for v in right[1:]][::-1]
        grid.append(left + right)
    nr = len(grid[0])
    vs = [v for g in grid for v in g]
    fs = []
    for j in range(len(ys) - 1):
        for k in range(nr - 1):
            a = j * nr + k
            fs.append([a, a + 1, a + nr + 1, a + nr])
    B.add(vs, fs, INT, lambda c: (0, c.y, 1.1))
    # headliner (rows r9..r11 inset, plus cap to the skin at r9)
    ys2 = [-0.32 + 0.96 * i / 6 for i in range(7)]
    grid = []
    for y in ys2:
        p = prof(y)
        ip = inset_profile(p, 0.03)
        right = [(p[9][0] - 0.004, y, p[9][1] - 0.004)] + [(ip[r][0], y, ip[r][1]) for r in (9, 10, 11)]
        left = [(-v[0], v[1], v[2]) for v in right[:-1]][::-1]
        grid.append(right + left)
    nr = len(grid[0])
    vs = [v for g in grid for v in g]
    fs = []
    for j in range(len(ys2) - 1):
        for k in range(nr - 1):
            a = j * nr + k
            fs.append([a, a + 1, a + nr + 1, a + nr])
    B.add(vs, fs, INT, lambda c: (0, c.y, 0.6))
    # firewall, rear bulkhead + parcel shelf
    B.add([(-0.72, -0.80, 0.15), (0.72, -0.80, 0.15), (0.70, -0.80, 0.88), (-0.70, -0.80, 0.88)], [[0, 1, 2, 3]], INT, (0, 0, 0.7))
    B.add([(-0.76, 0.80, 0.15), (0.76, 0.80, 0.15), (0.76, 0.80, 0.97), (-0.76, 0.80, 0.97)], [[0, 1, 2, 3]], INT, (0, 0, 0.7))
    B.add([(-0.74, 0.80, 0.97), (0.74, 0.80, 0.97), (0.62, 1.32, 0.99), (-0.62, 1.32, 0.99)], [[0, 1, 2, 3]], INT, (0, 1.0, 2.0))
    # dashboard (side profile extruded across)
    dash = [(-0.93, 0.40), (-0.93, 0.86), (-0.88, 0.905), (-0.62, 0.975), (-0.52, 0.965), (-0.47, 0.90),
            (-0.48, 0.74), (-0.56, 0.55), (-0.66, 0.40)]
    B.extrude(ccw(dash), 'x', -0.70, 0.70, INT)
    # gauge binnacle hood (driver side, +X)
    bin_ = [(-0.66, 0.97), (-0.62, 1.035), (-0.52, 1.03), (-0.48, 0.97)]
    B.extrude(ccw(bin_ + [(-0.60, 0.95)]), 'x', 0.20, 0.52, INT)
    # centre console + shifter
    B.box((0.0, -0.20, 0.30), (0.20, 0.70, 0.28), INT)
    B.box((0.0, -0.08, 0.50), (0.025, 0.025, 0.14), MET)
    # seats: bucket = cushion, back, bolsters, headrest opening
    for x, red in ((0.37, True), (-0.37, False)):
        rb = Matrix.Rotation(math.radians(-18), 3, 'X').to_quaternion()
        B.box((x, 0.05, 0.25), (0.48, 0.50, 0.12), INT)
        B.box((x, 0.36, 0.66), (0.50, 0.09, 0.82), INT, rot=rb)
        for s in (-1, 1):
            B.box((x + s * 0.22, 0.30, 0.62), (0.07, 0.20, 0.70), INT, rot=rb)
            B.box((x + s * 0.21, 0.05, 0.32), (0.07, 0.45, 0.12), INT)
        # red harness straps
        for s in (-1, 1):
            B.box((x + s * 0.09, 0.305, 0.72), (0.045, 0.01, 0.62), RED, rot=rb)
        B.box((x, 0.10, 0.33), (0.05, 0.40, 0.012), RED)
    # steering wheel (driver, +X) facing the driver
    sw = Builder()
    segs, rs = 14, 4
    vs, fs = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        for k in range(rs):
            b = 2 * math.pi * k / rs
            r = 0.175 + 0.018 * math.cos(b)
            vs.append((r * math.cos(a), 0.018 * math.sin(b), r * math.sin(a)))
    for i in range(segs):
        i2 = (i + 1) % segs
        for k in range(rs):
            k2 = (k + 1) % rs
            fs.append([i * rs + k, i2 * rs + k, i2 * rs + k2, i * rs + k2])
    sw.add(vs, fs, INT, 'c')
    sw.box((0, 0, -0.02), (0.30, 0.03, 0.06), INT)
    sw.box((0, 0, -0.10), (0.05, 0.03, 0.16), INT)
    sw.box((0, -0.01, 0.17), (0.02, 0.01, 0.025), RED)
    tilt = Matrix.Rotation(math.radians(-22), 4, 'X')
    swc = Vector((0.37, -0.40, 0.85))
    B.add([tuple(tilt @ Vector(v) + swc) for v in sw.verts], sw.faces, INT, 'c', fms=sw.fm)
    B.tube([(0.37, -0.42, 0.84), (0.37, -0.62, 0.93)], 0.025, INT)
    # Clubsport roll cage
    y_h = 0.66
    hoop = [(-0.70, y_h, 0.16), (-0.70, y_h, 0.90), (-0.56, y_h, 1.13), (0.0, y_h, 1.18),
            (0.56, y_h, 1.13), (0.70, y_h, 0.90), (0.70, y_h, 0.16)]
    B.tube(hoop, 0.02, RED)
    B.tube([(-0.68, y_h, 0.30), (0.60, y_h, 1.10)], 0.018, RED)
    for s in (1, -1):
        B.tube([(s * 0.66, y_h, 0.62), (s * 0.70, -0.35, 0.60), (s * 0.68, -0.70, 0.75)], 0.018, RED)
        B.tube([(s * 0.64, y_h, 1.00), (s * 0.60, 1.20, 0.98)], 0.018, RED)
    ob = B.obj("GT3RS_Interior", coll, [M['int'], M['intred'], M['metal']], smooth=35)
    return ob


# --------------------------------------------------------------------------
def build():
    coll = get_coll(COLL)
    M = make_mats()
    M['cut_arch'] = mat("CUT_arch", (0.01, 0.01, 0.01), 0.9)
    M['cut_win'] = mat("CUT_win", (1, 0, 1), 0.5)

    body = build_body(coll, M)

    # wheel arches -> wheel wells (cutter faces become the well liners)
    for c in wheel_arch_cutters(coll, M):
        apply_boolean(body, c, 'DIFFERENCE')
        bpy.data.objects.remove(c, do_unlink=True)
    remap_mat(body, "CUT_arch", M['well'])

    # glass = body ∩ window cutters (keep only the original skin)
    wcs = window_cutters(coll, M)
    glass_parts = []
    for c in wcs:
        g = body.copy()
        g.data = body.data.copy()
        coll.objects.link(g)
        apply_boolean(g, c, 'INTERSECT')
        delete_faces_with_mat(g, "CUT_")
        glass_parts.append(g)
    for c in wcs:
        apply_boolean(body, c, 'DIFFERENCE')
    delete_faces_with_mat(body, "CUT_")
    for c in wcs:
        bpy.data.objects.remove(c, do_unlink=True)

    # join glass pieces
    gverts, gfaces = [], []
    for g in glass_parts:
        b = len(gverts)
        gverts += [tuple(v.co) for v in g.data.vertices]
        gfaces += [[b + i for i in p.vertices] for p in g.data.polygons]
        d = g.data
        bpy.data.objects.remove(g, do_unlink=True)
        bpy.data.meshes.remove(d)
    glass = mesh_obj("GT3RS_Glass", gverts, gfaces, coll, [M['glass']], smooth_angle=60)

    set_smooth(body, 38)
    decals = build_decals(body, coll, M)
    aero = build_aero(coll, M)
    trim = build_exhaust_mirrors(coll, M)
    interior = build_interior(coll, M)

    wheels = []
    for nm, y, xh, R, W, RIM, side, front in (
            ("FL", FRONT_AXLE_Y, F_TRACK_HALF, F_TIRE_R, F_TIRE_W, F_RIM_R, 1, True),
            ("FR", FRONT_AXLE_Y, F_TRACK_HALF, F_TIRE_R, F_TIRE_W, F_RIM_R, -1, True),
            ("RL", REAR_AXLE_Y, R_TRACK_HALF, R_TIRE_R, R_TIRE_W, R_RIM_R, 1, False),
            ("RR", REAR_AXLE_Y, R_TRACK_HALF, R_TIRE_R, R_TIRE_W, R_RIM_R, -1, False)):
        loc = (side * xh, y, R)
        w = build_wheel("GT3RS_Wheel_" + nm, coll, M, R, W, RIM, side, loc, front)
        cal = build_caliper("GT3RS_Caliper_" + nm, coll, M, RIM, W, side, loc)
        wheels += [w, cal]

    for m in ("CUT_arch", "CUT_win"):
        mm = bpy.data.materials.get(m)
        if mm and mm.users == 0:
            bpy.data.materials.remove(mm)

    # parent everything to the body so the car moves as one
    for o in coll.objects:
        if o is not body:
            o.parent = body            # body sits at the origin, so no inverse needed
            o.matrix_parent_inverse.identity()

    stats = {o.name: tri_count(o) for o in coll.objects}
    stats["TOTAL_TRIS"] = sum(stats.values())
    return stats


if __name__ == "__main__" or True:
    result = build()
