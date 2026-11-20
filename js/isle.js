// Treasure Island's looks: terrain, jungle, the path, and the props in each clearing
// (the shape and the walking rules are in land.js, the hunt itself in island.js).
//
// Built once, the first time a treasure hunt starts, so the game loads as fast as before.
// For the headset's sake:
//   * the ground is split into chunks with a fine and a coarse version (THREE.LOD)
//   * the jungle is instanced, in chunks so only what's in view gets drawn
//   * small things (bushes, ferns, signs, props) only show within a short distance of you
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLE, CLEARINGS, ISLE_SOLIDS, PATH_HALF, landHeight, islePathDist, islePath, isleClearing,
  colorize, palmGeometry, treeGeometry, rockGeometry, grainTex, paint, fbm, vnoise, smooth } from './land.js';
import { Kit, FLAT } from './kit.js';

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const C_DIRT = new THREE.Color('#8a6a44'), C_DIRT2 = new THREE.Color('#6e5234'), C_MOSS = new THREE.Color('#3f5a2a');
let seed = 4242;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rnd() * (b - a);
const W = (u, v) => ({ x: u + ISLE.x, z: v + ISLE.z });
const ground = (x, z) => Math.max(0, landHeight(x, z));

// ---------- Ground ----------
function terrainChunk(u0, v0, u1, v1, step) {
  const nx = Math.round((u1 - u0) / step) + 1, nz = Math.round((v1 - v0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), idx = [];
  let any = false;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = ISLE.x + u0 + i * step, z = ISLE.z + v0 + j * step, y = landHeight(x, z), k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
    if (y > -2) any = true;
  }
  if (!any) return null;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]) < -3) continue; // deep water: skip
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  colorize(g);
  // The path and the clearings: trodden dirt with mossy edges
  const col = g.attributes.color;
  for (let i = 0; i < nx * nz; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y < 1.2) continue;
    const dp = islePathDist(x, z), u = x - ISLE.x, v = z - ISLE.z;
    let k = smooth(PATH_HALF + 1.2, PATH_HALF - 0.6, dp);
    for (const c of CLEARINGS) k = Math.max(k, smooth(c.r + 1.5, c.r - 2, Math.hypot(u - c.u, v - c.v)) * 0.85);
    if (k <= 0) continue;
    _c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const n = vnoise(x * 0.4, z * 0.4);
    const dirt = C_DIRT.clone().lerp(C_DIRT2, n).lerp(C_MOSS, smooth(PATH_HALF - 0.6, PATH_HALF + 1, dp) * 0.5);
    _c.lerp(dirt, k);
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
  return g;
}

function buildTerrain(mat) {
  const group = new THREE.Group();
  const [hu, hv] = ISLE.half, nU = 4, nV = 5;
  for (let a = 0; a < nU; a++) for (let b = 0; b < nV; b++) {
    const u0 = -hu + (2 * hu * a) / nU, u1 = -hu + (2 * hu * (a + 1)) / nU, v0 = -hv + (2 * hv * b) / nV, v1 = -hv + (2 * hv * (b + 1)) / nV;
    const hi = terrainChunk(u0, v0, u1, v1, 1.5);
    if (!hi) continue;
    const lo = terrainChunk(u0, v0, u1, v1, 5);
    const lod = new THREE.LOD();
    lod.addLevel(new THREE.Mesh(hi, mat), 0);
    lod.addLevel(new THREE.Mesh(lo, mat), 170);
    group.add(lod);
  }
  return group;
}

// ---------- Plants ----------
function bushGeometry() {
  // A clump of broad leaves
  const parts = [];
  for (let k = 0; k < 7; k++) {
    const len = 0.9 + (k % 3) * 0.25, f = new THREE.PlaneGeometry(0.42, len, 1, 3);
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / len; p.setX(i, p.getX(i) * (1 - t * 0.6) * (0.6 + t)); p.setZ(i, -t * t * len * 0.6); }
    f.rotateX(-0.5 - (k % 2) * 0.35); f.rotateY((k / 7) * Math.PI * 2);
    paint(f, new THREE.Color('#2d5524'), new THREE.Color('#5d8a38'), (y) => smooth(0, 1, y));
    parts.push(f.toNonIndexed());
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}
function fernGeometry() {
  // Low feathery fronds
  const parts = [];
  for (let k = 0; k < 9; k++) {
    const len = 1.1, f = new THREE.PlaneGeometry(0.28, len, 1, 4);
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / len; p.setX(i, p.getX(i) * (1 - t)); p.setZ(i, -t * t * 0.7); p.setY(i, p.getY(i) * 0.75); }
    f.rotateX(-0.9); f.rotateY((k / 9) * Math.PI * 2 + 0.3);
    paint(f, new THREE.Color('#3a6a2a'), new THREE.Color('#7aa048'), (y) => smooth(0, 0.7, y));
    parts.push(f.toNonIndexed());
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}

