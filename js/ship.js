import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { waveHeight } from './waves.js';
import { clamp, damp, angleWrap, canvasTex } from './util.js';
import { woodify } from './materials.js';
import { Kit, FLAT } from './kit.js';

// Ship-local frame: deck at y=0, bow toward -Z, starboard toward +X.
export const BOW = -10, STERN = 8;
export function halfWidth(z) {
  if (z > STERN || z < BOW) return 0;
  if (z >= 2) return 3.2 - ((z - 2) / 6) * 0.35;
  const u = (2 - z) / 12;
  return 3.2 * Math.sqrt(Math.max(0, 1 - u * u));
}
export const BALL_SPEED = 55;
export const WHEEL_MAX = Math.PI * 2; // one full turn of the wheel = full rudder
export const LEVER_MAX = 0.6;         // sail lever swings from -0.6 (full sail) to +0.6 (sails furled)
const LAMP_GEO = new THREE.SphereGeometry(0.06, 10, 8);
const LAMP_READY = new THREE.MeshBasicMaterial({ color: 0x40ff60 });
const LAMP_EMPTY = new THREE.MeshBasicMaterial({ color: 0xff3020 });
const LAMP_FUSE = new THREE.MeshBasicMaterial({ color: 0xffc020 });
// Weapon rack spot (ship-local). Items hang just inboard of this, facing starboard.
export const RACK = { x: -2.2, z: 5.6 };
// Cannons: along-ship positions, how high their platform lifts them (barrel axis ends up ~1.07 m,
// about 3.5 ft), and the gun port cut into the bulwark so the barrel clears the rail.
export const CANNON_Z = [-3, 1]; const GUN_LIFT = 0.45, PORT_HALF = 0.55, PORT_SILL = 0.68;
const G_ACC = 9.81;
// Where an enemy's helmsman shelters (ship-local): front wall at z0, side walls to z1, top height.
export const HELM_COVER = { x: 1.0, z0: 4.95, z1: 6.9, top: 1.58 };
// Where whoever steers stands, just behind the wheel.
export const HELM_SPOT = { x: 0, z: 6.3 };
// Our ship's masts can snap here (ship-local height): everything above leans over as one piece.
export const MAST_BREAK_Y = 2.3;
// Height of the bulwark rail along the ship: 0.95 m amidships (where the guns are), sweeping
// up toward the bow and the stern like the model sheet's sheer line.
const smooth = (a, b, z) => { const t = clamp((z - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const railHeight = (z) => 0.95 + 0.32 * smooth(-6.8, -10, z) + 0.45 * smooth(4.6, 7.3, z);
// How deep the hull goes at z (shallower at the bow and stern, so the bottom curves up)
const hullDepth = (z) => 1 - 0.38 * smooth(-5.5, -10, z) - 0.12 * smooth(4, 8, z);
// Cross-section of the hull's outside, [extra width, height] from the rail down to the keel.
// Widest a little below the deck and narrower at the rail (tumblehome).
// Each point is [a, b, y]: x = halfWidth * a + b at height y (negative heights scale with hullDepth).
const SECTION = [[1, 0.07, 'rail'], [1, 0.08, 0], [1.045, 0.1, -0.6], [1.025, 0.07, -1.15], [0.94, 0.03, -1.55], [0.76, 0.01, -2.0], [0.45, 0, -2.4], [0.05, 0.07, -2.62]];
const WATERLINE_I = 3; // section points down to this index are topsides, below is the dark bottom
const secY = (p, z) => (p[2] === 'rail' ? railHeight(z) : p[2] * (p[2] < 0 ? hullDepth(z) : 1));
// Outside of the hull at height y (y between the deck and the bottom), for placing things on it
export function hullX(z, y) {
  const w = halfWidth(clamp(z, BOW, STERN));
  for (let i = 1; i < SECTION.length; i++) {
    const p0 = SECTION[i - 1], p1 = SECTION[i], y0 = secY(p0, z), y1 = secY(p1, z);
    if (y <= y0 && y >= y1) { const t = (y - y0) / (y1 - y0 || 1); return w * (p0[0] + (p1[0] - p0[0]) * t) + p0[1] + (p1[1] - p0[1]) * t; }
  }
  return w + 0.08;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _m = new THREE.Matrix4();

function plankTex(base, seam) {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const n = 5, pw = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,240,210'},${Math.random() * 0.08})`;
      g.fillRect(i * pw, 0, pw, h);
      g.fillStyle = seam; g.fillRect(i * pw, 0, 2, h);
      const cut = Math.random() * h; g.fillRect(i * pw, cut, pw, 2);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const y of [cut - 6, cut + 8]) { g.fillRect(i * pw + 6, (y + h) % h, 3, 3); g.fillRect(i * pw + pw - 9, (y + h) % h, 3, 3); }
    }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 6 + Math.random() * 20); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function flagTex(kind) {
  return canvasTex(256, 160, (g, w, h) => {
    if (kind === 'jolly') {
      g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#eee';
      g.save(); g.translate(w / 2, h / 2 + 25);
      for (const a of [0.6, -0.6]) { g.save(); g.rotate(a); g.fillRect(-60, -7, 120, 14); g.beginPath(); g.arc(-60, -6, 8, 0, 7); g.arc(-60, 6, 8, 0, 7); g.arc(60, -6, 8, 0, 7); g.arc(60, 6, 8, 0, 7); g.fill(); g.restore(); }
      g.restore();
      g.beginPath(); g.arc(w / 2, h / 2 - 10, 34, 0, 7); g.fill();
      g.fillRect(w / 2 - 20, h / 2 + 10, 40, 22);
      g.fillStyle = '#111';
      g.beginPath(); g.arc(w / 2 - 13, h / 2 - 12, 9, 0, 7); g.arc(w / 2 + 13, h / 2 - 12, 9, 0, 7); g.fill();
      for (let i = -1; i <= 1; i++) g.fillRect(w / 2 + i * 10 - 1, h / 2 + 14, 3, 18);
    } else {
      g.fillStyle = '#7a0f12'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f2e3c0'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w / 2 - 55, h / 2 + 45); g.lineTo(w / 2 + 50, h / 2 - 45);
      g.moveTo(w / 2 + 55, h / 2 + 45); g.lineTo(w / 2 - 50, h / 2 - 45); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2 - 65, h / 2 + 25); g.lineTo(w / 2 - 35, h / 2 + 55);
      g.moveTo(w / 2 + 65, h / 2 + 25); g.lineTo(w / 2 + 35, h / 2 + 55); g.stroke();
    }
  });
}

const BARREL_GEO = new THREE.CylinderGeometry(0.19, 0.13, 1.85, 12).rotateX(Math.PI / 2).translate(0, 0, -0.325);
const KNOB_GEO = new THREE.SphereGeometry(0.1, 8, 6).translate(0, 0, 0.66);
const RING_GEO = new THREE.TorusGeometry(0.15, 0.03, 5, 12).translate(0, 0, -1.2);
const IRON = new THREE.MeshLambertMaterial({ color: 0x23252a });

export class Ship {
  constructor(scene, o = {}) {
    this.scene = scene;
    this.id = o.id || 'ship:?'; // stable network id, handed out by Ids (see ids.js)
    this.isPlayer = !!o.isPlayer;
    this.kind = o.kind || 'brigantine'; // 'sloop' | 'brigantine' | 'galleon'
    this.gunZ = o.gunZ || CANNON_Z;     // where the cannons sit along the deck (one per side at each)
    this.ballDamage = o.ballDamage || 5; // hull damage each of her cannonballs does
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ'; scene.add(this.root);
    this.pos = new THREE.Vector3(o.x || 0, 0, o.z || 0);
    this.heading = o.heading || 0;
    this.speed = 0; this.sail = o.sail ?? 0.5; this.rudder = 0;
    this.speedMul = 1; // below 1 when holed or dismasted (see damage.js)
    this.maxSpeed = o.maxSpeed || 9; this.turnRate = o.turnRate || 0.24;
    this.maxHealth = this.health = o.health || 100;
    this.alive = true; this.sinkT = 0; this.sinkTilt = Math.random() < 0.5 ? 1 : -1;
    this.vel = new THREE.Vector3(); this.pitch = 0; this.roll = 0; this.bob = 0;
    this.comfort = o.comfort ?? 1;
    this.reloadTime = o.reloadTime || 7;
    this.cannons = []; this.sails = []; this.crew = [];
    // Solid things on deck that stop musket balls (boxes in ship-local space)
    this.covers = [];
    this.geos = [];
    this.build(o);
  }

  build(o) {
    const enemy = !this.isPlayer;
    const hullMat = woodify(new THREE.MeshLambertMaterial({ color: enemy ? 0x2f2823 : 0x5d3b22 }));
    const trimMat = new THREE.MeshLambertMaterial({ color: enemy ? 0x7a1515 : 0xb8902f });
    const wallMat = woodify(new THREE.MeshLambertMaterial({ color: enemy ? 0x3a3029 : 0x6e4a2c, side: THREE.DoubleSide }), 0.22);
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2616 });
    const deckMat = new THREE.MeshLambertMaterial({ map: plankTex(enemy ? '#6d5a46' : '#a07a4f', 'rgba(40,25,10,0.8)') });
    const sailMat = new THREE.MeshLambertMaterial({ color: enemy ? 0x3b3633 : 0xeee4cc, side: THREE.DoubleSide });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffcf6a });
    this.sailMat = sailMat;

    const parts = new Map();
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_v, _q, _s);
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(_m);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g);
    };

    // Outline of the hull, stern -> bow along starboard then back along port
    const N = 26, outline = [];
    for (let i = 0; i <= N; i++) { const z = STERN - (i * (STERN - BOW)) / N; outline.push([halfWidth(z), z]); }
    for (let i = N - 1; i >= 0; i--) { const z = STERN - (i * (STERN - BOW)) / N; outline.push([-halfWidth(z), z]); }

    this.buildHull(add, { hullMat, trimMat, dark, enemy });

    // Deck
    const deckShape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x * 0.985, -z * 0.995)));
    const deckGeo = new THREE.ShapeGeometry(deckShape); deckGeo.rotateX(-Math.PI / 2);
    add(deckGeo, deckMat, 0, 0.02, 0);

    // Bulwark wall and rail, with a low gun port cut in the wall at each cannon
    const H = 0.95, RH = railHeight;
    const isPort = (x, z) => Math.abs(x) > 1.5 && this.gunZ.some((cz) => Math.abs(z - cz) < PORT_HALF);
    const coarse = outline.map(([x, z]) => [x * 0.99, z * 0.996]);
    const loop = [];
    for (let i = 0; i < coarse.length; i++) {
      const [x1, z1] = coarse[i], [x2, z2] = coarse[(i + 1) % coarse.length];
      const k = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.12));
      for (let j = 0; j < k; j++) loop.push([x1 + ((x2 - x1) * j) / k, z1 + ((z2 - z1) * j) / k]);
    }
    // Height of each wall segment (segment i runs from loop[i] to loop[i+1])
    const segH = loop.map(([x1, z1], i) => { const [x2, z2] = loop[(i + 1) % loop.length]; return isPort((x1 + x2) / 2, (z1 + z2) / 2) ? PORT_SILL : -1; });
    const wallPos = [];
    for (let i = 0; i < loop.length; i++) {
      const [x1, z1] = loop[i], [x2, z2] = loop[(i + 1) % loop.length];
      const h1 = segH[i] > 0 ? segH[i] : RH(z1), h2 = segH[i] > 0 ? segH[i] : RH(z2);
      wallPos.push(x1, 0, z1, x2, 0, z2, x2, h2, z2, x1, 0, z1, x2, h2, z2, x1, h1, z1);
    }
    const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wallGeo.computeVertexNormals(); add(wallGeo, wallMat);
    // Rail along the top: one tube per stretch of equal height, starting the walk at a height change
    const n = loop.length;
    let s0 = 0; for (let i = 0; i < n; i++) if (segH[i] !== segH[(i - 1 + n) % n]) { s0 = i; break; }
    for (let i = 0; i < n;) {
      const h = segH[(s0 + i) % n], pts = [], yAt = (z) => (h > 0 ? h : RH(z)) + 0.03;
      while (i < n && segH[(s0 + i) % n] === h) { const [x, z] = loop[(s0 + i) % n]; pts.push(new THREE.Vector3(x, yAt(z), z)); i++; }
      const [xe, ze] = loop[(s0 + i) % n]; pts.push(new THREE.Vector3(xe, yAt(ze), ze));
      const closed = pts.length > n;
      if (closed) pts.pop();
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), Math.max(2, pts.length * 2), h < 0 ? 0.075 : 0.06, 5, closed), dark);
      // Posts framing the gun port
      if (h > 0) for (const pt of [pts[0], pts[pts.length - 1]]) add(new THREE.BoxGeometry(0.14, RH(pt.z) - h + 0.1, 0.14), dark, pt.x, (RH(pt.z) + h) / 2, pt.z);
    }

    // Raised quarterdeck over the stern cabin (the sheet's poop deck), overhanging the transom.
    // The cabin front has a door and windows; stairs climb up both sides; a balustrade runs
    // along the front edge. Looks only: you can't walk up there.
    const cw = halfWidth(7.3) * 2 * 0.99, QD = 1.55, QZ0 = 7.3, QZ1 = 9.3;
    this.quarter = { cw, QD, QZ0, QZ1 };
    add(new THREE.BoxGeometry(cw, QD, QZ1 - QZ0), wallMat, 0, QD / 2, (QZ0 + QZ1) / 2);           // cabin block
    add(new THREE.BoxGeometry(cw + 0.3, 2.15, QZ1 - 8.0), hullMat, 0, QD - 1.08, (8.0 + QZ1) / 2); // overhanging stern
    add(new THREE.BoxGeometry(cw + 0.12, 0.1, QZ1 - QZ0 + 0.12), dark, 0, QD + 0.03, (QZ0 + QZ1) / 2);
    add(new THREE.BoxGeometry(0.85, 1.35, 0.06), dark, 0, 0.68, QZ0 - 0.02);                       // door
    for (const x of [-1.6, 1.6]) add(new THREE.BoxGeometry(0.5, 0.45, 0.05), glow, x, 0.95, QZ0 - 0.02);
    this.covers.push({ min: new THREE.Vector3(-cw / 2, 0, QZ0), max: new THREE.Vector3(cw / 2, QD + 0.9, QZ1) });

    if (enemy) {
      // Helm shelter: thick planking around the wheel so the helmsman can't simply be picked
      // off. Only his head shows over the top.
      const HT = HELM_COVER.top, z0 = HELM_COVER.z0, z1 = HELM_COVER.z1, xw = HELM_COVER.x;
      add(new THREE.BoxGeometry(xw * 2 + 0.12, HT, 0.12), wallMat, 0, HT / 2, z0);
      add(new THREE.BoxGeometry(xw * 2 + 0.24, 0.1, 0.22), dark, 0, HT + 0.03, z0);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.12, HT, z1 - z0), wallMat, sx * xw, HT / 2, (z0 + z1) / 2);
        add(new THREE.BoxGeometry(0.22, 0.1, z1 - z0 + 0.1), dark, sx * xw, HT + 0.03, (z0 + z1) / 2);
      }
      this.covers.push({ min: new THREE.Vector3(-xw - 0.08, 0, z0 - 0.08), max: new THREE.Vector3(xw + 0.08, HT, z0 + 0.08) });
      for (const sx of [-1, 1]) this.covers.push({ min: new THREE.Vector3(sx * xw - 0.08, 0, z0), max: new THREE.Vector3(sx * xw + 0.08, HT, z1) });
    }

    // Masts, yards, furled canvas, crow's nest, bowsprit
    // Rig by ship type (see the concept sheet): sloop = 1 mast, brigantine = 2, galleon = 3.
    // The main mast (z -1, crow's nest, flag) is always there.
    const MAIN = { z: -1, h: 15, r: 0.24, sails: [{ y: 13.4, w: 6, h: 4.4 }, { y: 8.6, w: 7.6, h: 5.7 }] };
    const FORE = { z: -6.5, h: 12.5, r: 0.21, sails: [{ y: 11.2, w: 5.2, h: 3.9 }, { y: 6.9, w: 6.6, h: 5.0 }] };
    const MIZZEN = { z: 3.3, h: 11, r: 0.19, sails: [{ y: 9.8, w: 4.4, h: 3.0 }, { y: 6.6, w: 5.4, h: 3.6 }] };
    const masts = this.kind === 'sloop' ? [{ ...MAIN, h: 16, sails: [{ y: 14.4, w: 6.4, h: 4.6 }, { y: 9.6, w: 8.2, h: 6.4 }] }]
      : this.kind === 'galleon' ? [MAIN, FORE, MIZZEN] : [MAIN, FORE];
    this.mastList = masts.map((m) => ({ ...m }));
    // Our own ship: the part of each mast above MAST_BREAK_Y is its own group, so it can snap
    // and lean over (damage.js). Enemy masts stay merged into the hull (cheaper to draw).
    const B = MAST_BREAK_Y;
    for (const m of this.mastList) {
      let put = add;
      if (this.isPlayer) {
        const grp = new THREE.Group(); grp.position.set(0, B, m.z); this.root.add(grp); m.group = grp;
        put = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
          const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y - B, z - m.z); mesh.rotation.set(rx, ry, rz); grp.add(mesh);
          this.geos.push(geo);
        };
        const rB = m.r + (m.r * 0.65 - m.r) * ((B + 0.5) / m.h);
        add(new THREE.CylinderGeometry(rB, m.r, B + 0.5, 8), wood, 0, (B - 0.5) / 2, m.z);
        put(new THREE.CylinderGeometry(m.r * 0.65, rB, m.h - 0.5 - B, 8), wood, 0, (m.h - 0.5 + B) / 2, m.z);
      } else add(new THREE.CylinderGeometry(m.r * 0.65, m.r, m.h, 8), wood, 0, m.h / 2 - 0.5, m.z);
      for (const s of m.sails) {
        put(new THREE.CylinderGeometry(0.08, 0.08, s.w + 0.6, 6), dark, 0, s.y, m.z - 0.25, 0, 0, Math.PI / 2);
        put(new THREE.CylinderGeometry(0.15, 0.15, s.w * 0.92, 6), sailMat, 0, s.y - 0.1, m.z - 0.33, 0, 0, Math.PI / 2);
        const sm = this.makeSail(s.w, s.h, sailMat);
        sm.position.set(0, s.y - 0.05, m.z - 0.38);
        if (m.group) { sm.position.y -= B; sm.position.z -= m.z; m.group.add(sm); } else this.root.add(sm);
      }
      if (m.z === -1 || m.z === -6.5) { // crow's nests on the main and fore masts
        const ny = m.z === -1 ? 10.4 : 8.6, nr = m.z === -1 ? 0.72 : 0.6;
        put(new THREE.CylinderGeometry(nr, nr * 0.8, 0.55, 10, 1, true), wood, 0, ny, m.z);
        put(new THREE.CylinderGeometry(nr, nr, 0.06, 10), dark, 0, ny - 0.25, m.z);
      }
    }
    // Bowsprit and jib-boom, angled up over the bow
    const BS = -72 * Math.PI / 180;
    add(new THREE.CylinderGeometry(0.11, 0.2, 6.2, 8), wood, 0, 1.55, -12.4, BS, 0, 0);
    add(new THREE.CylinderGeometry(0.06, 0.1, 3.4, 6), wood, 0, 3.0, -16.6, BS, 0, 0);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), dark, 0, 2.05, -13.9, BS, 0, 0);

    // Cannon carriages (barrels are separate, they move)
    // They sit on a raised gun platform so the back end is at about waist height.
    for (const s of [-1, 1]) for (const z of this.gunZ) {
      add(new THREE.BoxGeometry(1.0, GUN_LIFT, 1.1), wood, s * 2.3, GUN_LIFT / 2, z);
      add(new THREE.BoxGeometry(1.04, 0.05, 1.14), dark, s * 2.3, GUN_LIFT, z);
      add(new THREE.BoxGeometry(0.62, 0.3, 0.72), dark, s * 2.3, GUN_LIFT + 0.3, z);
      for (const dx of [-0.26, 0.26]) for (const dz of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), wood, s * 2.3 + dx, GUN_LIFT + 0.14, z + dz, 0, 0, Math.PI / 2);
      const outer = new THREE.Group(); outer.position.set(s * 2.3, GUN_LIFT + 0.62, z); outer.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      const elev = new THREE.Group(); outer.add(elev);
      const barrel = new THREE.Group(); elev.add(barrel);
      barrel.add(new THREE.Mesh(BARREL_GEO, IRON), new THREE.Mesh(KNOB_GEO, IRON), new THREE.Mesh(RING_GEO, IRON));
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.3); elev.add(muzzle);
      const breech = new THREE.Object3D(); breech.position.set(0, 0.05, 0.62); elev.add(breech);
      this.root.add(outer);
      let lamp = null;
      if (this.isPlayer) {
        // Ready light on the carriage: green = loaded, red = reloading
        lamp = new THREE.Mesh(LAMP_GEO, LAMP_READY); lamp.position.set(s * 1.95, GUN_LIFT + 0.45, z + 0.45); this.root.add(lamp);
      }
      this.cannons.push({ id: `${this.id}/cannon:${this.cannons.length}`, side: s, z, outer, elev, barrel, muzzle, breech, baseYaw: outer.rotation.y, lamp,
        elevation: 0.06, yaw: 0, tElev: 0.06, tYaw: 0, reload: 0, fuse: -1, recoil: 0, inArc: false, sparkT: 0 });
    }

    this.buildDecor(add, { dark, glow, trimMat, wallMat, enemy, cw });

    // Helm
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x7b5432 });
    add(new THREE.BoxGeometry(0.22, 1.25, 0.22), dark, 0, 0.62, 5.78);
    this.wheelBase = new THREE.Group(); this.wheelBase.position.set(0, 1.25, 5.6); this.root.add(this.wheelBase);
    const wg = [];
    wg.push(new THREE.TorusGeometry(0.5, 0.035, 6, 28));
    for (let i = 0; i < 4; i++) wg.push(new THREE.CylinderGeometry(0.025, 0.025, 1.35, 5).rotateZ((i * Math.PI) / 4));
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; wg.push(new THREE.CylinderGeometry(0.03, 0.022, 0.18, 6).rotateZ(a - Math.PI / 2).translate(Math.cos(a) * 0.67, Math.sin(a) * 0.67, 0)); }
    wg.push(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 10).rotateX(Math.PI / 2));
    const wgeo = mergeGeometries(wg.map((g) => (g.index ? g.toNonIndexed() : g)));
    this.wheel = new THREE.Mesh(wgeo, wheelMat); this.wheelBase.add(this.wheel);
    this.wheelAngle = 0;

    if (this.isPlayer) {
      // Sail lever
      add(new THREE.BoxGeometry(0.3, 0.3, 0.4), dark, 1.15, 0.15, 5.6);
      this.leverBase = new THREE.Group(); this.leverBase.position.set(1.15, 0.3, 5.6); this.root.add(this.leverBase);
      this.lever = new THREE.Group(); this.leverBase.add(this.lever);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.95, 6).translate(0, 0.475, 0), wood);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), trimMat); knob.position.y = 0.98;
      this.lever.add(stick, knob); this.leverKnob = knob;
      this.leverAngle = 0;
      // Weapon rack on the port side, next to the helm
      add(new THREE.BoxGeometry(0.08, 1.2, 1.5), dark, RACK.x - 0.12, 1.2, RACK.z);
      add(new THREE.BoxGeometry(0.25, 0.1, 1.5), dark, RACK.x - 0.05, 0.5, RACK.z);
    }

    // Rigging
    const lines = [];
    const L = (a, b) => lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    for (const m of masts) {
      // Shrouds from below the masthead down to deadeyes on the channels outside the rail,
      // with ratlines (the rope ladder rungs) tied across them
      const top = [0, m.h * 0.66, m.z];
      for (const sd of [-1, 1]) {
        const feet = [-0.9, -0.3, 0.3, 0.9].map((dz) => [sd * (halfWidth(m.z + dz) + 0.32), RH(m.z + dz) + 0.05, m.z + dz]);
        for (const f of feet) L([sd * 0.15, top[1], m.z + (f[2] - m.z) * 0.15], f);
        const yTop = top[1] - 0.6, y0 = RH(m.z) + 0.45;
        for (let y = y0; y < yTop; y += 0.42) {
          const u = (y - feet[0][1]) / (top[1] - feet[0][1]);
          const pts = feet.map((f) => [f[0] + (sd * 0.15 - f[0]) * u, y, f[2] + (m.z + (f[2] - m.z) * 0.15 - f[2]) * u]);
          for (let q = 0; q < pts.length - 1; q++) L(pts[q], pts[q + 1]);
        }
      }
      L([0, m.h - 0.6, m.z], [0, m.h * 0.66, m.z]);
    }
    if (masts.length > 1) { L([0, 14.4, -1], [0, 11.6, -6.5]); L([0, 11.6, -6.5], [0, 4.4, -18.2]); L([0, 9.0, -6.5], [0, 2.6, -14.2]); }
    else { L([0, 15.4, -1], [0, 4.4, -18.2]); L([0, 11, -1], [0, 2.6, -14.2]); }
    if (this.kind === 'galleon') { L([0, 14.4, -1], [0, 10.4, 3.3]); L([0, 10.4, 3.3], [0, 2.6, 9.2]); } else L([0, 14.4, -1], [0, 2.6, 9.2]);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const rig = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2018 }));
    this.root.add(rig); this.geos.push(lg);
    // Rope ends tied to a mast above the break follow that mast when it leans (see updateRig)
    if (this.isPlayer) {
      this.rigGeo = lg; this.rigBase = Float32Array.from(lines);
      this.rigOwner = [];
      for (let i = 0; i < lines.length / 3; i++) {
        const y = lines[i * 3 + 1], z = lines[i * 3 + 2];
        this.rigOwner.push(y > B + 0.5 ? this.mastList.find((m) => Math.abs(m.z - z) < 0.01) || (y > B + 1.2 ? this.mastList.find((m) => Math.abs(m.z - z) < 1.2) : null) || null : null);
      }
    }

    // Flag
    const fgeo = new THREE.PlaneGeometry(1.9, 1.15, 10, 1).translate(0.95, 0, 0).rotateY(-Math.PI / 2);
    this.flag = new THREE.Mesh(fgeo, new THREE.MeshLambertMaterial({ map: flagTex(enemy ? 'red' : 'jolly'), side: THREE.DoubleSide }));
    this.flag.position.set(0, 14.6, -1); this.root.add(this.flag);
    const mainGrp = this.mastList.find((m) => m.z === -1)?.group;
    if (mainGrp) { mainGrp.add(this.flag); this.flag.position.set(0, 14.6 - B, 0); }
    this.flagBase = Float32Array.from(fgeo.attributes.position.array);

    // Merge static parts per material
    for (const [mat, list] of parts) {
      const g = mergeGeometries(list);
      const mesh = new THREE.Mesh(g, mat); this.root.add(mesh); this.geos.push(g);
      list.forEach((x) => x.dispose());
    }
  }

  // The hull's outside: lofted through cross-sections from stern to bow, so it has a curved
  // sheer, tumblehome, a rounded bottom that sweeps up at the bow, a keel, stem and rudder.
  buildHull(add, { hullMat, trimMat, dark, enemy }) {
    const low = woodify(new THREE.MeshLambertMaterial({ color: enemy ? 0x241e1a : 0x4a3020, side: THREE.DoubleSide, flatShading: true }), 0.3);
    hullMat.side = THREE.DoubleSide; hullMat.flatShading = true;
    const N = 44, st = [];
    for (let i = 0; i <= N; i++) {
      const z = STERN - (STERN - BOW) * (i / N);
      const w = halfWidth(z);
      st.push(SECTION.map((p) => [w * p[0] + p[1], secY(p, z), z]));
    }
    const strip = (j0, j1) => {
      const pos = [];
      for (let i = 0; i < N; i++) for (let j = j0; j < j1; j++) for (const sd of [1, -1]) {
        const a = st[i][j], b = st[i + 1][j], c = st[i + 1][j + 1], d = st[i][j + 1];
        const P = (q) => [sd * q[0], q[1], q[2]];
        pos.push(...P(a), ...P(b), ...P(c), ...P(a), ...P(c), ...P(d));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      return g;
    };
    add(strip(0, WATERLINE_I), hullMat);
    add(strip(WATERLINE_I, SECTION.length - 1), low);
    // Transom: close the flat stern
    const sec = st[0], shape = new THREE.Shape([...sec.map((p) => new THREE.Vector2(p[0], p[1])), ...sec.slice().reverse().map((p) => new THREE.Vector2(-p[0], p[1]))]);
    add(new THREE.ShapeGeometry(shape), hullMat, 0, 0, STERN);
    // Keel along the bottom, the stem rising at the bow, the rudder at the stern
    const keel = []; for (let z = STERN; z >= -9.2; z -= 0.8) keel.push(new THREE.Vector3(0, -2.62 * hullDepth(z) - 0.06, z));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(keel), 24, 0.11, 4), dark);
    const stem = [[0, railHeight(BOW) + 0.45, BOW - 0.45], [0, 0.4, BOW - 0.2], [0, -0.6, BOW + 0.15], [0, -1.25, BOW + 0.8], [0, -1.6, BOW + 1.6]].map((p) => new THREE.Vector3(...p));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stem), 16, 0.13, 5), dark);
    add(new THREE.BoxGeometry(0.16, 2.4, 0.95), low, 0, -1.25, STERN + 0.5);
    add(new THREE.BoxGeometry(0.2, 0.3, 0.3), dark, 0, 0.0, STERN + 0.18);
    // Wales: a thick dark band below the rail and a thin painted line at the waterline
    const band = (y, r, mat) => { for (const sd of [-1, 1]) {
      const pts = []; for (let z = STERN - 0.02; z > BOW + 0.25; z -= 0.45) pts.push(new THREE.Vector3(sd * (hullX(z, y * (y < 0 ? hullDepth(z) : 1)) + r * 0.6), y * (y < 0 ? hullDepth(z) : 1), z));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, r, 4), mat);
    } };
    band(-0.32, 0.075, dark); band(-0.05, 0.035, trimMat); band(-1.12, 0.04, trimMat);
  }

  // Details in the style of the concept art: stern windows and carved trim, a balustrade on the
  // stern cabin roof, gun ports painted along the hull, rope round the masts, and barrels,
  // crates and rope coils on deck. All looks: nothing here blocks or changes the game.
  buildDecor(add, { dark, glow, trimMat, wallMat, enemy, cw }) {
    const gold = enemy ? 0x8a2a1e : 0xc8a040, kind = this.kind;
    const k = new Kit();
    const { QD, QZ0, QZ1 } = this.quarter, RH = railHeight;
    const WOOD = enemy ? 0x4a3a2e : 0x7a5232, WOOD_D = enemy ? 0x2e241e : 0x4a2e18, WOOD_L = enemy ? 0x5a4838 : 0x9a6e42;
    // Stern: arched glowing windows with gold frames, carved rails above and below, lanterns
    const nWin = kind === 'galleon' ? 5 : kind === 'sloop' ? 2 : 3, sz = QZ1 + 0.02, sw = cw + 0.3;
    for (let i = 0; i < nWin; i++) {
      const x = (i - (nWin - 1) / 2) * (sw * 0.78 / nWin);
      add(new THREE.BoxGeometry(0.44, 0.48, 0.04), glow, x, 0.42, sz);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10, 1, false, -Math.PI / 2, Math.PI), glow, x, 0.66, sz, Math.PI / 2, 0, 0);
      k.add(new THREE.TorusGeometry(0.25, 0.04, 4, 10, Math.PI), gold, [x, 0.66, sz + 0.02]);
      for (const dx of [-0.25, 0.25]) k.box(0.07, 0.5, 0.07, gold, [x + dx, 0.41, sz + 0.02]);
      k.box(0.58, 0.07, 0.08, gold, [x, 0.15, sz + 0.02]);
      k.box(0.03, 0.7, 0.05, WOOD_D, [x, 0.5, sz + 0.03]); k.box(0.44, 0.03, 0.05, WOOD_D, [x, 0.45, sz + 0.03]);
    }
    k.box(sw, 0.1, 0.12, gold, [0, 1.25, sz + 0.02]); k.box(sw, 0.12, 0.12, gold, [0, -0.45, sz + 0.02]);
    k.box(sw * 0.7, 0.18, 0.1, WOOD_D, [0, 1.05, sz + 0.02]);
    if (kind === 'galleon') k.ball(0.35, 0, gold, [0, QD + 0.55, sz + 0.05], 0, [1.6, 0.8, 0.3]);
    for (const sd of [-1, 1]) { // stern lanterns on posts
      k.cyl(0.04, 0.04, 0.6, 5, WOOD_D, [sd * (cw / 2 - 0.05), QD + 0.3, QZ1 - 0.08]);
      add(new THREE.BoxGeometry(0.2, 0.3, 0.2), glow, sd * (cw / 2 - 0.05), QD + 0.75, QZ1 - 0.08);
      k.cyl(0.14, 0.04, 0.12, 6, gold, [sd * (cw / 2 - 0.05), QD + 0.96, QZ1 - 0.08]);
    }
    // Balustrade round the quarterdeck: a top rail on little turned posts
    const post = (x, y, z, h = 0.5) => { k.cyl(0.028, 0.034, h, 5, WOOD_L, [x, y + h / 2, z]); k.ball(0.048, 0, WOOD_L, [x, y + h * 0.45, z]); };
    const run = (x0, z0, x1, z1, y, h = 0.5) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.2));
      for (let i = 0; i <= n; i++) post(x0 + (x1 - x0) * i / n, y, z0 + (z1 - z0) * i / n, h);
      k.box(0.11, 0.07, L + 0.08, WOOD_D, [(x0 + x1) / 2, y + h + 0.02, (z0 + z1) / 2], [0, Math.atan2(x1 - x0, z1 - z0), 0]);
    };
    const qx = cw / 2 - 0.05, stair = 0.62;
    run(-qx, QZ0 + 0.06, -qx + 0.05, QZ1 - 0.1, QD); run(qx, QZ0 + 0.06, qx - 0.05, QZ1 - 0.1, QD); run(-qx + 0.05, QZ1 - 0.1, qx - 0.05, QZ1 - 0.1, QD);
    run(-qx + stair + 0.05, QZ0 + 0.06, qx - stair - 0.05, QZ0 + 0.06, QD);
    // Stairs up both sides of the cabin front, with a hand rail
    const steps = 5, rise = QD / steps, tread = 0.19;
    for (const sd of [-1, 1]) {
      const x = sd * (qx - stair / 2);
      for (let i = 0; i < steps; i++) k.box(stair, 0.06, tread + 0.04, WOOD_L, [x, rise * (i + 1) - 0.03, QZ0 - (steps - i) * tread + tread / 2]);
      for (const ex of [-1, 1]) k.box(0.06, 0.08, Math.hypot(steps * tread, QD) + 0.1, WOOD_D, [x + ex * stair / 2, QD / 2 - 0.02, QZ0 - steps * tread / 2], [Math.atan2(QD, steps * tread), 0, 0]);
      const inner = x - sd * stair / 2;
      k.box(0.06, 0.06, Math.hypot(steps * tread, QD) + 0.2, WOOD_D, [inner, QD / 2 + 0.8, QZ0 - steps * tread / 2], [Math.atan2(QD, steps * tread), 0, 0]);
      for (let i = 0; i <= 2; i++) k.cyl(0.025, 0.025, 0.85, 5, WOOD_L, [inner, rise * steps * i / 2 + 0.42, QZ0 - steps * tread + i * steps * tread / 2]);
    }
    // Cabin front: door frame and planks, window frames, a lantern over the door
    k.box(1.0, 0.1, 0.08, WOOD_D, [0, 1.4, QZ0 - 0.03]); for (const dx of [-0.47, 0.47]) k.box(0.08, 1.4, 0.08, WOOD_D, [dx, 0.7, QZ0 - 0.03]);
    for (const dx of [-0.2, 0, 0.2]) k.box(0.02, 1.3, 0.03, 0x3a2414, [dx, 0.68, QZ0 - 0.06]);
    k.box(0.07, 0.07, 0.04, gold, [0.28, 0.7, QZ0 - 0.07]);
    for (const x of [-1.6, 1.6]) { k.box(0.62, 0.07, 0.07, WOOD_D, [x, 1.21, QZ0 - 0.03]); k.box(0.62, 0.07, 0.07, WOOD_D, [x, 0.69, QZ0 - 0.03]); k.box(0.04, 0.5, 0.05, WOOD_D, [x, 0.95, QZ0 - 0.05]); }
    // Forecastle: a short raised deck in the bow, with a capstan and a little rail
    const FZ = -8.75, FY = 0.42;
    const fw = (z) => halfWidth(z) * 0.97;
    const fs = new THREE.Shape(); fs.moveTo(-fw(FZ), -FZ);
    for (let z = FZ; z >= BOW + 0.15; z -= 0.25) fs.lineTo(fw(z), -z);
    for (let z = BOW + 0.15; z <= FZ; z += 0.25) fs.lineTo(-fw(z), -z);
    k.add(new THREE.ExtrudeGeometry(fs, { depth: 0.1, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, FY - 0.1, 0), WOOD_L);
    k.box(fw(FZ) * 2, FY, 0.08, WOOD_D, [0, FY / 2, FZ]);
    run(-fw(FZ) + 0.1, FZ + 0.02, -0.55, FZ + 0.02, FY, 0.42); run(0.55, FZ + 0.02, fw(FZ) - 0.1, FZ + 0.02, FY, 0.42);
    k.cyl(0.26, 0.3, 0.55, 8, WOOD, [0, FY + 0.28, -9.35]); k.cyl(0.32, 0.32, 0.08, 8, WOOD_D, [0, FY + 0.56, -9.35]);
    for (let i = 0; i < 4; i++) k.box(0.9, 0.05, 0.06, WOOD_L, [0, FY + 0.5, -9.35], [0, i * Math.PI / 4, 0]);
    // Carved head at the bow: gold scroll rails sweeping up to the bowsprit, a scroll on the stem
    for (const sd of [-1, 1]) {
      k.tube([[sd * 0.9, RH(-8.8) - 0.15, -8.8], [sd * 0.55, RH(-9.6) - 0.05, -9.75], [sd * 0.16, 0.95, -10.55], [sd * 0.05, 1.35, -10.85]], 0.05, gold, 5);
      k.tube([[sd * 1.0, 0.25, -8.9], [sd * 0.6, 0.35, -9.8], [sd * 0.15, 0.6, -10.5]], 0.04, gold, 4);
    }
    k.add(new THREE.TorusGeometry(0.2, 0.06, 5, 10, Math.PI * 1.5), gold, [0, RH(BOW) + 0.3, BOW - 0.42], [0, Math.PI / 2, 0]);
    // Catheads and anchors hanging at the bow
    for (const sd of [-1, 1]) {
      const z = -8.1, x = sd * (halfWidth(z) + 0.05), y = RH(z) + 0.05;
      k.box(0.75, 0.16, 0.16, WOOD_D, [x + sd * 0.3, y, z - 0.1], [0, sd * 0.3, 0]);
      const ax = sd * (hullX(z, -0.3) + 0.12), az = z + 0.25;
      k.box(0.08, 1.1, 0.08, 0x2a2c31, [ax, -0.25, az]);
      k.box(0.06, 0.06, 0.7, 0x4a3020, [ax, 0.25, az]);
      k.add(new THREE.TorusGeometry(0.32, 0.045, 4, 10, Math.PI), 0x2a2c31, [ax, -0.5, az], [0, Math.PI / 2, Math.PI]);
      for (const dz of [-0.32, 0.32]) k.add(new THREE.ConeGeometry(0.08, 0.16, 4), 0x2a2c31, [ax, -0.5, az + dz]);
    }
    // Gun ports painted along both sides of the hull (the working guns are on deck)
    const ports = kind === 'galleon' ? [-7, -5, -3, -1, 1, 3, 5] : kind === 'brigantine' ? [-6, -4, -2, 0, 2, 4] : [-4, 0, 3];
    for (const side of [-1, 1]) for (const z of ports) {
      const y = -0.62, x = side * (hullX(z, y) + 0.015);
      k.box(0.05, 0.4, 0.48, gold, [x, y, z]);
      k.box(0.06, 0.3, 0.38, 0x15100c, [x + side * 0.01, y, z]);
      k.cyl(0.07, 0.08, 0.22, 6, 0x2a2c31, [x + side * 0.08, y, z], [0, 0, Math.PI / 2]);
    }
    // Channels and deadeyes outside the rail where the shrouds come down
    for (const m of this.mastList) for (const sd of [-1, 1]) {
      const x = sd * (halfWidth(m.z) + 0.2), y = RH(m.z) - 0.18;
      k.box(0.32, 0.08, 2.3, WOOD_D, [x, y, m.z]);
      for (const dz of [-0.9, -0.3, 0.3, 0.9]) {
        const xx = sd * (halfWidth(m.z + dz) + 0.32);
        k.cyl(0.07, 0.07, 0.05, 7, 0x2a1a10, [xx, RH(m.z + dz) + 0.05, m.z + dz], [0, 0, Math.PI / 2]);
        k.box(0.03, 0.6, 0.03, 0x2a2c31, [xx, y - 0.3, m.z + dz]);
      }
    }
    // Cargo hatches with gratings
    const grating = (z, w, d) => {
      k.box(w + 0.16, 0.08, d + 0.16, WOOD_D, [0, 0.04, z]);
      k.box(w, 0.04, d, 0x1a120c, [0, 0.07, z]);
      for (let x = -w / 2 + 0.07; x < w / 2; x += 0.14) k.box(0.05, 0.05, d, WOOD_L, [x, 0.095, z]);
      for (let zz = -d / 2 + 0.07; zz < d / 2; zz += 0.14) k.box(w, 0.035, 0.05, WOOD_L, [0, 0.1, z + zz]);
    };
    grating(-4.5, 1.3, 1.0); if (!this.gunZ.some((gz) => Math.abs(gz - 2.6) < 0.6)) grating(2.6, 1.1, 0.9);
    // Rope wound round the foot of each mast, belaying pins on a rail
    for (const m of this.mastList) {
      for (let i = 0; i < 4; i++) k.add(new THREE.TorusGeometry(m.r + 0.05, 0.035, 4, 10), 0xb89a66, [0, 0.9 + i * 0.075, m.z], [Math.PI / 2, 0, 0]);
      k.cyl(m.r + 0.12, m.r + 0.16, 0.2, 8, 0x4a2e18, [0, 0.1, m.z]);
    }
    // Deck clutter: barrels, crates, rope coils. Kept to the edges, clear of guns, paths and helm.
    const barrel = (x, z, r = 0.3, h = 0.75) => {
      k.cyl(r * 0.9, r * 0.9, h, 9, 0x7a5030, [x, h / 2, z]); k.cyl(r, r, h * 0.55, 9, 0x8a5a36, [x, h / 2, z]);
      for (const y of [0.12, 0.5, 0.88]) k.cyl(r * (y === 0.5 ? 1.02 : 0.93), r * (y === 0.5 ? 1.02 : 0.93), 0.05, 9, 0x2e2a28, [x, h * y, z]);
      k.cyl(r * 0.85, r * 0.85, 0.02, 9, 0x5a3a20, [x, h + 0.005, z]);
    };
    const crate = (x, z, s = 0.6, ry = 0, y0 = 0) => {
      const r = [0, ry, 0], e = s / 2 + 0.012, c = Math.cos(ry), sn = Math.sin(ry);
      k.box(s, s, s, 0x9a6e40, [x, y0 + s / 2, z], r);
      // dark edge battens on all four sides and a diagonal brace on two faces
      for (const [dx, dz] of [[e, e], [e, -e], [-e, e], [-e, -e]]) k.box(0.05, s + 0.02, 0.05, 0x6a4628, [x + dx * c + dz * sn, y0 + s / 2, z - dx * sn + dz * c], r);
      for (const yy of [0.03, s - 0.03]) k.box(s + 0.04, 0.05, s + 0.04, 0x6a4628, [x, y0 + yy, z], r, [1, 1, 1]);
      for (const f of [-1, 1]) k.box(0.04, s * 1.25, 0.03, 0x6a4628, [x + f * e * sn, y0 + s / 2, z + f * e * c], [0, ry, Math.PI / 4]);
    };
    const coil = (x, z, r = 0.32) => { for (let i = 0; i < 3; i++) k.add(new THREE.TorusGeometry(r - i * 0.07, 0.04, 4, 12), 0xb89a66, [x, 0.04 + i * 0.06, z], [Math.PI / 2, 0, 0]); };
    barrel(2.35, -5.7); barrel(2.1, -6.35, 0.27, 0.68); crate(-2.25, -5.6, 0.62, 0.3); crate(-2.3, -5.6, 0.42, 0.9, 0.62);
    coil(-1.1, -7.9); barrel(2.45, 2.55, 0.28, 0.7); coil(-2.3, 2.4);
    if (!this.gunZ.some((gz) => Math.abs(gz - 4.25) < 1)) crate(2.4, 4.25, 0.55, 0.15);
    if (kind !== 'sloop') { barrel(-2.45, -1.9, 0.27, 0.7); coil(2.4, -1.8, 0.28); }
    const decor = k.mesh(); decor.matrixAutoUpdate = false; this.root.add(decor); this.geos.push(decor.geometry);
  }

  makeSail(w, h, mat) {
    const g = new THREE.PlaneGeometry(w, h, 6, 6).translate(0, -h / 2, 0);
    const mesh = new THREE.Mesh(g, mat);
    this.sails.push({ mesh, base: Float32Array.from(g.attributes.position.array), w, h, bulge: -1, furl: -1 });
    return mesh;
  }

  localToWorldXZ(lx, lz, out) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    out.x = this.pos.x + lx * c + lz * s; out.z = this.pos.z - lx * s + lz * c;
    return out;
  }

  // One frame for this ship. Split in three so multiplayer can share the work:
  //   step()    game rules: speed, steering, position, reloads, sinking (the host runs this)
  //   float()   bobbing on the waves, worked out from shared wave math (every headset runs this)
  //   animate() sails, flag, wheel and cannon visuals (every headset runs this)
  update(dt, t) {
    this.step(dt);
    this.float(dt, t);
    this.animate(dt, t);
  }

  step(dt) {
    if (this.alive) {
      this.speed = damp(this.speed, this.sail * this.maxSpeed * this.speedMul, 0.35, dt);
      this.heading -= this.rudder * this.turnRate * (0.3 + 0.7 * (this.speed / this.maxSpeed)) * dt;
    } else {
      this.sinkT += dt;
      this.speed = damp(this.speed, 0, 0.6, dt);
    }
    this.vel.set(-Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
    // A ship lashed to ours by grapple lines is moved by grapple.js instead
    if (!this.pinned) this.pos.addScaledVector(this.vel, dt);
    for (const c of this.cannons) {
      c.reload = Math.max(0, c.reload - dt);
      c.elevation = damp(c.elevation, c.tElev, 4, dt); c.yaw = damp(c.yaw, c.tYaw, 4, dt);
    }
  }

  float(dt, t) {
    const p = { x: 0, z: 0 };
    const hb = (this.localToWorldXZ(0, -8, p), waveHeight(p.x, p.z, t));
    const hs = (this.localToWorldXZ(0, 7, p), waveHeight(p.x, p.z, t));
    const hp = (this.localToWorldXZ(-3, 0, p), waveHeight(p.x, p.z, t));
    const hr = (this.localToWorldXZ(3, 0, p), waveHeight(p.x, p.z, t));
    const hc = (hb + hs + hp + hr) / 4;
    let pitch = Math.atan2(hb - hs, 15) * this.comfort;
    let roll = Math.atan2(hr - hp, 6) * this.comfort + this.rudder * (this.speed / this.maxSpeed) * 0.03;
    let sink = 0;
    if (!this.alive) {
      const u = this.sinkT;
      sink = u * u * 0.08 + u * 0.25;
      pitch += Math.min(0.5, u * 0.05);
      roll += this.sinkTilt * Math.min(0.6, u * 0.06);
    }
    this.pitch = damp(this.pitch, pitch, 3, dt); this.roll = damp(this.roll, roll, 3, dt);
    // heave: how much of the swell's rise and fall the hull follows (weather.js eases it for our ship in a storm)
    this.bob = damp(this.bob, hc * (this.heave ?? (0.6 + 0.4 * this.comfort)), 4, dt);
    this.root.position.set(this.pos.x, this.bob + 1.3 - sink, this.pos.z);
    this.root.rotation.set(this.pitch, this.heading, this.roll);
    this.root.updateMatrixWorld(true);
  }

  animate(dt, t) {
    // Sails
    for (const s of this.sails) {
      const furl = 0.1 + 0.9 * this.sail;
      const bulge = (this.alive ? 0.25 + 0.9 * (this.speed / this.maxSpeed) : 0.1) * s.w * 0.12;
      if (Math.abs(furl - s.furl) > 0.002 || Math.abs(bulge - s.bulge) > 0.002) {
        s.furl = furl; s.bulge = bulge; s.mesh.scale.y = furl;
        const pa = s.mesh.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const bx = s.base[i * 3], by = s.base[i * 3 + 1];
          const v = -by / s.h, u = (2 * bx) / s.w;
          pa.setZ(i, -bulge * (1 - u * u * 0.85) * Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.15)) * furl);
        }
        pa.needsUpdate = true; s.mesh.geometry.computeVertexNormals();
      }
    }
    // Flag ripple
    const fa = this.flag.geometry.attributes.position;
    for (let i = 0; i < fa.count; i++) {
      const z = this.flagBase[i * 3 + 2];
      fa.setX(i, Math.sin(z * 3.2 - t * 7) * 0.13 * z);
    }
    fa.needsUpdate = true;

    this.wheel.rotation.z = this.wheelAngle;
    if (this.lever) this.lever.rotation.x = this.leverAngle;

    // Cannons
    for (const c of this.cannons) {
      if (c.lamp) c.lamp.material = c.fuse >= 0 ? LAMP_FUSE : c.reload > 0 ? LAMP_EMPTY : LAMP_READY;
      c.elev.rotation.x = c.elevation; c.outer.rotation.y = c.baseYaw + c.yaw;
      c.recoil = Math.max(0, c.recoil - dt * 1.6);
      c.barrel.position.z = Math.sin(Math.min(1, c.recoil) * Math.PI * 0.5) * 0.4;
    }
  }

  // Move the rope ends that hang from a leaning mast (our ship only).
  updateRig() {
    if (!this.rigGeo) return;
    const pa = this.rigGeo.attributes.position, b = this.rigBase;
    for (let i = 0; i < this.rigOwner.length; i++) {
      const m = this.rigOwner[i]; if (!m) continue;
      _v.set(b[i * 3], b[i * 3 + 1] - m.group.position.y, b[i * 3 + 2] - m.group.position.z).applyMatrix4(m.group.matrix);
      pa.setXYZ(i, _v.x, _v.y, _v.z);
    }
    pa.needsUpdate = true;
  }

  containsLocal(l, pad = 0.15) {
    return l.z > BOW - 0.3 && l.z < STERN + 0.1 && l.y > -2.7 && l.y < 1.2 && Math.abs(l.x) < halfWidth(clamp(l.z, BOW, STERN)) + pad;
  }
  containsWorld(p, pad) { _v.copy(p); this.root.worldToLocal(_v); return this.containsLocal(_v, pad); }

  // Point a cannon at a target ship. Returns true if the target is inside the cannon's firing arc.
  aimCannon(c, target, err = 0) {
    c.muzzle.getWorldPosition(_v);
    const dist0 = Math.hypot(target.pos.x - _v.x, target.pos.z - _v.z);
    const T = dist0 / BALL_SPEED;
    const tx = target.pos.x + (target.vel.x - this.vel.x) * T, tz = target.pos.z + (target.vel.z - this.vel.z) * T;
    const dx = tx - _v.x, dz = tz - _v.z, R = Math.hypot(dx, dz);
    if (R > 145 || R < 9) return false;
    const nx = c.side * Math.cos(this.heading), nz = -c.side * Math.sin(this.heading);
    const ang = angleWrap(Math.atan2(dx, dz) - Math.atan2(nx, nz));
    if (Math.abs(ang) > 0.6) return false;
    const dy = target.root.position.y - 0.6 - _v.y;
    const v = BALL_SPEED, disc = v ** 4 - G_ACC * (G_ACC * R * R + 2 * dy * v * v);
    if (disc < 0) return false;
    const th = Math.atan((v * v - Math.sqrt(disc)) / (G_ACC * R));
    c.tYaw = clamp(ang + (Math.random() - 0.5) * err * 2, -0.45, 0.45);
    c.tElev = clamp(th - c.side * this.roll + (Math.random() - 0.5) * err, -0.12, 0.42);
    return true;
  }

  // The helm: the wheel and sail lever positions set the rudder and how much sail is up.
  applyHelm() {
    this.rudder = clamp(-this.wheelAngle / WHEEL_MAX, -1, 1);
    this.sail = (LEVER_MAX - this.leverAngle) / (2 * LEVER_MAX);
  }

  // Still worth fighting: afloat, still crewed, and not yet taken as a prize.
  get hostile() { return this.alive && !this.captured && !this.abandoned; }

  // Ready to fire and pointing roughly where it wants to
  cannonReady(c) { return c.reload <= 0 && c.fuse < 0 && this.alive; }
  lightCannon(c, delay = 0.4) { if (!this.cannonReady(c)) return false; c.fuse = delay; return true; }

  // A taken prize: haul down her colours and run up ours.
  strikeColors() { this.flag.material.map = flagTex('jolly'); this.flag.material.needsUpdate = true; }

  // Send her to the bottom without it counting as a kill (a prize we are done with).
  scuttle() { if (this.alive) { this.alive = false; this.health = 0; this.sail = 0; } }

  damage(n) {
    if (!this.alive) return;
    this.health -= n;
    if (this.health <= 0) { this.health = 0; this.alive = false; this.sail = 0; }
  }

  dispose() {
    this.scene.remove(this.root);
    this.geos.forEach((g) => g.dispose());
    for (const s of this.sails) s.mesh.geometry.dispose();
    this.flag.geometry.dispose();
  }
}
