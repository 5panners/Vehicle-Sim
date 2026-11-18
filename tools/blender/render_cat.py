"""Studio preview renders of the GT3RS collection (not part of the export).

Set OUT_DIR / VIEWS before exec, or use the defaults below.
"""
import bpy, math, os
from mathutils import Vector

OUT_DIR = globals().get("OUT_DIR", "/tmp/cat_previews")
VIEWS = globals().get("VIEWS", None)
RES = globals().get("RES", (1280, 720))
os.makedirs(OUT_DIR, exist_ok=True)

scene = bpy.context.scene
for _o in bpy.data.objects:
    if _o.name == 'Cube':
        _o.hide_render = True; _o.hide_viewport = True
pc = bpy.data.collections.get("CAT_Preview")
if pc is None:
    pc = bpy.data.collections.new("CAT_Preview")
    scene.collection.children.link(pc)
for o in list(pc.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# ground
me = bpy.data.meshes.get("PreviewGround") or bpy.data.meshes.new("PreviewGround")
me.clear_geometry()
s = 30
me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [[0, 1, 2, 3]])
gm = bpy.data.materials.get("PreviewGround") or bpy.data.materials.new("PreviewGround")
p = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
p.inputs["Base Color"].default_value = (0.78, 0.78, 0.79, 1)
p.inputs["Roughness"].default_value = 0.6
me.materials.clear()
me.materials.append(gm)
g = bpy.data.objects.new("PreviewGround", me)
pc.objects.link(g)

# lights
def light(name, kind, loc, energy, size=None, rot=None):
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, kind)
    ld.energy = energy
    if size and kind == 'AREA':
        ld.size = size
    if kind == 'SUN':
        ld.angle = math.radians(8)
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    if rot:
        o.rotation_euler = rot
    else:
        d = Vector((0, 0, 0.6)) - Vector(loc)
        o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    pc.objects.link(o)
    return o

light("PrevKey", 'AREA', (-3.5, -4.5, 5.0), 2500, size=4)
light("PrevFill", 'AREA', (4.5, 2.5, 3.5), 900, size=5)
light("PrevTop", 'AREA', (-3, 2, 6), 1200, size=6)
light("PrevSun", 'SUN', (0, 0, 10), 1.5, rot=(math.radians(35), 0, math.radians(40)))

world = scene.world or bpy.data.worlds.new("World")
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.82, 0.83, 0.84, 1)
bg.inputs[1].default_value = 0.55

cd = bpy.data.cameras.get("PreviewCam") or bpy.data.cameras.new("PreviewCam")
cam = bpy.data.objects.new("PreviewCam", cd)
pc.objects.link(cam)
scene.camera = cam

scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.exposure = -1.0
try:
    scene.view_settings.view_transform = 'AgX'
except Exception:
    pass

ALL = {
    "front34": ((-3.6, -4.6, 1.9), (0, -0.1, 0.45), 45),
    "rear34": ((3.9, 3.9, 2.0), (0, 0.2, 0.45), 45),
    "rear34b": ((-3.9, 3.9, 2.0), (0, 0.2, 0.45), 45),
    "side": ((7.5, 0.0, 0.5), (0, 0, 0.45), 40),
    "sideR": ((-7.5, 0.0, 0.5), (0, 0, 0.45), 40),
    "top": ((0, 0.0, 9), (0, 0, 0), 30),
    "rear": ((0, 5.5, 0.9), (0, 0, 0.5), 40),
    "front": ((0, -5.5, 0.9), (0, 0, 0.45), 40),
    "cabin": ((1.6, -1.2, 1.9), (0, 0.5, 0.5), 40),
}
views = VIEWS or list(ALL)
out = []
for name in views:
    loc, tgt, lens = ALL[name]
    cam.location = loc
    d = Vector(tgt) - Vector(loc)
    up = 'Y' if name != "top" else 'Y'
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if name == "top":
        cam.rotation_euler = (0, 0, math.radians(90))
    cd.lens = lens
    if name == "top":
        cd.type = 'ORTHO'
        cd.ortho_scale = 3.8
    else:
        cd.type = 'PERSP'
    path = os.path.join(OUT_DIR, name + ".png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    out.append(path)
result = {"files": out}
