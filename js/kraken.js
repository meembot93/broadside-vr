// The Kraken: the last fight of every voyage, after the boss captain's galleon is beaten.
// A giant sea monster surfaces beside our ship and grabs hold of her (she can't sail away):
//   * its HEAD stays out in the water, about 24 m off one side. Cannons (by hand, or the crew's)
//     and muskets hurt it. Each time it loses a third of its strength it dives and comes up
//     on the OTHER side, so you have to run to the other guns.
//   * its TENTACLES come up round the ship. They grab the rail and squeeze the hull (leaks!),
//     rear up over the deck and slam down where you stand (a dark shadow shows where: move!),
//     or reach across the deck and lash at you. Cut them with a cutlass, shoot them, or blast
//     them with a cannon: a severed tentacle sinks away (and hurts the head), then grows back.
// Beat it and the voyage is won. Lose the ship and the voyage starts over, as with any fight.
//
// Rules (update) run on the host only. Everything the headsets need to draw it is a little
// plain state (snap/applySnap): the head's phase and the start time of each tentacle's move.
// The shapes are worked out from that on every headset (view), with the shared clock G.t.
// Tentacles are one tube mesh each, bent along a curve on the graphics card (one draw call,
// ~880 triangles); the whole monster is about 8k triangles and 12 draw calls.
//
// Events (presentation.js plays them): krakenStirs, krakenRises {pos, first}, tentacleRises,
// tentacleGrabs, tentacleSqueeze, tentacleRaised {pos, player}, tentacleSlam, tentacleLash,
// tentacleHit, tentacleSevered, krakenHit {pos, hp, max}, krakenDives, krakenSlain (all with pos).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { halfWidth, railHeight, BOW, STERN } from './ship.js';
import { waveHeight } from './waves.js';
import { segSegDist, clamp, rand, canvasTex } from './util.js';

const DIST = 24;          // head: how far out from our ship's centreline
const BASE_Y = -3.4;      // tentacle roots, ship-local (deep enough to be under the water)
const HEAD_SCALE = 1.35;  // the head model is built about 11 m tall, then scaled up
const HEAD_R = 6;         // the head's hit sphere (plus one for the tall mantle above it)
const MANTLE_UP = 8.5, MANTLE_R = 4.6;
const TENT_HP = 3;        // sword blows (a hard swing counts 2), musket balls 2, cannonball 3
const SEVER_HURTS = 10;   // a severed tentacle hurts the head too
const REGROW = 11;        // seconds before a severed tentacle comes back
// Where the tentacles come up, ship-local: z along the hull, d = how far out from it.
// 'far' ones come up on the other side and wrap round to hold the ship.
const SLOTS = [
  { z: -7.0, d: 4.2 }, { z: -2.0, d: 4.8 }, { z: 2.6, d: 4.8 }, { z: 6.2, d: 4.2 },
  { z: -5.0, d: 3.2, far: true }, { z: 3.8, d: 3.2, far: true },
];
// How long the blend into each move takes (s)
const BLEND = { under: 1.1, hurt: 0.9, idle: 1.3, grab: 1.1, raise: 1.0, slam: 0.26, lie: 0.2, reach: 0.9 };
// Head phases and how long they last
const RISE = 3.2, DIVE = 3.2, STIR = 4, DYING = 6;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _o = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion();

// ---------- Looks ----------
// Painted at load time on small canvases: a wet, warty skin (colour + bumps) for the head,
// and a strip with two rows of suckers for the underside of the tentacles. The bumps become
// a normal map, so the light catches every wart and sucker rim without extra triangles.
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, P) { // tileable value noise, period P
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), m = (a) => ((a % P) + P) % P;
  const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, P, o = 4) => { let s = 0, w = 0.5, f = 1; for (let i = 0; i < o; i++) { s += w * vnoise(x * f, y * f, P * f); w *= 0.5; f *= 2; } return s; };

// Height field -> normal map (tileable)
function normalTex(H, N, strength) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = H[y * N + (x + 1) % N] - H[y * N + (x + N - 1) % N], hy = H[((y + 1) % N) * N + x] - H[((y + N - 1) % N) * N + x];
    let nx = -hx * strength, ny = hy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function colorTex(N, fn) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [r, gg, b] = fn(x, y), i = (y * N + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Skin detail (grey-ish, multiplied over the body colours in the shaders): mottled blotches,
// fine wrinkles and scattered warts.
let SKIN = null;
function skinTextures() {
  if (SKIN) return SKIN;
  const N = 512, H = new Float32Array(N * N), C = new Float32Array(N * N);
  const warts = [];
  for (let i = 0; i < 150; i++) warts.push([hash(i, 7) * N, hash(i, 11) * N, 2.5 + Math.pow(hash(i, 13), 2) * 11]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * 8, v = y / N * 8;
    const blotch = fbm(u, v, 8, 4);
    const wr = Math.abs(fbm(u * 2.2 + 3, v * 4.4, 16, 3) - 0.5); // creases
    let h = blotch * 0.6 - wr * 1.6;
    C[y * N + x] = blotch;
    H[y * N + x] = h;
  }
  for (const [wx, wy, r] of warts) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = 1 - (dx * dx + dy * dy) / (r * r); if (q <= 0) continue;
      const x = ((Math.round(wx + dx) % N) + N) % N, y = ((Math.round(wy + dy) % N) + N) % N;
      H[y * N + x] += Math.sqrt(q) * r * 0.09; C[y * N + x] += q * 0.25;
    }
  }
  const color = colorTex(N, (x, y) => {
    const c = C[y * N + x], k = 0.62 + c * 0.6;
    return [Math.min(255, 255 * k), Math.min(255, 235 * k), Math.min(255, 235 * k)];
  });
  SKIN = { color, normal: normalTex(H, N, 3.0) };
  return SKIN;
}

