// Stylised climber avatar + name tag
import * as THREE from 'three';

export const PALETTE = [0xff5a4a, 0xffb02e, 0x7ddc4a, 0x2fd0c0, 0x4aa3ff, 0x9a6bff, 0xff6ec7, 0xf2f2f2];

function labelSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px "Trebuchet MS", Verdana, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(246, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(8,12,24,0.62)'; g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill();
  g.fillStyle = '#fff'; g.fillText(name, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.25; s.renderOrder = 20;
  return s;
}

export class Avatar {
  constructor(color = 0xff5a4a, name = '') {
    this.root = new THREE.Group();
    const col = new THREE.Color(color);
    const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.35), roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0d2b0, roughness: 0.8 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: 0x40c8ff, emissiveIntensity: 1.2, roughness: 0.15, metalness: 0.4 });
    const add = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

    this.body = new THREE.Group(); this.root.add(this.body);
    add(new THREE.CapsuleGeometry(0.26, 0.42, 4, 10), suit, this.body, 0, 1.02, 0);
    add(new THREE.SphereGeometry(0.22, 16, 12), suit, this.body, 0, 1.6, 0);
    const v = add(new THREE.SphereGeometry(0.17, 12, 10), visor, this.body, 0, 1.61, 0.1); v.scale.set(1.05, 0.7, 0.8);
    add(new THREE.BoxGeometry(0.38, 0.52, 0.2), dark, this.body, 0, 1.06, -0.3);
    add(new THREE.BoxGeometry(0.4, 0.07, 0.07), skin, this.body, 0, 0.7, 0.2).visible = false;
    const limb = (x, y, len, r, mat) => {
      const piv = new THREE.Group(); piv.position.set(x, y, 0); this.body.add(piv);
      add(new THREE.CapsuleGeometry(r, len, 3, 8), mat, piv, 0, -len / 2 - r * 0.6, 0);
      return piv;
    };
    this.armL = limb(-0.36, 1.32, 0.38, 0.085, suit); this.armR = limb(0.36, 1.32, 0.38, 0.085, suit);
    this.legL = limb(-0.14, 0.76, 0.42, 0.105, dark); this.legR = limb(0.14, 0.76, 0.42, 0.105, dark);
    if (name) { this.label = labelSprite(name); this.root.add(this.label); }
    this.phase = 0; this.lean = 0;
  }
  animate(dt, state, speed) {
    const { armL, armR, legL, legR, body } = this;
    let aL = 0, aR = 0, lL = 0, lR = 0, lean = 0, bob = 0;
    if (state === 'run') {
      this.phase += dt * (6 + speed * 1.1);
      const s = Math.sin(this.phase), amp = Math.min(1.1, 0.4 + speed * 0.09);
      aL = s * amp; aR = -s * amp; lL = -s * amp * 1.1; lR = s * amp * 1.1; lean = 0.12 + speed * 0.015; bob = Math.abs(Math.cos(this.phase)) * 0.06;
    } else if (state === 'jump') { aL = aR = -2.4; lL = -0.5; lR = 0.4; lean = 0.1; }
    else if (state === 'fall') {
      this.phase += dt * 14; const s = Math.sin(this.phase);
      aL = -2.6 + s * 0.4; aR = -2.6 - s * 0.4; lL = 0.3 + s * 0.2; lR = -0.2 - s * 0.2;
    } else if (state === 'climb') {
      this.phase += dt * Math.max(4, speed * 3);
      const s = Math.sin(this.phase);
      aL = -2.5 + s * 0.8; aR = -2.5 - s * 0.8; lL = -0.6 - s * 0.6; lR = -0.6 + s * 0.6; lean = -0.1;
    } else { this.phase += dt * 2; bob = Math.sin(this.phase) * 0.012; aL = Math.sin(this.phase) * 0.05; aR = -aL; }
    const k = Math.min(1, dt * 16);
    armL.rotation.x += (aL - armL.rotation.x) * k; armR.rotation.x += (aR - armR.rotation.x) * k;
    legL.rotation.x += (lL - legL.rotation.x) * k; legR.rotation.x += (lR - legR.rotation.x) * k;
    this.lean += (lean - this.lean) * k; body.rotation.x = this.lean; body.position.y = bob;
  }
}
