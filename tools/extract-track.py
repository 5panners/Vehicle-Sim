#!/usr/bin/env python3
"""
Extract a race-circuit centreline from a layout diagram (PNG) where the track is
drawn as a single coloured line on a light background (e.g. racingcircuits.info
maps). No third-party libraries needed.

  python3 tools/extract-track.py config.json

config.json:
{
  "image": "path/to/layout.png",
  "color": "red",                 # red | blue | black  (track line colour)
  "start": [132, 300],            # a pixel on the track, anywhere
  "direction": [0, -1],           # racing direction at that pixel (image coords, y down)
  "startLine": [130, 212],        # pixel of the start/finish line (becomes index 0)
  "lengthMetres": 3908,           # official lap length, used for scale
  "bearingDeg": 56,               # rotate image-up to true north by this many degrees clockwise
  "anchors": { "Paddock Hill Bend": [160, 100], ... },   # named corner pixels
  "out": "src/world/maps/my-track.js",
  "spacingMetres": 8,
  "smoothIterations": 60,   # straights/fast curves smoothed, tight corners kept
  "cornerTurnDeg": 22,
  "fair": [[440, 14]]       # optional: output-index stretches (wrapping) to replace with the
                            # smoothest curve joining their ends (diagram arrows/flags distort them)
}

Output (ES module): CENTERLINE [[x, z], ...] in metres (world frame: +Z = north,
+X = west, so the driver's right is -X), closed loop, evenly spaced; ANCHORS
{name: index}; LENGTH.
"""
import json, math, sys, zlib, struct
from collections import defaultdict


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat = 8, b''
    while pos < len(data):
        ln, = struct.unpack('>I', data[pos:pos + 4]); typ = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + ln]; pos += 12 + ln
        if typ == b'IHDR': W, H, bd, ct, _, _, il = struct.unpack('>IIBBBBB', body); assert bd == 8 and il == 0, '8-bit non-interlaced only'
        elif typ == b'IDAT': idat += body
        elif typ == b'IEND': break
    bpp = {2: 3, 6: 4}[ct]; raw = zlib.decompress(idat); stride = W * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(H):
        f = raw[i]; i += 1; line = bytearray(raw[i:i + stride]); i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([tuple(line[x * bpp:x * bpp + 3]) for x in range(W)]); prev = line
    return W, H, rows


MATCH = {
    'red': lambda r, g, b: r > 170 and g < 80 and b < 80,
    'blue': lambda r, g, b: b > 170 and r < 80 and g < 120,
    'black': lambda r, g, b: r < 60 and g < 60 and b < 60,
    'grey': lambda r, g, b: abs(r - g) < 14 and abs(g - b) < 14 and 92 <= r <= 134,   # mid-grey line (e.g. the F1 circuit maps)
}


