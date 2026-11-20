// Damage to OUR ship that you fix with your own hands, mid-battle:
//   * Leaks: a cannonball punches a hole in the bulwark. Water sprays in, the hull slowly
//     drains and the ship gets sluggish. Three good hammer blows nail planks over it.
//   * Fires: a hit can set the deck alight. Fires grow, then spread, and burn the hull (and
//     anyone standing in them). Dip the bucket in the water tub and tip it over the flames.
//   * Snapped masts: the top of a mast cracks and leans over; the ship loses speed. Hammer
//     a splint onto the break (six blows) and she stands up again.
// The hammer and bucket live at the repair station on the port side, forward of the rack.
//
// Rules (what is broken, how fast it drains) run on the host and go in the snapshot. The
// looks (spray, flames, planks, the leaning mast) are worked out from that state on every
// headset in view(). Players fix things only through G.act() (see actions.js).
import * as THREE from 'three';
import { halfWidth, CANNON_Z, MAST_BREAK_Y } from './ship.js';
import { Kit, COL } from './kit.js';
import { canvasTex, clamp, rand, damp } from './util.js';

// The repair station (ship-local): water tub, hammer peg, bucket hook.
export const TUB = { x: -2.3, z: 3.0, r: 0.36, h: 0.62 };
export const HAMMER_HOME = { x: -2.86, y: 0.98, z: 3.95 };
export const BUCKET_HOME = { x: -2.74, y: 0.98, z: 4.5 };
export const LEAK_BLOWS = 3, MAST_BLOWS = 6;
const MAX_LEAKS = 6, MAX_FIRES = 5, MAX_SCARS = 12;
const MAST_NAMES = { '-1': 'mainmast', '-6.5': 'foremast', '3.3': 'mizzen' };

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ---------- Models (the hand holds the origin, business end toward -Z) ----------
export function buildHammer() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const k = new Kit();
  k.cyl(0.016, 0.019, 0.36, 6, COL.wood, [0, 0, -0.12], [Math.PI / 2, 0, 0]);       // handle
  k.cyl(0.021, 0.021, 0.1, 6, 0x3a2414, [0, 0, 0.02], [Math.PI / 2, 0, 0]);        // leather grip
  k.box(0.04, 0.12, 0.045, COL.iron, [0, 0.0, -0.31]);                               // head
  k.cyl(0.028, 0.028, 0.035, 8, COL.steelDark, [0, 0.075, -0.31]);                   // striking face (up)
  k.box(0.034, 0.06, 0.03, COL.iron, [0, -0.085, -0.3], [0.5, 0, 0]);                // claw
  inner.add(k.mesh());
  return { obj, inner };
}

export function buildBucket() {
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
  const k = new Kit(), cy = -0.13, cz = -0.1; // body centre (below and ahead of the hand)
  k.add(new THREE.CylinderGeometry(0.15, 0.12, 0.26, 10, 1, true), 0x8a5a32, [0, cy, cz]);      // open-topped wall
  k.add(new THREE.CircleGeometry(0.12, 10).rotateX(Math.PI / 2), 0x6a4022, [0, cy - 0.13, cz]); // bottom
  k.add(new THREE.CircleGeometry(0.14, 10).rotateX(-Math.PI / 2), 0x3a2414, [0, cy + 0.06, cz]); // dark inside
  k.add(new THREE.TorusGeometry(0.148, 0.012, 4, 12), 0x6a4022, [0, cy + 0.13, cz], [Math.PI / 2, 0, 0]); // rim
  for (const y of [-0.09, 0.0, 0.1]) k.cyl(0.125 + (y + 0.13) * 0.11, 0.125 + (y + 0.13) * 0.11, 0.025, 10, 0x2e2a28, [0, cy + y, cz]);
  k.tube([[-0.15, cy + 0.12, cz], [-0.1, cy + 0.25, cz], [0, cy + 0.29, cz], [0.1, cy + 0.25, cz], [0.15, cy + 0.12, cz]], 0.008, COL.ironDark, 4);
  inner.add(k.mesh());
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.135, 12).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3f7fa0 }));
  water.position.set(0, cy + 0.09, cz); inner.add(water);
  water.scale.setScalar(1.02);
  const mouth = new THREE.Object3D(); mouth.position.set(0, cy + 0.13, cz); inner.add(mouth);
  return { obj, inner, water, mouth };
}

