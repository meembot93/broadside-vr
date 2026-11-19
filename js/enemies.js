import * as THREE from 'three';
import { Ship, halfWidth } from './ship.js';
import { makePerson, animatePerson, facePerson } from './people.js';
import { clamp, angleWrap, rand } from './util.js';

const _a = new THREE.Vector3();
const LOOKS = [
  { shirt: 0x2a2a2a, pants: 0x5a1a1a, bandana: 0x111111, cutlass: true, beard: 0x1a1a1a },
  { shirt: 0x7a1d1d, pants: 0x2a2a2a, hat: 0x111111, cutlass: true },
  { shirt: 0x4a4038, pants: 0x1e1e2a, bandana: 0x7a1d1d, cutlass: true, skin: 0x8d5a3b },
  { shirt: 0x5a5a3a, pants: 0x3a2a1a, hat: 0x2a1a10, cutlass: true, beard: 0x5a3a1a },
];

export class Enemies {
  constructor(G) {
    this.G = G; this.ships = []; this.boarders = [];
    this.spawnT = G.debug ? 2 : 14; this.warnedBoard = false;
  }

  maxShips() { return Math.min(1 + Math.floor(this.G.score / 2), 3); }

  spawn() {
    const G = this.G, P = G.ship;
    const a = rand(0, Math.PI * 2), d = G.debug ? 110 : rand(240, 300);
    const x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d;
    const heading = Math.atan2(-(P.pos.x - x), -(P.pos.z - z));
    const s = new Ship(G.scene, { x, z, heading, maxSpeed: 7.6, turnRate: 0.22, health: 100, sail: 1, reloadTime: 9 });
    s.ai = { canBoard: this.ships.length === 0 && G.score === 0 ? true : Math.random() < 0.6, mode: 'approach', inRangeT: 0, boardT: 3, sent: 0 };
    const spots = [[-1.3, -2.2], [1.4, -3.6], [0.9, 2.6], [-0.8, -5.2], [-1.2, 3.4]];
    for (let i = 0; i < 4; i++) {
      const p = makePerson(LOOKS[i % LOOKS.length]);
      p.g.position.set(spots[i][0], 0, spots[i][1]); s.root.add(p.g);
      s.crew.push({ p });
    }
    this.ships.push(s);
    G.hud.msg(this.ships.length > 1 ? 'Another sail on the horizon!' : 'Enemy ship sighted!', 3.5);
    G.audio.bell();
  }

  clearAll() {
    for (const s of this.ships) s.dispose();
    this.ships = [];
    for (const b of this.boarders) this.G.ship.root.remove(b.p.g);
    this.boarders = [];
    this.spawnT = 14;
  }

  steer(e, desired) {
    e.rudder = clamp(angleWrap(e.heading - desired) * 1.6, -1, 1);
  }

  ai(e, dt) {
    const G = this.G, P = G.ship, A = e.ai;
    const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    if (dist < 100) A.inRangeT += dt;
    if (A.mode !== 'board' && A.canBoard && P.alive && (e.health < 75 || A.inRangeT > 35)) {
      A.mode = 'board';
    } else if (A.mode === 'approach' && dist < 90) A.mode = 'broadside';
    if (A.mode === 'broadside' && dist > 130) A.mode = 'approach';

    if (A.mode === 'approach' || (A.mode === 'board' && dist > 35)) {
      // Head for where the player will be in a few seconds
      const ix = P.pos.x + P.vel.x * 4 - e.pos.x, iz = P.pos.z + P.vel.z * 4 - e.pos.z;
      this.steer(e, Math.atan2(-ix, -iz)); e.sail = 1;
    }
    else {
      const want = A.mode === 'board' ? 11 : 50;
      const a1 = angleWrap(bearing + Math.PI / 2), a2 = angleWrap(bearing - Math.PI / 2);
      const useA1 = Math.abs(angleWrap(a1 - e.heading)) < Math.abs(angleWrap(a2 - e.heading));
      let desired = useA1 ? a1 : a2;
      const adj = clamp((dist - want) / 40, -0.5, 0.6);
      desired = angleWrap(desired + (useA1 ? -adj : adj));
      this.steer(e, desired);
      e.sail = A.mode === 'board' ? (dist < 25 ? clamp(P.speed / e.maxSpeed + 0.1, 0.3, 1) : 1) : 0.65;
    }
    // Don't ram straight through us
    if (dist < 12) { const k = (12 - dist) * dt * 1.5 / Math.max(dist, 0.1); e.pos.x -= dx * k; e.pos.z -= dz * k; }

    // Cannons
    for (const c of e.cannons) {
      c.inArc = e.aimCannon(c, P, 0.03);
      if (!c.inArc) { c.tElev = 0.05; c.tYaw = 0; }
      else if (e.cannonReady(c) && P.alive && Math.random() < dt * 1.5) e.lightCannon(c, rand(0.2, 0.7));
    }

    // Boarding
    if (A.mode === 'board' && dist < 24 && P.alive && !G.player.dead) {
      A.boardT -= dt;
      const live = this.boarders.filter((b) => b.state !== 'dead').length;
      if (A.boardT <= 0 && live < 3 && A.sent < 5) { A.boardT = rand(4, 7); A.sent++; this.spawnBoarder(e); }
    }
  }

