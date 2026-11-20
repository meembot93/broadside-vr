// A friend on board (multiplayer): their pirate body, floating gloves where their hands are,
// their name over their head, and whatever weapon or tool they are holding.
//
// The same object is also that friend's game state, with the fields the rules use for every
// player (id, ship, headLocal, health, dead, lastHurt), so the host's rules treat them just
// like the local player. Their headset sends a pose about 20 times a second (see net.js):
// head, hands and held items, all in the local space of the ship they stand on.
import * as THREE from 'three';
import { makePerson, animatePerson } from '../people.js';
import { buildGlove } from '../player.js';
import { canvasTex, angleWrap, clamp } from '../util.js';

// One captain's coat per seat, so you can tell your mates apart at a glance
const LOOKS = [
  { type: 'captain', coat: 0x6a2418, hat: 0x2a1a12 },
  { type: 'captain', coat: 0x1f3a66, hat: 0x1a1a26 },
  { type: 'captain', coat: 0x2c5428, hat: 0x2a2012 },
  { type: 'captain', coat: 0x55285e, hat: 0x1a1416 },
];
export const SEAT_COLOURS = ['#c0503a', '#5a8ad8', '#6ab05a', '#b070c0'];

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

function nameTag(name, colour) {
  const tex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = 'rgba(20,12,6,0.7)'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 14); g.fill();
    g.strokeStyle = colour; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#fff3cf'; g.font = 'bold 34px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, h / 2 + 1, w - 20);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.5, 0.125, 1); sp.renderOrder = 4;
  return sp;
}

export class RemotePlayer {
  constructor(G, id, name) {
    this.G = G; this.id = id; this.remote = true;
    this.seat = parseInt(id.split(':')[1]) || 0;
    this.name = name || `Mate ${this.seat + 1}`;
    this.ship = G.ship;
    this.headLocal = new THREE.Vector3(0, 1.7, 6.5);
    this.health = 100; this.dead = false; this.lastHurt = -99; this.hurtFlash = 0;
    this.hands = []; // the rules loop over a player's hands for haptics; a friend's rumble happens on their own headset
    this.holdShipT = -1;

    // Looks
    this.p = makePerson({ ...LOOKS[this.seat % LOOKS.length], seed: 500 + this.seat, cutlass: false });
    this.gloves = [buildGlove(), buildGlove()];
    this.gloves[0].userData.thumb.position.x = 0.045; // left hand: thumb on the other side
    this.tag = nameTag(this.name, SEAT_COLOURS[this.seat % 4]);
    this.parts = [this.p.g, ...this.gloves, this.tag];
    for (const o of this.parts) G.ship.root.add(o);
    for (const g of this.gloves) g.visible = false;
    this.p.g.position.set(0, 0, 6.5);
    this.view = { head: new THREE.Vector3(0, 1.7, 6.5), yaw: 0, pitch: 0, hands: [new THREE.Object3D(), new THREE.Object3D()], have: false };
    this.pose = null;
  }

  haptic() { /* rumble only happens on their own headset */ }

  // ---- Rules side (host). The friend's headset is told to do the same thing. ----
  respawn() {
    this.health = 100; this.dead = false; this.ship = this.G.ship;
    this.headLocal.set(0, 1.7, 6.5); this.holdShipT = this.G.t + 1.5;
    this.G.net?.command(this.id, 'respawn');
  }
  returnHome() {
    if (this.ship === this.G.ship) return;
    this.ship = this.G.ship; this.headLocal.set(0, 1.7, 2); this.holdShipT = this.G.t + 1.5;
    this.G.net?.command(this.id, 'returnHome');
  }

  // Treasure hunts (island.js): row ashore onto the beach, or back aboard
  goAshore(x, z, yaw) {
    this.ship = this.G.island.shore; this.headLocal.set(x, 1.7, z); this.holdShipT = this.G.t + 1.5;
    this.G.net?.command(this.id, 'goAshore', { x, z, yaw });
  }
  goAboard() {
    this.ship = this.G.ship; this.headLocal.set(0.7, 1.7, 2.6); this.holdShipT = this.G.t + 1.5;
    this.G.net?.command(this.id, 'goAboard');
  }

  // A pose from their headset: { ship, h: head, l / r: hands (or 0), it: [[itemId, pose]], dk }
  // Each pose is [x, y, z, qx, qy, qz, qw] in the local space of `ship`.
  setPose(pk) {
    const G = this.G;
    this.pose = pk;
    if (G.t > this.holdShipT) {
      const s = G.frameById(pk.ship);
      if (s) this.ship = s;
    }
    if (pk.ship === this.ship.id && pk.h) this.headLocal.set(pk.h[0], pk.h[1], pk.h[2]);
  }

