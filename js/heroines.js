import * as THREE from 'three';
import { vary } from './kit.js';

// A curvier, more detailed figure for the two pirate women from Meem's newer turnarounds
// ('rogue' and 'raider' in people.js). Same faceted, flat-shaded style and the same
// six-part rig (body, head, two arms, two legs) as every other pirate, just sculpted
// closer to the reference: a waist, hips and bust, smooth shoulders, plaited braids,
// thigh-high heeled boots and a fuller face.

const GOLD = 0xd0a03a, FRILL = 0xf4eee2;
const SEG = 12, D = 0.74;          // torso: lathe segments (a vertex points straight forward) and front-back depth
export const HERO_ARM_X = 0.222, HERO_LEG_X = 0.1, HERO_HEAD_SCALE = 1.06;

// Torso profile [radius, height]: hips, narrow waist, ribcage, bust line, shoulders, neck
const TORSO = [[0, 0.84], [0.195, 0.84], [0.172, 0.93], [0.15, 1.03], [0.158, 1.13], [0.18, 1.23], [0.193, 1.31], [0.19, 1.38], [0.168, 1.44], [0.12, 1.5], [0.06, 1.545]];
const rAt = (P, y) => {
  for (let i = 1; i < P.length; i++) if (y <= P[i][1]) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; return r0 + (r1 - r0) * (y - y0) / Math.max(1e-6, y1 - y0); }
  return P[P.length - 1][0];
};
// (points must run bottom-up for the faces to point outward, so flip a top-down list)
const lathe = (P, seg = SEG, phi0 = 0) => new THREE.LatheGeometry((P[0][1] > P[P.length - 1][1] ? [...P].reverse() : P).map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0);
const front = (y, dr = 0) => -(rAt(TORSO, y) + dr) * D;   // z of the torso's front at height y
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// A band of cloth hugging the torso between two heights.
function band(k, y0, y1, dr, color) {
  const P = [[rAt(TORSO, y0) + dr, y0], ...TORSO.filter(([, y]) => y > y0 && y < y1).map(([r, y]) => [r + dr, y]), [rAt(TORSO, y1) + dr, y1]];
  k.add(lathe(P), color, 0, 0, [1, 1, D]);
}

// Place a geometry built facing -Z so that it faces along `normal` at `at`.
const _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(0, 0, -1);
function facing(geo, at, normal) {
  _q.setFromUnitVectors(_fwd, new THREE.Vector3(...normal).normalize());
  return geo.applyQuaternion(_q).translate(...at);
}

// A plaited braid: overlapping lobes that lean alternately left and right along a curve.
function plait(k, color, pts, r0, r1) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const n = Math.max(4, Math.round(curve.getLength() / (Math.min(r0, r1) * 1.1)));
  const down = new THREE.Vector3(0, -1, 0), z = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), tw = new THREE.Quaternion();
  const dark = vary(color, 0.12, () => 0.1);
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    q.setFromUnitVectors(down, curve.getTangentAt(t));
    tw.setFromAxisAngle(z, (i % 2 ? 1 : -1) * 0.6);
    const g = new THREE.IcosahedronGeometry(r, 0).scale(1, 1.6, 0.8).applyQuaternion(tw).applyQuaternion(q).translate(p.x, p.y, p.z);
    k.add(g, i % 2 ? color : dark);
  }
  return curve.getPointAt(1);
}

