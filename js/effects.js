import * as THREE from 'three';
import { rand } from './util.js';

function puffTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const ZERO = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Effects {
  constructor(scene, max = 280) {
    this.tex = puffTex(); this.pool = []; this.active = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(m); s.visible = false; s.frustumCulled = false; scene.add(s);
      this.pool.push({ s, vel: new THREE.Vector3(), life: 0, max: 1, s0: 1, s1: 1, grav: 0, drag: 0, alpha: 1 });
    }
    // Musket shot tracer
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.tracer = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true }));
    this.tracer.frustumCulled = false; this.tracer.visible = false; this.tracerT = 0; scene.add(this.tracer);
  }

  emit(pos, o) {
    const p = this.pool.pop(); if (!p) return;
    p.s.position.copy(pos); p.vel.copy(o.vel || ZERO);
    p.life = 0; p.max = o.life; p.s0 = o.s0; p.s1 = o.s1 ?? o.s0; p.grav = o.grav || 0; p.drag = o.drag || 0; p.alpha = o.alpha ?? 1;
    const m = p.s.material; m.color.set(o.color); m.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending; m.rotation = Math.random() * 6.28;
    p.s.scale.setScalar(p.s0); m.opacity = p.alpha;
    p.s.visible = true; this.active.push(p);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life += dt; const u = p.life / p.max;
      if (u >= 1) { p.s.visible = false; this.active[i] = this.active[this.active.length - 1]; this.active.pop(); this.pool.push(p); continue; }
      p.vel.y -= p.grav * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(u));
      p.s.material.opacity = p.alpha * (1 - u) * Math.min(1, u * 12 + 0.3);
    }
    if (this.tracer.visible) { this.tracerT -= dt; this.tracer.material.opacity = Math.max(0, this.tracerT / 0.09); if (this.tracerT <= 0) this.tracer.visible = false; }
  }

  smoke(pos, dir, n = 10, big = 1) {
    for (let i = 0; i < n; i++) {
      _p.set(pos.x + rand(-0.2, 0.2), pos.y + rand(-0.2, 0.2), pos.z + rand(-0.2, 0.2));
      const sp = rand(1, 9) * big;
      this.emit(_p, { vel: new THREE.Vector3(dir.x * sp + rand(-0.5, 0.5), dir.y * sp + rand(0.2, 1.0), dir.z * sp + rand(-0.5, 0.5)),
        life: rand(2.2, 3.8), s0: 0.5 * big, s1: rand(3, 5.5) * big, color: new THREE.Color().setHSL(0, 0, rand(0.75, 0.92)), drag: 1.4, alpha: 0.75 });
    }
  }
  flash(pos, size = 2.2) {
    this.emit(pos, { life: 0.13, s0: size, s1: size * 1.6, color: 0xffc070, add: true });
    this.emit(pos, { life: 0.08, s0: size * 0.6, s1: size, color: 0xffffff, add: true });
  }
  splash(pos, big = 1) {
    for (let i = 0; i < 14 * big; i++) {
      this.emit(pos, { vel: new THREE.Vector3(rand(-2, 2) * big, rand(4, 11) * big, rand(-2, 2) * big), life: rand(0.8, 1.4), s0: rand(0.5, 1.1) * big, s1: rand(1.2, 2) * big, color: 0xf2f8ff, grav: 12, alpha: 0.9 });
    }
  }
  foam(pos) {
    this.emit(pos, { vel: new THREE.Vector3(rand(-0.6, 0.6), rand(0.5, 1.5), rand(-0.6, 0.6)), life: rand(0.8, 1.4), s0: rand(0.5, 0.9), s1: rand(1.4, 2.2), color: 0xf4fbff, grav: 3, alpha: 0.6 });
  }
  debris(pos, n = 12) {
    for (let i = 0; i < n; i++) {
      this.emit(pos, { vel: new THREE.Vector3(rand(-5, 5), rand(2, 9), rand(-5, 5)), life: rand(0.8, 1.5), s0: rand(0.15, 0.35), color: 0x5a3a1e, grav: 14 });
    }
    this.smoke(pos, ZERO, 5, 0.8);
  }
  sparks(pos, n = 3, sz = 0.12) {
    for (let i = 0; i < n; i++) {
      this.emit(pos, { vel: new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 3), rand(-1.5, 1.5)), life: rand(0.2, 0.45), s0: sz, color: 0xffa040, add: true, grav: 6 });
    }
  }
  // A celebration rocket bursting in the sky (voyage won)
  firework(pos, color = 0xffd060, n = 36) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(9, 13));
      this.emit(pos, { vel: v, life: rand(1.1, 1.7), s0: 0.9, s1: 0.4, color, add: true, grav: 4, drag: 1.2 });
    }
    this.emit(pos, { life: 0.25, s0: 6, s1: 9, color: 0xffffff, add: true, alpha: 0.8 });
  }
  hit(pos) {
    for (let i = 0; i < 8; i++) this.emit(pos, { vel: new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)), life: rand(0.3, 0.6), s0: rand(0.08, 0.18), color: 0xfff0b0, add: true, grav: 5 });
    this.emit(pos, { life: 0.5, s0: 0.3, s1: 0.9, color: 0xdddddd, alpha: 0.6 });
  }
  shot(from, to) {
    const a = this.tracer.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    this.tracer.visible = true; this.tracerT = 0.09;
  }
}
