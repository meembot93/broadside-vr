import * as THREE from 'three';
import { Kit, FLAT, vary, addCutlass } from './kit.js';

// Pirates in the style of the reference art: stocky, faceted low-poly shapes with flat
// shading. Each body part (body, head, two arms, two legs) is ONE merged mesh that shares
// a single material, so a whole pirate costs about six draw calls.

const SHIRTS = [0xe9e0ca, 0xe0d6be, 0xd8ccb0, 0xeae6da];
const VESTS = [0x6b4428, 0x5c3b22, 0x7a5232, 0x4f3a28, 0x3f4a36, 0x5e2b24, 0x6a5a40];
const SASHES = [0x3a3434, 0x7a2222, 0x2c3a55, 0x4a4636, 0x5a3a5a];
const PANTS = [0x2c3038, 0x353a44, 0x3b3328, 0x48402f];
const BOOTS = [0x50513f, 0x3e2d1e, 0x2e2722, 0x4a4a46];
const HAIR = [0x3a2414, 0x2a1a10, 0x17120e, 0x5a3a20, 0x6e6a64, 0x7a4a24];
const SKINS = [0xdba27c, 0xca8f68, 0xb37a52, 0x8d5a3b, 0xe2b393, 0x6e4630];

// Small seeded random, so a pirate can be rebuilt identically (e.g. for multiplayer).
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lum = (hex) => { const c = new THREE.Color(hex); return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; };

// Torso profile [radius, height] (lathe), a barrel chest that narrows to the shoulders.
const TORSO = [[0.0, 0.86], [0.205, 0.86], [0.235, 1.0], [0.255, 1.18], [0.262, 1.34], [0.24, 1.45], [0.165, 1.53], [0.06, 1.57]];
const DEPTH = 0.78; // chest is flatter front-to-back than side-to-side
const GOLD = 0xd0a03a;

function profileR(P, y) {
  for (let i = 1; i < P.length; i++) if (y <= P[i][1]) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; return r0 + (r1 - r0) * (y - y0) / Math.max(1e-6, y1 - y0); }
  return P[P.length - 1][0];
}
const lathe = (profile, seg, phiStart, phiLen) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
const grow = (P, dr) => P.map(([r, y]) => [r + dr, y]);

// An open-fronted garment (vest or coat) around the torso, with an optional ragged hem
// and gold trim down the front edges and round the hem.
function garment(k, P, color, gap, R, { ragged = 0, trim = null, seg = 14 } = {}) {
  const g = lathe(P, seg, Math.PI + gap / 2, Math.PI * 2 - gap), pos = g.attributes.position, yMin = P[0][1];
  if (ragged) for (let i = 0; i < pos.count; i++) if (pos.getY(i) < yMin + 0.01) pos.setY(i, yMin - (i % 2) * ragged * (0.4 + R()));
  k.add(g, color, 0, 0, [1, 1, DEPTH]);
  if (!trim) return;
  for (const s of [-1, 1]) {           // front edges, segment by segment along the profile
    const phi = Math.PI + s * gap / 2;
    for (let i = 1; i < P.length - 1; i++) {
      const [r0, y0] = P[i - 1], [r1, y1] = P[i];
      const a = [Math.sin(phi) * (r0 + 0.006), y0, Math.cos(phi) * (r0 + 0.006) * DEPTH], b = [Math.sin(phi) * (r1 + 0.006), y1, Math.cos(phi) * (r1 + 0.006) * DEPTH];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const m = new THREE.BoxGeometry(0.022, len + 0.01, 0.012);
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      m.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      m.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      k.add(m, trim);
    }
  }
  const hem = lathe([[P[0][0] + 0.008, yMin - 0.005], [P[0][0] + 0.008, yMin + 0.03]], seg, Math.PI + gap / 2, Math.PI * 2 - gap);
  k.add(hem, trim, 0, 0, [1, 1, DEPTH]);
}

// A band of cloth hugging the torso between two heights (same facets as the torso so it
// never dips inside it).
function torsoBand(k, T, y0, y1, dr, color) {
  const pts = [[profileR(T, y0) + dr, y0], ...T.filter(([, y]) => y > y0 && y < y1).map(([r, y]) => [r + dr, y]), [profileR(T, y1) + dr, y1]];
  k.add(lathe(pts, 8, Math.PI / 8), color, 0, 0, [1, 1, DEPTH]);
}

