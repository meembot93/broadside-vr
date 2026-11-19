import * as THREE from 'three';
import { halfWidth } from './ship.js';
import { clamp, angleWrap } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6b4426 });
const IRONM = new THREE.MeshLambertMaterial({ color: 0x2b2d33 });
const STEEL = new THREE.MeshLambertMaterial({ color: 0xc9ced8 });
const BRASS = new THREE.MeshLambertMaterial({ color: 0xb8902f });
const LEATHER = new THREE.MeshLambertMaterial({ color: 0x4a2e1a });
const READY = new THREE.MeshBasicMaterial({ color: 0x40ff60 });
const EMPTY = new THREE.MeshBasicMaterial({ color: 0xff3020 });
const WHEEL_MAX = Math.PI * 2; // one full turn of the wheel = full rudder

// Items are built so the hand holds the origin and the business end points down -Z.
function buildMusket() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const box = (w, h, d, m, x, y, z) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); inner.add(me); return me; };
  box(0.055, 0.13, 0.42, WOOD, 0, -0.045, 0.22);       // butt stock
  box(0.05, 0.07, 0.2, WOOD, 0, -0.01, 0.02);          // wrist
  box(0.055, 0.055, 0.78, WOOD, 0, 0.005, -0.44);      // fore stock
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 1.12, 8).rotateX(Math.PI / 2), IRONM);
  barrel.position.set(0, 0.035, -0.55); inner.add(barrel);
  box(0.02, 0.05, 0.08, BRASS, 0.035, 0.02, 0.0);       // lock
  box(0.012, 0.03, 0.05, IRONM, 0, -0.06, -0.02);       // trigger
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), READY); gem.position.set(0, 0.065, 0.06); inner.add(gem);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.035, -1.12); inner.add(muzzle);
  return { obj, inner, gem, muzzle };
}

function buildSword() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.042, 0.82), STEEL); blade.position.z = -0.53; inner.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.08, 4).rotateX(-Math.PI / 2), STEEL); tip.scale.x = 0.3; tip.position.z = -0.98; inner.add(tip);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 5, 12, Math.PI), BRASS); guard.rotation.y = Math.PI / 2; guard.position.z = -0.1; inner.add(guard);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), BRASS); cross.position.z = -0.11; inner.add(cross);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.14, 8).rotateX(Math.PI / 2), LEATHER); inner.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), BRASS); pommel.position.z = 0.08; inner.add(pommel);
  return { obj, inner };
}

function buildGlove() {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.1), LEATHER); palm.position.z = 0.01; g.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd8cdb4 }));
  cuff.position.z = 0.09; g.add(cuff);
  return g;
}

export class Player {
  constructor(G) {
    this.G = G;
    const ship = G.ship;
    this.dolly = new THREE.Group(); ship.root.add(this.dolly);
    this.dolly.position.set(0, 0, 6.5);
    this.dolly.add(G.camera); G.camera.position.set(0, 1.7, 0);
    this.health = 100; this.lastHurt = -99; this.dead = false; this.hurtFlash = 0;
    this.headLocal = new THREE.Vector3(0, 1.7, 6.5);
    this.hands = []; this.snapLatch = false;
    this.yaw = 0; this.pitch = 0; this.keys = {}; this.deskItem = null; this.swing = -1; this.deskReady = false;

    this.vignette = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x8a0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    this.vignette.renderOrder = 999; this.vignette.visible = false; G.camera.add(this.vignette);

    const homeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const mk = (kind, x) => {
      const it = kind === 'sword' ? buildSword() : buildMusket();
      Object.assign(it, { kind, home: { pos: new THREE.Vector3(x, 1.0, -0.5), quat: homeQ.clone() }, holder: null, returning: false,
        loaded: true, reloadT: 0, kick: 0, prevTip: new THREE.Vector3(), hasPrev: false, swooshCD: 0 });
      ship.root.add(it.obj); it.obj.position.copy(it.home.pos); it.obj.quaternion.copy(it.home.quat);
      return it;
    };
    this.items = [mk('musket', -0.42), mk('musket', -0.05), mk('sword', 0.38)];
  }

