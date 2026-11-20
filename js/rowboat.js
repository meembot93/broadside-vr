// The longboat and the rope ladder for treasure hunts (island.js owns one of these).
//
// At anchor a rope ladder hangs over our ship's side, facing the island, with the longboat
// tied up at its foot. Climb down (VR: GRIP the rungs and pull, or TRIGGER on the ladder to
// climb by itself; desktop: click the ladder), row to the beach (VR: GRIP the oars and pull
// them toward you, or push the left stick; desktop: W / A / D), walk off the bow, and come
// back the same way. With nobody aboard her, a boatman brings the boat to whoever is waiting.
//
// The boat is a "frame" like a ship: a player in her has player.ship === boat.frame and
// stands in her local space (floor at y = 0, bow toward -z). Changing frame (ladder <-> boat
// <-> beach) happens on your own headset; the host learns it from your pose, like crossing
// onto an enemy deck. Only her motion is the host's: rowing is sent as 'row' actions and
// her position goes out in the island's snapshot.
import * as THREE from 'three';
import { landHeight } from './land.js';
import { waveHeight } from './waves.js';
import { hullX, halfWidth, railHeight, BOW, STERN } from './ship.js';
import { makePerson, animatePerson } from './people.js';
import { Kit } from './kit.js';
import { angleWrap, clamp, damp } from './util.js';

export const LADDER_Z = 2.6;                 // ship-local z of the ladder (aft of the guns)
const HALF = 3.1;                            // half the boat's length
const SEAT_Z = [0.55, -0.85, 1.75, -2.05];   // where players sit (player 0..3); the first two have oars
const CREW_SPOT = [[-0.33, 2.62], [0.33, 2.62]]; // Mags and Rosa in the stern sheets
const LOW = -1.45;                           // ladder foot (ship-local y)
const STATES = ['moored', 'free', 'beached', 'pushoff'];
export const halfBeam = (z) => { const u = clamp(z / HALF, -1, 1); return 0.86 * (1 - (u < 0 ? 0.97 : 0.42) * u * u); };
const sheer = (z) => { const u = clamp(z / HALF, -1, 1); return 0.5 + 0.13 * u * u + (u < 0 ? 0.1 * u * u * u * u : 0); };
const keelY = (z) => { const u = clamp(z / HALF, -1, 1); return -0.3 + 0.1 * u * u + (u < 0 ? 0.22 * u * u * u * u : 0); };
const OARLOCK = (i) => { const z = SEAT_Z[i] - 0.55; return { z, y: sheer(z) + 0.06, x: halfBeam(z) - 0.02 }; };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;

// ---------- Models ----------
function buildHull() {
  // A lofted clinker-ish hull: three strakes a side, a square transom, tarred bottom
  const pos = [], col = [], c = new THREE.Color();
  const tri = (a, b, d, hex) => { pos.push(...a, ...b, ...d); c.setHex(hex); for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b); };
  const quad = (a, b, d, e, hex) => { tri(a, b, d, hex); tri(a, d, e, hex); };
  const sec = (z, s) => { const w = halfBeam(z), k = keelY(z); return [[s * w, sheer(z), z], [s * w * 0.99, 0.2, z], [s * w * 0.8, (0.2 + k) / 2 - 0.04, z], [s * 0.05, k, z]]; };
  const STRAKE = [0x7a4f2c, 0x6a4326, 0x2a1d14];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const z0 = -HALF + (2 * HALF * i) / N, z1 = -HALF + (2 * HALF * (i + 1)) / N;
    for (const s of [-1, 1]) {
      const A = sec(z0, s), B = sec(z1, s);
      for (let j = 0; j < 3; j++) quad(A[j], B[j], B[j + 1], A[j + 1], STRAKE[j]);
    }
    const A = sec(z0, 1), B = sec(z1, 1);
    quad([-A[3][0], A[3][1], z0], [-B[3][0], B[3][1], z1], B[3], A[3], 0x2a1d14); // keel strip
  }
  // Transom
  const P = sec(HALF, 1), M = sec(HALF, -1), mid = [0, (sheer(HALF) + keelY(HALF)) / 2, HALF];
  const ring = [...P, ...M.slice().reverse()];
  for (let j = 0; j < ring.length; j++) tri(mid, ring[j], ring[(j + 1) % ring.length], 0x5d3b22);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  // Fittings: floorboards, thwarts, gunwale caps, oarlocks, a painter (bow rope)
  const k = new Kit();
  for (let z = -2.3; z < 2.8; z += 0.42) k.box(halfBeam(z) * 1.25, 0.04, 0.4, 0x8d6a42, [0, 0, z]);
  for (const z of SEAT_Z) k.box(halfBeam(z) * 1.94, 0.06, 0.26, 0x9a7448, [0, 0.36, z]);
  k.box(halfBeam(2.62) * 1.9, 0.06, 0.5, 0x9a7448, [0, 0.36, 2.62]);
  for (const s of [-1, 1]) {
    const pts = []; for (let z = -HALF + 0.05; z <= HALF + 0.001; z += 0.31) pts.push([s * halfBeam(z), sheer(z) + 0.02, z]);
    k.tube(pts, 0.04, 0x4a2e1a, 4);
    for (let i = 0; i < 2; i++) { const o = OARLOCK(i); k.box(0.05, 0.12, 0.05, 0x2a2c31, [s * o.x, o.y, o.z - 0.06]); k.box(0.05, 0.12, 0.05, 0x2a2c31, [s * o.x, o.y, o.z + 0.06]); }
  }
  k.box(0.1, 0.16, 0.14, 0x4a2e1a, [0, sheer(-HALF) + 0.04, -HALF + 0.12]); // stem head
  k.cyl(0.18, 0.18, 0.08, 10, 0xb89a6a, [0, 0.05, -1.55]);                 // coil of rope
  const g2 = new THREE.Group(); g2.add(mesh, k.mesh());
  return g2;
}

