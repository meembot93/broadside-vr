// A friend's headset (multiplayer client): no game rules run here. The host sends a snapshot
// of the whole game about 20 times a second (state.js); this file makes our copy of the world
// match it, and in between moves things smoothly so nothing jumps:
//   * ships keep sailing on their last known heading and speed, and are nudged toward where
//     the host says they are (so our own deck, where you stand, glides instead of stuttering)
//   * pirates walk toward their reported spot and animate on their own
//   * cannonballs and the grapple hook fly on their own once launched
// Things are created and removed as they appear and disappear in the snapshots. Sounds,
// effects and messages come from the host's events, played by presentation.js as usual.
import * as THREE from 'three';
import { animatePerson } from '../people.js';
import { LEAK_BLOWS } from '../damage.js';
import { angleWrap, damp } from '../util.js';

const _a = new THREE.Vector3();

export class Mirror {
  constructor(G) {
    this.G = G; this.first = true; this.ballMap = new Map(); this.sparkT = 0;
    // Cannon recoil and musket kick are looks the rules set; do them here from the events
    G.events.on('cannonFired', ({ cannon }) => { if (cannon) cannon.recoil = 1; });
  }

  me() { return this.G.player.id; }
  allShips() { return [this.G.ship, ...this.G.enemies.ships]; }
  shipById(id) { return this.G.frameById(id); } // a ship, or 'shore' (island.js)

  // ---------- A snapshot arrived ----------
  apply(snap) {
    const G = this.G, now = performance.now() / 1000;
    // Keep our clock (waves, animations) close to the host's
    const err = snap.t + 0.05 - G.t;
    if (this.first || Math.abs(err) > 2) G.t = snap.t; else G.t += err * 0.1;

    this.ships(snap, now);
    this.players(snap);
    this.crew(snap);
    this.boarders(snap);
    this.balls(snap);
    this.items(snap);
    this.damage(snap.damage);
    this.grapple(snap.grapple);
    this.G.island.applySnap(snap.island, this);

    G.state = snap.state; G.score = snap.score; G.crew.order = snap.order;
    const V = G.voyages, sv = snap.voyage;
    V.n = sv.voyage; V.wave = sv.wave; V.waves = { length: sv.waves }; V.phase = sv.phase; V.bossName = sv.boss;
    V.bossShip = sv.bossShip ? this.shipById(sv.bossShip) : null;
    if (snap.weather && snap.weather.name !== G.weather.name) G.weather.set(snap.weather.name, { instant: this.first });
    this.first = false;
  }

  ships(snap, now) {
    const G = this.G, seen = new Set(), me = this.me();
    for (const ss of snap.ships) {
      let s = this.shipById(ss.id);
      if (!s) s = G.enemies.spawnMirror(ss);
      seen.add(s);
      const prev = s.net;
      const turn = prev && snap.t > prev.t ? angleWrap(ss.heading - prev.heading) / (snap.t - prev.t) : 0;
      s.net = { x: ss.pos[0], z: ss.pos[1], heading: ss.heading, t: snap.t, at: now, turn: Math.abs(turn) < 1 ? turn : 0 };
      if (!prev) { s.pos.set(ss.pos[0], 0, ss.pos[1]); s.heading = ss.heading; }
      s.speed = ss.speed; s.sail = ss.sail; s.rudder = ss.rudder;
      s.health = ss.health; s.maxHealth = ss.maxHealth || s.maxHealth;
      if (s.alive && !ss.alive) s.sinkT = ss.sinkT;
      s.alive = ss.alive;
      if (Math.abs(s.sinkT - ss.sinkT) > 0.5) s.sinkT = ss.sinkT;
      // The wheel and lever: keep our own hands' version while we're steering
      if (!(s === G.ship && G.t - (this.helmT || -9) < 0.6)) { s.wheelAngle = ss.wheel; s.leverAngle = ss.lever; }
      s.helmBy = ss.helmBy;
      if (ss.captured && !s.captured) s.strikeColors();
      s.captured = ss.captured; s.abandoned = ss.abandoned;
      if (s.ai && ss.ai) s.ai.mode = ss.ai.mode;
      // Powder keg on a taken prize
      if (ss.keg !== null && ss.keg !== undefined && !s.keg) G.grapples.placeKeg(s);
      if (s.keg && ss.keg !== null) { s.keg.fuse = ss.keg; s.keg.obj.visible = ss.keg > -2; }
      ss.cannons.forEach((sc, i) => {
        const c = s.cannons[i]; if (!c) return;
        c.reload = sc.reload; c.inArc = sc.arc;
        if (!(c._hold > G.t)) c.fuse = sc.fuse;
        const mine = c.manual === me && sc.manual === me;
        if (!(c._hold > G.t)) c.manual = sc.manual;
        if (!mine) { c.tElev = sc.el; c.tYaw = sc.yw; }
      });
      ss.crew.forEach((sc, i) => { const m = s.crew[i]; if (m) this.person(m.p, sc); });
    }
    for (let i = G.enemies.ships.length - 1; i >= 0; i--) {
      const e = G.enemies.ships[i];
      if (seen.has(e)) continue;
      if (e.lock) this.dropLock(e.lock);
      e.dispose(); G.enemies.ships.splice(i, 1);
    }
  }

