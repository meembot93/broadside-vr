// The cove: one shared height function for the coastline, plus the meshes built from it
// (terrain, a small islet, trees, palms, rocks). Ships use the same function for running
// aground and for steering, so what you see is what you hit.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex } from './util.js';

// ---------- Noise ----------
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Seeded random so the coast looks the same every visit
let seed = 1337;
const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const srange = (a, b) => a + srand() * (b - a);

// ---------- Cove shape ----------
// An oval bay centred a little ahead of the start, open to the sea toward -z (where the sun is).
export const COVE = { cx: 0, cz: -120, a: 300, b: 560 };
export const ISLET = { x: -135, z: -330, r: 38 };
// Rocks and palm trunks on the islet that people can't walk through (island.js): { x, z, r }
export const ISLET_SOLIDS = [];
const onIslet = (c) => Math.hypot(c.x - ISLET.x, c.z - ISLET.z) < ISLET.r * 1.6;

// Distance inland from the shoreline (negative = water), plus how cliffy the coast is there.
function coveShore(x, z) {
  const dx = x - COVE.cx, dz = z - COVE.cz, len = Math.hypot(dx, dz) || 1e-3;
  const sn = dx / len, cs = dz / len, th = Math.atan2(dx, dz);
  let R = 1 / Math.sqrt((sn / COVE.a) ** 2 + (cs / COVE.b) ** 2);
  R *= 1 + 0.09 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2) + 0.035 * Math.sin(11 * th + 0.5) + 0.015 * Math.sin(23 * th + 4);
  const mouth = smooth(0.8, 0.93, -cs);
  R *= 1 + mouth * 8;
  let cliff = smooth(0.05, 0.55, Math.sin(2 * th + 0.7) * 0.6 + Math.sin(5 * th + 2.1) * 0.4);
  cliff = Math.max(cliff * smooth(0.55, 0.2, cs), smooth(0.55, 0.78, -cs)); // beach at the back, cliffs at the headlands
  return { d: len - R, cliff, th, R };
}

function coveHeight(x, z) {
  const { d, cliff } = coveShore(x, z);
  if (d < 0) return Math.max(-30, d * mix(0.22, 0.7, cliff) - 0.4);
  const n = fbm(x * 0.006, z * 0.006, 3);
  const beachW = mix(30, 2.5, cliff) * (0.7 + 0.6 * vnoise(x * 0.02, z * 0.02));
  const hb = d < beachW ? -0.4 + 2.2 * (d / beachW) : 1.8;
  const rise = smooth(beachW, beachW + mix(120, 12, cliff), d);
  const hill = rise * (mix(14, 34, cliff) + 34 * n);
  const mtn = smooth(90, 650, d) * (60 + 240 * fbm(x * 0.0024 + 7, z * 0.0024 - 3, 3));
  const detail = (fbm(x * 0.035, z * 0.035, 3) - 0.5) * 6 * rise;
  return hb + hill + mtn + detail;
}

function isletHeight(x, z) {
  const dx = x - ISLET.x, dz = z - ISLET.z, len = Math.hypot(dx, dz), th = Math.atan2(dx, dz);
  const R = ISLET.r * (1 + 0.18 * Math.sin(3 * th + 0.4) + 0.08 * Math.sin(7 * th + 1.3));
  const d = R - len; // positive inland
  if (d < 0) return d * 0.35 - 0.4;
  return -0.4 + Math.min(d, 8) * 0.25 + smooth(6, R * 0.8, d) * (16 + 8 * fbm(x * 0.05, z * 0.05, 2)) + (fbm(x * 0.08, z * 0.08, 2) - 0.5) * 3 * smooth(4, 12, d);
}

export function landHeight(x, z) {
  return Math.max(coveHeight(x, z), isletHeight(x, z));
}

export function landGradient(x, z, out = { x: 0, z: 0 }) {
  const e = 1.5;
  out.x = (landHeight(x + e, z) - landHeight(x - e, z)) / (2 * e);
  out.z = (landHeight(x, z + e) - landHeight(x, z - e)) / (2 * e);
  return out;
}

// Is there open water around (x, z) out to the given radius?
export function isOpenWater(x, z, radius = 30) {
  if (landHeight(x, z) > -4) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (landHeight(x + Math.sin(a) * radius, z + Math.cos(a) * radius) > -3) return false;
  }
  return true;
}

// Nudge a desired heading (ship convention: forward = (-sin h, -cos h)) so it doesn't run into land.
const OFFS = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, Math.PI];
export function avoidLand(x, z, desired, look = 70) {
  const clear = (h) => {
    const sx = -Math.sin(h), sz = -Math.cos(h);
    for (const f of [0.35, 0.7, 1]) if (landHeight(x + sx * look * f, z + sz * look * f) > -3.5) return false;
    return true;
  };
  for (const o of OFFS) if (clear(desired + o)) return desired + o;
  return desired;
}

