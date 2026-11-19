// Time of day and weather: fair day, night, storm, or a stormy night.
//
// Two dials drive everything: `night` (0 = midday, 1 = moonlit night) and `storm` (0 = fair,
// 1 = full gale). Each named condition is just a setting of the two dials, and changing
// condition eases the dials over ~25 s, so a voyage can roll in a storm mid-fight:
//   G.weather.set('storm')                    // ease into a storm
//   G.weather.set('night', { instant: true }) // jump straight there (e.g. at the start of a voyage)
//
// What the dials change:
//   sky, clouds, stars, moon, fog, sunlight and the sea's colours (world.js uniforms)
//   wave height (waves.js), with our own ship's rocking eased so the storm stays comfortable
//   rain, lightning and thunder, storm wind and rain sounds
//   lanterns on every ship, a lamp over our deck, and cannon flashes that light up the night
import * as THREE from 'three';
import { setSeaState } from './waves.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from './util.js';

// Lantern spots on every ship (ship-local x, y, z, and the size of its glow)
const LANTERNS = [[0, 3.35, 7.98, 3.2], [0.32, 5.4, -1, 2.4]];

export const CONDITIONS = {
  day: { label: 'Fair day', night: 0, storm: 0 },
  night: { label: 'Night', night: 1, storm: 0 },
  storm: { label: 'Storm', night: 0, storm: 1 },
  stormNight: { label: 'Stormy night', night: 1, storm: 1 },
};
export const CONDITION_NAMES = Object.keys(CONDITIONS);

// Our ship's rocking. The day values were tested on the headset (comfort 0.45); in a full storm
// the waves are about 2x taller, so our hull follows less of them: roll goes from ~3 to ~4
// degrees and the rise and fall from ~0.45 m to ~0.7 m. Enemy ships get the full storm.
const COMFORT = { day: 0.45, storm: 0.33 }, HEAVE = { day: 0.6 + 0.4 * 0.45, storm: 0.42 };

