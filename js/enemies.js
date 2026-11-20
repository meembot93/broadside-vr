import * as THREE from 'three';
import { Ship, halfWidth, HELM_SPOT } from './ship.js';
import { makePerson, animatePerson, facePerson } from './people.js';
import { clamp, angleWrap, rand, damp } from './util.js';

const _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// Pair fighters off so a melee is a brawl, not a queue for the captain.
// attackers: [{ pos }]; foes: [{ pl, pos, cap }] (pl: a player, or null for one of our crew).
// Each attacker gets the foe that is close and least crowded; nobody takes more than `cap`.
// Returns an array (same order as attackers) of foes or null.
function pairOff(attackers, foes) {
  const load = new Map(foes.map((f) => [f, 0]));
  const order = attackers.map((a, i) => ({ a, i, d: Math.min(...foes.map((f) => Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z))) }));
  order.sort((x, y) => x.d - y.d);
  const out = new Array(attackers.length).fill(null);
  for (const { a, i } of order) {
    let best = null, bs = Infinity;
    for (const f of foes) {
      const l = load.get(f); if (l >= f.cap) continue;
      const sc = Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z) + l * 3 + (f.pl ? 1 : 0);
      if (sc < bs) { bs = sc; best = f; }
    }
    if (best) { load.set(best, load.get(best) + 1); out[i] = best; }
  }
  return out;
}
// Enemy pirates, one look per job (helm, gunner, gunner, rigger, mate): a captain in a dark
// coat at the wheel, the rest in darker, grubbier clothes than our own crew. See people.js.
const LOOKS = [
  { type: 'captain', coat: 0x2a1e1e, hat: 0x5a1a1a, cutlass: true },
  { type: 'gunner', bandana: 0x1e1e1e, pants: 0x3a1a1a, cutlass: true },
  { type: 'gunner', bandana: 0x7a1d1d, pants: 0x1e1e2a, cutlass: true },
  { type: 'deckhand', bandana: 0x3a3a3a, vest: 0x3a3430, cutlass: true },
  { type: 'sailor', vest: 0x2a2a2a, hat: 0x1e1814, cutlass: true },
  { type: 'swashbuckler', vest: 0x3a2a20, sash: 0x1e1e1e, cutlass: true },
  { type: 'raider', cutlass: true },
  { type: 'rogue', bandana: 0x2a2424, cutlass: true },
  { type: 'buccaneer', bandana: 0x2a2424, cutlass: true },
];

// The boss: a captain in a crimson coat who stays at the wheel until you board, then comes for you.
const BOSS_LOOK = { type: 'captain', coat: 0x7a1212, hat: 0x141010, sash: 0xc8a040, cutlass: true };

// What each kind of enemy ship is like. Crew: [job, side, x, z] (where they start and,
// for mates and riggers, where they keep watch).
export const KINDS = {
  // Small and quick, one gun a side, a crew of four
  sloop: { health: 70, maxSpeed: 8.4, turnRate: 0.3, reloadTime: 10, gunZ: [-1], ballDamage: 4,
    crew: [['helm', 0, HELM_SPOT.x, HELM_SPOT.z], ['gunner', -1, -1.3, -0.6], ['gunner', 1, 1.3, -0.6], ['mate', 0, -0.9, 2.8]] },
  // The all-rounder, two guns a side, five crew
  brigantine: { health: 110, maxSpeed: 7.6, turnRate: 0.22, reloadTime: 9, gunZ: [-3, 1], ballDamage: 5,
    crew: [['helm', 0, HELM_SPOT.x, HELM_SPOT.z], ['gunner', -1, -1.3, -1], ['gunner', 1, 1.3, -1], ['rigger', 0, 0.9, -2.6], ['mate', 0, -0.9, 2.8]] },
  // Big, slow and tough, three guns a side, eight crew
  galleon: { health: 200, maxSpeed: 6.6, turnRate: 0.16, reloadTime: 8, gunZ: [-3, 1, 3.6], ballDamage: 6,
    crew: [['helm', 0, HELM_SPOT.x, HELM_SPOT.z], ['gunner', -1, -1.3, -1], ['gunner', 1, 1.3, -1], ['gunner', -1, -1.3, 3], ['gunner', 1, 1.3, 3],
      ['rigger', 0, 0.9, -2.6], ['mate', 0, -0.9, 2.2], ['mate', 0, 0.8, -4.6]] },
};