// Instanced plants in square cells so far-off cells can be hidden (and off-screen ones culled)
class Cells {
  constructor(size, near) { this.size = size; this.near = near; this.map = new Map(); this.group = new THREE.Group(); }
  add(geo, mat, x, y, z, rotY, sx, sy, sz, col, tilt = 0) {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    if (!this.map.has(key)) this.map.set(key, { cx: (Math.floor(x / this.size) + 0.5) * this.size, cz: (Math.floor(z / this.size) + 0.5) * this.size, lists: new Map() });
    const cell = this.map.get(key), k = geo.uuid;
    if (!cell.lists.has(k)) cell.lists.set(k, { geo, mat, items: [] });
    _e.set(tilt, rotY, tilt * 0.5); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
    cell.lists.get(k).items.push({ m: new THREE.Matrix4().compose(_p, _q, _s), col });
  }
  build() {
    for (const cell of this.map.values()) {
      const g = new THREE.Group(); cell.obj = g;
      for (const { geo, mat, items } of cell.lists.values()) {
        const im = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.col); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        g.add(im);
      }
      this.group.add(g);
    }
    return this.group;
  }
  // Show only the cells near (x, z)
  update(x, z) { for (const c of this.map.values()) c.obj.visible = Math.hypot(c.cx - x, c.cz - z) < this.near; }
}

