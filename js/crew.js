import * as THREE from 'three';
import { makePerson, animatePerson, facePerson } from './people.js';
import { halfWidth, HELM_SPOT, WHEEL_MAX, LEVER_MAX } from './ship.js';
import { GUN } from './grapple.js';
import { clamp, angleWrap, rand } from './util.js';

const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

// Orders the captain can give the helmsman (cycled with A / X in VR, T on desktop).
export const ORDERS = ['hold', 'chase', 'alongside', 'heave'];
export const ORDER_TEXT = {
  hold: 'Hold this course',
  chase: 'Engage the enemy',
  alongside: 'Bring us alongside',
  heave: 'Heave to (furl sails)',
};

// Spots on deck (ship-local x, z) where the crew have work to do.
const ODD_JOBS = [[1.9, -4.6], [-1.9, -4.4], [1.6, 2.9], [-1.5, 3.1], [0.9, -2.4], [-0.9, -6.0]];
const HELM_STANDBY = [1.75, 4.3];

export class Crew {
  constructor(G) {
    this.G = G;
    // A small crew: Hawkins at the helm, Bones on the guns (either side) and Mags, the bosun,
    // who also mans the grapple gun when you order "bring us alongside".
    const defs = [
      { look: { type: 'sailor', vest: 0x24304a, hat: 0x3a2a20, beard: 0x8a8a8a, patch: false, seed: 15 }, role: 'helmsman', side: 0, home: HELM_STANDBY, name: 'Hawkins' },
      { look: { type: 'gunner', bandana: 0xa82020, pants: 0x3b4a6b, hair: 0x3a2414, seed: 11 }, role: 'gunner', side: 0, home: [-1.15, -1.6], name: 'Bones' },
      { look: { type: 'buccaneer', seed: 14 }, role: 'bosun', side: 0, home: [-1.5, 3.1], name: 'Mags' },
    ];
    this.defs = defs;
    this.members = defs.map((d, i) => {
      const p = makePerson({ ...d.look, cutlass: false }); // swords come out when there's a fight
      p.g.position.set(d.home[0], 0, d.home[1]);
      G.ship.root.add(p.g);
      return { id: `crew:${i}`, name: d.name, p, role: d.role, side: d.side, home: new THREE.Vector3(d.home[0], 0, d.home[1]), atkCD: 0, victim: null, cannon: null, fireCD: 8,
        spot: null, spotT: 0, workT: 0, lastSail: null, aimT: 0, away: null };
    });
    this.hm = this.members[0];
    // The helm: who steers (a player id, the helmsman's id, or null = wheel left where it is)
    G.ship.helmBy = 'player:0'; G.ship.helmTouchT = 0; G.ship.holdHeading = G.ship.heading;
    this.order = 'chase';
    this.awayT = 0;
  }

  // Redraw everyone (after the title-screen crew setting changes, see PEOPLE in people.js).
  refreshLooks() {
    this.members.forEach((m, i) => {
      const old = m.p, np = makePerson({ ...this.defs[i].look, cutlass: false });
      np.g.position.copy(old.g.position); np.g.rotation.copy(old.g.rotation);
      np.pose = old.pose; np.sword.visible = old.sword.visible;
      if (old.g.parent) { old.g.parent.add(np.g); old.g.parent.remove(old.g); }
      m.p = np;
    });
  }

