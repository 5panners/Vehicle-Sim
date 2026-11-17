# Blender finishing pass for the Mini:  node tools/build-mini.mjs --kit, then run this in Blender
# (exec(open(path).read())). Imports the measured body shell + parts, cuts the window openings
# with an exact boolean, adds fine chrome window beads, recessed glass and the boot-lid shut line,
# then exports assets/models/mini.glb (< 20k triangles) and saves tools/blender/mini.blend.
import bpy, bmesh, json, math, os
from mathutils import Vector

BASE = globals().get('BASE') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # project root
HERE = os.path.join(BASE, 'tools', 'blender')
KIT_GLB = os.path.join(HERE, 'mini_kit.glb')
KIT_JSON = os.path.join(HERE, 'mini_kit.json')
OUT_GLB = os.path.join(BASE, 'assets', 'models', 'mini.glb')
OUT_BLEND = os.path.join(HERE, 'mini.blend')
BUDGET = 20000

tri_count = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
g2b = lambda v: Vector((v[0], -v[2], v[1]))           # glTF (Y up, +Z forward) -> Blender (Z up)

# ---------------------------------------------------------------- fresh collection
coll = bpy.data.collections.get('MINI')
if coll:
    for o in list(coll.objects): bpy.data.objects.remove(o, do_unlink=True)
    for pool in (bpy.data.meshes, bpy.data.materials):             # drop this script's leftovers only
        for d in [d for d in pool if d.users == 0 and (d.name.startswith('MINI_') or d.name.startswith('INNER'))]: pool.remove(d)
else:
    coll = bpy.data.collections.new('MINI'); bpy.context.scene.collection.children.link(coll)
lc = bpy.context.view_layer.layer_collection.children['MINI']
bpy.context.view_layer.active_layer_collection = lc

bpy.ops.object.select_all(action='DESELECT')
bpy.ops.import_scene.gltf(filepath=KIT_GLB)
imported = list(bpy.context.selected_objects)
for o in imported:
    for c in list(o.users_collection):
        if c != coll: c.objects.unlink(o)
    if o.name not in coll.objects: coll.objects.link(o)
O = {o.name.split('.')[0]: o for o in imported}
data = json.load(open(KIT_JSON))
def mat(n):
    m = bpy.data.materials.get(n) or next((m for m in bpy.data.materials if m.name.startswith(n + '.')), None)
    if m: return m
    m = bpy.data.materials.new(n); m.use_nodes = True                     # glass is not in the kit: make it here
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.35, 0.45, 0.45, 1); bsdf.inputs['Roughness'].default_value = 0.05
    bsdf.inputs['Alpha'].default_value = 0.3; m.surface_render_method = 'BLENDED'; m.use_backface_culling = False
    return m