function plantJungle(plantMat, solidMat, rockMat) {
  const trees = new Cells(80, 1e9), small = new Cells(40, 75), mid = new Cells(60, 260);
  const palm = palmGeometry(), tree = treeGeometry(), bush = bushGeometry(), fern = fernGeometry(), rock = rockGeometry();
  const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  const [hu, hv] = ISLE.half;
  // Big jungle trees: a wall either side of the path, thinning out further away
  for (let n = 0, tries = 0; n < 1100 && tries < 30000; tries++) {
    const u = rr(-hu, hu), v = rr(-hv, hv), x = u + ISLE.x, z = v + ISLE.z, y = landHeight(x, z);
    if (y < 2.6) continue;
    const dp = islePathDist(x, z);
    if (dp < PATH_HALF + 2.2 || CLEARINGS.some((c) => Math.hypot(u - c.u, v - c.v) < c.r + 1.5)) continue;
    if (rnd() > (dp < 16 ? 1 : dp < 40 ? 0.55 : 0.3)) continue;
    const k = rr(1.3, 2.4);
    trees.add(tree, solidMat, x, y - 0.4, z, rr(0, 6.28), k, k * rr(0.9, 1.4), k, hsl(rr(0.2, 0.32), 0.25, rr(0.38, 0.55)), rr(-0.06, 0.06));
    n++;
  }
  // Palms along the shore and the beach
  for (let n = 0, tries = 0; n < 170 && tries < 20000; tries++) {
    const u = rr(-hu, hu), v = rr(-hv, hv), x = u + ISLE.x, z = v + ISLE.z, y = landHeight(x, z);
    if (y < 1.0 || y > 9) continue;
    const dp = islePathDist(x, z);
    if (dp < PATH_HALF + 0.8 || CLEARINGS.some((c) => Math.hypot(u - c.u, v - c.v) < c.r)) continue;
    const k = rr(0.75, 1.2);
    trees.add(palm, plantMat, x, y - 0.3, z, rr(0, 6.28), k, k * rr(0.85, 1.2), k, hsl(rr(0.22, 0.3), 0.15, rr(0.45, 0.6)));
    if (y < 2.6 && v > 60) ISLE_SOLIDS.push({ x, z, r: 0.35 * k }); // beach palms you could walk into
    n++;
  }
  // Undergrowth hugging the path, so it reads as a trail cut through the jungle
  const P = islePath().pts;
  for (let i = 0; i < P.length; i += 1) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.25) continue;
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], du = b.u - a.u, dv = b.v - a.v, L = Math.hypot(du, dv) || 1;
      const off = PATH_HALF + rr(0.4, 3.5), u = P[i].u - (dv / L) * off * side, v = P[i].v + (du / L) * off * side;
      if (CLEARINGS.some((c) => Math.hypot(u - c.u, v - c.v) < c.r + 0.5)) continue;
      const x = u + ISLE.x, z = v + ISLE.z, y = landHeight(x, z);
      if (y < 1.4) continue;
      const k = rr(0.7, 1.5);
      if (rnd() < 0.55) small.add(bush, plantMat, x, y - 0.05, z, rr(0, 6.28), k, k * rr(0.8, 1.3), k, hsl(rr(0.22, 0.33), 0.3, rr(0.45, 0.65)));
      else small.add(fern, plantMat, x, y, z, rr(0, 6.28), k, k, k, hsl(rr(0.24, 0.32), 0.3, rr(0.5, 0.7)));
    }
  }
  // Ferns and bushes scattered through the jungle near the path
  for (let n = 0, tries = 0; n < 900 && tries < 20000; tries++) {
    const u = rr(-hu, hu), v = rr(-hv, hv), x = u + ISLE.x, z = v + ISLE.z, y = landHeight(x, z);
    if (y < 2) continue;
    const dp = islePathDist(x, z);
    if (dp < PATH_HALF + 0.3 || dp > 22) continue;
    const k = rr(0.8, 1.8);
    small.add(rnd() < 0.5 ? bush : fern, plantMat, x, y - 0.05, z, rr(0, 6.28), k, k, k, hsl(rr(0.22, 0.33), 0.3, rr(0.4, 0.62)));
    n++;
  }
  // Mossy rocks along the trail and on the slopes
  for (let n = 0, tries = 0; n < 260 && tries < 20000; tries++) {
    const u = rr(-hu, hu), v = rr(-hv, hv), x = u + ISLE.x, z = v + ISLE.z, y = landHeight(x, z);
    if (y < -1) continue;
    const dp = islePathDist(x, z);
    if (dp < PATH_HALF + 0.6 || CLEARINGS.some((c) => Math.hypot(u - c.u, v - c.v) < c.r + 0.5)) continue;
    if (dp > 30 && rnd() < 0.7) continue;
    const k = rr(0.6, dp < 8 ? 1.6 : 3.2);
    mid.add(rock, rockMat, x, y - k * 0.25, z, rr(0, 6.28), k * rr(0.8, 1.4), k * rr(0.7, 1.2), k * rr(0.8, 1.4), hsl(0.2, 0.12, rr(0.42, 0.55)), rr(-0.2, 0.2));
    n++;
  }
  return { trees, small, mid };
}

// ---------- Props: the camp, the graveyard, the temple, signs and torches ----------
const STONE = 0x8a8478, STONE_D = 0x6a665e, MOSSY = 0x5e6a48, WOOD = 0x6a4a2a, WOOD_D = 0x4a321c, CLOTH = 0xcdbb94, ROPE = 0xc8b080;
function solid(x, z, r) { ISLE_SOLIDS.push({ x, z, r }); }