  // A pirate: where the host says he is (we walk him there smoothly in step())
  person(p, sc) {
    const first = !p.net;
    p.net = sc;
    if (first) { p.g.position.set(...sc.pos); p.g.rotation.y = sc.rot ?? p.g.rotation.y; }
    p.pose = sc.pose;
    if (sc.attack >= 0 && (p.attack < 0 || Math.abs(p.attack - sc.attack) > 0.35)) p.attack = sc.attack;
    if (sc.dead && !p.dead) { p.dead = true; p.deadT = 0; p.pose = null; }
    else if (!sc.dead && p.dead) { p.dead = false; p.body.rotation.x = 0; }
    if (sc.vis !== undefined) p.g.visible = sc.vis;
  }

  players(snap) {
    const G = this.G, net = G.net, me = this.me(), seen = new Set([me]);
    for (const sp of snap.players) {
      if (sp.id === me) {
        const P = G.player;
        if (sp.health < P.health - 0.5) P.lastHurt = G.t;
        P.health = sp.health;
        if (sp.dead !== P.dead) { P.dead = sp.dead; if (P.dead) for (const h of P.hands) P.release(h); }
        continue;
      }
      seen.add(sp.id);
      const pl = net.avatarFor(sp.id, sp.name);
      pl.health = sp.health; pl.dead = sp.dead;
      const s = this.shipById(sp.ship); if (s && G.t > pl.holdShipT) pl.ship = s;
    }
    for (const pl of [...G.players]) if (!seen.has(pl.id)) net.removeAvatar(pl.id);
  }

  crew(snap) {
    const G = this.G;
    snap.crew.forEach((sc, i) => {
      const m = G.crew.members[i]; if (!m) return;
      const s = this.shipById(sc.on) || G.ship;
      if (m.p.g.parent !== s.root) { s.root.add(m.p.g); m.p.g.position.set(...sc.pos); }
      m.awayShip = s === G.ship ? null : s;
      m.p.sword.visible = sc.sword;
      this.person(m.p, sc);
    });
  }

  boarders(snap) {
    const E = this.G.enemies, seen = new Set();
    for (const bs of snap.boarders) {
      let b = E.boarders.find((x) => x.id === bs.id);
      if (!b) b = E.spawnBoarderMirror(bs);
      seen.add(b);
      b.state = bs.state; b.hp = bs.hp;
      this.person(b.p, { ...bs, dead: bs.state === 'dead', pose: null });
    }
    for (let i = E.boarders.length - 1; i >= 0; i--) {
      const b = E.boarders[i];
      if (!seen.has(b)) { b.p.g.removeFromParent(); E.boarders.splice(i, 1); }
    }
  }

