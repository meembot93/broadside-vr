import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { waveHeight } from './waves.js';
import { clamp, damp, angleWrap, canvasTex } from './util.js';

// Ship-local frame: deck at y=0, bow toward -Z, starboard toward +X.
export const BOW = -10, STERN = 8;
export function halfWidth(z) {
  if (z > STERN || z < BOW) return 0;
  if (z >= 2) return 3.2 - ((z - 2) / 6) * 0.35;
  const u = (2 - z) / 12;
  return 3.2 * Math.sqrt(Math.max(0, 1 - u * u));
}
export const BALL_SPEED = 55;
const G_ACC = 9.81;

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
    this.isPlayer = !!o.isPlayer;
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ'; scene.add(this.root);
    this.pos = new THREE.Vector3(o.x || 0, 0, o.z || 0);
    this.heading = o.heading || 0;
    this.speed = 0; this.sail = o.sail ?? 0.5; this.rudder = 0;
    this.maxSpeed = o.maxSpeed || 9; this.turnRate = o.turnRate || 0.24;
    this.maxHealth = this.health = o.health || 100;
    this.alive = true; this.sinkT = 0; this.sinkTilt = Math.random() < 0.5 ? 1 : -1;
    this.vel = new THREE.Vector3(); this.pitch = 0; this.roll = 0; this.bob = 0;
    this.comfort = o.comfort ?? 1;
    this.reloadTime = o.reloadTime || 7;
    this.cannons = []; this.sails = []; this.crew = [];
    this.geos = [];
    this.build(o);
  }

  build(o) {
    const enemy = !this.isPlayer;
    const hullMat = new THREE.MeshLambertMaterial({ color: enemy ? 0x2f2823 : 0x5d3b22 });
    const trimMat = new THREE.MeshLambertMaterial({ color: enemy ? 0x7a1515 : 0xb8902f });
    const wallMat = new THREE.MeshLambertMaterial({ color: enemy ? 0x3a3029 : 0x6e4a2c, side: THREE.DoubleSide });
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

    const extrudeHull = (scale, depth, top) => {
      const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x * scale, z * (1 + (scale - 1) * 0.3))));
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
      g.rotateX(Math.PI / 2); g.translate(0, top, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) p.setX(i, p.getX(i) * (1 + y * 0.11)); }
      g.computeVertexNormals();
      return g;
    };
    add(extrudeHull(1, 2.6, 0), hullMat);
    add(extrudeHull(1.018, 0.22, -0.28), trimMat);
    add(extrudeHull(1.012, 0.12, -1.1), trimMat);

    // Deck
    const deckShape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x * 0.985, -z * 0.995)));
    const deckGeo = new THREE.ShapeGeometry(deckShape); deckGeo.rotateX(-Math.PI / 2);
    add(deckGeo, deckMat, 0, 0.02, 0);

    // Bulwark wall and rail
    const wallPos = [];
    const loop = outline.map(([x, z]) => [x * 0.99, z * 0.996]);
    const H = 0.95;
    for (let i = 0; i < loop.length; i++) {
      const [x1, z1] = loop[i], [x2, z2] = loop[(i + 1) % loop.length];
      wallPos.push(x1, 0, z1, x2, 0, z2, x2, H, z2, x1, 0, z1, x2, H, z2, x1, H, z1);
    }
    const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wallGeo.computeVertexNormals(); add(wallGeo, wallMat);
    const railCurve = new THREE.CatmullRomCurve3(loop.map(([x, z]) => new THREE.Vector3(x, H + 0.03, z)), true);
    add(new THREE.TubeGeometry(railCurve, 120, 0.07, 5, true), dark);

    // Stern cabin
    const cw = halfWidth(7.65) * 2 * 0.99;
    add(new THREE.BoxGeometry(cw, 2.5, 0.7), wallMat, 0, 1.25, 7.65);
    add(new THREE.BoxGeometry(cw + 0.1, 0.12, 0.8), dark, 0, 2.52, 7.65);
    add(new THREE.BoxGeometry(0.9, 1.9, 0.06), dark, 0, 0.95, 7.29);
    for (const x of [-1.7, 1.7]) add(new THREE.BoxGeometry(0.6, 0.55, 0.05), glow, x, 1.55, 7.29);
    for (const x of [-cw / 2 + 0.1, cw / 2 - 0.1]) add(new THREE.BoxGeometry(0.18, 0.28, 0.18), glow, x, 2.75, 7.4);

    // Masts, yards, furled canvas, crow's nest, bowsprit
    const masts = [{ z: -1, h: 15, r: 0.24, sails: [{ y: 13.4, w: 6, h: 4.4 }, { y: 8.6, w: 7.6, h: 5.7 }] },
      { z: -6.5, h: 12.5, r: 0.21, sails: [{ y: 11.2, w: 5.2, h: 3.9 }, { y: 6.9, w: 6.6, h: 5.0 }] }];
    for (const m of masts) {
      add(new THREE.CylinderGeometry(m.r * 0.65, m.r, m.h, 8), wood, 0, m.h / 2 - 0.5, m.z);
      for (const s of m.sails) {
        add(new THREE.CylinderGeometry(0.08, 0.08, s.w + 0.6, 6), dark, 0, s.y, m.z - 0.25, 0, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(0.15, 0.15, s.w * 0.92, 6), sailMat, 0, s.y - 0.1, m.z - 0.33, 0, 0, Math.PI / 2);
        const sm = this.makeSail(s.w, s.h, sailMat);
        sm.position.set(0, s.y - 0.05, m.z - 0.38);
        this.root.add(sm);
      }
    }
    add(new THREE.CylinderGeometry(0.72, 0.58, 0.55, 10, 1, true), wood, 0, 10.4, -1);
    add(new THREE.CylinderGeometry(0.72, 0.72, 0.06, 10), dark, 0, 10.15, -1);
    add(new THREE.CylinderGeometry(0.1, 0.17, 5.2, 7), wood, 0, 1.45, -11.85, -70 * Math.PI / 180, 0, 0);

    // Cannon carriages (barrels are separate, they move)
    const cz = [-3, 1];
    for (const s of [-1, 1]) for (const z of cz) {
      add(new THREE.BoxGeometry(0.62, 0.3, 0.72), dark, s * 2.3, 0.3, z);
      for (const dx of [-0.26, 0.26]) for (const dz of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), wood, s * 2.3 + dx, 0.14, z + dz, 0, 0, Math.PI / 2);
      const outer = new THREE.Group(); outer.position.set(s * 2.3, 0.62, z); outer.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      const elev = new THREE.Group(); outer.add(elev);
      const barrel = new THREE.Group(); elev.add(barrel);
      barrel.add(new THREE.Mesh(BARREL_GEO, IRON), new THREE.Mesh(KNOB_GEO, IRON), new THREE.Mesh(RING_GEO, IRON));
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.3); elev.add(muzzle);
      const breech = new THREE.Object3D(); breech.position.set(0, 0.05, 0.62); elev.add(breech);
      this.root.add(outer);
      this.cannons.push({ side: s, z, outer, elev, barrel, muzzle, breech, baseYaw: outer.rotation.y,
        elevation: 0.06, yaw: 0, tElev: 0.06, tYaw: 0, reload: 0, fuse: -1, recoil: 0, inArc: false, sparkT: 0 });
    }

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
      // Weapon rack behind the main mast
      add(new THREE.BoxGeometry(1.5, 1.2, 0.08), dark, 0, 1.2, -0.62);
      add(new THREE.BoxGeometry(1.5, 0.1, 0.25), dark, 0, 0.5, -0.55);
    }

    // Rigging
    const lines = [];
    const L = (a, b) => lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    for (const m of masts) {
      const top = [0, m.h - 0.6, m.z];
      for (const s of [-1, 1]) for (const dz of [-1.2, 0, 1.2]) L(top, [s * halfWidth(m.z + dz) * 0.97, H, m.z + dz]);
    }
    L([0, 14.4, -1], [0, 11.6, -6.5]); L([0, 11.6, -6.5], [0, 3.8, -14.2]); L([0, 14.4, -1], [0, 2.6, 7.6]);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const rig = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2018 }));
    this.root.add(rig); this.geos.push(lg);

    // Flag
    const fgeo = new THREE.PlaneGeometry(1.9, 1.15, 10, 1).translate(0.95, 0, 0).rotateY(-Math.PI / 2);
    this.flag = new THREE.Mesh(fgeo, new THREE.MeshLambertMaterial({ map: flagTex(enemy ? 'red' : 'jolly'), side: THREE.DoubleSide }));
    this.flag.position.set(0, 14.6, -1); this.root.add(this.flag);
    this.flagBase = Float32Array.from(fgeo.attributes.position.array);

    // Merge static parts per material
    for (const [mat, list] of parts) {
      const g = mergeGeometries(list);
      const mesh = new THREE.Mesh(g, mat); this.root.add(mesh); this.geos.push(g);
      list.forEach((x) => x.dispose());
    }
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

  update(dt, t) {
    if (this.alive) {
      this.speed = damp(this.speed, this.sail * this.maxSpeed, 0.35, dt);
      this.heading -= this.rudder * this.turnRate * (0.3 + 0.7 * (this.speed / this.maxSpeed)) * dt;
    } else {
      this.sinkT += dt;
      this.speed = damp(this.speed, 0, 0.6, dt);
    }
    this.vel.set(-Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
    this.pos.addScaledVector(this.vel, dt);

    // Float on the waves
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
    this.bob = damp(this.bob, hc * (0.6 + 0.4 * this.comfort), 4, dt);
    this.root.position.set(this.pos.x, this.bob + 1.3 - sink, this.pos.z);
    this.root.rotation.set(this.pitch, this.heading, this.roll);
    this.root.updateMatrixWorld(true);

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
      c.reload = Math.max(0, c.reload - dt);
      c.elevation = damp(c.elevation, c.tElev, 4, dt); c.yaw = damp(c.yaw, c.tYaw, 4, dt);
      c.elev.rotation.x = c.elevation; c.outer.rotation.y = c.baseYaw + c.yaw;
      c.recoil = Math.max(0, c.recoil - dt * 1.6);
      c.barrel.position.z = Math.sin(Math.min(1, c.recoil) * Math.PI * 0.5) * 0.4;
    }
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

  // Ready to fire and pointing roughly where it wants to
  cannonReady(c) { return c.reload <= 0 && c.fuse < 0 && this.alive; }
  lightCannon(c, delay = 0.4) { if (!this.cannonReady(c)) return false; c.fuse = delay; return true; }

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
