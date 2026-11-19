import * as THREE from 'three';
import { makePerson, animatePerson, facePerson } from './people.js';

const _a = new THREE.Vector3(), _t = new THREE.Vector3();

export class Crew {
  constructor(G) {
    this.G = G;
    const defs = [
      { look: { shirt: 0xd9cfb8, pants: 0x3b4a6b, bandana: 0xa82020, beard: 0x3a2414 }, role: 'gunner', side: -1, home: [-1.15, -1.6] },
      { look: { shirt: 0x7f8f5f, pants: 0x4a3b2b, hat: 0x2a1d14 }, role: 'gunner', side: 1, home: [1.15, -1.6] },
      { look: { shirt: 0x6a2f2a, pants: 0x2b2b2b, bandana: 0x2050a0, skin: 0x8d5a3b }, role: 'lookout', side: 0, home: [0.6, -7.8] },
    ];
    this.members = defs.map((d) => {
      const p = makePerson({ ...d.look, cutlass: d.role === 'gunner' });
      p.g.position.set(d.home[0], 0, d.home[1]);
      G.ship.root.add(p.g);
      return { p, role: d.role, side: d.side, home: new THREE.Vector3(d.home[0], 0, d.home[1]), atkCD: 0, victim: null, cannon: null, fireCD: 30 };
    });
  }

  // The crew only lends a hand now and then, so the captain does the real fighting.
  playerFired() { for (const m of this.members) m.fireCD = Math.max(m.fireCD, 12); }

  cheer() { for (const m of this.members) m.p.cheer = 2.5; }

  update(dt, t) {
    const G = this.G, S = G.ship;
    for (const m of this.members) {
      const p = m.p, pos = p.g.position;
      m.atkCD -= dt; m.fireCD -= dt;
      // Defend against nearby boarders first
      let foe = null, fd = 1.7;
      for (const b of G.enemies.boarders) {
        if (b.state !== 'fight') continue;
        const d = pos.distanceTo(b.p.g.position);
        if (d < fd) { fd = d; foe = b; }
      }
      if (foe) {
        facePerson(p, foe.p.g.position.x - pos.x, foe.p.g.position.z - pos.z, dt);
        if (fd > 1.0) { const k = 1.8 * dt / fd; pos.x += (foe.p.g.position.x - pos.x) * k; pos.z += (foe.p.g.position.z - pos.z) * k; }
        if (m.atkCD <= 0 && p.attack < 0) { p.attack = 0; m.atkCD = 3.2; m.victim = foe; }
        if (p.attack > 0.62 && m.victim) {
          if (Math.random() < 0.15) { _a.set(pos.x, 1.3, pos.z); S.root.localToWorld(_a); G.fx.hit(_a); G.audio.thud(_a); G.enemies.hitBoarder(m.victim, 1, m.victim.p.g.position.x - pos.x, m.victim.p.g.position.z - pos.z); }
          m.victim = null;
        }
        animatePerson(p, dt, fd > 1.0, t);
        continue;
      }

      let target = m.home, facing = null;
      if (m.role === 'gunner' && S.alive && m.fireCD <= 0) {
        let best = null, bd = 1e9;
        for (const c of S.cannons) {
          if (c.side !== m.side || !c.inArc || !S.cannonReady(c)) continue;
          const d = Math.abs(c.z - pos.z);
          if (d < bd) { bd = d; best = c; }
        }
        m.cannon = best;
        if (best) {
          target = _t.set(m.side * 1.25, 0, best.z + 0.35);
          if (pos.distanceTo(target) < 0.25) {
            facing = [m.side, 0];
            if (S.lightCannon(best, 0.5)) { p.attack = 0.3; m.fireCD = 40; best.breech.getWorldPosition(_a); G.audio.fuse(_a); }
          }
        }
      }
      const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
      let moving = false;
      if (d > 0.15) { const k = Math.min(d, 2.1 * dt) / d; pos.x += dx * k; pos.z += dz * k; moving = true; facePerson(p, dx, dz, dt); }
      else if (facing) facePerson(p, facing[0], facing[1], dt);
      else if (m.role === 'lookout') {
        // Watch the nearest enemy, otherwise look out over the bow
        let e = null, ed = 1e9;
        for (const s of G.enemies.ships) if (s.alive) { const dd = s.pos.distanceTo(S.pos); if (dd < ed) { ed = dd; e = s; } }
        if (e) { _a.copy(e.root.position); S.root.worldToLocal(_a); facePerson(p, _a.x - pos.x, _a.z - pos.z, dt, 2); }
        else facePerson(p, 0, -1, dt, 2);
      } else facePerson(p, m.side, 0, dt, 2);
      animatePerson(p, dt, moving, t);
    }
  }
}
