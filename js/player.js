import * as THREE from 'three';
import { halfWidth, RACK, WHEEL_MAX, BALL_SPEED } from './ship.js';
import { waveHeight } from './waves.js';
import { GRAPPLE_RANGE } from './grapple.js';
import { ORDER_TEXT } from './crew.js';
import { clamp, angleWrap, canvasTex } from './util.js';
import { Kit, addCutlass, addMusket } from './kit.js';
import { buildHammer, buildBucket, HAMMER_HOME, BUCKET_HOME, TUB, LEAK_BLOWS, MAST_BLOWS } from './damage.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const _seg = new THREE.Line3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const READY = new THREE.MeshBasicMaterial({ color: 0x40ff60 });
const EMPTY = new THREE.MeshBasicMaterial({ color: 0xff3020 });

// Items are built so the hand holds the origin and the business end points down -Z.
// Each is one merged, flat-shaded mesh (see kit.js), styled after the reference art.
function buildMusket() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const k = new Kit(); const [my, mz] = addMusket(k); inner.add(k.mesh());
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), READY); gem.position.set(0, 0.062, 0.1); inner.add(gem);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, my, mz); inner.add(muzzle);
  return { obj, inner, gem, muzzle };
}

function buildSword() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const k = new Kit(); addCutlass(k, 0.9); inner.add(k.mesh());
  return { obj, inner };
}