def main(cfg):
    W, H, rows = read_png(cfg['image'])
    match = MATCH[cfg.get('color', 'red')]
    px = [(x, y) for y in range(H) for x in range(W) if match(*rows[y][x])]
    B = defaultdict(list)
    for x, y in px: B[(x // 8, y // 8)].append((x, y))

    def near(p, r):
        cx, cy, k = int(p[0]) // 8, int(p[1]) // 8, int(r // 8) + 2
        return [q for i in range(cx - k, cx + k + 1) for j in range(cy - k, cy + k + 1) for q in B[(i, j)]
                if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= r * r]

    def centre(p, r):
        q = near(p, r)
        return (sum(a for a, _ in q) / len(q), sum(b for _, b in q) / len(q)) if q else p

    # --- walk the line: step forward, re-centre, bridge short gaps (flags/arrows)
    p = centre(tuple(cfg['start']), 5); d = tuple(cfg['direction']); n = math.hypot(*d); d = (d[0] / n, d[1] / n)
    path = [p]
    for step in range(4000):
        cand = [q for q in near(p, 7) if 4.5 <= math.hypot(q[0] - p[0], q[1] - p[1])
                and ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / math.hypot(q[0] - p[0], q[1] - p[1]) > math.cos(math.radians(55))]
        if not cand:
            for R in (10, 13, 16, 20):
                cand = [q for q in near(p, R) if math.hypot(q[0] - p[0], q[1] - p[1]) > R - 4
                        and ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / math.hypot(q[0] - p[0], q[1] - p[1]) > math.cos(math.radians(25))]
                if cand: break
        if not cand:       # a sharp corner under a label: accept wide turns, just not a U-turn
            for R in (8, 10, 13):
                cand = [q for q in near(p, R) if math.hypot(q[0] - p[0], q[1] - p[1]) > R - 3.5
                        and ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / math.hypot(q[0] - p[0], q[1] - p[1]) > math.cos(math.radians(100))]
                if cand: break
        if not cand: sys.exit(f'lost the line at step {step}, pixel {p}')
        nx = sum(a for a, _ in cand) / len(cand); ny = sum(b for _, b in cand) / len(cand)
        q = centre((nx, ny), 3.5); L = math.hypot(q[0] - p[0], q[1] - p[1]) or 1
        d = (0.6 * d[0] + 0.4 * (q[0] - p[0]) / L, 0.6 * d[1] + 0.4 * (q[1] - p[1]) / L); m = math.hypot(*d); d = (d[0] / m, d[1] / m)
        p = q; path.append(p)
        if step > 150 and math.hypot(p[0] - path[0][0], p[1] - path[0][1]) < 8: break
    else:
        sys.exit('did not close the loop')
    # trim to the closest return to the start
    k = min(range(len(path) - 12, len(path)), key=lambda i: math.hypot(path[i][0] - path[0][0], path[i][1] - path[0][1]))
    lap = path[:k]

    # --- light smoothing (binomial, wrap-around) removes pixel noise but keeps hairpins
    for _ in range(2):
        lap = [((lap[i - 1][0] + 2 * lap[i][0] + lap[(i + 1) % len(lap)][0]) / 4, (lap[i - 1][1] + 2 * lap[i][1] + lap[(i + 1) % len(lap)][1]) / 4) for i in range(len(lap))]

    # --- start index at the start/finish line
    sl = cfg['startLine']; s0 = min(range(len(lap)), key=lambda i: (lap[i][0] - sl[0]) ** 2 + (lap[i][1] - sl[1]) ** 2)
    lap = lap[s0:] + lap[:s0]

    # --- optional debug overlay: the traced pixel path over the diagram, start line in blue
    if cfg.get('debugImage'):
        import os; sys.path.insert(0, os.path.dirname(__file__)); from lib_png import write_png, crop_zoom
        k = cfg.get('debugZoom', 2); img = [list(r) for r in crop_zoom(rows, 0, 0, W, H, k)]
        for i, (x, y) in enumerate(lap):
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    yy, xx = int(y * k) + dy, int(x * k) + dx
                    if 0 <= yy < H * k and 0 <= xx < W * k: img[yy][xx] = (255, 0, 0) if i % 25 else (0, 0, 255)
        write_png(cfg['debugImage'], img)

    # --- scale + rotate to the world frame
    Lpx = sum(math.hypot(lap[(i + 1) % len(lap)][0] - lap[i][0], lap[(i + 1) % len(lap)][1] - lap[i][1]) for i in range(len(lap)))
    s = cfg['lengthMetres'] / Lpx; th = math.radians(cfg.get('bearingDeg', 0))

    def to_world(u, v):
        e, n_ = u * s, -v * s                                   # image -> east/north metres
        e2, n2 = e * math.cos(th) + n_ * math.sin(th), -e * math.sin(th) + n_ * math.cos(th)
        return (-e2, n2)                                        # world: +X = west, +Z = north
    pts = [to_world(*p) for p in lap]
    cx = (max(p[0] for p in pts) + min(p[0] for p in pts)) / 2; cz = (max(p[1] for p in pts) + min(p[1] for p in pts)) / 2
    pts = [(x - cx, z - cz) for x, z in pts]

    # --- resample evenly
    sp = cfg.get('spacingMetres', 8)
    out, acc = [pts[0]], 0.0
    for i in range(1, len(pts) + 1):
        a, b = pts[i - 1], pts[i % len(pts)]; seg = math.hypot(b[0] - a[0], b[1] - a[1]); t = 0
        while acc + seg - t >= sp:
            t += sp - acc; acc = 0
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
        acc += seg - t
    if math.hypot(out[-1][0] - out[0][0], out[-1][1] - out[0][1]) < sp * 0.5: out.pop()

    # --- curvature-adaptive Taubin smoothing: irons the pixel wobble out of straights and
    # fast curves while leaving tight corners (hairpins) essentially untouched; Taubin's
    # lambda/mu pair avoids the shrinkage plain Laplacian smoothing would cause.
    it, lam, mu = cfg.get('smoothIterations', 150), 0.5, -0.53
    n = len(out)
    win = cfg.get('cornerWindowPts', 8)                                    # judge 'cornerness' over +/-64 m
    def turn(i, k=win):
        a, b, c = out[(i - k) % n], out[i], out[(i + k) % n]
        a1 = math.atan2(b[1] - a[1], b[0] - a[0]); a2 = math.atan2(c[1] - b[1], c[0] - b[0])
        return abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi)
    t0 = math.radians(cfg.get('cornerTurnDeg', 45))                      # net turn over the window that counts as a corner
    weight = [max(0.02, 1 - turn(i) / t0) ** 2 for i in range(n)]
    weight = [(weight[i - 1] + weight[i] + weight[(i + 1) % n]) / 3 for i in range(n)]
    for _ in range(it):
        for f in ((lam,) if cfg.get('plainLaplacian', True) else (lam, mu)):
            out = [(p[0] + f * weight[i] * ((out[i - 1][0] + out[(i + 1) % n][0]) / 2 - p[0]),
                    p[1] + f * weight[i] * ((out[i - 1][1] + out[(i + 1) % n][1]) / 2 - p[1])) for i, p in enumerate(out)]
    # --- fair sections: [fromIdx, toIdx] (wrapping) stretches that the diagram distorts (arrows,
    # flags, labels touching the line). Replaced by the curve that minimises the change of
    # curvature (third differences) while holding 3 points at each end, so position, heading and
    # curvature all join smoothly. A tiny data weight keeps it from drifting in the middle.
    for a, b in cfg.get('fair', []):
        ids = [(a + k) % n for k in range(((b - a) % n) + 1)]
        m = len(ids); free = list(range(3, m - 3)); fi = {k: j for j, k in enumerate(free)}
        alpha = cfg.get('fairDataWeight', 1e-6)
        for c in (0, 1):
            d = [out[i][c] for i in ids]
            nF = len(free); A = [[0.0] * nF for _ in range(nF)]; rhs = [0.0] * nF
            for k in range(m - 3):                       # rows of the third-difference operator
                coef = {k: -1.0, k + 1: 3.0, k + 2: -3.0, k + 3: 1.0}
                const = sum(v * d[j] for j, v in coef.items() if j not in fi)
                for j1, v1 in coef.items():
                    if j1 not in fi: continue
                    rhs[fi[j1]] -= v1 * const
                    for j2, v2 in coef.items():
                        if j2 in fi: A[fi[j1]][fi[j2]] += v1 * v2
            for j in free: A[fi[j]][fi[j]] += alpha; rhs[fi[j]] += alpha * d[j]
            for col in range(nF):                         # Gaussian elimination (small, dense)
                piv = max(range(col, nF), key=lambda r: abs(A[r][col])); A[col], A[piv] = A[piv], A[col]; rhs[col], rhs[piv] = rhs[piv], rhs[col]
                for r in range(col + 1, nF):
                    f = A[r][col] / A[col][col]
                    if f:
                        for cc in range(col, nF): A[r][cc] -= f * A[col][cc]
                        rhs[r] -= f * rhs[col]
            sol = [0.0] * nF
            for r in range(nF - 1, -1, -1): sol[r] = (rhs[r] - sum(A[r][cc] * sol[cc] for cc in range(r + 1, nF))) / A[r][r]
            for j in free:
                i = ids[j]; out[i] = (sol[fi[j]], out[i][1]) if c == 0 else (out[i][0], sol[fi[j]])
    # --- optional minimum corner radius: the diagram's wobble can make a hairpin tighter than the real one.
    # Where the local radius (3 points +/-15 m) is under minRadius, relax the points toward their neighbours.
    mr = cfg.get('minRadius')
    if mr:
        kk = 2
        def radius(i):
            a, b, c = out[(i - kk) % n], out[i], out[(i + kk) % n]
            ab = math.hypot(b[0] - a[0], b[1] - a[1]); bc = math.hypot(c[0] - b[0], c[1] - b[1]); ca = math.hypot(a[0] - c[0], a[1] - c[1])
            cr = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
            return ab * bc * ca / (2 * cr) if cr > 1e-9 else 1e9
        for it in range(600):
            tight = [i for i in range(n) if radius(i) < mr]
            if not tight: break
            mark = set((i + d) % n for i in tight for d in range(-3, 4))
            out = [((out[i - 1][0] + out[(i + 1) % n][0]) / 2 * 0.5 + out[i][0] * 0.5, (out[i - 1][1] + out[(i + 1) % n][1]) / 2 * 0.5 + out[i][1] * 0.5) if i in mark else out[i] for i in range(n)]
        print('min radius now %.1f m after %d relaxations' % (min(radius(i) for i in range(n)), it))
    # rescale so the lap is exactly the official length again
    Lnow = sum(math.hypot(out[(i + 1) % n][0] - out[i][0], out[(i + 1) % n][1] - out[i][1]) for i in range(n))
    k = cfg['lengthMetres'] / Lnow
    out = [(x * k, z * k) for x, z in out]

    anchors = {}
    for name, (u, v) in cfg.get('anchors', {}).items():
        x, z = to_world(u, v); x = (x - cx) * k; z = (z - cz) * k
        anchors[name] = min(range(len(out)), key=lambda i: (out[i][0] - x) ** 2 + (out[i][1] - z) ** 2)

    with open(cfg['out'], 'w') as f:
        f.write(f"// Generated by tools/extract-track.py from {cfg['image'].split('/')[-1]} - do not edit by hand.\n")
        f.write(f"// Scale {s:.4f} m/px, rotated {cfg.get('bearingDeg', 0)} deg to true north. {len(out)} points at ~{sp} m.\n")
        f.write(f"export const LENGTH = {cfg['lengthMetres']};\n")
        f.write('export const ANCHORS = ' + json.dumps(anchors) + ';\n')
        # pixel -> world: e = u*s, n = -v*s, rotate by th, x = -e', z = n', then centre (cx, cz) and scale k
        f.write('export const TRANSFORM = ' + json.dumps({'s': round(s, 6), 'thDeg': cfg.get('bearingDeg', 0), 'cx': round(cx, 4), 'cz': round(cz, 4), 'k': round(k, 6), 'imgW': W, 'imgH': H}) + ';\n')
        f.write('export const CENTERLINE = [\n' + ',\n'.join(f'  [{x:.1f}, {z:.1f}]' for x, z in out) + ',\n];\n')
    print(f'{len(out)} points, scale {s:.3f} m/px, anchors {anchors}')


if __name__ == '__main__':
    main(json.load(open(sys.argv[1])))