  // Cannonballs: launched where the host says, then they fly by themselves
  balls(snap) {
    const C = this.G.combat, seen = new Set();
    for (const bs of snap.balls) {
      seen.add(bs.id);
      if (this.ballMap.has(bs.id)) continue;
      const b = C.free.pop(); if (!b) continue;
      b.id = bs.id; b.pos.set(...bs.pos); b.vel.set(...bs.vel); b.life = 0; b.mesh.visible = true; b.mesh.position.copy(b.pos);
      C.active.push(b); this.ballMap.set(bs.id, b);
    }
    for (const [id, b] of this.ballMap) if (!seen.has(id)) this.dropBall(b);
  }
  dropBall(b) {
    const C = this.G.combat, i = C.active.indexOf(b);
    if (i >= 0) C.active.splice(i, 1);
    b.mesh.visible = false; C.free.push(b); this.ballMap.delete(b.id);
  }

  items(snap) {
    const G = this.G, P = G.player, me = this.me();
    for (const si of snap.items) {
      const it = G.items.find((x) => x.id === si.id); if (!it) continue;
      const mineHere = !!it.holder || P.deskItem === it || it.belt;
      if (it._hold > G.t) continue; // we just did something with it; wait for the host to catch up
      it.loaded = si.loaded; it.full = si.full;
      if (mineHere && si.heldBy !== me) {
        // Someone else got it first: let go
        if (P.deskItem === it) P.equip(null);
        for (const h of P.hands) if (h.held === it) P.release(h);
        it.belt = false;
      }
      it.heldBy = si.heldBy;
    }
  }

  damage(sd) {
    const G = this.G, D = G.damage;
    // Leaks: a leak that's gone was patched; its planks stay on as a scar
    const leakIds = new Set(sd.leaks.map((l) => l.id));
    for (let i = D.leaks.length - 1; i >= 0; i--) {
      const l = D.leaks[i]; if (leakIds.has(l.id)) continue;
      D.leaks.splice(i, 1); l.blows = LEAK_BLOWS; D.scars.push(l);
      if (D.scars.length > 12) D.disposeView(D.scars.shift().view);
    }
    for (const sl of sd.leaks) {
      let l = D.leaks.find((x) => x.id === sl.id);
      if (!l) { l = { id: sl.id, side: sl.side, x: sl.x, y: sl.y, z: sl.z, blows: 0, view: null }; D.leaks.push(l); }
      l.blows = sl.blows;
    }
    const fireIds = new Set(sd.fires.map((f) => f.id));
    for (let i = D.fires.length - 1; i >= 0; i--) { const f = D.fires[i]; if (!fireIds.has(f.id)) { D.disposeView(f.view); D.fires.splice(i, 1); } }
    for (const sf of sd.fires) {
      let f = D.fires.find((x) => x.id === sf.id);
      if (!f) { f = { id: sf.id, x: sf.x, z: sf.z, heat: sf.heat, growT: 0, spreadT: 0, view: null }; D.fires.push(f); }
      f.heat = sf.heat;
    }
    sd.masts.forEach((sm, i) => {
      const M = D.masts[i]; if (!M) return;
      if (sm.broken && !M.broken) { M.leanDir = Math.random() < 0.5 ? -1 : 1; M.leanV = 0; }
      M.broken = sm.broken; M.blows = sm.blows;
    });
  }

  grapple(sg) {
    const G = this.G, gr = G.grapples, me = this.me();
    if (!(gr._hold > G.t)) gr.heldBy = sg.heldBy;
    if (gr.heldBy !== me) { gr.aimYaw = sg.aim[0]; gr.aimPitch = sg.aim[1]; }
    if (sg.hook) {
      if (!gr.hook) gr.hook = { pos: new THREE.Vector3(...sg.hook.pos), vel: new THREE.Vector3(...sg.hook.vel), from: new THREE.Vector3() };
    } else gr.hook = null;
    const seen = new Set();
    for (const sl of sg.locks) {
      const e = this.shipById(sl.ship); if (!e) continue;
      let l = gr.locks.find((x) => x.e === e);
      if (!l) {
        l = { e, by: sl.by, phase: sl.phase, side: sl.side, zOff: sl.zOff, hookLocal: new THREE.Vector3(...sl.hook), rope: gr.makeRope(), rope2: sl.by === 'them' ? gr.makeRope() : null, settleT: 0 };
        gr.locks.push(l); e.lock = l;
      }
      l.phase = sl.phase; l.side = sl.side; l.zOff = sl.zOff;
      seen.add(l);
    }
    for (const l of [...gr.locks]) if (!seen.has(l)) this.dropLock(l);
  }
  dropLock(l) {
    const gr = this.G.grapples, i = gr.locks.indexOf(l);
    if (i >= 0) gr.locks.splice(i, 1);
    l.e.lock = null; l.e.pinned = false;
    l.rope.removeFromParent(); l.rope.geometry.dispose();
    if (l.rope2) { l.rope2.removeFromParent(); l.rope2.geometry.dispose(); }
  }

