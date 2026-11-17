#!/usr/bin/env python3
"""
Spa-Francorchamps centreline from the traced GPS route (tools/trace-gps-route.py output).

  python3 tools/build-spa-track.py tools/reference/spa-build.json

The screenshot of the GPS route is cropped at the bottom, so the route leaves the picture near Les Combes
and comes back in on the Pouhon approach, a gap of about 0.6 km (Malmedy and the Rivage/Bruxelles hairpin).
That gap is bridged with a cubic Hermite curve that leaves and re-enters along the route's own headings,
its length chosen so the closed lap is exactly the official length. Everything else is the real route.

Output: an ES module with CENTERLINE [[x, z]] in metres (world frame: +Z north, +X west), LENGTH, the
indices where the bridge starts and ends, and the pixel->world transform used (for the map-mask extractor).
"""
import json, math, sys


def length(path):
    return sum(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) for i in range(len(path) - 1))


def resample(path, step, closed=False):
    pts = path + ([path[0]] if closed else [])
    out, acc = [pts[0]], 0.0
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]; seg = math.hypot(b[0] - a[0], b[1] - a[1]); t = 0.0
        while acc + seg - t >= step and seg > 0:
            t += step - acc; acc = 0.0
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
        acc += seg - t
    return out


def smooth_open(path, passes):
    for _ in range(passes):
        path = [path[0]] + [((path[i - 1][0] + 2 * path[i][0] + path[i + 1][0]) / 4, (path[i - 1][1] + 2 * path[i][1] + path[i + 1][1]) / 4) for i in range(1, len(path) - 1)] + [path[-1]]
    return path


def heading(path, i, k=4):
    a, b = path[max(0, i - k)], path[min(len(path) - 1, i + k)]
    l = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    return ((b[0] - a[0]) / l, (b[1] - a[1]) / l)


def hermite(p0, t0, p1, t1, m, n=60):
    out = []
    for i in range(n + 1):
        s = i / n; h00, h10, h01, h11 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s, -2 * s**3 + 3 * s**2, s**3 - s**2
        out.append((h00 * p0[0] + h10 * m * t0[0] + h01 * p1[0] + h11 * m * t1[0], h00 * p0[1] + h10 * m * t0[1] + h01 * p1[1] + h11 * m * t1[1]))
    return out


def min_radius(path, k=2):
    n = len(path); best = 1e9
    for i in range(k, n - k):
        a, b, c = path[i - k], path[i], path[i + k]
        ab = math.hypot(b[0] - a[0], b[1] - a[1]); bc = math.hypot(c[0] - b[0], c[1] - b[1]); ca = math.hypot(a[0] - c[0], a[1] - c[1])
        cr = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        if cr > 1e-9: best = min(best, ab * bc * ca / (2 * cr))
    return best


