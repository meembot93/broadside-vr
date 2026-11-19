import * as THREE from 'three';
import { makePerson, animatePerson, facePerson } from './people.js';
import { halfWidth, HELM_SPOT, WHEEL_MAX, LEVER_MAX } from './ship.js';
import { clamp, angleWrap, rand } from './util.js';

const _a = new THREE.Vector3(), _t = new THREE.Vector3();

// Orders the captain can give the helmsman (cycled with A / X in VR, T on desktop).
export const ORDERS = ['hold', 'chase', 'alongside', 'heave'];
export const ORDER_TEXT = {
  hold: 'Hold this course',
  chase: 'Engage the enemy',
  alongside: 'Bring us alongside',
  heave: 'Heave to (furl sails)',
};

// Spots on deck (ship-local x, z) where the crew have work to do.
const BOW_SPOTS = [[1.3, -6.8], [-1.3, -6.6], [1.1, -7.8]]; // clear of the grapple gun
const ODD_JOBS = [[1.9, -4.6], [-1.9, -4.4], [1.6, 2.9], [-1.5, 3.1], [0.9, -2.4], [-0.9, -6.0]];
const HELM_STANDBY = [1.75, 4.3];

export class Crew {
  constructor(G) {
    this.G = G;
    const defs = [
      { look: { shirt: 0xd9cfb8, pants: 0x3b4a6b, bandana: 0xa82020, beard: 0x3a2414 }, role: 'gunner', side: -1, home: [-1.15, -1.6], name: 'Bones' },
      { look: { shirt: 0x7f8f5f, pants: 0x4a3b2b, hat: 0x2a1d14 }, role: 'gunner', side: 1, home: [1.15, -1.6], name: 'Patch' },
      { look: { shirt: 0x6a2f2a, pants: 0x2b2b2b, bandana: 0x2050a0, skin: 0x8d5a3b }, role: 'lookout', side: 0, home: [1.3, -6.8], name: 'Finn' },
      { look: { shirt: 0x9a8a6a, pants: 0x2e3a2a, bandana: 0x5a3a1a, skin: 0xa8734f }, role: 'bosun', side: 0, home: [-1.5, 3.1], name: 'Mags' },
      { look: { shirt: 0x24304a, pants: 0x2a2a2a, hat: 0x111111, beard: 0x8a8a8a }, role: 'helmsman', side: 0, home: HELM_STANDBY, name: 'Hawkins' },
    ];
    this.members = defs.map((d, i) => {
      const p = makePerson({ ...d.look, cutlass: d.role === 'gunner' });
      p.g.position.set(d.home[0], 0, d.home[1]);
      G.ship.root.add(p.g);
      return { id: `crew:${i}`, name: d.name, p, role: d.role, side: d.side, home: new THREE.Vector3(d.home[0], 0, d.home[1]), atkCD: 0, victim: null, cannon: null, fireCD: 30,
        spot: null, spotT: 0, workT: 0, lastSail: null };
    });
    this.hm = this.members[4];
    // The helm: who steers (a player id, the helmsman's id, or null = wheel left where it is)
    G.ship.helmBy = 'player:0'; G.ship.helmTouchT = 0; G.ship.holdHeading = G.ship.heading;
    this.order = 'hold';
    this.awayT = 0;
  }

  // The crew only lends a hand now and then, so the captain does the real fighting.
  playerFired() { for (const m of this.members) m.fireCD = Math.max(m.fireCD, 12); }

  cheer() { for (const m of this.members) m.p.cheer = 2.5; }

  setOrder(o) {
    this.order = o; this.G.ship.holdHeading = this.G.ship.heading;
    this.G.events.emit('helmOrder', { order: o, helmsmanSteering: this.G.ship.helmBy === this.hm.id, name: this.hm.name });
  }

  // Walk toward (x, z) on deck. Returns true when there.
  walk(m, x, z, dt, speed = 2.1) {
    const pos = m.p.g.position, dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const k = Math.min(d, speed * dt) / d; pos.x += dx * k; pos.z += dz * k;
    facePerson(m.p, dx, dz, dt);
    for (const mz of [-1, -6.5]) {
      const ox = pos.x, oz = pos.z - mz, od = Math.hypot(ox, oz);
      if (od < 0.55) { const s = od > 1e-4 ? 0.55 / od : 1; pos.x = (ox * s) || 0.55; pos.z = mz + oz * s; }
    }
    const zc = clamp(pos.z, -8.4, 6.9), hw = halfWidth(zc) - 0.45; pos.z = zc; pos.x = clamp(pos.x, -hw, hw);
    return false;
  }

  nearestEnemy(hostileOnly = true) {
    const S = this.G.ship;
    let e = null, ed = 1e9;
    for (const s of this.G.enemies.ships) if (hostileOnly ? s.hostile : s.alive) { const d = s.pos.distanceTo(S.pos); if (d < ed) { ed = d; e = s; } }
    return e;
  }

