#!/usr/bin/env python3
"""
Trace a GPS route (a coloured line on a north-up web map screenshot) into an ordered open polyline.

  python3 tools/trace-gps-route.py tools/reference/spa-route.json

For circuits where the layout diagram isn't to scale (Spa) but a map screenshot of the real GPS route is
available. The route is picked out by colour (saturated pixels; the grey/green base map is not), thin
speckle (dashed rivers, text) is removed by erosion, then the line is walked outwards from a start pixel
in both directions until it leaves the picture. The pixel scale comes from the distance markers drawn on
the map ("1 km", "2 km"...): arc length between the polyline points nearest each marker.

config:
{ "image": "...png", "start": [405, 115],          # a pixel on the route (the start/finish flag)
  "forward": [-0.3, -1],                           # direction of travel at that pixel (image coords, y down)
  "markers": [{ "km": 1, "px": [475, 128] }, ...], # markers measured from the start line, along the lap
  "ignore": [[x0, y0, x1, y1], ...],               # UI rectangles to blank (buttons, logos)
  "out": "route.json" }

Output JSON: forward / backward polylines in pixels (backward = against the lap direction), px per metre.
"""
import json, math, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib_png import read_png


def mask_from(rows, W, H, ignore, seed):
    """route = dark casing OR saturated core, never the pale base map (forest green, roads, water are all light:
    min(r,g,b) is high), then only the connected blob that contains the seed point (drops text and labels)."""
    m = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if any(a <= x <= c and b <= y <= d for a, b, c, d in ignore): continue
            r, g, b = rows[y][x]; mx = max(r, g, b); mn = min(r, g, b)
            if mx < 100 or (mx - mn > 55 and mn < 140): m[y][x] = True
    # connected component of the dilated mask (radius 2 bridges the gaps in the casing) containing the seed
    D = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if m[y][x]:
                for dy in range(max(0, y - 2), min(H, y + 3)):
                    row = D[dy]
                    for dx in range(max(0, x - 2), min(W, x + 3)): row[dx] = True
    sx, sy = seed
    comp = [[False] * W for _ in range(H)]
    st = [(sx, sy)]
    # the seed itself may sit on a gap: search a few pixels for a masked start
    for r in range(0, 8):
        hit = [(sx + dx, sy + dy) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if D[sy + dy][sx + dx]]
        if hit: st = [hit[0]]; break
    comp[st[0][1]][st[0][0]] = True
    while st:
        x, y = st.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H and D[yy][xx] and not comp[yy][xx]: comp[yy][xx] = True; st.append((xx, yy))
    return [[m[y][x] and comp[y][x] for x in range(W)] for y in range(H)]


def walk(px, p, d, max_steps=3000):
    B = {}
    for x, y in px: B.setdefault((x // 8, y // 8), []).append((x, y))

    def near(c, r):
        cx, cy, k = int(c[0]) // 8, int(c[1]) // 8, int(r // 8) + 2
        return [q for i in range(cx - k, cx + k + 1) for j in range(cy - k, cy + k + 1) for q in B.get((i, j), []) if (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 <= r * r]

    def centre(c, r):
        q = near(c, r)
        return (sum(a for a, _ in q) / len(q), sum(b for _, b in q) / len(q)) if q else c
    n = math.hypot(*d); d = (d[0] / n, d[1] / n); p = centre(p, 5); path = [p]
    for step in range(max_steps):
        cand = []
        for R, cone in ((8, 55), (11, 40), (14, 35), (18, 28), (24, 22)):
            cand = [q for q in near(p, R) if math.hypot(q[0] - p[0], q[1] - p[1]) > R - 4 and
                    ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / math.hypot(q[0] - p[0], q[1] - p[1]) > math.cos(math.radians(cone))]
            if cand: break
        if not cand: break
        nx = sum(a for a, _ in cand) / len(cand); ny = sum(b for _, b in cand) / len(cand)
        q = centre((nx, ny), 3.5); L = math.hypot(q[0] - p[0], q[1] - p[1]) or 1
        d = (0.6 * d[0] + 0.4 * (q[0] - p[0]) / L, 0.6 * d[1] + 0.4 * (q[1] - p[1]) / L); m = math.hypot(*d); d = (d[0] / m, d[1] / m)
        if math.hypot(q[0] - path[-1][0], q[1] - path[-1][1]) < 0.5: break
        p = q; path.append(p)
    return path


def length(path, i0=0, i1=None):
    i1 = len(path) - 1 if i1 is None else i1
    return sum(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) for i in range(i0, i1))


def main(cfg):
    W, H, rows = read_png(cfg['image'])
    m = mask_from(rows, W, H, cfg.get('ignore', []), tuple(cfg['start']))
    px = [(x, y) for y in range(H) for x in range(W) if m[y][x]]
    print('route pixels after erosion:', len(px))
    fwd = walk(px, tuple(cfg['start']), tuple(cfg['forward']))
    bwd = walk(px, tuple(cfg['start']), (-cfg['forward'][0], -cfg['forward'][1]))
    print('forward %d points (%.0f px), backward %d points (%.0f px)' % (len(fwd), length(fwd), len(bwd), length(bwd)))
    # one polyline in lap order: [... end of the lap ... start point ... start/finish line ... first part of the lap ...]
    P = list(reversed(bwd)) + fwd[1:]
    for leg in cfg.get('continue', []):                       # further legs, in lap order (after a hairpin that touches the picture edge, etc.)
        more = walk(px, tuple(leg['start']), tuple(leg['forward']))
        print('continued leg: %d points (%.0f px)' % (len(more), length(more)))
        P += more
    flag = cfg['flag']
    i_flag = min(range(len(P)), key=lambda k: (P[k][0] - flag[0]) ** 2 + (P[k][1] - flag[1]) ** 2)
    print('start/finish flag is %.1f px from the nearest route point (index %d of %d)' % (math.hypot(P[i_flag][0] - flag[0], P[i_flag][1] - flag[1]), i_flag, len(P)))
    lap_km = cfg['lapKm']
    # distance markers: km measured from the start line along the lap; before the flag = lap_km - km
    ks = []
    for mk in cfg['markers']:
        i = min(range(len(P)), key=lambda k: (P[k][0] - mk['px'][0]) ** 2 + (P[k][1] - mk['px'][1]) ** 2)
        off = math.hypot(P[i][0] - mk['px'][0], P[i][1] - mk['px'][1])
        arc = length(P, i_flag, i) if i >= i_flag else -length(P, i, i_flag)
        d_km = mk['km'] if mk['km'] <= cfg['forwardMaxKm'] else -(lap_km - mk['km'])
        ks.append(arc / d_km)
        print('marker %.0f km: %.1f px off the route, %.0f px from the flag -> %.1f px/km' % (mk['km'], off, arc, arc / d_km))
    k = sum(ks) / len(ks)
    print('overall: %.1f px/km -> %.2f m/px (markers agree to %.1f%%)' % (k, 1000 / k, 100 * (max(ks) - min(ks)) / k))
    print('visible route: %.2f km of the %.1f km lap' % (length(P) / k, lap_km))
    json.dump({'route': P, 'iFlag': i_flag, 'pxPerKm': k, 'W': W, 'H': H}, open(cfg['out'], 'w'))
    return


if __name__ == '__main__':
    main(json.load(open(sys.argv[1])))