// Bare-midriff outfits from the newer turnarounds: 'blouse' = off-shoulder puffed white
// blouse over a laced brown corset; 'frill' = a red frilled top with a gold ring.
function buildTop(k, c, R, T) {
  k.add(lathe(T, 8, Math.PI / 8), c.skin, 0, 0, [1, 1, DEPTH]);   // bare skin underneath
  const zf = (y, dr = 0) => -(profileR(T, y) + dr) * DEPTH * 0.924;
  if (c.top === 'blouse') {
    torsoBand(k, T, 1.05, 1.35, 0.012, c.corset);
    torsoBand(k, T, 1.32, 1.47, 0.028, c.shirt);
    torsoBand(k, T, 1.455, 1.49, 0.04, vary(c.shirt, 0.06, R));            // gathered top edge
    for (const s of [-1, 1]) k.ball(0.072, 1, c.shirt, [s * 0.072, 1.39, zf(1.39, 0.0) + 0.045], 0, [1, 0.85, 0.65]);
    // Laces: a criss-cross of cream cord down the front of the corset
    for (let i = 0; i < 4; i++) {
      const y = 1.09 + i * 0.065, z = zf(y + 0.03, 0.012) - 0.006;
      for (const s of [-1, 1]) k.box(0.075, 0.009, 0.006, 0xe8dcc0, [0, y + 0.03, z], [0, 0, s * 0.75]);
      for (const s of [-1, 1]) k.box(0.012, 0.012, 0.008, 0x2a1a10, [s * 0.026, y + 0.004, z]);
    }
    k.box(0.012, 0.29, 0.006, vary(c.corset, 0.25, R), [0, 1.2, zf(1.2, 0.012) - 0.002]);
  } else {
    torsoBand(k, T, 1.31, 1.44, 0.018, c.shirt);
    for (const y of [1.305, 1.435]) torsoBand(k, T, y - 0.012, y + 0.012, 0.03, 0xf2ece0);  // white frills
    for (const s of [-1, 1]) {
      k.ball(0.07, 1, c.shirt, [s * 0.07, 1.375, zf(1.375) + 0.04], 0, [1, 0.85, 0.65]);
      k.box(0.016, 0.13, 0.01, c.shirt, [s * 0.072, 1.49, zf(1.49) + 0.01], [0.45, 0, s * 0.25]); // halter straps
    }
    k.add(new THREE.TorusGeometry(0.022, 0.007, 4, 8), GOLD, [0, 1.33, zf(1.33, 0.03) - 0.008]);
  }
}

function buildBody(k, c, R) {
  const T = c.belly ? TORSO.map(([r, y]) => [r + (y > 0.9 && y < 1.3 ? 0.035 : 0), y])
    : c.top ? TORSO.map(([r, y]) => [r - (y === 1.0 ? 0.03 : y === 1.18 ? 0.012 : 0), y]) : TORSO;   // a waist
  const zf = (y) => -profileR(T, y) * DEPTH * 0.924;
  // Hips and trousers top
  k.cyl(0.2, 0.19, 0.18, 8, c.pants, [0, 0.8, 0], 0, [1, 1, 0.82]);
  if (c.top === 'frill') k.cyl(0.198, 0.198, 0.022, 8, 0xf2ece0, [0, 0.72, 0], 0, [1, 1, 0.82]);
  if (c.top) { buildTop(k, c, R, T); } else {
  // Shirt (off-white, open V at the neck shows skin)
  k.add(lathe(T, 8, Math.PI / 8), c.shirt, 0, 0, [1, 1, DEPTH]);   // flat face at the front
  if (c.ragged) { // torn shirt hem hanging below the sash
    const h = lathe([[0.215, 0.83], [0.212, 0.9]], 10), p = h.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.84) p.setY(i, 0.8 - (i % 2) * 0.05 * R());
    k.add(h, c.shirt, 0, 0, [1, 1, DEPTH]);
  }
  // The V of bare chest: a strip that follows the chest's curve, narrowing to a point
  const vBot = c.female ? 1.42 : 1.34, rows = c.female ? [[1.53, 0.06], [1.45, 0.02], [vBot, 0]] : [[1.53, 0.062], [1.45, 0.04], [vBot, 0]];
  const V = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const [y0, w0] = rows[i], [y1, w1] = rows[i + 1], z0 = zf(y0) - 0.006, z1 = zf(y1) - 0.006;
    V.push(-w0, y0, z0, w0, y0, z0, w1, y1, z1, -w0, y0, z0, w1, y1, z1, -w1, y1, z1);
    if (w1 === 0) break;
  }
  const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  const back = vg.clone(); const bp = back.attributes.position.array;
  for (let i = 0; i < bp.length; i += 9) for (let j = 0; j < 3; j++) { const t = bp[i + 3 + j]; bp[i + 3 + j] = bp[i + 6 + j]; bp[i + 6 + j] = t; }
  vg.computeVertexNormals(); back.computeVertexNormals();
  k.add(vg, c.skin); k.add(back, c.skin);
  // Collar points folding out
  for (const s of [-1, 1]) k.box(0.075, 0.016, 0.1, c.shirt, [s * 0.085, 1.5, zf(1.5) + 0.02], [-0.9, s * 0.35, s * 0.5]);
  }
  // Vest: open at the front, ragged hem, buttons down one edge
  if (c.vest !== null) {
    const VP = [[0.228, 0.84], [0.25, 1.0], [0.27, 1.18], [0.276, 1.34], [0.254, 1.45], [0.18, 1.535], [0.12, 1.555]].map(([r, y]) => [r + (c.belly && y > 0.9 && y < 1.3 ? 0.035 : 0), y]);
    garment(k, VP, c.vest, 0.8, R, { ragged: c.ragged ? 0.09 : 0.05 });
    const ex = -Math.sin(0.4), ez = -Math.cos(0.4);
    for (const y of [0.98, 1.1, 1.22]) { const r = profileR(VP, y) + 0.004; k.box(0.024, 0.024, 0.012, 0x9a958a, [ex * r - 0.02, y, ez * r * DEPTH - 0.004]); }
  }
  // Long coat with gold trim (captains)
  if (c.coat !== null) {
    const CP = [[0.31, 0.42], [0.285, 0.7], [0.26, 0.9], [0.268, 1.0], [0.282, 1.18], [0.288, 1.34], [0.264, 1.45], [0.19, 1.535], [0.13, 1.56]];
    garment(k, CP, c.coat, 0.75, R, { trim: c.trim, seg: 16 });
    // big buttons
    for (const y of [1.0, 1.12, 1.24]) for (const s of [-1, 1]) k.box(0.026, 0.026, 0.014, c.trim, [s * 0.13, y, -profileR(CP, y) * DEPTH * 0.93 - 0.012]);
  }
  // Sash wound around the waist with a tail at the hip, then the belt with brass buckle
  k.cyl(0.222 + (c.belly ? 0.03 : 0), 0.215 + (c.belly ? 0.02 : 0), 0.1, 10, c.sash, [0, 0.9, 0], 0, [1, 1, 0.84]);
  if (!c.top) k.box(0.075, c.longSash ? 0.36 : 0.2, 0.025, c.sash, [-0.19, c.longSash ? 0.72 : 0.8, -0.1], [0.1, 0.5, 0.12]);
  if (c.ring) k.add(new THREE.TorusGeometry(0.045, 0.011, 4, 10), GOLD, [0, 0.9, -0.19]);   // big gold ring buckle
  if (c.belt) {
    k.cyl(0.212, 0.208, 0.05, 10, 0x3a2414, [0, 0.83, 0], 0, [1, 1, 0.84]);
    k.box(0.075, 0.06, 0.02, 0xc29a3a, [0, 0.83, -0.182]);
    k.box(0.045, 0.032, 0.022, 0x3a2414, [0, 0.83, -0.184]);
  }
  // Baldric: a leather strap across the chest from the left shoulder to the right hip
  if (c.baldric) {
    const fz = c.coat !== null ? -0.215 : -0.205;
    k.box(0.05, 0.62, 0.014, 0x4a2a18, [0.0, 1.2, fz], [0.08, 0, 0.62]);
    k.box(0.05, 0.62, 0.014, 0x4a2a18, [0.0, 1.2, 0.205], [-0.08, 0, -0.62]);
    k.box(0.04, 0.04, 0.02, 0xc29a3a, [-0.06, 1.28, fz - 0.012], [0, 0, 0.62]);
  }
  // Neck
  k.cyl(0.066, 0.078, 0.14, 6, c.skin, [0, 1.6, 0.005]);
}

