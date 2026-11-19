import * as THREE from 'three';
import { waveHeight } from './waves.js';
import { BALL_SPEED } from './ship.js';
import { segSegDist, rand } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3();
const BALL_GEO = new THREE.SphereGeometry(0.15, 10, 8);
const BALL_MAT = new THREE.MeshLambertMaterial({ color: 0x1b1b1e });

export class Combat {
  constructor(G) {
    this.G = G; this.free = []; this.active = [];
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(BALL_GEO, BALL_MAT); mesh.visible = false; G.scene.add(mesh);
      this.free.push({ mesh, vel: new THREE.Vector3(), owner: null, life: 0 });
    }
  }

  allShips() { return [this.G.ship, ...this.G.enemies.ships]; }

  spawnBall(pos, vel, owner) {
    const b = this.free.pop(); if (!b) return;
    b.mesh.position.copy(pos); b.vel.copy(vel); b.owner = owner; b.life = 0; b.mesh.visible = true;
    this.active.push(b);
  }

  fireCannon(ship, c) {
    const G = this.G;
    c.muzzle.getWorldPosition(_a);
    c.elev.getWorldDirection(_b).negate();
    _c.copy(_b).multiplyScalar(BALL_SPEED).add(ship.vel);
    this.spawnBall(_a, _c, ship);
    G.fx.flash(_a, 2.6); G.fx.smoke(_a, _b, 14, 1.1);
    G.audio.cannon(_a);
    c.reload = ship.reloadTime; c.recoil = 1;
    if (ship === G.ship) for (const h of G.player.hands) if (h.gp) { h.grip.getWorldPosition(_d); if (_d.distanceTo(_a) < 4) G.player.haptic(h, 0.8, 120); }
  }

  // Desktop helper: fire every loaded cannon that has a target.
  broadside() {
    const S = this.G.ship; let n = 0;
    for (const c of S.cannons) if (c.inArc && S.lightCannon(c, 0.15 + n++ * 0.25)) { c.breech.getWorldPosition(_a); this.G.audio.fuse(_a); }
    if (!n) this.G.hud.msg('No target in the cannons’ arc', 1.5);
  }

  update(dt, t) {
    const G = this.G;
    // Burning fuses
    for (const s of this.allShips()) for (const c of s.cannons) {
      if (c.fuse < 0) continue;
      c.fuse -= dt; c.sparkT -= dt;
      if (c.sparkT <= 0) { c.sparkT = 0.04; c.breech.getWorldPosition(_a); G.fx.sparks(_a, 2, 0.1); }
      if (c.fuse <= 0) { c.fuse = -1; if (s.alive) this.fireCannon(s, c); }
    }
    // Cannonballs in flight
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.life += dt; b.vel.y -= 9.81 * dt;
      const p = b.mesh.position; p.addScaledVector(b.vel, dt);
      let done = false;
      for (const s of this.allShips()) {
        if (s === b.owner || !s.alive) continue;
        if ((s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 > 225) continue;
        if (s.containsWorld(p)) {
          const dmg = b.owner.isPlayer ? 14 : 5;
          s.damage(dmg);
          G.fx.debris(p, 14); G.fx.flash(p, 1.2); G.audio.woodHit(p);
          if (s === G.ship) {
            for (const h of G.player.hands) G.player.haptic(h, 0.5, 80);
            if (Math.random() < 0.3) G.hud.msg('We’re taking hits!', 2);
          } else if (!s.alive) G.onEnemySunk(s);
          done = true; break;
        }
      }
      if (!done && p.y < waveHeight(p.x, p.z, t)) {
        G.fx.splash(p, 1); if (p.distanceTo(G.ship.pos) < 250) G.audio.splash(p, 0.8); done = true;
      }
      if (!done && b.life > 9) done = true;
      if (done) { b.mesh.visible = false; this.active.splice(i, 1); this.free.push(b); }
    }
  }

  // Ray hit test against boarders, enemy deck crew, enemy hulls and water.
  musketShot(origin, dir, visFrom) {
    const G = this.G, MAX = 160;
    _e.copy(origin).addScaledVector(dir, MAX);
    let bestT = MAX, hit = null;
    const testPerson = (p, root, onHit) => {
      _c.copy(p.g.position).setY(p.g.position.y + 0.2); root.localToWorld(_c);
      _d.copy(p.g.position).setY(p.g.position.y + 1.75); root.localToWorld(_d);
      const r = segSegDist(origin, _e, _c, _d);
      if (r.d < 0.3 + r.s * MAX * 0.012 && r.s * MAX < bestT) { bestT = r.s * MAX; hit = onHit; } // forgiving: wider the further away
    };
    for (const b of G.enemies.boarders) if (b.state !== 'dead') testPerson(b.p, G.ship.root, () => { G.enemies.killBoarder(b); G.audio.thud(_f); G.hud.msg('Got him!', 1.2); });
    for (const s of G.enemies.ships) for (const m of s.crew) if (!m.p.dead) testPerson(m.p, s.root, () => { m.p.dead = true; G.audio.thud(_f); G.hud.msg('Sharpshooter! One of theirs is down', 1.8); });
    // Hulls: march along the ray
    for (const s of G.enemies.ships) {
      if (!s.alive || s.pos.distanceTo(origin) > MAX + 20) continue;
      for (let t = 1; t < bestT; t += 0.6) {
        _a.copy(origin).addScaledVector(dir, t);
        if (s.containsWorld(_a, 0)) { bestT = t; hit = () => { s.damage(3); G.fx.debris(_f, 8); G.audio.woodHit(_f); if (!s.alive) G.onEnemySunk(s); }; break; }
      }
    }
    // Water
    if (dir.y < -0.01) { const t = -origin.y / dir.y; if (t > 0 && t < bestT) { bestT = t; hit = () => { G.fx.splash(_f, 0.3); }; } }
    _f.copy(origin).addScaledVector(dir, bestT);
    if (hit) { hit(); G.fx.hit(_f); }
    G.fx.flash(visFrom, 0.6); G.fx.smoke(visFrom, dir, 5, 0.35);
    G.fx.shot(visFrom, _f);
    G.audio.musket(visFrom);
  }

  // Sword blade (hilt->tip, both in player-ship local space) against boarders.
  swordCheck(hilt, tip, speed) {
    const G = this.G; let any = false;
    if (speed < 2.2) return false;
    for (const b of G.enemies.boarders) {
      if (b.state === 'dead' || b.hitCD > 0) continue;
      const p = b.p.g.position;
      _c.set(p.x, p.y + 0.3, p.z); _d.set(p.x, p.y + 1.75, p.z);
      if (segSegDist(hilt, tip, _c, _d).d < 0.32) {
        _a.copy(tip).sub(hilt).multiplyScalar(0.7).add(hilt); G.ship.root.localToWorld(_a);
        G.fx.hit(_a);
        const kx = p.x - G.player.headLocal.x, kz = p.z - G.player.headLocal.z;
        if (b.p.attack >= 0 && b.p.attack < 0.5 && Math.random() < 0.3) { G.audio.clang(_a); b.hitCD = 0.3; b.p.attack = -1; }
        else { G.audio.thud(_a); G.enemies.hitBoarder(b, speed > 6 ? 2 : 1, kx, kz); }
        any = true;
      }
    }
    return any;
  }

  deskSwordHit() {
    const G = this.G, h = G.player.headLocal;
    G.camera.getWorldDirection(_a); G.ship.root.getWorldQuaternion(new THREE.Quaternion());
    const q = new THREE.Quaternion(); G.ship.root.getWorldQuaternion(q).invert(); _a.applyQuaternion(q); _a.y = 0; _a.normalize();
    for (const b of G.enemies.boarders) {
      if (b.state === 'dead') continue;
      const p = b.p.g.position; const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * _a.x + dz * _a.z) / Math.max(d, 1e-3) > 0.5) {
        _b.set(p.x, 1.3, p.z); G.ship.root.localToWorld(_b);
        G.fx.hit(_b); G.audio.thud(_b);
        G.enemies.hitBoarder(b, 1, dx, dz);
      }
    }
  }
}
