// Treasure hunts: after every voyage won, a gold light marks treasure buried on the islet.
// Sail there and the ship drops anchor; stand in the gold ring at the rail to row ashore with
// two of the crew. Your map is on your left wrist (top right on desktop). Island guards stand
// between the beach and the X. Beat them, the crew digs up a chest, open it and pick one of
// three upgrades for the ship. Row back aboard and the next, harder voyage begins.
//
// Rules (host only): update(), act() (called from actions.js), the guards and the shore crew.
// Looks (every headset): view(), the map, the beam, rings, chest and cards.
// Multiplayer: snap() goes into G.snapshot(); applySnap() is how a friend's headset follows it.
//
// The "shore" is a stand-in for a ship whose local space is the world: a player ashore has
// player.ship === G.island.shore, so poses, actions and sword hits work like on any deck.
//
// Events: treasureMarked, anchorDropped, wentAshore, wentAboard, guardsAlerted, treasureGuarded,
//   digStarted, chestUnearthed, chestOpened, upgradeChosen, treasureDone
import * as THREE from 'three';
import { landHeight, ISLET, ISLET_SOLIDS } from './land.js';
import { makePerson, animatePerson, facePerson } from './people.js';
import { ENEMY_LOOKS } from './enemies.js';
import { Kit } from './kit.js';
import { hullX, STERN, BOW } from './ship.js';
import { canvasTex, rand, segSegDist } from './util.js';

export const UPGRADES = {
  bronze: { name: 'Bronze cannons', text: 'Cannonballs hit\n35% harder', col: '#c8893a' },
  reload: { name: 'Drilled gun crews', text: 'Cannons reload\n25% faster', col: '#4d7a2a' },
  hull: { name: 'Iron-banded hull', text: '+50 hull and\niron straps', col: '#4a5260' },
};
const KINDS = Object.keys(UPGRADES);
// The gold ring on our deck where you row ashore from (ship-local x, z)
export const DECK_RING = { x: 1.6, z: 2.6 };
const SHORE_CREW = ['Mags', 'Rosa'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const r2 = (v) => Math.round(v * 100) / 100;
const flat = (a, x, z) => Math.hypot(a.x - x, a.z - z);
const ground = (x, z) => Math.max(0, landHeight(x, z));
const walkable = (x, z, pad = 0.3) => landHeight(x, z) > 0.15 && Math.hypot(x - ISLET.x, z - ISLET.z) < ISLET.r * 1.5 &&
  !ISLET_SOLIDS.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2); // not inside a rock or a palm

const BEAM_MAT = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
const RING_MAT = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
const BRONZE = new THREE.MeshLambertMaterial({ color: 0xa8692a, emissive: 0x2a1404 });

function label(text, w = 512, h = 160, scale = 0.9) {
  const tex = canvasTex(w, h, (g) => {
    g.fillStyle = 'rgba(20,12,6,0.78)'; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 22); g.fill();
    g.strokeStyle = '#ffd25a'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#fff3cf'; g.font = 'bold 46px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = text.split('\n'); lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 52, w - 30));
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale, scale * h / w, 1);
  return sp;
}

function ring(r = 0.75) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.09, r, 40).rotateX(-Math.PI / 2), RING_MAT);
  m.renderOrder = 3;
  return m;
}

function buildChest() {
  const g = new THREE.Group(), k = new Kit();
  k.box(0.9, 0.5, 0.6, 0x6a4322, [0, 0.25, 0]);
  for (const x of [-0.36, 0, 0.36]) k.box(0.07, 0.52, 0.62, 0x3a3a3e, [x, 0.25, 0]);
  k.box(0.14, 0.16, 0.05, 0xc8a040, [0, 0.42, 0.31]);
  g.add(k.mesh());
  const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.3); g.add(lid);
  const lk = new Kit();
  lk.cyl(0.3, 0.3, 0.9, 10, 0x704826, [0, 0, 0.3], [0, 0, Math.PI / 2], [1, 1, 1]);
  for (const x of [-0.36, 0.36]) lk.cyl(0.31, 0.31, 0.07, 10, 0x3a3a3e, [x, 0, 0.3], [0, 0, Math.PI / 2]);
  const lm = lk.mesh(); lid.add(lm); lm.scale.y = 0.5;
  // Gold inside (shows when the lid is up)
  const gk = new Kit();
  for (let i = 0; i < 14; i++) gk.cyl(0.05, 0.05, 0.015, 8, 0xf0c040, [rand(-0.35, 0.35), 0.47 + rand(0, 0.05), rand(-0.22, 0.22)], [rand(-0.5, 0.5), 0, rand(-0.5, 0.5)]);
  gk.ball(0.06, 0, 0xd02a40, [0.15, 0.5, 0.05]); gk.ball(0.05, 0, 0x30a050, [-0.2, 0.5, -0.05]);
  const gold = new THREE.Mesh(gk.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a2800 }));
  g.add(gold);
  return { g, lid, gold };
}

function buildBoat() {
  const k = new Kit();
  k.box(1.3, 0.35, 3.6, 0x5d3b22, [0, 0, 0]);
  k.box(1.0, 0.36, 3.2, 0x3a2414, [0, 0.03, 0]);
  k.box(1.2, 0.06, 0.3, 0x6a4a2a, [0, 0.12, 0.5]); k.box(1.2, 0.06, 0.3, 0x6a4a2a, [0, 0.12, -0.7]);
  k.box(0.6, 0.35, 0.6, 0x5d3b22, [0, 0, -1.9], [0, Math.PI / 4, 0]);
  for (const s of [-1, 1]) k.box(0.06, 0.06, 2.6, 0xa08060, [s * 0.75, 0.15, -0.1], [0.2, s * 0.3, 0]);
  return k.mesh();
}