  spawnBoarder(e) {
    const G = this.G, P = G.ship;
    _a.copy(e.root.position); P.root.worldToLocal(_a);
    const side = Math.sign(_a.x) || 1;
    const z = clamp(_a.z * 0.3 + rand(-2.5, 2.5), -6.5, 4.5);
    const p = makePerson(LOOKS[Math.floor(Math.random() * LOOKS.length)]);
    const from = new THREE.Vector3(side * 5, 2.8, z), to = new THREE.Vector3(side * (halfWidth(z) - 0.8), 0, z);
    p.g.position.copy(from); P.root.add(p.g);
    this.boarders.push({ p, state: 'jump', t: 0, from, to, hp: 2, atkCD: rand(0.6, 1.2), hitCD: 0, swingHit: true });
    G.audio.swoosh(e.root.position);
    if (!this.warnedBoard) { this.warnedBoard = true; G.hud.msg('Boarders! Grab the sword or a musket!', 4); }
    else G.hud.msg('More boarders!', 2);
  }

  hitBoarder(b, dmg, kx, kz) {
    if (b.state === 'dead') return;
    b.hp -= dmg; b.hitCD = 0.35;
    const d = Math.hypot(kx, kz) || 1;
    b.p.g.position.x += (kx / d) * 0.35; b.p.g.position.z += (kz / d) * 0.35;
    b.p.attack = -1; b.atkCD = Math.max(b.atkCD, 0.9);
    if (b.hp <= 0) this.killBoarder(b);
  }

  killBoarder(b) {
    if (b.state === 'dead') return;
    b.state = 'dead'; b.p.dead = true; b.p.deadT = 0; b.deadT = 0;
    if (this.boarders.every((x) => x.state === 'dead')) this.G.hud.msg('Deck cleared!', 2);
  }

  updateBoarders(dt, t) {
    const G = this.G, head = G.player.headLocal;
    for (let i = this.boarders.length - 1; i >= 0; i--) {
      const b = this.boarders[i], p = b.p, pos = p.g.position;
      b.hitCD -= dt;
      if (b.state === 'jump') {
        b.t += dt / 0.9; const u = Math.min(1, b.t);
        pos.lerpVectors(b.from, b.to, u); pos.y += Math.sin(Math.PI * u) * 1.3;
        facePerson(p, -b.from.x, 0, dt, 20);
        animatePerson(p, dt, false, t);
        if (u >= 1) b.state = 'fight';
        continue;
      }
      if (b.state === 'dead') {
        b.deadT += dt; animatePerson(p, dt, false, t);
        if (b.deadT > 2.5) pos.y -= dt * 0.8;
        if (b.deadT > 4) { G.ship.root.remove(p.g); this.boarders.splice(i, 1); }
        continue;
      }
      // Fight: close in on the player and swing
      const dx = head.x - pos.x, dz = head.z - pos.z, d = Math.hypot(dx, dz);
      facePerson(p, dx, dz, dt);
      let moving = false;
      if (d > 1.05 && p.attack < 0 && !G.player.dead) {
        const sp = 1.8 * dt / d; pos.x += dx * sp; pos.z += dz * sp; moving = true;
      }
      for (const o of this.boarders) {
        if (o === b || o.state === 'dead') continue;
        const ox = pos.x - o.p.g.position.x, oz = pos.z - o.p.g.position.z, od = Math.hypot(ox, oz);
        if (od < 0.75 && od > 1e-3) { pos.x += (ox / od) * (0.75 - od) * 0.5; pos.z += (oz / od) * (0.75 - od) * 0.5; }
      }
      const zc = clamp(pos.z, -8.4, 6.9), hw = halfWidth(zc) - 0.4;
      pos.z = zc; pos.x = clamp(pos.x, -hw, hw); pos.y = 0;
      b.atkCD -= dt;
      if (d < 1.45 && b.atkCD <= 0 && p.attack < 0 && !G.player.dead) { p.attack = 0; b.swingHit = false; b.atkCD = rand(1.4, 2.1); }
      if (p.attack > 0.62 && !b.swingHit) {
        b.swingHit = true;
        _a.set(pos.x, 1.3, pos.z); G.ship.root.localToWorld(_a); G.audio.swoosh(_a);
        if (d < 1.7) G.player.hurt(10);
      }
      animatePerson(p, dt, moving, t);
    }
  }

  update(dt, t) {
    const G = this.G;
    const alive = this.ships.filter((s) => s.alive).length;
    if (alive < this.maxShips() && G.ship.alive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(); this.spawnT = rand(18, 26); }
    }
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const e = this.ships[i];
      if (e.alive) this.ai(e, dt);
      e.update(dt, t);
      for (const m of e.crew) {
        if (!m.p.dead) { _a.copy(G.ship.pos).sub(e.pos); const l = _a.applyAxisAngle(new THREE.Vector3(0, 1, 0), -e.heading); facePerson(m.p, l.x - m.p.g.position.x, l.z - m.p.g.position.z, dt, 2); }
        animatePerson(m.p, dt, false, t + i);
      }
      if (!e.alive && e.sinkT > 14) { e.dispose(); this.ships.splice(i, 1); }
    }
    this.updateBoarders(dt, t);
  }
}