function buildOar() {
  // Along +x: handle at -0.6, oarlock at 0, blade out at +1.8..2.4
  const k = new Kit();
  k.cyl(0.024, 0.024, 2.45, 6, 0xb08a5a, [0.6, 0, 0], [0, 0, Math.PI / 2]);
  k.cyl(0.03, 0.03, 0.22, 6, 0x5a3a22, [-0.5, 0, 0], [0, 0, Math.PI / 2]);
  k.box(0.62, 0.025, 0.15, 0xc09a68, [2.1, 0, 0]);
  return k.mesh();
}

function buildLadder(side) {
  // Two side ropes over the rail and down the hull, with wooden rungs, hooked over the rail
  const k = new Kit(), z0 = LADDER_Z - 0.23, z1 = LADDER_Z + 0.23, rh = railHeight(LADDER_Z), hw = halfWidth(LADDER_Z);
  const xs = (y) => side * (hullX(LADDER_Z, Math.min(y, -0.01)) + 0.06);
  for (const z of [z0, z1]) {
    const pts = [[side * (hw - 0.12), rh - 0.25, z], [side * (hw - 0.05), rh + 0.08, z], [side * (hw + 0.14), rh + 0.06, z]];
    for (let y = rh - 0.2; y > LOW; y -= 0.3) pts.push([y > 0 ? side * (hw + 0.14 + (rh - y) * 0.02) : xs(y), y, z]);
    pts.push([xs(LOW), LOW, z]);
    k.tube(pts, 0.022, 0xc8b080, 4);
  }
  for (let y = rh - 0.3; y > LOW + 0.05; y -= 0.3) k.box(0.05, 0.045, 0.5, 0x8a6a40, [(y > 0 ? side * (hw + 0.16 + (rh - y) * 0.02) : xs(y)) + side * 0.03, y, LADDER_Z]);
  for (const z of [z0, z1]) k.box(0.2, 0.05, 0.06, 0x2a2c31, [side * (hw - 0.02), rh + 0.05, z]);
  return k.mesh();
}

export class Rowboat {
  constructor(G, island) {
    this.G = G; this.island = island;
    const root = new THREE.Group(); root.rotation.order = 'YXZ'; G.scene.add(root); root.visible = false;
    this.frame = { id: 'boat', isBoat: true, root, cannons: [], crew: [], covers: [], alive: true, pos: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0, heading: 0 };
    root.add(buildHull());
    this.oars = [];
    for (let i = 0; i < 2; i++) for (const s of [-1, 1]) {
      const o = OARLOCK(i), pivot = new THREE.Group(); pivot.position.set(s * o.x, o.y, o.z); root.add(pivot);
      const m = buildOar(); pivot.add(m);
      this.oars.push({ seat: i, side: s, pivot, mesh: m, held: null, dir: new THREE.Vector3(s, 0.3, 0.6).normalize() });
    }
    // The boatman who brings her over when nobody's aboard
    this.boatman = makePerson({ type: 'sailor', seed: 4242, cutlass: false });
    root.add(this.boatman.g); this.boatman.g.position.set(0, -0.37, SEAT_Z[0]); this.boatman.g.visible = false;
    this.side = 1; this.reset();
    this.ladder = null; this.ladderSide = 0;
    this.rowAcc = { f: 0, t: 0, at: 0 }; // our own rowing, sent a few times a second
  }

  reset() {
    this.active = false; this.state = 'moored'; this.from = 'ship';
    this.x = 0; this.z = 0; this.h = 0; this.v = 0; this.w = 0; this.ferry = false;
    this.inF = 0; this.inT = 0; this.turnT = 9; this.rowT = 9; this.pushT = 0; this.castT = 0;
    this.moorRiders = new Set(); this.boardT = 0; this.manualT = 9; this.bmSeat = 0;
    this.rx = null;
  }

