import * as THREE from 'three';
import { clamp } from './util.js';
import { halfWidth, deckFloor } from './ship.js';

// Boarding rope: when two ships are lashed together, a rope hangs from the end of our main
// yard over the gap between them. Grab it (GRIP in VR, click it on desktop) and you swing
// across to the other deck, then it hangs on that side, ready to swing you back.
//
// Only the local player swings, and only their own position moves (like walking across),
// so nothing here goes through G.act: friends just see you fly over.
// Comfort: one short smooth arc, no spin, your view keeps facing the way you face.

const YARD = { x: 4.0, y: 8.5, z: -1.25 }; // end of our main lower yard (ship-local, x times the side)
const REST_Z = -0.6;                       // where the rope's end is tied off at the rail
const SWING_T = 1.7;                       // seconds from rail to rail
const ROPE_MAT = new THREE.MeshLambertMaterial({ color: 0x8a6a3e });
const KNOT_MAT = new THREE.MeshLambertMaterial({ color: 0x6e5030 });
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _seg = new THREE.Line3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

export class RopeSwing {
  constructor(G) {
    this.G = G;
    this.ropes = new Map(); // lock -> { mesh, knot, end (world), lock }
    this.ropeGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1).translate(0, -0.5, 0); // hangs down from its top
    this.knotGeo = new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.6, 1);
    this.told = false;
  }

  // The lashed ships the local player could swing between: [{ lock, from, to }]
  options(P) {
    const G = this.G, S = G.ship, out = [];
    for (const l of G.grapples?.locks || []) {
      if (l.phase !== 'locked' || !l.e.alive) continue;
      if (P.ship === S) out.push({ lock: l, from: S, to: l.e });
      else if (P.ship === l.e) out.push({ lock: l, from: l.e, to: S });
    }
    return out;
  }

  // Top of the rope (world)
  pivot(l, out) { return this.G.ship.root.localToWorld(out.set(l.side * YARD.x, YARD.y, YARD.z)); }

  // Where the rope's end waits, tied off at the rail of the ship you're on (world)
  rest(l, onEnemy, out) {
    const S = this.G.ship;
    if (!onEnemy) return S.root.localToWorld(out.set(l.side * (halfWidth(REST_Z) - 0.12), 1.35, REST_Z));
    const z = clamp(REST_Z - l.zOff, -6, 5);
    return l.e.root.localToWorld(out.set(-l.side * (halfWidth(z) - 0.12), 1.35, z));
  }

  // The bit of rope you can grab: from its end up to about head height (world)
  grabSeg(l, P, seg) {
    const r = this.ropes.get(l); if (!r) return null;
    this.pivot(l, seg.end); seg.start.copy(r.end);
    _d.copy(seg.end).sub(seg.start).setLength(1.3); seg.end.copy(seg.start).add(_d);
    return seg;
  }

  // findTarget (player.js): the rope under an empty VR hand
  targets(P, handPos, consider) {
    if (P.swinging || P.dead || P.climb) return;
    for (const o of this.options(P)) {
      const seg = this.grabSeg(o.lock, P, _seg); if (!seg) continue;
      seg.closestPointToPoint(handPos, true, _c);
      consider('rope', handPos.distanceTo(_c), 0.35, { lock: o.lock, point: _c.clone() });
    }
  }

  // Desktop click: a rope within reach that you're looking at
  deskTry(P) {
    if (P.swinging || P.dead || P.climb) return false;
    const cam = this.G.camera;
    cam.getWorldPosition(_a); cam.getWorldDirection(_b);
    for (const o of this.options(P)) {
      const seg = this.grabSeg(o.lock, P, _seg); if (!seg) continue;
      seg.closestPointToPoint(_a, true, _c);
      const d = _a.distanceTo(_c);
      if (d < 3 && (d < 0.6 || _c.sub(_a).normalize().dot(_b) > 0.75)) { this.start(P, o.lock, null); return true; }
    }
    return false;
  }

  // Grab the rope and go. h = the VR hand holding it (null on desktop).
  start(P, l, h) {
    const G = this.G, S = G.ship;
    const onEnemy = P.ship === l.e;
    const from = P.ship, to = onEnemy ? S : l.e;
    G.camera.getWorldPosition(_a); from.root.worldToLocal(_a);
    // Land a little inboard of the far rail, level with where you are along the ship
    to.root.worldToLocal(G.camera.getWorldPosition(_b));
    const zL = clamp(_b.z, -6, 5), sideTo = onEnemy ? l.side : -l.side; // the far ship's rail that faces you, in its own frame
    const headH = clamp(_a.y - P.dolly.position.y, 1.0, 2.1); // how tall you stand (or sit)
    P.swinging = { l, h, from, to, t: 0, start: _a.clone(), headH,
      land: new THREE.Vector3(sideTo * (halfWidth(zL) - 1.3), 0, zL) };
    P.swinging.land.y = deckFloor(P.swinging.land.x, zL) + headH;
    if (h) { h.held = 'rope'; P.haptic(h, 0.6, 60); }
    G.camera.getWorldPosition(_c); G.audio.swoosh(_c);
    G.events.emit('ropeSwing', { player: P, ship: to });
  }

  // Every frame while swinging (from player.clampToDeck): carry the head along the arc
  carry(P, dt) {
    const sw = P.swinging, G = this.G;
    // The lines were cut or a ship went down mid-swing: let go where you are
    if (!G.grapples.locks.includes(sw.l) || !sw.to.alive || P.ship !== sw.from) { this.finish(P, false); return; }
    sw.t += dt / SWING_T;
    const u = Math.min(1, sw.t), e = u * u * (3 - 2 * u); // ease in and out
    sw.to.root.localToWorld(_b.copy(sw.land)); sw.from.root.worldToLocal(_b); // landing spot follows the other ship's bobbing
    _c.lerpVectors(sw.start, _b, e);
    _c.y += Math.sin(Math.PI * e) * 0.55; // up over the rails and down onto the deck
    P.dolly.updateMatrixWorld(true);
    G.camera.getWorldPosition(_a); sw.from.root.worldToLocal(_a);
    P.dolly.position.add(_d.copy(_c).sub(_a));
    P.headLocal.copy(_c);
    if (sw.h && Math.random() < dt * 20) P.haptic(sw.h, 0.12, 10);
    if (u >= 1) this.finish(P, true);
  }

  finish(P, landed) {
    const sw = P.swinging; if (!sw) return;
    P.swinging = null;
    if (sw.h && sw.h.held === 'rope') { sw.h.held = null; sw.h.glove.visible = true; }
    if (landed) { P.transfer(sw.to); P.dolly.position.y = deckFloor(sw.land.x, sw.land.z); }
    else P.dolly.position.y = Math.max(0, deckFloor(P.headLocal.x, P.headLocal.z));
    P.clampToDeck();
    if (!this.told) { this.told = true; this.G.hud.msg('Grab the rope again to swing back', 3); }
  }

  // Draw the ropes (every headset, each from its own player's point of view)
  view(dt) {
    const G = this.G, P = G.player, locks = G.grapples?.locks || [];
    for (const [l, r] of this.ropes) if (!locks.includes(l) || l.phase !== 'locked') { G.scene.remove(r.mesh, r.knot); this.ropes.delete(l); }
    for (const l of locks) {
      if (l.phase !== 'locked') continue;
      let r = this.ropes.get(l);
      if (!r) {
        r = { mesh: new THREE.Mesh(this.ropeGeo, ROPE_MAT), knot: new THREE.Mesh(this.knotGeo, KNOT_MAT), end: new THREE.Vector3(), have: false };
        G.scene.add(r.mesh, r.knot); this.ropes.set(l, r);
      }
      // Where its end is: in your hand while you swing, else tied off on your side
      const sw = P.swinging?.l === l ? P.swinging : null;
      if (sw && sw.h) P.handPos(sw.h, _b);
      else if (sw) { G.camera.getWorldPosition(_b); _b.y += 0.35; }
      else this.rest(l, P.ship === l.e, _b);
      if (!r.have || sw) { r.end.copy(_b); r.have = true; } else r.end.lerp(_b, 1 - Math.exp(-6 * dt));
      this.pivot(l, _a);
      const len = _a.distanceTo(r.end);
      r.mesh.position.copy(_a);
      _c.copy(_a).sub(r.end).normalize(); _q.setFromUnitVectors(_up, _c);
      r.mesh.quaternion.copy(_q); r.mesh.scale.set(1, len, 1);
      r.knot.position.copy(r.end); r.knot.quaternion.copy(_q);
    }
  }
}
