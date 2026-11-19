// Procedural, tileable PBR-ish textures (color + bump + optional emissive), generated on canvas.
import * as THREE from 'three';
import { fbm, vnoise, hash2 } from './noise.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const fr = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;

function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

// fn(u,v) -> [r,g,b,h,er,eg,eb]
function paint(size, fn, post) {
  const c = canvas(size), bc = canvas(size), ec = canvas(size);
  const g = c.getContext('2d'), bg = bc.getContext('2d'), eg = ec.getContext('2d');
  const im = g.createImageData(size, size), bi = bg.createImageData(size, size), ei = eg.createImageData(size, size);
  let hasE = false;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x / size, y / size);
    const i = (y * size + x) * 4;
    im.data[i] = o[0]; im.data[i + 1] = o[1]; im.data[i + 2] = o[2]; im.data[i + 3] = 255;
    const h = o[3] === undefined ? 128 : o[3];
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h; bi.data[i + 3] = 255;
    if (o[4] !== undefined) { hasE = true; ei.data[i] = o[4]; ei.data[i + 1] = o[5]; ei.data[i + 2] = o[6]; }
    ei.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0); bg.putImageData(bi, 0, 0); eg.putImageData(ei, 0, 0);
  if (post) post(g, size, eg, bg);
  return { map: finish(c, true), bump: finish(bc, false), emissive: hasE ? finish(ec, true) : null };
}
function finish(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
function rivets(nx, ny, r, col = '#2a2a2a', hi = '#c9c9c9') {
  return (g, s) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      for (const [ox, oy] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94]]) {
        const x = ((i + ox) / nx) * s, y = ((j + oy) / ny) * s;
        g.fillStyle = col; g.beginPath(); g.arc(x + 1, y + 1.5, r, 0, TAU); g.fill();
        g.fillStyle = hi; g.beginPath(); g.arc(x, y, r * 0.8, 0, TAU); g.fill();
      }
    }
  };
}