  // ================= RULES (host) =================
  // The ship has anchored: tie the boat up under the ladder on the side facing the island
  launch(side) {
    this.reset(); this.active = true; this.side = side;
    const m = this.moorPose(); this.x = m.x; this.z = m.z; this.h = m.h;
  }
  stow() { this.reset(); }

  // Where she lies when tied up (world x, z and heading)
  moorPose(out = {}) {
    const S = this.G.ship, mx = this.side * (hullX(LADDER_Z, -0.6) + 0.92);
    S.localToWorldXZ(mx, LADDER_Z, _a);
    out.x = _a.x; out.z = _a.z; out.h = S.heading; return out;
  }
  fwd(h = this.h) { return [-Math.sin(h), -Math.cos(h)]; }
  riders() { return this.G.players.filter((pl) => pl.ship === this.frame); }

  // A player rowing: f = forward strokes, t = turn (+ = to the right)
  row(pl, a) {
    if (!this.active || pl.ship !== this.frame) return false;
    this.inF += clamp(+a.f || 0, -2, 3); this.inT += clamp(+a.t || 0, -2, 2);
    return true;
  }

  update(dt) {
    if (!this.active) return;
    const G = this.G, S = G.ship, I = this.island, s = I.site;
    let f = this.inF, t = this.inT; this.inF = 0; this.inT = 0;
    const riders = this.riders().length;
    this.ferry = false;
    // Nobody aboard: the boatman brings her to whoever is waiting for her
    if (!riders && s?.lx !== undefined) {
      const waitShip = G.players.some((pl) => pl.ship === S && !pl.dead && Math.hypot(pl.headLocal.x - this.side * 2.6, pl.headLocal.z - LADDER_Z) < 3.2);
      const waitShore = I.playersAshore().length > 0;
      const goShore = !waitShip && waitShore;
      if ((goShore && this.state !== 'beached') || (!goShore && this.state !== 'moored')) {
        this.ferry = true;
        if (this.state === 'beached') { this.state = 'pushoff'; this.pushT = 0; }
        if (this.state === 'moored') { this.state = 'free'; this.from = 'ship'; this.castT = 0; }
        const tx = goShore ? s.lx : this.moorPose(_c).x, tz = goShore ? s.lz : _c.z;
        const want = Math.atan2(-(tx - this.x), -(tz - this.z));
        this.h += clamp(angleWrap(want - this.h), -1.2 * dt, 1.2 * dt);
        f = 1.1 * dt; t = 0; this.turnT = 9; this.from = goShore ? 'ship' : 'beach';
      }
    }
    // Someone aboard: the boatman rows for them, unless they're rowing themselves
    if (riders && s?.lx !== undefined) {
      const ids = this.riders().map((pl) => pl.id);
      this.manualT = Math.abs(f) > 0.02 || Math.abs(t) > 0.01 ? 0 : this.manualT + dt;
      if (this.state === 'moored') {
        // Somebody new came down the ladder and sat: after a moment he casts off for the beach
        this.boardT = ids.some((id) => !this.moorRiders.has(id)) ? this.boardT + dt : 0;
        if (this.boardT > 1.5) {
          this.boardT = 0; this.mooredT = 0; this.state = 'free'; this.from = 'ship'; this.castT = 0; this.v = 0.6; this.manualT = 9;
          this.G.events.emit('boatCastOff', { pos: this.worldPos(), auto: true });
        }
      }
      if (this.state === 'free' && this.manualT > 1.5) {
        this.ferry = true;
        const m = this.moorPose(_c), tx = this.from === 'ship' ? s.lx : m.x, tz = this.from === 'ship' ? s.lz : m.z;
        const want = Math.atan2(-(tx - this.x), -(tz - this.z));
        this.h += clamp(angleWrap(want - this.h), -1.2 * dt, 1.2 * dt);
        f = 1.1 * dt; t = 0; this.turnT = 9;
      }
      // He sits on a bench nobody is using
      const used = new Set(this.riders().map((pl) => this.seatOf(pl)));
      this.bmSeat = [0, 1, 2, 3].find((i) => !used.has(i)) ?? -1;
    } else { this.boardT = 0; this.manualT = 9; this.bmSeat = 0; }
    if (f > 0.02) this.rowT = 0; else this.rowT += dt;
    if (Math.abs(t) > 0.01) this.turnT = 0; else this.turnT += dt;

    if (this.state === 'moored') {
      const m = this.moorPose(_c); this.x = m.x; this.z = m.z; this.h = m.h; this.v = 0; this.w = 0;
      this.mooredT = (this.mooredT || 0) + dt;
      if (f > 0.05 && this.mooredT > 2.5) { this.mooredT = 0; this.state = 'free'; this.from = 'ship'; this.castT = 0; this.v = 0.6; this.G.events.emit('boatCastOff', { pos: this.worldPos() }); }
      return;
    }
    if (this.state === 'beached') {
      this.v = 0; this.w = 0; this.beachT = (this.beachT || 0) + dt;
      // Everyone's in and nobody's left ashore: the crew shove off by themselves
      if (I.playersAshore().length) this.landed = true;
      this.waitT = this.landed && riders && !I.playersAshore().length ? (this.waitT || 0) + dt : 0;
      if ((f > 0.05 && this.beachT > 1.5) || this.waitT > 2.5) { this.state = 'pushoff'; this.pushT = 0; this.waitT = 0; this.landed = false; }
      return;
    }
    if (this.state === 'pushoff') {
      // The crew shove her off the sand and swing her round for the ship
      this.pushT += dt; this.v = -1.4; this.from = 'beach';
      const m = this.moorPose(_c), want = Math.atan2(-(m.x - this.x), -(m.z - this.z));
      this.h += clamp(angleWrap(want - this.h), -1.9 * dt, 1.9 * dt);
      if (this.pushT > 2.2) { this.state = 'free'; this.castT = 0; this.v = 0.3; }
      this.move(dt);
      return;
    }
    // Free: oars and the boatman drive her
    this.castT += dt;
    this.v += f * 0.95; this.w -= t * 0.9;
    // A light hand on the tiller: while you row straight she heads for the beach (or the ship)
    if (this.rowT < 1 && this.turnT > 0.8 && s?.lx !== undefined) {
      const m = this.moorPose(_c), tx = this.from === 'ship' ? s.lx : m.x, tz = this.from === 'ship' ? s.lz : m.z;
      const want = Math.atan2(-(tx - this.x), -(tz - this.z));
      this.h += angleWrap(want - this.h) * (1 - Math.exp(-0.7 * dt));
    }
    this.v *= Math.exp(-0.42 * dt); this.w *= Math.exp(-2.6 * dt);
    this.v = clamp(this.v, -1.6, 5); this.w = clamp(this.w, -0.9, 0.9);
    this.h += this.w * dt;
    this.move(dt);
    // Ran up the beach
    const [fx, fz] = this.fwd();
    if (this.v > 0 && landHeight(this.x + fx * HALF, this.z + fz * HALF) > 0.2) {
      this.state = 'beached'; this.from = 'beach'; this.v = 0; this.w = 0; this.beachT = 0;
      this.G.events.emit('boatBeached', { pos: this.worldPos() });
    }
    // Back alongside the ship
    const m = this.moorPose(_c);
    if (this.castT > (this.from === 'beach' ? 4 : 15) && Math.hypot(m.x - this.x, m.z - this.z) < 6.5) {
      this.state = 'moored'; this.from = 'ship'; this.v = 0; this.mooredT = 0;
      this.moorRiders = new Set(this.riders().map((pl) => pl.id)); // they came back to climb up, not to go again
      this.G.events.emit('boatMoored', { pos: this.worldPos() });
    }
  }