  // Every frame, on every headset: move the avatar smoothly toward the latest pose.
  update(dt) {
    const G = this.G, pk = this.pose, V = this.view, root = this.ship.root;
    for (const o of this.parts) if (o.parent !== root) root.add(o);
    if (!pk || pk.ship !== this.ship.id) { this.p.g.visible = !this.dead; return; }
    const k = 1 - Math.exp(-14 * dt);
    const h = pk.h;
    const before = V.head.clone();
    if (!V.have) { V.head.set(h[0], h[1], h[2]); V.have = true; } else V.head.lerp(_p.set(h[0], h[1], h[2]), k);
    _q.set(h[3], h[4], h[5], h[6]); _e.setFromQuaternion(_q, 'YXZ');
    V.yaw += angleWrap(_e.y - V.yaw) * k; V.pitch += (_e.x - V.pitch) * k;

    // Body under the head, a little behind the eyes; shorter if they crouch or sit
    const p = this.p, g = p.g;
    g.visible = true;
    const sc = clamp(V.head.y / 1.66, 0.62, 1.15);
    g.scale.setScalar(sc);
    g.position.set(V.head.x + Math.sin(V.yaw) * 0.09, 0, V.head.z + Math.cos(V.yaw) * 0.09);
    g.rotation.y = V.yaw;
    p.head.rotation.x = clamp(V.pitch, -0.8, 0.8) * 0.8;
    p.dead = this.dead;
    const moved = Math.hypot(V.head.x - before.x, V.head.z - before.z) / Math.max(dt, 1e-3);
    // VR friends show their real hands (gloves), so the body's own arms are hidden
    const vrHands = !!(pk.l || pk.r);
    p.armL.visible = p.armR.visible = !vrHands || this.dead;
    animatePerson(p, dt, moved > 0.35 && !this.dead, G.t);

    // Hands
    [pk.l, pk.r].forEach((hp, i) => {
      const glove = this.gloves[i], o = V.hands[i];
      glove.visible = !!hp && !this.dead;
      if (!hp) return;
      if (!o.userData.have) { o.position.set(hp[0], hp[1], hp[2]); o.quaternion.set(hp[3], hp[4], hp[5], hp[6]); o.userData.have = true; }
      else { o.position.lerp(_p.set(hp[0], hp[1], hp[2]), k); o.quaternion.slerp(_q.set(hp[3], hp[4], hp[5], hp[6]), k); }
      glove.position.copy(o.position); glove.quaternion.copy(o.quaternion);
    });

    // Name over their head
    this.tag.visible = !this.dead;
    this.tag.position.set(V.head.x, V.head.y + 0.42, V.head.z);

    // What they're holding
    for (const [id, ...ip] of pk.it || []) {
      const it = G.items.find((x) => x.id === id);
      if (!it || it.heldBy !== this.id) continue;
      if (it.obj.parent !== root) { root.attach(it.obj); it.obj.position.set(ip[0], ip[1], ip[2]); it.obj.quaternion.set(ip[3], ip[4], ip[5], ip[6]); }
      it.returning = false;
      it.obj.position.lerp(_p.set(ip[0], ip[1], ip[2]), k);
      it.obj.quaternion.slerp(_q.set(ip[3], ip[4], ip[5], ip[6]), k);
    }
  }

  dispose() {
    for (const o of this.parts) o.removeFromParent();
    this.tag.material.map.dispose(); this.tag.material.dispose();
  }
}

// The local player's pose, to send to everyone else. Same format as RemotePlayer.setPose().
const r3 = (v) => Math.round(v * 1000) / 1000;
const _inv = new THREE.Matrix4(), _s = new THREE.Vector3();
export function localPose(G) {
  const P = G.player, root = P.ship.root;
  root.updateMatrixWorld();
  _inv.copy(root.matrixWorld).invert();
  const pose = (obj) => {
    _m.multiplyMatrices(_inv, obj.matrixWorld).decompose(_p, _q, _s);
    return [r3(_p.x), r3(_p.y), r3(_p.z), r3(_q.x), r3(_q.y), r3(_q.z), r3(_q.w)];
  };
  const out = { ship: P.ship.id, h: pose(G.camera), l: 0, r: 0, it: [], dk: G.mode === 'desktop' };
  if (G.mode === 'vr') for (const h of P.hands) if (h.src && h.gp) { if (h.side === 'left') out.l = pose(h.grip); else out.r = pose(h.grip); }
  for (const it of G.items) if (it.heldBy === P.id && (it.holder || P.deskItem === it || it.belt)) out.it.push([it.id, ...pose(it.obj)]);
  return out;
}