// ---------------------------------------------------------------- body
export function heroBody(k, c, R) {
  const skin = c.skin;
  // Hips (bottoms / shorts) and the bare torso
  const hips = lathe([[0, 0.725], [0.12, 0.73], [0.192, 0.765], [0.214, 0.81], [0.205, 0.85], [0.192, 0.875]]);
  if (!c.shorts) { // bikini cut: the leg openings rise towards the hips
    const p = hips.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.8) p.setY(i, y + (0.8 - y) * Math.min(1, Math.abs(p.getX(i)) / 0.2) * 0.75); }
  }
  k.add(hips, c.pants, 0, 0, [1, 1, 0.82]);
  // A full, rounded rear
  for (const s of [-1, 1]) k.ball(0.112, 1, c.pants, [s * 0.082, 0.785, 0.05], [0.25, s * -0.2, 0], [1, 1.0, 0.85]);
  k.add(lathe(TORSO), skin, 0, 0, [1, 1, D]);
  // Rounded shoulders: blend the torso into the arms
  // Bust: full rounded skin shapes set close together (cleavage), with the top's cups
  // covering only the lower part and a trim along the cut edge.
  const BY = 1.3, BX = 0.078, BR = 0.128, bz = front(BY) + 0.058, BS = [1, 0.92, 0.9];
  const bust = (col, cut, trim) => {
    for (const s of [-1, 1]) {
      const at = [s * BX, BY, bz], rot = [0.12, s * 0.28, 0];
      k.ball(BR, 1, skin, at, rot, BS);
      if (col !== null) k.add(new THREE.SphereGeometry(BR * 1.04, 12, 8, 0, Math.PI * 2, Math.PI * cut, Math.PI * (1 - cut)), col, at, rot, BS);
      if (trim !== null) k.add(new THREE.TorusGeometry(BR * 1.04 * Math.sin(Math.PI * cut), 0.009, 3, 14).rotateX(Math.PI / 2).translate(0, BR * 1.04 * Math.cos(Math.PI * cut), 0), trim, at, rot, BS);
    }
    k.box(0.007, BR * 0.85, 0.008, mix(skin, 0x6a3a2a, 0.35), [0, BY + 0.01, bz - BR * 0.58]);   // the shadow between them
  };

  if (c.top === 'bikini') {
    bust(c.shirt, 0.4, FRILL);
    band(k, 1.235, 1.275, 0.012, c.shirt);                  // under-band
    band(k, 1.228, 1.24, 0.02, FRILL);                       // frill under it
    for (const s of [-1, 1]) {
      // halter strap from the cup up round the neck
      k.tube([[s * (BX + 0.035), BY + BR * 0.4, bz - BR * 0.72], [s * 0.085, 1.42, front(1.42) - 0.006], [s * 0.055, 1.52, -0.04], [s * 0.04, 1.565, 0.02]], 0.008, c.shirt, 4);
      k.add(new THREE.TorusGeometry(0.012, 0.004, 3, 6), GOLD, [s * (BX + 0.035), BY + BR * 0.42, bz - BR * 0.78], [0.3, 0, 0]);
    }
    k.add(new THREE.TorusGeometry(0.02, 0.007, 4, 8), GOLD, [0, BY - 0.02, bz - BR * 0.72]);   // gold ring between the cups
    // Frilled bottoms: white trim along the top edge
    k.add(lathe([[0.206, 0.848], [0.2, 0.866]]), FRILL, 0, 0, [1.01, 1, 0.83]);
  } else if (c.top === 'pasties') {  // bare, with small black X pasties like the reference
    bust(null, 0, null);
    const e = new THREE.Euler(), n = new THREE.Vector3();
    for (const s of [-1, 1]) {
      n.set(0, 0, -1).applyEuler(e.set(-0.05, -s * 0.3, 0)).normalize();
      const at = [s * BX + n.x * BR * 0.98, BY - 0.012 + n.y * BR * 0.92, bz + n.z * BR * 0.9];
      for (const a of [-1, 1]) k.add(facing(new THREE.BoxGeometry(0.058, 0.017, 0.007).rotateZ(a * 0.78), at, [n.x, n.y, n.z]), c.shirt);
    }
  } else if (c.top === 'blouse') {
    bust(c.shirt, 0.43, vary(c.shirt, 0.06, R));
    band(k, 1.0, 1.27, 0.012, c.corset);                     // laced corset under the bust
    band(k, 1.25, 1.36, 0.024, c.shirt);                     // off-shoulder blouse: neckline at the bust
    band(k, 1.35, 1.38, 0.034, vary(c.shirt, 0.05, R));     // gathered top edge
    // Laces: criss-cross cream cord with dark eyelets down the front
    for (let i = 0; i < 4; i++) {
      const y = 1.04 + i * 0.062, z = front(y + 0.03, 0.012) - 0.005;
      for (const s of [-1, 1]) k.box(0.07, 0.008, 0.006, 0xece0c4, [0, y + 0.03, z], [0, 0, s * 0.72]);
      for (const s of [-1, 1]) k.box(0.011, 0.011, 0.008, 0x2a1a10, [s * 0.025, y + 0.004, z]);
    }
    k.box(0.01, 0.28, 0.006, vary(c.corset, 0.3, R), [0, 1.145, front(1.15, 0.012) - 0.002]);
    // Corset seams (panel lines) at the sides
    for (const s of [-1, 1]) k.box(0.008, 0.27, 0.006, vary(c.corset, 0.25, R), [s * 0.1, 1.145, front(1.15, 0.012) * 0.8], [0, s * 0.6, 0]);
  }
  // Sash: a wide, slightly loose band over the hips
  k.add(lathe([[0.2, 0.86], [0.196, 0.9], [0.182, 0.945]]), c.sash, 0, 0, [1.03, 1, 0.84]);
  k.add(lathe([[0.204, 0.885], [0.2, 0.905]]), vary(c.sash, 0.3, R), 0, 0, [1.03, 1, 0.84]);  // a fold
  if (c.sashTie) { // knotted at her left hip with two long tails, like the reference
    k.ball(0.042, 1, c.sash, [-0.185, 0.89, -0.06], 0, [0.8, 1, 1]);
    k.box(0.07, 0.3, 0.014, c.sash, [-0.205, 0.73, -0.055], [0.05, 0.3, 0.12]);
    k.box(0.06, 0.24, 0.014, vary(c.sash, 0.3, R), [-0.17, 0.75, -0.105], [-0.1, 0.5, -0.12]);
  }
  if (c.ring) {   // big gold ring buckle, a little off-centre like the reference
    k.add(new THREE.TorusGeometry(0.04, 0.011, 4, 12), GOLD, [-0.075, 0.9, -0.17], [0, 0.35, 0]);
    k.box(0.05, 0.03, 0.012, vary(c.sash, 0.3, R), [-0.075, 0.9, -0.172], [0, 0.35, 0]);
  }
  // Neck
  k.cyl(0.047, 0.056, 0.14, 7, skin, [0, 1.6, 0.005]);
}