  // The crew only lends a hand now and then, so the captain does the real fighting.
  // (but they do keep the guns firing between your own shots).
  playerFired() { for (const m of this.members) m.fireCD = Math.max(m.fireCD, 5); }

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
    } else if (o !== 'heave' && G.island?.seaTarget()) {
      // A treasure hunt: make for the island with the gold light (she anchors when close)
      const tg = G.island.seaTarget(), dx = tg.x - S.pos.x, dz = tg.z - S.pos.z;
      desired = Math.atan2(-dx, -dz); sail = Math.hypot(dx, dz) > 200 ? 1 : 0.6;
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
    const fighters = G.enemies.boarders.filter((b) => b.state === 'fight');
    for (const m of this.members) {
      const p = m.p;
      m.atkCD -= dt; m.fireCD -= dt; p.pose = null;
      let still;
      if (m.ashore) still = G.island.crewStep(m, dt); // the landing party (island.js)
      else if (m.inBoat) still = G.island.boat.crewSit(m); // riding in the longboat (rowboat.js)
      else if (m.away || this.joinsBoarding(m)) still = this.boarding(m, dt);
      else if (fighters.length && this.defends(m)) still = this.defend(m, fighters, dt);
      else { p.sword.visible = false; still = this[m.role](m, dt, t); }
      animatePerson(p, dt, !still, t);
    }
  }

  // Who drops their job to fight boarders: everyone but the man at the wheel and the man on
  // the grapple gun (unless they're right on top of him).
  defends(m) {
    if (m === this.hm && this.G.ship.helmBy === m.id) return false;
    return true;
  }

  // Swords out: go for the nearest boarder and cut at him.
  defend(m, fighters, dt) {
    const G = this.G, S = G.ship, p = m.p, pos = p.g.position;
    let foe = null, fd = 1e9;
    // Fight the boarder who picked me, if there is one, otherwise the nearest
    for (const b of fighters) { const d = pos.distanceTo(b.p.g.position) - (b.foe?.crew === m ? 3 : 0); if (d < fd) { fd = d; foe = b; } }
    fd = pos.distanceTo(foe.p.g.position);
    if (m.role === 'grappler' && fd > 3) return this.grappler(m, dt);
    p.sword.visible = true;
    const fp = foe.p.g.position;
    let still = true;
    if (fd > 1.1) { this.walk(m, fp.x, fp.z, dt, 2.6); still = false; }
    facePerson(p, fp.x - pos.x, fp.z - pos.z, dt);
    if (fd < 1.5 && m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.atkCD = rand(1.3, 1.9); m.victim = foe; }
    if (p.attack > 0.62 && m.victim) {
      _a.set(pos.x, 1.3, pos.z); S.root.localToWorld(_a);
      if (Math.random() < 0.4 && m.victim.state === 'fight') { G.events.emit('bladeContact', { pos: _a }); G.events.emit('boarderStruck', { pos: _a }); G.enemies.hitBoarder(m.victim, 1, m.victim.p.g.position.x - pos.x, m.victim.p.g.position.z - pos.z); }
      else G.events.emit('parried', { pos: _a });
      m.victim = null;
    }
    return still;
  }

  // ---------- Boarding parties ----------
  // When the captain climbs onto a lashed enemy ship, the gunners and the bosun follow.
  joinsBoarding(m) {
    if (m.role !== 'gunner' && m.role !== 'bosun') return false;
    return !!this.boardTarget();
  }
  boardTarget() {
    const G = this.G;
    for (const pl of G.players) {
      const e = pl.ship;
      if (e === G.ship || pl.dead || !e.alive || e.keg?.fuse >= 0) continue;
      if (G.grapples.linkedShip(G.ship) === e && e.crew.some((c) => !c.p.dead)) return e;
    }
    return null;
  }

  // Jump across, fight their crew, jump back when it's over.
  boarding(m, dt) {
    const G = this.G, S = G.ship, p = m.p, pos = p.g.position;
    const target = this.boardTarget();
    if (!m.away) {
      // Start the jump: from our rail to their deck
      const e = target, side = Math.sign(G.grapples.lockFor(e).side) || 1;
      if (!this.walk(m, side * (halfWidth(pos.z) - 0.6), clamp(pos.z, -4, 3), dt, 3)) return false;
      this.jump(m, e, -side * (halfWidth(pos.z) - 1.0), pos.z + rand(-0.8, 0.8));
      G.events.emit('crewBoards', { name: m.name, pos: p.g.getWorldPosition(_a) });
    }
    const A = m.away;
    if (A.state === 'jump') {
      A.t += dt / 0.9; const u = Math.min(1, A.t);
      pos.lerpVectors(A.from, A.to, u); pos.y += Math.sin(Math.PI * u) * 1.2;
      facePerson(p, A.to.x - A.from.x, A.to.z - A.from.z, dt, 20);
      if (u >= 1) { pos.y = 0; A.state = A.ship === S ? 'done' : 'fight'; }
      if (A.state === 'done') { m.away = null; p.sword.visible = false; }
      return false;
    }
    // Fighting on their deck
    const e = A.ship;
    if (!target || target !== e) {
      // Time to go home: back over the rail
      const side = Math.sign(G.grapples.lockFor(e)?.side || 1);
      if (!e.alive || !G.grapples.lockFor(e)) { this.jump(m, S, m.home.x, m.home.z, true); return false; }
      if (!this.walk(m, -side * (halfWidth(pos.z) - 0.6), clamp(pos.z, -4, 3), dt, 3)) return false;
      this.jump(m, S, side * (halfWidth(pos.z) - 1.0), pos.z);
      return false;
    }
    p.sword.visible = true;
    let foe = null, fd = 1e9;
    // The sailor squaring up to me first, otherwise the nearest one nobody else is fighting
    for (const c of e.crew) {
      if (c.p.dead) continue;
      const taken = this.members.some((o) => o !== m && o.victimCrew === c);
      const d = pos.distanceTo(c.p.g.position) - (c.foe === m ? 3 : 0) + (taken ? 2 : 0);
      if (d < fd) { fd = d; foe = c; }
    }
    m.victimCrew = foe;
    if (!foe) return true;
    fd = pos.distanceTo(foe.p.g.position);
    const fp = foe.p.g.position;
    let still = true;
    if (fd > 1.1) { this.walk(m, fp.x, fp.z, dt, 2.4); still = false; }
    facePerson(p, fp.x - pos.x, fp.z - pos.z, dt);
    if (fd < 1.5 && m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.atkCD = rand(1.4, 2.0); m.victim = foe; }
    if (p.attack > 0.62 && m.victim) {
      _a.set(pos.x, 1.3, pos.z); e.root.localToWorld(_a);
      if (Math.random() < 0.35) { G.events.emit('bladeContact', { pos: _a }); G.events.emit('boarderStruck', { pos: _a }); G.enemies.hitCrew(e, m.victim, 1, fp.x - pos.x, fp.z - pos.z); }
      else G.events.emit('parried', { pos: _a });
      m.victim = null;
    }
    return still;
  }

  // Leap from wherever this sailor stands to (x, z) on `ship`'s deck. `teleport` skips the arc
  // (the ship under him is sinking or the lines are gone).
  jump(m, ship, x, z, teleport = false) {
    const g = m.p.g;
    g.getWorldPosition(_a);
    ship.root.attach(g); g.rotation.x = 0; g.rotation.z = 0;
    const from = g.position.clone(), to = new THREE.Vector3(x, 0, clamp(z, -7, 5));
    if (teleport) { g.position.copy(to); m.away = null; m.p.sword.visible = false; return; }
    m.away = { ship, state: 'jump', t: 0, from, to };
  }

  // Each job returns true when standing still (at work), false while walking.
  // A gunner takes hold of a loaded gun, lays it on the enemy, and fires it; rams and sponges
  // guns that are reloading; otherwise walks between the guns keeping watch over the rail.
  gunner(m, dt) {
    const G = this.G, S = G.ship, p = m.p, pos = p.g.position;
    if (S.alive && (m.fireCD <= 0 || m.cannon)) {
      let best = m.cannon && S.cannonReady(m.cannon) && m.cannon.inArc && m.cannon.targetHostile ? m.cannon : null;
      if (!best) {
        let bd = 1e9;
        for (const c of S.cannons) {
          // My own side first, but cross the deck if only the other side's guns bear
          if (!c.inArc || !c.targetHostile || !S.cannonReady(c)) continue;
          if (this.members.some((o) => o !== m && o.cannon === c)) continue;
          const d = Math.abs(c.z - pos.z) + (c.side === m.side ? 0 : 4);
          if (d < bd) { bd = d; best = c; }
        }
      }
      m.cannon = best;
      if (best) {
        if (!this.walk(m, best.side * 1.3, best.z + 0.1, dt)) { m.aimT = 0; return false; }
        // Hands on the breech, laying the gun... then touch off the fuse
        facePerson(p, best.side, 0, dt, 6);
        m.aimT += dt;
        p.pose = 'aim';
        if (m.aimT > 1.4 && S.lightCannon(best, 0.45)) {
          p.attack = 0.3; m.fireCD = rand(14, 20); m.cannon = null; m.aimT = 0;
          G.events.emit('fuseLit', { ship: S, cannon: best, pos: best.breech.getWorldPosition(_a) });
        }
        return true;
      }
    }
    m.aimT = 0;
    // Reload duty: the gun on my side that has been reloading longest
    let rel = null;
    for (const c of S.cannons) if ((!m.side || c.side === m.side) && c.reload > 0.6 && (!rel || c.reload < rel.reload)) rel = c;
    if (rel) {
      if (this.walk(m, rel.side * 1.3, rel.z + 0.1, dt)) { facePerson(p, rel.side, 0, dt, 5); p.pose = 'ram'; return true; }
      return false;
    }
    // Watch duty: stroll between my guns and look out over the rail
    m.spotT -= dt;
    if (!m.spot || m.spotT <= 0) {
      // (a gunner for both sides watches the side the enemy is on)
      let side = m.side;
      if (!side) { const e = this.nearestEnemy(); if (e) { _a.copy(e.root.position); S.root.worldToLocal(_a); side = Math.sign(_a.x) || 1; } else side = Math.random() < 0.5 ? -1 : 1; }
      const zs = S.cannons.filter((c) => c.side === side).map((c) => c.z);
      m.spot = [side * 1.3, zs[Math.floor(Math.random() * zs.length)] - 0.4]; m.spotT = rand(5, 9);
    }
    if (this.walk(m, m.spot[0], m.spot[1], dt, 1.3)) {
      const e = this.nearestEnemy();
      if (e) { _a.copy(e.root.position); S.root.worldToLocal(_a); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2); }
      else facePerson(p, Math.sign(m.spot[0]), -0.3, dt, 2);
      return true;
    }
    return false;
  }

  // Mags mans the grapple gun on the bow (when you order "bring us alongside") unless the captain holds it. He keeps it
  // trained on the nearest enemy, and under the order "bring us alongside" he fires it once
  // they're in reach.
  grappler(m, dt, t) {
    const G = this.G, S = G.ship, gr = G.grapples, p = m.p, pos = p.g.position;
    if (gr.heldBy && gr.heldBy !== m.id) {
      // The captain has the gun: stand aside and point out the enemy
      if (!this.walk(m, 1.2, -6.9, dt, 1.6)) return false;
      const e = this.nearestEnemy();
      if (e) { _a.copy(e.root.position); S.root.worldToLocal(_a); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2); p.pose = 'point'; }
      return true;
    }
    if (!this.walk(m, GUN.x, GUN.z + 0.75, dt, 1.8)) { if (gr.heldBy === m.id) gr.heldBy = null; return false; }
    gr.heldBy = m.id;
    facePerson(p, -Math.sin(gr.aimYaw), -Math.cos(gr.aimYaw), dt, 4);
    p.pose = 'aim';
    const e = this.nearestEnemy();
    if (!e || gr.anyLineOut()) return true;
    // Lead the target a little and lay the gun on the middle of her deck
    gr.muzzle.getWorldPosition(_b);
    _a.copy(e.root.position).addScaledVector(e.vel, _b.distanceTo(e.root.position) / 38); _a.y += 0.8;
    _a.sub(_b);
    const dist = _a.length();
    S.root.getWorldQuaternion(_q).invert(); _a.applyQuaternion(_q).normalize();
    const yaw = Math.atan2(-_a.x, -_a.z), pitch = Math.asin(clamp(_a.y, -1, 1)) + dist * 0.004;
    // (the gun can't turn all the way round, so swing the short way within its limits)
    const want = clamp(yaw, -2.3, 2.3);
    gr.setAim(gr.aimYaw + clamp(want - gr.aimYaw, -1.5 * dt, 1.5 * dt), gr.aimPitch + clamp(pitch - gr.aimPitch, -dt, dt));
    if (this.order === 'alongside' && e.hostile && dist < 32 && Math.abs(yaw - gr.aimYaw) < 0.05) {
      m.aimT += dt;
      if (m.aimT > 0.8) { m.aimT = 0; p.attack = 0.3; gr.fire(gr.gunDir(_a)); }
    } else m.aimT = 0;
    return true;
  }

  // The bosun hauls on the lines whenever the sails are set or furled, and otherwise does
  // odd jobs around the deck (coiling rope, checking the rigging).
  bosun(m, dt) {
    const S = this.G.ship, p = m.p, gr = this.G.grapples;
    // "Bring us alongside": man the grapple gun and hook the enemy
    if (this.order === 'alongside' && S.alive && this.nearestEnemy()) return this.grappler(m, dt);
    if (gr.heldBy === m.id) gr.heldBy = null;
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