def main(cfg):
    d = json.load(open(cfg['route']))
    P = [tuple(p) for p in d['route']]; i_flag = d['iFlag']
    k = cfg.get('pxPerM') or d['pxPerKm'] / 1000.0
    lap = cfg['lapMetres']
    # even spacing in pixels, light smoothing to remove the wobble of the walked centre (keeps the hairpins)
    step_px = 2.0
    R = resample(P, step_px); i_flag_r = min(range(len(R)), key=lambda i: (R[i][0] - P[i_flag][0]) ** 2 + (R[i][1] - P[i_flag][1]) ** 2)
    R = smooth_open(R, cfg.get('smoothPasses', 5))
    vis_m = length(R) / k
    print('visible route %.0f m (scale %.4f px/m = %.2f m/px), start-finish at point %d of %d' % (vis_m, k, 1 / k, i_flag_r, len(R)))
    # lap order from the start line: [flag ... A_end] + bridge + [B_start ... flag]
    A = R[i_flag_r:]; B = R[:i_flag_r + 1]
    a_end, b_start = A[-1], B[0]
    ta, tb = heading(A, len(A) - 1, 6), heading(B, 0, 6)
    gap_m = lap - vis_m
    print('bridge: from (%.0f, %.0f) heading (%.2f, %.2f) to (%.0f, %.0f) heading (%.2f, %.2f), chord %.0f m, target length %.0f m'
          % (a_end[0], a_end[1], ta[0], ta[1], b_start[0], b_start[1], tb[0], tb[1], math.hypot(a_end[0] - b_start[0], a_end[1] - b_start[1]) / k, gap_m))
    lo, hi = 20.0, 900.0                                         # tangent magnitude (px); arc length grows with it
    for _ in range(60):
        mid = (lo + hi) / 2
        if length(hermite(a_end, ta, b_start, tb, mid)) / k < gap_m: lo = mid
        else: hi = mid
    bridge = hermite(a_end, ta, b_start, tb, (lo + hi) / 2, 120)
    print('bridge tangent %.0f px, length %.0f m, tightest bend radius %.1f m' % ((lo + hi) / 2, length(bridge) / k, min_radius(resample(bridge, 2.0), 3) / k))
    full = A + bridge[1:-1] + B                                   # closed lap, starting at the start/finish line
    bridge_start = len(A)
    # convert to world metres: east = x / k, north = -y / k; world X = -east, Z = north; centre the bounding box
    pts = [(-(x / k), -(y / k)) for x, y in full]
    cx = (max(p[0] for p in pts) + min(p[0] for p in pts)) / 2; cz = (max(p[1] for p in pts) + min(p[1] for p in pts)) / 2
    pts = [(x - cx, z - cz) for x, z in pts]
    sp = cfg.get('spacingMetres', 6)
    out = resample(pts, sp, closed=True)
    if math.hypot(out[-1][0] - out[0][0], out[-1][1] - out[0][1]) < sp * 0.5: out.pop()
    n = len(out)
    # light curvature-adaptive smoothing like the other circuits (keeps tight corners)
    def turn(i, w=6):
        a, b, c = out[(i - w) % n], out[i], out[(i + w) % n]
        a1 = math.atan2(b[1] - a[1], b[0] - a[0]); a2 = math.atan2(c[1] - b[1], c[0] - b[0]); return abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi)
    t0 = math.radians(cfg.get('cornerTurnDeg', 30))
    wgt = [max(0.05, 1 - turn(i) / t0) ** 2 for i in range(n)]
    for _ in range(cfg.get('smoothIterations', 40)):
        out = [(p[0] + 0.5 * wgt[i] * ((out[i - 1][0] + out[(i + 1) % n][0]) / 2 - p[0]), p[1] + 0.5 * wgt[i] * ((out[i - 1][1] + out[(i + 1) % n][1]) / 2 - p[1])) for i, p in enumerate(out)]
    # a corner the diagram/GPS makes tighter than the real one (a V where the line touches the picture edge): relax it
    mr = cfg.get('minRadius')
    if mr:
        def radius(i, kk=2):
            a, b, c = out[(i - kk) % n], out[i], out[(i + kk) % n]
            ab = math.hypot(b[0] - a[0], b[1] - a[1]); bc = math.hypot(c[0] - b[0], c[1] - b[1]); ca = math.hypot(a[0] - c[0], a[1] - c[1])
            cr = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
            return ab * bc * ca / (2 * cr) if cr > 1e-9 else 1e9
        for it in range(800):
            tight = [i for i in range(n) if radius(i) < mr]
            if not tight: break
            mark = set((i + dd) % n for i in tight for dd in range(-3, 4))
            out = [(out[(i - 1) % n][0] * 0.25 + out[(i + 1) % n][0] * 0.25 + out[i][0] * 0.5, out[(i - 1) % n][1] * 0.25 + out[(i + 1) % n][1] * 0.25 + out[i][1] * 0.5) if i in mark else out[i] for i in range(n)]
        print('minimum radius now %.1f m after %d relaxations' % (min(radius(i) for i in range(n)), it))
    Lnow = sum(math.hypot(out[(i + 1) % n][0] - out[i][0], out[(i + 1) % n][1] - out[i][1]) for i in range(n))
    sc = lap / Lnow; out = [(x * sc, z * sc) for x, z in out]
    r = min(math.hypot(0, 0) or 1e9, 1e9)
    print('final: %d points at ~%.1f m, lap %.0f m (smoothing scaled by %.4f), bbox %.0f x %.0f m, tightest radius %.1f m'
          % (n, lap / n, lap, sc, max(p[0] for p in out) - min(p[0] for p in out), max(p[1] for p in out) - min(p[1] for p in out), min_radius(out + out[:3], 2)))
    br0 = int(round(len(A) * 0 + (length(A) / k) * n / lap)); br1 = int(round(((length(A) + length(bridge)) / k) * n / lap))
    with open(cfg['out'], 'w') as f:
        f.write('// Generated by tools/build-spa-track.py from the traced GPS route screenshot - do not edit by hand.\n')
        f.write(f"// Visible route {vis_m:.0f} m at {1 / k:.3f} m/px; the cropped Les Combes-Rivage gap ({gap_m:.0f} m) is a bridged curve. {n} points at ~{lap / n:.1f} m.\n")
        f.write(f"export const LENGTH = {lap};\nexport const BRIDGE = [{br0}, {br1}];   // point indices of the bridged (not traced) stretch\n")
        f.write('export const TRANSFORM = ' + json.dumps({'pxPerM': round(k, 6), 'cx': round(cx, 3), 'cz': round(cz, 3), 'k': round(sc, 6), 'W': d['W'], 'H': d['H']}) + ';\n')
        f.write('export const CENTERLINE = [\n' + ',\n'.join(f'  [{x:.1f}, {z:.1f}]' for x, z in out) + ',\n];\n')


if __name__ == '__main__':
    main(json.load(open(sys.argv[1])))
