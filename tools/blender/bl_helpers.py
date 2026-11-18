"""Shared Blender helpers (copied from build_gt3rs_991.py): materials, meshes, Builder, text triangles."""
import bpy, bmesh, math, bisect
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

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


def mirror_builder(B, side):
    if side < 0:   # mirror for the right-hand (-X) side
        B.verts = [(-v[0], v[1], v[2]) for v in B.verts]
        B.faces = [f[::-1] for f in B.faces]



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