function buildX() {
  const k = new Kit();
  k.ball(1.1, 1, 0xcdb88a, [0, -0.75, 0], 0, [1, 0.6, 1]);
  k.box(1.6, 0.05, 0.22, 0xa02a1a, [0, 0.0, 0], [0, 0.8, 0]);
  k.box(1.6, 0.05, 0.22, 0xa02a1a, [0, 0.0, 0], [0, -0.8, 0]);
  return k.mesh();
}

export class Island {
  constructor(G) {
    this.G = G;
    const root = new THREE.Group(); G.scene.add(root); root.updateMatrixWorld();
    this.shore = { id: 'shore', isShore: true, root, cannons: [], crew: [], covers: [], alive: true, pos: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0, heading: 0 };
    this.phase = 'off';  // off -> sail (beam lit) -> hunt (at anchor) -> return (prize taken) -> off
    this.site = null;    // { xx, xz: the X; lx, lz: landing beach; bx, bz: the boat; yaw: facing inland } (landing once anchored)
    this.chest = { state: 'buried', t: 0 }; // buried -> digging -> up -> open -> taken
    this.foes = [];
    this.up = { bronze: 0, reload: 0, hull: 0 }; // upgrades won so far (kept for the whole run)
    this.anchored = false;
    this.level = 1;
    this.v = {};           // the visuals for the current site
    this.ringT = 0; this.mapT = 0;
    this.looks = '';
    this.buildMap();
  }

  get active() { return this.phase !== 'off'; }
  ashore(pl) { return pl.ship === this.shore; }
  playersAshore() { return this.G.players.filter((pl) => this.ashore(pl)); }
  byId(id) { return this.foes.find((f) => f.id === id) || null; }
  get damageMul() { return 1 + 0.35 * this.up.bronze; }
  shoreCrew() { return this.G.crew.members.filter((m) => SHORE_CREW.includes(m.name)); }

