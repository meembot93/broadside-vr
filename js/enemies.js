import * as THREE from 'three';
import { Ship, halfWidth, HELM_SPOT } from './ship.js';
import { makePerson, animatePerson, facePerson } from './people.js';
import { clamp, angleWrap, rand, damp } from './util.js';

const _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
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
    // Pick a spot in open water (the cove has land on most sides)
    let a = 0, d = 0, x = 0, z = 0;
    for (let i = 0; i < 40; i++) {
      a = rand(0, Math.PI * 2); d = G.debug ? 110 : rand(220, 300) * (i < 20 ? 1 : 0.75);
      x = P.pos.x + Math.sin(a) * d; z = P.pos.z + Math.cos(a) * d;
      if (G.world.isOpenWater(x, z, 30)) break;
    }
    const heading = Math.atan2(-(P.pos.x - x), -(P.pos.z - z));
    const s = new Ship(G.scene, { id: G.ids.next('ship'), x, z, heading, maxSpeed: 7.6, turnRate: 0.22, health: 100, sail: 1, reloadTime: 9 });
    s.ai = { canBoard: this.ships.length === 0 && G.score === 0 ? true : Math.random() < 0.6, mode: 'approach', inRangeT: 0, boardT: 3, sent: 0 };
    s.driftRudder = rand(-0.3, 0.3);
    // Every job on an enemy ship needs a living sailor: no helmsman, no steering; no gunner
    // at a cannon, no shot. Kill them all and the ship drifts.
    const roles = [['helm', 0, HELM_SPOT.x, HELM_SPOT.z], ['gunner', -1, -1.3, -1], ['gunner', 1, 1.3, -1], ['rigger', 0, 0.9, -2.6], ['mate', 0, -0.9, 2.8]];
    roles.forEach(([role, side, x, z], i) => {
      const p = makePerson(LOOKS[i % LOOKS.length]);
      p.g.position.set(x, 0, z); s.root.add(p.g);
      s.crew.push({ id: `${s.id}/crew:${i}`, p, role, side, hp: 2, cannon: null, aimT: 0, hitCD: 0, atkCD: rand(0.6, 1.2), swingHit: true, workT: 0 });
    });
    this.ships.push(s);
    G.events.emit('enemySpawned', { ship: s, count: this.ships.length });
  }

  clearAll() {
    for (const s of this.ships) s.dispose();
    this.ships = [];
    for (const b of this.boarders) this.G.ship.root.remove(b.p.g);
    this.boarders = [];
    this.spawnT = 14;
  }

  steer(e, desired) {
    desired = this.G.world.avoidLand(e.pos.x, e.pos.z, desired);
    e.rudder = clamp(angleWrap(e.heading - desired) * 1.6, -1, 1);
  }

  // Who is standing at the wheel right now (null if nobody).
  helmsman(e) {
    return e.crew.find((m) => !m.p.dead && m.role === 'helm' && Math.hypot(m.p.g.position.x - HELM_SPOT.x, m.p.g.position.z - HELM_SPOT.z) < 0.45) || null;
  }

  ai(e, dt) {
    const G = this.G, P = G.ship, A = e.ai;
    if (e.abandoned) { this.drift(e, dt); return; }
    const helm = this.helmsman(e), sail0 = e.sail, rudder0 = e.rudder;
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
    // Nobody at the wheel: the rudder swings loose and she wanders; the sails stay as they were
    if (!helm) { e.sail = sail0; e.rudder = damp(rudder0, e.driftRudder, 0.8, dt); }
    // Don't ram straight through us
    if (dist < 12) { const k = (12 - dist) * dt * 1.5 / Math.max(dist, 0.1); e.pos.x -= dx * k; e.pos.z -= dz * k; }

    // Cannons: aimed here, but only fired by a gunner standing at the breech (see updateCrew)
    for (const c of e.cannons) {
      c.inArc = P.alive && e.aimCannon(c, P, 0.03);
      if (!c.inArc) { c.tElev = 0.05; c.tYaw = 0; }
    }

    // Boarding (only while someone is alive on deck to fight them)
    if (A.mode === 'board' && dist < 24 && P.alive && G.players.some((pl) => !pl.dead)) {
      A.boardT -= dt;
      const live = this.boarders.filter((b) => b.state !== 'dead').length;
      if (A.boardT <= 0 && live < 3 && A.sent < 5) { A.boardT = rand(4, 7); A.sent++; this.spawnBoarder(e); }
    }
  }

  // A ship with nobody left aboard: loose rudder, sails slowly spilling their wind.
  drift(e, dt) {
    e.rudder = damp(e.rudder, e.driftRudder, 0.5, dt);
    e.sail = damp(e.sail, 0.08, 0.15, dt);
    for (const c of e.cannons) { c.inArc = false; c.tElev = -0.05; c.tYaw = 0; }
  }

  // One of an enemy ship's own crew is killed (musket, cannonball or sword).
  killCrew(e, m, cause) {
    if (m.p.dead) return;
    m.p.dead = true; m.p.deadT = 0; m.p.pose = null;
    const left = e.crew.filter((x) => !x.p.dead).length;
    this.G.events.emit('enemyCrewKilled', { ship: e, role: m.role, left, cause });
    if (left === 0 && e.alive && !e.abandoned) {
      e.abandoned = true; e.ai.mode = 'adrift';
      this.G.events.emit('enemyAbandoned', { ship: e });
    }
  }

  // Walk a deck-hand toward (tx, tz) on its own ship. Returns true once there.
  walk(m, tx, tz, dt, speed = 1.9) {
    const pos = m.p.g.position, dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.12) return true;
    const k = Math.min(d, speed * dt) / d; pos.x += dx * k; pos.z += dz * k;
    facePerson(m.p, dx, dz, dt);
    // Step around the masts
    for (const mz of [-1, -6.5]) {
      const ox = pos.x, oz = pos.z - mz, od = Math.hypot(ox, oz);
      if (od < 0.55) { const s = od > 1e-4 ? 0.55 / od : 1; pos.x = (ox * s) || 0.55; pos.z = mz + oz * s; }
    }
    const zc = clamp(pos.z, -8.4, 6.9), hw = halfWidth(zc) - 0.45; pos.z = zc; pos.x = clamp(pos.x, -hw, hw);
    return false;
  }

  // Hand out the jobs that matter: the wheel first, then a gunner for each side.
  // Called whenever someone aboard dies.
  assignRoles(e) {
    const live = e.crew.filter((m) => !m.p.dead);
    if (!live.length) return;
    const spare = () => live.filter((m) => m.role === 'mate' || m.role === 'rigger').sort((a, b) => (a.role === 'mate' ? -1 : 1))[0]
      || live.filter((m) => m.role === 'gunner')[0];
    if (!live.some((m) => m.role === 'helm')) { const m = spare(); if (m) { m.role = 'helm'; m.cannon = null; this.G.events.emit('enemyHelmTaken', { ship: e }); } }
    const gunners = live.filter((m) => m.role === 'gunner');
    for (const side of [-1, 1]) {
      if (gunners.some((g) => g.side === side)) continue;
      const m = live.find((x) => x.role === 'mate' || x.role === 'rigger');
      if (m) { m.role = 'gunner'; m.side = side; gunners.push(m); }
    }
    // A lone gunner works both sides
    if (gunners.length === 1) gunners[0].side = 0;
  }

  // Enemy deck crew: walk to their jobs and do them.
  updateCrew(e, dt, t, k) {
    const G = this.G, P = G.ship;
    let dead = false;
    for (const m of e.crew) if (m.p.dead && !m.counted) { m.counted = true; dead = true; }
    if (dead) this.assignRoles(e);
    for (const m of e.crew) {
      const p = m.p, pos = p.g.position;
      if (p.dead) { animatePerson(p, dt, false, t + k); continue; }
      let moving = false; p.pose = null;
      m.hitCD -= dt;
      if (!e.alive) { animatePerson(p, dt, false, t + k); continue; }
      if (m.role === 'helm') {
        if (this.walk(m, HELM_SPOT.x, HELM_SPOT.z, dt)) { facePerson(p, 0, -1, dt, 4); p.pose = 'steer'; } else moving = true;
      } else if (m.role === 'gunner') {
        // Go to the best cannon on my side: loaded and with a target first, otherwise one to reload
        let best = null, bs = 1e9;
        for (const c of e.cannons) {
          if (m.side && c.side !== m.side) continue;
          const ready = e.cannonReady(c) && c.inArc;
          const sc = Math.abs(c.z - pos.z) + Math.abs(c.side * 1.25 - pos.x) * 0.3 + (ready ? 0 : c.reload > 0 ? 6 : 12);
          if (sc < bs) { bs = sc; best = c; }
        }
        m.cannon = best;
        if (best && this.walk(m, best.side * 1.25, best.z + 0.35, dt)) {
          facePerson(p, best.side, 0, dt, 5);
          if (e.cannonReady(best) && best.inArc && e.ai.mode !== 'adrift') {
            m.aimT += dt;
            if (m.aimT > 0.6 && e.lightCannon(best, rand(0.2, 0.5))) { m.aimT = 0; p.attack = 0.3; }
          } else { m.aimT = 0; if (best.reload > 0) p.pose = 'ram'; }
        } else moving = !!best;
      } else {
        // Rigger hauls on the lines when the sails change; the mate keeps an eye on us
        const want = m.role === 'rigger' ? [0.9, -2.6] : [-0.9, 2.8];
        if (m.role === 'rigger') { if (Math.abs(e.sail - (m.lastSail ?? e.sail)) > 0.02) m.workT = 2.2; m.lastSail = e.sail; }
        if (this.walk(m, want[0], want[1], dt)) {
          m.workT -= dt;
          if (m.workT > 0) { facePerson(p, -1, 0, dt, 4); p.pose = 'haul'; }
          else { _a.copy(P.pos).sub(e.pos).applyAxisAngle(_up, -e.heading); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2); }
        } else moving = true;
      }
      animatePerson(p, dt, moving, t + k);
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
    this.boarders.push({ id: G.ids.next('boarder'), p, state: 'jump', t: 0, from, to, hp: 2, atkCD: rand(0.6, 1.2), hitCD: 0, swingHit: true });
    G.events.emit('boarderSpawned', { ship: e, first: !this.warnedBoard });
    this.warnedBoard = true;
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
    this.G.events.emit('boarderKilled', { boarder: b });
    if (this.boarders.every((x) => x.state === 'dead')) this.G.events.emit('deckCleared');
  }

  // The player a boarder goes after: the nearest one still standing
  // (or, if everyone is down, the nearest one, just to look at).
  boarderTarget(pos) {
    let best = null, bd = Infinity, any = null, ad = Infinity;
    for (const pl of this.G.players) {
      const d = Math.hypot(pl.headLocal.x - pos.x, pl.headLocal.z - pos.z);
      if (d < ad) { ad = d; any = pl; }
      if (!pl.dead && d < bd) { bd = d; best = pl; }
    }
    return best || any;
  }

  updateBoarders(dt, t) {
    const G = this.G;
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
      // Fight: close in on a player and swing
      const victim = this.boarderTarget(pos), head = victim.headLocal, canFight = !victim.dead;
      const dx = head.x - pos.x, dz = head.z - pos.z, d = Math.hypot(dx, dz);
      facePerson(p, dx, dz, dt);
      let moving = false;
      if (d > 1.05 && p.attack < 0 && canFight) {
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
      if (d < 1.45 && b.atkCD <= 0 && p.attack < 0 && canFight) { p.attack = 0; b.swingHit = false; b.atkCD = rand(1.4, 2.1); }
      if (p.attack > 0.62 && !b.swingHit) {
        b.swingHit = true;
        _a.set(pos.x, 1.3, pos.z); G.ship.root.localToWorld(_a); G.events.emit('boarderSwing', { pos: _a });
        if (d < 1.7) G.hurtPlayer(victim, 10);
      }
      animatePerson(p, dt, moving, t);
    }
  }

  update(dt, t) {
    const G = this.G;
    const alive = this.ships.filter((s) => s.hostile).length;
    if (alive < this.maxShips() && G.ship.alive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(); this.spawnT = rand(18, 26); }
    }
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const e = this.ships[i];
      if (e.alive) this.ai(e, dt);
      e.update(dt, t);
      this.updateCrew(e, dt, t, i);
      if (!e.alive && e.sinkT > 14) { e.dispose(); this.ships.splice(i, 1); }
    }
    this.updateBoarders(dt, t);
  }
}