// ---------------------------------------------------------------- head
export function heroHead(k, c, R) {
  const skin = c.skin, hair = c.hair;
  // Face: a heart shape (narrower jaw and a soft pointed chin)
  const fg = new THREE.IcosahedronGeometry(0.12, 2);
  { const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) { p.setX(i, p.getX(i) * (1 - Math.min(0.38, -y * 2.7))); p.setZ(i, p.getZ(i) * (1 - Math.min(0.12, -y * 0.8))); } } }
  const face = k.add(fg, skin, [0, 0, 0], 0, [0.95, 1.08, 0.98]);
  { const p = face.attributes.position, col = face.attributes.color;   // soft bounce light under the chin
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) { const f = 1 + Math.min(0.5, -y * 4); col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f); } } }
  // Cheeks: a touch of warmth
  for (const s of [-1, 1]) k.box(0.03, 0.016, 0.006, mix(skin, 0xe06a60, 0.28), [s * 0.058, -0.03, -0.1], [0, s * 0.55, 0]);
  // Nose
  k.add(new THREE.ConeGeometry(0.017, 0.038, 4).rotateX(-Math.PI / 2), vary(skin, 0.05, R), [0, -0.022, -0.12], [0, 0, Math.PI / 4], [1, 1.2, 1]);
  // Big eyes: white, coloured iris, pupil, a highlight, lashes with a flick, arched brows
  for (const s of [-1, 1]) {
    const yaw = s * 0.2, z = -0.108;
    k.box(0.046, 0.03, 0.008, 0xf6f2ea, [s * 0.044, 0.004, z], [0, yaw, 0]);
    k.box(0.024, 0.028, 0.008, c.eyes ?? 0x4a6a3a, [s * 0.042, 0.003, z - 0.003], [0, yaw, 0]);
    k.box(0.011, 0.014, 0.008, 0x14100c, [s * 0.042, 0.003, z - 0.005], [0, yaw, 0]);
    k.box(0.006, 0.006, 0.006, 0xffffff, [s * 0.036, 0.009, z - 0.008], [0, yaw, 0]);
    k.box(0.054, 0.008, 0.012, 0x1a120c, [s * 0.045, 0.021, z - 0.002], [0, yaw, s * -0.1]);           // upper lashes
    k.box(0.016, 0.006, 0.01, 0x1a120c, [s * 0.073, 0.025, z + 0.006], [0, yaw, s * 0.55]);             // flick
    const brow = vary(hair, 0.25, () => 0.0);
    k.box(0.03, 0.007, 0.01, brow, [s * 0.03, 0.048, z + 0.002], [0, yaw, s * 0.12]);
    k.box(0.028, 0.007, 0.01, brow, [s * 0.058, 0.044, z + 0.008], [0, yaw, s * -0.35]);
  }
  // Lips with a small smile
  k.box(0.034, 0.01, 0.01, mix(skin, 0xa83a40, 0.55), [0, -0.062, -0.104]);
  k.box(0.028, 0.012, 0.01, mix(skin, 0xc85a5a, 0.5), [0, -0.073, -0.101]);
  for (const s of [-1, 1]) k.box(0.01, 0.006, 0.008, mix(skin, 0xa83a40, 0.45), [s * 0.019, -0.059, -0.1], [0, 0, s * 0.6]);
  // Ears and big gold hoops
  for (const s of [-1, 1]) {
    k.box(0.022, 0.042, 0.03, skin, [s * 0.108, -0.01, 0.005]);
    k.add(new THREE.TorusGeometry(0.026, 0.0055, 3, 10), GOLD, [s * 0.113, -0.062, 0.0], [0, Math.PI / 2, 0]);
  }

  // Hair: back and sides, side-swept bangs, locks framing the face
  k.add(new THREE.SphereGeometry(0.129, 10, 6, -0.45, Math.PI + 0.9, 0, Math.PI * 0.64), hair, [0, 0.005, 0.004], 0, [1.04, 1.1, 1.05]);
  k.box(0.12, 0.034, 0.03, hair, [0.025, 0.066, -0.104], [-0.35, 0.05, -0.3]);
  k.box(0.08, 0.03, 0.03, vary(hair, 0.1, () => 0.9), [-0.055, 0.066, -0.1], [-0.35, -0.2, 0.45]);
  for (const s of [-1, 1]) {
    k.tube([[s * 0.075, 0.075, -0.085], [s * 0.106, 0.02, -0.082], [s * 0.112, -0.06, -0.06], [s * 0.104, -0.12, -0.035]], 0.022, hair, 5);
    k.tube([[s * 0.1, 0.07, -0.04], [s * 0.125, 0.0, -0.03], [s * 0.122, -0.08, -0.01]], 0.022, vary(hair, 0.1, () => 0.9), 5);
  }
  // Braids (positions in body space, converted to head space)
  const H = (x, y, z) => [x / HERO_HEAD_SCALE, (y - 1.72) / HERO_HEAD_SCALE, z / HERO_HEAD_SCALE];
  const braid = (s, endY) => {
    const pts = [H(s * 0.085, 1.66, 0.075), H(s * 0.13, 1.58, 0.035), H(s * 0.165, 1.5, -0.04), H(s * 0.185, 1.42, -0.11), H(s * 0.19, 1.33, -0.135), H(s * 0.188, endY, -0.13)];
    const [x, y, z] = plait(k, hair, pts, 0.03, 0.022);
    k.cyl(0.022, 0.022, 0.026, 7, c.tie, [x, y - 0.018, z]);
    plait(k, hair, [[x, y - 0.03, z], [x, y - 0.06, z - 0.003], [x, y - 0.085, z - 0.005]], 0.02, 0.012);   // tuft
  };
  if (c.hairStyle === 'twinbraids') { braid(1, 1.2); braid(-1, 1.2); }
  else { braid(c.hairStyle === 'leftbraid' ? -1 : 1, 1.1); k.add(new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.3), hair, [0, -0.05, 0.035], 0, [1.05, 1, 1.05]); }

  // Bandana: a cap that sits high at the front and low at the back, knotted at the nape
  const cap = new THREE.SphereGeometry(0.136, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
  k.add(cap, c.bandana, [0, 0.022, 0.006], [0.38, 0, 0], [1.0, 1.04, 1.06]);
  k.add(new THREE.TorusGeometry(0.135, 0.012, 3, 14), vary(c.bandana, 0.15, R), [0, 0.022, 0.006], [Math.PI / 2 + 0.38, 0, 0], [1.0, 1.06, 1]);  // rolled edge
  k.ball(0.036, 0, c.bandana, [0, -0.03, 0.135]);
  for (const s of [-1, 1]) k.box(0.05, 0.13, 0.012, vary(c.bandana, 0.1, R), [s * 0.04, -0.09, 0.15], [0.35, s * 0.2, s * 0.45], [1, 1, 1]);
  if (c.skull) {
    const skull = (at, n, sz) => {
      k.add(facing(new THREE.IcosahedronGeometry(0.022 * sz, 1).scale(1, 0.95, 0.45).translate(0, 0.006 * sz, 0), at, n), FRILL);
      k.add(facing(new THREE.BoxGeometry(0.022 * sz, 0.012 * sz, 0.008).translate(0, -0.014 * sz, 0.002), at, n), FRILL);      // jaw
      for (const s of [-1, 1]) {
        k.add(facing(new THREE.BoxGeometry(0.075 * sz, 0.01 * sz, 0.006).rotateZ(s * 0.6).translate(0, -0.006 * sz, 0.006), at, n), FRILL);   // crossbones
        k.add(facing(new THREE.BoxGeometry(0.009 * sz, 0.009 * sz, 0.006).translate(s * 0.008 * sz, 0.008 * sz, -0.008 * sz), at, n), 0x1a1414); // eye sockets
      }
    };
    for (const s of [-1, 1]) skull([s * 0.062, 0.115, -0.088], [s * 0.45, 0.75, -0.6], 1);
    skull([0, 0.09, 0.118], [0, 0.45, 1], 1.35);
  }
}

