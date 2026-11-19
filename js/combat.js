import * as THREE from 'three';
import { waveHeight } from './waves.js';
import { BALL_SPEED, HELM_COVER } from './ship.js';
import { segSegDist, rand } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3(), _r = new THREE.Vector3(), _qi = new THREE.Quaternion();

// Distance along a ray (origin o, direction r, both ship-local) to a box, or Infinity.
function rayBox(o, r, min, max) {
  let t0 = 0, t1 = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(r[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return Infinity; continue; }
    let a = (min[k] - o[k]) / r[k], b = (max[k] - o[k]) / r[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
// Is this deck spot inside an enemy helm shelter?
const inShelter = (pos) => Math.abs(pos.x) < HELM_COVER.x && pos.z > HELM_COVER.z0 && pos.z < HELM_COVER.z1;
const BALL_GEO = new THREE.SphereGeometry(0.15, 10, 8);
const BALL_MAT = new THREE.MeshLambertMaterial({ color: 0x1b1b1e });

// Game rules for fighting: cannonballs, musket shots and sword hits.
// Nothing here plays a sound or effect directly. It changes game state and emits events
// (see events.js); presentation.js turns those into flashes, smoke, sounds and haptics.
// In multiplayer only the host runs these rules; everyone else just hears the events.
export class Combat {
  constructor(G) {
    this.G = G; this.free = []; this.active = [];
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(BALL_GEO, BALL_MAT); mesh.visible = false; G.scene.add(mesh);
      // pos/vel are the ball's real state; the mesh just copies pos each frame.
      this.free.push({ id: null, mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), owner: null, life: 0 });
    }
  }

  allShips() { return [this.G.ship, ...this.G.enemies.ships]; }

  spawnBall(pos, vel, owner) {
    const b = this.free.pop(); if (!b) return;
    b.id = this.G.ids.next('ball');
    b.pos.copy(pos); b.mesh.position.copy(pos); b.vel.copy(vel); b.owner = owner; b.life = 0; b.mesh.visible = true;
    this.active.push(b);
  }

  fireCannon(ship, c) {
    const G = this.G;
    c.muzzle.getWorldPosition(_a);
    c.elev.getWorldDirection(_b).negate();
    _c.copy(_b).multiplyScalar(BALL_SPEED).add(ship.vel);
    this.spawnBall(_a, _c, ship);
    c.reload = ship.reloadTime; c.recoil = 1;
    G.events.emit('cannonFired', { ship, cannon: c, pos: _a, dir: _b });
  }

  // Light every loaded cannon that has a target, one after another. Returns how many.
  broadside(ship) {
    let n = 0;
    for (const c of ship.cannons) if (c.inArc && ship.lightCannon(c, 0.15 + n++ * 0.25)) this.G.events.emit('fuseLit', { ship, cannon: c, pos: c.breech.getWorldPosition(_a) });
    return n;
  }

  // An enemy ship just went down (rules side: score and its crew).
  enemySunk(s) {
    const G = this.G;
    G.score++;
    G.events.emit('enemySunk', { ship: s, score: G.score });
    for (const m of s.crew) if (!m.p.dead && Math.random() < 0.5) { m.p.dead = true; m.p.pose = null; }
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
      const p = b.pos; p.addScaledVector(b.vel, dt); b.mesh.position.copy(p);
      let done = false;
      for (const s of this.allShips()) {
        if (s === b.owner || !s.alive) continue;
        if ((s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 > 225) continue;
        if (s.containsWorld(p)) {
          const dmg = b.owner.isPlayer ? 14 : 5;
          s.damage(dmg);
          // Splinters: sailors close to where it hit may go down (not behind the helm shelter)
          if (s !== G.ship) {
            _a.copy(p); s.root.worldToLocal(_a);
            for (const m of s.crew) {
              const mp = m.p.g.position;
              if (!m.p.dead && !inShelter(mp) && Math.hypot(mp.x - _a.x, mp.z - _a.z) < 2.4 && Math.random() < 0.6) G.enemies.killCrew(s, m, 'cannon');
            }
          }
          G.events.emit('shipHit', { ship: s, pos: p, by: b.owner });
          if (s !== G.ship && !s.alive) this.enemySunk(s);
          done = true; break;
        }
      }
      if (!done && p.y < waveHeight(p.x, p.z, t)) {
        G.events.emit('ballSplash', { pos: p }); done = true;
      }
      if (!done && b.life > 9) done = true;
      if (done) { b.mesh.visible = false; this.active.splice(i, 1); this.free.push(b); }
    }
  }

  // Ray hit test against boarders, enemy deck crew, enemy hulls and water.
  // origin/dir: the shot's ray in world space. visFrom: where the muzzle flash is drawn.
  musketShot(origin, dir, visFrom) {
    const G = this.G, MAX = 160;
    _e.copy(origin).addScaledVector(dir, MAX);
    let bestT = MAX, hit = null;
    // tight: someone behind cover only shows their head, so no extra forgiveness for them
    const testPerson = (p, root, h, tight) => {
      _c.copy(p.g.position).setY(p.g.position.y + 0.2); root.localToWorld(_c);
      _d.copy(p.g.position).setY(p.g.position.y + 1.75); root.localToWorld(_d);
      const r = segSegDist(origin, _e, _c, _d);
      const reach = tight ? 0.2 : 0.3 + r.s * MAX * 0.012; // forgiving: wider the further away
      if (r.d < reach && r.s * MAX < bestT) { bestT = r.s * MAX; hit = h; }
    };
    for (const b of G.enemies.boarders) if (b.state !== 'dead') testPerson(b.p, G.ship.root, { kind: 'boarder', b });
    for (const s of G.enemies.ships) for (const m of s.crew) if (!m.p.dead) testPerson(m.p, s.root, { kind: 'enemyCrew', m, s }, inShelter(m.p.g.position));
    // Cover on deck (helm shelter, stern cabin) stops the ball
    for (const s of G.enemies.ships) {
      if (!s.alive || s.pos.distanceTo(origin) > MAX + 20) continue;
      _o.copy(origin); s.root.worldToLocal(_o);
      s.root.getWorldQuaternion(_qi).invert(); _r.copy(dir).applyQuaternion(_qi);
      for (const c of s.covers) { const t = rayBox(_o, _r, c.min, c.max); if (t < bestT) { bestT = t; hit = { kind: 'hull', s, cover: true }; } }
    }
    // Hulls: march along the ray
    for (const s of G.enemies.ships) {
      if (!s.alive || s.pos.distanceTo(origin) > MAX + 20) continue;
      for (let t = 1; t < bestT; t += 0.6) {
        _a.copy(origin).addScaledVector(dir, t);
        if (s.containsWorld(_a, 0)) { bestT = t; hit = { kind: 'hull', s }; break; }
      }
    }
    // Water
    if (dir.y < -0.01) { const t = -origin.y / dir.y; if (t > 0 && t < bestT) { bestT = t; hit = { kind: 'water' }; } }
    _f.copy(origin).addScaledVector(dir, bestT);
    if (hit) {
      if (hit.kind === 'boarder') G.enemies.killBoarder(hit.b);
      else if (hit.kind === 'enemyCrew') G.enemies.killCrew(hit.s, hit.m, 'musket');
      else if (hit.kind === 'hull' && !hit.cover) hit.s.damage(3);
      G.events.emit('musketHit', { kind: hit.kind, pos: _f });
      if (hit.kind === 'hull' && !hit.s.alive) this.enemySunk(hit.s);
    }
    G.events.emit('musketShot', { from: visFrom, dir, to: _f, hit: hit ? hit.kind : null });
  }

  // Sword blade (hilt->tip, both in player-ship local space) against boarders.
  // `player` is whoever swung it: boarders get knocked back away from them.
  swordCheck(player, hilt, tip, speed) {
    const G = this.G; let any = false;
    if (speed < 2.2) return false;
    for (const b of G.enemies.boarders) {
      if (b.state === 'dead' || b.hitCD > 0) continue;
      const p = b.p.g.position;
      _c.set(p.x, p.y + 0.3, p.z); _d.set(p.x, p.y + 1.75, p.z);
      if (segSegDist(hilt, tip, _c, _d).d < 0.32) {
        _a.copy(tip).sub(hilt).multiplyScalar(0.7).add(hilt); G.ship.root.localToWorld(_a);
        G.events.emit('bladeContact', { pos: _a });
        const kx = p.x - player.headLocal.x, kz = p.z - player.headLocal.z;
        if (b.p.attack >= 0 && b.p.attack < 0.5 && Math.random() < 0.3) { G.events.emit('parried', { pos: _a }); b.hitCD = 0.3; b.p.attack = -1; }
        else { G.events.emit('boarderStruck', { pos: _a }); G.enemies.hitBoarder(b, speed > 6 ? 2 : 1, kx, kz); }
        any = true;
      }
    }
    return any;
  }

  // Desktop slash: hits boarders in a cone in front of the player.
  // `facing` is the player's look direction in ship-local space, flattened (y = 0, length 1).
  deskSwordHit(player, facing) {
    const G = this.G, h = player.headLocal;
    _a.copy(facing);
    for (const b of G.enemies.boarders) {
      if (b.state === 'dead') continue;
      const p = b.p.g.position; const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * _a.x + dz * _a.z) / Math.max(d, 1e-3) > 0.5) {
        _b.set(p.x, 1.3, p.z); G.ship.root.localToWorld(_b);
        G.events.emit('bladeContact', { pos: _b }); G.events.emit('boarderStruck', { pos: _b });
        G.enemies.hitBoarder(b, 1, dx, dz);
      }
    }
  }
}