  // ---------- The helm ----------
  // Decide who steers. Touching the wheel or lever makes you the helmsman; walk away from the
  // helm and Hawkins takes over and follows your last order. Come back and he steps aside.
  updateHelm(dt) {
    const G = this.G, S = G.ship, hm = this.hm;
    const near = (r) => G.players.some((pl) => !pl.dead && pl.ship === S && Math.hypot(pl.headLocal.x - HELM_SPOT.x, pl.headLocal.z - HELM_SPOT.z) < r);
    const touching = G.t - S.helmTouchT < 3;
    if (S.helmBy === hm.id) {
      if (touching || near(1.3)) {
        S.helmBy = touching ? S.helmToucher : null;
        G.events.emit('helmHandedBack', { name: hm.name });
      }
      this.awayT = 0;
    } else if (!touching && !near(2.6) && S.alive) {
      this.awayT += dt;
      if (this.awayT > 1.2) { S.helmBy = hm.id; S.holdHeading = S.heading; this.awayT = 0; G.events.emit('helmTaken', { name: hm.name, order: this.order }); }
    } else this.awayT = 0;
  }

  // The helmsman steers the ship by turning the real wheel and lever, following the order.
  steer(dt) {
    const G = this.G, S = G.ship, o = this.order;
    let desired = S.holdHeading, sail = null;
    const e = (o === 'chase' || o === 'alongside') ? this.nearestEnemy() : null;
    if (o === 'heave') { sail = 0; desired = S.heading; }
    else if (e) {
      const dx = e.pos.x - S.pos.x, dz = e.pos.z - S.pos.z, dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(-dx, -dz);
      const want = o === 'alongside' ? 10 : 48;
      if (dist > want + 45) { const ix = e.pos.x + e.vel.x * 4 - S.pos.x, iz = e.pos.z + e.vel.z * 4 - S.pos.z; desired = Math.atan2(-ix, -iz); sail = 1; }
      else {
        // Run beside them: broadside on, closing or opening the range
        const a1 = angleWrap(bearing + Math.PI / 2), a2 = angleWrap(bearing - Math.PI / 2);
        const useA1 = Math.abs(angleWrap(a1 - S.heading)) < Math.abs(angleWrap(a2 - S.heading));
        const adj = clamp((dist - want) / 40, -0.5, 0.6);
        desired = angleWrap((useA1 ? a1 : a2) + (useA1 ? -adj : adj));
        sail = o === 'alongside' && dist < 25 ? clamp(e.speed / S.maxSpeed + 0.1, 0.3, 1) : 0.7;
      }
      S.holdHeading = S.heading;
    }
    desired = G.world.avoidLand(S.pos.x, S.pos.z, desired);
    const rudder = clamp(angleWrap(S.heading - desired) * 1.6, -1, 1);
    const wheel = -rudder * WHEEL_MAX;
    S.wheelAngle += clamp(wheel - S.wheelAngle, -3.5 * dt, 3.5 * dt);
    if (sail !== null) { const lever = LEVER_MAX - sail * 2 * LEVER_MAX; S.leverAngle += clamp(lever - S.leverAngle, -0.5 * dt, 0.5 * dt); }
  }

  // ---------- Everyone ----------
  update(dt, t) {
    const G = this.G, S = G.ship;
    if (G.started) this.updateHelm(dt);
    for (const m of this.members) {
      const p = m.p, pos = p.g.position;
      m.atkCD -= dt; m.fireCD -= dt; p.pose = null;
      // Defend against nearby boarders first
      let foe = null, fd = 1.7;
      for (const b of G.enemies.boarders) {
        if (b.state !== 'fight') continue;
        const d = pos.distanceTo(b.p.g.position);
        if (d < fd) { fd = d; foe = b; }
      }
      if (foe && !(m === this.hm && S.helmBy === m.id)) {
        facePerson(p, foe.p.g.position.x - pos.x, foe.p.g.position.z - pos.z, dt);
        if (fd > 1.0) { const k = 1.8 * dt / fd; pos.x += (foe.p.g.position.x - pos.x) * k; pos.z += (foe.p.g.position.z - pos.z) * k; }
        if (m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.atkCD = 3.2; m.victim = foe; }
        if (p.attack > 0.62 && m.victim) {
          if (Math.random() < 0.15) { _a.set(pos.x, 1.3, pos.z); S.root.localToWorld(_a); G.events.emit('bladeContact', { pos: _a }); G.events.emit('boarderStruck', { pos: _a }); G.enemies.hitBoarder(m.victim, 1, m.victim.p.g.position.x - pos.x, m.victim.p.g.position.z - pos.z); }
          m.victim = null;
        }
        animatePerson(p, dt, fd > 1.0, t);
        continue;
      }
      const moving = !this[m.role](m, dt, t);
      animatePerson(p, dt, moving, t);
    }
  }