// A floating sign over each problem, so you can find it from across the deck.
function tagMaterial(title, sub, color) {
  const tex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = 'rgba(20,12,6,0.82)'; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 18); g.fill();
    g.strokeStyle = color; g.lineWidth = 6; g.stroke();
    g.fillStyle = color; g.font = 'bold 50px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, w / 2, 48);
    g.fillStyle = '#fff3cf'; g.font = 'bold 26px Georgia, serif'; g.fillText(sub, w / 2, 94);
  });
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
}

const FLAME_GEO = new THREE.ConeGeometry(0.16, 0.6, 6, 1, true).translate(0, 0.3, 0);
const FLAME_MATS = [0xff5a10, 0xff9a20, 0xffd060].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
const SCORCH_MAT = new THREE.MeshBasicMaterial({ color: 0x140d08, transparent: true, opacity: 0.75, depthWrite: false });
const SCORCH_GEO = new THREE.CircleGeometry(0.7, 10).rotateX(-Math.PI / 2);

export class Damage {
  constructor(G) {
    this.G = G; const S = this.S = G.ship;
    this.leaks = [];   // { id, side, x, y, z, blows, view }
    this.fires = [];   // { id, x, z, heat (0..3), growT, spreadT, view }
    this.masts = S.mastList.map((m, i) => ({ id: `${S.id}/mast:${i}`, z: m.z, r: m.r, name: MAST_NAMES[String(m.z)] || 'mast',
      broken: false, blows: 0, lean: 0, leanDir: 1, leanV: 0, m }));
    this.scars = [];   // patched leaks: planks stay nailed on as a reminder
    this.calmT = 0; this.crewT = 0; this.burnT = 0;
    this.tags = { leak: tagMaterial('LEAK!', 'hammer it shut', '#6cc8ff'), fire: tagMaterial('FIRE!', 'bucket of water', '#ff8a3a'), mast: tagMaterial('MAST!', 'hammer a splint on', '#ffd25a') };
    this.buildStation();
    this.buildMastViews();
  }