// Tentacle strip: x = round the tentacle (the inside, where the suckers are, is in the
// middle), y = along it, one tile as long as the tentacle is round.
let SUCK = null;
function suckerTextures() {
  if (SUCK) return SUCK;
  const N = 512, H = new Float32Array(N * N), C = new Float32Array(N * N * 3);
  const top = [92, 20, 34], side = [150, 44, 52], belly = [236, 176, 160];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, a = Math.abs(u - 0.5) * 2; // 0 = inside middle, 1 = outside middle
    const blotch = fbm(u * 8, v * 8, 8, 4), wr = Math.abs(fbm(u * 16 + 5, v * 8, 16, 3) - 0.5);
    // colour: pale belly fading through red sides to a dark mottled back
    const kb = 1 - smooth((a - 0.2) / 0.22), kt = smooth((a - 0.45) / 0.4);
    let col = [0, 1, 2].map((i) => side[i] + (top[i] - side[i]) * kt);
    col = col.map((c, i) => c + (belly[i] - c) * kb);
    const mot = 0.7 + blotch * 0.6 - (kt > 0.5 ? smooth((blotch - 0.55) / 0.1) * 0.35 : 0);
    const o = (y * N + x) * 3; C[o] = col[0] * mot; C[o + 1] = col[1] * mot; C[o + 2] = col[2] * mot;
    H[y * N + x] = blotch * 0.5 - wr * 1.4 * (1 - kb);
  }
  // Two staggered rows of suckers: a raised rim with a deep cup in the middle
  const R = 0.06 * N;
  for (let row = 0; row < 2; row++) for (let k = 0; k < 5; k++) {
    const cx = (0.5 + (row ? 0.075 : -0.075)) * N, cy = ((k + row * 0.5) / 5) * N;
    for (let dy = -R - 4; dy <= R + 4; dy++) for (let dx = -R - 4; dx <= R + 4; dx++) {
      const r = Math.hypot(dx, dy) / R; if (r > 1.15) continue;
      const x = Math.round(cx + dx), y = ((Math.round(cy + dy) % N) + N) % N, i = y * N + x, o = i * 3;
      // height: smooth mound, rim ring, cup
      const mound = r < 1.15 ? Math.cos(Math.min(1, r / 1.15) * Math.PI / 2) * 1.6 : 0;
      const cup = r < 0.62 ? -2.2 * Math.cos(r / 0.62 * Math.PI / 2) : 0;
      H[i] = H[i] * (1 - Math.min(1, mound)) + mound * 1.4 + cup;
      const rim = Math.exp(-((r - 0.72) ** 2) / 0.012);
      let c = r < 0.95 ? [248, 214, 196] : [236, 180, 166];
      if (r < 0.62) { const q = r / 0.62; c = [170 + 60 * q, 80 + 80 * q, 92 + 60 * q]; }
      if (r < 0.22) c = [96, 30, 44];
      const w = r < 1 ? 1 : 1 - (r - 1) / 0.15;
      for (let j = 0; j < 3; j++) C[o + j] = C[o + j] * (1 - w) + Math.min(255, c[j] + rim * 20) * w;
    }
  }
  SUCK = { color: colorTex(N, (x, y) => { const o = (y * N + x) * 3; return [C[o], C[o + 1], C[o + 2]]; }), normal: normalTex(H, N, 2.2) };
  return SUCK;
}
function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

// A unit tube: x, y = round the ring (cos, sin), z = 0..1 along it. The shader bends it.
// uv: x round the ring (the inside in the middle), y along it (filled in per tentacle).
function tubeGeometry(nu, nr) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nr; j++) {
    const th = (j / nr) * Math.PI * 2;
    pos.push(Math.cos(th), Math.sin(th), i / nu);
    uv.push(j / nr + 0.5, 0);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nr; j++) {
    const a = i * (nr + 1) + j, b = a + nr + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  return g;
}
const NU = 72, NR = 18;
const tubes = new Map(); // one geometry per (thickness, length): the sucker spacing follows the radius
const radiusAt = (r0, r1, ku) => mix(r0, r1, Math.pow(ku, 0.75)) * (1 - 0.85 * smooth((ku - 0.84) / 0.16));
function mix(a, b, k) { return a + (b - a) * k; }
function tubeFor(r0, r1, len) {
  const key = `${r0}|${r1}|${len}`;
  if (tubes.has(key)) return tubes.get(key);
  const g = tubeGeometry(NU, NR), uv = g.attributes.uv;
  // Along the tentacle, one texture tile per circumference, so suckers shrink toward the tip
  let v = 0;
  for (let i = 0; i <= NU; i++) {
    const ku = i / NU;
    if (i) v += (len / NU) / (2 * Math.PI * Math.max(0.03, radiusAt(r0, r1, ku - 0.5 / NU)));
    for (let j = 0; j <= NR; j++) uv.setY(i * (NR + 1) + j, v);
  }
  tubes.set(key, g);
  return g;
}

const TENTACLE_VERT_HEAD = `
uniform vec3 uP0, uP1, uP2, uP3, uIn; uniform float uTime, uR0, uR1, uSeed, uWrithe, uCurl;
varying float vKU; varying float vKA;
vec3 kBez(float u){ float v = 1.0 - u; return v*v*v*uP0 + 3.0*v*v*u*uP1 + 3.0*v*u*u*uP2 + u*u*u*uP3; }
vec3 kBezD(float u){ float v = 1.0 - u; return 3.0*v*v*(uP1-uP0) + 6.0*v*u*(uP2-uP1) + 3.0*u*u*(uP3-uP2); }
`;