  // ================= RULES (host) =================
  // A voyage was won: bury a treasure on the far side of the islet and light the way.
  start(level) {
    const G = this.G, S = G.ship;
    this.level = level; this.phase = 'sail'; this.anchored = false;
    this.chest = { state: 'buried', t: 0 };
    let dx = S.pos.x - ISLET.x, dz = S.pos.z - ISLET.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    let xx = ISLET.x, xz = ISLET.z;
    for (let i = 0; i < 60; i++) {
      const a = Math.atan2(-dx, -dz) + rand(-1, 1), rr = rand(0.3, 0.6) * ISLET.r;
      const x = ISLET.x + Math.sin(a) * rr, z = ISLET.z + Math.cos(a) * rr;
      const h = landHeight(x, z), slope = Math.max(...[[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].map(([ox, oz]) => Math.abs(landHeight(x + ox, z + oz) - h))) / 1.5;
      if (h > 1.5 && slope < (i < 50 ? 0.3 : 0.6)) { xx = x; xz = z; break; } // fairly flat ground, so the chest sits level
    }
    this.site = { xx: r2(xx), xz: r2(xz) };
    G.events.emit('treasureMarked', { voyage: level, pos: new THREE.Vector3(xx, ground(xx, xz), xz) });
  }

  // Where Hawkins should sail to (or null)
  seaTarget() { return this.phase === 'sail' ? { x: ISLET.x, z: ISLET.z } : null; }

  // The ship is close: drop anchor and pick the beach facing her.
  dropAnchor() {
    const G = this.G, S = G.ship, I = ISLET;
    let dx = S.pos.x - I.x, dz = S.pos.z - I.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    let r = 0; while (r < 150 && landHeight(I.x + dx * r, I.z + dz * r) > -0.2) r += 0.5;
    let lr = r; while (lr > 2 && landHeight(I.x + dx * lr, I.z + dz * lr) < 0.7) lr -= 0.5;
    Object.assign(this.site, { lx: r2(I.x + dx * lr), lz: r2(I.z + dz * lr), bx: r2(I.x + dx * (r + 1.2)), bz: r2(I.z + dz * (r + 1.2)), yaw: r2(Math.atan2(dx, dz)) });
    S.anchored = true; this.anchored = true; this.phase = 'hunt';
    this.spawnGuards();
    G.events.emit('anchorDropped', { pos: S.pos.clone() });
  }

  // Guards: a group halfway along the way in, a bigger one around the X with a brute among them.
  spawnGuards() {
    const G = this.G, s = this.site, extra = Math.min(3, this.level - 1) + Math.max(0, G.players.length - 1);
    for (const f of this.foes) f.p.g.removeFromParent();
    this.foes = [];
    const mx = (s.lx + s.xx) / 2, mz = (s.lz + s.xz) / 2;
    const groups = [{ x: mx, z: mz, n: 2 + Math.floor(extra / 2), g: 0 }, { x: s.xx, z: s.xz, n: 2 + Math.ceil(extra / 2), g: 1, big: true }];
    for (const grp of groups) {
      for (let i = 0; i < grp.n + (grp.big ? 1 : 0); i++) {
        let x = grp.x, z = grp.z;
        for (let k = 0; k < 30; k++) { const a = rand(0, 6.28), d = rand(2.5, 6); x = grp.x + Math.sin(a) * d; z = grp.z + Math.cos(a) * d; if (walkable(x, z)) break; }
        const big = grp.big && i === 0;
        const look = 1 + Math.floor(Math.random() * (ENEMY_LOOKS.length - 1)), seed = Math.floor(Math.random() * 1e9);
        this.foes.push(this.makeFoe({ id: G.ids.next('foe'), look, seed, big, pos: [x, ground(x, z), z], group: grp.g, hp: big ? 5 : 2 }));
      }
    }
  }

  makeFoe(o) {
    const p = makePerson({ ...ENEMY_LOOKS[o.look % ENEMY_LOOKS.length], seed: o.seed });
    if (o.big) p.g.scale.setScalar(1.15);
    p.g.position.set(...o.pos); p.g.rotation.y = rand(0, 6.28);
    this.shore.root.add(p.g);
    return { id: o.id, p, look: o.look, seed: o.seed, big: !!o.big, hp: o.hp ?? 2, maxHp: o.hp ?? 2, group: o.group ?? 0, state: o.state || 'idle',
      home: { x: o.pos[0], z: o.pos[2] }, atkCD: rand(0.8, 1.4), hitCD: 0, swingHit: true, deadT: 0 };
  }

  update(dt, t) {
    if (!this.active) return;
    const G = this.G, S = G.ship;
    if (this.phase === 'sail') {
      if (Math.hypot(S.pos.x - ISLET.x, S.pos.z - ISLET.z) < ISLET.r + 75) this.dropAnchor();
      return;
    }
    const ashore = this.playersAshore();
    // Crew row back when nobody is left ashore
    if (!ashore.length && this.shoreCrew().some((m) => m.ashore)) this.crewAboard();
    if (this.phase === 'return' && !ashore.length) { this.finish(); return; }
    this.updateFoes(dt, t);
    // The dig: someone at the X and no guard left near it
    const C = this.chest, s = this.site;
    if (C.state === 'buried') {
      const there = ashore.some((pl) => !pl.dead && flat(pl.headLocal, s.xx, s.xz) < 4);
      if (there) {
        const guarded = this.foes.some((f) => f.state !== 'dead' && flat(f.p.g.position, s.xx, s.xz) < 18);
        if (!guarded) { C.state = 'digging'; C.t = 0; G.events.emit('digStarted', { pos: this.xPos() }); }
        else if (G.t > (this.guardedMsgT || 0)) { this.guardedMsgT = G.t + 8; G.events.emit('treasureGuarded', {}); }
      }
    } else if (C.state === 'digging') {
      C.t += dt;
      if (C.t > 4.5) { C.state = 'up'; C.t = 0; G.events.emit('chestUnearthed', { pos: this.xPos() }); }
    }
  }

  xPos(dy = 0) { return new THREE.Vector3(this.site.xx, ground(this.site.xx, this.site.xz) + dy, this.site.xz); }

  // Everything a player does here (from actions.js). Returns the action's result.
  act(pl, a) {
    const G = this.G;
    switch (a.type) {
      case 'goAshore': {
        if ((this.phase !== 'hunt' && this.phase !== 'return') || !this.anchored || pl.dead || pl.ship !== G.ship) return false;
        const s = this.site, n = parseInt(pl.id.split(':')[1]) || 0;
        const side = Math.cos(s.yaw), fwd = -Math.sin(s.yaw);
        const x = s.lx + (n - 1.5) * 1.1 * side - Math.sin(s.yaw) * 1.5, z = s.lz + (n - 1.5) * 1.1 * fwd - Math.cos(s.yaw) * 1.5;
        const first = !this.playersAshore().length;
        pl.goAshore(x, z, s.yaw);
        if (!this.shoreCrew().some((m) => m.ashore)) this.crewAshore();
        G.events.emit('wentAshore', { player: pl, first, pos: new THREE.Vector3(x, ground(x, z) + 1, z) });
        return true;
      }
      case 'goAboard':
        if (!this.ashore(pl)) return false;
        pl.goAboard();
        G.events.emit('wentAboard', { player: pl });
        return true;
      case 'openChest':
        if (!this.ashore(pl) || pl.dead || this.chest.state !== 'up' || flat(pl.headLocal, this.site.xx, this.site.xz) > 5) return false;
        this.chest.state = 'open';
        G.events.emit('chestOpened', { player: pl, pos: this.xPos(0.8) });
        return true;
      case 'pickUpgrade': {
        if (!this.ashore(pl) || this.chest.state !== 'open' || !UPGRADES[a.kind]) return false;
        this.chest.state = 'taken'; this.phase = 'return';
        this.up[a.kind]++;
        this.applyStats(a.kind);
        G.events.emit('upgradeChosen', { kind: a.kind, name: UPGRADES[a.kind].name, level: this.up[a.kind], player: pl });
        return true;
      }
    }
    return false;
  }

  // The rules side of an upgrade (the looks are in applyLooks, on every headset)
  applyStats(kind) {
    const S = this.G.ship;
    S.reloadTime = 5 * Math.pow(0.75, this.up.reload);
    S.maxHealth = 150 + 50 * this.up.hull;
    if (kind === 'hull') S.health = S.maxHealth;
  }

  // All aboard with the prize: weigh anchor and set sail on the next voyage.
  finish() {
    const G = this.G;
    this.crewAboard();
    for (const f of this.foes) f.p.g.removeFromParent();
    this.foes = [];
    G.ship.anchored = false; this.anchored = false;
    this.phase = 'off'; this.site = null; this.chest = { state: 'buried', t: 0 };
    G.events.emit('treasureDone', { up: { ...this.up } });
    G.voyages.begin(G.voyages.n + 1);
  }

  // ---------- The landing party ----------
  crewAshore() {
    const s = this.site;
    this.shoreCrew().forEach((m, i) => {
      m.ashore = true; m.away = null;
      const x = s.lx - Math.sin(s.yaw) * 0.5 + (i ? 1.6 : -1.6) * Math.cos(s.yaw), z = s.lz - Math.cos(s.yaw) * 0.5 - (i ? 1.6 : -1.6) * Math.sin(s.yaw);
      this.shore.root.add(m.p.g); m.p.g.position.set(x, ground(x, z), z); m.p.g.rotation.set(0, s.yaw, 0);
      m.p.sword.visible = true;
    });
  }
  crewAboard() {
    const S = this.G.ship;
    for (const m of this.shoreCrew()) {
      if (!m.ashore) continue;
      m.ashore = false; S.root.add(m.p.g); m.p.g.position.copy(m.home); m.p.g.rotation.set(0, 0, 0); m.p.sword.visible = false;
    }
  }

  // Walk a pirate across the island toward (x, z). Returns true when there.
  walk(p, x, z, dt, speed) {
    const pos = p.g.position, dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const k = Math.min(d, speed * dt) / d, nx = pos.x + dx * k, nz = pos.z + dz * k;
    if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; }
    else if (walkable(nx, pos.z)) pos.x = nx;        // slide along a rock
    else if (walkable(pos.x, nz)) pos.z = nz;
    else { const s = Math.min(d, speed * dt), sx = pos.x - dz / d * s, sz = pos.z + dx / d * s; if (walkable(sx, sz)) { pos.x = sx; pos.z = sz; } } // step round it
    pos.y = ground(pos.x, pos.z);
    facePerson(p, dx, dz, dt);
    return false;
  }

