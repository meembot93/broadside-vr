// A tiny modelling kit: build a low-poly model out of simple shapes, each with its own
// colour, then merge them into ONE mesh with ONE shared material. That keeps the draw
// count low for Quest while still allowing lots of small coloured details.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Faceted, flat-shaded look (like the reference art). Colours come from the vertices.
export const FLAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Kit {
  constructor() { this.parts = []; }

  // geo: a three.js geometry (it is consumed). color: hex. Optional placement:
  // p = [x,y,z], r = [rx,ry,rz] (radians, XYZ order), s = number or [sx,sy,sz].
  add(geo, color, p, r, s, shade = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    _p.set(...(p || [0, 0, 0]));
    _q.setFromEuler(_e.set(...(r || [0, 0, 0])));
    if (Array.isArray(s)) _s.set(...s); else _s.setScalar(s ?? 1);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    _c.setHex(color).multiplyScalar(shade);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return g;
  }

  // Shortcuts for the shapes used most.
  box(w, h, d, color, p, r, s) { return this.add(new THREE.BoxGeometry(w, h, d), color, p, r, s); }
  cyl(rt, rb, h, seg, color, p, r, s) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, p, r, s); }
  ball(rad, detail, color, p, r, s) { return this.add(new THREE.IcosahedronGeometry(rad, detail), color, p, r, s); }

  // A bent "tube" through a list of points (for guards, straps). Square-ish cross section.
  tube(pts, rad, color, sides = 4) {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), false, 'catmullrom', 0.2);
    return this.add(new THREE.TubeGeometry(curve, Math.max(4, pts.length * 2), rad, sides, false), color);
  }

  geometry() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }

  mesh(mat = FLAT) { return new THREE.Mesh(this.geometry(), mat); }
}

// Nudge a shade a little, for variety between pirates (amount ~0.1).
export function vary(hex, amt, rnd = Math.random) {
  _c.setHex(hex);
  const k = 1 + (rnd() * 2 - 1) * amt;
  return _c.setRGB(Math.min(1, _c.r * k), Math.min(1, _c.g * k), Math.min(1, _c.b * k)).getHex();
}

// ---------- Shared weapon shapes (used by the pirates and by the player's own weapons) ----------
export const COL = {
  steel: 0xc9cfd8, steelDark: 0x8e95a0, brass: 0xc29a3a, brassDark: 0x8a6a24,
  grip: 0x5a3220, wood: 0x8a4f26, woodDark: 0x6a3a1a, iron: 0x3a3d44, ironDark: 0x2a2c31,
};

// A cutlass in the reference style: brown grip, brass D-guard and pommel, a broad curved
// blade with a clipped point. The hand holds the origin and the blade points down -Z.
// len = blade length. Returns the tip's z position.
export function addCutlass(k, len = 0.78, at = [0, 0, 0]) {
  const [x0, y0, z0] = at, P = (x, y, z) => [x0 + x, y0 + y, z0 + z];
  // Blade outline (u along the blade, v up = spine side), extruded thin.
  const L = len, sh = new THREE.Shape();
  sh.moveTo(0, 0.018);
  sh.lineTo(L * 0.45, 0.022); sh.lineTo(L * 0.72, 0.016); sh.lineTo(L * 0.84, 0.004);   // spine, easing down
  sh.lineTo(L, 0.03);                                                                     // clipped point rises to the tip
  sh.lineTo(L * 0.9, -0.035); sh.lineTo(L * 0.66, -0.06); sh.lineTo(L * 0.35, -0.048);     // broad belly
  sh.lineTo(0, -0.022); sh.closePath();
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 1 });
  blade.translate(0, 0, -0.004).rotateY(Math.PI / 2).translate(x0, y0, z0 - 0.08);
  k.add(blade, COL.steel);
  // Fuller (darker groove) along the blade
  k.box(0.011, 0.007, L * 0.6, COL.steelDark, P(0, 0.008, -0.08 - L * 0.33));
  // Grip, ferrules, pommel
  k.cyl(0.017, 0.019, 0.13, 6, COL.grip, P(0, 0, 0.005), [Math.PI / 2, 0, 0]);
  k.cyl(0.021, 0.021, 0.02, 6, COL.brass, P(0, 0, 0.075), [Math.PI / 2, 0, 0]);
  k.ball(0.027, 0, COL.brass, P(0, 0, 0.098), 0, [1, 1, 1.2]);
  // Guard: a crossbar plate plus the D-shaped knuckle bow down to the pommel
  k.box(0.034, 0.085, 0.022, COL.brass, P(0, -0.012, -0.07));
  k.box(0.03, 0.03, 0.03, COL.brass, P(0, 0.035, -0.07), [0.5, 0, 0]);
  k.tube([P(0, -0.05, -0.07), P(0, -0.072, -0.03), P(0, -0.074, 0.03), P(0, -0.055, 0.08), P(0, -0.012, 0.095)], 0.008, COL.brass, 4);
  return z0 - 0.08 - L;
}