export function buildTextures() {
  const T = {};
  const S = 256, B = 512;

  T.grass = paint(S, (u, v) => {
    const n = fbm(u, v, 5, 6, 1), f = vnoise(u * 96, v * 96, 96, 96, 3), st = vnoise(u * 48, v * 8, 48, 8, 4);
    const c = mix(hex(0x2c5a1e), hex(0x7cb83e), clamp(n * 1.4 + (f - 0.5) * 0.5 + (st - 0.5) * 0.3));
    return [...c, n * 200 + f * 55];
  });
  T.rock = paint(B, (u, v) => {
    const n = fbm(u, v, 6, 4, 2), r = Math.abs(fbm(u, v, 4, 5, 9) - 0.5) * 2;
    const crack = sstep(0.12, 0.0, r);
    let c = mix(hex(0x5e5a55), hex(0xa39b8d), n);
    c = mul(c, 1 - crack * 0.55);
    return [...c, n * 190 - crack * 90 + 60];
  });
  T.moss = paint(B, (u, v) => {
    const n = fbm(u, v, 6, 4, 2), r = Math.abs(fbm(u, v, 4, 5, 9) - 0.5) * 2;
    const crack = sstep(0.12, 0.0, r), m = sstep(0.42, 0.62, fbm(u, v, 4, 3, 5));
    let c = mix(hex(0x5e5a55), hex(0xa39b8d), n);
    c = mix(c, mix(hex(0x2f5d22), hex(0x5f9b32), n), m);
    c = mul(c, 1 - crack * 0.5);
    return [...c, n * 190 - crack * 80 + 60];
  });
  T.wood = paint(S, (u, v) => {
    const pi = Math.floor(u * 5), pf = fr(u * 5);
    const g = vnoise(v * 6, pf * 3 + 0, 6, 3, pi + 1) * 0.6 + vnoise(v * 24, pf * 6, 24, 6, pi + 9) * 0.4;
    const tone = hash2(pi, 7) * 0.25;
    let c = mix(hex(0x6b4423), hex(0xb07d46), clamp(g + tone - 0.1));
    const seam = pf < 0.03 || pf > 0.97;
    if (seam) c = mul(c, 0.35);
    return [...c, seam ? 20 : 120 + g * 100];
  });
  T.steel = paint(S, (u, v) => {
    const n = vnoise(u * 2, v * 96, 2, 96, 4), m = fbm(u, v, 4, 4, 5);
    let c = mul(hex(0x8d939a), 0.78 + 0.3 * n + (m - 0.5) * 0.25);
    const seam = fr(u * 2) < 0.012 || fr(v * 2) < 0.012;
    if (seam) c = mul(c, 0.45);
    return [...c, seam ? 30 : 140 + n * 60];
  }, rivets(2, 2, 2.2));
  T.rust = paint(B, (u, v) => {
    const n = fbm(u, v, 6, 4, 11), n2 = fbm(u, v, 5, 8, 12);
    const r = sstep(0.38, 0.62, n);
    let c = mix(hex(0x474a4f), mix(hex(0x7d3510), hex(0xc4682a), n2), r);
    const wave = 0.5 + 0.5 * Math.sin(u * TAU * 8);
    c = mul(c, 0.8 + wave * 0.3);
    return [...c, wave * 110 + n * 120];
  });
  T.grating = paint(S, (u, v) => {
    const fx = fr(u * 8), fy = fr(v * 8), bar = fx < 0.22 || fy < 0.22;
    const n = vnoise(u * 64, v * 64, 64, 64, 6);
    return bar ? [...mul(hex(0x7b8088), 0.8 + n * 0.4), 230] : [14, 15, 18, 0];
  });
  T.hazard = paint(S, (u, v) => {
    const s = fr((u + v) * 4), stripe = s < 0.5;
    const w = fbm(u, v, 5, 6, 8);
    let c = stripe ? hex(0xe8b800) : hex(0x18181a);
    c = mix(c, hex(0x6f6a5a), sstep(0.62, 0.8, w) * 0.7);
    return [...c, 128 + (w - 0.5) * 60];
  });
  T.concrete = paint(B, (u, v) => {
    const n = fbm(u, v, 6, 4, 21), pit = vnoise(u * 64, v * 64, 64, 64, 22) > 0.82 ? 0.7 : 1;
    const stain = vnoise(u * 6, v * 1.5, 6, 2, 23);
    let c = mix(hex(0x77776f), hex(0xa5a59e), n);
    c = mul(c, pit * (0.85 + stain * 0.2));
    const seam = fr(v * 2) < 0.008 || fr(u * 2) < 0.008;
    if (seam) c = mul(c, 0.55);
    return [...c, n * 180 + (pit < 1 ? -40 : 0) + 40];
  });
  T.olive = paint(S, (u, v) => {
    const n1 = fbm(u, v, 4, 3, 31), n2 = fbm(u, v, 4, 4, 32), sc = vnoise(u * 80, v * 80, 80, 80, 33);
    let c = hex(0x4b533a);
    c = mix(c, hex(0x2c3323), sstep(0.5, 0.62, n1));
    c = mix(c, hex(0x6a5a3a), sstep(0.58, 0.7, n2));
    c = mix(c, hex(0x9a9a80), sstep(0.88, 0.97, sc) * 0.5);
    return [...c, 130 + n1 * 60];
  }, rivets(2, 2, 2));
  T.sandbag = paint(S, (u, v) => {
    const row = Math.floor(v * 8), cu = fr(u * 4 + (row % 2) * 0.5), cv = fr(v * 8);
    const shade = Math.pow(Math.sin(cu * Math.PI), 0.5) * Math.pow(Math.sin(cv * Math.PI), 0.5);
    const weave = vnoise(u * 128, v * 128, 128, 128, 41);
    let c = mix(hex(0x6f6246), hex(0xc0ad82), shade);
    c = mul(c, 0.85 + weave * 0.25);
    return [...c, shade * 255];
  });
  T.brick = paint(B, (u, v) => {
    const row = Math.floor(v * 14), cu = fr(u * 5 + (row % 2) * 0.5), cv = fr(v * 14);
    const id = Math.floor(u * 5 + (row % 2) * 0.5);
    const mortar = cu < 0.05 || cv < 0.08;
    const n = fbm(u, v, 5, 8, 51);
    let c = mix(hex(0x7a2f22), hex(0xb0603f), hash2(id, row, 5) * 0.7 + n * 0.3);
    if (mortar) c = mix(hex(0x8e897d), hex(0xaaa597), n);
    return [...c, mortar ? 40 : 170 + n * 60];
  });
  T.brass = paint(B, (u, v) => {
    const n = fbm(u, v, 5, 6, 41), br = vnoise(u * 2, v * 128, 2, 128, 42), p = fbm(u, v, 4, 5, 43);
    let c = mix(hex(0x8a6a22), hex(0xe0b957), clamp(n * 0.8 + br * 0.35));
    c = mix(c, hex(0x3f8f7a), sstep(0.56, 0.72, p) * 0.8);
    const seam = fr(u * 2) < 0.01 || fr(v * 2) < 0.01;
    if (seam) c = mul(c, 0.4);
    return [...c, seam ? 30 : 150 + br * 50];
  }, rivets(2, 2, 3, '#4a3410', '#f4d98a'));
  T.ice = paint(B, (u, v) => {
    const n = fbm(u, v, 5, 4, 71), r = Math.abs(fbm(u, v, 4, 6, 72) - 0.5) * 2, r2 = Math.abs(fbm(u, v, 3, 9, 73) - 0.5) * 2;
    const crack = Math.max(sstep(0.07, 0.0, r), sstep(0.05, 0.0, r2) * 0.7);
    let c = mix(hex(0x2f78b4), hex(0xbfe6fa), n);
    c = mix(c, hex(0xffffff), crack * 0.85);
    return [...c, 100 + n * 100 - crack * 40];
  });
  T.snow = paint(S, (u, v) => {
    const n = fbm(u, v, 5, 5, 81), sp = vnoise(u * 128, v * 128, 128, 128, 82);
    let c = mix(hex(0xc3d6ee), hex(0xffffff), n);
    c = mix(c, [255, 255, 255], sstep(0.9, 1.0, sp) * 0.8);
    return [...c, 120 + n * 120];
  });
  T.frost = paint(S, (u, v) => {
    const n = vnoise(u * 2, v * 96, 2, 96, 4), f = fbm(u, v, 5, 6, 51);
    let c = mul(hex(0x7f95a6), 0.8 + 0.3 * n);
    c = mix(c, hex(0xeaf6ff), sstep(0.48, 0.7, f));
    return [...c, 140 + f * 80];
  }, rivets(2, 2, 2.2, '#2b3a46', '#dff3ff'));
  T.obsidian = paint(B, (u, v) => {
    const n = fbm(u, v, 5, 4, 61);
    const r = Math.abs(fbm(u, v, 5, 3, 62) - 0.5) * 2, r2 = Math.abs(fbm(u, v, 5, 4, 63) - 0.5) * 2;
    const vein = sstep(0.06, 0.0, r), vein2 = sstep(0.04, 0.0, r2) * 0.8;
    const c = mix(hex(0x0a0a14), hex(0x241f3a), n);
    const e = [vein2 * 255 + vein * 40, vein * 255 + vein2 * 20, vein * 240 + vein2 * 180];
    return [c[0] + e[0] * 0.12, c[1] + e[1] * 0.12, c[2] + e[2] * 0.12, 120 + n * 80, ...e];
  });
  T.marble = paint(B, (u, v) => {
    const n = fbm(u, v, 5, 4, 91), r = Math.abs(fbm(u, v, 5, 3, 92) - 0.5) * 2;
    let c = mix(hex(0xe9e4d8), hex(0xfbf8ef), n);
    c = mix(c, hex(0x8f8d8a), sstep(0.08, 0.0, r) * 0.6);
    return [...c, 150 + n * 40];
  });
  T.leaf = paint(S, (u, v) => {
    const n = fbm(u, v, 5, 8, 101), f = vnoise(u * 64, v * 64, 64, 64, 102);
    return [...mix(hex(0x1f5a22), hex(0x86c93f), clamp(n * 1.2 + (f - 0.5) * 0.4)), n * 200];
  });
  T.cherry = paint(S, (u, v) => {
    const n = fbm(u, v, 5, 8, 111), f = vnoise(u * 64, v * 64, 64, 64, 112);
    return [...mix(hex(0xd9709a), hex(0xffd6e4), clamp(n * 1.2 + (f - 0.5) * 0.4)), n * 200];
  });
  T.bark = paint(S, (u, v) => {
    const n = vnoise(u * 16, v * 3, 16, 3, 121), m = fbm(u, v, 4, 4, 122);
    return [...mix(hex(0x2e2016), hex(0x6e5238), clamp(n * 0.8 + m * 0.4)), n * 220];
  });
  T.windows = paint(B, (u, v) => {
    const cx = Math.floor(u * 8), cy = Math.floor(v * 16), fx = fr(u * 8), fy = fr(v * 16);
    const win = fx > 0.18 && fx < 0.82 && fy > 0.2 && fy < 0.8;
    const lit = hash2(cx, cy, 131) > 0.86;
    const n = fbm(u, v, 5, 4, 132);
    let c = mix(hex(0x6f6f69), hex(0x9c9c94), n);
    if (win) c = lit ? hex(0xffd28a) : mix(hex(0x14181c), hex(0x2c3a44), hash2(cx, cy, 133));
    const e = win && lit ? [255, 190, 100] : [0, 0, 0];
    return [...c, win ? 40 : 160, ...e];
  });
  // glow sprite (white radial)
  {
    const c = canvas(128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    T.sprite = { map: new THREE.CanvasTexture(c) };
    T.sprite.map.colorSpace = THREE.SRGBColorSpace;
  }
  // clock face
  {
    const c = canvas(512), g = c.getContext('2d');
    g.fillStyle = '#2b1d12'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#f2e4bd'; g.beginPath(); g.arc(256, 256, 226, 0, TAU); g.fill();
    g.strokeStyle = '#c9983a'; g.lineWidth = 14; g.stroke();
    g.fillStyle = '#221a10'; g.font = 'bold 44px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const rom = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU - Math.PI / 2; g.fillText(rom[i], 256 + Math.cos(a) * 178, 256 + Math.sin(a) * 178); }
    g.lineCap = 'round'; g.strokeStyle = '#221a10';
    g.lineWidth = 12; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + 90, 256 - 60); g.stroke();
    g.lineWidth = 8; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 - 30, 256 - 150); g.stroke();
    T.clock = { map: finish(c, true) };
  }
  return T;
}