  // One of the landing party (called from crew.js): follow the captain, fight guards, dig.
  crewStep(m, dt) {
    const G = this.G, p = m.p, pos = p.g.position, s = this.site, i = SHORE_CREW.indexOf(m.name);
    p.sword.visible = true;
    if (this.chest.state === 'digging') {
      const x = s.xx + (i ? 0.9 : -0.9), z = s.xz + 0.4;
      if (!this.walk(p, x, z, dt, 3)) return false;
      facePerson(p, s.xx - pos.x, s.xz - pos.z, dt, 5); p.pose = 'haul';
      return true;
    }
    let foe = null, fd = 11;
    for (const f of this.foes) if (f.state === 'fight') { const d = pos.distanceTo(f.p.g.position); if (d < fd) { fd = d; foe = f; } }
    if (foe) {
      const fp = foe.p.g.position;
      let still = true;
      if (fd > 1.1) { this.walk(p, fp.x, fp.z, dt, 2.6); still = false; }
      facePerson(p, fp.x - pos.x, fp.z - pos.z, dt);
      if (fd < 1.5 && m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.atkCD = rand(1.4, 2.0); m.foeHit = foe; }
      if (p.attack > 0.62 && m.foeHit) {
        _a.set(pos.x, pos.y + 1.3, pos.z);
        if (Math.random() < 0.4) { G.events.emit('bladeContact', { pos: _a }); G.events.emit('boarderStruck', { pos: _a }); this.hitFoe(m.foeHit, 1, fp.x - pos.x, fp.z - pos.z); }
        else G.events.emit('parried', { pos: _a });
        m.foeHit = null;
      }
      return still;
    }
    // Follow the nearest player ashore, a couple of steps behind and to the side
    let lead = null, ld = 1e9;
    for (const pl of this.playersAshore()) { if (pl.dead) continue; const d = flat(pl.headLocal, pos.x, pos.z); if (d < ld) { ld = d; lead = pl; } }
    if (!lead) return true;
    const h = lead.headLocal, ax = pos.x - h.x, az = pos.z - h.z, al = Math.hypot(ax, az) || 1;
    if (ld > 3.2) { this.walk(p, h.x + (ax / al) * 2 + (i ? 0.8 : -0.8), h.z + (az / al) * 2, dt, ld > 8 ? 3.4 : 2.4); return false; }
    facePerson(p, h.x - pos.x, h.z - pos.z, dt, 2);
    pos.y = ground(pos.x, pos.z);
    return true;
  }