function hairChain(k, color, pts, r0, r1) {
  pts.forEach((p, i) => k.ball(r0 + (r1 - r0) * i / (pts.length - 1), 0, color, p, [0, i, 0], [1, 1.25, 1]));
}

function buildHead(k, c, R) {
  const skin = c.skin, hair = c.hair;
  const face = k.ball(0.125, 2, skin, [0, 0, 0], 0, c.female ? [0.9, 1.04, 0.98] : [0.94, 1.1, 1.0]);
  { // brighten the underside a little (fake bounce light) so a bare chin doesn't read as a beard
    const p = face.attributes.position, col = face.attributes.color;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) { const f = 1 + Math.min(0.7, -y * 6); col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f); } }
  }
  const nose = c.female ? [0.022, 0.05] : [0.03, 0.075];
  k.add(new THREE.ConeGeometry(nose[0], nose[1], 4).rotateX(-Math.PI / 2), vary(skin, 0.06, R), [0, -0.015, -0.128], [0, 0, Math.PI / 4], [1, 1.3, 1]);
  k.box(0.034, 0.05, 0.03, skin, [-0.115, 0, 0.0]); k.box(0.034, 0.05, 0.03, skin, [0.115, 0, 0.0]);  // ears
  if (c.earrings) for (const s of [-1, 1]) k.add(new THREE.TorusGeometry(0.02, 0.0055, 3, 8), GOLD, [s * 0.122, -0.055, -0.005], [0, Math.PI / 2, 0]);
  // Eyes and brows (one eye may be under a patch)
  const patchSide = c.patch ? (R() < 0.5 ? -1 : 1) : 0;
  for (const s of [-1, 1]) {
    if (s === patchSide) continue;
    k.box(0.04, 0.026, 0.01, 0xf0ebe0, [s * 0.042, 0.012, -0.116]);
    k.box(0.019, 0.022, 0.01, c.eyes ?? (c.female ? 0x3a5a3a : 0x2a1a10), [s * 0.042, 0.012, -0.121]);
  }
  for (const s of [-1, 1]) k.box(c.female ? 0.045 : 0.055, c.female ? 0.01 : 0.016, 0.03, hair, [s * 0.044, 0.042, -0.113], [0, 0, s * (c.female ? 0.12 : -0.22)]);
  if (patchSide) {
    k.box(0.052, 0.048, 0.016, 0x141414, [patchSide * 0.044, 0.014, -0.12], [0, patchSide * 0.25, 0]);
    k.add(new THREE.TorusGeometry(0.128, 0.0055, 3, 16), 0x141414, [0, 0.03, 0.002], [Math.PI / 2, patchSide * -0.32, 0], [0.96, 1.04, 1]);
  }
  // Hair at the back and sides; long styles add braids or a ponytail
  k.add(new THREE.SphereGeometry(0.131, 8, 4, 0, Math.PI, Math.PI * 0.25, Math.PI * (c.female ? 0.55 : 0.42)), hair, [0, 0, 0], 0, [0.97, 1.1, 1.0]);
  if (c.hairStyle === 'braids') for (const s of [-1, 1]) {
    hairChain(k, hair, [[s * 0.1, -0.06, 0.02], [s * 0.12, -0.14, 0.0], [s * 0.13, -0.22, -0.02], [s * 0.135, -0.3, -0.04], [s * 0.135, -0.37, -0.05]], 0.034, 0.022);
    if (c.tie) { k.cyl(0.024, 0.024, 0.025, 6, c.tie, [s * 0.135, -0.41, -0.05]); hairChain(k, hair, [[s * 0.135, -0.44, -0.05], [s * 0.135, -0.48, -0.05]], 0.022, 0.012); }
  }
  if (c.hairStyle === 'sidebraid' || c.hairStyle === 'twinbraids') {  // braids forward over the shoulders
    const sb = (sx) => { // a braid that comes forward over the shoulder and hangs down the chest
      const P = [[sx * 0.1, -0.05, 0.02], [sx * 0.13, -0.12, -0.06], [sx * 0.145, -0.2, -0.13], [sx * 0.15, -0.28, -0.175], [sx * 0.15, -0.36, -0.19], [sx * 0.15, -0.44, -0.195]];
      const dense = []; // twice as many links, so it reads as a plait rather than beads
      P.forEach((p, i) => { dense.push(p); if (i < P.length - 1) dense.push(p.map((v, j) => (v + P[i + 1][j]) / 2)); });
      hairChain(k, hair, dense, 0.036, 0.024);
      k.cyl(0.024, 0.024, 0.025, 6, c.tie ?? 0x9a2a22, [sx * 0.15, -0.48, -0.195]);
      hairChain(k, hair, [[sx * 0.15, -0.51, -0.195], [sx * 0.15, -0.55, -0.195]], 0.022, 0.012);
    };
    sb(1); if (c.hairStyle === 'twinbraids') sb(-1);
    for (const s of [-1, 1]) k.box(0.05, 0.11, 0.03, hair, [s * 0.1, -0.03, -0.075], [0, s * 0.5, s * 0.1]);  // locks framing the face
  }
  if (c.hairStyle === 'ponytail') hairChain(k, hair, [[0, 0.0, 0.13], [0, -0.08, 0.15], [0, -0.17, 0.15], [0, -0.26, 0.14], [0, -0.33, 0.13]], 0.045, 0.025);
  if (c.hairStyle === 'braid') hairChain(k, hair, [[0, -0.03, 0.12], [0, -0.11, 0.135], [0, -0.19, 0.14], [0, -0.27, 0.14], [0, -0.35, 0.135], [0, -0.42, 0.13]], 0.035, 0.024);
  // Facial hair
  const lowerFace = (r, t0, t1) => new THREE.SphereGeometry(r, 9, 3, Math.PI - 0.25, Math.PI + 0.5, Math.PI * t0, Math.PI * t1);
  if (c.beard === 'full' || c.beard === 'big') {
    const big = c.beard === 'big';
    k.add(lowerFace(0.133, 0.55, 0.42), hair, [0, 0, 0], 0, [0.96, 1.1, 1.02]);
    k.add(new THREE.ConeGeometry(big ? 0.12 : 0.1, big ? 0.26 : 0.17, 7).rotateX(Math.PI), hair, [0, big ? -0.16 : -0.13, -0.045], [-0.2, 0, 0], [1, 1, 0.75]);
  } else if (c.beard === 'goatee') {
    k.add(new THREE.ConeGeometry(0.045, 0.12, 5).rotateX(Math.PI), hair, [0, -0.125, -0.09], [-0.35, 0, 0], [1, 1, 0.7]);
  } else if (c.beard === 'stubble') {
    k.add(lowerFace(0.128, 0.6, 0.35), new THREE.Color(skin).lerp(new THREE.Color(hair), 0.45).getHex(), [0, 0, 0], 0, [0.95, 1.1, 1.0]);
  }
  if (c.beard !== 'none') for (const s of [-1, 1]) k.box(0.06, 0.022, 0.03, hair, [s * 0.026, -0.05, -0.126], [0, 0, s * -0.35]);
  k.box(c.female ? 0.034 : 0.042, c.female ? 0.014 : 0.012, 0.01, c.female ? 0x9a4a40 : 0x4a1e18, [0, -0.072, -0.124]);
  // Headwear
  if (c.hat !== undefined) {
    if (c.band !== null) k.cyl(0.13, 0.13, 0.035, 10, c.band, [0, 0.065, 0], 0, [0.97, 1, 1.03]);
    k.cyl(0.108, 0.132, 0.11, 7, c.hat, [0, 0.135, 0.01]);                  // crown
    k.cyl(0.11, 0.11, 0.025, 7, c.hatTrim ?? vary(c.hat, 0.25, R), [0, 0.095, 0.01]);
    // Three-cornered brim: a flat triangle with its three sides turned up, one corner forward
    const Rb = 0.27, y0 = 0.085;
    k.cyl(Rb, Rb, 0.018, 3, c.hat, [0, y0, 0.015], [0, Math.PI, 0]);
    for (let i = 0; i < 3; i++) {
      const th = Math.PI + Math.PI / 3 + i * Math.PI * 2 / 3, tilt = 0.42 + (i === 1 ? 0.12 : 0);
      const place = (geo) => { geo.rotateX(tilt).rotateY(th).translate(Math.sin(th) * Rb * 0.5, y0, Math.cos(th) * Rb * 0.5 + 0.015); return geo; };
      k.add(place(new THREE.BoxGeometry(Rb * Math.sqrt(3) * 1.02, 0.11, 0.018).translate(0, 0.05, 0)), c.hat);
      if (c.hatTrim) k.add(place(new THREE.BoxGeometry(Rb * Math.sqrt(3) * 1.0, 0.014, 0.024).translate(0, 0.106, 0)), c.hatTrim);
    }
    if (c.feather) { // a white plume sweeping back from the side
      for (let i = 0; i < 4; i++) k.box(0.05 - i * 0.008, 0.012, 0.09, 0xf2efe8, [0.17 + i * 0.012, 0.17 + i * 0.035, 0.03 + i * 0.05], [0.5 + i * 0.25, 0.3, 0.6]);
    }
  } else if (c.bandana !== undefined) {
    // Cap made of horizontal bands, so a second colour gives stripes
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const col = c.stripe !== undefined && i % 2 ? c.stripe : c.bandana;
      k.add(new THREE.SphereGeometry(0.136, 8, 1, 0, Math.PI * 2, Math.PI * 0.5 * i / bands, Math.PI * 0.5 / bands), col, [0, 0.03, 0.0], 0, [0.97, 1.0, 1.03]);
    }
    k.cyl(0.137, 0.137, 0.03, 10, vary(c.bandana, 0.2, R), [0, 0.045, 0], 0, [0.97, 1, 1.03]);
    k.ball(0.03, 0, c.bandana, [0.04, 0.0, 0.135]);
    k.box(0.04, 0.12, 0.012, c.bandana, [0.03, -0.06, 0.14], [0.2, 0, 0.25]);
    k.box(0.04, 0.1, 0.012, c.stripe ?? c.bandana, [0.065, -0.05, 0.135], [0.25, 0, -0.15]);
    if (c.skull) { // white skull and crossbones on the front and back of the bandana
      for (const [z, rx] of [[-0.1, -0.85], [0.105, 0.85]]) {
        const y = 0.1, sz = Math.sign(z);
        k.ball(0.024, 0, 0xf2ece0, [0, y + 0.012, z + sz * 0.012], [rx, 0, 0], [1, 1, 0.5]);
        for (const s of [-1, 1]) k.box(0.075, 0.011, 0.008, 0xf2ece0, [0, y - 0.012, z + sz * 0.02], [rx, 0, s * 0.5]);
        for (const s of [-1, 1]) k.box(0.008, 0.008, 0.006, 0x1a1414, [s * 0.009, y + 0.016, z + sz * 0.024], [rx, 0, 0]);
      }
    }
  } else {
    k.add(new THREE.SphereGeometry(0.133, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.32), hair, [0, 0.0, 0.0], 0, [0.97, 1.1, 1.02]);
  }
}

