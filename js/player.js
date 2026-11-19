import * as THREE from 'three';
import { halfWidth, RACK } from './ship.js';
import { clamp, angleWrap, canvasTex } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const _seg = new THREE.Line3(), _p = new THREE.Vector3();
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
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.1), LEATHER.clone()); palm.position.z = 0.01; g.add(palm);
  g.userData.palm = palm;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd8cdb4 }));
  cuff.position.z = 0.09; g.add(cuff);
  return g;
}

// A text label drawn on a canvas. Sprites always face the viewer.
function makeLabel(w = 512, h = 128, scale = 0.32) {
  const tex = canvasTex(w, h, () => {});
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.scale.set(scale, scale * h / w, 1); sp.renderOrder = 997; sp.visible = false;
  sp.userData.text = '';
  sp.userData.set = (text) => {
    if (sp.userData.text === text) return; sp.userData.text = text;
    const g = tex.userData.ctx; g.clearRect(0, 0, w, h);
    const lines = text.split('\n'), fs = Math.min(64, (h - 24) / lines.length * 0.85);
    g.fillStyle = 'rgba(20,12,6,0.82)'; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 22); g.fill();
    g.strokeStyle = '#ffd25a'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#fff3cf'; g.font = `bold ${fs}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.15, w - 30));
    tex.needsUpdate = true;
  };
  return sp;
}

