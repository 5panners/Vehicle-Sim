import * as THREE from 'three';
import { SURFACES, SURF } from '../world/Surfaces.js';
import { STRIPS, START_PAD, SKIDPAD, JUMP_PARK } from '../world/maps/test.js';
import { gridSlots } from '../game/RaceStart.js';
import { fbm } from '../world/noise.js';
import { buildBrandsScenery } from './scenery/brandsHatch.js';
import { buildMonacoScenery } from './scenery/monaco.js';
import { buildSpaScenery } from './scenery/spa.js';

export function noiseTexture(size = 256, contrast = 0.25, base = 0.85) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const n = base + (Math.random() - 0.5) * contrast + Math.sin(x * 0.2) * Math.cos(y * 0.23) * contrast * 0.15;
    const v = Math.max(0, Math.min(255, n * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function labelSprite(text, { size = 64, color = '#fff', bg = 'rgba(0,0,0,0.55)', scale = 6 } = {}) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size; c.width = w; c.height = size * 1.6;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(scale * (c.width / c.height), scale, 1);
  return s;
}

export class WorldView {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.detail = noiseTexture(256, 0.35, 0.9);
    this._sky();
    this._terrain();
    this._track();
    const scenery = world.map.scenery;
    if (scenery === 'test') this._zones();
    this._props();
    this._walls();
    if (scenery === 'test') this._scenery();
    else if (scenery === 'brands') buildBrandsScenery(this);
    else if (scenery === 'monaco') buildMonacoScenery(this);
    else if (scenery === 'spa') buildSpaScenery(this);
  }

  // Barriers: street concrete (red/white blocks), concrete pit wall, Armco (two steel rails on
  // posts) and tyre walls (black with orange markers). fence: tall catch fencing above.
  _walls() {
    const walls = this.world.walls || [];
    if (!walls.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const N = walls.length;
    const solid = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: this.detail }), N);
    const rails = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xd4d9de, metalness: 0.7, roughness: 0.35 }), N * 2);
    const posts = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x6d737a }), N);
    const marks = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xff7a1a }), N);
    const fenceTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.strokeStyle = 'rgba(205,210,215,0.8)'; g.lineWidth = 1.2; for (let i = -64; i < 128; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1.2); return t; })();
    const fence = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.05 }), N);
    const fposts = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x80878e }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const red = new THREE.Color(0xc62828), white = new THREE.Color(0xeeeeee), grey = new THREE.Color(0xa8a8a8), black = new THREE.Color(0x1d1f22);
    let run = 0, ns = 0, nr = 0, np = 0, nm = 0, nf = 0, nfp = 0;
    const put = (mesh, idx, y, sx, sy, sz, w, off = 0) => {
      pos.set((w.ax + w.bx) / 2 + (w.dz / w.len) * off, y, (w.az + w.bz) / 2 - (w.dx / w.len) * off);
      q.setFromAxisAngle(up, Math.atan2(w.dx, w.dz)); sc.set(sx, sy, sz); m4.compose(pos, q, sc); mesh.setMatrixAt(idx, m4);
    };
    for (const w of walls) {
      if (w.style === 'building') continue;
      run += w.len;
      if (w.style === 'armco') {
        put(rails, nr++, w.base + 0.42, 0.08, 0.3, w.len + 0.05, w);
        put(rails, nr++, w.base + 0.76, 0.06, 0.06, w.len + 0.05, w);
        put(posts, np++, w.base - 0.2, 0.1, 0.95, 0.12, w);
      } else {
        const sink = 0.4;
        put(solid, ns, w.base - sink, w.t, w.height + sink, w.len + 0.04, w);
        solid.setColorAt(ns++, w.style === 'street' ? (Math.floor(run / 4) % 2 ? red : white) : w.style === 'tyrewall' ? black : grey);
        if (w.style === 'tyrewall' && Math.floor(run / 14) !== Math.floor((run - w.len) / 14)) put(marks, nm++, w.base, w.t + 0.04, w.height + 0.02, 0.35, w);
      }
      if (w.fence || w.style === 'street') {
        put(fence, nf++, w.top, 0.03, w.style === 'pitwall' ? 3 : 3.4, w.len + 0.04, w);
        if (Math.floor(run / 6) !== Math.floor((run - w.len) / 6)) put(fposts, nfp++, w.top - 0.2, 0.08, (w.style === 'pitwall' ? 3 : 3.4) + 0.2, 0.08, w);
      }
    }
    solid.count = ns; rails.count = nr; posts.count = np; marks.count = nm; fence.count = nf; fposts.count = nfp;
    for (const m of [solid, rails, posts, marks, fposts]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; }
    if (solid.instanceColor) solid.instanceColor.needsUpdate = true;
    fence.instanceMatrix.needsUpdate = true;
    this.scene.add(solid, rails, posts, marks, fence, fposts);
  }

  _sky() {
    const geo = new THREE.SphereGeometry(4000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(this.world.map.sky?.top ?? 0x3a7bd5) }, bottom: { value: new THREE.Color(this.world.map.sky?.bottom ?? 0xdfe9f3) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(vP.y*1.6+0.08,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(t,0.7)),1.0);} ',
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
  }

  _terrain() {
    const w = this.world, size = w.size, step = size > 2000 ? 4 : 2.5,   // big circuits use a coarser mesh
       n = Math.round(size / step) + 1, half = size / 2;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * step - half, z = j * step - half, k = j * n + i;
      const y = w.heightAtGrid(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y - 0.02; pos[k * 3 + 2] = z;
      let sid = w.surfaceAt(x, z); if (sid === 9) sid = 0; // kerbs are drawn as a ribbon; keep the coarse terrain grey there
      // maps whose trackside tarmac/concrete (pit lane, run-off) is drawn as crisp ribbons keep the
      // coarse terrain grass-coloured there, so its 2.5 m vertex colours don't bleed past the ribbon
      if (w.map.tracksideRibbons && (sid === SURF.Asphalt || sid === SURF.Concrete)) {
        const ti = w.trackInfo(x, z);
        if (ti.index >= 0 && ti.dist > w.track[ti.index].w / 2 + 1.3) sid = SURF.Grass;
      }
      const s = { color: (w.map.surfaceColor && w.map.surfaceColor(sid)) || SURFACES[sid].color };
      const v = (0.9 + fbm(x * 0.05, z * 0.05, 2) * 0.15) * (w.map.groundTint ? w.map.groundTint(x, z, w, sid) : 1);
      col[k * 3] = s.color[0] * v; col[k * 3 + 1] = s.color[1] * v; col[k * 3 + 2] = s.color[2] * v;
      uv[k * 2] = x / 8; uv[k * 2 + 1] = z / 8;
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.detail });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /**
   * Strip of geometry following the track between lateral offsets offA..offB (numbers or
   * functions of the sample). Optional sample range [from, to) and filter(sample) -> bool
   * (runs where the filter is false are skipped, producing separate meshes).
   */
  _ribbon({ offA, offB, yOff = 0.03, color = () => [1, 1, 1], mat, uvScale = 1, from = 0, to, filter, step = 2, cols = 1 }) {
    const T = this.world.track, M = T.length;
    to ??= from + M;
    const OA = typeof offA === 'function' ? offA : () => offA, OB = typeof offB === 'function' ? offB : () => offB;
    const meshes = [];
    let pos = [], col = [], uv = [], v = 0;
    const V = cols + 1; // vertices across the strip (cols > 1 lets wide strips follow curved ground)
    const flush = () => {
      const rows = pos.length / (3 * V);
      if (rows >= 2) {
        const idx = [];
        for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) { const a = r * V + c; idx.push(a, a + 1, a + V, a + 1, a + V + 1, a + V); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true;
        this.scene.add(mesh); meshes.push(mesh);
      }
      pos = []; col = []; uv = [];
    };
    for (let s = from; s <= to; s += step) {
      const t = T[((s % M) + M) % M];
      if (filter && !filter(t)) { flush(); continue; }
      const a = OA(t), b = OB(t);
      for (let c = 0; c <= cols; c++) {
        const off = a + (b - a) * (c / cols);
        const x = t.x + t.rx * off, z = t.z + t.rz * off;
        pos.push(x, this.world.heightAtGrid(x, z) + yOff, z);
        const cc = color(s, off); col.push(cc[0], cc[1], cc[2]);
        uv.push(c / cols, v);
      }
      v += step / uvScale;
    }
    flush();
    return meshes;
  }

  asphaltMaterial() {
    if (this._asphalt) return this._asphalt;
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = 58 + Math.random() * 22; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(4, 0, 5, 256); ctx.fillRect(247, 0, 5, 256);
    ctx.fillStyle = 'rgba(30,30,30,0.35)'; ctx.fillRect(70, 0, 30, 256); ctx.fillRect(156, 0, 30, 256); // racing line rubber
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return (this._asphalt = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }

  _track() {
    const T = this.world.track, hw = (t) => t.w / 2;
    this._ribbon({ offA: (t) => -hw(t), offB: hw, mat: this.asphaltMaterial(), uvScale: 14, step: 2, cols: 4 });
    // kerbs: red/white blocks, everywhere or just through corners (map.kerbs)
    const kmat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const kc = (s) => ((Math.floor(s / 4) % 2) ? [0.85, 0.1, 0.1] : [0.95, 0.95, 0.95]);
    const kerb = (t) => t.kerb;
    this._ribbon({ offA: hw, offB: (t) => hw(t) + 1.2, yOff: 0.06, color: kc, mat: kmat, filter: (t) => t.kerb && !t.noKerbR });
    this._ribbon({ offA: (t) => -hw(t) - 1.2, offB: (t) => -hw(t), yOff: 0.06, color: kc, mat: kmat, filter: kerb });
    // start/finish line + gantry
    const t0 = T[0], W = t0.w;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(t0.tx, t0.tz);
    line.position.set(t0.x, this.world.heightAtGrid(t0.x, t0.z) + 0.05, t0.z);
    this.scene.add(line);
    const gantry = new THREE.Group();
    const pm = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), pm); post.position.set(s * (W / 2 + 3), 3.5, 0); gantry.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 6.5, 1.2, 0.6), new THREE.MeshLambertMaterial({ color: 0x1565c0 })); beam.position.y = 7; gantry.add(beam);
    // sign panels fixed to both faces of the beam (a camera-facing sprite clipped into the beam)
    {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#1565c0'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; g.font = 'bold 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('START  /  FINISH', c.width / 2, c.height / 2 + 4);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const signMat = new THREE.MeshBasicMaterial({ map: tex });
      for (const face of [-1, 1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W + 4, 9.6), 1.1), signMat);
        sign.position.set(0, 7, face * 0.31); if (face < 0) sign.rotation.y = Math.PI; gantry.add(sign);
      }
    }
    // start lights: five columns of two red lamps in a black housing under the beam, facing the grid
    {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.15, 0.35), new THREE.MeshLambertMaterial({ color: 0x0b0b0b }));
      housing.position.set(0, 5.75, -0.2); gantry.add(housing);
      const lampGeo = new THREE.CircleGeometry(0.2, 20);
      this.startLamps = [];
      for (let c = 0; c < 5; c++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x2a0606 });
        this.startLamps.push(mat);
        for (const y of [5.98, 5.52]) {
          const lamp = new THREE.Mesh(lampGeo, mat);
          lamp.position.set((c - 2) * 0.62, y, -0.38); lamp.rotation.y = Math.PI;   // face back down the grid
          gantry.add(lamp);
        }
      }
    }
    gantry.position.set(t0.x, this.world.heightAtGrid(t0.x, t0.z), t0.z);
    gantry.rotation.y = Math.atan2(t0.tx, t0.tz);
    gantry.traverse((o) => { o.castShadow = true; });
    this.scene.add(gantry);
    this._grid();
  }

  /** number of start lights lit (0-5) */
  setStartLights(n) {
    this.startLamps?.forEach((m, i) => m.color.setHex(i < n ? 0xff1a1a : 0x2a0606));
  }

  /** painted grid slots behind the line: a bar where the nose stops, short side ticks, the position number */
  _grid() {
    const white = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const flat = (w, l, mat, x, z, yaw, along = 0, across = 0, turn = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;            // forward / right in the ground plane
      const px = x + fx * along + rx * across, pz = z + fz * along + rz * across;
      m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, yaw + turn, 0);
      m.position.set(px, this.world.heightAtGrid(px, pz) + 0.05, pz);
      this.scene.add(m); return m;
    };
    for (const g of gridSlots(this.world, 12)) {
      const { x, z, yaw } = g.bar;
      flat(2.6, 0.22, white, x, z, yaw);                                          // bar across the slot
      for (const k of [-1, 1]) flat(0.18, 1.1, white, x, z, yaw, -0.55, k * 1.21); // ticks running back from the bar ends
      // position number, painted on the inside of the slot
      const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d');
      ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 54px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(g.pos), 32, 34);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const num = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      flat(0.9, 0.9, num, x, z, yaw, -1.0, -g.side * 1.9, Math.PI);   // half-turned so it reads upright to drivers facing forward
    }
  }

  _zones() {
    const flat = (x0, x1, z0, z1, color, y = 0.025, map = this.detail, rep = 0.25) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      const uvs = g.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (x1 - x0) * rep, uvs.getY(i) * (z1 - z0) * rep);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, map, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true;
      this.scene.add(m); return m;
    };
    const rgb = (s) => new THREE.Color().setRGB(...SURFACES[s].color, THREE.SRGBColorSpace);
    // start pad with skidpad circle
    const P = START_PAD;
    const pad = document.createElement('canvas'); pad.width = 1024; pad.height = Math.round(1024 * (P.z1 - P.z0) / (P.x1 - P.x0));
    const ctx = pad.getContext('2d');
    ctx.fillStyle = '#5a5a5e'; ctx.fillRect(0, 0, pad.width, pad.height);
    for (let i = 0; i < 40000; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`; ctx.fillRect(Math.random() * pad.width, Math.random() * pad.height, 2, 2); }
    const sx = pad.width / (P.x1 - P.x0);
    // plane is rotated -90° about X: canvas column -> world X, canvas row 0 -> world z0
    const C = (x, z) => [(x - P.x0) * sx, (z - P.z0) * sx];
    const [cx, cy] = C(SKIDPAD.x, SKIDPAD.z);
    ctx.strokeStyle = '#f5f5f5'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    for (const r of [SKIDPAD.r - 4, SKIDPAD.r, SKIDPAD.r + 4]) { ctx.beginPath(); ctx.arc(cx, cy, r * sx, 0, Math.PI * 2); ctx.stroke(); }
    // start box at the spawn point
    ctx.setLineDash([]); ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 4;
    const [bx, by] = C(-63, -2.5); ctx.strokeRect(bx, by, 6 * sx, 5 * sx);
    // 0-100 / braking distance marks every 25 m along +X from the start box
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px system-ui';
    for (let d = 25; d <= 150; d += 25) { const [mx, my] = C(-60 + d, -8); ctx.fillRect(mx - 1, my, 3, 16 * sx / 2); ctx.fillText(`${d}m`, mx + 4, my + 14); }
    // slalom cone spots
    ctx.fillStyle = '#ff7043';
    for (let i = 0; i < 8; i++) { const [px, py] = C(-70 + i * 16, 45); ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); }
    const tex = new THREE.CanvasTexture(pad); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    flat(P.x0, P.x1, P.z0, P.z1, 0xffffff, 0.03, tex, 1 / (P.x1 - P.x0));
    flat(P.x1 - 1, STRIPS[0].x0, -30, 30, rgb(0).multiplyScalar(1.6), 0.03);
    // surface strips + labels
    for (const st of STRIPS) {
      flat(st.x0, st.x1, st.z0, st.z1, rgb(st.surface).multiplyScalar(1.15), 0.035);
      const s = labelSprite(SURFACES[st.surface].name.toUpperCase(), { scale: 3.2 });
      s.position.set((st.x0 + st.x1) / 2, 3.5, st.z0 - 2); this.scene.add(s);
      const s2 = labelSprite(`μ ${SURFACES[st.surface].friction.toFixed(2)}`, { scale: 2, color: '#ffe082' });
      s2.position.set((st.x0 + st.x1) / 2, 1.6, st.z0 - 2); this.scene.add(s2);
    }
    const J = JUMP_PARK;
    const jl = labelSprite('JUMP PARK', { scale: 5 }); jl.position.set((J.x0 + J.x1) / 2, 7, J.z0 - 4); this.scene.add(jl);
    const sk = labelSprite('SKIDPAD r=30m', { scale: 2.5 }); sk.position.set(SKIDPAD.x, 3, SKIDPAD.z); this.scene.add(sk);
    // slalom cones (visual only)
    const coneGeo = new THREE.ConeGeometry(0.25, 0.7, 12), coneMat = new THREE.MeshLambertMaterial({ color: 0xff6d00 });
    for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(coneGeo, coneMat); c.position.set(-70 + i * 16, 0.38, 45); c.castShadow = true; this.scene.add(c); }
  }

  _props() {
    const w = this.world;
    const mats = {};
    for (const p of w.props) {
      const s = SURFACES[p.surface];
      const mat = mats[p.surface] || (mats[p.surface] = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...s.color, THREE.SRGBColorSpace).multiplyScalar(1.1), map: this.detail }));
      // sample the exact physics height on a grid slightly larger than the footprint -> skirts
      const us = [], ws = [];
      const L = p.halfLen, W = p.halfW, e = 0.03;
      for (let u = -L; u < L; u += 0.5) us.push(u);
      us.push(L - 1e-3, L + e); us.unshift(-L - e);
      for (let v = -W; v < W; v += 0.5) ws.push(v);
      ws.push(W - 1e-3, W + e); ws.unshift(-W - e);
      const pos = [], uv = [], idx = [];
      for (let j = 0; j < us.length; j++) for (let i = 0; i < ws.length; i++) {
        const u = us[j], v = ws[i];
        const x = p.x + u * p.sin + v * p.cos, z = p.z + u * p.cos - v * p.sin;
        pos.push(x, w.heightAt(x, z) + 0.01, z); uv.push(v / 4, u / 4);
      }
      const nw = ws.length;
      for (let j = 0; j < us.length - 1; j++) for (let i = 0; i < nw - 1; i++) {
        const a = j * nw + i, b = a + 1, c = a + nw, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
      m.material.side = THREE.DoubleSide;
      this.scene.add(m);
    }
  }

  _scenery() {
    const w = this.world;
    // instanced trees on grass away from the action
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6); trunkGeo.translate(0, 1.5, 0);
    const leafGeo = new THREE.ConeGeometry(2.2, 6, 7); leafGeo.translate(0, 5.5, 0);
    const N = 1400;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5d4037 }), N);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2e7d32 }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let count = 0, tries = 0;
    const half = w.size / 2 - 40;
    while (count < N && tries < N * 20) {
      tries++;
      const x = (Math.random() * 2 - 1) * half, z = (Math.random() * 2 - 1) * half;
      if (x > -420 && x < 330 && z > -190 && z < 190) continue; // infield test zones
      const n = w.n, i = Math.round((x + w.half) / w.res), j = Math.round((z + w.half) / w.res);
      if (w.trackDist[j * n + i] < w.maxHalfWidth + 30) continue;
      if (w.surfaceAt(x, z) !== 5) continue;
      if (fbm(x * 0.01, z * 0.01, 2) < -0.05) continue; // clumped forests
      const s = 0.7 + Math.random() * 0.8;
      p.set(x, w.heightAtGrid(x, z) - 0.2, z); q.setFromAxisAngle(up, Math.random() * 6.28); sc.set(s, s, s);
      m4.compose(p, q, sc);
      trunks.setMatrixAt(count, m4); leaves.setMatrixAt(count, m4);
      count++;
    }
    trunks.count = leaves.count = count;
    leaves.castShadow = true;
    this.scene.add(trunks, leaves);
    // tyre-wall style barriers around the start pad edge (visual reference)
    const markerGeo = new THREE.BoxGeometry(0.3, 1.2, 0.3), markerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const T = w.track;
    const markers = new THREE.InstancedMesh(markerGeo, markerMat, Math.ceil(T.length / 25) * 2);
    let mi = 0;
    for (let s = 0; s < T.length; s += 25) for (const side of [-1, 1]) {
      const t = T[s], off = side * (t.w / 2 + 5);
      const x = t.x + t.rx * off, z = t.z + t.rz * off;
      m4.makeTranslation(x, w.heightAtGrid(x, z) + 0.6, z); markers.setMatrixAt(mi++, m4);
    }
    markers.count = mi;
    this.scene.add(markers);
  }
}