function buildArm(k, c, side, cutlass) {
  if (c.coat !== null) {          // coat sleeve all the way down, big turned-back cuff with gold edge
    k.ball(0.078, 0, c.coat, [0, -0.03, 0]);
    k.cyl(0.084, 0.07, 0.48, 7, c.coat, [0, -0.25, 0]);
    k.cyl(0.085, 0.08, 0.1, 7, c.cuff, [0, -0.49, 0]);
    k.cyl(0.087, 0.087, 0.018, 7, c.trim, [0, -0.44, 0]);
    k.cyl(0.05, 0.05, 0.05, 6, c.shirt, [0, -0.55, 0]);             // a bit of shirt cuff
  } else if (c.sleeve === 'puff') {   // off-shoulder puffed sleeve, bare arm
    k.ball(0.092, 1, c.shirt, [0, -0.06, 0], 0, [1, 0.95, 1]);
    k.cyl(0.072, 0.075, 0.025, 7, vary(c.shirt, 0.06, Math.random), [0, -0.135, 0]);
    k.cyl(0.058, 0.054, 0.22, 6, c.skin, [0, -0.25, 0]);
    k.cyl(0.054, 0.046, 0.27, 6, c.skin, [0, -0.47, 0]);
  } else if (c.sleeve === 'band') {   // bare arm with a frilled cloth band round the top
    k.ball(0.064, 0, c.skin, [0, -0.02, 0]);
    k.cyl(0.062, 0.056, 0.3, 6, c.skin, [0, -0.2, 0]);
    k.cyl(0.07, 0.068, 0.06, 7, c.armband, [0, -0.1, 0]);
    for (const y of [-0.07, -0.13]) k.cyl(0.074, 0.074, 0.01, 7, 0xf2ece0, [0, y, 0]);
    k.cyl(0.054, 0.046, 0.27, 6, c.skin, [0, -0.47, 0]);
  } else if (c.sleeve === 'short') { // torn short sleeve, bare arms
    k.ball(0.074, 0, c.shirt, [0, -0.03, 0]);
    k.cyl(0.085, 0.08, 0.16, 7, c.shirt, [0, -0.09, 0]);
    k.cyl(0.07, 0.065, 0.2, 6, c.skin, [0, -0.25, 0]);
    k.cyl(0.064, 0.052, 0.27, 6, c.skin, [0, -0.47, 0]);
  } else {                         // rolled sleeves
    k.ball(0.074, 0, c.shirt, [0, -0.03, 0]);
    k.cyl(0.08, 0.07, 0.3, 7, c.shirt, [0, -0.17, 0]);
    k.cyl(0.082, 0.078, 0.08, 7, vary(c.shirt, 0.07, Math.random), [0, -0.33, 0]);
    k.cyl(0.062, 0.05, 0.25, 6, c.skin, [0, -0.47, 0]);
  }
  k.box(0.072, 0.1, 0.085, c.skin, [0, -0.635, -0.005]);                     // fist
  k.box(0.03, 0.05, 0.03, c.skin, [side * -0.035, -0.61, -0.045], [0, 0, side * 0.3]); // thumb
  if (cutlass) addCutlass(k, 0.66, [0, -0.635, -0.005]);
}