export class Enemies {
  constructor(G) {
    this.G = G; this.ships = []; this.boarders = [];
    this.warnedBoard = false;
  }

  // Bring an enemy ship over the horizon. Voyages (voyages.js) decide which and when.
  // o: { level: 0 for the first voyage, 1 for the next..., boss: { name } for a boss ship }
  spawn(kind = 'brigantine', o = {}) {
    const G = this.G, P = G.ship;
    // Pick a spot in open water (the cove has land on most sides)
    let a = 0, d = 0, x = 0, z = 0;
    for (let i = 0; i < 40; i++) {
      a = rand(0, Math.PI * 2); d = G.debug ? 110 : rand(220, 300) * (i < 20 ? 1 : 0.75);
      x = P.pos.x + Math.sin(a) * d; z = P.pos.z + Math.cos(a) * d;
      if (G.world.isOpenWater(x, z, 30)) break;
    }
    const heading = Math.atan2(-(P.pos.x - x), -(P.pos.z - z));
    // Each voyage they come a bit tougher: stronger hulls, quicker reloads, a touch faster.
    const K = KINDS[kind] || KINDS.brigantine, lv = o.level || 0, boss = o.boss || null;
    const s = new Ship(G.scene, { id: G.ids.next('ship'), kind, x, z, heading, sail: 1, gunZ: K.gunZ, ballDamage: K.ballDamage + lv * 0.5,
      maxSpeed: K.maxSpeed + lv * 0.2, turnRate: K.turnRate, health: Math.round(K.health * (1 + lv * 0.2) * (boss ? 1.2 : 1)),
      reloadTime: K.reloadTime * Math.max(0.65, 1 - lv * 0.08) });
    const first = !G.score && !this.ships.length;
    s.ai = { canBoard: first || boss ? true : Math.random() < Math.min(0.85, 0.55 + lv * 0.1), mode: 'approach', inRangeT: 0, boardT: 3, sent: 0, aimErr: Math.max(0.012, 0.03 - lv * 0.005) };
    s.driftRudder = rand(-0.3, 0.3);
    s.boss = boss; s.level = lv;
    this.crewUp(s, K, boss);
    this.ships.push(s);
    G.events.emit('enemySpawned', { ship: s, kind, boss, count: this.ships.filter((e) => e.hostile).length });
    return s;
  }

  // Every job on an enemy ship needs a living sailor: no helmsman, no steering; no gunner
  // at a cannon, no shot. Kill them all and the ship drifts.
  // Faces come from a seed made from the ship's id, so every headset sees the same pirates.
  crewUp(s, K, boss) {
    const n = parseInt(s.id.split(':')[1]) || 0;
    K.crew.forEach(([role, side, x, z], i) => {
      const chief = boss && i === 0;
      const p = makePerson({ ...(chief ? BOSS_LOOK : LOOKS[i % LOOKS.length]), seed: 1000 + n * 37 + i });
      if (chief) p.g.scale.setScalar(1.1);
      p.g.position.set(x, 0, z); s.root.add(p.g);
      s.crew.push({ id: `${s.id}/crew:${i}`, p, role, side, home: [x, z], hp: chief ? 8 : 2, maxHp: chief ? 8 : 2, boss: chief ? boss.name : null,
        cannon: null, aimT: 0, hitCD: 0, atkCD: rand(0.6, 1.2), swingHit: true, workT: 0 });
    });
  }