// One tentacle: a tube bent along a cubic curve (4 points, local to its parent)
class TentacleMesh {
  constructor(parent, r0, r1, seed, len = 13) {
    this.u = {
      uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() }, uP3: { value: new THREE.Vector3() },
      uIn: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 }, uR0: { value: r0 }, uR1: { value: r1 }, uSeed: { value: seed }, uWrithe: { value: 0.22 },
      uCurl: { value: r0 * 1.6 },
    };
    const T = suckerTextures();
    const mat = new THREE.MeshPhongMaterial({ map: T.color, normalMap: T.normal, normalScale: new THREE.Vector2(1, 1), specular: 0x4a3a3a, shininess: 38 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + TENTACLE_VERT_HEAD)
        .replace('#include <beginnormal_vertex>', `
          float ku = position.z;
          vec3 kT = normalize(kBezD(ku) + vec3(0.0, 1e-4, 0.0));
          vec3 kB = cross(kT, uIn);
          if (dot(kB, kB) < 1e-4) kB = cross(kT, vec3(0.0, 0.0, 1.0));
          kB = normalize(kB);
          vec3 kN = cross(kB, kT);
          float kr = mix(uR0, uR1, pow(ku, 0.75)) * (1.0 - 0.85 * smoothstep(0.84, 1.0, ku)) * (1.0 + 0.035 * sin(ku * 70.0));
          float kTip = smoothstep(0.7, 1.0, ku);
          vec3 kC = kBez(ku) + kB * sin(ku * 9.0 - uTime * 3.1 + uSeed) * uWrithe * ku
                  + kN * kTip * kTip * uCurl * (0.8 + 0.3 * sin(uTime * 1.7 + uSeed))
                  + kB * kTip * kTip * uCurl * 0.5 * sin(uTime * 2.3 + uSeed * 2.0);
          // a little flatter on the sucker side, like a real tentacle
          vec2 kRing = vec2(position.x * (position.x > 0.0 ? 0.82 : 1.0), position.y);
          vec3 kDir = kN * kRing.x + kB * kRing.y;
          vec3 objectNormal = kN * position.x + kB * position.y;
          vKU = ku; vKA = atan(position.y, position.x);`)
        .replace('#include <begin_vertex>', 'vec3 transformed = kC + kDir * kr;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKU; varying float vKA;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // the tip goes pale
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.2, 1.05, 1.05), smoothstep(0.85, 1.0, vKU));`);
    };
    mat.customProgramCacheKey = () => 'kraken-tentacle2';
    this.mesh = new THREE.Mesh(tubeFor(r0, r1, len), mat);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }
  set(P, t) {
    const u = this.u;
    u.uP0.value.copy(P[0]); u.uP1.value.copy(P[1]); u.uP2.value.copy(P[2]); u.uP3.value.copy(P[3]);
    u.uTime.value = t;
  }
}

// Wet, warty skin for the head, dark crimson on top, paler below, gently breathing
function skinMaterial(uTime) {
  const T = skinTextures();
  const mat = new THREE.MeshPhongMaterial({ map: T.color, normalMap: T.normal, normalScale: new THREE.Vector2(1.4, 1.4), specular: 0x504040, shininess: 30 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vKP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vKP = position;
        transformed += normal * (0.12 * sin(position.y * 1.3 - uTime * 1.6) + 0.07 * sin(position.x * 2.1 + position.z * 1.7 + uTime));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 top = vec3(0.22, 0.03, 0.07), low = vec3(0.62, 0.2, 0.2);
          vec3 c = mix(low, top, smoothstep(-2.0, 4.5, vKP.y + vKP.z * 0.25));
          // darker veins running up the mantle
          float vein = smoothstep(0.92, 0.99, sin(atan(vKP.x, -vKP.z) * 9.0 + sin(vKP.y * 0.9) * 1.6));
          c *= 1.0 - 0.3 * vein * smoothstep(1.0, 5.0, vKP.y);
          diffuseColor.rgb *= c * 1.15;
        }`);
  };
  mat.customProgramCacheKey = () => 'kraken-skin2';
  return mat;
}

// Eye: amber iris with dark rings and a slit pupil, glowing a little
let EYE = null;
function eyeTexture() {
  if (EYE) return EYE;
  EYE = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#ffe680'); gr.addColorStop(0.35, '#ffa010'); gr.addColorStop(0.75, '#c84a06'); gr.addColorStop(0.92, '#6a2004'); gr.addColorStop(1, '#2a0a04');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,40,0,0.45)'; g.lineWidth = 2;
    for (let i = 0; i < 90; i++) { const a = i / 90 * Math.PI * 2, r0 = 40 + hash(i, 3) * 20; g.beginPath(); g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); g.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); g.stroke(); }
    g.fillStyle = '#080204'; g.beginPath(); g.ellipse(128, 128, 18, 86, 0, 0, Math.PI * 2); g.fill();
  });
  return EYE;
}

// Smooth noise in 3D (for sculpting the head)
function n3(x, y, z) { return (Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) * Math.sin(y * 1.9 + Math.sin(z * 2.1 + x)) * Math.sin(z * 1.3 + Math.sin(x * 2.7 + y))); }