function buildLeg(k, c, style) {
  if (style === 'peg') {
    k.cyl(0.1, 0.088, 0.36, 7, c.pants, [0, -0.17, 0]);
    k.cyl(0.092, 0.07, 0.12, 7, 0x4a3020, [0, -0.39, 0]);         // leather cup
    k.cyl(0.045, 0.03, 0.4, 6, 0x9a6a3a, [0, -0.62, 0]);          // wooden peg
    k.cyl(0.036, 0.036, 0.03, 6, 0x3a2a1a, [0, -0.81, 0]);
    return;
  }
  if (style === 'thigh') {         // thigh-high heeled boots with buckled straps
    if (c.shorts) {
      k.cyl(0.108, 0.102, 0.16, 8, c.pants, [0, -0.07, 0]);
      k.cyl(0.113, 0.111, 0.045, 8, vary(c.pants, 0.12, Math.random), [0, -0.15, 0]);  // rolled hem
      k.cyl(0.09, 0.086, 0.16, 7, c.skin, [0, -0.22, 0]);
    } else k.cyl(0.098, 0.086, 0.3, 7, c.skin, [0, -0.15, 0]);
    k.cyl(0.1, 0.096, 0.07, 7, vary(c.boots, 0.12, Math.random), [0, -0.31, 0]);      // turned top
    k.cyl(0.09, 0.07, 0.42, 7, c.boots, [0, -0.55, 0]);
    for (const [y, r] of [[-0.36, 0.093], [-0.52, 0.084], [-0.7, 0.073]]) {
      k.cyl(r + 0.006, r + 0.004, 0.035, 7, vary(c.boots, 0.25, Math.random), [0, y, 0]);
      k.box(0.03, 0.03, 0.012, GOLD, [r * 0.55, y, -r * 0.85], [0, 0.6, 0]);
    }
    k.box(0.1, 0.08, 0.19, c.boots, [0, -0.755, -0.065]);
    k.box(0.06, 0.08, 0.06, 0x2a1d14, [0, -0.77, 0.035]);          // heel
    k.box(0.105, 0.02, 0.15, 0x1e1712, [0, -0.8, -0.085]);
    return;
  }
  if (style === 'bare') {          // cropped, ragged trousers and bare feet
    const t = lathe([[0.084, -0.46], [0.1, 0.0]], 8), p = t.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.45) p.setY(i, -0.46 - (i % 2) * 0.05);
    k.add(t, c.pants);
    k.cyl(0.062, 0.05, 0.36, 6, c.skin, [0, -0.62, 0]);
    k.box(0.1, 0.06, 0.22, c.skin, [0, -0.785, -0.05]);
    return;
  }
  k.cyl(0.1, 0.084, 0.5, 7, c.pants, [0, -0.24, 0]);
  k.cyl(0.104, 0.098, 0.13, 7, vary(c.boots, 0.1, Math.random), [0, -0.46, 0]);  // turned-down cuff
  k.cyl(0.086, 0.08, 0.28, 7, c.boots, [0, -0.62, 0]);
  k.box(0.12, 0.09, 0.23, c.boots, [0, -0.77, -0.045]);
  k.box(0.13, 0.024, 0.245, 0x1e1712, [0, -0.81, -0.045]);
}