// Colours and light levels at the four corners: [day, night, storm, stormy night]
const C = (a, b, c, d) => [a, b, c, d].map((x) => new THREE.Color(x));
const PAL = {
  horizon: C('#c3d3dc', '#1c2b40', '#78838e', '#131a24'),
  zenith: C('#3f78b5', '#050b1a', '#4a535d', '#06090f'),
  hemiSky: C('#cfe2f2', '#7d93c4', '#aab4bf', '#5a6880'),
  hemiGround: C('#5a4a34', '#1c1c26', '#3a3a3a', '#141418'),
  sun: C('#ffe8c4', '#a9c1ff', '#c8d0d8', '#8090b0'),
  sunGlow: C('#ffdb9e', '#4a5a7a', '#202224', '#0a0c10'),     // glow round the sun/moon, and its glints on the sea
  disc: C('#fff2d8', '#e8eefa', '#000000', '#000000'),
  cloudDark: C('#b8c2d1', '#0e131c', '#3c4249', '#0b0e13'),
  cloudLit: C('#fffaf0', '#2a3446', '#6a7179', '#1a2029'),
  deep: C('#062a40', '#03141f', '#0a2230', '#020a10'),
  mid: C('#0f4a63', '#062634', '#173a48', '#04141c'),
  shallow: C('#1f8f94', '#0c3a40', '#2b5f62', '#082024'),
};
const NUM = {
  hemi: [1.15, 0.5, 0.85, 0.42],
  sun: [2.1, 0.55, 0.45, 0.12],
  light: [1, 0.42, 0.62, 0.3],         // how bright the sea's own colour is
  fogNear: [140, 90, 45, 35],
  fogFar: [1700, 1000, 520, 420],
  discSize: [0, 0.00007, 0, 0],      // the moon is drawn a little bigger than the sun
};
function mixC(out, k, n, s) {
  const p = PAL[k];
  return out.setRGB(
    (p[0].r * (1 - s) + p[2].r * s) * (1 - n) + (p[1].r * (1 - s) + p[3].r * s) * n,
    (p[0].g * (1 - s) + p[2].g * s) * (1 - n) + (p[1].g * (1 - s) + p[3].g * s) * n,
    (p[0].b * (1 - s) + p[2].b * s) * (1 - n) + (p[1].b * (1 - s) + p[3].b * s) * n);
}
const mixN = (k, n, s) => { const p = NUM[k]; return (p[0] * (1 - s) + p[2] * s) * (1 - n) + (p[1] * (1 - s) + p[3] * s) * n; };

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.7)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Rain: one draw call of streaks in a 50 m box that follows your head. The shader moves
// each drop and wraps it round the box, so nothing is updated per drop on the CPU.
const RAIN_N = 1400, RAIN_BOX = 50, RAIN_H = 26;
function makeRain() {
  const pos = new Float32Array(RAIN_N * 6), end = new Float32Array(RAIN_N * 2), rnd = new Float32Array(RAIN_N * 2);
  for (let i = 0; i < RAIN_N; i++) {
    const x = Math.random() * RAIN_BOX, y = Math.random() * RAIN_H, z = Math.random() * RAIN_BOX, r = Math.random();
    pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; rnd[i * 2] = rnd[i * 2 + 1] = r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(4, 1.5) },
      uAmt: { value: 0 }, uLight: { value: 1 } },
    vertexShader: `
      uniform float uTime, uAmt; uniform vec3 uCenter; uniform vec2 uWind;
      attribute float aEnd, aRnd; varying float vA;
      void main(){
        vec3 vel = vec3(uWind.x, -13.0 - aRnd * 4.0, uWind.y);
        vec3 box = vec3(${RAIN_BOX.toFixed(1)}, ${RAIN_H.toFixed(1)}, ${RAIN_BOX.toFixed(1)});
        vec3 lo = uCenter - vec3(box.x * 0.5, 8.0, box.z * 0.5);
        vec3 p = lo + mod(position + vel * uTime - lo, box);
        p -= vel * 0.045 * aEnd;
        float d = length(p - uCenter);
        vA = step(aRnd, uAmt) * (1.0 - smoothstep(14.0, 25.0, d)) * smoothstep(0.6, 2.0, d) * (aEnd < 0.5 ? 1.0 : 0.15);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uLight; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.75, 0.8, 0.88) * uLight, vA * 0.45); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.renderOrder = 5; lines.visible = false;
  return lines;
}

// A jagged lightning bolt from the clouds to the sea, rebuilt for each strike
function makeBolt() {
  const SEG = 14, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat); line.frustumCulled = false; line.visible = false;
  line.userData.SEG = SEG;
  return line;
}

export class Weather {
  constructor(G) {
    this.G = G;
    const L = this.look = G.world.look, scene = L.scene;
    this.name = 'day'; this.night = 0; this.storm = 0; this.target = CONDITIONS.day; this.rate = 1 / 25;
    this.cloudT = 0; this.flash = 0; this.strikeT = rand(4, 9); this.strikes = []; this.lit = null;
    this._c = new THREE.Color(); this._v = new THREE.Vector3(); this._w = new THREE.Vector3();

    this.rain = makeRain(); scene.add(this.rain);
    this.bolt = makeBolt(); scene.add(this.bolt);

    // Lantern parts shared by every ship
    this.glowTex = glowTex();
    this.lampGlass = new THREE.MeshBasicMaterial({ color: 0x8a6a3a });
    this.lampFrame = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
    this.haloMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb35c, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

    // Two lights, only switched on when it's dark (switching costs a shader rebuild, so only
    // the dark/light change does it, never each cannon shot):
    //   a warm lamp over our deck so you can see what you're doing
    //   a flash that jumps to each cannon as it fires and lights up the ships around it
    this.deckLamp = new THREE.PointLight(0xffb066, 0, 24, 1.6);
    this.deckLamp.position.set(0, 3.4, 2.5); G.ship.root.add(this.deckLamp);
    this.flashLight = new THREE.PointLight(0xffb070, 0, 110, 1.2);
    scene.add(this.flashLight);
    this.flashE = 0;
    this.setLit(false);

    const flashAt = (pos, e) => { if (e >= this.flashE * 0.6) { this.flashLight.position.copy(pos); this.flashE = Math.max(this.flashE, e); } };
    G.events.on('cannonFired', ({ pos, dir }) => flashAt(this._v.copy(pos).addScaledVector(dir, 1.5), 1));
    G.events.on('kegExploded', ({ pos }) => flashAt(this._v.copy(pos).setY(pos.y + 2), 2.5));
    G.events.on('musketShot', ({ from }) => flashAt(from, 0.25));
  }

  // Pick a condition: 'day' | 'night' | 'storm' | 'stormNight' (see CONDITIONS)
  set(name, { instant = false } = {}) {
    if (!CONDITIONS[name]) name = 'day';
    this.name = name; this.target = CONDITIONS[name];
    if (instant) { this.night = this.target.night; this.storm = this.target.storm; }
  }

  setLit(on) {
    if (this.lit === on) return;
    this.lit = on;
    this.deckLamp.visible = on; this.flashLight.visible = on;
  }

  // Lanterns on a ship: one on the stern rail and one hung on the main mast. Both lanterns'
  // frames are one mesh and both glasses another, to keep draw calls low on the Quest.
  lanterns(ship) {
    if (ship._lanterns) return ship._lanterns;
    if (!this.lampGeos) {
      const frame = [], glass = [], m = new THREE.Matrix4();
      const put = (list, geo, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => {
        const g = geo.clone(); g.applyMatrix4(m.makeRotationY(ry).scale(this._v.set(sx, sy, sz)).setPosition(x, y, z)); list.push(g);
      };
      const box = new THREE.BoxGeometry(0.22, 0.3, 0.22), cap = new THREE.CylinderGeometry(0.05, 0.16, 0.12, 4).toNonIndexed();
      const boxN = box.toNonIndexed();
      for (const [x, y, z] of LANTERNS) {
        put(glass, boxN, x, y, z);
        put(frame, cap, x, y + 0.21, z, 1, 1, 1, Math.PI / 4);
        put(frame, boxN, x, y - 0.17, z, 1.15, 0.15, 1.15);
        if (z > 7) put(frame, boxN, x, y - 0.55, z, 0.3, 2.4, 0.3);
      }
      const clean = (l) => l.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; });
      this.lampGeos = { frame: mergeGeometries(clean(frame)), glass: mergeGeometries(clean(glass)) };
    }
    const frame = new THREE.Mesh(this.lampGeos.frame, this.lampFrame), glass = new THREE.Mesh(this.lampGeos.glass, this.lampGlass);
    ship.root.add(frame, glass);
    const halos = LANTERNS.map(([x, y, z, size]) => {
      const h = new THREE.Sprite(this.haloMat); h.position.set(x, y, z); h.scale.setScalar(size); ship.root.add(h); return h;
    });
    return (ship._lanterns = halos);
  }

  strike() {
    const G = this.G, S = G.ship;
    const ang = rand(0, Math.PI * 2), dist = rand(140, 650);
    const x = S.pos.x + Math.sin(ang) * dist, z = S.pos.z + Math.cos(ang) * dist;
    const a = this.bolt.geometry.attributes.position, SEG = this.bolt.userData.SEG;
    let px = x + rand(-40, 40), pz = z + rand(-40, 40);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      a.setXYZ(i, px, 260 * (1 - u), pz);
      px += (x - px) / (SEG - i + 1) + rand(-9, 9); pz += (z - pz) / (SEG - i + 1) + rand(-9, 9);
    }
    a.needsUpdate = true;
    // flicker: two or three quick pulses
    const now = G.t; this.strikes.length = 0;
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) this.strikes.push({ t: now + i * rand(0.07, 0.14), e: i === 0 ? 1 : rand(0.4, 0.8) });
    this.boltT = 0.28;
    this._v.set(x, 0, z);
    G.audio.thunder?.(this._v, dist / 343, 1 - dist / 650);
  }

  update(dt, t, camPos) {
    const G = this.G, L = this.look, tg = this.target;
    const step = this.rate * dt;
    this.night += Math.max(-step, Math.min(step, tg.night - this.night));
    this.storm += Math.max(-step, Math.min(step, tg.storm - this.storm));
    const n = this.night, s = this.storm, c = this._c;

    // ---- The sea ----
    setSeaState(s);
    const S = G.ship;
    S.comfort = COMFORT.day + (COMFORT.storm - COMFORT.day) * s;
    S.heave = HEAVE.day + (HEAVE.storm - HEAVE.day) * s;

    // ---- Lightning ----
    if (s > 0.6) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) { this.strikeT = rand(5, 14) / s; this.strike(); }
    }
    let f = 0;
    for (const p of this.strikes) { const u = t - p.t; if (u >= 0 && u < 0.5) f = Math.max(f, p.e * Math.exp(-u * 14)); }
    this.flash = f;
    if (this.boltT > 0) { this.boltT -= dt; this.bolt.visible = this.boltT > 0 && f > 0.05; this.bolt.material.opacity = Math.min(1, f * 1.5); }

    // ---- Sky, light, fog ----
    const sky = L.sky;
    mixC(sky.uHorizon.value, 'horizon', n, s); mixC(sky.uZenith.value, 'zenith', n, s);
    mixC(sky.uSunCol.value, 'sunGlow', n, s); mixC(sky.uDisc.value, 'disc', n, s);
    mixC(sky.uCloudDark.value, 'cloudDark', n, s); mixC(sky.uCloudLit.value, 'cloudLit', n, s);
    sky.uNight.value = n * (1 - s); sky.uCloud.value = s; sky.uFlash.value = f; sky.uDiscSize.value = mixN('discSize', n, s);
    this.cloudT += dt * 0.004 * (1 + s * 5); sky.uCloudT.value = this.cloudT;

    const fog = L.scene.fog;
    mixC(fog.color, 'horizon', n, s); fog.near = mixN('fogNear', n, s); fog.far = mixN('fogFar', n, s);
    L.scene.background.copy(fog.color);
    mixC(L.hemi.color, 'hemiSky', n, s); mixC(L.hemi.groundColor, 'hemiGround', n, s);
    L.hemi.intensity = mixN('hemi', n, s) + f * 2.2;
    mixC(L.sun.color, 'sun', n, s); L.sun.intensity = mixN('sun', n, s);

    const light = mixN('light', n, s);
    for (const u of L.ocean) {
      u.uSkyLo.value.copy(fog.color); u.uSkyHi.value.copy(sky.uZenith.value); u.uFogColor.value.copy(fog.color);
      u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
      mixC(u.uDeep.value, 'deep', n, s); mixC(u.uMid.value, 'mid', n, s); mixC(u.uShallow.value, 'shallow', n, s);
      u.uSunCol.value.copy(sky.uSunCol.value); u.uLight.value = light; u.uStorm.value = s; u.uFlash.value = f;
    }

    // ---- Rain ----
    const rain = this.rain, ru = rain.material.uniforms;
    rain.visible = s > 0.05;
    if (rain.visible) {
      ru.uTime.value = t; ru.uCenter.value.copy(camPos); ru.uAmt.value = Math.min(1, s * 1.15);
      ru.uLight.value = 0.35 + light * 0.6 + f * 1.5;
    }
    G.audio.storm = s;

    // ---- Lanterns and night lights ----
    const dark = Math.max(n, s * 0.6);
    this.setLit(dark > 0.3);
    this.lampGlass.color.setRGB(0.55 + dark * 0.45, 0.42 + dark * 0.4, 0.22 + dark * 0.2);
    this.haloMat.opacity = Math.max(0, dark - 0.15) * 1.0;
    G.fx.shade = 1 - dark * 0.68 + f * 0.5;
    for (const ship of [S, ...G.enemies.ships]) {
      const ls = this.lanterns(ship);
      // lanterns go out as a ship sinks
      const on = ship.alive || ship.sinkT < 2;
      for (const h of ls) h.visible = on && dark > 0.15;
    }
    if (this.lit) {
      this.deckLamp.intensity = dark * 7 * (0.92 + 0.08 * Math.sin(t * 9.3) * Math.sin(t * 5.1));
      this.flashE = Math.max(0, this.flashE - dt * 5 * Math.max(this.flashE, 0.4));
      this.flashLight.intensity = this.flashE * 160 * Math.max(dark, 0.4);
    }
    // Spray off the bow of every ship as she ploughs through a storm
    if (s > 0.3) for (const sh of [S, ...G.enemies.ships]) {
      if (!sh.alive || Math.random() > s * dt * 2.2) continue;
      this._v.set(rand(-1.2, 1.2), -0.6, -9.6); sh.root.localToWorld(this._v);
      for (let i = 0; i < 4; i++) G.fx.emit(this._v, { vel: this._w.set(rand(-1.5, 1.5), rand(3, 6), rand(-1.5, 1.5)).clone(), life: rand(0.6, 1), s0: rand(0.3, 0.6), s1: rand(0.9, 1.4), color: 0xe8f0f6, grav: 10, alpha: 0.5 });
    }
  }
}