  move(dt) {
    const [fx, fz] = this.fwd(), S = this.G.ship;
    let nx = this.x + fx * this.v * dt, nz = this.z + fz * this.v * dt;
    // The stern can't back up onto the sand
    if (this.v < 0 && landHeight(nx - fx * HALF, nz - fz * HALF) > 0) { this.v = 0; nx = this.x; nz = this.z; }
    // Bump off our hull instead of sailing through it
    const c = Math.cos(S.heading), sn = Math.sin(S.heading), dx = nx - S.pos.x, dz = nz - S.pos.z;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    if (lz > BOW - 1.5 && lz < STERN + 1) {
      const need = halfWidth(clamp(lz, BOW, STERN)) + 1.05;
      if (Math.abs(lx) < need) { const px = Math.sign(lx || this.side) * need; nx = S.pos.x + px * c + lz * sn; nz = S.pos.z - px * sn + lz * c; this.v *= 0.5; }
    }
    this.x = nx; this.z = nz;
  }

  worldPos() { return new THREE.Vector3(this.x, 0.4, this.z); }

  // Mags and Rosa ride in the stern sheets (crew.js asks each frame)
  crewSit(m) {
    const i = Math.max(0, ['Mags', 'Rosa'].indexOf(m.name));
    if (m.p.g.parent !== this.frame.root) this.frame.root.add(m.p.g);
    m.p.g.position.set(CREW_SPOT[i][0], -0.37, CREW_SPOT[i][1]); m.p.g.rotation.set(0, 0, 0);
    m.p.pose = 'sit'; m.p.sword.visible = false;
    return true;
  }