  // A friend's headset (multiplayer): build the ship the host told us about, as it is right now.
  // ss: one ship from the host's snapshot (state.js). No rules run on it here; net/mirror.js
  // moves it from the host's updates.
  spawnMirror(ss) {
    const G = this.G, K = KINDS[ss.kind] || KINDS.brigantine;
    const boss = ss.boss ? { name: ss.boss } : null;
    const s = new Ship(G.scene, { id: ss.id, kind: ss.kind, x: ss.pos[0], z: ss.pos[1], heading: ss.heading, sail: ss.sail, gunZ: K.gunZ,
      maxSpeed: ss.maxSpeed || K.maxSpeed, turnRate: K.turnRate, health: ss.maxHealth || K.health });
    s.health = ss.health; s.ai = { mode: ss.ai?.mode || 'approach' }; s.boss = boss; s.level = ss.level || 0;
    this.crewUp(s, K, boss);
    this.ships.push(s);
    return s;
  }

  // A boarder as the host described it (multiplayer)
  spawnBoarderMirror(bs) {
    const p = makePerson({ ...LOOKS[bs.look || 1], seed: bs.seed });
    p.g.position.set(...bs.pos); this.G.ship.root.add(p.g);
    const b = { id: bs.id, p, state: bs.state, t: 0, hp: bs.hp, atkCD: 0, hitCD: 0, swingHit: true };
    this.boarders.push(b);
    return b;
  }

  // The boss captain of this ship, while still standing (null otherwise)
  bossOf(e) { return e.crew.find((m) => m.boss && !m.p.dead) || null; }

  clearAll() {
    for (const s of this.ships) s.dispose();
    this.ships = [];
    for (const b of this.boarders) this.G.ship.root.remove(b.p.g);
    this.boarders = [];
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
    if (e.lock) { this.aiLashed(e, dt); return; }
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
      c.inArc = P.alive && e.aimCannon(c, P, A.aimErr ?? 0.03);
      if (!c.inArc) { c.tElev = 0.05; c.tYaw = 0; }
    }

    // Close enough while trying to board: throw grapples and lash on
    if (A.mode === 'board' && dist < 15 && helm && P.alive && !G.grapples.lockFor(e)) G.grapples.lash(e, 'them');