function campProps(k, flames) {
  const c = isleClearing('camp'), gy = (x, z) => ground(x, z);
  // Two tents, opening toward the fire
  for (const [du, dv, rot] of [[-7, -3, 0.9], [5, -7, -0.4]]) {
    const x = c.x + du, z = c.z + dv, y = gy(x, z);
    k.add(new THREE.CylinderGeometry(1.5, 1.5, 3, 3, 1).rotateZ(Math.PI / 2).rotateY(rot).scale(1, 1.05, 1), CLOTH, [x, y + 0.75, z]);
    k.box(0.08, 1.8, 0.08, WOOD_D, [x + Math.cos(rot) * 1.5, y + 0.9, z - Math.sin(rot) * 1.5]);
    solid(x, z, 1.6);
  }
  // Campfire: a ring of stones and logs
  const fx = c.x + 0.5, fz = c.z + 1, fy = gy(fx, fz);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.28; k.add(new THREE.DodecahedronGeometry(0.18, 0), STONE_D, [fx + Math.cos(a) * 0.6, fy + 0.08, fz + Math.sin(a) * 0.6]); }
  for (let i = 0; i < 4; i++) k.cyl(0.07, 0.07, 0.9, 5, WOOD_D, [fx, fy + 0.15, fz], [Math.PI / 2 - 0.25, (i / 4) * 3.14, 0]);
  flames.push({ x: fx, y: fy + 0.25, z: fz, s: 1.4 });
  solid(fx, fz, 0.7);
  // Crates and barrels, a skull flag
  for (const [du, dv] of [[8, 4], [8.8, 5.2], [7.6, 5.4]]) { const x = c.x + du, z = c.z + dv; k.box(0.8, 0.8, 0.8, WOOD, [x, gy(x, z) + 0.4, z], [0, rr(0, 1), 0]); solid(x, z, 0.5); }
  for (const [du, dv] of [[-4, 6], [-3.2, 6.6]]) { const x = c.x + du, z = c.z + dv; k.cyl(0.38, 0.38, 1, 10, WOOD, [x, gy(x, z) + 0.5, z]); k.cyl(0.4, 0.4, 0.06, 10, 0x2a2c31, [x, gy(x, z) + 0.75, z]); solid(x, z, 0.45); }
  const px = c.x - 9, pz = c.z + 3, py = gy(px, pz);
  k.cyl(0.06, 0.07, 5, 6, WOOD_D, [px, py + 2.5, pz]);
  k.box(1.3, 0.85, 0.03, 0x1a1a1e, [px + 0.68, py + 4.4, pz]);
  k.ball(0.17, 1, 0xe8e0cc, [px + 0.68, py + 4.5, pz + 0.03], 0, [1, 1, 0.3]);
  solid(px, pz, 0.3);
  // A wrecked boat pulled up on the sand
  const bx = c.x + 12, bz = c.z + 12, by = gy(bx, bz);
  k.add(new THREE.CylinderGeometry(0.9, 0.9, 4, 8, 1, true, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI), 0x5d3b22, [bx, by + 0.5, bz], [0.1, 0.6, 0.2]);
}

function gravesProps(k) {
  const c = isleClearing('graves'), gy = (x, z) => ground(x, z);
  // Mounds with crosses and headstones, in rough rows
  const spots = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.28 + 0.3, d = c.r * (0.45 + (i % 2) * 0.22), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = gy(x, z);
    k.ball(0.8, 1, 0x5a4630, [x, y - 0.25, z], [0, a, 0], [0.7, 0.35, 1.3]);
    if (i % 3 === 0) { k.box(0.6, 0.75, 0.14, STONE, [x, y + 0.35, z - 1.0], [rr(-0.15, 0.15), a, rr(-0.1, 0.1)]); }
    else { k.box(0.08, 1.0, 0.08, WOOD_D, [x, y + 0.5, z - 1.0], [rr(-0.2, 0.2), a, 0]); k.box(0.55, 0.08, 0.08, WOOD_D, [x, y + 0.75, z - 1.0], [0, a, 0]); }
    solid(x, z - 1.0, 0.3);
    spots.push({ x, z });
  }
  // A broken stone wall round part of it and a dead tree
  for (let i = 0; i < 14; i++) {
    if (i % 5 === 3) continue;
    const a = (i / 14) * 3.6 + 2.2, x = c.x + Math.cos(a) * (c.r + 0.6), z = c.z + Math.sin(a) * (c.r + 0.6), h = rr(0.5, 1.3);
    k.box(1.6, h, 0.5, i % 2 ? STONE : STONE_D, [x, gy(x, z) + h / 2 - 0.1, z], [0, -a + Math.PI / 2, rr(-0.06, 0.06)]);
  }
  const tx = c.x - 3, tz = c.z + 2, ty = gy(tx, tz);
  k.tube([[tx, ty - 0.2, tz], [tx + 0.2, ty + 2, tz], [tx - 0.3, ty + 3.6, tz + 0.2], [tx - 1.2, ty + 4.4, tz + 0.5]], 0.2, 0x4a3e32, 5);
  k.tube([[tx + 0.1, ty + 2.6, tz], [tx + 1.2, ty + 3.4, tz - 0.3], [tx + 1.8, ty + 3.6, tz - 0.8]], 0.1, 0x4a3e32, 4);
  solid(tx, tz, 0.4);
  return spots;
}