// The head: a huge wrinkled mantle leaning back, a broad face with two great slit-pupilled
// eyes deep under bony brows. Built facing +Z, with the waterline at y = 0.
const EYE_AT = [2.35, 1.5, 3.45];
function buildHead(uTime) {
  const g = new THREE.Group();
  const prof = new THREE.SplineCurve([[0.01, -4.5], [2.8, -4.0], [4.2, -2.4], [4.6, -0.3], [4.4, 1.7], [4.75, 3.6], [4.7, 5.8], [4.0, 8.1], [2.8, 9.8], [1.3, 10.9], [0.01, 11.3]]
    .map(([r, y]) => new THREE.Vector2(r, y))).getPoints(56);
  const SEG = 72, mantle = new THREE.LatheGeometry(prof, SEG);
  // (the lathe's first and last columns are the same seam: give them the same normals)
  const seam = () => {
    const n = mantle.attributes.normal, L = prof.length;
    for (let j = 0; j < L; j++) {
      const a = j, b = SEG * L + j;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  };
  // Sculpt: eye sockets and brow ridges, a groove between the eyes, a wrinkled neck, lumps
  const pos = mantle.attributes.position, nrm = new THREE.Vector3(), p = new THREE.Vector3();
  mantle.rotateY(Math.PI); // (seam round the back)
  mantle.computeVertexNormals(); seam();
  const N = mantle.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); nrm.fromBufferAttribute(N, i);
    let d = 0;
    for (const s of [-1, 1]) {
      const ex = p.x - s * EYE_AT[0], ey = p.y - EYE_AT[1], front = smooth((p.z - 1.5) / 1.5);
      const r2 = ex * ex + ey * ey;
      d -= 0.75 * Math.exp(-r2 / 1.0) * front;                                 // socket
      d += 0.75 * Math.exp(-((ex * 0.8) ** 2 + (ey - 1.35) ** 2 * 3) / 0.9) * front; // brow ridge
      d += 0.4 * Math.exp(-((ex * 0.9) ** 2 + (ey + 1.3) ** 2 * 2.5) / 0.8) * front; // cheek
    }
    d -= 0.35 * Math.exp(-(p.x * p.x) / 0.25) * smooth((p.z - 2) / 1.5) * Math.exp(-((p.y - 2.6) ** 2) / 4); // groove between the eyes
    d += 0.18 * Math.sin(p.y * 4.2 + Math.sin(Math.atan2(p.x, p.z) * 3) * 0.8) * smooth((4.5 - p.y) / 2) * smooth((p.y + 1) / 2); // folds
    d += 0.22 * n3(p.x * 0.6, p.y * 0.6, p.z * 0.6) + 0.08 * n3(p.x * 1.6 + 3, p.y * 1.6, p.z * 1.6);
    p.addScaledVector(nrm, d);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  mantle.rotateX(-0.32);
  mantle.computeVertexNormals(); seam();
  // uv repeats so the skin detail isn't stretched over such a big head
  const uv = mantle.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 4);
  g.add(new THREE.Mesh(mantle, skinMaterial(uTime)));
  // Eyes (bulging, glossy) with lids
  const eyeMat = new THREE.MeshPhongMaterial({ map: eyeTexture(), emissive: 0x6a3000, emissiveMap: eyeTexture(), specular: 0xffffff, shininess: 120 });
  const lidMat = skinMaterial(uTime);
  for (const s of [-1, 1]) {
    const m = new THREE.Matrix4().makeRotationY(s * 0.45).setPosition(s * EYE_AT[0], EYE_AT[1] - 0.05, EYE_AT[2] + 0.25);
    const eg = new THREE.SphereGeometry(1.1, 32, 24).rotateX(Math.PI / 2).scale(1, 1, 0.75);
    { const ep = eg.attributes.position, euv = eg.attributes.uv; for (let i = 0; i < ep.count; i++) euv.setXY(i, ep.getX(i) * 0.5 + 0.5, ep.getY(i) * 0.5 + 0.5); }
    const eye = new THREE.Mesh(eg, eyeMat);
    eye.geometry.applyMatrix4(m); g.add(eye);
    // heavy upper lid drooping over the top of the eye, and a lower one
    const lid = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.3).rotateX(0.5).rotateZ(s * 0.32).scale(1.1, 1, 0.85).translate(0, 0.05, -0.15);
    const low = new THREE.SphereGeometry(1.18, 32, 8, 0, Math.PI * 2, Math.PI * 0.8, Math.PI * 0.2).rotateX(-0.2).scale(1.08, 1, 0.85).translate(0, 0, -0.15);
    g.add(new THREE.Mesh(mergeGeometries([lid.applyMatrix4(m), low.applyMatrix4(m)]), lidMat));
  }
  // Short tentacle stubs curling round the face below the eyes (looks only)
  g.userData.lips = [];
  return g;
}