// The archetypes from the reference turnarounds. Each sets clothing and body; colours left
// open are picked at random. 'sailor' is the model-sheet pirate.
const TYPES = {
  sailor: (R, pick) => ({ hat: pick([0x4a3626, 0x3e2e22, 0x55402c]), band: 0x8e2a22 }),
  deckhand: (R, pick) => ({ bandana: pick([0x6a8aa0, 0x8a7a60, 0x7a3a30]), stripe: 0xd8d4c8, vest: pick([0x6a6a58, 0x5a5a4c, 0x6a5a48]), ragged: true, legs: 'bare', beard: 'stubble', patch: false, belt: false, sash: pick([0x6a5a40, 0x4a4636]) }),
  swashbuckler: (R, pick) => ({ female: true, ...(R() < 0.5 ? { bandana: 0xb03a2a } : { hat: 0x4a3626, band: 0x9a3a2a }), vest: pick([0x7a4a2a, 0x6b4428]), sash: 0xc0392b, longSash: true, beard: 'none', patch: false, hairStyle: 'braids', hair: pick([0x7a4a24, 0x5a3a20, 0x9a6a34]), boots: 0x5a3a24, baldric: true }),
  officer: (R, pick) => ({ female: true, hat: 0x463a6a, hatTrim: GOLD, feather: true, band: null, coat: 0x34507a, cuff: 0x2a4064, trim: GOLD, vest: null, sash: 0x6a3a8a, longSash: true, beard: 'none', patch: R() < 0.3, hairStyle: 'ponytail', hair: pick([0x9a6a34, 0x7a4a24, 0x3a2414]), boots: 0x5a3a24, baldric: true }),
  captain: (R, pick) => ({ hat: pick([0x7a2424, 0x6a1e2a]), hatTrim: GOLD, band: null, coat: pick([0x3a3430, 0x2e2c2e, 0x3a2a24]), cuff: 0x6a2424, trim: GOLD, vest: null, beard: 'full', patch: R() < 0.6, baldric: true, sash: 0x2a2424 }),
  gunner: (R, pick) => ({ bulk: 1.12, belly: true, bandana: pick([0x2f5a8a, 0x3a6a9a]), vest: null, sleeve: 'short', ragged: true, beard: 'big', patch: R() < 0.6, legs: R() < 0.5 ? 'peg' : 'boot', sash: pick([0x6a6448, 0x5a5440]), belt: false }),
  // Type 6: brunette, long braid over the shoulder, off-shoulder blouse and laced corset
  rogue: (R, pick) => ({ female: true, skin: pick([0xdba27c, 0xca8f68, 0xe2b393]), top: 'blouse', bandana: 0xa8282a, earrings: true, shirt: 0xeee8dc, corset: pick([0x6a4428, 0x5e3c24]), vest: null, sleeve: 'puff', sash: 0x2e2a28, belt: false, pants: pick([0x6a4c34, 0x5e4430]), shorts: true, legs: 'thigh', boots: pick([0x5a3a24, 0x4e3220]), beard: 'none', patch: false, hairStyle: 'sidebraid', tie: 0x9a2a22, hair: pick([0x3a2414, 0x2e1c10, 0x4a2c18]) }),
  // Type 7: blonde twin braids, skull bandana, red frilled top, black sash with a gold ring
  raider: (R, pick) => ({ female: true, skin: pick([0xe2b393, 0xdba27c, 0xe8bc9c]), top: 'frill', bandana: 0xa8282a, skull: true, earrings: true, eyes: 0x3a6aa0, shirt: 0xb02a2a, armband: 0xb02a2a, vest: null, sleeve: 'band', sash: 0x1e1a1a, ring: true, belt: false, pants: 0xa82828, shorts: false, legs: 'thigh', boots: pick([0x4a3020, 0x3e2a1c]), beard: 'none', patch: false, hairStyle: 'twinbraids', tie: GOLD, hair: pick([0xd8b060, 0xc89e50, 0xe0c070]) }),
};
export const PIRATE_TYPES = Object.keys(TYPES);