def apply_transforms(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

shell = O['MINI_Shell']; apply_transforms(shell)
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(shell.data); bm.free()

def ring_frame(pts, nrm):
    """outward (in-surface) direction at each outline point"""
    n = len(pts); c = sum(pts, Vector()) / n; out = []
    for i in range(n):
        t = pts[(i + 1) % n] - pts[i - 1]
        d = t.cross(nrm[i]).normalized()
        if d.dot(pts[i] - c) < 0: d = -d
        out.append(d)
    return out

def mesh_obj(name, verts, faces, material):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

# ---------------------------------------------------------------- window openings: one exact boolean
cv, cf = [], []
for w in data['windows']:
    P = [g2b(p) for p in w['outline']]; N = [g2b(n).normalized() for n in w['normals']]; n = len(P)
    base = len(cv)
    cv += [p + q * 0.035 for p, q in zip(P, N)] + [p - q * 0.035 for p, q in zip(P, N)]
    cf += [[base + i, base + (i + 1) % n, base + n + (i + 1) % n, base + n + i] for i in range(n)]
    cf += [list(range(base, base + n)), list(reversed(range(base + n, base + 2 * n)))]
cutter = mesh_obj('MINI_WindowCutter', cv, cf, mat('MINI_Seam'))              # the aperture walls stay dark
bm = bmesh.new(); bm.from_mesh(cutter.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(cutter.data); bm.free()
# the shell is a single surface, which a boolean reads as a solid: give it a 4 mm skin, cut, then drop the inner skin
inner = bpy.data.materials.new('INNER'); shell.data.materials.append(inner); k_in = len(shell.data.materials) - 1
sol = shell.modifiers.new('skin', 'SOLIDIFY'); sol.thickness = 0.004; sol.offset = -1; sol.use_even_offset = True
sol.material_offset = k_in; sol.material_offset_rim = k_in
mod = shell.modifiers.new('windows', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
mod.use_hole_tolerant = True
bpy.context.view_layer.objects.active = shell
bpy.ops.object.modifier_apply(modifier='skin'); bpy.ops.object.modifier_apply(modifier='windows')
bpy.data.objects.remove(cutter, do_unlink=True)
k_in = next(i for i, m in enumerate(shell.data.materials) if m and m.name.startswith('INNER'))
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == k_in], context='FACES')
bm.to_mesh(shell.data); bm.free()
shell.data.materials.pop(index=k_in); bpy.data.materials.remove(inner)

# ---------------------------------------------------------------- fine chrome beads + recessed glass
chrome, glass, seam = mat('MINI_Chrome'), mat('MINI_Glass'), mat('MINI_Seam')
fv, ff, gv, gf = [], [], [], []
for w in data['windows']:
    P = [g2b(p) for p in w['outline']]; N = [g2b(q).normalized() for q in w['normals']]; D = ring_frame(P, N); n = len(P)
    G = [g2b(p) for p in w['glass']]
    rings = [[p + d * 0.0022 + q * 0.0018 for p, d, q in zip(P, D, N)],      # bead lip resting on the paint just outside the opening
             G]                                                              # rolls in to the recessed glass edge (~3 mm chrome)
    b = len(fv); fv += [v for r in rings for v in r]
    for r in range(1):
        ff += [[b + r * n + i, b + r * n + (i + 1) % n, b + (r + 1) * n + (i + 1) % n, b + (r + 1) * n + i] for i in range(n)]
    gb = len(gv); gv += G + [g2b(w['tip'])]
    gf += [[gb + i, gb + (i + 1) % n, gb + n] for i in range(n)]
frames = mesh_obj('MINI_WindowFrames', fv, ff, chrome)
glass_ob = mesh_obj('MINI_Glazing', gv, gf, glass)

# boot-lid aperture: a dark shut-line groove that follows the curved tail
B = [g2b(p) for p in data['boot']['pts']]; BN = [g2b(q).normalized() for q in data['boot']['normals']]; BD = ring_frame(B, BN); n = len(B)
bv = [p + d * 0.0028 + q * 0.0012 for p, d, q in zip(B, BD, BN)] + [p - d * 0.0028 + q * 0.0012 for p, d, q in zip(B, BD, BN)]
boot = mesh_obj('MINI_BootShut', bv, [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], seam)

# ---------------------------------------------------------------- shading, join, budget
body = O['MINI_Body']; apply_transforms(body)
for o in (shell, frames, glass_ob, boot):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
# the cut leaves sliver triangles round the openings: area-weighted normals keep them from denting the shading
wn = shell.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.mode = 'FACE_AREA'; wn.keep_sharp = True; wn.weight = 100
bpy.context.view_layer.objects.active = shell; bpy.ops.object.modifier_apply(modifier='wn')
for o in (frames, glass_ob, boot):
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()

parts = {o.name: tri_count(o) for o in (shell, frames, glass_ob, boot, body)}
bpy.ops.object.select_all(action='DESELECT')
for o in (shell, frames, glass_ob, boot, body): o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = 'MINI_Body'
for mod in [m for m in body.modifiers]: body.modifiers.remove(mod)

wheels = [o for o in coll.objects if o.name.startswith('MINI_Wheel_')]
total = tri_count(body) + sum(tri_count(w) for w in wheels)
ratio = None
if total >= BUDGET:                                     # last resort: light collapse (shows as shading smudges)
    ratio = (tri_count(body) - (total - BUDGET + 120)) / tri_count(body)
    d = body.modifiers.new('trim', 'DECIMATE'); d.ratio = ratio; d.use_symmetry = True; d.symmetry_axis = 'X'
    bpy.context.view_layer.objects.active = body; bpy.ops.object.modifier_apply(modifier='trim')
    total = tri_count(body) + sum(tri_count(w) for w in wheels)

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
for o in [body] + wheels: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_texcoords=False, export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
result = {'parts': parts, 'body_tris': tri_count(body), 'wheel_tris': [tri_count(w) for w in wheels], 'total': total, 'body_decimate': ratio,
          'objects': [o.name for o in coll.objects]}
