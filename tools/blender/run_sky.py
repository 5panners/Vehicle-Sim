import sys, traceback, os, bpy
D = "/Users/paul/Documents/Game Design/Vehicle Sim/tools/blender/"
views = os.environ.get("VIEWS", "front34,rear34,side,top").split(",")
export = os.environ.get("EXPORT") == "1"
try:
    g = {"__file__": D + "build_skyline.py", "__name__": "sky"}
    exec(compile(open(D + "build_skyline.py").read(), D + "build_skyline.py", 'exec'), g)
    print("TRIS", g["result"]["TOTAL_TRIS"], {k: v for k, v in g["result"].items() if v > 1500})
    if views and views != [""]:
        g2 = {"__file__": D + "render_skyline.py", "OUT_DIR": "/tmp/sky_previews", "VIEWS": views, "RES": (1280, 720)}
        exec(compile(open(D + "render_skyline.py").read(), D + "render_skyline.py", 'exec'), g2)
    if export:
        out = "/Users/paul/Documents/Game Design/Vehicle Sim/assets/models/skyline.glb"
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.data.collections["SKY"].objects: o.select_set(True)
        bpy.context.view_layer.objects.active = bpy.data.objects["SKY_Body"]
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_materials='EXPORT')
        bpy.ops.wm.save_as_mainfile(filepath="/Users/paul/Documents/Game Design/Vehicle Sim/assets/models/skyline.blend")
        print("EXPORTED", os.path.getsize(out))
except Exception:
    traceback.print_exc()
