import * as THREE from 'three';
import { clamp, angleWrap, damp, rand } from './util.js';
import { halfWidth } from './ship.js';

// Grappling: the grapple gun on our bow, and the lines that lash two ships together so
// people can cross between them.
//
// Rules part (host): the hook in flight, which ships are lashed together ("locks"), pulling
// a hooked ship alongside and holding it there, taking a prize.
// View part: the gun model, the ropes and the hook. Sounds/messages come from events
// (see presentation.js).

export const GUN = { x: 0, y: 1.58, z: -8.25 };   // swivel point on our foredeck (ship-local), about chest height
export const GRAPPLE_RANGE = 42;                  // rope length, metres
const HOOK_SPEED = 38, GAP = 7.4;                 // GAP: centre-to-centre distance when lashed alongside
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

const ROPE_MAT = new THREE.LineBasicMaterial({ color: 0x3a2a18 });
const IRON = new THREE.MeshLambertMaterial({ color: 0x2b2d33 });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
const BRASS = new THREE.MeshLambertMaterial({ color: 0xb8902f });

function buildHook() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6).rotateX(Math.PI / 2), IRON));
  for (let i = 0; i < 3; i++) {
    const prong = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 4, 8, Math.PI), IRON);
    prong.rotation.set(0, (i * Math.PI * 2) / 3, Math.PI / 2); prong.position.z = -0.17;
    const holder = new THREE.Group(); holder.rotation.z = (i * Math.PI * 2) / 3; holder.add(prong); g.add(holder);
  }
  return g;
}