// ---------------------------------------------------------------- arms
export function heroArm(k, c, side) {
  const skin = c.skin;
  if (c.top === 'blouse') {          // puffed off-shoulder sleeve
    k.ball(0.082, 1, c.shirt, [0, -0.05, 0], 0, [1.08, 0.92, 1.08]);
    k.cyl(0.062, 0.064, 0.022, 8, vary(c.shirt, 0.05, Math.random), [0, -0.122, 0]);
  } else {
    k.add(new THREE.SphereGeometry(0.052, 8, 6), skin, [0, -0.03, 0], 0, [1, 1.25, 1]);
    if (c.armband !== undefined) {
      k.cyl(0.058, 0.057, 0.05, 8, c.armband, [0, -0.1, 0]);
      for (const y of [-0.072, -0.128]) k.cyl(0.062, 0.062, 0.009, 8, FRILL, [0, y, 0]);
    }
  }
  k.cyl(0.049, 0.043, 0.28, 7, skin, [0, -0.18, 0]);
  k.cyl(0.042, 0.033, 0.26, 7, skin, [0, -0.44, 0]);
  k.box(0.046, 0.075, 0.06, skin, [0, -0.62, -0.005]);                          // hand
  k.box(0.022, 0.04, 0.024, skin, [side * -0.028, -0.6, -0.035], [0, 0, side * 0.3]); // thumb
}