// A dark leather glove with a flared gauntlet cuff. The material is the glove's own so it
// can glow a little when you squeeze or pull the trigger.
const GLOVE = 0x2e2622, GLOVE_DARK = 0x221c19;
export function buildGlove() {
  const g = new THREE.Group(), k = new Kit();
  k.box(0.078, 0.042, 0.095, GLOVE, [0, 0, 0.005]);                                  // back of hand
  for (let i = 0; i < 4; i++) {                                                        // fingers, curled a little
    const x = -0.027 + i * 0.018, len = i === 0 || i === 3 ? 0.045 : 0.052;
    k.box(0.017, 0.022, len, GLOVE, [x, -0.008, -0.062], [-0.35, 0, 0]);
    k.box(0.016, 0.02, 0.03, GLOVE, [x, -0.03, -0.092], [-1.2, 0, 0]);
  }
  k.cyl(0.047, 0.062, 0.1, 7, GLOVE_DARK, [0, 0.0, 0.1], [Math.PI / 2, 0, 0]);          // gauntlet
  k.cyl(0.064, 0.064, 0.014, 7, 0x4a3a2c, [0, 0.0, 0.148], [Math.PI / 2, 0, 0]);        // cuff edge
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const palm = k.mesh(mat); g.add(palm);
  const tk = new Kit(); tk.box(0.02, 0.022, 0.05, GLOVE, [0, 0, 0], [-0.3, 0.5, 0]);
  const thumb = tk.mesh(mat); thumb.position.set(-0.045, -0.012, -0.025); g.add(thumb);
  g.userData.palm = palm; g.userData.thumb = thumb;
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

// The LOCAL player: reads the VR controllers or keyboard/mouse, moves the camera, and draws
// your hands and held weapons. Anything that changes the game goes through G.act() (see
// actions.js), so the same rules can later run on the host for friends' headsets too.
// The fields id, headLocal, health, dead and lastHurt are this player's game state; a remote
// friend will be a lighter object with the same fields (see docs/MULTIPLAYER.md).
export class Player {
  constructor(G, id = 'player:0') {
    this.G = G; this.id = id;
    const ship = G.ship;
    this.dolly = new THREE.Group(); ship.root.add(this.dolly);
    this.dolly.position.set(0, 0, 6.5);
    this.dolly.add(G.camera); G.camera.position.set(0, 1.7, 0);
    this.health = 100; this.lastHurt = -99; this.dead = false; this.hurtFlash = 0;
    this.ship = ship; // the ship this player is standing on
    this.headLocal = new THREE.Vector3(0, 1.7, 6.5);
    this.hands = []; this.snapLatch = false;
    this.yaw = 0; this.pitch = 0; this.keys = {}; this.deskItem = null; this.swing = -1; this.deskReady = false;

    this.vignette = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x8a0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    this.vignette.renderOrder = 999; this.vignette.visible = false; G.camera.add(this.vignette);
    // A quick fade from black when you row ashore or back aboard (easier on the stomach than a jump)
    this.blinker = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    this.blinker.renderOrder = 1000; this.blinker.visible = false; G.camera.add(this.blinker); this.blinkT = 0;

    const homeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const mk = (kind, dz, home) => {
      const it = kind === 'sword' ? buildSword() : kind === 'hammer' ? buildHammer() : kind === 'bucket' ? buildBucket() : buildMusket();
      home = home || { pos: new THREE.Vector3(RACK.x + 0.02, 1.0, RACK.z + dz), quat: homeQ.clone() };
      Object.assign(it, { id: G.ids.next('item'), heldBy: null, kind, home, holder: null, returning: false,
        loaded: true, reloadT: 0, kick: 0, prevTip: new THREE.Vector3(), hasPrev: false, swooshCD: 0, full: kind === 'bucket' ? false : undefined, hitCD: 0 });
      ship.root.add(it.obj); it.obj.position.copy(it.home.pos); it.obj.quaternion.copy(it.home.quat);
      return it;
    };
    this.items = [mk('musket', -0.55), mk('musket', -0.2), mk('sword', 0.12),
      // Repair tools: the hammer hangs head-up on its peg, the bucket on its hook (damage.js)
      mk('hammer', 0, { pos: new THREE.Vector3(HAMMER_HOME.x, HAMMER_HOME.y, HAMMER_HOME.z), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)) }),
      mk('bucket', 0, { pos: new THREE.Vector3(BUCKET_HOME.x, BUCKET_HOME.y, BUCKET_HOME.z), quat: new THREE.Quaternion() }),
      // Spare cutlasses, so everyone going ashore can have one (added last so the ids above don't move)
      mk('sword', 0.36), mk('sword', 0.6)];

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
      ctrl.addEventListener('connected', (e) => { h.src = e.data; h.gp = e.data.gamepad || null; h.side = e.data.handedness; glove.userData.thumb.position.x = h.side === 'left' ? 0.045 : -0.045; this.checkHands(); });
      ctrl.addEventListener('disconnected', () => { this.release(h); h.src = null; h.gp = null; h.evTrig = h.evSq = false; });
      this.hands.push(h);
    }
    // Orders card on the left wrist: what Hawkins is doing and how to change it
    this.orderCard = makeLabel(640, 230, 0.22);
    this.orderCard.renderOrder = 995;
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
      if (it.holder || this.deskItem === it || (it.heldBy && it.heldBy !== this.id)) continue; // in a friend's hand
      if (it.kind === 'hammer') { _seg.start.set(0, 0, 0.06); _seg.end.set(0, 0, -0.32); }
      else if (it.kind === 'bucket') { _seg.start.set(0, 0.1, -0.1); _seg.end.set(0, -0.2, -0.1); }
      else { _seg.start.set(0, 0, it.kind === 'sword' ? 0.08 : 0.3); _seg.end.set(0, 0, it.kind === 'sword' ? -0.45 : -0.6); }
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
    const gh = this.G.grapples.handle.getWorldPosition(_c);
    consider('grapple', _a.distanceTo(gh), 0.3, { point: _c.clone() });
    const keg = this.ship.keg;
    if (keg && keg.fuse === -1 && keg.obj.visible) { keg.obj.getWorldPosition(_c); _c.y += 0.55; consider('keg', _a.distanceTo(_c), 0.5, { point: _c.clone() }); }
    for (const c of ship.cannons) {
      _seg.start.set(0, 0.05, 0.7); _seg.end.set(0, 0.05, -0.3);
      c.elev.localToWorld(_seg.start); c.elev.localToWorld(_seg.end);
      _seg.closestPointToPoint(_a, true, _p);
      consider('cannon', _a.distanceTo(_p), 0.6, { c, point: c.breech.getWorldPosition(new THREE.Vector3()) });
    }
    this.G.island?.targets(this, _a, consider); // ashore: the treasure chest and the prize cards
    return best;
  }

  grab(h) {
    const t = this.findTarget(h);
    if (!t) { this.haptic(h, 0.08, 15); return; }
    if (t.kind === 'cannon') {
      // Take hold of the cannon: move your hand to lay it, TRIGGER fires it
      const c = t.c;
      if (this.hands.some((o) => o !== h && o.held === 'cannon' && o.cannon === c)) return;
      this.handPos(h, _b); this.ship.root.worldToLocal(_b);
      h.held = 'cannon'; h.cannon = c; h.cStart = { yaw: c.yaw, elev: c.elevation, z: _b.z, y: _b.y };
      this.G.act({ type: 'aimCannon', cannon: c.id, yaw: c.yaw, elev: c.elevation });
      this.haptic(h, 0.35, 40);
      if (!this.toldCannon) { this.toldCannon = true; this.G.hud.msg('Move your hand to aim the cannon', 3.5); this.G.hud.msg('TRIGGER fires. Let go and it aims itself again', 4); }
      return;
    }
    if (t.kind === 'support') {
      h.held = 'support'; h.supporting = t.it; t.it.support = h; this.haptic(h, 0.3, 30);
      return;
    }
    if (t.kind === 'item') {
      const best = t.it;
      if (!this.G.act({ type: 'takeItem', item: best.id })) return;
      h.held = best; best.holder = h; best.returning = false; best.hasPrev = false; best.belt = false;
      if (best.kind === 'sword' || best.kind === 'hammer') {
        // Held like a real sword: blade comes up out of the top of the fist
        h.grip.add(best.obj); best.obj.position.set(0, 0, 0.02); best.obj.rotation.set(SWORD_TILT, 0, 0);
      } else if (best.kind === 'bucket') {
        h.grip.add(best.obj); best.obj.position.set(0, 0, 0); best.obj.rotation.set(0, 0, 0);
      } else { h.ctrl.add(best.obj); best.obj.position.set(0, -0.01, 0.06); best.obj.quaternion.identity(); }
      h.glove.visible = false;
      this.haptic(h, 0.4, 40);
      if (!this.toldItem?.[best.kind]) {
        this.toldItem = { ...this.toldItem, [best.kind]: true };
        if (best.kind === 'musket') { this.G.hud.msg('Aim and pull TRIGGER to shoot', 3.5); this.G.hud.msg('Grip the barrel with your other hand to steady it', 4); }
        else if (best.kind === 'hammer') { this.G.hud.msg('Bang it on a leak 3 times to plank it over', 4); this.G.hud.msg('A snapped mast takes 6 blows at its foot', 4); }
        else if (best.kind === 'bucket') { this.G.hud.msg('Dip it in the water tub to fill it', 3.5); this.G.hud.msg('Then tip it over a fire to put it out', 3.5); }
        else this.G.hud.msg('Swing hard at boarders to cut them down', 4);
      }
      return;
    }
    if (t.kind === 'keg') { this.lightKeg(h); return; }
    if (t.kind === 'chest' || t.kind === 'card') { this.useTreasure(h, t); return; }
    if (t.kind === 'ladder' || t.kind === 'oar') { this.G.island.boat.grab(this, h, t); return; }
    if (t.kind === 'grapple') {
      // Aiming works by moving your hand: right swings the gun right, up raises it
      const gr = this.G.grapples;
      this.G.act({ type: 'holdGrapple', hold: true });
      this.handPos(h, _b); this.ship.root.worldToLocal(_b);
      this.G.camera.getWorldPosition(_c); this.ship.root.worldToLocal(_c);
      h.gStart = { yaw: gr.aimYaw, pitch: gr.aimPitch, a0: Math.atan2(-(_b.x - _c.x), -(_b.z - _c.z)), y0: _b.y };
    }
    if (t.kind === 'grapple' && !this.toldGrapple) {
      this.toldGrapple = true;
      this.G.hud.msg('Point it at an enemy ship and pull TRIGGER', 4);
      this.G.hud.msg(`The rope reaches about ${GRAPPLE_RANGE} m`, 3);
    }
    if (t.kind === 'wheel') { _b.copy(this.handPos(h, _a)); this.G.ship.wheelBase.worldToLocal(_b); h.wheelPrev = Math.atan2(_b.y, _b.x); }
    h.held = t.kind; this.haptic(h, 0.3, 30);
  }

  useCannon(h, c) {
    const G = this.G;
    const r = G.act({ type: 'lightCannon', cannon: c.id, delay: 0.35 });
    if (r === 'lit') { this.haptic(h, 0.5, 60); this.cannonsFired = (this.cannonsFired || 0) + 1; }
    else if (r === 'reloading') { G.hud.msg('That cannon is still reloading', 1.5); G.audio.click(c.breech.getWorldPosition(_b)); }
  }

  release(h) {
    const it = h.held;
    if (it === 'ladder' || it === 'oar') { this.G.island.boat.release(this, h); h.held = null; h.glove.visible = true; return; }
    if (it === 'grapple') this.G.act({ type: 'holdGrapple', hold: false });
    if (it === 'cannon' && h.cannon) { this.G.act({ type: 'releaseCannon', cannon: h.cannon.id }); h.cannon = null; }
    if (it === 'support') { if (h.supporting) h.supporting.support = null; h.supporting = null; }
    if (it && typeof it === 'object') {
      if (it.support) { const o = it.support; it.support = null; o.supporting = null; o.held = null; }
      if (this.beltZone()) this.toBelt(it); // ashore: it hangs on your belt instead of flying home
      else { this.G.ship.root.attach(it.obj); it.holder = null; it.returning = true; this.G.act({ type: 'dropItem', item: it.id }); }
    }
    h.held = null; h.glove.visible = true;
  }

  triggerPress(h) {
    if (h.held && h.held.kind === 'musket') { this.fireMusket(h.held, h); return; }
    if (h.held === 'support' && h.supporting) { this.fireMusket(h.supporting, h.supporting.holder); return; }
    if (h.held === 'grapple') { this.fireGrapple(h); return; }
    if (h.held === 'cannon' && h.cannon) { this.useCannon(h, h.cannon); return; }
    if (h.held) return;
    const t = this.findTarget(h);
    if (t && t.kind === 'keg') { this.lightKeg(h); return; }
    if (t && (t.kind === 'chest' || t.kind === 'card')) { this.useTreasure(h, t); return; }
    if (t && t.kind === 'ladder') { this.G.island.boat.trigger(this, h, t); return; }
    if (t && t.kind === 'cannon') this.useCannon(h, t.c);
    else if (t) this.G.hud.msg('Squeeze GRIP (the side button) to grab', 2);
  }

  // Glowing dot + label on whatever an empty hand could use.
  updateHover(h) {
    let t = null;
    if (!h.held && h.src && !this.dead) t = this.findTarget(h);
    else if (h.held && h.src && !this.dead && (h.held.kind === 'hammer' || h.held.kind === 'bucket')) t = this.toolHint(h);
    let text = t?.text || '';
    if (t) {
      if (t.kind === 'support') text = 'GRIP to steady';
      else if (t.kind === 'item') text = { musket: 'GRIP to take musket', sword: 'GRIP to take cutlass', hammer: 'GRIP to take\nthe hammer', bucket: 'GRIP to take\nthe bucket' }[t.it.kind];
      else if (t.kind === 'wheel') text = 'GRIP to steer';
      else if (t.kind === 'lever') text = 'GRIP and push:\nmore sail';
      else if (t.kind === 'grapple') text = this.G.grapples.anyLineOut() ? 'GRIP, TRIGGER:\ncut the lines' : 'GRIP, then move\nyour hand to aim';
      else if (t.kind === 'keg') text = 'TRIGGER to light\nthe powder keg';
      else if (t.kind === 'cannon') text = this.G.ship.cannonReady(t.c) ? 'TRIGGER to fire!\nGRIP to aim it' : `Reloading... ${Math.ceil(t.c.reload)}`;
    }
    const key = t ? t.kind + (t.it ? t.it.kind + this.items.indexOf(t.it) : '') + (t.c ? this.G.ship.cannons.indexOf(t.c) : '') + (t.id || '') : '';
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

  // VR: the shot goes down the barrel. Desktop (h = null): it goes where the crosshair points.
  fireMusket(it, h) {
    const G = this.G;
    it.muzzle.getWorldPosition(_a);
    if (h) { it.obj.getWorldQuaternion(_q); _b.set(0, 0, -1).applyQuaternion(_q); _c.copy(_a); }
    else { G.camera.getWorldPosition(_c); G.camera.getWorldDirection(_b); }
    if (G.act({ type: 'fireMusket', item: it.id, origin: _c, dir: _b, from: _a }) && h) this.haptic(h, 1, 90);
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

  // ---------- Repair tools (see damage.js) ----------
  // A hammer or bucket in a VR hand, every frame: swing the hammer into a leak or a snapped
  // mast to land a blow; dip the bucket in the tub to fill it, tip it over to throw the water.
  useTool(it, dt) {
    const G = this.G, S = G.ship, h = it.holder;
    if (this.ship !== S) return;
    if (it.kind === 'hammer') {
      const head = it.obj.localToWorld(_a.set(0, 0.075, -0.31)); S.root.worldToLocal(head);
      const speed = it.hasPrev ? head.distanceTo(it.prevTip) / Math.max(dt, 1e-3) : 0;
      it.prevTip.copy(head); it.hasPrev = true;
      if (it.hitCD > 0 || speed < 1.3) return;
      const tgt = G.damage.hammerTarget(head, 0.28);
      if (!tgt) return;
      it.hitCD = 0.3;
      if (G.act({ type: 'hammer', item: it.id, target: tgt.id })) this.haptic(h, 1, 60);
      return;
    }
    // Bucket
    const mouth = it.mouth.getWorldPosition(_a), up = _b.set(0, 1, 0).applyQuaternion(it.obj.getWorldQuaternion(_q));
    const ml = S.root.worldToLocal(_c.copy(mouth));
    if (!it.full) {
      if (Math.hypot(ml.x - TUB.x, ml.z - TUB.z) < TUB.r + 0.08 && ml.y < TUB.h + 0.12 && G.act({ type: 'fillBucket', item: it.id, pos: mouth.clone() })) this.haptic(h, 0.5, 80);
      return;
    }
    if (up.y < 0.2 && it.hitCD <= 0) {
      // The water flies out the way the mouth faces and lands on the deck a little way off
      S.root.getWorldQuaternion(_q).invert(); up.applyQuaternion(_q); up.y = 0;
      if (up.lengthSq() > 1e-4) up.normalize();
      const x = ml.x + up.x * 0.7, z = ml.z + up.z * 0.7;
      it.hitCD = 0.5;
      G.act({ type: 'pourBucket', item: it.id, x, z, from: mouth.clone(), to: S.root.localToWorld(new THREE.Vector3(x, 0.1, z)) });
      this.haptic(h, 0.6, 120);
    }
  }

  // Holding a tool: point out what it could be used on next.
  toolHint(h) {
    const G = this.G, S = G.ship, D = G.damage, it = h.held;
    if (this.ship !== S) return null;
    const hand = S.root.worldToLocal(this.handPos(h, _a));
    let best = null, bd = 1e9;
    const consider = (d, max, o) => { if (d < max && d < bd) { bd = d; best = o; } };
    if (it.kind === 'hammer') {
      for (const l of D.leaks) consider(Math.hypot(hand.x - l.x, hand.y - l.y, hand.z - l.z), 1.4, { kind: 'tool', id: l.id, local: [l.x, l.y, l.z], text: `Hammer the leak!\n${LEAK_BLOWS - l.blows} more` });
      for (const M of D.masts) if (M.broken) {
        const y = clamp(hand.y, 0.9, 2.3), d = Math.hypot(hand.x, hand.z - M.z);
        const k = (M.r + 0.03) / Math.max(d, 1e-3);
        consider(d, 1.6, { kind: 'tool', id: M.id, local: [hand.x * k, y, M.z + (hand.z - M.z) * k], text: `Hammer the splint!\n${MAST_BLOWS - M.blows} more` });
      }
    } else if (!it.full) {
      consider(Math.hypot(hand.x - TUB.x, hand.z - TUB.z), 1.6, { kind: 'tool', id: 'tub', local: [TUB.x, TUB.h, TUB.z], text: 'Dip the bucket\nin the water' });
    } else {
      for (const f of D.fires) consider(Math.hypot(hand.x - f.x, hand.z - f.z), 3.5, { kind: 'tool', id: f.id, local: [f.x, 0.5, f.z], text: 'Tip the bucket\nover the fire' });
    }
    if (best) best.point = S.root.localToWorld(new THREE.Vector3(...best.local));
    return best;
  }

  // Desktop: click with the hammer at a leak or the snapped mast you are looking at.
  deskHammer(it) {
    const G = this.G, S = G.ship, D = G.damage;
    if (this.ship !== S) return;
    const eye = S.root.worldToLocal(G.camera.getWorldPosition(_a));
    S.root.getWorldQuaternion(_q).invert();
    const dir = G.camera.getWorldDirection(_b).applyQuaternion(_q);
    let best = null, bs = 0.78;
    const consider = (o, x, y, z) => {
      _c.set(x - eye.x, y - eye.y, z - eye.z); const d = _c.length();
      if (d > 2.8) return; const s = _c.normalize().dot(dir);
      if (s > bs) { bs = s; best = o; }
    };
    for (const l of D.leaks) consider(l, l.x, l.y, l.z);
    for (const M of D.masts) if (M.broken) consider(M, 0, clamp(eye.y + dir.y * 1.5, 0.9, 2.3), M.z);
    if (!best) { G.audio.thud(G.camera.getWorldPosition(_a)); if (D.anyDamage) G.hud.msg('Look at a leak or the snapped mast, up close', 1.6); return; }
    G.act({ type: 'hammer', item: it.id, target: best.id });
  }

  // Desktop: click with the bucket. Near the tub it fills; full, it throws where you look.
  deskBucket(it) {
    const G = this.G, S = G.ship;
    if (this.ship !== S) return;
    const eye = S.root.worldToLocal(G.camera.getWorldPosition(_a));
    if (!it.full) {
      if (Math.hypot(eye.x - TUB.x, eye.z - TUB.z) < 2.2) G.act({ type: 'fillBucket', item: it.id, pos: S.root.localToWorld(new THREE.Vector3(TUB.x, TUB.h, TUB.z)) });
      else G.hud.msg('Empty. Fill it at the water tub (port side, by the rack)', 2.5);
      return;
    }
    S.root.getWorldQuaternion(_q).invert();
    const dir = G.camera.getWorldDirection(_b).applyQuaternion(_q);
    let tt = dir.y < -0.05 ? -eye.y / dir.y : 2.5; tt = Math.min(tt, 5);
    const x = eye.x + dir.x * tt, z = eye.z + dir.z * tt;
    G.act({ type: 'pourBucket', item: it.id, x, z, from: it.mouth.getWorldPosition(new THREE.Vector3()), to: S.root.localToWorld(new THREE.Vector3(x, 0.1, z)) });
  }

  // Light the keg on the prize you're standing on, then run for it.
  lightKeg(h) {
    if (this.G.act({ type: 'lightKeg', ship: this.ship.id }) && h) this.haptic(h, 0.6, 60);
  }

  // Holding a cannon: move your hand right and the muzzle swings right; up raises it.
  aimCannonByHand(h) {
    const c = h.cannon, st = h.cStart; if (!c || !st) return;
    this.handPos(h, _b); this.ship.root.worldToLocal(_b);
    const right = (_b.z - st.z) * c.side; // the player faces outboard, so "right" is along +z * side
    this.G.act({ type: 'aimCannon', cannon: c.id, yaw: st.yaw - right * 1.6, elev: st.elev + (_b.y - st.y) * 1.3 });
    this.showCannonLine(c);
  }

  // Dotted path of the ball from a hand-aimed cannon (green when it would hit a ship).
  showCannonLine(c) {
    const G = this.G;
    if (!this.cannonLine) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 40), 3));
      this.cannonLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.75, depthWrite: false }));
      this.cannonLine.frustumCulled = false; G.scene.add(this.cannonLine);
    }
    c.outer.updateMatrixWorld(true);
    const pos = c.muzzle.getWorldPosition(new THREE.Vector3()), vel = c.elev.getWorldDirection(new THREE.Vector3()).negate().multiplyScalar(BALL_SPEED).add(G.ship.vel);
    const pa = this.cannonLine.geometry.attributes.position;
    let n = 0, hit = false;
    for (let i = 0; i < 400 && n < 40; i++) {
      if (i % 10 === 0) pa.setXYZ(n++, pos.x, pos.y, pos.z);
      vel.y -= 9.81 * 0.01; pos.addScaledVector(vel, 0.01);
      if (G.enemies.ships.some((e) => e.alive && e.containsWorld(pos))) { hit = true; break; }
      if (pos.y < waveHeight(pos.x, pos.z, G.t)) break;
    }
    pa.setXYZ(n++, pos.x, pos.y, pos.z);
    for (let i = n; i < 40; i++) pa.setXYZ(i, pos.x, pos.y, pos.z);
    pa.needsUpdate = true;
    this.cannonLine.material.color.setHex(hit ? 0x50ff60 : 0xffd25a);
    this.cannonLineT = 0.1;
  }

  // Holding the grapple gun: it swings as your hand moves around it (2x, so small moves go far).
  aimGrapple(h) {
    const st = h.gStart; if (!st) return;
    this.handPos(h, _b); this.ship.root.worldToLocal(_b);
    this.G.camera.getWorldPosition(_c); this.ship.root.worldToLocal(_c);
    const a = Math.atan2(-(_b.x - _c.x), -(_b.z - _c.z));
    this.G.act({ type: 'aimGrapple', yaw: st.yaw + angleWrap(a - st.a0) * 2, pitch: st.pitch + (_b.y - st.y0) * 1.2 });
    this.G.grapples.aimShown = true;
  }

  // Fire the grapple hook where the gun points (or cut the lines if they're out).
  fireGrapple(h) {
    const r = this.G.act({ type: 'fireGrapple', dir: this.G.grapples.gunDir(new THREE.Vector3()) });
    if (h) this.haptic(h, r === 'fired' ? 0.9 : 0.3, r === 'fired' ? 90 : 30);
    if (r === 'busy' && this.G.grapples.locks.length) this.G.hud.msg('Can’t cut the lines while you’re over there!', 2);
  }

  updateWheel(h, dt) {
    const ship = this.G.ship;
    this.handPos(h, _b); ship.wheelBase.worldToLocal(_b);
    const a = Math.atan2(_b.y, _b.x);
    const d = angleWrap(a - h.wheelPrev); h.wheelPrev = a;
    const nHands = this.hands.filter((x) => x.held === 'wheel').length;
    h.tickAcc += Math.abs(this.G.act({ type: 'steer', delta: d / nHands }));
    if (h.tickAcc > 0.35) { h.tickAcc = 0; this.haptic(h, 0.15, 12); }
  }

  updateLever(h) {
    const ship = this.G.ship;
    this.handPos(h, _b); ship.leverBase.worldToLocal(_b);
    this.G.act({ type: 'setSail', angle: Math.atan2(_b.z, _b.y) });
  }

  move(x, y, dt) {
    if (this.climb) return;
    if (this.ship.isBoat && this.G.island.boat.stick(this, x, y, dt)) return; // in the longboat the stick rows
    if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) return;
    const ship = this.ship;
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
    const ship = this.ship;
    this.G.camera.getWorldPosition(_a); ship.root.worldToLocal(_a);
    this.dolly.position.sub(_a).applyAxisAngle(UP, a).add(_a);
    this.dolly.rotation.y += a;
  }

  // Keep the player's head over the deck (and out of the masts).
  clampToDeck(depth = 0) {
    const ship = this.ship;
    if (ship.isShore) { this.G.island.clampWalker(this); return; } // ashore: on dry land, feet on the ground
    if (this.climb) { this.G.island.boat.clampClimber(this, this.lastDt); return; } // on the rope ladder (rowboat.js)
    if (ship.isBoat) { this.G.island.boat.clampRider(this); return; } // in the longboat
    this.dolly.updateMatrixWorld(true);
    this.G.camera.getWorldPosition(_a); ship.root.worldToLocal(_a);
    // Lashed alongside another ship: you can climb over the rail onto her deck
    const other = this.G.grapples?.linkedShip(ship);
    if (other && Math.abs(_a.x) > halfWidth(clamp(_a.z, -8.6, 6.95)) - 0.45) {
      this.G.camera.getWorldPosition(_b); other.root.worldToLocal(_b);
      const hwO = halfWidth(clamp(_b.z, -8.6, 6.95));
      if (_b.z > -8.6 && _b.z < 6.95 && Math.abs(_b.x) < hwO + 1.6) {
        if (Math.abs(_b.x) < hwO - 0.5 && depth < 2) { this.transfer(other); this.clampToDeck(depth + 1); return; }
        this.headLocal.copy(_a); // climbing across between the two rails
        return;
      }
    }
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
      // A or X: next order for the helmsman
      if (h.side === 'left' && this.orderCard.parent !== h.grip) { h.grip.add(this.orderCard); this.orderCard.position.set(0, 0.11, 0.06); }
      const ab = btn(4);
      if (ab && !h.ab && !this.dead) { this.G.act({ type: 'order' }); this.haptic(h, 0.3, 30); }
      h.ab = ab;
      // Glove clenches and lights up so you can see the buttons are working
      h.glove.scale.set(1, sq ? 0.7 : 1, sq ? 0.8 : 1);
      h.glove.userData.palm.material.emissive.setHex(trig ? 0x7a3a10 : sq ? 0x2e2010 : 0x000000);
      if (h.held && h.held.kind === 'musket') this.aimTwoHanded(h);
      if (h.held === 'grapple') this.aimGrapple(h);
      if (h.held === 'cannon') this.aimCannonByHand(h);
      if (h.held === 'wheel') this.updateWheel(h, dt);
      else if (h.held === 'lever') this.updateLever(h);
      if (h.held === 'ladder' || h.held === 'oar') this.G.island.boat.handStep(this, h, dt);
      this.updateHover(h);
      if (!h.gp) continue;
      const sx = ax.length >= 4 ? ax[2] : ax[0] || 0, sy = ax.length >= 4 ? ax[3] : ax[1] || 0;
      if (h.side === 'left') this.move(sx, sy, dt);
      if (h.side === 'right') {
        if (this.smoothTurn) { if (Math.abs(sx) > 0.2) this.snapTurn(-Math.sign(sx) * (Math.abs(sx) - 0.2) / 0.8 * 2.2 * dt); } // up to ~125°/s
        else if (Math.abs(sx) > 0.7 && !this.snapLatch) { this.snapLatch = true; this.snapTurn(sx > 0 ? -Math.PI / 4 : Math.PI / 4); }
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
      if (e.code === 'Digit4') this.equip('hammer');
      if (e.code === 'Digit5') this.equip('bucket');
      if (e.code === 'KeyT') this.G.act({ type: 'order' });
      if (e.code === 'KeyG') { const d = this.G.camera.getWorldDirection(new THREE.Vector3()); this.G.act({ type: 'aimGrapple', dir: d }); this.fireGrapple(null); }
      if (e.code === 'Space') { e.preventDefault(); if (!this.G.act({ type: 'broadside' })) this.G.hud.msg('No target in the cannons’ arc', 1.5); }
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
    if (this.deskItem) {
      if (this.beltZone()) this.toBelt(this.deskItem);
      else {
        this.G.ship.root.attach(this.deskItem.obj); this.deskItem.returning = true;
        this.G.act({ type: 'dropItem', item: this.deskItem.id });
      }
      this.deskItem = null;
    }
    if (!kind) return;
    // Ashore you can only draw what you brought (it's on your belt)
    const it = this.items.find((x) => x.kind === kind && !x.holder && (x.belt ? x.heldBy === this.id : !x.heldBy && this.ship === this.G.ship && !this.climb));
    if (!it || !this.G.act({ type: 'takeItem', item: it.id })) return;
    this.deskItem = it; it.returning = false; it.belt = false;
    this.G.camera.add(it.obj);
    if (kind === 'musket') { it.obj.position.set(0.2, -0.2, -0.28); it.obj.rotation.set(0, 0, 0); }
    else if (kind === 'bucket') { it.obj.position.set(0.32, -0.2, -0.62); it.obj.rotation.set(0.25, 0, 0); }
    else { it.obj.position.set(0.3, -0.32, -0.4); it.obj.rotation.set(0.7, 0.35, 0); }
    if (!this.toldItem?.['desk' + kind] && (kind === 'hammer' || kind === 'bucket')) {
      this.toldItem = { ...this.toldItem, ['desk' + kind]: true };
      this.G.hud.msg(kind === 'hammer' ? 'Look at a leak or a snapped mast and click to hammer it' : 'Click near the water tub to fill it, then click at a fire', 4);
    }
  }

  // Words on the wrist card (VR) / desktop status line
  orderText() {
    const C = this.G.crew, steering = this.G.ship.helmBy === C.hm.id;
    return `Hawkins: ${ORDER_TEXT[C.order]}\n${steering ? 'He has the wheel' : 'Walk away from the wheel: he steers'}\nPress A or X to change`;
  }

  deskUse() {
    const G = this.G, it = this.deskItem;
    if (G.island?.deskUse(this)) return; // ashore: open the chest, take a prize
    const keg = this.ship.keg;
    if (keg && keg.fuse === -1 && keg.obj.visible) {
      G.camera.getWorldPosition(_a); keg.obj.getWorldPosition(_b); _b.y += 0.5;
      if (_a.distanceTo(_b) < 3) { this.lightKeg(null); return; }
    }
    if (it && it.kind === 'musket') { this.fireMusket(it, null); return; }
    if (it && it.kind === 'sword') { if (this.swing < 0) { this.swing = 0; this.swingHit = false; G.audio.swoosh(null); } return; }
    if (it && it.kind === 'hammer') { if (this.swing < 0) { this.swing = 0; this.swingHit = false; } return; }
    if (it && it.kind === 'bucket') { this.deskBucket(it); return; }
    G.camera.getWorldPosition(_a); G.camera.getWorldDirection(_c);
    for (const c of G.ship.cannons) {
      c.breech.getWorldPosition(_b); _b.sub(_a);
      const d = _b.length();
      if (d < 4 && _b.normalize().dot(_c) > 0.93) {
        if (G.act({ type: 'lightCannon', cannon: c.id, delay: 0.35 }) === 'reloading') G.hud.msg('That cannon is still reloading', 1.5);
        return;
      }
    }
  }

  updateDesktop(dt) {
    const G = this.G, ship = G.ship, k = this.keys;
    G.camera.position.set(0, 1.7, 0);
    G.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const rowing = this.ship.isBoat && G.island.boat.stick(this, s, -f, dt);
    if ((f || s) && !rowing && !this.climb) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const sp = 3 * dt / Math.hypot(f, s);
      this.dolly.position.x += (fx * f + -fz * s) * sp;
      this.dolly.position.z += (fz * f + fx * s) * sp;
    }
    if (k.KeyQ) G.act({ type: 'steer', delta: dt * 4 });
    if (k.KeyE) G.act({ type: 'steer', delta: -dt * 4 });
    if (k.KeyR) G.act({ type: 'setSail', angle: ship.leverAngle - dt * 0.6 });
    if (k.KeyF) G.act({ type: 'setSail', angle: ship.leverAngle + dt * 0.6 });
    if (this.swing >= 0 && this.deskItem) {
      this.swing += dt / 0.3;
      const u = Math.min(1, this.swing);
      this.deskItem.obj.rotation.set(0.7 - u * 1.9, 0.35 - u * 1.1, -u * 0.6);
      if (u > 0.4 && !this.swingHit) {
        this.swingHit = true;
        // Look direction in ship-local space, flattened onto the deck
        G.camera.getWorldDirection(_a); ship.root.getWorldQuaternion(_q).invert(); _a.applyQuaternion(_q); _a.y = 0; _a.normalize();
        if (this.deskItem.kind === 'hammer') this.deskHammer(this.deskItem);
        else G.act({ type: 'deskSlash', facing: _a });
      }
      if (this.swing >= 1) { this.swing = -1; this.deskItem.obj.rotation.set(0.7, 0.35, 0); }
    }
  }

  // ---------- Shared ----------
  // Step onto another ship's deck (keeps you exactly where you are in the world).
  transfer(ship) {
    if (ship === this.ship) return;
    ship.root.attach(this.dolly);
    this.dolly.rotation.x = 0; this.dolly.rotation.z = 0; this.dolly.position.y = 0;
    this.ship = ship;
    this.G.events.emit('playerCrossed', { player: this, ship, home: ship === this.G.ship });
  }

  // Where you start on deck: the captain at the wheel, friends (multiplayer) beside and ahead of it
  spawnSpot() {
    const n = parseInt(this.id.split(':')[1]) || 0;
    return [[0, 6.5], [0.9, 4.6], [-0.9, 4.6], [0, 3.6]][n % 4];
  }

  // ---------- Treasure hunts (island.js, rowboat.js) ----------
  blink() { this.blinkT = 1; }
  // Where a weapon you let go of hangs on your belt instead of flying back to the rack:
  // ashore, in the boat, on the ladder or at the top of it
  beltZone() { return !!(this.ship.isShore || this.ship.isBoat || this.climb || this.G.island?.boat.nearLadderTop(this)); }

  // Going down the ladder with nothing in hand or on your belt: a cutlass from the rack goes on
  // your belt (or a musket if the cutlasses are all taken), so nobody lands on the island unarmed
  armForShore() {
    if (this.items.some((it) => it.heldBy === this.id && (it.kind === 'sword' || it.kind === 'musket'))) return;
    for (const kind of ['sword', 'musket']) {
      const it = this.items.find((x) => x.kind === kind && !x.heldBy && !x.holder && !x.belt);
      if (it && this.G.act({ type: 'takeItem', item: it.id })) { this.toBelt(it); const how = this.G.mode === 'vr' ? 'GRIP at your hip' : kind === 'sword' ? 'press 2' : 'press 1';
        this.G.hud.msg(`A ${kind === 'sword' ? 'cutlass' : 'musket'} is on your belt (${how} to draw it)`, 3); return; }
    }
  }
  // Hang an item on your belt (ashore): still yours, back in your hand with GRIP
  toBelt(it) {
    if (it.support) { const o = it.support; it.support = null; o.supporting = null; o.held = null; }
    it.holder = null; it.belt = true; it.returning = false;
    this.dolly.attach(it.obj);
  }
  // Everything on your belt goes back to the rack
  unbelt() {
    for (const it of this.items) {
      if (!it.belt) continue;
      it.belt = false;
      if (it.heldBy !== this.id) continue;
      this.G.ship.root.attach(it.obj); it.returning = true;
      this.G.act({ type: 'dropItem', item: it.id });
    }
  }
  // Belt items ride at your hips, the way you face
  placeBelt() {
    const cam = this.G.camera;
    let n = 0;
    for (const it of this.items) {
      if (!it.belt || it.heldBy !== this.id) continue;
      _a.copy(cam.position); // the camera sits in the dolly
      cam.getWorldDirection(_b); this.dolly.getWorldQuaternion(_q).invert(); _b.applyQuaternion(_q);
      const yaw = Math.atan2(-_b.x, -_b.z), side = it.kind === 'sword' ? -1 : 1, back = n++ * 0.12;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      it.obj.position.set(_a.x + rx * side * 0.24 - fx * back, Math.max(0.5, _a.y * 0.56), _a.z + rz * side * 0.24 - fz * back);
      it.obj.rotation.set(it.kind === 'musket' ? -1.2 : -1.35, yaw, 0, 'YXZ');
    }
  }
  // The chest or a prize card under your hand
  useTreasure(h, t) {
    const r = t.kind === 'chest' ? this.G.act({ type: 'openChest' }) : this.G.act({ type: 'pickUpgrade', kind: t.upg });
    if (r) this.haptic(h, 0.8, 90);
  }

  // Back to our own deck in a hurry (the ship you were on is going down).
  returnHome() {
    if (this.ship === this.G.ship) return;
    this.transfer(this.G.ship);
    this.dolly.position.set(0, 0, 2); this.dolly.rotation.set(0, this.dolly.rotation.y, 0);
  }

  respawn() {
    this.climb = false; this.autoClimb = 0;
    if (this.ship !== this.G.ship) { this.G.ship.root.add(this.dolly); this.ship = this.G.ship; }
    for (const h of this.hands) { this.release(h); h.evTrig = h.evSq = false; }
    this.unbelt();
    const [x, z] = this.spawnSpot();
    this.dolly.position.set(x, 0, z); this.dolly.rotation.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.dead = false; this.hurtFlash = 0;
  }

  // Read this frame's input (turned into actions) and keep the head on the deck.
  update(dt) {
    const G = this.G;
    if (G.mode === 'vr') this.updateVR(dt); else if (G.mode === 'desktop') this.updateDesktop(dt);
    this.lastDt = dt;
    this.clampToDeck();
    if (this.ship.isBoat || this.climb) G.island.boat.flushRow(this, dt);
  }

  // Everything you see of yourself: red hurt vignette, weapons in hand or floating back to
  // the rack, musket ready gems. A VR sword is also checked against boarders here, since how
  // fast you swing it is input.
  updateView(dt) {
    const G = this.G, ship = this.ship;
    if (this.cannonLine) { this.cannonLineT = (this.cannonLineT || 0) - dt; this.cannonLine.visible = this.cannonLineT > 0; }
    if (this.orderCard) { this.orderCard.userData.set(this.orderText()); this.orderCard.visible = G.mode === 'vr' && !!this.orderCard.parent && ship === G.ship && !this.climb; }
    this.placeBelt();
    this.blinkT = Math.max(0, this.blinkT - dt * 1.6);
    this.blinker.material.opacity = Math.min(1, this.blinkT * 1.4); this.blinker.visible = this.blinkT > 0;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    const op = this.dead ? 0.85 : this.hurtFlash * 0.45 + Math.max(0, 0.5 - this.health / 100) * 0.4;
    this.vignette.material.opacity = op; this.vignette.visible = op > 0.01;

    for (const it of this.items) {
      if (it.kind === 'musket') it.gem.material = it.loaded ? READY : EMPTY;
      it.kick = Math.max(0, it.kick - dt * 6);
      it.inner.rotation.x = it.kick * 0.3; it.inner.position.z = it.kick * 0.07;
      if (it.returning) {
        const k = Math.min(1, dt * 5);
        it.obj.position.lerp(it.home.pos, k); it.obj.quaternion.slerp(it.home.quat, k);
        if (it.obj.position.distanceTo(it.home.pos) < 0.01) { it.obj.position.copy(it.home.pos); it.obj.quaternion.copy(it.home.quat); it.returning = false; }
      }
      if (it.kind === 'bucket') it.water.visible = !!it.full;
      if (it.kind === 'hammer' || it.kind === 'bucket') { it.hitCD = Math.max(0, it.hitCD - dt); if (it.holder) this.useTool(it, dt); }
      // Sword in a VR hand: check the blade against boarders
      if (it.kind === 'sword' && it.holder) {
        it.swooshCD -= dt;
        const hilt = it.obj.localToWorld(_a.set(0, 0, -0.12)); ship.root.worldToLocal(hilt);
        const tip = it.obj.localToWorld(_b.set(0, 0, -0.98)); ship.root.worldToLocal(tip);
        const speed = it.hasPrev ? tip.distanceTo(it.prevTip) / Math.max(dt, 1e-3) : 0;
        if (speed > 5.5 && it.swooshCD <= 0) { it.swooshCD = 0.35; it.obj.localToWorld(_c.set(0, 0, -0.6)); G.audio.swoosh(_c); }
        if (G.act({ type: 'swordSweep', item: it.id, hilt, tip, speed })) this.haptic(it.holder, 1, 70);
        it.prevTip.copy(tip); it.hasPrev = true;
      } else if (it.kind !== 'hammer' || !it.holder) it.hasPrev = false;
    }
  }
}