  // ---------- Every frame ----------
  step(dt) {
    const G = this.G, t = G.t;
    for (const s of this.allShips()) {
      const n = s.net;
      if (n) {
        // Dead reckoning: sail on, then ease toward where the host's numbers say she is by now
        s.heading += n.turn * dt;
        s.vel.set(-Math.sin(s.heading) * s.speed, 0, -Math.cos(s.heading) * s.speed);
        s.pos.addScaledVector(s.vel, dt);
        // (our clock already runs at the host's "now", see apply())
        const age = Math.max(0, Math.min(0.5, G.t - n.t)), h = n.heading + n.turn * age;
        const tx = n.x - Math.sin(h) * s.speed * age, tz = n.z - Math.cos(h) * s.speed * age;
        const dx = tx - s.pos.x, dz = tz - s.pos.z;
        if (dx * dx + dz * dz > 400) { s.pos.x = tx; s.pos.z = tz; s.heading = h; }
        else { const k = 1 - Math.exp(-3 * dt); s.pos.x += dx * k; s.pos.z += dz * k; s.heading += angleWrap(h - s.heading) * k; }
      }
      if (!s.alive) s.sinkT += dt;
      for (const c of s.cannons) {
        c.elevation = damp(c.elevation, c.tElev, 8, dt); c.yaw = damp(c.yaw, c.tYaw, 8, dt);
        if (c.fuse >= 0) {
          c.fuse = Math.max(0, c.fuse - dt); c.sparkT = (c.sparkT || 0) - dt;
          if (c.sparkT <= 0) { c.sparkT = 0.04; c.breech.getWorldPosition(_a); G.fx.sparks(_a, 2, 0.1); }
        }
      }
      s.float(dt, t); s.animate(dt, t);
      for (const m of s.crew) this.stepPerson(m.p, dt, t);
      const k = s.keg;
      if (k && k.fuse >= 0) { k.sparkT -= dt; if (k.sparkT <= 0) { k.sparkT = 0.05; G.fx.sparks(k.tip.getWorldPosition(_a), 3, 0.15); } }
    }
    for (const m of G.crew.members) this.stepPerson(m.p, dt, t);
    for (const b of G.enemies.boarders) this.stepPerson(b.p, dt, t);
    G.island.clientStep(dt, this);
    // Cannonballs and the hook fly on their own
    for (const b of this.G.combat.active) {
      b.life += dt; b.vel.y -= 9.81 * dt; b.pos.addScaledVector(b.vel, dt); b.mesh.position.copy(b.pos);
      if (b.life > 10) this.dropBall(b);
    }
    const hk = G.grapples.hook;
    if (hk) { hk.vel.y -= 9.81 * 0.6 * dt; hk.pos.addScaledVector(hk.vel, dt); }
  }

  stepPerson(p, dt, t) {
    const n = p.net;
    if (!n) { animatePerson(p, dt, false, t); return; }
    const pos = p.g.position, k = 1 - Math.exp(-10 * dt);
    const ox = pos.x, oz = pos.z;
    pos.x += (n.pos[0] - pos.x) * k; pos.y += (n.pos[1] - pos.y) * k; pos.z += (n.pos[2] - pos.z) * k;
    if (n.rot !== undefined) p.g.rotation.y += angleWrap(n.rot - p.g.rotation.y) * k;
    const moving = Math.hypot(pos.x - ox, pos.z - oz) / Math.max(dt, 1e-3) > 0.4;
    animatePerson(p, dt, moving && !p.dead, t);
  }
}