export class Grapples {
  constructor(G) {
    this.G = G;
    this.locks = [];       // { e, by: 'us' | 'them', phase: 'pull' | 'locked', side, zOff, hookLocal, rope, cutT }
    this.hook = null;      // our hook in flight: { pos, vel, from }
    this.aimYaw = 0; this.aimPitch = 0.12; // where the gun points (set by whoever holds it)
    this.heldBy = null;    // id of the player or crewman on the gun
    this.aimShown = false; // draw the aiming line this frame (the local player is holding it)
    this.buildGun();
    this.flyRope = this.makeRope();
    this.flyHook = buildHook(); this.flyHook.visible = false; G.scene.add(this.flyHook);
    // Aiming line: shows where the hook will fly (green when it's on a ship in reach)
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.7, depthWrite: false }));
    this.aimLine.frustumCulled = false; this.aimLine.visible = false; G.scene.add(this.aimLine);
  }

  // ---------- Model ----------
  buildGun() {
    const S = this.G.ship, root = S.root;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, GUN.y - 0.1, 8), WOOD);
    post.position.set(GUN.x, (GUN.y - 0.1) / 2, GUN.z); root.add(post);
    this.yawG = new THREE.Group(); this.yawG.position.set(GUN.x, GUN.y, GUN.z); root.add(this.yawG);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.12), IRON); fork.position.y = -0.05; this.yawG.add(fork);
    this.pitchG = new THREE.Group(); this.yawG.add(this.pitchG);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.9, 10).rotateX(Math.PI / 2), IRON);
    barrel.position.z = -0.2; this.pitchG.add(barrel);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 5, 12), BRASS); band.position.z = -0.6; this.pitchG.add(band);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10).rotateZ(Math.PI / 2), WOOD); reel.position.set(0, -0.1, 0.12); this.pitchG.add(reel);
    // Handle (what you grab) at the back
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8).rotateX(0.5), WOOD);
    handle.position.set(0, -0.08, 0.38); this.pitchG.add(handle);
    this.handle = new THREE.Object3D(); this.handle.position.set(0, -0.05, 0.38); this.pitchG.add(this.handle);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.68); this.pitchG.add(this.muzzle);
    this.loadedHook = buildHook(); this.loadedHook.position.z = -0.72; this.pitchG.add(this.loadedHook);
  }

  makeRope() {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
    const line = new THREE.Line(geo, ROPE_MAT); line.frustumCulled = false; line.visible = false; this.G.scene.add(line);
    return line;
  }

  // A rope from a to b (world) that sags a little.
  setRope(line, a, b, sag) {
    const p = line.geometry.attributes.position;
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      p.setXYZ(i, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - Math.sin(Math.PI * u) * sag, a.z + (b.z - a.z) * u);
    }
    p.needsUpdate = true; line.visible = true;
  }

  // ---------- Queries ----------
  lockFor(e) { return this.locks.find((l) => l.e === e) || null; }
  // The ship lashed alongside `ship` (so you can walk across), or null.
  linkedShip(ship) {
    const S = this.G.ship;
    for (const l of this.locks) {
      if (l.phase !== 'locked') continue;
      if (ship === S) return l.e;
      if (ship === l.e) return S;
    }
    return null;
  }
  anyLineOut() { return !!this.hook || this.locks.length > 0; }
  playersAboard(e) { return this.G.players.some((pl) => pl.ship === e); }

  // ---------- Rules ----------
  // Fire the hook from the gun along dir (world). Called through G.act.
  fire(dir) {
    const G = this.G;
    if (this.hook || !G.ship.alive) return false;
    this.muzzle.getWorldPosition(_a);
    this.hook = { pos: _a.clone(), vel: dir.clone().normalize().multiplyScalar(HOOK_SPEED).add(G.ship.vel), from: _a.clone() };
    G.events.emit('grappleFired', { pos: _a });
    return true;
  }

  // Cut every line that nobody is standing on the far end of.
  cut() {
    let n = 0;
    for (const l of [...this.locks]) if (!this.playersAboard(l.e)) { this.release(l, 'cut'); n++; }
    if (this.hook) { this.hook = null; n++; }
    return n;
  }

  lash(e, by, hookLocal) {
    if (this.lockFor(e)) return;
    _a.copy(e.pos); this.G.ship.root.worldToLocal(_a);
    const side = _a.x >= 0 ? 1 : -1;
    hookLocal = hookLocal || new THREE.Vector3(-side * halfWidth(-3) * 0.97, 1.0, -3);
    const l = { e, by, phase: 'pull', side, zOff: clamp(_a.z * 0.3, -1.5, 1.5), hookLocal, rope: this.makeRope(), rope2: by === 'them' ? this.makeRope() : null, settleT: 0 };
    this.locks.push(l); e.lock = l;
    this.G.events.emit(by === 'us' ? 'grappleHooked' : 'enemyGrappled', { ship: e, pos: e.root.localToWorld(_a.copy(hookLocal)) });
  }

  release(l, why) {
    const i = this.locks.indexOf(l); if (i < 0) return;
    this.locks.splice(i, 1);
    l.e.lock = null; l.e.pinned = false;
    this.G.scene.remove(l.rope); l.rope.geometry.dispose();
    if (l.rope2) { this.G.scene.remove(l.rope2); l.rope2.geometry.dispose(); }
    this.G.events.emit('grappleReleased', { ship: l.e, why });
  }

  clearAll() { for (const l of [...this.locks]) this.release(l, 'reset'); this.hook = null; this.heldBy = null; }

  // Where a lashed ship should sit: beside us, same heading.
  slot(l, out) {
    const S = this.G.ship;
    return S.localToWorldXZ(l.side * GAP, l.zOff, out);
  }

  update(dt) {
    const G = this.G, S = G.ship;
    // Hook in flight
    const h = this.hook;
    if (h) {
      h.vel.y -= 9.81 * 0.6 * dt;
      h.pos.addScaledVector(h.vel, dt);
      let done = false;
      for (const e of G.enemies.ships) {
        if (!e.alive || this.lockFor(e)) continue;
        _a.copy(h.pos); e.root.worldToLocal(_a);
        if (_a.z > -10.3 && _a.z < 8.2 && _a.y > -2.5 && _a.y < 2.6 && Math.abs(_a.x) < halfWidth(clamp(_a.z, -10, 8)) + 0.5) {
          _a.y = Math.min(_a.y, 1.0); _a.x = clamp(_a.x, -halfWidth(clamp(_a.z, -10, 8)) * 0.95, halfWidth(clamp(_a.z, -10, 8)) * 0.95);
          this.hook = null; this.lash(e, 'us', _a.clone()); done = true; break;
        }
      }
      if (!done) {
        this.muzzle.getWorldPosition(_b);
        if (h.pos.distanceTo(_b) > GRAPPLE_RANGE || h.pos.y < -0.5) { G.events.emit('grappleMissed', { pos: h.pos, far: h.pos.distanceTo(_b) > GRAPPLE_RANGE }); this.hook = null; }
      }
    }

    this.updateKegs(dt);
    // Lashed ships
    for (const l of [...this.locks]) {
      const e = l.e;
      if (!e.alive || !S.alive) {
        for (const pl of G.players) if (pl.ship === e) { pl.returnHome(); G.events.emit('strandedAboard', { player: pl, ship: e }); }
        this.release(l, e.alive ? 'sinking' : 'sunk'); continue;
      }
      this.slot(l, _a);
      const dx = _a.x - e.pos.x, dz = _a.z - e.pos.z, d = Math.hypot(dx, dz);
      if (l.phase === 'pull') {
        // Haul her in: faster as the line comes tight, turning to match our heading
        const sp = Math.min(d, (2 + Math.min(4, l.settleT * 1.5)) * dt);
        l.settleT += dt;
        e.pos.x += (dx / Math.max(d, 1e-3)) * sp; e.pos.z += (dz / Math.max(d, 1e-3)) * sp;
        e.heading += clamp(angleWrap(S.heading - e.heading), -0.25 * dt, 0.25 * dt);
        e.speed = damp(e.speed, S.speed, 1, dt); e.rudder = 0;
        e.pinned = true;
        if (d < 0.4 && Math.abs(angleWrap(S.heading - e.heading)) < 0.05) { l.phase = 'locked'; G.events.emit('shipsLashed', { ship: e, by: l.by }); }
        S.speed *= 1 - 0.25 * dt;
      } else {
        e.pos.x = _a.x; e.pos.z = _a.z; e.heading = S.heading; e.speed = S.speed; e.rudder = 0; e.pinned = true;
        S.speed *= 1 - 0.15 * dt;
      }
      // A prize nobody is aboard any more (and nobody blew up) gets cut loose and scuttled
      if (e.captured && !this.playersAboard(e) && !(e.keg?.fuse >= 0)) {
        l.cutT = (l.cutT ?? 20) - dt;
        if (l.cutT <= 0) { this.release(l, 'scuttled'); e.scuttle(); G.events.emit('prizeScuttled', { ship: e }); }
      } else l.cutT = 20;
      // Their boarding party is spent and nobody of ours is over there: they cut and run
      if (l.by === 'them' && l.phase === 'locked' && e.hostile && e.ai.sent >= 5 && !G.enemies.boarders.some((b) => b.state !== 'dead') && !this.playersAboard(e)) {
        e.ai.canBoard = false; e.ai.mode = 'broadside'; this.release(l, 'theyCut');
      }
    }
  }

  // Taking a prize: we stand on her deck and none of her crew is left standing.
  checkPrize() {
    const G = this.G;
    for (const e of G.enemies.ships) {
      if (!e.alive || e.captured || !this.playersAboard(e)) continue;
      if (e.crew.every((m) => m.p.dead)) {
        e.captured = true; e.abandoned = true; e.ai.mode = 'adrift';
        e.strikeColors();
        this.placeKeg(e);
        G.score++;
        G.ship.health = Math.min(G.ship.maxHealth, G.ship.health + 40);
        G.events.emit('prizeTaken', { ship: e, score: G.score });
      }
    }
  }

  // ---------- Powder keg ----------
  // A taken prize has a powder keg by her main mast. Light it and get clear: she blows up.
  placeKeg(e) {
    const g = new THREE.Group(), k = 0.32;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(k * 0.9, k * 0.9, 0.7, 10), new THREE.MeshLambertMaterial({ color: 0x5a3a1e }));
    body.position.y = 0.35; g.add(body);
    for (const y of [0.1, 0.35, 0.6]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(k * 0.95, k * 0.95, 0.05, 10), IRON); r.position.y = y; g.add(r); }
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0xc02a1a }));
    mark.position.set(0, 0.42, k * 0.91); g.add(mark);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 4), new THREE.MeshLambertMaterial({ color: 0xd8c08a }));
    fuse.position.set(0.08, 0.8, 0); fuse.rotation.z = -0.4; g.add(fuse);
    const tip = new THREE.Object3D(); tip.position.set(0.13, 0.9, 0); g.add(tip);
    g.position.set(0.75, 0, -0.1);
    e.root.add(g);
    e.keg = { id: `${e.id}/keg`, fuse: -1, obj: g, tip, sparkT: 0 };
  }

  lightKeg(e) {
    if (!e.keg || e.keg.fuse >= 0) return false;
    e.keg.fuse = 8;
    this.G.events.emit('kegLit', { ship: e, pos: e.keg.tip.getWorldPosition(new THREE.Vector3()) });
    return true;
  }

  updateKegs(dt) {
    const G = this.G;
    for (const e of G.enemies.ships) {
      const k = e.keg;
      if (!k || k.fuse < 0) continue;
      k.fuse -= dt; k.sparkT -= dt;
      if (k.sparkT <= 0) { k.sparkT = 0.05; G.fx.sparks(k.tip.getWorldPosition(_a), 3, 0.15); }
      if (k.fuse <= 0) {
        k.fuse = -2;
        const pos = k.obj.getWorldPosition(new THREE.Vector3()); pos.y += 0.5;
        k.obj.visible = false;
        for (const pl of G.players) if (pl.ship === e) { pl.returnHome(); G.hurtPlayer(pl, 45); }
        for (const m of G.crew.members) if (m.away?.ship === e) G.crew.jump(m, G.ship, m.home.x, m.home.z, true);
        const l = this.lockFor(e); if (l) this.release(l, 'blown');
        e.scuttle(); e.sinkT = 3; // she goes down fast
        G.events.emit('kegExploded', { ship: e, pos });
      }
    }
  }

  // Set the gun's aim (yaw/pitch in ship-local radians).
  setAim(yaw, pitch) {
    this.aimYaw = clamp(yaw, -2.3, 2.3); this.aimPitch = clamp(pitch, -0.35, 0.6);
    this.yawG.rotation.y = this.aimYaw; this.pitchG.rotation.x = this.aimPitch;
    this.yawG.updateMatrixWorld(true);
  }

  // ---------- View ----------
  view(dt) {
    this.yawG.rotation.y = this.aimYaw;
    this.pitchG.rotation.x = this.aimPitch;
    this.aimLine.visible = this.aimShown && !this.anyLineOut();
    if (this.aimLine.visible) {
      // Trace the hook's flight and stop the line where it would land
      this.yawG.updateMatrixWorld(true);
      const p = this.aimLine.geometry.attributes.position;
      this.muzzle.getWorldPosition(_a); this.gunDir(_b).multiplyScalar(HOOK_SPEED).add(this.G.ship.vel);
      p.setXYZ(0, _a.x, _a.y, _a.z);
      let onShip = false; const pt = _a.clone(), v = _b.clone(), l = new THREE.Vector3();
      for (let i = 0; i < 60; i++) {
        v.y -= 9.81 * 0.6 * 0.03; pt.addScaledVector(v, 0.03);
        if (pt.distanceTo(_a) > GRAPPLE_RANGE || pt.y < 0) break;
        if (this.G.enemies.ships.some((e) => e.alive && e.containsWorld(pt, 0.5))) { onShip = true; break; }
      }
      p.setXYZ(1, pt.x, pt.y, pt.z); p.needsUpdate = true;
      this.aimLine.material.color.setHex(onShip ? 0x50ff60 : 0xffd25a);
    }
    this.aimShown = false;
    this.loadedHook.visible = !this.hook && !this.locks.some((l) => l.by === 'us');
    if (this.hook) {
      this.muzzle.getWorldPosition(_a);
      this.setRope(this.flyRope, _a, this.hook.pos, 0);
      this.flyHook.visible = true; this.flyHook.position.copy(this.hook.pos);
      this.flyHook.lookAt(_b.copy(this.hook.pos).sub(this.hook.vel));
    } else { this.flyRope.visible = false; this.flyHook.visible = false; }
    for (const l of this.locks) {
      const tight = l.phase === 'locked' ? 0.25 : 0.05;
      if (l.by === 'us') this.muzzle.getWorldPosition(_a);
      else this.G.ship.root.localToWorld(_a.set(l.side * halfWidth(-3) * 0.97, 1.0, -3));
      l.e.root.localToWorld(_b.copy(l.hookLocal));
      this.setRope(l.rope, _a, _b, tight);
      if (l.rope2) {
        this.G.ship.root.localToWorld(_a.set(l.side * halfWidth(3.5) * 0.97, 1.0, 3.5));
        l.e.root.localToWorld(_b.set(-l.side * halfWidth(3.5) * 0.97, 1.0, 3.5));
        this.setRope(l.rope2, _a, _b, tight);
      }
    }
  }

  // Point the gun along a world direction (from the hand holding it, or the desktop camera).
  aimAlong(dirWorld) {
    this.G.ship.root.getWorldQuaternion(_q).invert();
    _a.copy(dirWorld).applyQuaternion(_q);
    this.setAim(Math.atan2(-_a.x, -_a.z), Math.asin(clamp(_a.y, -1, 1)));
  }
  // The gun's current firing direction (world).
  gunDir(out) {
    this.pitchG.getWorldQuaternion(_q);
    return out.set(0, 0, -1).applyQuaternion(_q);
  }
}