// ---------- Textures ----------
function grainTex() {
  const t = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // tileable layered noise
      const n = 0.5 * tnoise(x, y, 16) + 0.3 * tnoise(x, y, 32) + 0.2 * Math.random();
      const v = 200 + n * 55, i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function tnoise(x, y, cells) {
  const s = 256 / cells, fx = x / s, fy = y / s, xi = Math.floor(fx), yi = Math.floor(fy);
  const u = fx - xi, v = fy - yi, H = (a, b) => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells + 91);
  const uu = u * u * (3 - 2 * u), vv = v * v * (3 - 2 * v);
  return mix(mix(H(xi, yi), H(xi + 1, yi), uu), mix(H(xi, yi + 1), H(xi + 1, yi + 1), uu), vv);
}

// ---------- Terrain meshes ----------
const C_SAND = new THREE.Color('#d6c59a'), C_WETSAND = new THREE.Color('#9c8a64');
const C_GRASS1 = new THREE.Color('#4a6a2c'), C_GRASS2 = new THREE.Color('#6e7a3c'), C_JUNGLE = new THREE.Color('#33532a');
const C_ROCK1 = new THREE.Color('#7b7166'), C_ROCK2 = new THREE.Color('#5b554e'), C_ROCKHI = new THREE.Color('#8a857e');
const _c = new THREE.Color();