  // ---------- VR ----------
  setupVR(renderer) {
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
      this.dolly.add(ctrl, grip);
      const glove = buildGlove(); grip.add(glove);
      const h = { i, ctrl, grip, glove, src: null, gp: null, side: '', trig: false, sq: false, held: null, wheelPrev: 0, tickAcc: 0 };
      ctrl.addEventListener('connected', (e) => { h.src = e.data; h.gp = e.data.gamepad || null; h.side = e.data.handedness; });
      ctrl.addEventListener('disconnected', () => { this.release(h); h.src = null; h.gp = null; });
      this.hands.push(h);
    }
  }

  haptic(h, intensity, ms) {
    try { const a = h?.gp?.hapticActuators?.[0]; if (a?.pulse) a.pulse(intensity, ms); } catch (e) { /* ignore */ }
  }

  handPos(h, out) { return h.grip.getWorldPosition(out); }

  grab(h) {
    const ship = this.G.ship;
    this.handPos(h, _a);
    let best = null, bd = 0.24, kind = null;
    for (const it of this.items) {
      if (it.holder || this.deskItem === it) continue;
      it.obj.getWorldPosition(_b);
      const d = _a.distanceTo(_b);
      if (d < bd) { bd = d; best = it; kind = 'item'; }
    }
    if (!best) {
      _b.copy(_a); ship.wheelBase.worldToLocal(_b);
      const rr = Math.hypot(_b.x, _b.y);
      if (Math.abs(rr - 0.58) < 0.24 && Math.abs(_b.z) < 0.3) { kind = 'wheel'; h.wheelPrev = Math.atan2(_b.y, _b.x); }
      else { ship.leverKnob.getWorldPosition(_c); if (_a.distanceTo(_c) < 0.22) kind = 'lever'; }
    }
    if (kind === 'item') {
      h.held = best; best.holder = h; best.returning = false; best.hasPrev = false;
      h.ctrl.add(best.obj); best.obj.position.set(0, -0.01, 0.06); best.obj.quaternion.identity();
      h.glove.visible = false;
      this.haptic(h, 0.4, 40);
    } else if (kind) { h.held = kind; this.haptic(h, 0.3, 30); }
  }

  release(h) {
    const it = h.held;
    if (it && typeof it === 'object') {
      this.G.ship.root.attach(it.obj); it.holder = null; it.returning = true;
    }
    h.held = null; h.glove.visible = true;
  }

  triggerPress(h) {
    const G = this.G;
    if (h.held && h.held.kind === 'musket') { this.fireMusket(h.held, h); return; }
    if (h.held) return;
    this.handPos(h, _a);
    for (const c of G.ship.cannons) {
      c.breech.getWorldPosition(_b);
      if (_a.distanceTo(_b) < 0.5) {
        if (G.ship.lightCannon(c, 0.35)) { G.audio.fuse(_b); this.haptic(h, 0.5, 60); }
        else if (c.reload > 0) { G.hud.msg('That cannon is still reloading', 1.5); G.audio.click(_b); }
        return;
      }
    }
  }

  fireMusket(it, h) {
    const G = this.G;
    if (!it.loaded) { it.muzzle.getWorldPosition(_a); G.audio.click(_a); return; }
    it.loaded = false; it.reloadT = 1.8; it.kick = 1;
    it.muzzle.getWorldPosition(_a);
    if (h) {
      it.obj.getWorldQuaternion(_q); _b.set(0, 0, -1).applyQuaternion(_q);
      G.combat.musketShot(_a, _b, _a);
      this.haptic(h, 1, 90);
    } else {
      G.camera.getWorldPosition(_c); G.camera.getWorldDirection(_b);
      G.combat.musketShot(_c, _b, _a);
    }
  }

  updateWheel(h, dt) {
    const ship = this.G.ship;
    this.handPos(h, _b); ship.wheelBase.worldToLocal(_b);
    const a = Math.atan2(_b.y, _b.x);
    const d = angleWrap(a - h.wheelPrev); h.wheelPrev = a;
    const nHands = this.hands.filter((x) => x.held === 'wheel').length;
    const before = ship.wheelAngle;
    ship.wheelAngle = clamp(ship.wheelAngle + d / nHands, -WHEEL_MAX, WHEEL_MAX);
    h.tickAcc += Math.abs(ship.wheelAngle - before);
    if (h.tickAcc > 0.35) { h.tickAcc = 0; this.haptic(h, 0.15, 12); }
  }

  updateLever(h) {
    const ship = this.G.ship;
    this.handPos(h, _b); ship.leverBase.worldToLocal(_b);
    ship.leverAngle = clamp(Math.atan2(_b.z, _b.y), -0.6, 0.6);
  }

  move(x, y, dt) {
    if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) return;
    const ship = this.G.ship;
    this.G.camera.getWorldDirection(_a);
    ship.root.getWorldQuaternion(_q).invert(); _a.applyQuaternion(_q);
    this.dolly.updateMatrix();
    _a.y = 0; if (_a.lengthSq() < 1e-4) return; _a.normalize();
    const rx = -_a.z, rz = _a.x;
    const sp = 2.4 * dt;
    this.dolly.position.x += (_a.x * -y + rx * x) * sp;
    this.dolly.position.z += (_a.z * -y + rz * x) * sp;
  }

  snapTurn(a) {
    const ship = this.G.ship;
    this.G.camera.getWorldPosition(_a); ship.root.worldToLocal(_a);
    this.dolly.position.sub(_a).applyAxisAngle(UP, a).add(_a);
    this.dolly.rotation.y += a;
  }

  // Keep the player's head over the deck (and out of the masts).
  clampToDeck() {
    const ship = this.G.ship;
    this.dolly.updateMatrixWorld(true);
    this.G.camera.getWorldPosition(_a); ship.root.worldToLocal(_a);
    let x = _a.x, z = clamp(_a.z, -8.6, 6.95);
    const hw = Math.max(0.2, halfWidth(z) - 0.45); x = clamp(x, -hw, hw);
    for (const mz of [-1, -6.5]) {
      const dx = x, dz = z - mz, d = Math.hypot(dx, dz);
      if (d < 0.45) { const k = d > 1e-4 ? 0.45 / d : 1; x = dx * k || 0.45; z = mz + dz * k; }
    }
    this.dolly.position.x += x - _a.x; this.dolly.position.z += z - _a.z;
    this.headLocal.set(x, _a.y, z);
  }

  updateVR(dt) {
    for (const h of this.hands) {
      if (!h.gp) continue;
      const b = h.gp.buttons, ax = h.gp.axes;
      const trig = !!(b[0] && (b[0].pressed || b[0].value > 0.6)), sq = !!(b[1] && (b[1].pressed || b[1].value > 0.6));
      if (sq && !h.sq) this.grab(h);
      if (!sq && h.sq) this.release(h);
      if (trig && !h.trig) this.triggerPress(h);
      h.trig = trig; h.sq = sq;
      if (h.held === 'wheel') this.updateWheel(h, dt);
      else if (h.held === 'lever') this.updateLever(h);
      const sx = ax.length >= 4 ? ax[2] : ax[0] || 0, sy = ax.length >= 4 ? ax[3] : ax[1] || 0;
      if (h.side === 'left') this.move(sx, sy, dt);
      if (h.side === 'right') {
        if (Math.abs(sx) > 0.7 && !this.snapLatch) { this.snapLatch = true; this.snapTurn(sx > 0 ? -Math.PI / 4 : Math.PI / 4); }
        else if (Math.abs(sx) < 0.3) this.snapLatch = false;
      }
    }
  }

  // ---------- Desktop ----------
  initDesktop(canvas) {
    if (this.deskReady) return; this.deskReady = true;
    this.canvas = canvas;
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Digit1') this.equip('musket');
      if (e.code === 'Digit2') this.equip('sword');
      if (e.code === 'Digit3') this.equip(null);
      if (e.code === 'Space') { e.preventDefault(); this.G.combat.broadside(); }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', () => {
      if (this.G.mode !== 'desktop') return;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      else this.deskUse();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.yaw -= e.movementX * 0.0024; this.pitch = clamp(this.pitch - e.movementY * 0.0024, -1.4, 1.4);
      }
    });
  }

  equip(kind) {
    if (this.deskItem) { this.G.ship.root.attach(this.deskItem.obj); this.deskItem.returning = true; this.deskItem = null; }
    if (!kind) return;
    const it = this.items.find((x) => x.kind === kind && !x.holder);
    if (!it) return;
    this.deskItem = it; it.returning = false;
    this.G.camera.add(it.obj);
    if (kind === 'musket') { it.obj.position.set(0.2, -0.2, -0.28); it.obj.rotation.set(0, 0, 0); }
    else { it.obj.position.set(0.3, -0.32, -0.4); it.obj.rotation.set(0.7, 0.35, 0); }
  }

  deskUse() {
    const G = this.G, it = this.deskItem;
    if (it && it.kind === 'musket') { this.fireMusket(it, null); return; }
    if (it && it.kind === 'sword') { if (this.swing < 0) { this.swing = 0; this.swingHit = false; G.audio.swoosh(null); } return; }
    G.camera.getWorldPosition(_a); G.camera.getWorldDirection(_c);
    for (const c of G.ship.cannons) {
      c.breech.getWorldPosition(_b); _b.sub(_a);
      const d = _b.length();
      if (d < 4 && _b.normalize().dot(_c) > 0.93) {
        c.breech.getWorldPosition(_b);
        if (G.ship.lightCannon(c, 0.35)) G.audio.fuse(_b); else if (c.reload > 0) G.hud.msg('That cannon is still reloading', 1.5);
        return;
      }
    }
  }

  updateDesktop(dt) {
    const G = this.G, ship = G.ship, k = this.keys;
    G.camera.position.set(0, 1.7, 0);
    G.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    if (f || s) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const sp = 3 * dt / Math.hypot(f, s);
      this.dolly.position.x += (fx * f + -fz * s) * sp;
      this.dolly.position.z += (fz * f + fx * s) * sp;
    }
    if (k.KeyQ) ship.wheelAngle = clamp(ship.wheelAngle + dt * 4, -WHEEL_MAX, WHEEL_MAX);
    if (k.KeyE) ship.wheelAngle = clamp(ship.wheelAngle - dt * 4, -WHEEL_MAX, WHEEL_MAX);
    if (k.KeyR) ship.leverAngle = clamp(ship.leverAngle - dt * 0.6, -0.6, 0.6);
    if (k.KeyF) ship.leverAngle = clamp(ship.leverAngle + dt * 0.6, -0.6, 0.6);
    if (this.swing >= 0 && this.deskItem) {
      this.swing += dt / 0.3;
      const u = Math.min(1, this.swing);
      this.deskItem.obj.rotation.set(0.7 - u * 1.9, 0.35 - u * 1.1, -u * 0.6);
      if (u > 0.4 && !this.swingHit) { this.swingHit = true; G.combat.deskSwordHit(); }
      if (this.swing >= 1) { this.swing = -1; this.deskItem.obj.rotation.set(0.7, 0.35, 0); }
    }
  }

  // ---------- Shared ----------
  hurt(n) {
    const G = this.G;
    if (this.dead) return;
    this.health -= n; this.lastHurt = G.t; this.hurtFlash = 1;
    G.audio.hurt();
    for (const h of this.hands) this.haptic(h, 0.9, 140);
    if (this.health <= 0) { this.health = 0; this.dead = true; G.onPlayerDeath(); }
  }

  respawn() {
    for (const h of this.hands) this.release(h);
    this.dolly.position.set(0, 0, 6.5); this.dolly.rotation.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.dead = false; this.hurtFlash = 0;
  }

  update(dt) {
    const G = this.G, ship = G.ship;
    if (G.mode === 'vr') this.updateVR(dt); else if (G.mode === 'desktop') this.updateDesktop(dt);
    this.clampToDeck();
    ship.rudder = clamp(-ship.wheelAngle / WHEEL_MAX, -1, 1);
    ship.sail = (0.6 - ship.leverAngle) / 1.2;

    if (!this.dead && G.t - this.lastHurt > 4 && this.health < 100) this.health = Math.min(100, this.health + 10 * dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    const op = this.dead ? 0.85 : this.hurtFlash * 0.45 + Math.max(0, 0.5 - this.health / 100) * 0.4;
    this.vignette.material.opacity = op; this.vignette.visible = op > 0.01;

    for (const it of this.items) {
      if (it.kind === 'musket') {
        if (!it.loaded) {
          it.reloadT -= dt;
          if (it.reloadT <= 0) { it.loaded = true; if (it.holder || this.deskItem === it) { it.obj.getWorldPosition(_a); G.audio.click(_a); } }
        }
        it.gem.material = it.loaded ? READY : EMPTY;
      }
      it.kick = Math.max(0, it.kick - dt * 6);
      it.inner.rotation.x = it.kick * 0.3; it.inner.position.z = it.kick * 0.07;
      if (it.returning) {
        const k = Math.min(1, dt * 5);
        it.obj.position.lerp(it.home.pos, k); it.obj.quaternion.slerp(it.home.quat, k);
        if (it.obj.position.distanceTo(it.home.pos) < 0.01) { it.obj.position.copy(it.home.pos); it.obj.quaternion.copy(it.home.quat); it.returning = false; }
      }
      // Sword in a VR hand: check the blade against boarders
      if (it.kind === 'sword' && it.holder) {
        it.swooshCD -= dt;
        const hilt = it.obj.localToWorld(_a.set(0, 0, -0.12)); ship.root.worldToLocal(hilt);
        const tip = it.obj.localToWorld(_b.set(0, 0, -0.98)); ship.root.worldToLocal(tip);
        const speed = it.hasPrev ? tip.distanceTo(it.prevTip) / Math.max(dt, 1e-3) : 0;
        if (speed > 5.5 && it.swooshCD <= 0) { it.swooshCD = 0.35; it.obj.localToWorld(_c.set(0, 0, -0.6)); G.audio.swoosh(_c); }
        if (G.combat.swordCheck(hilt, tip, speed)) this.haptic(it.holder, 1, 70);
        it.prevTip.copy(tip); it.hasPrev = true;
      } else it.hasPrev = false;
    }
  }
}