// A low-poly pirate. Faces -Z. Feet at y=0.
// Options (all optional; anything left out is picked at random):
//  type   - one of PIRATE_TYPES ('sailor', 'deckhand', 'swashbuckler', 'officer', 'captain', 'gunner', 'rogue', 'raider')
//  shirt  - older "main colour" option: a dark value becomes the vest (enemies), a light one the shirt
//  vest, coat, sash, pants, boots, skin, hair: colours
//  hat: tricorn colour; bandana: bandana colour
//  beard: a colour (full beard) or 'full' | 'big' | 'goatee' | 'stubble' | 'none'
//  patch: eye patch; cutlass: carries one; seed: number for a repeatable look
export function makePerson(o = {}) {
  const R = rng(o.seed ?? Math.floor(Math.random() * 1e9));
  const pick = (a) => a[Math.floor(R() * a.length)];
  // Without a type, guess one from the old-style options so existing callers get variety.
  let type = o.type;
  if (!type) type = o.hat !== undefined ? pick(['sailor', 'sailor', 'swashbuckler']) : o.bandana !== undefined ? pick(['deckhand', 'gunner', 'swashbuckler', 'sailor']) : pick(['sailor', 'deckhand']);
  const T = TYPES[type](R, pick);
  const c = {
    skin: o.skin ?? T.skin ?? pick(SKINS), hair: o.hair ?? T.hair ?? pick(HAIR),
    shirt: pick(SHIRTS), vest: pick(VESTS), coat: null, cuff: null, trim: GOLD,
    sash: pick(SASHES), pants: pick(PANTS), boots: pick(BOOTS),
    patch: R() < 0.35, beard: (['full', 'full', 'goatee', 'stubble', 'none'])[Math.floor(R() * 5)],
    belt: true, legs: 'boot', sleeve: 'rolled', hairStyle: 'short', band: pick([0x8e2a22, 0x8e2a22, ...SASHES]),
    ...T,
  };
  for (const key of ['vest', 'coat', 'sash', 'pants', 'boots', 'patch', 'hair']) if (o[key] !== undefined) c[key] = o[key];
  if (c.female && c.hairStyle === 'short') c.hairStyle = 'braid';
  // Old-style colour options
  if (o.hat !== undefined) { c.hat = o.hat; c.bandana = undefined; }
  else if (o.bandana !== undefined) { c.bandana = o.bandana; c.hat = undefined; }
  if (o.shirt !== undefined) {
    if (lum(o.shirt) < 0.35) { if (c.vest !== null && o.vest === undefined) c.vest = o.shirt; else if (c.coat !== null) c.coat = o.shirt; if (lum(o.shirt) < 0.05) c.shirt = vary(0xb8ad94, 0.08, R); }
    else c.shirt = o.shirt;
  }
  if (o.beard !== undefined && !c.female) { if (typeof o.beard === 'number') { c.hair = o.beard; if (c.beard === 'none' || c.beard === 'stubble') c.beard = 'full'; } else c.beard = o.beard; }
  if (c.hat !== undefined && lum(c.hat) < 0.02) c.hat = vary(0x2a2018, 0.2, R); // pure black reads as a hole

  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const bulk = (c.bulk ?? (c.female ? 0.88 : 1)) * (0.96 + R() * 0.08);
  body.scale.set(bulk, (c.female ? 0.95 : 0.97) + R() * 0.05, bulk);
  let k = new Kit(); buildBody(k, c, R); body.add(k.mesh());
  const head = new THREE.Group(); head.position.y = 1.72; body.add(head);
  if (bulk > 1.05) head.scale.setScalar(1 / Math.sqrt(bulk));
  k = new Kit(); buildHead(k, c, R); head.add(k.mesh());
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.82, 0);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.82, 0);
  k = new Kit(); buildLeg(k, c, c.legs === 'peg' ? 'boot' : c.legs); const legGeo = k.geometry();
  legL.add(new THREE.Mesh(legGeo, FLAT));
  if (c.legs === 'peg') { k = new Kit(); buildLeg(k, c, 'peg'); legR.add(k.mesh()); } else legR.add(new THREE.Mesh(legGeo, FLAT));
  body.add(legL, legR);
  const armL = new THREE.Group(); armL.position.set(-0.305, 1.45, 0);
  const armR = new THREE.Group(); armR.position.set(0.305, 1.45, 0);
  k = new Kit(); buildArm(k, c, -1, false); armL.add(k.mesh());
  k = new Kit(); buildArm(k, c, 1, false); armR.add(k.mesh());
  // The cutlass is its own mesh so it can be drawn (shown) when a fight starts
  k = new Kit(); addCutlass(k, 0.66, [0, -0.635, -0.005]); const sword = k.mesh(); sword.visible = !!o.cutlass; armR.add(sword);
  body.add(armL, armR);
  armL.rotation.z = -0.1; armR.rotation.z = 0.1;
  return { g, body, legL, legR, armL, armR, head, sword, type, phase: Math.random() * 6, attack: -1, cheer: 0, pose: null, dead: false, deadT: 0, lookT: 0 };
}