function templeProps(k, flames) {
  const c = isleClearing('temple'), gy = (x, z) => ground(x, z);
  // A paved courtyard ring, broken pillars round it, an arch where the path comes in
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * 6.28, d = c.r * rr(0.5, 0.92), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    k.box(rr(1, 1.8), 0.12, rr(1, 1.8), i % 3 ? STONE : MOSSY, [x, gy(x, z) + 0.02, z], [0, a, 0]);
  }
  const P = islePath().pts, ent = P[Math.max(0, P.length - 14)], ex = ent.u + ISLE.x, ez = ent.v + ISLE.z;
  const ea = Math.atan2(ex - c.x, ez - c.z);
  for (let i = 0; i < 8; i++) {
    const a = ea + 0.45 + (i / 8) * (6.28 - 0.9), x = c.x + Math.sin(a) * (c.r - 1.5), z = c.z + Math.cos(a) * (c.r - 1.5), y = gy(x, z), h = [4.2, 2.1, 3.6, 1.2, 4.2, 2.8, 1.6, 3.9][i];
    k.box(1.2, 0.4, 1.2, STONE_D, [x, y + 0.2, z]);
    k.cyl(0.42, 0.48, h, 8, i % 2 ? STONE : MOSSY, [x, y + 0.4 + h / 2, z], [rr(-0.05, 0.05), 0, rr(-0.05, 0.05)]);
    if (h > 3.5) k.box(1.1, 0.35, 1.1, STONE_D, [x, y + 0.4 + h + 0.17, z]);
    solid(x, z, 0.7);
    if (i === 3) for (let j = 0; j < 3; j++) k.cyl(0.42, 0.42, 1.0, 8, STONE, [x + 1.4 + j * 0.9, y + 0.4, z + 0.6], [0, 0, Math.PI / 2 + rr(-0.2, 0.2)]); // a toppled one
  }
  // The arch
  const ax = c.x + Math.sin(ea) * (c.r + 0.5), az = c.z + Math.cos(ea) * (c.r + 0.5), ay = gy(ax, az), side = [Math.cos(ea), -Math.sin(ea)];
  for (const s of [-1, 1]) { k.box(0.9, 4.2, 0.9, STONE, [ax + side[0] * 2.4 * s, ay + 2.1, az + side[1] * 2.4 * s], [0, ea, 0]); solid(ax + side[0] * 2.4 * s, az + side[1] * 2.4 * s, 0.6); }
  k.box(5.8, 0.8, 1.0, STONE_D, [ax, ay + 4.6, az], [0, ea, 0]);
  // A great stone skull watching the X from the far side, with torches either side
  const sx = c.x - Math.sin(ea) * (c.r - 2.5), sz = c.z - Math.cos(ea) * (c.r - 2.5), sy = gy(sx, sz);
  k.box(3.2, 1.2, 2.2, STONE_D, [sx, sy + 0.6, sz], [0, ea, 0]);
  k.ball(1.25, 1, 0xb8b0a0, [sx, sy + 2.3, sz], [0, ea, 0], [1, 1.05, 0.95]);
  k.box(1.3, 0.6, 1.0, 0xb8b0a0, [sx, sy + 1.4, sz], [0, ea, 0]);
  for (const s of [-1, 1]) k.ball(0.32, 0, 0x15100c, [sx + Math.sin(ea) * 1.0 + side[0] * 0.45 * s, sy + 2.35, sz + Math.cos(ea) * 1.0 + side[1] * 0.45 * s]);
  solid(sx, sz, 1.8);
  for (const s of [-1, 1]) {
    const tx = sx + side[0] * 2.6 * s, tz = sz + side[1] * 2.6 * s, ty = gy(tx, tz);
    k.cyl(0.08, 0.1, 2.2, 6, WOOD_D, [tx, ty + 1.1, tz]); k.cyl(0.18, 0.1, 0.25, 6, 0x2a2c31, [tx, ty + 2.25, tz]);
    flames.push({ x: tx, y: ty + 2.45, z: tz, s: 0.8 });
  }
}