  // ---------- Guards ----------
  updateFoes(dt, t) {
    const G = this.G;
    const targets = [];
    for (const pl of this.playersAshore()) if (!pl.dead) targets.push({ pl, pos: pl.headLocal });
    for (const m of this.shoreCrew()) if (m.ashore) targets.push({ crew: m, pos: m.p.g.position });
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i], p = f.p, pos = p.g.position;
      f.hitCD -= dt;
      if (f.state === 'dead') {
        f.deadT += dt; animatePerson(p, dt, false, t);
        if (f.deadT > 3) pos.y -= dt * 0.6;
        if (f.deadT > 5) { p.g.removeFromParent(); this.foes.splice(i, 1); }
        continue;
      }
      let tg = null, td = 1e9;
      for (const x of targets) { const d = flat(x.pos, pos.x, pos.z) - (x.pl ? 1 : 0); if (d < td) { td = d; tg = x; } }
      if (f.state === 'idle') {
        if (tg && td < 14) {
          const first = !this.alerted?.has(f.group);
          (this.alerted = this.alerted || new Set()).add(f.group);
          for (const o of this.foes) if (o.group === f.group && o.state === 'idle') o.state = 'fight';
          G.events.emit('guardsAlerted', { pos: new THREE.Vector3(pos.x, pos.y + 1.6, pos.z), first, big: f.group === 1 });
        } else {
          // On watch: back to his post, looking about
          if (!this.walk(p, f.home.x, f.home.z, dt, 1.4)) { animatePerson(p, dt, true, t); continue; }
          p.g.rotation.y += Math.sin(t * 0.4 + f.seed) * dt * 0.3;
          animatePerson(p, dt, false, t);
          continue;
        }
      }
      if (!tg || td > 30) { f.state = 'idle'; animatePerson(p, dt, false, t); continue; }
      const dx = tg.pos.x - pos.x, dz = tg.pos.z - pos.z, d = Math.hypot(dx, dz);
      facePerson(p, dx, dz, dt);
      let moving = false;
      if (d > 1.05 && p.attack < 0) { this.walk(p, tg.pos.x, tg.pos.z, dt, f.big ? 1.7 : 2.0); moving = true; }
      for (const o of this.foes) {
        if (o === f || o.state === 'dead') continue;
        const op = o.p.g.position, ox = pos.x - op.x, oz = pos.z - op.z, od = Math.hypot(ox, oz);
        if (od < 0.8 && od > 1e-3) { const nx = pos.x + (ox / od) * (0.8 - od) * 0.5, nz = pos.z + (oz / od) * (0.8 - od) * 0.5; if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; } }
      }
      pos.y = ground(pos.x, pos.z);
      f.atkCD -= dt;
      if (d < 1.45 && f.atkCD <= 0 && p.attack < 0) { p.attack = 0; f.swingHit = false; f.atkCD = rand(1.5, 2.2); }
      if (p.attack > 0.62 && !f.swingHit) {
        f.swingHit = true;
        _a.set(pos.x, pos.y + 1.3, pos.z); G.events.emit('boarderSwing', { pos: _a });
        if (d < 1.7 && tg.pl) G.hurtPlayer(tg.pl, f.big ? 14 : 10);
        else if (d < 1.7 && Math.random() < 0.6) G.events.emit('parried', { pos: _a });
      }
      animatePerson(p, dt, moving, t);
    }
  }

  hitFoe(f, dmg, kx, kz) {
    if (f.state === 'dead' || f.hitCD > 0) return;
    f.hp -= dmg; f.hitCD = 0.35;
    if (f.state === 'idle') for (const o of this.foes) if (o.group === f.group && o.state === 'idle') o.state = 'fight';
    const d = Math.hypot(kx, kz) || 1, pos = f.p.g.position;
    const nx = pos.x + (kx / d) * 0.35, nz = pos.z + (kz / d) * 0.35;
    if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; }
    f.p.attack = -1; f.atkCD = Math.max(f.atkCD, 0.9);
    if (f.hp <= 0) {
      f.state = 'dead'; f.p.dead = true; f.p.deadT = 0; f.deadT = 0;
      const left = this.foes.filter((o) => o.state !== 'dead').length;
      this.G.events.emit('guardKilled', { left, big: f.big });
    }
  }

  // A VR sword ashore (hilt/tip in world space, which is the shore's local space)
  swordCheck(player, hilt, tip, speed) {
    const G = this.G; let any = false;
    for (const f of this.foes) {
      if (f.state === 'dead' || f.hitCD > 0) continue;
      const p = f.p.g.position;
      _c.set(p.x, p.y + 0.3, p.z); _d.set(p.x, p.y + 1.75 * (f.big ? 1.15 : 1), p.z);
      if (segSegDist(hilt, tip, _c, _d).d < 0.34) {
        _a.copy(tip).sub(hilt).multiplyScalar(0.7).add(hilt);
        G.events.emit('bladeContact', { pos: _a });
        if (f.p.attack >= 0 && f.p.attack < 0.5 && Math.random() < 0.3) { G.events.emit('parried', { pos: _a }); f.hitCD = 0.3; f.p.attack = -1; }
        else { G.events.emit('boarderStruck', { pos: _a }); this.hitFoe(f, speed > 6 ? 2 : 1, p.x - player.headLocal.x, p.z - player.headLocal.z); }
        any = true;
      }
    }
    return any;
  }

  // Desktop slash ashore: guards in a cone in front of you
  deskSlash(player, facing) {
    const G = this.G, h = player.headLocal;
    for (const f of this.foes) {
      if (f.state === 'dead') continue;
      const p = f.p.g.position, dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * facing.x + dz * facing.z) / Math.max(d, 1e-3) > 0.5) {
        _b.set(p.x, p.y + 1.3, p.z);
        G.events.emit('bladeContact', { pos: _b }); G.events.emit('boarderStruck', { pos: _b });
        this.hitFoe(f, 1, dx, dz);
      }
    }
  }

  // ================= MULTIPLAYER =================
  snap() {
    const s = this.site;
    return {
      phase: this.phase, anchored: this.anchored, up: { ...this.up },
      site: s ? [s.xx, s.xz, s.lx ?? null, s.lz ?? null, s.bx ?? null, s.bz ?? null, s.yaw ?? null] : null,
      chest: this.chest.state,
      foes: this.foes.map((f) => ({ id: f.id, state: f.state, hp: f.hp, look: f.look, seed: f.seed, big: f.big, group: f.group,
        pos: [r2(f.p.g.position.x), r2(f.p.g.position.y), r2(f.p.g.position.z)], rot: r2(f.p.g.rotation.y), attack: r2(f.p.attack), dead: f.p.dead })),
      crew: this.shoreCrew().filter((m) => m.ashore).map((m) => m.id),
    };
  }

  // A friend's headset: follow the host's island
  applySnap(sn, mirror) {
    if (!sn) return;
    this.phase = sn.phase; this.anchored = sn.anchored; this.chest.state = sn.chest;
    Object.assign(this.up, sn.up);
    const a = sn.site;
    this.site = a ? { xx: a[0], xz: a[1], ...(a[2] !== null ? { lx: a[2], lz: a[3], bx: a[4], bz: a[5], yaw: a[6] } : {}) } : null;
    for (const m of this.shoreCrew()) m.ashore = sn.crew.includes(m.id);
    const seen = new Set();
    for (const fs of sn.foes) {
      let f = this.byId(fs.id);
      if (!f) f = this.foes[this.foes.push(this.makeFoe({ ...fs, hp: fs.hp })) - 1];
      seen.add(f); f.state = fs.state; f.hp = fs.hp;
      mirror.person(f.p, fs);
    }
    for (let i = this.foes.length - 1; i >= 0; i--) if (!seen.has(this.foes[i])) { this.foes[i].p.g.removeFromParent(); this.foes.splice(i, 1); }
  }
  clientStep(dt, mirror) { for (const f of this.foes) mirror.stepPerson(f.p, dt, this.G.t); }

  // ================= LOOKS (every headset) =================
  // Keep a player ashore on dry land, feet on the ground (called from player.clampToDeck)
  clampWalker(P) {
    const G = this.G;
    P.dolly.updateMatrixWorld(true);
    G.camera.getWorldPosition(_a);
    const lg = P.lastGood || (P.lastGood = { x: _a.x, z: _a.z });
    if (!walkable(_a.x, _a.z)) {
      P.dolly.position.x += lg.x - _a.x; P.dolly.position.z += lg.z - _a.z;
      _a.x = lg.x; _a.z = lg.z;
    } else { lg.x = _a.x; lg.z = _a.z; }
    const gy = ground(_a.x, _a.z), oy = P.dolly.position.y;
    P.dolly.position.y = gy;
    P.headLocal.set(_a.x, _a.y - oy + gy, _a.z);
  }

  // Things a VR hand can use here (called from player.findTarget)
  targets(P, hand, consider) {
    if (!this.ashore(P) || !this.site || P.dead) return;
    const C = this.chest.state;
    if (C === 'up' && this.v.chest) {
      this.v.chest.g.getWorldPosition(_b); _b.y += 0.55;
      consider('chest', hand.distanceTo(_b), 0.7, { point: _b.clone(), id: 'chest', text: 'GRIP to open\nthe chest!' });
    }
    if (C === 'open' && this.v.cards) for (const c of this.v.cards) {
      consider('card', hand.distanceTo(c.position), 0.45, { point: c.position.clone(), id: 'card' + c.userData.kind, upg: c.userData.kind, text: `GRIP to take\n${UPGRADES[c.userData.kind].name}` });
    }
  }

  // Desktop click ashore: the chest or a card you're looking at. True if it used the click.
  deskUse(P) {
    if (!this.ashore(P) || !this.site) return false;
    const G = this.G, C = this.chest.state;
    G.camera.getWorldPosition(_a); G.camera.getWorldDirection(_b);
    const look = (p, maxD, cos) => { _c.copy(p).sub(_a); const d = _c.length(); return d < maxD && _c.normalize().dot(_b) > cos ? _c.dot(_b) : 0; };
    if (C === 'up' && this.v.chest && look(this.v.chest.g.getWorldPosition(_d).setY(_d.y + 0.4), 6, 0.8)) { G.act({ type: 'openChest' }); return true; }
    if (C === 'open' && this.v.cards) {
      let best = null, bs = 0;
      for (const c of this.v.cards) { const s = look(c.position, 6, 0.96); if (s > bs) { bs = s; best = c; } }
      if (best) { G.act({ type: 'pickUpgrade', kind: best.userData.kind }); return true; }
    }
    return false;
  }

  // Build or remove the meshes for the current site
  syncVisuals() {
    const G = this.G, s = this.site, v = this.v, R = this.shore.root;
    const key = s ? `${s.xx},${s.xz},${s.lx ?? ''}` : '';
    if (key === v.key) return;
    for (const o of v.objs || []) o.removeFromParent();
    this.v = { key, objs: [] };
    if (!s) return;
    const add = (o) => { R.add(o); this.v.objs.push(o); return o; };
    const gx = ground(s.xx, s.xz);
    // The beam: a tall column of gold light over the X, seen from far out at sea
    const beam = add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 220, 16, 1, true), BEAM_MAT));
    beam.position.set(s.xx, gx + 110, s.xz); beam.renderOrder = 2; this.v.beam = beam;
    const xm = add(buildX()); xm.position.set(s.xx, gx + 0.05, s.xz); this.v.x = xm;
    const chest = buildChest(); add(chest.g); chest.g.position.set(s.xx, gx - 1.2, s.xz); chest.g.visible = false; this.v.chest = chest;
    if (s.lx !== undefined) {
      chest.g.rotation.y = s.yaw;
      const boat = add(buildBoat()); boat.position.set(s.bx, 0.15, s.bz); boat.rotation.y = s.yaw + 0.4; this.v.boat = boat;
      const rg = add(ring(1.0)); rg.position.set(s.lx + Math.sin(s.yaw) * 0.5, ground(s.lx, s.lz) + 0.06, s.lz + Math.cos(s.yaw) * 0.5); this.v.shoreRing = rg;
      const lb = add(label('Stand here to\nrow back aboard', 512, 160, 1.1)); lb.position.copy(rg.position).setY(rg.position.y + 1.6); this.v.shoreLabel = lb;
      this.v.cards = KINDS.map((k, i) => {
        const tex = canvasTex(320, 420, (g, w, h) => {
          g.fillStyle = '#e8d6a8'; g.fillRect(0, 0, w, h);
          g.strokeStyle = UPGRADES[k].col; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
          g.fillStyle = '#3a2210'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = 'bold 40px Georgia, serif'; UPGRADES[k].name.split(' ').forEach((wd, j) => g.fillText(wd, w / 2, 80 + j * 46));
          g.fillStyle = UPGRADES[k].col; g.beginPath(); g.arc(w / 2, 210, 40, 0, 6.3); g.fill();
          g.fillStyle = '#3a2210'; g.font = '30px Georgia, serif'; UPGRADES[k].text.split('\n').forEach((ln, j) => g.fillText(ln, w / 2, 300 + j * 38));
        });
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sp.scale.set(0.45, 0.59, 1); sp.visible = false; sp.userData.kind = k; sp.userData.i = i;
        return add(sp);
      });
    }
  }

  // The deck ring (built once, on our ship)
  deckRing() {
    if (!this.deck) {
      const S = this.G.ship, rg = ring(0.75); rg.position.set(DECK_RING.x, 0.05, DECK_RING.z); S.root.add(rg);
      const lb = label('Stand here to\nrow ashore', 512, 160, 0.9); lb.position.set(DECK_RING.x, 2.0, DECK_RING.z); S.root.add(lb);
      this.deck = { rg, lb };
    }
    return this.deck;
  }

  // Bronze barrels and iron hull straps for the upgrades won so far
  applyLooks() {
    const key = `${this.up.bronze > 0}${this.up.hull}`;
    if (key === this.looks) return;
    this.looks = key;
    const S = this.G.ship;
    if (this.up.bronze > 0) for (const c of S.cannons) for (const m of c.barrel.children) m.material = BRONZE;
    if (this.straps) { this.straps.removeFromParent(); this.straps.geometry.dispose(); this.straps = null; }
    const n = Math.min(3, this.up.hull);
    if (n) {
      const k = new Kit();
      for (let j = 0; j < n; j++) {
        const y = [0.25, -0.35, -0.85][j];
        for (const sd of [-1, 1]) {
          const pts = []; for (let z = STERN - 0.6; z > BOW + 1.2; z -= 0.5) pts.push([sd * (hullX(z, y) + 0.04), y, z]);
          k.tube(pts, 0.05, 0x2a2c31, 4);
        }
      }
      this.straps = k.mesh(); S.root.add(this.straps);
    }
  }

  view(dt) {
    const G = this.G, P = G.player, t = G.t;
    this.applyLooks();
    this.syncVisuals();
    const v = this.v, s = this.site;
    const deck = this.deckRing();
    const canRow = (this.phase === 'hunt' || this.phase === 'return') && this.anchored;
    deck.rg.visible = deck.lb.visible = canRow;
    if (v.beam) {
      // Fades as you get close, so it doesn't fog up the view at the X
      G.camera.getWorldPosition(_a);
      v.beam.material.opacity = (0.22 + Math.sin(t * 2) * 0.06) * Math.min(1, Math.max(0.15, (flat(_a, s.xx, s.xz) - 4) / 25));
      v.beam.visible = this.chest.state === 'buried' || this.chest.state === 'digging';
    }
    // Rings: stand in one for a moment to cross
    let inRing = false;
    if (G.started && !P.dead && canRow) {
      if (P.ship === G.ship) inRing = Math.hypot(P.headLocal.x - DECK_RING.x, P.headLocal.z - DECK_RING.z) < 0.75;
      else if (this.ashore(P) && v.shoreRing) inRing = flat(P.headLocal, v.shoreRing.position.x, v.shoreRing.position.z) < 1.0;
    }
    this.ringT = inRing ? this.ringT + dt : Math.min(0, this.ringT + dt);
    if (this.ringT > 1.1) { this.ringT = -2.5; G.act({ type: P.ship === G.ship ? 'goAshore' : 'goAboard' }); }
    const pulse = 1 + (inRing ? Math.max(0, this.ringT) * 0.4 : Math.sin(t * 3) * 0.05);
    deck.rg.scale.setScalar(pulse);
    if (v.shoreRing) { v.shoreRing.scale.setScalar(pulse); v.shoreRing.visible = v.shoreLabel.visible = this.phase === 'return' || this.ashore(P); v.shoreLabel.visible = v.shoreRing.visible && this.phase === 'return'; }
    // The chest: rises out of the sand, lid swings open, cards float up
    if (v.chest) {
      const C = this.chest.state, ch = v.chest, gy = ground(s.xx, s.xz);
      ch.g.visible = C !== 'buried';
      const ty = C === 'buried' ? gy - 1.2 : C === 'digging' ? gy - 1.2 + Math.min(1, (this.digLook = (this.digLook || 0) + dt) / 4.5) * 0.7 : gy - 0.05;
      ch.g.position.y += (ty - ch.g.position.y) * Math.min(1, dt * 3);
      if (C !== 'digging') this.digLook = 0;
      if (C === 'digging' && Math.random() < dt * 6) G.fx.debris(_a.set(s.xx + rand(-0.8, 0.8), gy + 0.2, s.xz + rand(-0.8, 0.8)), 3);
      const open = C === 'open' || C === 'taken';
      ch.lid.rotation.x += ((open ? -1.9 : 0) - ch.lid.rotation.x) * Math.min(1, dt * 4);
      ch.gold.visible = open && C !== 'taken';
      v.x.visible = C === 'buried' || C === 'digging';
      if (v.cards) for (const c of v.cards) {
        c.visible = C === 'open';
        const i = c.userData.i - 1, side = Math.cos(s.yaw), fwd = -Math.sin(s.yaw);
        c.position.set(s.xx + i * 0.62 * side, gy + 1.5 + Math.sin(t * 2 + i) * 0.05, s.xz + i * 0.62 * fwd);
      }
    }
    this.updateMap(dt);
  }

  // ---------- The treasure map ----------
  buildMap() {
    const I = ISLET, size = 128, half = 70;
    // The island drawn once as a parchment chart
    const base = document.createElement('canvas'); base.width = base.height = size;
    const g = base.getContext('2d'), img = g.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = I.x - half + (i + 0.5) * (2 * half / size), z = I.z - half + (j + 0.5) * (2 * half / size), h = landHeight(x, z), o = (j * size + i) * 4;
      let c;
      if (h < -0.3) c = [150, 170, 160]; else if (h < 1.6) c = [226, 206, 156]; else { const k = Math.min(1, h / 24); c = [196 - 70 * k, 186 - 50 * k, 120 - 40 * k]; }
      if (h > -0.6 && h < 0.0) c = [110, 90, 60];
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapBase = { canvas: base, x0: I.x - half, z0: I.z - half, size: 2 * half };
    this.mapTex = canvasTex(256, 256, () => {});
    this.mapSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.mapTex, transparent: true, depthTest: false, depthWrite: false }));
    this.mapSprite.scale.set(0.2, 0.2, 1); this.mapSprite.renderOrder = 996; this.mapSprite.visible = false;
    const el = this.mapTex.image; el.id = 'tmap';
    el.style.cssText = 'position:fixed;right:14px;top:14px;width:220px;height:220px;z-index:5;display:none;pointer-events:none;border-radius:10px';
    document.body.appendChild(el);
  }

  updateMap(dt) {
    const G = this.G, P = G.player, ashore = this.ashore(P) && this.site, vr = G.mode === 'vr';
    this.mapTex.image.style.display = ashore && G.mode === 'desktop' ? 'block' : 'none';
    const left = P.hands?.find((h) => h.side === 'left');
    if (left && this.mapSprite.parent !== left.grip) { left.grip.add(this.mapSprite); this.mapSprite.position.set(0, 0.1, 0.0); }
    this.mapSprite.visible = !!(ashore && vr && left?.src);
    if (!ashore || (this.mapT -= dt) > 0) return;
    this.mapT = 0.2;
    const g = this.mapTex.userData.ctx, W = 256, s = this.site, B = this.mapBase;
    G.camera.getWorldPosition(_a); G.camera.getWorldDirection(_b);
    let fx = _b.x, fz = _b.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx, sc = 2.2, cx = W / 2, cy = W / 2 + 20;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#d9c393'; g.beginPath(); g.roundRect(0, 0, W, W, 24); g.fill();
    g.save(); g.beginPath(); g.roundRect(8, 8, W - 16, W - 16, 18); g.clip();
    // world (x, z) -> map: forward is up
    g.setTransform(sc * rx, -sc * fx, sc * rz, -sc * fz, cx - sc * (rx * _a.x + rz * _a.z), cy + sc * (fx * _a.x + fz * _a.z));
    g.fillStyle = '#96aaa0'; g.fillRect(B.x0 - 200, B.z0 - 200, B.size + 400, B.size + 400);
    g.imageSmoothingEnabled = true; g.drawImage(B.canvas, B.x0, B.z0, B.size, B.size);
    const mark = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, z, r, 0, 6.3); g.fill(); };
    // The X
    g.strokeStyle = '#a01a10'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(s.xx - 4, s.xz - 4); g.lineTo(s.xx + 4, s.xz + 4); g.moveTo(s.xx + 4, s.xz - 4); g.lineTo(s.xx - 4, s.xz + 4); g.stroke();
    if (s.bx !== undefined) { g.fillStyle = '#5d3b22'; g.fillRect(s.bx - 1.5, s.bz - 1.5, 3, 3); }
    for (const f of this.foes) if (f.state === 'fight') mark(f.p.g.position.x, f.p.g.position.z, 1.6, '#c02010');
    for (const m of this.shoreCrew()) if (m.ashore) mark(m.p.g.position.x, m.p.g.position.z, 1.3, '#2a5aa0');
    for (const pl of G.players) if (pl !== P && this.ashore(pl)) mark(pl.headLocal.x, pl.headLocal.z, 1.6, '#e0b020');
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // You: an arrow in the middle, pointing the way you face
    g.fillStyle = '#3a2210'; g.beginPath(); g.moveTo(cx, cy - 11); g.lineTo(cx + 7, cy + 8); g.lineTo(cx, cy + 3); g.lineTo(cx - 7, cy + 8); g.closePath(); g.fill();
    const dx = s.xx - _a.x, dz = s.xz - _a.z, dist = Math.hypot(dx, dz);
    const ahead = (dx * fx + dz * fz) / (dist || 1), right = (dx * rx + dz * rz) / (dist || 1);
    const where = dist < 4 ? 'You’re on the X!' : `X: ${Math.round(dist)} m ${ahead > 0.8 ? 'ahead' : ahead < -0.6 ? 'behind you' : right > 0 ? 'to your right' : 'to your left'}`;
    g.fillStyle = 'rgba(40,24,10,0.82)'; g.fillRect(8, 8, W - 16, 36);
    g.fillStyle = '#fff3cf'; g.font = 'bold 22px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(this.phase === 'return' ? 'Back to the boat!' : where, W / 2, 27, W - 24);
    g.strokeStyle = '#6a4a22'; g.lineWidth = 6; g.beginPath(); g.roundRect(3, 3, W - 6, W - 6, 22); g.stroke();
    this.mapTex.needsUpdate = true;
  }

  // One line for the Captain's Board
  boardLine() {
    const G = this.G, S = G.ship, s = this.site;
    if (!s) return null;
    if (this.phase === 'sail') {
      const d = Math.hypot(s.xx - S.pos.x, s.xz - S.pos.z);
      return `Treasure! Sail to the gold light (${Math.round(d)} m)`;
    }
    if (this.phase === 'return') return 'Prize taken! Row back aboard';
    return { buried: 'At anchor: row ashore, find the X', digging: 'Digging up the treasure...', up: 'Open the chest!', open: 'Pick your prize!' }[this.chest.state] || null;
  }
}