    // Boarding (only while someone is alive on deck to fight them)
    if (A.mode === 'board' && dist < 24 && P.alive && G.players.some((pl) => !pl.dead)) {
      A.boardT -= dt;
      const live = this.boarders.filter((b) => b.state !== 'dead').length;
      if (A.boardT <= 0 && live < 3 && A.sent < 5) { A.boardT = rand(4, 7); A.sent++; this.spawnBoarder(e); }
    }
  }

  // Lashed alongside us: guns can't bear, but the boarding party keeps coming.
  aiLashed(e, dt) {
    const G = this.G, A = e.ai;
    for (const c of e.cannons) { c.inArc = false; c.tElev = 0.05; c.tYaw = 0; }
    if (!A.canBoard || e.abandoned || !G.ship.alive || !G.players.some((pl) => !pl.dead && pl.ship === G.ship)) return;
    if (e.lock.phase !== 'locked') return;
    A.boardT -= dt;
    const live = this.boarders.filter((b) => b.state !== 'dead').length;
    if (A.boardT <= 0 && live < 3 && A.sent < 5) { A.boardT = rand(4, 7); A.sent++; this.spawnBoarder(e); }
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
    // A boss captain shrugs off a musket ball or two: it takes a duel (or a lot of lead)
    if (m.boss && (cause === 'musket' || cause === 'cannon')) {
      m.hp -= cause === 'cannon' ? 3 : 2;
      if (m.hp > 0) { m.p.attack = -1; this.G.events.emit('bossWounded', { ship: e, name: m.boss, hp: m.hp, maxHp: m.maxHp, cause }); return; }
    }
    m.p.dead = true; m.p.deadT = 0; m.p.pose = null;
    const left = e.crew.filter((x) => !x.p.dead).length;
    this.G.events.emit('enemyCrewKilled', { ship: e, role: m.role, left, cause, boss: m.boss });
    if (left === 0 && e.alive && !e.abandoned) {
      e.abandoned = true; e.ai.mode = 'adrift';
      this.G.events.emit('enemyAbandoned', { ship: e });
    }
    if (m.boss) {
      // Their captain is dead: the rest throw down their cutlasses and go over the side
      this.G.events.emit('bossCaptainKilled', { ship: e, name: m.boss, cause });
      for (const o of e.crew) if (!o.p.dead) {
        _a.set(o.p.g.position.x, 0, o.p.g.position.z); e.root.localToWorld(_a);
        o.p.g.visible = false;
        this.G.events.emit('crewOverboard', { ship: e, pos: _a.clone() });
        this.killCrew(e, o, 'surrender');
      }
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
    // Who fights whom, if any of ours are aboard (the helmsman only joins in if they come close)
    const foes = this.intrudersOn(e);
    const fighters = foes.length ? e.crew.filter((m) => !m.p.dead && (m.role !== 'helm' || m.boss || foes.some((f) => Math.hypot(f.pos.x - m.p.g.position.x, f.pos.z - m.p.g.position.z) < 2.5))) : [];
    const pairs = pairOff(fighters.map((m) => ({ pos: m.p.g.position })), foes);
    const foeOf = new Map(fighters.map((m, i) => [m, pairs[i]]));
    for (const m of e.crew) {
      const p = m.p, pos = p.g.position;
      if (p.dead) { animatePerson(p, dt, false, t + k); continue; }
      let moving = false; p.pose = null;
      m.hitCD -= dt; m.atkCD -= dt;
      if (!e.alive) { animatePerson(p, dt, false, t + k); continue; }
      // Someone of ours is aboard: drop everything and fight
      if (foeOf.has(m)) {
        const foe = foeOf.get(m);
        if (foe) { this.fightIntruder(e, m, foe, dt, t + k); continue; }
        // Nobody free to fight: hang back, cutlass ready
        const near = foes[0].pos; facePerson(p, near.x - pos.x, near.z - pos.z, dt); animatePerson(p, dt, false, t + k); continue;
      }
      if (m.role === 'helm') {
        if (this.walk(m, HELM_SPOT.x, HELM_SPOT.z, dt)) { facePerson(p, 0, -1, dt, 4); p.pose = 'steer'; } else moving = true;
      } else if (m.role === 'gunner') {
        // Go to the best cannon on my side: loaded and with a target first, otherwise one to reload
        let best = null, bs = 1e9;
        for (const c of e.cannons) {
          if (m.side && c.side !== m.side) continue;
          if (e.crew.some((o) => o !== m && !o.p.dead && o.role === 'gunner' && o.cannon === c)) continue;
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
        const want = m.home && m.home[0] !== HELM_SPOT.x ? m.home : m.role === 'rigger' ? [0.9, -2.6] : [-0.9, 2.8];
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

  // Everyone of ours on this enemy ship's deck: players (two attackers at most) and our
  // boarding party (two each). In each foe, `crew` is our crewman when it isn't a player.
  intrudersOn(e) {
    const out = [];
    for (const pl of this.G.players) if (!pl.dead && pl.ship === e) out.push({ pl, pos: pl.headLocal, cap: 2 });
    for (const m of this.G.crew.members) if (m.away?.ship === e && m.away.state === 'fight') out.push({ pl: null, crew: m, pos: m.p.g.position, cap: 2 });
    return out;
  }

  // foe: { pl, pos } a player, or one of our boarding party (pl null: steel on steel, no harm done)
  fightIntruder(e, m, foe, dt, t) {
    const p = m.p, pos = p.g.position, head = foe.pos, pl = foe.pl;
    const dx = head.x - pos.x, dz = head.z - pos.z, d = Math.hypot(dx, dz);
    facePerson(p, dx, dz, dt);
    m.foe = foe.crew || null;
    let moving = false;
    if (d > 1.05 && p.attack < 0) { this.walk(m, head.x, head.z, dt, 1.8); moving = true; facePerson(p, dx, dz, dt); }
    for (const o of e.crew) {
      if (o === m || o.p.dead) continue;
      const ox = pos.x - o.p.g.position.x, oz = pos.z - o.p.g.position.z, od = Math.hypot(ox, oz);
      if (od < 0.75 && od > 1e-3) { pos.x += (ox / od) * (0.75 - od) * 0.5; pos.z += (oz / od) * (0.75 - od) * 0.5; }
    }
    if (d < 1.45 && m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.swingHit = false; m.atkCD = m.boss ? rand(1.2, 1.9) : rand(1.8, 2.8); }
    if (p.attack > 0.62 && !m.swingHit) {
      m.swingHit = true;
      _a.set(pos.x, 1.3, pos.z); e.root.localToWorld(_a); this.G.events.emit('boarderSwing', { pos: _a });
      if (d < 1.7 && pl) this.G.hurtPlayer(pl, m.boss ? 12 : 7);
      else if (d < 1.7 && Math.random() < 0.6) this.G.events.emit('parried', { pos: _a });
    }
    animatePerson(p, dt, moving, t);
  }

  // A player's sword (or desktop slash) connects with one of their deck crew.
  hitCrew(e, m, dmg, kx, kz) {
    if (m.p.dead || m.hitCD > 0) return;
    m.hp -= dmg; m.hitCD = 0.35;
    const d = Math.hypot(kx, kz) || 1;
    m.p.g.position.x += (kx / d) * 0.35; m.p.g.position.z += (kz / d) * 0.35;
    m.p.attack = -1; m.atkCD = Math.max(m.atkCD, m.boss ? 0.6 : 0.9);
    if (m.hp <= 0) this.killCrew(e, m, 'sword');
    else if (m.boss) this.G.events.emit('bossWounded', { ship: e, name: m.boss, hp: m.hp, maxHp: m.maxHp, cause: 'sword' });
  }

  spawnBoarder(e) {
    const G = this.G, P = G.ship;
    _a.copy(e.root.position); P.root.worldToLocal(_a);
    const side = Math.sign(_a.x) || 1;
    const z = clamp(_a.z * 0.3 + rand(-2.5, 2.5), -6.5, 4.5);
    const look = 1 + Math.floor(Math.random() * (LOOKS.length - 1)), seed = Math.floor(Math.random() * 1e9);
    const p = makePerson({ ...LOOKS[look], seed });
    const from = new THREE.Vector3(side * 5, 2.8, z), to = new THREE.Vector3(side * (halfWidth(z) - 0.8), 0, z);
    p.g.position.copy(from); P.root.add(p.g);
    this.boarders.push({ id: G.ids.next('boarder'), p, look, seed, state: 'jump', t: 0, from, to, hp: 2, atkCD: rand(0.6, 1.2), hitCD: 0, swingHit: true });
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
      if (pl.ship !== this.G.ship) continue;
      const d = Math.hypot(pl.headLocal.x - pos.x, pl.headLocal.z - pos.z);
      if (d < ad) { ad = d; any = pl; }
      if (!pl.dead && d < bd) { bd = d; best = pl; }
    }
    return best || any;
  }

  // Who each boarder goes for: players (two at most) and our crew who have swords out.
  pairBoarders() {
    const G = this.G, foes = [];
    for (const pl of G.players) if (!pl.dead && pl.ship === G.ship) foes.push({ pl, pos: pl.headLocal, cap: 2 });
    for (const m of G.crew.members) if (!m.away && m.p.sword.visible) foes.push({ pl: null, crew: m, pos: m.p.g.position, cap: 2 });
    const live = this.boarders.filter((b) => b.state === 'fight');
    const pairs = foes.length ? pairOff(live.map((b) => ({ pos: b.p.g.position })), foes) : [];
    live.forEach((b, i) => { b.foe = pairs[i] || null; });
  }

  updateBoarders(dt, t) {
    const G = this.G;
    this.pairBoarders();
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
      // Fight: close in on whoever he's paired with (a player or one of our crew) and swing
      const foe = b.foe || (this.boarderTarget(pos) && { pl: this.boarderTarget(pos), pos: this.boarderTarget(pos).headLocal });
      if (!foe) { animatePerson(p, dt, false, t); continue; } // everyone's over on their ship
      const victim = foe.pl, head = foe.pos, canFight = victim ? !victim.dead : true;
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
        if (d < 1.7 && victim) G.hurtPlayer(victim, 10);
        else if (d < 1.7 && Math.random() < 0.6) G.events.emit('parried', { pos: _a });
      }
      animatePerson(p, dt, moving, t);
    }
  }

  update(dt, t) {
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