function colorize(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    const k = fbm(x * 0.02, z * 0.02, 2), k2 = vnoise(x * 0.11, z * 0.11);
    if (y < 0.2) _c.copy(C_WETSAND);
    else _c.copy(C_SAND);
    const g = _c.clone();
    g.copy(C_GRASS1).lerp(C_GRASS2, k).lerp(C_JUNGLE, smooth(0.45, 0.8, fbm(x * 0.008 + 5, z * 0.008, 2)) * 0.8);
    _c.lerp(g, smooth(1.6 + k2 * 1.2, 3.2 + k2 * 1.5, y));
    const rockC = C_ROCK1.clone().lerp(C_ROCK2, k2).lerp(C_ROCKHI, smooth(120, 220, y));
    const rocky = Math.max(smooth(0.86, 0.68, ny + (k - 0.5) * 0.08), smooth(150, 230, y + k * 30));
    _c.lerp(rockC, y > 0.5 ? rocky : rocky * 0.5);
    const strata = 1 - rocky * 0.12 * (0.5 + 0.5 * Math.sin(y * 0.9 + k * 6));
    const shade = (0.88 + 0.22 * k2) * strata * (0.9 + 0.1 * ny);
    col[i * 3] = _c.r * shade; col[i * 3 + 1] = _c.g * shade; col[i * 3 + 2] = _c.b * shade;
    // steep faces sample the grain sideways so it doesn't smear into stripes
    if (ny < 0.6) { uv[i * 2] = (x + z) * 0.7 / 9; uv[i * 2 + 1] = y / 6; } else { uv[i * 2] = x / 9; uv[i * 2 + 1] = z / 9; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// A grid in polar coordinates whose rings follow the shoreline, so the beach gets the detail.
function polarGrid(nAng, radii, pointAt, keep) {
  const nR = radii.length, verts = new Float32Array(nAng * nR * 3), idx = [];
  const ok = new Uint8Array(nAng);
  for (let a = 0; a < nAng; a++) {
    const th = (a / nAng) * Math.PI * 2;
    ok[a] = keep(th) ? 1 : 0;
    for (let r = 0; r < nR; r++) {
      const p = pointAt(th, radii[r]), i = (a * nR + r) * 3;
      verts[i] = p.x; verts[i + 1] = landHeight(p.x, p.z); verts[i + 2] = p.z;
    }
  }
  for (let a = 0; a < nAng; a++) {
    const b = (a + 1) % nAng;
    if (!ok[a] || !ok[b]) continue;
    for (let r = 0; r < nR - 1; r++) {
      const i0 = a * nR + r, i1 = b * nR + r, i2 = a * nR + r + 1, i3 = b * nR + r + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  // make sure triangles face up
  const v = (k) => new THREE.Vector3(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
  const A = v(idx[0]), B = v(idx[1]), C = v(idx[2]);
  if (B.sub(A).cross(C.sub(A)).y < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  colorize(geo);
  return geo;
}

function buildTerrain(mat) {
  const radii = [-45, -22, -11, -5, -1, 2, 5, 9, 14, 20, 27, 35, 44, 55, 68, 84, 102, 124, 150, 180, 215, 255, 300, 355, 420, 500, 590, 700, 830, 980, 1150];
  const geo = polarGrid(300, radii, (th, d) => {
    const sx = Math.sin(th), sz = Math.cos(th);
    const { R } = coveShore(COVE.cx + sx * 50, COVE.cz + sz * 50); // R along this ray (same direction)
    const r = R + d;
    return { x: COVE.cx + sx * r, z: COVE.cz + sz * r };
  }, (th) => coveShore(COVE.cx + Math.sin(th) * 50, COVE.cz + Math.cos(th) * 50).R < 1300); // leave out the far-off land straight out to sea
  const mesh = new THREE.Mesh(geo, mat);
  const islet = new THREE.Mesh(polarGrid(64, [0.06, 0.15, 0.35, 0.55, 0.75, 0.9, 1, 1.15, 1.4, 1.9].map((k) => ISLET.r * k),
    (th, rr) => ({ x: ISLET.x + Math.sin(th) * rr, z: ISLET.z + Math.cos(th) * rr }), () => true), mat);
  return [mesh, islet];
}

// ---------- Vegetation & rocks ----------
function palmGeometry() {
  const parts = [];
  const trunkCol = new THREE.Color('#7a6248'), leafCol = new THREE.Color('#4f7a33'), leafTip = new THREE.Color('#6f8a3a');
  let x = 0, y = 0;
  const H = 9, SEG = 5;
  for (let i = 0; i < SEG; i++) {
    const h = H / SEG, lean = 0.1 + i * 0.07;
    const c = new THREE.CylinderGeometry(0.22 - i * 0.02, 0.26 - i * 0.02, h * 1.04, 6, 1, true);
    c.rotateZ(-lean); c.translate(x + Math.sin(lean) * h / 2, y + Math.cos(lean) * h / 2, 0);
    paint(c, trunkCol, trunkCol);
    parts.push(c);
    x += Math.sin(lean) * h; y += Math.cos(lean) * h;
  }
  for (let k = 0; k < 8; k++) {
    const len = 4.2 + (k % 2) * 0.8, w = 0.85;
    const f = new THREE.PlaneGeometry(w, len, 1, 4);
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / len;
      p.setX(i, p.getX(i) * (1 - t * 0.7));
      p.setZ(i, -t * t * len * 0.75); // droop
      p.setY(i, p.getY(i) * (1 - t * 0.2));
    }
    f.rotateX(-1.05 + (k % 2) * 0.25); f.rotateY((k / 8) * Math.PI * 2 + 0.2);
    f.translate(x, y, 0);
    paint(f, leafCol, leafTip, (vy) => smooth(y, y + 2.5, -vy + 2 * y));
    parts.push(f);
  }
  const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}
function paint(geo, a, b, tf) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = tf ? tf(geo.attributes.position.getY(i)) : 0;
    _c.copy(a).lerp(b, t);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
}

function treeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 4, 5).translate(0, 2, 0);
  paint(trunk, new THREE.Color('#5a4632'), new THREE.Color('#5a4632'));
  const blobs = [[0, 5.6, 0, 2.7], [1.3, 4.9, 0.7, 2.0], [-1.1, 5.1, -0.8, 2.1]].map(([x, y, z, r]) => {
    const b = mergeVertices(new THREE.IcosahedronGeometry(r, 0));
    const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(0.85 + 0.3 * hash(v.x * 3.1 + x, v.y * 2.7 + v.z * 1.9));
      p.setXYZ(i, v.x, v.y * 0.8, v.z);
    }
    b.translate(x, y, z);
    paint(b, new THREE.Color('#2f4f24'), new THREE.Color('#4f7034'), (vy) => smooth(y - r, y + r, vy));
    return b;
  });
  const g = mergeGeometries([trunk.toNonIndexed(), ...blobs.map((b) => b.toNonIndexed())]);
  g.computeVertexNormals();
  return g;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 0.75 + 0.45 * hash(p.getX(i) * 9.1 + p.getZ(i) * 3.3, p.getY(i) * 7.7));
    const s = cache.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  paint(g, new THREE.Color('#77706a'), new THREE.Color('#8d877f'), (vy) => smooth(-0.6, 0.7, vy));
  return g;
}

// Place instances, then split them into a few chunks by direction so the headset only draws
// the chunks you're actually looking at.
function scatter(mat, geo, count, pick, place, chunks = 8) {
  const items = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let tries = 0;
  while (items.length < count && tries < count * 60) {
    tries++;
    const c = pick();
    if (!c) continue;
    const r = place(c);
    e.set(r.tiltX || 0, srange(0, Math.PI * 2), r.tiltZ || 0); q.setFromEuler(e);
    s.set(r.sx, r.sy, r.sz); p.set(c.x, c.y + (r.dy || 0), c.z);
    items.push({ m: new THREE.Matrix4().compose(p, q, s), col: new THREE.Color().setHSL(r.hue ?? 0, r.sat ?? 0, r.lit ?? 1), x: c.x, z: c.z });
  }
  const group = new THREE.Group();
  const buckets = Array.from({ length: chunks }, () => []);
  for (const it of items) {
    const a = Math.atan2(it.x - COVE.cx, it.z - COVE.cz) + Math.PI;
    buckets[Math.min(chunks - 1, Math.floor((a / (Math.PI * 2)) * chunks))].push(it);
  }
  for (const list of buckets) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.col); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