  // ---------- Station: tub of water, hammer peg board, bucket hook, sign ----------
  buildStation() {
    const S = this.S, k = new Kit();
    const { x, z, r, h } = TUB;
    k.add(new THREE.CylinderGeometry(r, r * 0.92, h, 12, 1, true), 0x7a5030, [x, h / 2, z]);
    for (const y of [0.1, h - 0.1]) k.cyl(r + 0.012, r + 0.012, 0.04, 12, 0x2e2a28, [x, y, z]);
    k.add(new THREE.TorusGeometry(r - 0.02, 0.03, 4, 14), 0x6a4628, [x, h, z], [Math.PI / 2, 0, 0]);
    // Peg board on the bulwark for the hammer and a hook for the bucket
    const bx = -halfWidth(4.2) * 0.99 + 0.05;
    k.box(0.05, 0.6, 1.0, 0x4a2e18, [bx, 1.0, 4.2]);
    k.cyl(0.015, 0.015, 0.12, 5, COL.iron, [bx + 0.06, 1.12, HAMMER_HOME.z], [0, 0, Math.PI / 2]);
    k.cyl(0.015, 0.015, 0.16, 5, COL.iron, [bx + 0.08, 1.12, BUCKET_HOME.z], [0, 0, Math.PI / 2]);
    const mesh = k.mesh(); S.root.add(mesh);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.01, 14).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3f7fa0 }));
    water.position.set(x, h - 0.06, z); S.root.add(water);
    const signTex = canvasTex(1024, 300, (g, w, hh) => {
      g.fillStyle = '#e8d6a8'; g.fillRect(0, 0, w, hh);
      g.strokeStyle = '#3a2210'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, hh - 14);
      g.fillStyle = '#3a2210'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 92px Georgia, serif'; g.fillText('REPAIRS', w / 2, 82);
      g.font = 'bold 50px Georgia, serif'; g.fillText('Hammer: bang shut leaks, splint masts', w / 2, 170);
      g.fillText('Bucket: dip in the tub, tip over fires', w / 2, 240);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(bx + 0.04, 1.62, 4.2); sign.rotation.y = Math.PI / 2;
    S.root.add(sign);
  }

  // Splintered stump and the splint (planks + rope) that appears as you hammer it on.
  buildMastViews() {
    for (const M of this.masts) {
      const k = new Kit(), B = MAST_BREAK_Y, rr = M.r * 0.95;
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; k.cyl(0.0, 0.05, rand(0.15, 0.32), 3, 0xc8a070, [Math.cos(a) * rr * 0.7, B + 0.1, M.z + Math.sin(a) * rr * 0.7], [rand(-0.3, 0.3), 0, rand(-0.3, 0.3)]); }
      const splinters = k.mesh(); splinters.visible = false; this.S.root.add(splinters);
      const planks = [];
      for (let i = 0; i < MAST_BLOWS; i++) {
        const pk = new Kit(), a = (i / MAST_BLOWS) * Math.PI * 2;
        if (i % 2 === 0) pk.box(0.09, 1.5, 0.04, 0x9a6e40, [0, 0, 0]);
        else for (const y of [-0.45, 0.45]) pk.add(new THREE.TorusGeometry(rr + 0.05, 0.025, 4, 10), 0xb89a66, [0, y, 0], [Math.PI / 2, 0, 0]);
        const p = pk.mesh(); p.visible = false;
        if (i % 2 === 0) { p.position.set(Math.cos(a) * (rr + 0.03), B - 0.15, M.z + Math.sin(a) * (rr + 0.03)); p.rotation.y = -a; }
        else p.position.set(0, B - 0.15, M.z);
        this.S.root.add(p); planks.push(p);
      }
      const tag = new THREE.Sprite(this.tags.mast); tag.scale.set(0.9, 0.45, 1); tag.position.set(0, 3.1, M.z); tag.visible = false; tag.renderOrder = 6;
      this.S.root.add(tag);
      M.view = { splinters, planks, tag };
    }
  }

  byId(id) {
    return this.leaks.find((l) => l.id === id) || this.fires.find((f) => f.id === id) || this.masts.find((m) => m.id === id) || null;
  }

  get anyDamage() { return this.leaks.length > 0 || this.fires.length > 0 || this.masts.some((m) => m.broken); }

  // ---------- Rules ----------
  // An enemy cannonball hit our ship at world position p.
  onHit(p) {
    if (!this.S.alive) return;
    _a.copy(p); this.S.root.worldToLocal(_a);
    if (Math.random() < 0.5) this.springLeak(_a);
    if (Math.random() < 0.2) this.startFire(_a.x * 0.6 + rand(-0.8, 0.8), _a.z + rand(-1, 1));
    if (Math.random() < 0.12) {
      const up = this.masts.filter((m) => !m.broken);
      if (up.length) this.snapMast(up[Math.floor(Math.random() * up.length)]);
    }
  }

  // A hole in the bulwark nearest to the ship-local point l.
  springLeak(l) {
    if (this.leaks.length >= MAX_LEAKS) return null;
    const side = Math.abs(l.x) > 0.3 ? Math.sign(l.x) : (Math.random() < 0.5 ? -1 : 1);
    const free = (z) => z > -8.2 && z < 6.6
      && !CANNON_Z.some((cz) => Math.abs(z - cz) < 0.75)                     // not in a gun port
      && !(side < 0 && z > 2.4 && z < 6.5)                                    // not behind the repair station / rack
      && !this.leaks.some((o) => o.side === side && Math.abs(o.z - z) < 1.3);
    let z = null;
    for (const dz of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) if (free(l.z + dz)) { z = l.z + dz; break; }
    if (z === null) return null;
    const scar = this.scars.findIndex((s) => s.side === side && Math.abs(s.z - z) < 1); // fresh hole over an old patch
    if (scar >= 0) { this.disposeView(this.scars[scar].view); this.scars.splice(scar, 1); }
    const x = side * (halfWidth(z) * 0.99 - 0.04);
    const leak = { id: this.G.ids.next('leak'), side, x, y: rand(0.32, 0.55), z, blows: 0, view: null };
    this.leaks.push(leak);
    this.G.events.emit('leakSprung', { leak, pos: this.S.root.localToWorld(_b.set(x, leak.y, z)), count: this.leaks.length });
    return leak;
  }

  startFire(x, z) {
    if (this.fires.length >= MAX_FIRES) return null;
    z = clamp(z, -8, 6.6); const hw = halfWidth(z) - 0.75; x = clamp(x, -hw, hw);
    if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 1.1)) return null;
    const fire = { id: this.G.ids.next('fire'), x, z, heat: 1, growT: 14, spreadT: 12, view: null };
    this.fires.push(fire);
    this.G.events.emit('fireStarted', { fire, pos: this.S.root.localToWorld(_b.set(x, 0.3, z)), count: this.fires.length });
    return fire;
  }

  snapMast(M) {
    M.broken = true; M.blows = 0; M.leanDir = Math.random() < 0.5 ? -1 : 1; M.leanV = 0;
    this.G.events.emit('mastSnapped', { mast: M, name: M.name, pos: this.S.root.localToWorld(_b.set(0, MAST_BREAK_Y, M.z)) });
  }

  // A hammer blow on a leak or broken mast. Returns 'patched' / 'fixed' / 'hit' / false.
  hammer(player, id) {
    const t = this.byId(id), S = this.S;
    if (!t || !S.alive) return false;
    if (this.leaks.includes(t)) {
      t.blows++;
      const pos = S.root.localToWorld(_b.set(t.x, t.y, t.z));
      if (t.blows < LEAK_BLOWS) { this.G.events.emit('leakHammered', { leak: t, pos, left: LEAK_BLOWS - t.blows, player }); return 'hit'; }
      this.leaks.splice(this.leaks.indexOf(t), 1);
      this.scars.push(t); if (this.scars.length > MAX_SCARS) this.disposeView(this.scars.shift().view);
      S.health = Math.min(S.maxHealth, S.health + 4);
      this.G.events.emit('leakPatched', { leak: t, pos, left: this.leaks.length, player });
      return 'patched';
    }
    if (this.masts.includes(t) && t.broken) {
      t.blows++;
      const pos = S.root.localToWorld(_b.set(0, MAST_BREAK_Y - 0.4, t.z));
      if (t.blows < MAST_BLOWS) { this.G.events.emit('mastHammered', { mast: t, pos, left: MAST_BLOWS - t.blows, player }); return 'hit'; }
      t.broken = false;
      this.G.events.emit('mastRepaired', { mast: t, name: t.name, pos, player });
      return 'fixed';
    }
    return false;
  }

  // Water thrown at ship-local (x, z). Returns how many fires it reached.
  douse(x, z) {
    let n = 0;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (Math.hypot(f.x - x, f.z - z) > 1.5 + f.heat * 0.15) continue;
      n++; f.heat -= 1.6; f.growT = 14; f.spreadT = 12;
      const pos = this.S.root.localToWorld(_b.set(f.x, 0.3, f.z));
      if (f.heat <= 0.05) { this.fires.splice(i, 1); this.disposeView(f.view); this.G.events.emit('fireDoused', { fire: f, pos, left: this.fires.length }); }
      else this.G.events.emit('fireShrunk', { fire: f, pos });
    }
    return n;
  }

  // Can this ship-local point be reached for a hammer blow? Returns the target or null.
  // reach: how close the hammer head must be (m).
  hammerTarget(l, reach = 0.32) {
    let best = null, bd = reach;
    for (const k of this.leaks) { const d = Math.hypot(l.x - k.x, l.y - k.y, l.z - k.z); if (d < bd) { bd = d; best = k; } }
    for (const M of this.masts) {
      if (!M.broken || l.y < 0.7 || l.y > MAST_BREAK_Y + 0.5) continue;
      const d = Math.hypot(l.x, l.z - M.z) - M.r;
      if (d < bd) { bd = d; best = M; }
    }
    return best;
  }

  step(dt) {
    const G = this.G, S = this.S;
    if (!S.alive) return;
    // Hull drains: each leak a little, each fire by how hot it burns
    let drain = this.leaks.length * 0.2;
    for (const f of this.fires) drain += 0.22 * f.heat;
    if (drain > 0) S.damage(drain * dt);
    // Speed: water in the hold and snapped masts slow her down
    let mul = Math.max(0.65, 1 - this.leaks.length * 0.06);
    for (const M of this.masts) if (M.broken) mul *= 0.6;
    S.speedMul = Math.max(0.3, mul);
    // Fires grow, then spread
    for (const f of [...this.fires]) {
      f.growT -= dt;
      if (f.growT <= 0 && f.heat < 3) { f.heat = Math.min(3, f.heat + 1); f.growT = 14; }
      if (f.heat >= 3) {
        f.spreadT -= dt;
        if (f.spreadT <= 0) {
          f.spreadT = 12; const a = rand(0, Math.PI * 2);
          if (this.startFire(f.x + Math.cos(a) * 1.4, f.z + Math.sin(a) * 1.4)) G.events.emit('fireSpread', {});
        }
      }
    }
    // Standing in the flames hurts
    this.burnT -= dt;
    if (this.burnT <= 0 && this.fires.length) {
      this.burnT = 0.5;
      for (const pl of G.players) {
        if (pl.dead || pl.ship !== S) continue;
        if (this.fires.some((f) => Math.hypot(pl.headLocal.x - f.x, pl.headLocal.z - f.z) < 0.35 + f.heat * 0.15)) G.hurtPlayer(pl, 5);
      }
    }
    // No enemy near: the crew patch things up and the carpenter mends the hull, slowly
    const calm = !G.enemies.ships.some((e) => e.alive && e.pos.distanceTo(S.pos) < 200);
    this.calmT = calm ? this.calmT + dt : 0;
    if (this.calmT > 6) {
      this.crewT -= dt;
      if (this.crewT <= 0) {
        this.crewT = 5;
        if (this.fires.length) this.douse(this.fires[0].x, this.fires[0].z);
        else if (this.leaks.length) { const l = this.leaks[0]; l.blows = LEAK_BLOWS - 1; this.hammer(null, l.id); G.events.emit('crewRepaired', { what: 'leak' }); }
        else { const M = this.masts.find((m) => m.broken); if (M) { M.blows = MAST_BLOWS - 1; this.hammer(null, M.id); } }
      }
      if (!this.anyDamage) S.health = Math.min(S.maxHealth, S.health + dt * 0.8);
    } else this.crewT = 3;
  }

  reset() {
    for (const l of [...this.leaks, ...this.scars]) this.disposeView(l.view);
    for (const f of this.fires) this.disposeView(f.view);
    this.leaks = []; this.scars = []; this.fires = [];
    for (const M of this.masts) { M.broken = false; M.blows = 0; M.lean = 0; M.leanV = 0; }
    this.S.speedMul = 1; this.calmT = 0;
  }

  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      leaks: this.leaks.map((l) => ({ id: l.id, side: l.side, x: r2(l.x), y: r2(l.y), z: r2(l.z), blows: l.blows })),
      fires: this.fires.map((f) => ({ id: f.id, x: r2(f.x), z: r2(f.z), heat: r2(f.heat) })),
      masts: this.masts.map((M) => ({ id: M.id, broken: M.broken, blows: M.blows })),
      speedMul: r2(this.S.speedMul),
    };
  }

  // ---------- Looks (every headset) ----------
  disposeView(v) {
    if (!v) return;
    v.group.parent?.remove(v.group);
    v.group.traverse((o) => {
      if (o.geometry && o.geometry !== FLAME_GEO && o.geometry !== SCORCH_GEO) o.geometry.dispose();
      if (o === v.glow) o.material.dispose();
    });
  }

  leakView(l) {
    const g = new THREE.Group(), k = new Kit(), s = l.side;
    // Ragged dark hole with splinters round it, on the inside of the bulwark
    k.add(new THREE.CircleGeometry(0.2, 7), 0x0d0805, [0, 0, 0], [0, -s * Math.PI / 2, 0], [1, 0.8, 1]);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.cyl(0, 0.035, rand(0.12, 0.22), 3, 0xc8a070, [-s * 0.02, Math.sin(a) * 0.17, Math.cos(a) * 0.2], [Math.cos(a) * 1.4, 0, -Math.sin(a) * 1.4]); }
    const hole = k.mesh(); g.add(hole);
    // Planks nailed over it, one per blow
    const planks = [];
    for (let i = 0; i < LEAK_BLOWS; i++) {
      const pk = new Kit(), rz = [0.25, -0.3, 0][i], y = [0.05, -0.05, 0][i];
      pk.box(0.035, 0.11, 0.55, 0x9a6e40, [0, 0, 0]);
      for (const zz of [-0.22, 0.22]) pk.cyl(0.012, 0.012, 0.04, 4, 0x2a2c31, [-s * 0.02, 0, zz], [0, 0, Math.PI / 2]);
      const p = pk.mesh(); p.position.set(-s * (0.03 + i * 0.012), y, 0); p.rotation.x = rz; p.visible = false; g.add(p); planks.push(p);
    }
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.55, 10).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a7f92, transparent: true, opacity: 0.55, depthWrite: false }));
    puddle.position.set(-s * 0.6, -l.y + 0.03, 0); puddle.scale.setScalar(0.1); g.add(puddle);
    const tag = new THREE.Sprite(this.tags.leak); tag.scale.set(0.8, 0.4, 1); tag.position.set(-s * 0.35, 1.0, 0); tag.renderOrder = 6; g.add(tag);
    g.position.set(l.x, l.y, l.z);
    this.S.root.add(g);
    return { group: g, planks, puddle, tag, sprayT: 0 };
  }

  fireView(f) {
    const g = new THREE.Group();
    const scorch = new THREE.Mesh(SCORCH_GEO, SCORCH_MAT); scorch.position.y = 0.035; g.add(scorch);
    const flames = [];
    for (let i = 0; i < 7; i++) {
      const fl = new THREE.Mesh(FLAME_GEO, FLAME_MATS[i % 3]);
      const a = (i / 7) * Math.PI * 2, r = i === 0 ? 0 : rand(0.15, 0.4);
      fl.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r); fl.userData.ph = rand(0, 6); fl.userData.s = i === 0 ? 1.4 : rand(0.6, 1.1);
      g.add(fl); flames.push(fl);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.G.fx.tex, color: 0xff7a20, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.35; g.add(glow);
    const tag = new THREE.Sprite(this.tags.fire); tag.scale.set(0.8, 0.4, 1); tag.position.y = 1.9; tag.renderOrder = 6; g.add(tag);
    g.position.set(f.x, 0, f.z);
    this.S.root.add(g);
    return { group: g, flames, glow, tag, smokeT: 0, crackT: rand(0.2, 1), heat: 0 };
  }

  view(dt) {
    const G = this.G, S = this.S, t = G.t, fx = G.fx;
    G.camera.getWorldPosition(_a); S.root.worldToLocal(_a); const eye = _a.clone();
    const tagOn = (tag, x, z) => { const d = Math.hypot(eye.x - x, eye.z - z); tag.visible = d > 1.2; tag.material.opacity = 0.75 + Math.sin(t * 5) * 0.25; };
    // Leaks: water spurting in, a puddle spreading, planks going on
    for (const l of this.leaks) {
      const v = l.view || (l.view = this.leakView(l));
      for (let i = 0; i < LEAK_BLOWS; i++) v.planks[i].visible = i < l.blows;
      v.puddle.scale.setScalar(Math.min(1, v.puddle.scale.x + dt * 0.08));
      tagOn(v.tag, l.x, l.z);
      v.sprayT -= dt;
      if (S.alive && v.sprayT <= 0) {
        v.sprayT = 0.05 + l.blows * 0.06;
        const s = l.side, sp = 1 - l.blows / LEAK_BLOWS;
        _b.set(l.x - s * 0.05, l.y + rand(-0.06, 0.06), l.z + rand(-0.08, 0.08)); S.root.localToWorld(_b);
        const dir = new THREE.Vector3(-s * rand(1.6, 2.6) * (0.4 + sp), rand(0.6, 1.6), rand(-0.4, 0.4)).applyQuaternion(S.root.quaternion);
        fx.emit(_b, { vel: dir, life: rand(0.35, 0.6), s0: 0.07, s1: 0.2, color: 0xe4f2ff, grav: 9, alpha: 0.85 });
      }
    }
    for (const sc of this.scars) if (sc.view) { for (const p of sc.view.planks) p.visible = true; sc.view.tag.visible = false; sc.view.puddle.scale.setScalar(Math.max(0.01, sc.view.puddle.scale.x - dt * 0.05)); }
    // Fires: flickering flames sized by heat, smoke, crackling
    for (const f of this.fires) {
      const v = f.view || (f.view = this.fireView(f));
      v.heat = damp(v.heat, f.heat, 3, dt);
      const hs = 0.45 + v.heat * 0.45;
      v.flames.forEach((fl, i) => {
        const fl2 = 0.75 + 0.35 * Math.sin(t * (9 + i) + fl.userData.ph) * Math.sin(t * 5.3 + i);
        fl.scale.set(hs * (0.8 + 0.2 * fl2), hs * fl.userData.s * fl2, hs * (0.8 + 0.2 * fl2));
        fl.rotation.y = t * (1 + i * 0.3);
      });
      v.group.children[0].scale.setScalar(0.6 + v.heat * 0.35); // scorch mark
      v.glow.scale.setScalar((1 + v.heat * 0.8) * (0.9 + 0.1 * Math.sin(t * 13)));
      v.tag.position.y = 1.2 + v.heat * 0.5; tagOn(v.tag, f.x, f.z);
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.25 / v.heat;
        _b.set(f.x + rand(-0.3, 0.3), 0.5 + v.heat * 0.4, f.z + rand(-0.3, 0.3)); S.root.localToWorld(_b);
        fx.emit(_b, { vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3)), life: rand(1.6, 2.6), s0: 0.4, s1: rand(1.6, 2.6) * (0.6 + v.heat * 0.3), color: new THREE.Color().setHSL(0, 0, rand(0.18, 0.3)), drag: 0.6, alpha: 0.55 });
        if (Math.random() < 0.5) fx.sparks(_b, 1, 0.08);
      }
      v.crackT -= dt;
      if (v.crackT <= 0) { v.crackT = rand(0.3, 0.9) / v.heat; _b.set(f.x, 0.4, f.z); S.root.localToWorld(_b); G.audio.crackle?.(_b, 0.4 + v.heat * 0.2); }
    }
    // Masts: fall over when snapped, come back up a little with every blow, spring up when fixed
    let moved = false;
    for (const M of this.masts) {
      const grp = M.m.group; if (!grp) continue;
      const target = M.broken ? 0.34 * (1 - 0.5 * M.blows / MAST_BLOWS) : 0;
      if (Math.abs(M.lean - target) > 1e-4 || M.leanV) {
        if (M.lean < target) { M.leanV += dt * 1.4; M.lean = Math.min(target, M.lean + M.leanV * dt); if (M.lean >= target) M.leanV = 0; } // falling: speeds up
        else { M.leanV = 0; M.lean = damp(M.lean, target, 3, dt); }
        grp.rotation.set(M.lean * 0.25, 0, M.leanDir * M.lean);
        grp.updateMatrix(); moved = true;
      }
      M.view.splinters.visible = M.broken;
      M.view.planks.forEach((p, i) => { p.visible = M.broken ? i < M.blows : M.blows >= MAST_BLOWS; });
      M.view.tag.visible = M.broken && Math.hypot(eye.x, eye.z - M.z) > 1.2;
      if (M.broken) M.view.tag.material.opacity = 0.75 + Math.sin(t * 5) * 0.25;
    }
    if (moved) S.updateRig();
  }
}