// attack: progress 0..1 of a swing (set p.attack = 0 to start one)
export function animatePerson(p, dt, moving, t = 0) {
  if (p.dead) {
    p.deadT += dt;
    const u = Math.min(1, p.deadT / 0.6);
    p.body.rotation.x = -u * u * Math.PI * 0.48;
    p.armL.rotation.x = p.armR.rotation.x = -u * 1.2;
    return;
  }
  if (moving) p.phase += dt * 8; else p.phase *= Math.max(0, 1 - dt * 6);
  const s = Math.sin(p.phase) * (moving ? 1 : Math.min(1, Math.abs(p.phase)));
  p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
  let al = -s * 0.5, ar = s * 0.5;
  if (!moving) { al += Math.sin(t * 1.3 + p.phase) * 0.04; ar -= Math.sin(t * 1.1) * 0.04; }
  // Work poses (only while standing still): steer, haul, ram, point
  p.body.rotation.x = 0;
  if (!moving && p.pose) {
    const w = t * 3 + p.phase;
    if (p.pose === 'steer') { al = 1.15 + Math.sin(t * 0.7) * 0.12; ar = 1.15 - Math.sin(t * 0.7) * 0.12; }
    else if (p.pose === 'haul') { const k = Math.sin(w); al = -1.6 + k * 1.0; ar = -1.6 - k * 1.0; p.body.rotation.x = 0.12; }
    else if (p.pose === 'ram') { const k = Math.sin(w * 1.4); al = ar = 1.25 + k * 0.35; p.body.rotation.x = -0.12 - k * 0.06; }
    else if (p.pose === 'point') { ar = 1.55; }
    else if (p.pose === 'aim') { al = 1.45; ar = 1.15; }
  }
  if (p.attack >= 0) {
    p.attack += dt / 0.55;
    const u = p.attack;
    ar = u < 0.45 ? -2.6 * (u / 0.45) : -2.6 + 3.3 * Math.min(1, (u - 0.45) / 0.35);
    if (u >= 1) p.attack = -1;
  }
  if (p.cheer > 0) {
    p.cheer -= dt;
    const w = Math.sin(t * 9) * 0.25;
    al = -2.8 + w; ar = -2.8 - w;
  }
  p.armL.rotation.x = al; p.armR.rotation.x = ar;
}

export function facePerson(p, dx, dz, dt, rate = 8) {
  const target = Math.atan2(-dx, -dz);
  let d = target - p.g.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  p.g.rotation.y += d * Math.min(1, dt * rate);
}
