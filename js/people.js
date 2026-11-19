import * as THREE from 'three';

const mats = new Map();
const M = (c) => { if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c })); return mats.get(c); };

const GEO = {
  leg: new THREE.CylinderGeometry(0.075, 0.062, 0.86, 7).translate(0, -0.43, 0),
  boot: new THREE.BoxGeometry(0.13, 0.13, 0.25).translate(0, -0.85, -0.04),
  torso: new THREE.CylinderGeometry(0.2, 0.17, 0.6, 8),
  belt: new THREE.CylinderGeometry(0.185, 0.185, 0.08, 8),
  arm: new THREE.CylinderGeometry(0.058, 0.048, 0.6, 6).translate(0, -0.3, 0),
  hand: new THREE.SphereGeometry(0.056, 6, 5).translate(0, -0.63, 0),
  head: new THREE.SphereGeometry(0.125, 12, 9),
  nose: new THREE.ConeGeometry(0.025, 0.06, 5).rotateX(-Math.PI / 2).translate(0, -0.01, -0.13),
  eye: new THREE.SphereGeometry(0.018, 5, 4),
  beard: new THREE.SphereGeometry(0.1, 8, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4),
  hatBrim: new THREE.CylinderGeometry(0.25, 0.25, 0.035, 3),
  hatTop: new THREE.CylinderGeometry(0.1, 0.14, 0.13, 8),
  bandana: new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
  blade: new THREE.BoxGeometry(0.02, 0.05, 0.72).translate(0, -0.63, -0.42),
  guard: new THREE.BoxGeometry(0.12, 0.025, 0.03).translate(0, -0.63, -0.07),
};

// A simple low-poly sailor. Faces -Z. Feet at y=0.
export function makePerson(o = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const skin = o.skin ?? 0xc99a74;
  const legL = new THREE.Group(); legL.position.set(-0.1, 0.9, 0);
  const legR = new THREE.Group(); legR.position.set(0.1, 0.9, 0);
  for (const l of [legL, legR]) { l.add(new THREE.Mesh(GEO.leg, M(o.pants ?? 0x3b3b4b)), new THREE.Mesh(GEO.boot, M(0x24170e))); body.add(l); }
  const torso = new THREE.Mesh(GEO.torso, M(o.shirt ?? 0xdcd2bb)); torso.position.y = 1.2; body.add(torso);
  const belt = new THREE.Mesh(GEO.belt, M(0x3a2414)); belt.position.y = 0.94; body.add(belt);
  const head = new THREE.Group(); head.position.y = 1.64; body.add(head);
  head.add(new THREE.Mesh(GEO.head, M(skin)), new THREE.Mesh(GEO.nose, M(skin)));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(GEO.eye, M(0x111111)); e.position.set(s * 0.045, 0.03, -0.112); head.add(e); }
  if (o.beard) head.add(new THREE.Mesh(GEO.beard, M(o.beard)));
  if (o.hat) {
    const b = new THREE.Mesh(GEO.hatBrim, M(o.hat)); b.position.y = 0.1; head.add(b);
    const t = new THREE.Mesh(GEO.hatTop, M(o.hat)); t.position.y = 0.17; head.add(t);
  } else if (o.bandana) {
    const b = new THREE.Mesh(GEO.bandana, M(o.bandana)); b.position.y = 0.01; head.add(b);
  }
  const armL = new THREE.Group(); armL.position.set(-0.25, 1.46, 0);
  const armR = new THREE.Group(); armR.position.set(0.25, 1.46, 0);
  for (const a of [armL, armR]) { a.add(new THREE.Mesh(GEO.arm, M(o.shirt ?? 0xdcd2bb)), new THREE.Mesh(GEO.hand, M(skin))); body.add(a); }
  armL.rotation.z = -0.08; armR.rotation.z = 0.08;
  if (o.cutlass) { armR.add(new THREE.Mesh(GEO.blade, M(0xc9ccd4)), new THREE.Mesh(GEO.guard, M(0xb08a3a))); }
  return { g, body, legL, legR, armL, armR, head, phase: Math.random() * 6, attack: -1, cheer: 0, dead: false, deadT: 0, lookT: 0 };
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