  // Each job returns true when standing still (at work), false while walking.
  // A gunner fires now and then, rams and sponges cannons that are reloading, otherwise
  // walks between the guns on their side keeping watch over the rail.
  gunner(m, dt) {
    const G = this.G, S = G.ship, p = m.p, pos = p.g.position;
    if (S.alive && m.fireCD <= 0) {
      let best = null, bd = 1e9;
      for (const c of S.cannons) {
        if (c.side !== m.side || !c.inArc || !c.targetHostile || !S.cannonReady(c)) continue;
        const d = Math.abs(c.z - pos.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        if (this.walk(m, m.side * 1.25, best.z + 0.35, dt)) {
          facePerson(p, m.side, 0, dt);
          if (S.lightCannon(best, 0.5)) { p.attack = 0.3; m.fireCD = 40; G.events.emit('fuseLit', { ship: S, cannon: best, pos: best.breech.getWorldPosition(_a) }); }
          return true;
        }
        return false;
      }
    }
    // Reload duty: the gun on my side that has been reloading longest
    let rel = null;
    for (const c of S.cannons) if (c.side === m.side && c.reload > 0.6 && (!rel || c.reload < rel.reload)) rel = c;
    if (rel) {
      if (this.walk(m, m.side * 1.25, rel.z + 0.35, dt)) { facePerson(p, m.side, 0, dt, 5); p.pose = 'ram'; return true; }
      return false;
    }
    // Watch duty: stroll between my guns and look out over the rail
    m.spotT -= dt;
    if (!m.spot || m.spotT <= 0) { const zs = S.cannons.filter((c) => c.side === m.side).map((c) => c.z); m.spot = [m.side * 1.3, zs[Math.floor(Math.random() * zs.length)] - 0.4]; m.spotT = rand(5, 9); }
    if (this.walk(m, m.spot[0], m.spot[1], dt, 1.3)) {
      const e = this.nearestEnemy();
      if (e) { _a.copy(e.root.position); S.root.worldToLocal(_a); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2); }
      else facePerson(p, m.side, -0.3, dt, 2);
      return true;
    }
    return false;
  }

  // The lookout paces the bow and points out enemy ships.
  lookout(m, dt, t) {
    const G = this.G, S = G.ship, p = m.p, pos = p.g.position;
    m.spotT -= dt;
    if (!m.spot || m.spotT <= 0) { m.spot = BOW_SPOTS[Math.floor(Math.random() * BOW_SPOTS.length)]; m.spotT = rand(6, 11); }
    if (!this.walk(m, m.spot[0], m.spot[1], dt, 1.2)) return false;
    const e = this.nearestEnemy();
    if (e) {
      _a.copy(e.root.position); S.root.worldToLocal(_a); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2);
      if ((t + m.p.phase) % 7 < 2.2) p.pose = 'point';
    } else facePerson(p, Math.sin(t * 0.2) * 0.6, -1, dt, 1);
    return true;
  }

  // The bosun hauls on the lines whenever the sails are set or furled, and otherwise does
  // odd jobs around the deck (coiling rope, checking the rigging).
  bosun(m, dt) {
    const S = this.G.ship, p = m.p;
    if (m.lastSail !== null && Math.abs(S.sail - m.lastSail) > 0.015) { m.workT = 2.5; m.spot = null; }
    m.lastSail = S.sail;
    if (m.workT > 0) {
      const side = m.p.g.position.x < 0 ? -1 : 1, x = side * 1.9, z = -0.1;
      if (this.walk(m, x, z, dt, 2.6)) { m.workT -= dt; facePerson(p, side, 0, dt, 5); p.pose = 'haul'; return true; }
      return false;
    }
    m.spotT -= dt;
    if (!m.spot || m.spotT <= 0) { m.spot = ODD_JOBS[Math.floor(Math.random() * ODD_JOBS.length)]; m.spotT = rand(6, 10); }
    if (this.walk(m, m.spot[0], m.spot[1], dt, 1.4)) { facePerson(p, Math.sign(m.spot[0]), 0, dt, 3); p.pose = m.spotT % 4 < 2.5 ? 'haul' : null; return true; }
    return false;
  }

  // Hawkins: at the wheel when he has the helm, otherwise waiting nearby.
  helmsman(m, dt) {
    const S = this.G.ship, p = m.p;
    if (S.helmBy === m.id) {
      if (this.walk(m, HELM_SPOT.x, HELM_SPOT.z, dt, 2.6)) { facePerson(p, 0, -1, dt, 5); p.pose = 'steer'; this.steer(dt); return true; }
      return false;
    }
    if (this.walk(m, HELM_STANDBY[0], HELM_STANDBY[1], dt, 1.6)) { facePerson(p, -1, -0.4, dt, 2); return true; }
    return false;
  }
}