const SWORD_TILT = 0.35; // extra upward tilt of the blade in the hand (radians)
const _m = new THREE.Matrix4(), _q2 = new THREE.Quaternion();
const MARK_MAT = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });

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
    const mk = (kind, dz) => {
      const it = kind === 'sword' ? buildSword() : buildMusket();
      Object.assign(it, { kind, home: { pos: new THREE.Vector3(RACK.x + 0.02, 1.0, RACK.z + dz), quat: homeQ.clone() }, holder: null, returning: false,
        loaded: true, reloadT: 0, kick: 0, prevTip: new THREE.Vector3(), hasPrev: false, swooshCD: 0 });
      ship.root.add(it.obj); it.obj.position.copy(it.home.pos); it.obj.quaternion.copy(it.home.quat);
      return it;
    };
    this.items = [mk('musket', -0.45), mk('musket', -0.05), mk('sword', 0.4)];

    // Sign above the rack
    const signTex = canvasTex(1024, 300, (g, w, h) => {
      g.fillStyle = '#e8d6a8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3a2210'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
      g.fillStyle = '#3a2210'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 92px Georgia, serif'; g.fillText('WEAPONS', w / 2, 82);
      g.font = 'bold 54px Georgia, serif'; g.fillText('Squeeze GRIP (side button) to take', w / 2, 170);
      g.fillText('Pull TRIGGER to shoot', w / 2, 240);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.41), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(RACK.x - 0.07, 2.03, RACK.z); sign.rotation.y = Math.PI / 2;
    ship.root.add(sign);
  }

  // ---------- VR ----------
  setupVR(renderer) {
    this.renderer = renderer;
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
      this.dolly.add(ctrl, grip);
      const glove = buildGlove(); grip.add(glove);
      const mark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), MARK_MAT); mark.renderOrder = 996; mark.visible = false;
      const label = makeLabel();
      this.G.scene.add(mark, label);
      const h = { i, ctrl, grip, glove, mark, label, src: null, gp: null, side: '', trig: false, sq: false, evTrig: false, evSq: false,
        held: null, wheelPrev: 0, tickAcc: 0, hover: null, hoverKey: '' };
      ctrl.addEventListener('connected', (e) => { h.src = e.data; h.gp = e.data.gamepad || null; h.side = e.data.handedness; this.checkHands(); });
      ctrl.addEventListener('disconnected', () => { this.release(h); h.src = null; h.gp = null; h.evTrig = h.evSq = false; });
      this.hands.push(h);
    }
    if (this.G.debug) {
      this.dbg = makeLabel(768, 256, 0.45);
      this.dbg.position.set(0, 0.12, -0.05);
    }
  }

  // Called when a VR session starts. The browser's own select (trigger) and squeeze (grip)
  // events are a second, independent way of reading the buttons, alongside polling the gamepad.
  onSession(session) {
    const handFor = (src) => this.hands.find((h) => h.src === src) || this.hands.find((h) => h.side && h.side === src.handedness);
    const on = (type, fn) => session.addEventListener(type, (e) => { const h = handFor(e.inputSource); if (h) fn(h); this.evCount = (this.evCount || 0) + 1; });
    on('selectstart', (h) => { h.evTrig = true; });
    on('selectend', (h) => { h.evTrig = false; });
    on('squeezestart', (h) => { h.evSq = true; });
    on('squeezeend', (h) => { h.evSq = false; });
    session.addEventListener('inputsourceschange', () => this.checkHands());
    if (this.dbg) this.hands[0].grip.add(this.dbg);
  }

  checkHands() {
    const s = this.renderer?.xr.getSession();
    if (s && Array.from(s.inputSources).some((x) => x.hand && !x.gamepad)) this.G.hud.msg('Pick up your controllers to play!', 4);
  }

  haptic(h, intensity, ms) {
    try { const a = h?.gp?.hapticActuators?.[0]; if (a?.pulse) a.pulse(intensity, ms); } catch (e) { /* ignore */ }
  }

  handPos(h, out) { return h.grip.getWorldPosition(out); }

  // What could this hand use right now? Returns { kind, it|c, d, point } or null.
  findTarget(h) {
    const ship = this.G.ship;
    this.handPos(h, _a);
    let best = null, bs = 1;
    const consider = (kind, d, r, extra) => { const sc = d / r; if (sc < bs) { bs = sc; best = { kind, d, ...extra }; } };
    // Second hand on a held musket's fore stock steadies it
    for (const o of this.hands) {
      const it = o.held;
      if (o === h || !it || it.kind !== 'musket' || it.support) continue;
      _seg.start.set(0, 0, -0.15); _seg.end.set(0, 0, -0.85);
      it.obj.localToWorld(_seg.start); it.obj.localToWorld(_seg.end);
      _seg.closestPointToPoint(_a, true, _p);
      consider('support', _a.distanceTo(_p), 0.3, { it, point: _p.clone() });
    }
    if (best) return best;
    for (const it of this.items) {
      if (it.holder || this.deskItem === it) continue;
      _seg.start.set(0, 0, it.kind === 'sword' ? 0.08 : 0.3); _seg.end.set(0, 0, it.kind === 'sword' ? -0.45 : -0.6);
      it.obj.localToWorld(_seg.start); it.obj.localToWorld(_seg.end);
      _seg.closestPointToPoint(_a, true, _p);
      consider('item', _a.distanceTo(_p), 0.3, { it, point: _p.clone() });
    }
    _b.copy(_a); ship.wheelBase.worldToLocal(_b);
    const rr = Math.hypot(_b.x, _b.y);
    if (rr > 0.2 && rr < 0.9 && Math.abs(_b.z) < 0.35) {
      _c.set(_b.x / rr * 0.58, _b.y / rr * 0.58, 0); ship.wheelBase.localToWorld(_c);
      consider('wheel', Math.max(Math.abs(rr - 0.58), Math.abs(_b.z)), 0.4, { point: _c.clone() });
    }
    ship.leverKnob.getWorldPosition(_c);
    consider('lever', _a.distanceTo(_c), 0.3, { point: _c.clone() });
    for (const c of ship.cannons) {
      _seg.start.set(0, 0.05, 0.7); _seg.end.set(0, 0.05, -0.3);
      c.elev.localToWorld(_seg.start); c.elev.localToWorld(_seg.end);
      _seg.closestPointToPoint(_a, true, _p);
      consider('cannon', _a.distanceTo(_p), 0.6, { c, point: c.breech.getWorldPosition(new THREE.Vector3()) });
    }
    return best;
  }

  grab(h) {
    const t = this.findTarget(h);
    if (!t) { this.haptic(h, 0.08, 15); return; }
    if (t.kind === 'cannon') { this.useCannon(h, t.c); return; }
    if (t.kind === 'support') {
      h.held = 'support'; h.supporting = t.it; t.it.support = h; this.haptic(h, 0.3, 30);
      return;
    }
    if (t.kind === 'item') {
      const best = t.it;
      h.held = best; best.holder = h; best.returning = false; best.hasPrev = false;
      if (best.kind === 'sword') {
        // Held like a real sword: blade comes up out of the top of the fist
        h.grip.add(best.obj); best.obj.position.set(0, 0, 0.02); best.obj.rotation.set(SWORD_TILT, 0, 0);
      } else { h.ctrl.add(best.obj); best.obj.position.set(0, -0.01, 0.06); best.obj.quaternion.identity(); }
      h.glove.visible = false;
      this.haptic(h, 0.4, 40);
      if (!this.toldItem?.[best.kind]) {
        this.toldItem = { ...this.toldItem, [best.kind]: true };
        if (best.kind === 'musket') { this.G.hud.msg('Aim and pull TRIGGER to shoot', 3.5); this.G.hud.msg('Grip the barrel with your other hand to steady it', 4); }
        else this.G.hud.msg('Swing hard at boarders to cut them down', 4);
      }
      return;
    }
    if (t.kind === 'wheel') { _b.copy(this.handPos(h, _a)); this.G.ship.wheelBase.worldToLocal(_b); h.wheelPrev = Math.atan2(_b.y, _b.x); }
    h.held = t.kind; this.haptic(h, 0.3, 30);
  }

  useCannon(h, c) {
    const G = this.G;
    c.breech.getWorldPosition(_b);
    if (G.ship.lightCannon(c, 0.35)) { G.audio.fuse(_b); this.haptic(h, 0.5, 60); this.cannonsFired = (this.cannonsFired || 0) + 1; G.crew.playerFired?.(); }
    else if (c.reload > 0) { G.hud.msg('That cannon is still reloading', 1.5); G.audio.click(_b); }
  }

  release(h) {
    const it = h.held;
    if (it === 'support') { if (h.supporting) h.supporting.support = null; h.supporting = null; }
    if (it && typeof it === 'object') {
      if (it.support) { const o = it.support; it.support = null; o.supporting = null; o.held = null; }
      this.G.ship.root.attach(it.obj); it.holder = null; it.returning = true;
    }
    h.held = null; h.glove.visible = true;
  }

  triggerPress(h) {
    if (h.held && h.held.kind === 'musket') { this.fireMusket(h.held, h); return; }
    if (h.held === 'support' && h.supporting) { this.fireMusket(h.supporting, h.supporting.holder); return; }
    if (h.held) return;
    const t = this.findTarget(h);
    if (t && t.kind === 'cannon') this.useCannon(h, t.c);
    else if (t) this.G.hud.msg('Squeeze GRIP (the side button) to grab', 2);
  }

  // Glowing dot + label on whatever an empty hand could use.
  updateHover(h) {
    let t = null;
    if (!h.held && h.src && !this.dead) t = this.findTarget(h);
    let text = '';
    if (t) {
      if (t.kind === 'support') text = 'GRIP to steady';
      else if (t.kind === 'item') text = t.it.kind === 'musket' ? 'GRIP to take musket' : 'GRIP to take cutlass';
      else if (t.kind === 'wheel') text = 'GRIP to steer';
      else if (t.kind === 'lever') text = 'GRIP and push:\nmore sail';
      else if (t.kind === 'cannon') text = this.G.ship.cannonReady(t.c) ? 'TRIGGER to fire!' : `Reloading... ${Math.ceil(t.c.reload)}`;
    }
    const key = t ? t.kind + (t.it ? t.it.kind + this.items.indexOf(t.it) : '') + (t.c ? this.G.ship.cannons.indexOf(t.c) : '') : '';
    if (key && key !== h.hoverKey) this.haptic(h, 0.15, 15);
    h.hoverKey = key;
    h.mark.visible = h.label.visible = !!t;
    if (t) {
      h.mark.position.copy(t.point);
      h.mark.scale.setScalar(1 + Math.sin(this.G.t * 8) * 0.2);
      h.label.position.copy(t.point); h.label.position.y += 0.2;
      h.label.userData.set(text);
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

  // Two hands on a musket: point the barrel from the trigger hand toward the steadying hand.
  aimTwoHanded(h) {
    const it = h.held, o = it.support;
    if (!o) { it.obj.position.set(0, -0.01, 0.06); it.obj.quaternion.identity(); return; }
    h.ctrl.updateWorldMatrix(true, false);
    it.obj.position.set(0, -0.01, 0.06);
    const from = h.ctrl.localToWorld(_a.copy(it.obj.position)), to = this.handPos(o, _b);
    _c.subVectors(to, from); if (_c.lengthSq() < 0.01) return;
    _p.set(0, 1, 0).applyQuaternion(h.ctrl.getWorldQuaternion(_q2)); // keep the trigger hand's "up"
    _m.lookAt(from, to, _p);      // makes -Z point from 'from' to 'to'
    _q.setFromRotationMatrix(_m);
    it.obj.quaternion.copy(_q2.invert()).multiply(_q);
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
    const session = this.renderer?.xr.getSession();
    const srcs = session ? Array.from(session.inputSources) : [];
    for (const h of this.hands) {
      // Re-read the input source every frame instead of trusting what we saw at connect time.
      if (!h.src || !srcs.includes(h.src)) { const s2 = srcs.find((x) => h.side && x.handedness === h.side); if (s2) h.src = s2; }
      h.gp = h.src?.gamepad || null;
      const b = h.gp ? h.gp.buttons : [], ax = h.gp ? h.gp.axes : [];
      const btn = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      const trig = h.evTrig || btn(0), sq = h.evSq || btn(1);
      if (sq && !h.sq) this.grab(h);
      if (!sq && h.sq) this.release(h);
      if (trig && !h.trig) this.triggerPress(h);
      h.trig = trig; h.sq = sq;
      // Glove clenches and lights up so you can see the buttons are working
      h.glove.scale.set(1, sq ? 0.7 : 1, sq ? 0.8 : 1);
      h.glove.userData.palm.material.color.setHex(trig ? 0xc87a3a : sq ? 0x7a5230 : 0x4a2e1a);
      if (h.held && h.held.kind === 'musket') this.aimTwoHanded(h);
      if (h.held === 'wheel') this.updateWheel(h, dt);
      else if (h.held === 'lever') this.updateLever(h);
      this.updateHover(h);
      if (!h.gp) continue;
      const sx = ax.length >= 4 ? ax[2] : ax[0] || 0, sy = ax.length >= 4 ? ax[3] : ax[1] || 0;
      if (h.side === 'left') this.move(sx, sy, dt);
      if (h.side === 'right') {
        if (Math.abs(sx) > 0.7 && !this.snapLatch) { this.snapLatch = true; this.snapTurn(sx > 0 ? -Math.PI / 4 : Math.PI / 4); }
        else if (Math.abs(sx) < 0.3) this.snapLatch = false;
      }
    }
    if (this.dbg && (this.dbgT = (this.dbgT || 0) - dt) <= 0) {
      this.dbgT = 0.2;
      const f = (h) => { const b = h.gp?.buttons || []; return `${h.side || '?'}: gp ${h.gp ? b.length : 'none'} T${(b[0]?.value ?? 0).toFixed(1)} G${(b[1]?.value ?? 0).toFixed(1)} ev ${h.evTrig ? 'T' : '-'}${h.evSq ? 'G' : '-'}`; };
      this.dbg.userData.set(`${f(this.hands[0])}\n${f(this.hands[1])}\nsources ${srcs.length} events ${this.evCount || 0}`);
      this.dbg.visible = true;
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
    for (const h of this.hands) { this.release(h); h.evTrig = h.evSq = false; }
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