  // ================= MULTIPLAYER =================
  snap() { return this.active ? [r2(this.x), r2(this.z), r3(this.h), STATES.indexOf(this.state), r2(this.v), this.ferry ? 1 : 0, this.side, this.bmSeat] : null; }
  applySnap(a) {
    if (!a) { if (this.active) this.reset(); return; }
    if (!this.active) { this.active = true; this.rx = null; }
    this.net = { x: a[0], z: a[1], h: a[2], at: performance.now() / 1000 };
    this.state = STATES[a[3]] || 'free'; this.v = a[4]; this.ferry = !!a[5]; this.side = a[6]; this.bmSeat = a[7] ?? 0;
  }

  // ================= LOOKS + YOUR OWN BODY (every headset) =================
  view(dt) {
    const G = this.G, S = G.ship, root = this.frame.root, t = G.t;
    this.syncLadder();
    root.visible = this.active;
    if (!this.active) return;
    // Where she should be drawn
    let tx = this.x, tz = this.z, th = this.h;
    if (this.state === 'moored') { const m = this.moorPose(_c); tx = m.x; tz = m.z; th = m.h; }
    else if (!G.isHost && this.net) {
      const age = Math.min(0.4, performance.now() / 1000 - this.net.at), [fx, fz] = this.fwd(this.net.h);
      tx = this.net.x + fx * this.v * age; tz = this.net.z + fz * this.v * age; th = this.net.h;
    }
    if (this.rx === null) { this.rx = tx; this.rz = tz; this.rh = th; }
    const k = this.state === 'moored' ? 10 : G.isHost ? 14 : 6;
    this.rx = damp(this.rx, tx, k, dt); this.rz = damp(this.rz, tz, k, dt); this.rh += angleWrap(th - this.rh) * (1 - Math.exp(-k * dt));
    const [fx, fz] = this.fwd(this.rh);
    let y, pitch, roll;
    if (this.state === 'beached') { y = Math.max(0.12, landHeight(this.rx, this.rz) + 0.3); pitch = 0.06; roll = 0; }
    else {
      const hb = waveHeight(this.rx + fx * 2.4, this.rz + fz * 2.4, t), hs = waveHeight(this.rx - fx * 2.4, this.rz - fz * 2.4, t);
      const hl = waveHeight(this.rx - fz * 0.8, this.rz + fx * 0.8, t), hr = waveHeight(this.rx + fz * 0.8, this.rz - fx * 0.8, t);
      y = (hb + hs + hl + hr) / 4 * 0.9 + 0.1; pitch = Math.atan2(hb - hs, 4.8) * 0.6; roll = Math.atan2(hl - hr, 1.6) * 0.25;
    }
    root.position.set(this.rx, y, this.rz); root.rotation.set(pitch, this.rh, roll);
    root.updateMatrixWorld(true);
    this.frame.pos.set(this.rx, 0, this.rz); this.frame.heading = this.rh;
    // The boatman, the oars
    const bm = this.boatman; bm.g.visible = this.ferry && this.bmSeat >= 0; bm.pose = 'row';
    if (this.bmSeat >= 0) bm.g.position.z = SEAT_Z[this.bmSeat];
    if (this.ferry) animatePerson(bm, dt, false, t);
    const stroking = this.ferry || this.riders().some((pl) => pl !== G.player) && Math.abs(this.v) > 0.4 || this.stickT > 0;
    this.stickT = Math.max(0, (this.stickT || 0) - dt);
    for (const o of this.oars) {
      if (!o.held) {
        if (stroking && (o.seat === 0 || this.riders().length > 1)) {
          const ph = t * 4.2, sw = Math.sin(ph) * 0.55, dip = Math.cos(ph) > 0 ? -0.28 : 0.12;
          o.dir.set(o.side * Math.cos(sw), dip, Math.sin(sw) * 0.9).normalize();
        } else o.dir.lerp(_a.set(o.side * 0.55, 0.32, 0.75).normalize(), Math.min(1, dt * 3)).normalize();
      }
      o.pivot.quaternion.setFromUnitVectors(X_AXIS, o.dir);
    }
    if (this.splashT === undefined) this.splashT = 0;
    if ((this.splashT -= dt) < 0 && Math.abs(this.v) > 1 && this.state === 'free') {
      this.splashT = 0.45;
      G.fx.splash?.(_a.set(this.rx + fx * HALF, 0.1, this.rz + fz * HALF), 0.15);
    }
  }

  // The ladder mesh hangs on our ship whenever the boat is out
  syncLadder() {
    const want = this.active ? this.side : 0;
    if (want === this.ladderSide) return;
    if (this.ladder) { this.ladder.removeFromParent(); this.ladder.geometry.dispose(); this.ladder = null; }
    this.ladderSide = want;
    if (want) { this.ladder = buildLadder(want); this.G.ship.root.add(this.ladder); }
  }