// A flintlock musket: angular wooden stock, metal lock plate with hammer and frizzen,
// dark barrel with bands. The hand holds the origin; the muzzle points down -Z.
// Returns the muzzle's [y, z].
export function addMusket(k, s = 1) {
  const W = COL.wood, WD = COL.woodDark;
  // Butt stock: angular, deeper at the back, with a comb step (like the reference)
  const butt = new THREE.Shape();
  butt.moveTo(0.38, 0.03); butt.lineTo(0.12, 0.05); butt.lineTo(0.02, 0.02); butt.lineTo(-0.06, 0.02);
  butt.lineTo(-0.06, -0.03); butt.lineTo(0.05, -0.045); butt.lineTo(0.38, -0.16); butt.closePath();
  const bg = new THREE.ExtrudeGeometry(butt, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  bg.translate(0, 0, -0.025).rotateY(-Math.PI / 2);   // shape x -> +Z (backwards), extrusion -> X
  k.add(bg, W);
  k.box(0.064, 0.205, 0.02, WD, [0, -0.064, 0.39], [0.08, 0, 0]);  // butt plate
  // Fore stock under the barrel
  k.box(0.046, 0.05, 0.74, W, [0, -0.002, -0.43]);
  k.box(0.04, 0.03, 0.12, WD, [0, -0.01, -0.86]);   // nose cap
  // Barrel: dark iron, slightly flared muzzle, two bands
  k.cyl(0.018, 0.02, 1.08, 8, COL.iron, [0, 0.036, -0.52], [Math.PI / 2, 0, 0]);
  k.cyl(0.024, 0.024, 0.05, 8, COL.ironDark, [0, 0.036, -1.045], [Math.PI / 2, 0, 0]);
  for (const z of [-0.45, -0.75]) k.cyl(0.026, 0.026, 0.02, 8, COL.steelDark, [0, 0.03, z], [Math.PI / 2, 0, 0]);
  k.cyl(0.006, 0.006, 0.7, 4, COL.ironDark, [0, -0.03, -0.62], [Math.PI / 2, 0, 0]); // ramrod
  // Lock (right side): plate, hammer (cock) and frizzen standing up, pan
  k.box(0.012, 0.045, 0.15, COL.steelDark, [0.031, 0.018, -0.005]);
  k.box(0.012, 0.075, 0.018, COL.steel, [0.036, 0.068, 0.04], [-0.45, 0, 0]);
  k.box(0.014, 0.02, 0.035, COL.steel, [0.036, 0.1, 0.03]);
  k.box(0.01, 0.06, 0.012, COL.steel, [0.036, 0.075, -0.035], [0.25, 0, 0]);
  k.box(0.02, 0.012, 0.03, COL.steelDark, [0.03, 0.045, -0.035]);
  // Trigger and its guard
  k.box(0.008, 0.035, 0.012, COL.ironDark, [0, -0.045, 0.01], [0.3, 0, 0]);
  k.tube([[0, -0.03, -0.04], [0, -0.07, -0.02], [0, -0.07, 0.04], [0, -0.04, 0.07]], 0.0055, COL.steelDark, 4);
  return [0.036, -1.07];
}