// Skull signposts and torches along the trail
function trailProps(k, flames) {
  const P = islePath().pts;
  for (let s = 18; s < P.length - 10; s += 26) {
    const i = Math.round(s), a = P[i - 1], b = P[i + 1], du = b.u - a.u, dv = b.v - a.v, L = Math.hypot(du, dv) || 1, side = (i / 26) % 2 < 1 ? 1 : -1;
    const u = P[i].u - (dv / L) * (PATH_HALF + 0.5) * side, v = P[i].v + (du / L) * (PATH_HALF + 0.5) * side, x = u + ISLE.x, z = v + ISLE.z, y = ground(x, z);
    if (CLEARINGS.some((c) => Math.hypot(u - c.u, v - c.v) < c.r + 2)) continue;
    if ((i / 26) % 3 < 1) { // skull on a pole
      k.cyl(0.05, 0.06, 1.8, 5, WOOD_D, [x, y + 0.9, z]);
      k.ball(0.16, 1, 0xe8e0cc, [x, y + 1.95, z], 0, [1, 1.1, 1.05]);
      k.box(0.6, 0.18, 0.04, WOOD, [x, y + 1.35, z], [0, Math.atan2(du, dv), -0.2]);
    } else { // a torch
      k.cyl(0.05, 0.07, 1.7, 5, WOOD_D, [x, y + 0.85, z]); k.cyl(0.13, 0.07, 0.2, 6, 0x2a2c31, [x, y + 1.75, z]);
      flames.push({ x, y: y + 1.92, z, s: 0.6 });
    }
  }
}

// ---------- The whole island ----------
export class IsleLooks {
  constructor(G) { this.G = G; this.built = false; this.t = 0; }
  build() {
    if (this.built) return;
    this.built = true;
    const t0 = performance.now(), G = this.G;
    seed = 4242;
    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grainTex() });
    const plantMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.root = new THREE.Group(); G.scene.add(this.root);
    this.root.add(buildTerrain(groundMat));
    this.cells = plantJungle(plantMat, solidMat, rockMat);
    this.root.add(this.cells.trees.build(), this.cells.small.build(), this.cells.mid.build());
    // Props per place, each merged into one mesh
    const flames = [], near = new Cells(70, 140);
    const kc = new Kit(); campProps(kc, flames);
    const kg = new Kit(); this.graves = gravesProps(kg);
    const kt = new Kit(); templeProps(kt, flames);
    const ks = new Kit(); trailProps(ks, flames);
    this.props = [kc, kg, kt, ks].map((k) => k.mesh());
    this.root.add(...this.props);
    // Flames: little glowing cones that flicker
    const fk = new Kit();
    for (const f of flames) { fk.cyl(0, 0.16 * f.s, 0.45 * f.s, 6, 0xffa030, [f.x, f.y + 0.2 * f.s, f.z]); fk.cyl(0, 0.09 * f.s, 0.3 * f.s, 5, 0xfff0a0, [f.x, f.y + 0.13 * f.s, f.z]); }
    this.flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: true });
    this.flames = new THREE.Mesh(fk.geometry(), this.flameMat); this.root.add(this.flames);
    this.near = near;
    this.updateT = 0;
    console.log(`Treasure Island built in ${Math.round(performance.now() - t0)} ms`);
  }

  // Every frame: hide the small stuff that's far from you, flicker the flames
  view(dt) {
    if (!this.built) return;
    this.t += dt;
    this.flames.scale.y = 1; this.flameMat.opacity = 0.75 + Math.sin(this.t * 13) * 0.1 + Math.sin(this.t * 7.3) * 0.08;
    if ((this.updateT -= dt) > 0) return;
    this.updateT = 0.4;
    const cam = this.G.camera.getWorldPosition(_p);
    this.cells.small.update(cam.x, cam.z); this.cells.mid.update(cam.x, cam.z);
    const far = Math.hypot(cam.x - ISLE.x, cam.z - ISLE.z) > 420;
    for (const m of this.props) m.visible = !far;
    this.flames.visible = !far;
  }
}

// The parchment chart of the island for the treasure map (island.js draws you on top)
export function drawIsleMap(size = 256) {
  const half = Math.max(...ISLE.half), cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = ISLE.x - half + (i + 0.5) * (2 * half / size), z = ISLE.z - half + (j + 0.5) * (2 * half / size), h = landHeight(x, z), o = (j * size + i) * 4;
    let c;
    if (h < -0.3) c = [150, 170, 160]; else if (h < 1.8) c = [226, 206, 156]; else { const k = Math.min(1, h / 40); c = [176 - 60 * k, 176 - 46 * k, 112 - 36 * k]; }
    if (h > -0.6 && h < 0.0) c = [110, 90, 60];
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // The trail: red dashes, as on any proper treasure map
  const sc = size / (2 * half), P = islePath().pts;
  g.strokeStyle = '#a01a10'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath();
  P.forEach((p, i) => { const X = (p.u + half) * sc, Y = (p.v + half) * sc; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
  g.stroke(); g.setLineDash([]);
  return { canvas: cv, x0: ISLE.x - half, z0: ISLE.z - half, size: 2 * half };
}