  // Ladder geometry (ship-local): the climber's head column, and the ladder top on deck
  colX(y) { return this.side * (hullX(LADDER_Z, clamp(y - 0.5, LOW, -0.01)) + 0.42); }
  topSpot() { return { x: this.side * (halfWidth(LADDER_Z) - 0.75), z: LADDER_Z }; }
  boatFloorY() { this.frame.root.getWorldPosition(_b); return this.G.ship.root.worldToLocal(_b).y; }
  canClimbDown() { return this.active && this.state === 'moored'; }
  // Sit riders down on the thwart: the head about 1.05 m over the boat floor, however tall you stand
  seatDrop() { return clamp(1.05 - this.G.camera.position.y, -0.75, 0); }

  // VR hands: the ladder (on deck or from the boat) and the oars (in the boat)
  targets(P, hand, consider) {
    if (!this.active || P.dead) return;
    const G = this.G, S = G.ship;
    if (P.ship === S || (P.ship === this.frame && this.state === 'moored')) {
      _b.copy(hand); S.root.worldToLocal(_b);
      const y = clamp(_b.y, LOW + 0.1, railHeight(LADDER_Z) + 0.1);
      const lx = y > 0 ? this.side * (halfWidth(LADDER_Z) + 0.1) : this.side * (hullX(LADDER_Z, y) + 0.08);
      const d = Math.hypot(_b.x - lx, Math.max(0, Math.abs(_b.z - LADDER_Z) - 0.22), _b.y - y);
      // From the boat the ladder only answers a hand reached up above your head, once you've sat
      // down for a moment, so gripping the oars never pulls you back up onto it.
      let ok = P.ship === S && P.climb ? true : y > 0.3;
      if (P.ship === this.frame) {
        G.camera.getWorldPosition(_c); S.root.worldToLocal(_c);
        ok = y < 0.25 && performance.now() - (P.boatAt || 0) > 1500 && _b.y > _c.y + 0.05;
      }
      if (ok) {
        _c.set(lx, y, clamp(_b.z, LADDER_Z - 0.22, LADDER_Z + 0.22)); S.root.localToWorld(_c);
        const text = P.climb ? '' : P.ship === S ? (this.state === 'moored' ? 'GRIP and pull\nto climb down' : 'Wait for\nthe boat') : 'GRIP the rung\nto climb back up';
        consider('ladder', d, P.ship === this.frame ? 0.22 : 0.32, { point: _c.clone(), text });
      }
    }
    if (P.ship === this.frame) {
      const seat = this.seatOf(P);
      for (const o of this.oars) {
        if (o.seat !== seat || (o.held && o.held.player !== P)) continue;
        this.handleWorld(o, _c);
        consider('oar', hand.distanceTo(_c), 0.25, { point: _c.clone(), oar: o, text: 'GRIP the oar,\npull it toward you' });
      }
    }
  }
  handleWorld(o, out) { return o.pivot.localToWorld(out.set(-0.55, 0, 0)); }
  seatOf(P) { return (parseInt(P.id.split(':')[1]) || 0) % SEAT_Z.length; }

  grab(P, h, t) {
    if (t.kind === 'oar') {
      h.held = 'oar'; h.oar = t.oar; t.oar.held = { player: P, h };
      P.handPos(h, _a); this.frame.root.worldToLocal(_a); h.prevZ = _a.z;
      P.haptic(h, 0.3, 30);
      return;
    }
    // The ladder
    const G = this.G, S = G.ship;
    if (P.ship === S && !P.climb && !this.canClimbDown()) { G.hud.msg('The boat isn’t here yet', 2); return; }
    if (!P.climb) this.startClimb(P, P.ship === S ? 'top' : 'boat');
    h.held = 'ladder'; P.climbHand = h;
    P.handPos(h, _a); S.root.worldToLocal(_a); h.anchor = _a.clone();
    P.autoClimb = 0;
    P.haptic(h, 0.35, 35);
  }
  release(P, h) {
    if (h.held === 'oar') { if (h.oar) h.oar.held = null; h.oar = null; return; }
    if (h.held !== 'ladder') return;
    h.held = null;
    const other = P.hands.find((o) => o !== h && o.held === 'ladder');
    if (other) { P.climbHand = other; P.handPos(other, _a); this.G.ship.root.worldToLocal(_a); other.anchor = _a.clone(); return; }
    P.climbHand = null;
    // Let go of the ladder: finish the climb whichever end is nearer
    if (P.climb) { if (P.dolly.position.y > -0.6 || !this.canClimbDown()) this.finishTop(P); else this.enterBoat(P); }
  }
  // TRIGGER on the ladder: climb it hands-free
  trigger(P, h, t) {
    if (t.kind !== 'ladder') return;
    if (!P.climb) {
      if (P.ship === this.G.ship && !this.canClimbDown()) { this.G.hud.msg('The boat isn’t here yet', 2); return; }
      this.startClimb(P, P.ship === this.G.ship ? 'top' : 'boat');
    }
    P.autoClimb = P.climbFrom === 'boat' ? 1 : -1;
  }