// ---------- The monster ----------
export class Kraken {
  constructor(G) {
    this.G = G;
    this.phase = 'off'; // off -> stir -> rise -> fight (-> dive -> rise -> fight ...) -> dying -> dead
    this.t0 = 0; this.side = 1; this.hp = this.max = 1; this.dives = 0; this.level = 0;
    this.uTime = { value: 0 };
    // The head lives in a frame that follows our ship's position and heading (but not her rocking)
    this.frame = new THREE.Group(); G.scene.add(this.frame);
    this.head = buildHead(this.uTime); this.head.scale.setScalar(HEAD_SCALE); this.frame.add(this.head);
    // four more curling round the head, two beside it and two in front of its face (looks only)
    this.headFlare = [1.7, 4.2, 2.9, 5.6].map((sd, i) => new TentacleMesh(this.head, i < 2 ? 1.0 : 0.75, i < 2 ? 0.3 : 0.22, sd, i < 2 ? 11 : 8));
    this.frame.visible = false;
    this.tents = SLOTS.map((sl, i) => {
      const tn = { i, z0: sl.z, d: sl.d, far: !!sl.far, state: 'under', prev: 'under', t0: -9, tx: 0, tz: 0, hp: TENT_HP, next: 0, sq: 0, cd: 0, hurtCD: {},
        seed: i * 1.93 + 0.4, pts: Array.from({ length: 9 }, () => new THREE.Vector3()), P: [0, 1, 2, 3].map(() => new THREE.Vector3()) };
      tn.view = new TentacleMesh(G.ship.root, 0.85, 0.12, tn.seed, 14);
      tn.view.mesh.visible = false;
      // A dark shadow on deck where a raised tentacle is about to come down
      tn.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x100008, transparent: true, opacity: 0, depthWrite: false }));
      tn.shadow.position.y = 0.04; tn.shadow.visible = false; tn.shadow.renderOrder = 2; G.ship.root.add(tn.shadow);
      return tn;
    });
    // Its strength, floating over the head
    this.barTex = canvasTex(256, 76, () => {});
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, transparent: true, depthWrite: false }));
    this.bar.renderOrder = 5; this.bar.position.set(0, 13.5, 0); this.head.add(this.bar); this.barShown = -1;
    // Something for our cannons to aim at (see aimPlayerCannons in main.js)
    this.target = { pos: new THREE.Vector3(), vel: G.ship.vel, root: { position: new THREE.Vector3() }, alive: true, hostile: true, isKraken: true };
    this.headPos = new THREE.Vector3(); this.mantlePos = new THREE.Vector3();
    G.events.on('voyageStarted', () => this.clear());
    G.events.on('gameReset', () => this.clear());
  }

  // In a fight (or about to be) that holds the voyage up
  get active() { return this.phase !== 'off' && this.phase !== 'dead'; }
  get done() { return this.phase === 'dead'; }
  // The head is up and can be shot
  get targetable() { return this.phase === 'fight' || (this.phase === 'rise' && this.G.t - this.t0 > RISE * 0.6); }

  setPhase(p) { this.phase = p; this.t0 = this.G.t; }

  clear() {
    this.phase = 'off';
    for (const tn of this.tents) { tn.state = tn.prev = 'under'; tn.t0 = -9; tn.hp = TENT_HP; }
  }

  // Start the fight (voyages.js). level: 0 on the first voyage, then harder.
  start(level = 0) {
    this.level = level;
    this.max = this.hp = 240 + 60 * level;
    this.side = Math.random() < 0.5 ? -1 : 1;
    // Keep clear of a prize lashed alongside
    const lock = this.G.grapples?.locks?.[0];
    if (lock && lock.side) this.side = -Math.sign(lock.side);
    this.dives = 0;
    this.clear();
    this.setPhase('stir');
    this.headWorld(this.headPos);
    this.G.events.emit('krakenStirs', { pos: this.headPos.clone() });
  }

  // ---------- Where things are (every headset) ----------
  // Head height above the water at time t
  headLift(t) {
    const u = t - this.t0;
    switch (this.phase) {
      case 'stir': return -16;
      case 'rise': return -16 + 16 * smooth(u / RISE);
      case 'fight': return Math.sin(t * 0.7) * 0.35;
      case 'dive': return -16 * smooth(u / DIVE);
      case 'dying': return -18 * smooth(u / DYING);
      default: return -30;
    }
  }
  placeFrame() {
    const S = this.G.ship;
    this.frame.position.set(S.pos.x, 0, S.pos.z);
    this.frame.rotation.set(0, S.heading, 0);
    this.frame.updateMatrixWorld(true);
  }
  // World position of the head's centre (eyes level)
  headWorld(out) {
    const S = this.G.ship;
    S.localToWorldXZ(this.side * DIST, 0, out);
    out.y = waveHeight(out.x, out.z, this.G.t) + this.headLift(this.G.t) + 2.6;
    return out;
  }

  // The four curve points of a tentacle doing `state` at time t (ship-local)
  pose(tn, state, t, P) {
    const s = tn.far ? -this.side : this.side, z0 = tn.z0, hw = halfWidth(z0), rail = railHeight(z0);
    const bx = s * (hw + tn.d), w = t * 1.2 + tn.seed, tx = tn.tx, tz = tn.tz;
    P[0].set(bx, BASE_Y, z0);
    switch (state) {
      case 'idle':
        P[1].set(bx, 3, z0);
        P[2].set(bx - s * 0.6 + Math.sin(w) * 0.9, 8, z0 + Math.cos(w * 0.8) * 1.3);
        P[3].set(bx - s * 2.4 + Math.sin(w * 1.3) * 1.3, 10.5 + Math.sin(w * 0.9), z0 + Math.sin(w * 0.7) * 2.2);
        break;
      case 'grab': {
        const sq = clamp(1 - (t - tn.sq) / 0.7, 0, 1) * 0.35;
        P[1].set(s * (hw + 1.4), -0.7, z0);
        P[2].set(s * (hw + 0.45 - sq), rail + 1.4 - sq, z0 + 0.3);
        P[3].set(s * (hw - 1.5 + sq), 0.3 + 0.08 * Math.sin(w * 3), z0 + 0.7 + 0.15 * Math.sin(w * 2));
        break;
      }
      case 'raise':
        P[1].set(bx, 4.5, z0);
        P[2].set(s * (hw + 0.5) + (tx - s * (hw + 0.5)) * 0.25, 10.5, z0 + (tz - z0) * 0.25);
        P[3].set(tx + Math.sin(w * 5) * 0.3, 8.5 + Math.sin(w * 4) * 0.4, tz + Math.cos(w * 5) * 0.3);
        break;
      case 'slam': case 'lie':
        P[1].set(s * (hw + 1.3), 1.6, z0);
        P[2].set(s * hw + (tx - s * hw) * 0.35, 1.3, z0 + (tz - z0) * 0.35);
        P[3].set(tx + (state === 'lie' ? Math.sin(w * 4) * 0.15 : 0), 0.32, tz);
        break;
      case 'reach':
        P[1].set(s * (hw + 1.3), 2, z0);
        P[2].set(s * (hw - 0.3) + (tx - s * (hw - 0.3)) * 0.4, 2.3, z0 + (tz - z0) * 0.4);
        P[3].set(tx + Math.sin(w * 3) * 0.3, 0.9 + 0.3 * Math.sin(w * 4), tz + Math.cos(w * 2.5) * 0.2);
        break;
      default: // under, hurt: sunk out of sight
        P[0].y = BASE_Y - 3;
        P[1].set(bx, BASE_Y - 2, z0); P[2].set(bx - s * 0.5, BASE_Y - 1.2, z0); P[3].set(bx - s, BASE_Y - 0.6, z0);
    }
    return P;
  }

  // Work out a tentacle's curve now (blending out of its last move) and sample points along it
  shape(tn, t) {
    const P = tn.P, k = smooth((t - tn.t0) / (BLEND[tn.state] || 1));
    this.pose(tn, tn.state, t, P);
    if (k < 1) {
      const Q = this._Q || (this._Q = [0, 1, 2, 3].map(() => new THREE.Vector3()));
      this.pose(tn, tn.prev, t, Q);
      for (let i = 0; i < 4; i++) P[i].lerp(Q[i], 1 - k);
    }
    for (let i = 0; i < 9; i++) {
      const u = i / 8, v = 1 - u;
      tn.pts[i].set(0, 0, 0).addScaledVector(P[0], v * v * v).addScaledVector(P[1], 3 * v * v * u).addScaledVector(P[2], 3 * v * u * u).addScaledVector(P[3], u * u * u);
    }
    tn.up = tn.state !== 'under' && !(tn.state === 'hurt' && k >= 1);
  }
  radius(u) { return (0.78 + (0.14 - 0.78) * Math.pow(u, 0.75)) * (u > 0.84 ? 1 - 0.85 * smooth((u - 0.84) / 0.16) : 1); }

  // ---------- Rules (host) ----------
  update(dt, t) {
    const G = this.G, S = G.ship;
    if (!this.active) return;
    const u = t - this.t0;
    // It has hold of the ship: she can barely make way
    if (this.phase !== 'stir' && this.phase !== 'dying') S.speed = Math.min(S.speed, 0.6);
    if (this.phase === 'stir' && u > STIR) { this.setPhase('rise'); this.headWorld(this.headPos); G.events.emit('krakenRises', { pos: this.headPos.clone(), first: this.dives === 0 }); }
    else if (this.phase === 'rise' && u > RISE) {
      this.setPhase('fight');
      this.tents.forEach((tn, i) => { tn.next = t + 0.5 + i * 0.7; });
    } else if (this.phase === 'dive' && u > DIVE) {
      this.side = -this.side;
      this.setPhase('rise'); this.headWorld(this.headPos);
      G.events.emit('krakenRises', { pos: this.headPos.clone(), first: false, side: this.side });
    } else if (this.phase === 'dying' && u > DYING) { this.setPhase('dead'); return; }

    this.headWorld(this.headPos);
    this.mantlePos.copy(this.headPos).y += MANTLE_UP;
    this.target.pos.set(this.headPos.x, 0, this.headPos.z);
    this.target.root.position.y = this.headPos.y + 0.6;

    const onDeck = G.players.filter((pl) => pl.ship === S && !pl.dead);
    const fighting = this.phase === 'fight';
    const busy = (st) => this.tents.filter((x) => x.state === st).length;
    for (const tn of this.tents) {
      this.shape(tn, t);
      tn.cd = Math.max(0, tn.cd - dt);
      const age = t - tn.t0;
      switch (tn.state) {
        case 'under': case 'hurt':
          if (tn.state === 'hurt' && age > 1) this.go(tn, 'under');
          if (tn.state === 'under' && fighting && t > tn.next) {
            this.go(tn, 'idle'); tn.hp = TENT_HP; tn.next = t + (tn.far ? rand(1.2, 2) : rand(2.5, 5));
            G.events.emit('tentacleRises', { pos: this.rootWorld(tn, _a).clone() });
          }
          break;
        case 'idle':
          if (!fighting || t < tn.next) break;
          if (tn.far || (busy('grab') < 3 && Math.random() < 0.25)) {
            this.go(tn, 'grab'); tn.sq = t; tn.squeezeAt = t + rand(4, 6); tn.next = t + rand(16, 24);
            G.events.emit('tentacleGrabs', { pos: this.tipWorld(tn, _a).clone() });
          } else if (busy('raise') + busy('slam') === 0 && Math.random() < 0.6) {
            const pl = onDeck.length ? onDeck[Math.floor(Math.random() * onDeck.length)] : null;
            if (pl) { tn.tx = pl.headLocal.x; tn.tz = pl.headLocal.z; } else { tn.tz = rand(-6, 5); tn.tx = rand(-1.5, 1.5); }
            this.clampDeck(tn);
            this.go(tn, 'raise'); tn.aimT = t + 1.3; tn.next = t + 2.4;
            G.events.emit('tentacleRaised', { pos: this.tipWorld(tn, _a).clone(), player: pl ? pl.id : null });
          } else if (onDeck.length && busy('reach') < 1) {
            const s = this.side; tn.tx = s * (halfWidth(tn.z0) - 1.2); tn.tz = tn.z0;
            this.go(tn, 'reach'); tn.next = t + rand(6, 9);
          } else tn.next = t + rand(1, 3);
          break;
        case 'grab':
          if (t > tn.squeezeAt) {
            tn.sq = t; tn.squeezeAt = t + rand(6, 8);
            S.damage(2 * this.mul);
            const p = this.tipWorld(tn, _a).clone();
            if (Math.random() < 0.3) G.damage.onHit(p);
            G.events.emit('tentacleSqueeze', { pos: p });
          }
          if (!fighting || (!tn.far && t > tn.next)) { this.go(tn, 'idle'); tn.next = t + rand(3, 6); }
          break;
        case 'raise': {
          // it follows its victim for a moment, then commits
          const pl = t < tn.aimT ? this.nearest(onDeck, tn.tx, tn.tz) : null;
          if (pl) { tn.tx += clamp(pl.headLocal.x - tn.tx, -2 * dt, 2 * dt); tn.tz += clamp(pl.headLocal.z - tn.tz, -2 * dt, 2 * dt); this.clampDeck(tn); }
          if (t > tn.next) { this.go(tn, 'slam'); tn.next = t + BLEND.slam; }
          break;
        }
        case 'slam':
          if (t > tn.next) {
            this.go(tn, 'lie'); tn.next = t + 2.8;
            _a.set(tn.tx, 0.3, tn.tz); S.root.localToWorld(_a);
            S.damage(5 * this.mul); G.damage.onHit(_a);
            for (const pl of onDeck) if (Math.hypot(pl.headLocal.x - tn.tx, pl.headLocal.z - tn.tz) < 1.9) G.hurtPlayer(pl, 25);
            G.events.emit('tentacleSlam', { pos: _a.clone() });
          }
          break;
        case 'lie':
          if (t > tn.next) { this.go(tn, 'idle'); tn.next = t + rand(4, 7); }
          break;
        case 'reach': {
          const pl = this.nearest(onDeck, tn.tx, tn.tz);
          if (pl) { tn.tx += clamp(pl.headLocal.x - tn.tx, -1.7 * dt, 1.7 * dt); tn.tz += clamp(pl.headLocal.z - tn.tz, -1.7 * dt, 1.7 * dt); this.clampDeck(tn); }
          const tip = tn.pts[8];
          for (const p of onDeck) {
            if ((tn.hurtCD[p.id] || 0) > t) continue;
            if (Math.hypot(p.headLocal.x - tip.x, p.headLocal.z - tip.z) < 0.85 && tip.y < p.headLocal.y + 0.2) {
              tn.hurtCD[p.id] = t + 1.8; G.hurtPlayer(p, 10);
              G.events.emit('tentacleLash', { pos: this.tipWorld(tn, _a).clone() });
            }
          }
          if (t > tn.next || !fighting || !onDeck.length) { this.go(tn, 'idle'); tn.next = t + rand(3, 6); }
          break;
        }
      }
      if (!fighting && tn.state !== 'under' && tn.state !== 'hurt' && this.phase !== 'rise') this.go(tn, 'hurt');
    }
  }
  get mul() { return 1 + 0.15 * this.level; }

  go(tn, state) { tn.prev = tn.state; tn.state = state; tn.t0 = this.G.t; }
  nearest(list, x, z) {
    let best = null, bd = 1e9;
    for (const pl of list) { const d = Math.hypot(pl.headLocal.x - x, pl.headLocal.z - z); if (d < bd) { bd = d; best = pl; } }
    return best;
  }
  clampDeck(tn) {
    tn.tz = clamp(tn.tz, BOW + 2, STERN - 1);
    const w = Math.max(0.3, halfWidth(tn.tz) - 0.6);
    tn.tx = clamp(tn.tx, -w, w);
  }
  rootWorld(tn, out) { const s = tn.far ? -this.side : this.side; out.set(s * (halfWidth(tn.z0) + tn.d), -1.3, tn.z0); return this.G.ship.root.localToWorld(out); }
  tipWorld(tn, out) { return this.G.ship.root.localToWorld(out.copy(tn.pts[7])); }

  // ---------- Getting hurt (host) ----------
  hitHead(n, pos) {
    if (!this.targetable) return false;
    this.hp = Math.max(0, this.hp - n);
    this.G.events.emit('krakenHit', { pos: pos.clone(), hp: this.hp, max: this.max });
    this.checkHp();
    return true;
  }
  checkHp() {
    const G = this.G;
    if (this.hp <= 0 && this.phase !== 'dying') {
      this.setPhase('dying'); this.headWorld(this.headPos);
      for (const tn of this.tents) if (tn.state !== 'under') this.go(tn, 'hurt');
      G.events.emit('krakenSlain', { pos: this.headPos.clone() });
    } else if (this.phase === 'fight' && this.hp < this.max * (2 - this.dives) / 3 && this.dives < 2) {
      this.dives++; this.setPhase('dive');
      for (const tn of this.tents) if (tn.state !== 'under') this.go(tn, 'hurt');
      G.events.emit('krakenDives', { pos: this.headPos.clone() });
    }
  }
  hitTentacle(tn, n, pos) {
    if (!tn.up || tn.state === 'hurt') return false;
    tn.hp -= n;
    if (tn.hp > 0) { this.G.events.emit('tentacleHit', { pos: pos.clone() }); return true; }
    this.go(tn, 'hurt'); tn.hp = TENT_HP; tn.next = this.G.t + REGROW;
    this.G.events.emit('tentacleSevered', { pos: pos.clone() });
    this.hp = Math.max(0, this.hp - SEVER_HURTS);
    this.checkHp();
    return true;
  }

  // A cannonball at world point p: did it hit us? (combat.js)
  ballHit(p) {
    if (!this.active) return false;
    const mul = this.G.island?.damageMul ?? 1;
    if (this.targetable && (p.distanceTo(this.headPos) < HEAD_R || p.distanceTo(this.mantlePos) < MANTLE_R)) return this.hitHead(14 * mul, p);
    _a.copy(p); this.G.ship.root.worldToLocal(_a);
    for (const tn of this.tents) {
      if (!tn.up || tn.state === 'hurt') continue;
      for (let i = 0; i < 8; i++) {
        const d = segSegDist(_a, _a, tn.pts[i], tn.pts[i + 1]).d;
        if (d < this.radius((i + 0.5) / 8) + 0.3) return this.hitTentacle(tn, 3, p);
      }
    }
    return false;
  }

  // A musket shot along a world ray: distance to what it hits first, or Infinity (combat.js)
  rayHit(origin, dir, max) {
    if (!this.active) return null;
    let best = null;
    if (this.targetable) for (const [c, r] of [[this.headPos, HEAD_R], [this.mantlePos, MANTLE_R]]) {
      _a.copy(c).sub(origin); const b = _a.dot(dir), d2 = _a.lengthSq() - b * b;
      if (b > 0 && d2 < r * r) { const t = b - Math.sqrt(r * r - d2); if (t < max && (!best || t < best.t)) best = { t, head: true }; }
    }
    const root = this.G.ship.root;
    _o.copy(origin); root.worldToLocal(_o);
    root.getWorldQuaternion(_q).invert(); _r.copy(dir).applyQuaternion(_q);
    _e.copy(_o).addScaledVector(_r, max);
    for (const tn of this.tents) {
      if (!tn.up || tn.state === 'hurt') continue;
      for (let i = 0; i < 8; i++) {
        const r = segSegDist(_o, _e, tn.pts[i], tn.pts[i + 1]);
        const t = r.s * max;
        if (r.d < this.radius((i + 0.5) / 8) + 0.12 && (!best || t < best.t)) best = { t, tn };
      }
    }
    return best;
  }
  applyRay(hit, pos) { if (hit.head) this.hitHead(2, pos); else this.hitTentacle(hit.tn, 2, pos); }

  // A VR cutlass (hilt/tip in our ship's local space). Returns true if it cut something.
  swordCheck(hilt, tip, speed) {
    if (!this.active) return false;
    let any = false;
    for (const tn of this.tents) {
      if (!tn.up || tn.state === 'hurt' || tn.cd > 0) continue;
      for (let i = 1; i < 8; i++) {
        if (segSegDist(hilt, tip, tn.pts[i], tn.pts[i + 1]).d < this.radius((i + 0.5) / 8) + 0.08) {
          _b.copy(tip).sub(hilt).multiplyScalar(0.7).add(hilt); this.G.ship.root.localToWorld(_b);
          this.G.events.emit('bladeContact', { pos: _b });
          tn.cd = 0.35; this.hitTentacle(tn, speed > 6 ? 2 : 1, _b); any = true; break;
        }
      }
    }
    return any;
  }
  // Desktop slash: any tentacle within reach in front of you (h = head, facing: flat, ship-local)
  deskSlash(h, facing) {
    if (!this.active) return;
    for (const tn of this.tents) {
      if (!tn.up || tn.state === 'hurt') continue;
      for (let i = 2; i < 9; i++) {
        const p = tn.pts[i], dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
        if (d < 2.6 && p.y < 2.6 && p.y > -0.5 && (dx * facing.x + dz * facing.z) / Math.max(d, 1e-3) > 0.4) {
          _b.copy(p); this.G.ship.root.localToWorld(_b);
          this.G.events.emit('bladeContact', { pos: _b });
          this.hitTentacle(tn, 1, _b); break;
        }
      }
    }
  }

  // ---------- Multiplayer ----------
  snap() {
    if (!this.active) return { phase: this.phase };
    const r2 = (v) => Math.round(v * 100) / 100;
    return { phase: this.phase, t0: r2(this.t0), side: this.side, hp: Math.round(this.hp), max: this.max, dives: this.dives,
      tn: this.tents.map((tn) => [tn.state, tn.prev, r2(tn.t0), r2(tn.tx), r2(tn.tz)]) };
  }
  applySnap(s) {
    if (!s) return;
    this.phase = s.phase;
    if (s.tn) {
      this.t0 = s.t0; this.side = s.side; this.hp = s.hp; this.max = s.max; this.dives = s.dives;
      s.tn.forEach((a, i) => { const tn = this.tents[i]; [tn.state, tn.prev, tn.t0, tn.tx, tn.tz] = a; });
    }
  }

  // ---------- Looks (every headset) ----------
  view(dt) {
    const G = this.G, t = G.t, show = this.active;
    this.frame.visible = show && this.phase !== 'stir';
    for (const tn of this.tents) if (!show) { tn.view.mesh.visible = false; tn.shadow.visible = false; }
    if (!show) return;
    this.uTime.value = t;
    this.placeFrame();
    this.headWorld(this.headPos);
    this.mantlePos.copy(this.headPos).y += MANTLE_UP;
    // Head: out on its side, facing the ship, rocking a little
    const lift = this.headLift(t);
    this.frame.worldToLocal(_a.copy(this.headPos));
    this.head.position.set(_a.x, _a.y - 2.6 + 0.6, 0);
    this.head.rotation.set(Math.sin(t * 0.5) * 0.05, -this.side * Math.PI / 2 + Math.sin(t * 0.31) * 0.12, Math.sin(t * 0.43) * 0.05);
    if (this.phase === 'dying') this.head.rotation.z += smooth((t - this.t0) / DYING) * 0.6;
    // The two flailing beside the head
    this.headFlare.forEach((f, i) => {
      const s = i % 2 ? 1 : -1, w = t * 1.1 + i * 2;
      const P = this._F || (this._F = [0, 1, 2, 3].map(() => new THREE.Vector3()));
      if (i < 2) {
        P[0].set(s * 3.4, -9, 1.0); P[1].set(s * 5.5, 0, 3.5);
        P[2].set(s * (7 + Math.sin(w) * 1.2), 5 + Math.cos(w * 0.8), 5 + Math.sin(w * 0.7) * 1.5);
        P[3].set(s * (5.5 + Math.sin(w * 1.4) * 1.5), 7.5 + Math.sin(w * 1.1) * 1.2, 7 + Math.cos(w * 0.9) * 1.5);
        f.u.uIn.value.set(-s, 0, 0);
      } else {
        // in front of the face, rising out of the water and curling back toward it
        P[0].set(s * 2.0, -8, 2.2); P[1].set(s * 2.8, -1.0, 5.6);
        P[2].set(s * (4.4 + Math.sin(w) * 0.7), 0.4 + Math.cos(w * 0.9) * 0.5, 7.0 + Math.sin(w * 0.7) * 0.8);
        P[3].set(s * (5.6 + Math.sin(w * 1.3) * 0.8), 1.4 + Math.sin(w * 1.2) * 0.6, 5.4 + Math.cos(w * 0.8) * 0.8);
        f.u.uIn.value.set(0, 0, -1);
      }
      f.set(P, t);
    });
    // A bubbling, churning patch where it's about to come up
    if ((this.phase === 'stir' || (this.phase === 'rise' && lift < -2)) && Math.random() < dt * 30) {
      _b.set(this.headPos.x + rand(-5, 5), waveHeight(this.headPos.x, this.headPos.z, t) + 0.2, this.headPos.z + rand(-5, 5)); G.fx.foam(_b);
    }
    // Tentacles
    for (const tn of this.tents) {
      this.shape(tn, t);
      const m = tn.view.mesh;
      m.visible = tn.up;
      if (tn.up) {
        tn.view.u.uIn.value.set(tn.far ? this.side : -this.side, 0, 0);
        tn.view.set(tn.P, t);
        if (Math.random() < dt * 2.5) { this.rootWorld(tn, _b); _b.y = waveHeight(_b.x, _b.z, t) + 0.2; G.fx.foam(_b); }
      }
      // shadow under a raised tentacle, darkening until it comes down
      const sh = tn.shadow, raising = tn.state === 'raise' || (tn.state === 'slam' && t - tn.t0 < BLEND.slam);
      sh.visible = raising;
      if (raising) { const k = clamp((t - tn.t0) / 2.4, 0, 1); sh.position.x = tn.tx; sh.position.z = tn.tz; sh.material.opacity = 0.25 + 0.45 * k; sh.scale.setScalar(0.6 + 0.6 * k); }
    }
    this.drawBar();
  }

  drawBar() {
    const v = clamp(this.hp / this.max, 0, 1);
    this.bar.visible = this.phase === 'fight' || this.phase === 'rise' || this.phase === 'dive';
    if (Math.abs(v - this.barShown) > 0.004) {
      this.barShown = v;
      const g = this.barTex.userData.ctx, H = 76, y = H - 40;
      g.clearRect(0, 0, 256, H);
      g.fillStyle = 'rgba(20,12,6,0.75)'; g.fillRect(0, 0, 256, y);
      g.fillStyle = '#ffd25a'; g.font = 'bold 24px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('The Kraken', 128, y / 2 + 1, 244);
      g.fillStyle = 'rgba(20,12,6,0.75)'; g.fillRect(0, y, 256, 40);
      g.fillStyle = v > 0.35 ? '#8e44ad' : '#ff7a2a'; g.fillRect(6, y + 6, 244 * v, 28);
      g.strokeStyle = '#ffd25a'; g.lineWidth = 4; g.strokeRect(2, y + 2, 252, 36);
      this.barTex.needsUpdate = true;
    }
    this.bar.scale.set(7, 7 * 76 / 256, 1);
  }
}
