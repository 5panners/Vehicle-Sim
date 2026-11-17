"""Tiny PNG helpers (no third-party libraries): read via extract-track's reader, write RGB PNGs, crop+zoom."""
import importlib.util, struct, zlib, os
_spec = importlib.util.spec_from_file_location('ex', os.path.join(os.path.dirname(__file__), 'extract-track.py'))
_ex = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_ex)
read_png = _ex.read_png

def write_png(path, rows):
    H, W = len(rows), len(rows[0])
    raw = b''.join(b'\x00' + b''.join(bytes(p[:3]) for p in row) for row in rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

def crop_zoom(rows, x0, y0, x1, y1, k):
    out = []
    for y in range(y0, y1):
        row = []
        for x in range(x0, x1): row.extend([rows[y][x]] * k)
        out.extend([row] * k)
    return out