  // Every frame for a hand holding the ladder or an oar
  handStep(P, h, dt) {
    const G = this.G;
    if (h.held === 'ladder' && P.climbHand === h && P.climb) {
      P.handPos(h, _a); G.ship.root.worldToLocal(_a);
      const d = _b.copy(h.anchor).sub(_a);
      P.dolly.position.y += d.y; P.dolly.position.x += d.x * 0.5; P.dolly.position.z += d.z * 0.5;
      return;
    }
    if (h.held === 'oar' && h.oar) {
      if (P.ship !== this.frame) { this.release(P, h); h.held = null; h.glove.visible = true; return; }
      const o = h.oar;
      P.handPos(h, _a); this.frame.root.worldToLocal(_a);
      // Point the oar from the hand through the oarlock
      _b.copy(o.pivot.position).sub(_a);
      if (_b.lengthSq() > 1e-4) {
        _b.normalize(); _b.x = o.side * Math.max(0.25, o.side * _b.x); _b.y = clamp(_b.y, -0.5, 0.45); o.dir.copy(_b.normalize());
      }
      if (_a.distanceTo(o.pivot.position) > 1.35) { P.release(h); return; } // reached too far: let go
      // Pulling the handle toward you rows; pushing it back is the free recovery stroke
      const dz = _a.z - (h.prevZ ?? _a.z); h.prevZ = _a.z;
      if (dz > 0) {
        const pull = dz * 2.6;
        this.rowAcc.f += pull * 0.5; this.rowAcc.t += (o.side < 0 ? 1 : -1) * pull * 0.5;
      }
    }
  }

