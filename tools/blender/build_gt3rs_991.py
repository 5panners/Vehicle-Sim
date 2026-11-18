"""Low-poly 991-generation GT3 RS-style car for Vehicle Sim (shape matched to reference photos, no badges).

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
# real-car dimensions (991.1 GT3 RS: L 4.545, W 1.880, H 1.291, wheelbase 2.456)
FRONT_AXLE_Y, REAR_AXLE_Y = -1.228, 1.228
F_TRACK_HALF, R_TRACK_HALF = 0.794, 0.780
F_TIRE_R, F_TIRE_W, F_RIM_R = 0.347, 0.265, 0.254  # 265/35 R20
R_TIRE_R, R_TIRE_W, R_RIM_R = 0.364, 0.325, 0.267  # 325/30 R21
F_ARCH_R, R_ARCH_R = 0.388, 0.402

# --------------------------------------------------------------------------
# body stations: y (front = -), then 12 half-profile points (x, z) from bottom centre
# r0 floor centre, r1 floor edge, r2 rocker, r3 lower side, r4 mid side, r5 shoulder,
# r6 fender crown / belt, r7 fender inner slope, r8 hood gutter / window sill,
# r9 hood outer / A-pillar / roof edge, r10 hood / roof inner, r11 top centre.
# The 911 silhouette: low hood dropping between raised fenders (frog-eye), steep screen,
# one long roof line falling to the engine lid, wide rear hips, round tail.
STATIONS = [
    (-2.2, [(0, 0.13), (0.26, 0.13), (0.36, 0.17), (0.4, 0.3), (0.41, 0.4), (0.4, 0.46), (0.37, 0.49), (0.32, 0.51), (0.27, 0.518), (0.18, 0.523), (0.09, 0.526), (0, 0.527)]),
    (-2.15, [(0, 0.115), (0.5, 0.115), (0.59, 0.16), (0.6, 0.3), (0.62, 0.422), (0.64, 0.498), (0.6, 0.535), (0.52, 0.552), (0.44, 0.557), (0.31, 0.56), (0.155, 0.563), (0, 0.563)]),
    (-2.05, [(0, 0.105), (0.64, 0.105), (0.71, 0.155), (0.745, 0.3), (0.77, 0.455), (0.785, 0.56), (0.74, 0.62), (0.645, 0.615), (0.565, 0.6), (0.4, 0.605), (0.2, 0.609), (0, 0.611)]),
    (-1.9, [(0, 0.1), (0.75, 0.1), (0.83, 0.15), (0.85, 0.31), (0.865, 0.478), (0.86, 0.617), (0.79, 0.713), (0.67, 0.69), (0.585, 0.655), (0.42, 0.662), (0.21, 0.667), (0, 0.669)]),
    (-1.65, [(0, 0.1), (0.81, 0.1), (0.88, 0.15), (0.905, 0.33), (0.91, 0.523), (0.89, 0.685), (0.8, 0.793), (0.68, 0.768), (0.6, 0.723), (0.44, 0.73), (0.22, 0.734), (0, 0.736)]),
    (-1.4, [(0, 0.1), (0.83, 0.1), (0.895, 0.15), (0.92, 0.35), (0.925, 0.557), (0.905, 0.728), (0.81, 0.852), (0.69, 0.825), (0.61, 0.775), (0.45, 0.78), (0.23, 0.784), (0, 0.786)]),
    (-1.228, [(0, 0.1), (0.84, 0.1), (0.9, 0.15), (0.925, 0.36), (0.93, 0.57), (0.91, 0.75), (0.815, 0.876), (0.7, 0.85), (0.62, 0.805), (0.46, 0.81), (0.23, 0.814), (0, 0.816)]),
    (-1, [(0, 0.1), (0.83, 0.1), (0.895, 0.15), (0.915, 0.38), (0.92, 0.59), (0.9, 0.755), (0.83, 0.884), (0.72, 0.87), (0.64, 0.835), (0.47, 0.84), (0.24, 0.845), (0, 0.848)]),
    (-0.72, [(0, 0.1), (0.83, 0.1), (0.885, 0.155), (0.905, 0.4), (0.905, 0.6), (0.885, 0.76), (0.845, 0.872), (0.815, 0.905), (0.785, 0.914), (0.66, 0.908), (0.33, 0.914), (0, 0.916)]),
    (-0.45, [(0, 0.1), (0.83, 0.1), (0.885, 0.155), (0.9, 0.4), (0.9, 0.61), (0.88, 0.77), (0.845, 0.877), (0.815, 0.917), (0.8, 0.93), (0.591, 1.063), (0.298, 1.084), (0, 1.089)]),
    (-0.15, [(0, 0.1), (0.83, 0.1), (0.885, 0.155), (0.9, 0.4), (0.9, 0.61), (0.88, 0.77), (0.845, 0.877), (0.815, 0.917), (0.8, 0.936), (0.558, 1.233), (0.279, 1.265), (0, 1.27)]),
    (0.2, [(0, 0.1), (0.835, 0.1), (0.89, 0.155), (0.905, 0.4), (0.905, 0.62), (0.885, 0.78), (0.85, 0.88), (0.82, 0.92), (0.8, 0.939), (0.539, 1.273), (0.27, 1.305), (0, 1.311)]),
    (0.55, [(0, 0.1), (0.855, 0.1), (0.905, 0.155), (0.925, 0.41), (0.925, 0.63), (0.9, 0.795), (0.86, 0.89), (0.82, 0.94), (0.79, 0.968), (0.525, 1.249), (0.26, 1.287), (0, 1.292)]),
    (0.7, [(0, 0.1), (0.8725, 0.1), (0.925, 0.155), (0.9485, 0.415), (0.9485, 0.64), (0.9225, 0.807), (0.875, 0.903), (0.81, 0.951), (0.765, 0.98), (0.5185, 1.212), (0.2555, 1.252), (0, 1.257)]),
    (0.85, [(0, 0.1), (0.89, 0.1), (0.945, 0.155), (0.972, 0.42), (0.972, 0.65), (0.945, 0.82), (0.89, 0.915), (0.8, 0.958), (0.74, 0.985), (0.512, 1.161), (0.251, 1.2), (0, 1.205)]),
    (0.975, [(0, 0.1), (0.895, 0.1), (0.95, 0.158), (0.9785, 0.425), (0.9785, 0.655), (0.95, 0.827), (0.895, 0.923), (0.79, 0.966), (0.7, 0.989), (0.5025, 1.115), (0.2465, 1.158), (0, 1.163)]),
    (1.1, [(0, 0.1), (0.9, 0.1), (0.955, 0.16), (0.985, 0.43), (0.985, 0.66), (0.955, 0.835), (0.9, 0.93), (0.78, 0.973), (0.66, 0.991), (0.493, 1.067), (0.242, 1.113), (0, 1.118)]),
    (1.228, [(0, 0.1), (0.9, 0.1), (0.955, 0.16), (0.988, 0.44), (0.988, 0.67), (0.955, 0.85), (0.895, 0.945), (0.76, 0.983), (0.64, 0.991), (0.52, 1.033), (0.26, 1.068), (0, 1.073)]),
    (1.45, [(0, 0.11), (0.874, 0.11), (0.928, 0.17), (0.955, 0.45), (0.955, 0.68), (0.923, 0.835), (0.859, 0.92), (0.732, 0.95), (0.609, 0.946), (0.491, 0.975), (0.245, 0.994), (0, 0.997)]),
    (1.75, [(0, 0.13), (0.818, 0.13), (0.876, 0.19), (0.9, 0.46), (0.9, 0.68), (0.871, 0.8), (0.804, 0.865), (0.689, 0.886), (0.565, 0.878), (0.44, 0.889), (0.22, 0.9), (0, 0.902)]),
    (2, [(0, 0.19), (0.736, 0.19), (0.783, 0.235), (0.8, 0.45), (0.792, 0.64), (0.762, 0.735), (0.71, 0.765), (0.599, 0.787), (0.496, 0.802), (0.385, 0.815), (0.193, 0.822), (0, 0.822)]),
    (2.15, [(0, 0.24), (0.626, 0.24), (0.676, 0.28), (0.7, 0.44), (0.692, 0.6), (0.665, 0.68), (0.618, 0.705), (0.516, 0.723), (0.422, 0.736), (0.321, 0.752), (0.16, 0.76), (0, 0.76)]),
    (2.23, [(0, 0.29), (0.54, 0.29), (0.601, 0.315), (0.64, 0.43), (0.632, 0.55), (0.605, 0.605), (0.563, 0.63), (0.478, 0.644), (0.386, 0.651), (0.285, 0.654), (0.143, 0.656), (0, 0.657)]),
    (2.275, [(0, 0.33), (0.467, 0.33), (0.54, 0.35), (0.58, 0.42), (0.576, 0.52), (0.552, 0.565), (0.508, 0.59), (0.435, 0.603), (0.355, 0.609), (0.266, 0.612), (0.133, 0.614), (0, 0.615)]),
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


def section_ys(step=0.055):
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
    M['paint'] = mat("GT3_Paint", (0.86, 0.075, 0.004), 0.18, 0.0, coat=1.0)
    M['carbon'] = mat("GT3_Carbon", (0.02, 0.02, 0.022), 0.38, 0.0, coat=0.25)
    M['trim'] = mat("GT3_TrimBlack", (0.012, 0.012, 0.013), 0.55)
    M['grille'] = mat("GT3_Grille", (0.004, 0.004, 0.004), 0.8)
    M['glass'] = mat("GT3_Glass", (0.05, 0.06, 0.07), 0.04, 0.0, alpha=0.32)
    M['lamp'] = mat("GT3_Headlight", (0.05, 0.055, 0.06), 0.05, 0.5, emit=(0.85, 0.9, 1.0), emit_strength=0.15)
    M['tail'] = mat("GT3_Taillight", (0.45, 0.01, 0.01), 0.1, emit=(1.0, 0.02, 0.01), emit_strength=1.0)
    M['tire'] = mat("GT3_Tire", (0.022, 0.022, 0.022), 0.85)
    M['rim'] = mat("GT3_Rim", (0.035, 0.036, 0.04), 0.45, 0.6)
    M['disc'] = mat("GT3_BrakeDisc", (0.30, 0.30, 0.30), 0.45, 1.0)
    M['caliper'] = mat("GT3_Caliper", (0.55, 0.56, 0.57), 0.35, 0.3)
    M['well'] = mat("GT3_WheelWell", (0.01, 0.01, 0.01), 0.9)
    M['int'] = mat("GT3_Interior", (0.03, 0.03, 0.032), 0.8)
    M['intred'] = mat("GT3_InteriorRed", (0.80, 0.12, 0.012), 0.5)
    M['metal'] = mat("GT3_Metal", (0.6, 0.6, 0.62), 0.25, 1.0)
    M['shade'] = mat("GT3_PaintShade", (0.52, 0.045, 0.003), 0.3, 0.0)
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
def half_profile_fine(p):
    """12 control rows -> 23 rows (Catmull-Rom midpoints), so the cross-section is smooth."""
    out = []
    n = len(p)
    for r in range(n - 1):
        a, b = Vector(p[max(r - 1, 0)]), Vector(p[r])
        c, d = Vector(p[r + 1]), Vector(p[min(r + 2, n - 1)])
        m = 0.5 * (2 * b + (-a + c) * 0.5 + (2 * a - 5 * b + 4 * c - d) * 0.25 + (-a + 3 * b - 3 * c + d) * 0.125)
        out += [(b.x, b.y), (max(m.x, 0.0) if r not in (0,) else m.x, m.y)]
    out.append(tuple(p[-1]))
    out[0] = (0.0, out[0][1]); out[-1] = (0.0, out[-1][1])
    return out


def build_body(coll, M):
    ys = section_ys()
    NF = 23                                                   # fine rows per half (row r -> index 2r)
    ring = list(range(0, NF)) + list(range(NF - 2, 0, -1))    # right half, then left half back down
    R = len(ring)
    verts, faces, fm = [], [], []
    for y in ys:
        hp = half_profile_fine(prof(y))
        for k, r in enumerate(ring):
            x, z = hp[r]
            side = -1 if k >= NF else 1
            verts.append((x * side, y, z))
    mats = [M['paint'], M['trim'], M['carbon']]

    def zone(fa, fb, y):
        lo = int(math.floor(min(fa, fb) / 2 + 1e-9))
        band = (lo, lo + 1)
        if band in ((0, 1), (1, 2)):
            return 1                                          # floor and black side sills
        if band == (8, 9) and -0.55 < y < 1.10:
            return 1                                          # black window surrounds
        return 0

    for j in range(len(ys) - 1):
        yc = (ys[j] + ys[j + 1]) / 2
        for k in range(R):
            k2 = (k + 1) % R
            a, b = j * R + k, j * R + k2
            faces.append([a, b, b + R, a + R])
            fm.append(zone(ring[k], ring[k2], yc))
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
    for (y, zc, r, xin) in ((FRONT_AXLE_Y, F_TIRE_R + 0.01, F_ARCH_R, 0.60),
                             (REAR_AXLE_Y, R_TIRE_R + 0.01, R_ARCH_R, 0.585)):
        for s in (1, -1):
            n = 40
            outline = [(y + r * math.cos(2 * math.pi * i / n), zc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
            lo, hi = (xin, 1.4) if s > 0 else (-1.4, -xin)
            cutters.append(prism("CUT_arch", outline, 'x', lo, hi, coll, M['cut_arch']))
    return cutters


def dlo_outline():
    """Side window outline (y, z) between window-bottom row r8 and roof-edge row r9."""
    top, bot = [], []
    y0, y1 = -0.66, 1.00
    n = 40
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        zt = FZ[9](y) - 0.04
        zb = FZ[8](y) + 0.03
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
    y0, y1 = -0.69, -0.13
    right, n = [], 12
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
    y0, y1 = 0.72, 1.36
    right, n = [], 10
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
    # screen and rear window first: cutting them after the side windows trips the exact solver
    cs = [prism("CUT_ws", ccw(windshield_outline()), 'z', 0.80, 1.7, coll, M['cut_win']),
          prism("CUT_rw", ccw(rear_window_outline()), 'z', 0.93, 1.7, coll, M['cut_win'])]
    d = ccw(dlo_outline())
    cs.append(prism("CUT_dloR", d, 'x', 0.52, 1.4, coll, M['cut_win']))
    cs.append(prism("CUT_dloL", d, 'x', -1.4, -0.52, coll, M['cut_win']))
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
    mats = [M['trim'], M['grille'], M['lamp'], M['tail'], M['carbon'], M['metal'], M['shade'], M['paint']]
    TRIM, GRILLE, LAMP, TAIL, CARBON, METAL, SHADE, PAINT = range(8)
    D = DecalBuilder(P)

    def ring_strip(cu, cv, ro, ri, n=24, rot=0.0):
        ca, sa = math.cos(rot), math.sin(rot)
        P_ = lambda r, a: (cu + r[0] * math.cos(a) * ca - r[1] * math.sin(a) * sa, cv + r[0] * math.cos(a) * sa + r[1] * math.sin(a) * ca)
        outer = [P_(ro, 2 * math.pi * i / n) for i in range(n + 1)]
        inner = [P_(ri, 2 * math.pi * i / n) for i in range(n + 1)]
        return strip_grid(outer, inner)

    # --- headlights: big round lamps on the fender noses, tilted back with the fender (projected from the front)
    HL = (0.655, 0.645)
    uv, fc = ellipse_grid(HL[0], HL[1], 0.122, 0.102, n=24, rot=math.radians(-8), rings=3)
    dome = [0.03] + [0.03 * (1 - (k / 3) ** 2) for k in range(1, 4) for _ in range(24)]
    D.add(uv, fc, 'y', -1, 0.004, LAMP, dome=dome, mirror=True)
    uv, fc = ring_strip(HL[0], HL[1], (0.135, 0.115), (0.122, 0.102), rot=math.radians(-8))
    D.add(uv, fc, 'y', -1, 0.003, METAL, mirror=True)
    # inner projector lens and dark housing behind the glass
    uv, fc = ellipse_grid(HL[0] - 0.03, HL[1] + 0.005, 0.042, 0.042, n=14, rings=1)
    D.add(uv, fc, 'y', -1, 0.012, TRIM, mirror=True)

    # --- front lid leading-edge slot: a black smile across the nose (top view, u = x, v = y)
    n = 16
    top = [(-0.50 + 1.0 * i / n, -2.075 + 0.11 * ((-0.50 + 1.0 * i / n) / 0.5) ** 2) for i in range(n + 1)]
    bot = [(x, y + 0.035) for (x, y) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'z', 1, 0.003, GRILLE)

    # --- front bumper (front view, u = x, v = z)
    # centre intake: wide, slightly arched, with two vertical splitters
    top = [(-0.40 + 0.80 * i / 12, 0.335 - 0.025 * abs(-1 + 2 * i / 12) ** 2) for i in range(13)]
    bot = [(x * 0.97, 0.165) for (x, _) in top]
    uv, fc = strip_grid(top, bot, rows=2)
    D.add(uv, fc, 'y', -1, 0.004, GRILLE)
    for xs in (-0.14, 0.14):
        top = [(xs - 0.012, 0.33), (xs + 0.012, 0.33)]
        bot = [(xs - 0.012, 0.17), (xs + 0.012, 0.17)]
        uv, fc = strip_grid(top, bot, rows=2)
        D.add(uv, fc, 'y', -1, 0.012, TRIM)
    # side intakes: big trapezoids under the light units
    top = [(0.47 + 0.30 * i / 6, 0.405 + 0.02 * i / 6) for i in range(7)]
    bot = [(0.48 + 0.26 * i / 6, 0.175 + 0.035 * i / 6) for i in range(7)]
    uv, fc = strip_grid(top, bot, rows=4)
    D.add(uv, fc, 'y', -1, 0.004, GRILLE, mirror=True)
    for k in range(3):                                     # horizontal fins in the side intakes
        z0 = 0.235 + k * 0.055
        top = [(0.485 + 0.27 * i / 4, z0 + 0.01 * i / 4) for i in range(5)]
        bot = [(x, z - 0.012) for (x, z) in top]
        uv, fc = strip_grid(top, bot)
        D.add(uv, fc, 'y', -1, 0.012, TRIM, mirror=True)
    # light units above the side intakes: almond-shaped smoked glass with an LED strip
    n = 10
    top = [(0.45 + 0.34 * i / n, 0.455 + 0.035 * math.sin(math.pi * i / n) + 0.03 * i / n) for i in range(n + 1)]
    bot = [(x, 0.425 + 0.022 * i / n + 0.01 * math.sin(math.pi * i / n)) for i, (x, _) in enumerate(top)]
    uv, fc = strip_grid(top, bot, rows=2)
    D.add(uv, fc, 'y', -1, 0.004, TRIM, mirror=True)
    top = [(0.48 + 0.28 * i / 6, 0.447 + 0.02 * i / 6) for i in range(7)]
    bot = [(x, z - 0.008) for (x, z) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'y', -1, 0.007, LAMP, mirror=True)
    # little vertical slots between the centre and side intakes
    top = [(0.425, 0.33), (0.445, 0.34)]
    bot = [(0.43, 0.18), (0.45, 0.185)]
    uv, fc = strip_grid(top, bot, rows=3)
    D.add(uv, fc, 'y', -1, 0.004, GRILLE, mirror=True)

    # --- front fender louvres on top of the front wings (top view)
    for k in range(8):
        y0 = -1.42 + k * 0.05
        top = [(0.64 + 0.20 * i / 2, y0) for i in range(3)]
        bot = [(x, y0 + 0.026) for (x, _) in top]
        uv, fc = strip_grid(top, bot)
        D.add(uv, fc, 'z', 1, 0.005, GRILLE, mirror=True)

    # --- door shut lines: front edge, sill and the rear edge with its rounded lower corner (side view)
    door = [(-0.56, 0.905), (-0.56, 0.34), (-0.53, 0.285), (-0.45, 0.27)] + [(-0.45 + 0.90 * i / 6, 0.27) for i in range(1, 7)] + [(0.52, 0.29), (0.58, 0.36), (0.585, 0.60), (0.565, 0.80), (0.53, 0.915)]
    uv, fc = strip_grid(door, [(y + 0.0, z + 0.006) for (y, z) in door])
    D.add(uv, fc, 'x', 1, 0.002, TRIM, mirror=True)
    # --- rear quarter / bumper panel lines (side view, u = y, v = z)
    def seam(pts, w=0.012, off=0.004):
        dense = []
        for (a, b) in zip(pts[:-1], pts[1:]):
            for k in range(8):
                u = k / 8
                dense.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
        dense.append(pts[-1])
        uv, fc = strip_grid(dense, [(y, z - w) for (y, z) in dense])
        D.add(uv, fc, 'x', 1, off, TRIM, mirror=True)
    # the line that runs on from the top of the tail-light unit, over the wheel arch, into the scoop
    seam([(2.20, 0.668), (1.90, 0.664), (1.40, 0.660)], w=0.0045, off=0.003)   # straight and thin: the gap along the top of the light cluster
    # the separate rear bumper: top seam under the tail light, then down behind the arch to the diffuser
    seam([(2.19, 0.575), (2.07, 0.560), (1.94, 0.535), (1.82, 0.505), (1.72, 0.470)])
    # the bumper as its own raised panel: a paint-coloured skin lifted off the quarter, with a dark step at its front edge
    top = [(2.30, 0.600), (2.19, 0.575), (2.07, 0.560), (1.94, 0.535), (1.82, 0.505), (1.72, 0.470)]
    bot = [(2.30, 0.30), (2.19, 0.28), (2.07, 0.27), (1.94, 0.265), (1.82, 0.265), (1.72, 0.27)]
    denseT, denseB = [], []
    for (a, b, c, d) in zip(top[:-1], top[1:], bot[:-1], bot[1:]):
        for k in range(6):
            u = k / 6
            denseT.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
            denseB.append((c[0] + (d[0] - c[0]) * u, c[1] + (d[1] - c[1]) * u))
    denseT.append(top[-1]); denseB.append(bot[-1])
    uv, fc = strip_grid(denseT, denseB, rows=3)
    D.add(uv, fc, 'x', 1, 0.010, PAINT, mirror=True)
    step = [(1.72, 0.470), (1.712, 0.40), (1.706, 0.33), (1.70, 0.27)]
    dense = []
    for (a, b) in zip(step[:-1], step[1:]):
        for k in range(6):
            u = k / 6
            dense.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
    dense.append(step[-1])
    uv, fc = strip_grid(dense, [(y - 0.018, z) for (y, z) in dense])
    D.add(uv, fc, 'x', 1, 0.006, TRIM, mirror=True)
    # --- side marker on the front wing, door handle
    uv, fc = ellipse_grid(-1.62, 0.56, 0.05, 0.012, n=10, rings=1)
    D.add(uv, fc, 'x', 1, 0.003, LAMP, mirror=True)
    uv, fc = ellipse_grid(0.20, 0.865, 0.085, 0.016, n=12, rings=1)
    D.add(uv, fc, 'x', 1, 0.004, TRIM, mirror=True)

    # --- rear-wing air intakes ahead of the rear wheels: long dark scoops sloping back along the hip (side view)
    uv, fc = ellipse_grid(0.79, 0.67, 0.17, 0.042, n=18, rot=math.radians(64), rings=2)
    D.add(uv, fc, 'x', 1, 0.003, GRILLE, mirror=True)

    # --- rear (rear view, u = x, v = z)
    # tail lights: slim units that wrap round the corner of the tail and run forward along the fender top,
    # ending in a smoked louvred tip. Each point is found by a ray fired in towards the body from a centre axis.
    from math import sin, cos, radians
    CY = 1.75
    def wrap_hit(theta, z):
        d = Vector((sin(theta), cos(theta), 0))
        o = Vector((0, CY, z)) + d * 3.2
        loc, nor, idx_, dist = P.bvh.ray_cast(o, -d)
        if loc is None:
            return None, None
        if nor.dot(d) < 0:
            nor = -nor
        return loc, nor
    ths = [radians(24 + 54 * i / 32) for i in range(33)]
    for side in (1, -1):
        rows = []
        for k, th in enumerate(ths):
            u = k / (len(ths) - 1)
            top_z = 0.676 - 0.020 * u ** 2
            thick = 0.082 * (1 - 0.72 * u ** 1.3)
            rows.append([wrap_hit(th, top_z), wrap_hit(th, top_z - thick), u])
        for part, (a, b) in (("lens", (0.0, 0.80)), ("tip", (0.80, 1.0))):
            mi = TAIL if part == "lens" else GRILLE
            vs, nors = [], []
            sel = [r for r in rows if a - 1e-9 <= r[2] <= b + 1e-9]
            for (h0, h1, u) in sel:
                for (loc, nor) in (h0, h1):
                    vs.append(None if loc is None else (Vector((loc.x * side, loc.y, loc.z)) + Vector((nor.x * side, nor.y, nor.z)) * 0.006))
            for q in range(len(sel) - 1):
                idxs = [2 * q, 2 * q + 1, 2 * q + 3, 2 * q + 2]
                if any(vs[ii] is None for ii in idxs):
                    continue
                base = len(D.verts)
                for ii in idxs:
                    D.verts.append(tuple(vs[ii]))
                f = [base, base + 1, base + 2, base + 3]
                if side < 0:
                    f = f[::-1]
                D.faces.append(f); D.fm.append(mi)
    # thin chrome-look inner line along the wrapped light
    for side in (1, -1):
        pts = []
        for k, th in enumerate(ths[:22]):
            loc, nor = wrap_hit(th, 0.652 - 0.02 * (k / 21) ** 2)
            if loc is not None:
                pts.append(Vector((loc.x * side, loc.y, loc.z)) + Vector((nor.x * side, nor.y, nor.z)) * 0.010)
        for q in range(len(pts) - 1):
            base = len(D.verts)
            a, b = pts[q], pts[q + 1]
            for v in (a, b, b + Vector((0, 0, -0.006)), a + Vector((0, 0, -0.006))):
                D.verts.append(tuple(v))
            f = [base, base + 1, base + 2, base + 3]
            D.faces.append(f if side > 0 else f[::-1]); D.fm.append(METAL)
    # black band across the tail under the spoiler lip, joining the lights
    top = [(-0.30 + 0.60 * i / 10, 0.672) for i in range(11)]
    bot = [(x, 0.645) for (x, _) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'y', 1, 0.003, CARBON)
    # small vertical vents at the bumper corners
    top = [(0.50, 0.43), (0.54, 0.43)]
    bot = [(0.50, 0.31), (0.54, 0.32)]
    uv, fc = strip_grid(top, bot, rows=3)
    D.add(uv, fc, 'y', 1, 0.003, GRILLE, mirror=True)
    # reflector strips low on the bumper corners
    top = [(0.42 + 0.10 * i / 3, 0.37) for i in range(4)]
    bot = [(x, 0.352) for (x, _) in top]
    uv, fc = strip_grid(top, bot)
    D.add(uv, fc, 'y', 1, 0.004, TAIL, mirror=True)
    # diffuser face
    top = [(-0.50 + 1.00 * i / 12, 0.29) for i in range(13)]
    bot = [(x, 0.25) for (x, _) in top]
    uv, fc = strip_grid(top, bot, rows=2)
    D.add(uv, fc, 'y', 1, 0.003, TRIM)
    # the bumper's top seam across the tail (rear view, u = x, v = z)
    n = 16
    top = [(-0.48 + 0.96 * i / n, 0.545 + 0.018 * (1 - (2 * i / n - 1) ** 2)) for i in range(n + 1)]
    uv, fc = strip_grid(top, [(x, z - 0.012) for (x, z) in top])
    D.add(uv, fc, 'y', 1, 0.004, TRIM)
    # engine-lid grille behind the rear window (top view)
    for s0 in (0.03, -0.43):
        top = [(s0 + 0.40 * i / 4, 1.42) for i in range(5)]
        bot = [(x, 1.74) for (x, _) in top]
        uv, fc = strip_grid(top, bot, rows=6)
        D.add(uv, fc, 'z', 1, 0.003, GRILLE)
    for k in range(7):                                     # slats
        y0 = 1.45 + k * 0.04
        top = [(-0.42 + 0.84 * i / 4, y0) for i in range(5)]
        bot = [(x, y0 + 0.012) for (x, _) in top]
        uv, fc = strip_grid(top, bot)
        D.add(uv, fc, 'z', 1, 0.008, TRIM)
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
    CARB, TRIM, PAINT = 0, 1, 2
    span = 1.0
    # rear wing: wide main plane in body colour, a slim gurney flap, black endplates
    main = airfoil(0.36, (1.90, 1.205), 6, thick=1.1)
    flap = airfoil(0.10, (2.24, 1.245), 24)
    B.extrude(main, 'x', -span, span, PAINT)
    B.extrude(flap, 'x', -span + 0.01, span - 0.01, CARB)
    ep = [(1.89, 1.17), (2.27, 1.19), (2.30, 1.31), (2.16, 1.32), (1.92, 1.26)]
    for s in (1, -1):
        B.extrude(ep, 'x', s * span, s * (span + 0.014), CARB)
    # two upright plates from the engine lid to the wing, with lightening holes
    for s in (1, -1):
        x0 = s * 0.60
        plate = [(1.80, 0.85), (1.93, 0.82), (2.13, 1.195), (2.02, 1.205)]   # slim strut, leaning back
        B.extrude(ccw(plate), 'x', x0 - 0.009, x0 + 0.009, CARB)
    # front splitter: wide black lip that follows the bumper in plan
    half = [(0.0, -2.245), (0.30, -2.235), (0.56, -2.19), (0.74, -2.11), (0.84, -2.00), (0.87, -1.88), (0.80, -1.86)]
    outline = half + [(-x, y) for (x, y) in reversed(half)]
    B.extrude(ccw(outline), 'z', 0.085, 0.11, CARB)
    # rear diffuser strakes
    for x in (-0.38, -0.20, 0.20, 0.38):
        B.box((x, 2.06, 0.23), (0.012, 0.20, 0.06), CARB)
    # side skirt blades
    for s in (1, -1):
        B.box((s * 0.875, -0.02, 0.135), (0.045, 1.62, 0.04), CARB)
    ob = B.obj("GT3RS_Aero", coll, [M['carbon'], M['trim'], M['paint']], smooth=30)
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
        vs = [tuple(R @ Vector(v) + Vector((x, 2.19, 0.34))) for v in sub.verts]
        B.add(vs, sub.faces, MET)
        # dark inner disc
        inner = [(x + 0.045 * math.cos(2 * math.pi * k / 14), 2.28, 0.34 + 0.045 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
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
        sc = Vector((0.10, 0.085, 0.052))
        c = Vector((s * 0.995, -0.44, 1.01))
        vs = [tuple(c + Vector((v[0] * sc.x, v[1] * sc.y * (1.0 if v[1] < 0 else 0.55), v[2] * sc.z))) for v in vs]
        B.add(vs, fs, PAINT, 'c')
        # mirror glass on the rear face
        mg = [(s * 0.995 + 0.085 * math.cos(2 * math.pi * k / 12), -0.39, 1.01 + 0.042 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
        B.add(mg, [list(range(12))[::-1]], MET)
        # stalk
        B.box((s * 0.875, -0.46, 0.965), (0.16, 0.05, 0.03), TRIM, rot=Matrix.Rotation(math.radians(s * 12), 3, 'Y').to_quaternion())
    for s in (1, -1):
        y0, y1 = 0.50, 0.58
        pts = []
        for i in range(7):
            u = i / 6
            y = y0 + (y1 - y0) * u
            z = FZ[8](y) + (FZ[9](y) - FZ[8](y)) * u
            x = FX[8](y) + (FX[9](y) - FX[8](y)) * u
            pts.append((s * (x + 0.006), y, z))
        B.tube(pts, 0.022, TRIM, sides=6)
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
    nsp = 5
    for k in range(nsp):
        a = 2 * math.pi * (k + 0.5) / nsp
        for off in (-0.11, 0.11):
            a0 = a + off
            r0, r1 = 0.075, RIM - 0.016
            w0, w1 = 0.011, 0.012
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
# race livery: number roundels, sponsor panels and centre stripes, draped over the body and glass
RACE_NUMBER = "27"
SPONSORS = [("APEX OIL", (0.02, 0.02, 0.025), (1.0, 0.78, 0.0)), ("ZENITH", (0.95, 0.95, 0.93), (0.05, 0.1, 0.35)), ("VELOCITY", (0.04, 0.12, 0.45), (1.0, 1.0, 1.0))]


def text_tris(txt, size, bold_x=1.0):
    """2D triangles of a string in Blender's default font, centred on the origin: ([(x, y)], [[i, j, k]])."""
    cu = bpy.data.curves.new("livery_text", 'FONT')
    cu.body = txt
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.fill_mode = 'BOTH'
    ob = bpy.data.objects.new("livery_text", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    verts = [(v.co.x * bold_x, v.co.y) for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return verts, faces


def build_livery(body, glass, coll, M):
    # one projector over body + glass so decals can cross the windows
    P = Projector(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.from_mesh(glass.data)
    P.bvh = BVHTree.FromBMesh(bm)
    bm.free()
    white = mat("GT3_DecalWhite", (0.92, 0.92, 0.9), 0.4)
    black = mat("GT3_DecalBlack", (0.02, 0.02, 0.022), 0.45)
    yellow = mat("GT3_DecalYellow", (1.0, 0.72, 0.0), 0.4)
    navy = mat("GT3_DecalNavy", (0.03, 0.08, 0.32), 0.4)
    mats = [white, black, yellow, navy]
    WHITE, BLACK, YELLOW, NAVY = range(4)
    D = DecalBuilder(P)

    def txt(text, size, cu, cv, axis, sign, mi, off, flipu=False, flipv=False, rot=0.0, bold=1.0, mirror=False):
        vs, fs = text_tris(text, size, bold)
        ca, sa = math.cos(rot), math.sin(rot)
        uv = []
        for (x, y) in vs:
            x, y = x * ca - y * sa, x * sa + y * ca
            uv.append((cu + (-x if flipu else x), cv + (-y if flipv else y)))
        D.add(uv, fs, axis, sign, off, mi, mirror=mirror)

    def rect(u0, u1, v0, v1, nu, nv, axis, sign, mi, off, flipu=False):
        top = [((u1 - (u1 - u0) * i / nu) if flipu else (u0 + (u1 - u0) * i / nu), v1) for i in range(nu + 1)]
        bot = [(u, v0) for (u, _) in top]
        uv, fc = strip_grid(top, bot, rows=nv)
        D.add(uv, fc, axis, sign, off, mi)

    def disc(cu, cv, r, axis, sign, mi, off, n=22, rings=3):
        uv, fc = ellipse_grid(cu, cv, r, r, n=n, rings=rings)
        D.add(uv, fc, axis, sign, off, mi)

    # --- door roundels with the race number (both sides; text reads front to back on each side)
    for sign in (1, -1):
        flip = sign < 0                        # on the right-hand side +y runs the other way round for the viewer
        disc(-0.02, 0.60, 0.165, 'x', sign, WHITE, 0.003)
        txt(RACE_NUMBER, 0.20, -0.02, 0.60, 'x', sign, BLACK, 0.007, flipu=flip, bold=1.15)
    # --- bonnet roundel (read from the front of the car) and a number on the roof
    disc(0.0, -1.50, 0.20, 'z', 1, WHITE, 0.003, n=24, rings=3)
    txt(RACE_NUMBER, 0.25, 0.0, -1.50, 'z', 1, BLACK, 0.007, bold=1.15)
    # --- windscreen banner (reads from the front)
    rect(-0.60, 0.60, 1.115, 1.175, 24, 2, 'y', -1, BLACK, 0.004)
    txt("PORSCHE-STYLE RACING".replace("PORSCHE-STYLE", "APEX"), 0.052, 0.0, 1.145, 'y', -1, YELLOW, 0.008)
    # --- sponsor bands along the sills and across the rear quarters
    for sign in (1, -1):
        flip = sign < 0
        # lower door band with the main sponsor
        rect(-0.46, 0.46, 0.305, 0.385, 30, 2, 'x', sign, BLACK, 0.003, flipu=flip)
        txt("APEX OIL", 0.062, 0.0, 0.345, 'x', sign, YELLOW, 0.007, flipu=flip)
        # front wing: small sponsor panel above the wheel arch
        rect(-1.82, -1.30, 0.66, 0.73, 14, 2, 'x', sign, NAVY, 0.003, flipu=flip)
        txt("ZENITH", 0.050, -1.56, 0.695, 'x', sign, WHITE, 0.007, flipu=flip)
        # rear quarter band behind the rear wheel
        rect(1.62, 2.05, 0.545, 0.605, 14, 2, 'x', sign, NAVY, 0.003, flipu=flip)
        txt("VELOCITY", 0.042, 1.835, 0.575, 'x', sign, WHITE, 0.007, flipu=flip)
    # --- twin centre stripes over the bonnet, roof and engine lid
    for (y0, y1) in ((-2.06, -1.78), (-1.22, -0.95), (-0.18, 0.74), (1.42, 2.12)):
        n = int((y1 - y0) / 0.05)
        for x0 in (-0.115, 0.075):
            top = [(x0 + 0.04, y0 + (y1 - y0) * i / n) for i in range(n + 1)]
            bot = [(x0, y) for (_, y) in top]
            uv, fc = strip_grid(top, bot, rows=1)
            D.add(uv, fc, 'z', 1, 0.003, BLACK)
    return D.build("GT3RS_Livery", coll, mats, smooth=40)


# --------------------------------------------------------------------------
def build():
    coll = get_coll(COLL)
    M = make_mats()
    M['cut_arch'] = mat("CUT_arch", (0.01, 0.01, 0.01), 0.9)
    M['cut_win'] = mat("CUT_win", (1, 0, 1), 0.5)
    M['cut_pocket'] = mat("CUT_pocket", (0.5, 0.5, 0.0), 0.5)
    M['cut_plate'] = mat("CUT_plate", (0.5, 0.0, 0.5), 0.5)

    body = build_body(coll, M)

    # wheel arches -> wheel wells (cutter faces become the well liners)
    for c in wheel_arch_cutters(coll, M):
        apply_boolean(body, c, 'DIFFERENCE')
        bpy.data.objects.remove(c, do_unlink=True)
    remap_mat(body, "CUT_arch", M['well'])

    # real recesses in the bumpers (outline = x, z; cut along y down to a floor plane)
    def mirror_pts(pts):
        return [(-x, z) for (x, z) in reversed(pts)]
    pockets = []
    # front: wide centre intake and the two big side intakes under the light units
    pockets.append(prism("CUT_pocket", ccw([(-0.41, 0.178), (0.41, 0.178), (0.40, 0.335), (-0.40, 0.335)]), 'y', -2.6, -2.00, coll, M['cut_pocket']))
    side = [(0.47, 0.185), (0.755, 0.205), (0.775, 0.400), (0.47, 0.385)]
    pockets.append(prism("CUT_pocket", ccw(side), 'y', -2.6, -1.97, coll, M['cut_pocket']))
    pockets.append(prism("CUT_pocket", ccw(mirror_pts(side)), 'y', -2.6, -1.97, coll, M['cut_pocket']))
    # rear: two large corner cut-outs below the tail lights, a shallow plate recess
    rear = [(0.36, 0.335), (0.62, 0.345), (0.62, 0.50), (0.36, 0.505)]
    pockets.append(prism("CUT_pocket", ccw(rear), 'y', 1.96, 2.6, coll, M['cut_pocket']))
    pockets.append(prism("CUT_pocket", ccw(mirror_pts(rear)), 'y', 1.96, 2.6, coll, M['cut_pocket']))
    plate = [(-0.31, 0.525), (0.31, 0.525), (0.25, 0.375), (-0.25, 0.375)]
    pockets.append(prism("CUT_plate", ccw(plate), 'y', 2.235, 2.6, coll, M['cut_plate']))
    for c in pockets:
        apply_boolean(body, c, 'DIFFERENCE')
        bpy.data.objects.remove(c, do_unlink=True)
    remap_mat(body, "CUT_pocket", M['grille'])
    remap_mat(body, "CUT_plate", M['shade'])

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
    livery = build_livery(body, glass, coll, M)
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

    for m in ("CUT_arch", "CUT_win", "CUT_pocket", "CUT_plate"):
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