const _g = { x: 0, z: 0 };
function sampleLand(dMin, dMax, hMin, hMax, maxSlope, angKeep) {
  const th = srange(0, Math.PI * 2);
  if (angKeep && !angKeep(th)) return null;
  const sx = Math.sin(th), sz = Math.cos(th);
  const { R } = coveShore(COVE.cx + sx * 50, COVE.cz + sz * 50);
  if (R > 1500) return null;
  const r = R + srange(dMin, dMax), x = COVE.cx + sx * r, z = COVE.cz + sz * r;
  const y = landHeight(x, z);
  if (y < hMin || y > hMax) return null;
  landGradient(x, z, _g);
  if (Math.hypot(_g.x, _g.z) > maxSlope) return null;
  return { x, y, z };
}
function sampleIslet(rMax, hMin) {
  const a = srange(0, Math.PI * 2), r = Math.sqrt(srand()) * rMax;
  const x = ISLET.x + Math.sin(a) * r, z = ISLET.z + Math.cos(a) * r, y = landHeight(x, z);
  if (y < hMin) return null;
  return { x, y, z };
}

export function buildLand(scene) {
  seed = 1337;
  const grain = grainTex();
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grain });
  const [terrain, islet] = buildTerrain(groundMat);
  scene.add(terrain, islet);

  const plantMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const palmPick = () => (srand() < 0.12 ? sampleIslet(ISLET.r * 0.85, 0.8) : sampleLand(4, 60, 0.9, 9, 0.35));
  const palms = scatter(plantMat, palmGeometry(), 230, palmPick,
    (c) => { const k = srange(0.75, 1.25); if (onIslet(c)) ISLET_SOLIDS.push({ x: c.x, z: c.z, r: 0.35 * k }); return { sx: k, sy: k * srange(0.85, 1.2), sz: k, dy: -0.3, hue: srange(0.22, 0.3), sat: 0.15, lit: srange(0.45, 0.6) }; });

  // trees grow in patches of jungle, thickest near the shore
  const treePick = () => {
    const c = sampleLand(12, srand() < 0.6 ? 200 : 650, 2.5, 220, 0.8);
    if (!c || fbm(c.x * 0.012 + 3, c.z * 0.012, 2) + srand() * 0.25 < 0.55) return null;
    return c;
  };
  const trees = scatter(solidMat, treeGeometry(), 950, treePick,
    (c) => { const k = srange(1.4, 2.6) * (c.y > 120 ? 0.75 : 1); return { sx: k, sy: k * srange(0.85, 1.3), sz: k, dy: -0.4, tiltX: srange(-0.08, 0.08), hue: srange(0.18, 0.3), sat: 0.2, lit: srange(0.4, 0.6) }; });

  const rockPick = () => {
    if (srand() < 0.15) return sampleIslet(ISLET.r * 1.1, -2);
    return sampleLand(-10, 18, -4, 12, 5, null);
  };
  const rocks = scatter(rockMat, rockGeometry(), 260, rockPick,
    (c) => {
      const k = srange(1.2, 5.5);
      const r = { sx: k * srange(0.8, 1.4), sy: k * srange(0.7, 1.3), sz: k * srange(0.8, 1.4), dy: -k * 0.25, tiltX: srange(-0.3, 0.3), tiltZ: srange(-0.3, 0.3), hue: 0.08, sat: 0.08, lit: srange(0.42, 0.58) };
      if (onIslet(c) && r.sy * 0.6 + r.dy > 0.3) ISLET_SOLIDS.push({ x: c.x, z: c.z, r: Math.min(r.sx, r.sz) * 0.8 }); // only rocks you'd bump into
      return r;
    });

  scene.add(palms, trees, rocks);
  return { terrain, islet };
}

// Low-res height map of the cove for the water shader (shallow colour + shore foam).
export function landHeightTexture(res = 256, size = 2400, cx = 0, cz = -200) {
  const data = new Uint8Array(res * res);
  const x0 = cx - size / 2, z0 = cz - size / 2;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const h = landHeight(x0 + ((i + 0.5) / res) * size, z0 + ((j + 0.5) / res) * size);
    data[j * res + i] = Math.round(Math.min(1, Math.max(0, (h + 20) / 24)) * 255);
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, origin: new THREE.Vector2(x0, z0), size };
}