  // Left stick / W A S D in the boat. Returns true if it rowed (false: walk instead).
  stick(P, x, y, dt) {
    if (P.ship !== this.frame) return false;
    if (this.state === 'beached') {
      if (y < -0.3) return false;                      // stick forward: walk off the bow
      if (y > 0.5) this.rowAcc.f += dt * 0.5;          // stick back: shove off
      return true;
    }
    if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) return true;
    this.rowAcc.f += -y * dt * 1.2; this.rowAcc.t += x * dt * 0.7;
    if (-y > 0.3) this.stickT = 0.3;
    return true;
  }

  // Send what we rowed this past fraction of a second
  flushRow(P, dt) {
    const A = this.rowAcc; A.at += dt;
    if (A.at < 0.15) return;
    A.at = 0;
    if (Math.abs(A.f) > 0.003 || Math.abs(A.t) > 0.003) this.G.act({ type: 'row', f: r3(A.f), t: r3(A.t) });
    A.f = 0; A.t = 0;
  }

  // ---------- Climbing ----------
  startClimb(P, from) {
    const G = this.G, S = G.ship;
    for (const h of P.hands) if (h.held && typeof h.held === 'object') P.release(h); // weapons go on your belt
    if (P.ship !== S) { // from the boat: onto the ladder's foot
      S.root.attach(P.dolly); P.ship = S;
      P.dolly.rotation.x = 0; P.dolly.rotation.z = 0;
      P.dolly.position.y = Math.max(LOW, this.boatFloorY()) + 0.3; // a step up onto the ladder
    }
    P.climb = true; P.climbFrom = from; P.climbHand = null;
    if (from === 'top') P.armForShore();
    // Face the ship's side while climbing
    this.placeHead(P, S, this.colX(P.dolly.position.y + 1.6), LADDER_Z, this.side > 0 ? Math.PI / 2 : -Math.PI / 2, P.dolly.position.y);
    P.blink();
  }
  // Keep a climber on the ladder (called from player.clampToDeck)
  clampClimber(P, dt) {
    const G = this.G;
    if (!this.active) { this.finishTop(P); return; } // weighed anchor while you were on the ladder
    if (P.autoClimb) P.dolly.position.y += P.autoClimb * 1.1 * (dt || 1 / 60);
    P.dolly.updateMatrixWorld(true);
    G.camera.getWorldPosition(_a); G.ship.root.worldToLocal(_a);
    const cx = this.colX(_a.y), x = clamp(_a.x, cx - 0.3, cx + 0.3), z = clamp(_a.z, LADDER_Z - 0.4, LADDER_Z + 0.4);
    P.dolly.position.x += x - _a.x; P.dolly.position.z += z - _a.z;
    const floor = this.canClimbDown() ? this.boatFloorY() : LOW;
    P.dolly.position.y = clamp(P.dolly.position.y, Math.max(LOW - 0.1, floor - 0.05), 0.2);
    P.headLocal.set(x, _a.y, z);
    if (P.dolly.position.y > 0.12 || (P.autoClimb > 0 && P.dolly.position.y > -0.02)) this.finishTop(P);
    else if (P.dolly.position.y < floor + 0.08 && this.canClimbDown()) this.enterBoat(P);
  }
  endClimb(P) {
    P.climb = false; P.autoClimb = 0; P.climbHand = null;
    for (const h of P.hands) if (h.held === 'ladder') { h.held = null; h.glove.visible = true; }
  }
  finishTop(P) {
    const sp = this.topSpot();
    this.endClimb(P);
    this.placeHead(P, this.G.ship, sp.x, sp.z, this.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    P.unbelt(); P.blink();
  }
  enterBoat(P) {
    this.endClimb(P); P.boatAt = performance.now();
    this.placeHead(P, this.frame, 0, SEAT_Z[this.seatOf(P)] + 0.08, 0, 0);
    P.blink();
  }
  // Walk off the bow onto the beach
  stepAshore(P) {
    const [fx, fz] = this.fwd(this.rh);
    // Just past the bow, or a little to one side if a rock or a palm is in the way
    let x = 0, z = 0, ok = false;
    for (const d of [0.7, 1.2, 1.8, 2.5]) {
      for (const sd of [0, 0.7, -0.7, 1.4, -1.4]) {
        x = this.rx + fx * (HALF + d) - fz * sd; z = this.rz + fz * (HALF + d) + fx * sd;
        if (this.island.walkable(x, z, 0.4)) { ok = true; break; }
      }
      if (ok) break;
    }
    if (!ok) return false;
    this.placeHead(P, this.island.shore, x, z, this.rh, 0);
    P.lastGood = null;
    return true;
  }

  // Put the player's head at (x, z) in a frame's space, looking along yaw (0 = toward -z)
  placeHead(P, frame, x, z, yaw, y = 0) {
    const G = this.G, cam = G.camera;
    if (P.dolly.parent !== frame.root) frame.root.add(P.dolly);
    P.ship = frame;
    if (G.mode === 'vr') {
      _e.setFromQuaternion(cam.quaternion, 'YXZ');
      const ry = yaw - _e.y; P.dolly.rotation.set(0, ry, 0);
      const c = Math.cos(ry), s = Math.sin(ry), ox = cam.position.x * c + cam.position.z * s, oz = -cam.position.x * s + cam.position.z * c;
      P.dolly.position.set(x - ox, y, z - oz);
    } else {
      P.dolly.rotation.set(0, 0, 0); P.yaw = yaw; P.pitch = 0;
      P.dolly.position.set(x, y, z);
    }
    P.dolly.updateMatrixWorld(true);
  }

  // Keep a rider inside the boat; walk off the bow once she's on the beach
  clampRider(P) {
    const G = this.G;
    P.dolly.position.y = this.seatDrop();
    P.dolly.updateMatrixWorld(true);
    G.camera.getWorldPosition(_a); this.frame.root.worldToLocal(_a);
    if (this.state === 'beached' && _a.z < -HALF + 0.75 && this.stepAshore(P)) { G.island.clampWalker(P); return; }
    const z = clamp(_a.z, -HALF + 0.6, HALF - 0.35), hw = Math.max(0.15, halfBeam(z) - 0.25), x = clamp(_a.x, -hw, hw);
    P.dolly.position.x += x - _a.x; P.dolly.position.z += z - _a.z;
    P.headLocal.set(x, _a.y, z);
  }

  // Walking ashore into the boat's footprint climbs you in (from island.clampWalker)
  tryBoard(P, wx, wz) {
    if (!this.active || (this.state !== 'beached' && Math.abs(this.v) > 0.6)) return false;
    _a.set(wx, this.frame.root.position.y + 0.5, wz); this.frame.root.worldToLocal(_a);
    if (Math.abs(_a.z) > HALF - 0.1 || Math.abs(_a.x) > halfBeam(_a.z) + 0.1) return false;
    this.placeHead(P, this.frame, 0, SEAT_Z[this.seatOf(P)] + 0.08, 0, 0);
    P.boatAt = performance.now(); P.blink();
    return true;
  }

  // Desktop click: the ladder. True if it used the click.
  deskUse(P) {
    if (!this.active) return false;
    const G = this.G, S = G.ship;
    if (P.climb) return false;
    _a.set(this.side * (halfWidth(LADDER_Z) + 0.1), railHeight(LADDER_Z), LADDER_Z);
    if (P.ship === S && Math.hypot(P.headLocal.x - _a.x, P.headLocal.z - _a.z) < 2.4) {
      if (!this.canClimbDown()) { G.hud.msg('The boat isn’t here yet', 2); return true; }
      this.startClimb(P, 'top'); P.autoClimb = -1; return true;
    }
    if (P.ship === this.frame && this.state === 'moored') { this.startClimb(P, 'boat'); P.autoClimb = 1; return true; }
    return false;
  }

  // A hint for desktop players near the ladder
  nearLadderTop(P) {
    if (!this.active || P.ship !== this.G.ship || P.climb) return false;
    const sp = this.topSpot();
    return Math.hypot(P.headLocal.x - sp.x, P.headLocal.z - sp.z) < 2.2;
  }
}