// ---------------------------------------------------------------- legs
export function heroLeg(k, c) {
  const skin = c.skin, B = c.boots, Bd = vary(B, 0.22, () => 0.1), Bl = vary(B, 0.15, () => 0.9);
  const THIGH = [[0, 0.04], [0.09, 0.03], [0.108, -0.02], [0.099, -0.12], [0.089, -0.24], [0.072, -0.36], [0.064, -0.42]];
  const rT = (y) => rAt([...THIGH].reverse(), y);   // THIGH runs top-down; rAt wants bottom-up
  k.add(lathe(THIGH, 9), skin, 0, 0, [1, 1, 0.95]);
  if (c.shorts) {
    k.add(lathe([[0.114, 0.02], [0.112, -0.08], [0.108, -0.125]], 9), c.pants, 0, 0, [1, 1, 0.95]);
    k.cyl(0.115, 0.113, 0.04, 9, vary(c.pants, 0.15, () => 0.9), [0, -0.135, 0], 0, [1, 1, 0.95]);   // rolled hem
  }
  // Thigh-high boot: a soft upper with a turned top, then a buckled lower boot and a heel
  const top = c.bootTop ?? (c.shorts ? -0.25 : -0.22);
  const up = [[rT(top) + 0.011, top], ...THIGH.filter(([, y]) => y < top).map(([r, y]) => [r + 0.009, y]), [0.076, -0.47], [0.07, -0.55], [0.052, -0.66], [0.046, -0.72]];
  k.add(lathe(up, 9), B, 0, 0, [1, 1, 0.97]);
  k.cyl(rT(top) + 0.017, rT(top) + 0.015, 0.05, 9, Bl, [0, top - 0.01, 0]);
  k.cyl(0.08, 0.077, 0.02, 9, Bd, [0, -0.39, 0]);                                    // lower boot's top edge
  for (const [y, r] of c.bootStraps ?? [[-0.43, 0.079], [-0.53, 0.073], [-0.67, 0.058]]) {
    k.cyl(r + 0.007, r + 0.006, 0.028, 9, Bd, [0, y, 0]);
    for (const s of [-1, 1]) k.add(new THREE.TorusGeometry(0.014, 0.004, 3, 4), GOLD, [s * (r + 0.012), y, -0.008], [0, Math.PI / 2, Math.PI / 4]);
  }
  k.box(0.08, 0.075, 0.19, B, [0, -0.755, -0.055], [-0.22, 0, 0]);                    // foot, toe pointing down
  k.box(0.084, 0.018, 0.09, 0x1e1712, [0, -0.8, -0.105]);                             // sole under the toe
  k.box(0.058, 0.1, 0.055, 0x241a12, [0, -0.765, 0.035], [0.1, 0, 0]);                 // chunky heel
}
