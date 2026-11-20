// Treasure Island's foes that aren't plain pirates: skeletons from the graveyard, and the
// musket on a sharpshooter's shoulder. Same shape as makePerson() in people.js (a group with
// body, head, arms and legs that animatePerson() swings), so the island code treats them alike.
import * as THREE from 'three';
import { Kit, addCutlass, addMusket } from './kit.js';

const BONE = 0xe2dccb, BONE_D = 0xb5ad98, DARK = 0x1a140f;

export function makeSkeleton(seed = 1) {
  const R = (() => { let s = seed % 2147483647 || 7; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  let k = new Kit();
  // Pelvis, spine, ribs, collarbones
  k.box(0.3, 0.12, 0.14, BONE_D, [0, 0.9, 0]);
  k.cyl(0.035, 0.04, 0.6, 6, BONE_D, [0, 1.2, 0.03]);
  for (let i = 0; i < 5; i++) {
    const tg = new THREE.TorusGeometry(0.16 - i * 0.012, 0.022, 4, 12).rotateX(Math.PI / 2);
    k.add(tg, BONE, [0, 1.13 + i * 0.075, 0], 0, [1, 1, 0.72]);
  }
  k.box(0.5, 0.05, 0.06, BONE, [0, 1.47, 0]);
  k.cyl(0.03, 0.03, 0.14, 5, BONE_D, [0, 1.58, 0]);
  // A rag of an old shirt or sash, so they read as dead pirates
  const rag = [0x5a1e1a, 0x2a3a4a, 0x4a3a20][Math.floor(R() * 3)];
  k.box(0.34, 0.1, 0.17, rag, [0, 0.97, 0], [0, 0, R() * 0.2 - 0.1]);
  body.add(k.mesh());
  // Skull: eye holes facing forward (-z), a jaw, and maybe a hat or bandana
  const head = new THREE.Group(); head.position.y = 1.72; body.add(head);
  k = new Kit();
  k.ball(0.13, 1, BONE, [0, 0.03, 0], 0, [0.95, 1.05, 1.1]);
  k.box(0.15, 0.06, 0.12, BONE_D, [0, -0.09, -0.04]);
  for (const s of [-1, 1]) k.ball(0.035, 0, DARK, [s * 0.05, 0.04, -0.125]);
  k.box(0.03, 0.04, 0.02, DARK, [0, -0.01, -0.14]);
  const hat = R();
  if (hat < 0.35) { k.cyl(0.2, 0.2, 0.03, 3, 0x1e1a18, [0, 0.13, 0], [0, R() * 6, 0]); k.cyl(0.1, 0.12, 0.1, 8, 0x1e1a18, [0, 0.18, 0]); }
  else if (hat < 0.7) k.ball(0.14, 1, rag, [0, 0.08, 0.01], 0, [1, 0.6, 1.1]);
  head.add(k.mesh());
  // Legs and arms: thin bones on the same pivots as a person's
  const legL = new THREE.Group(); legL.position.set(-0.1, 0.82, 0);
  const legR = new THREE.Group(); legR.position.set(0.1, 0.82, 0);
  k = new Kit();
  k.cyl(0.03, 0.025, 0.38, 5, BONE, [0, -0.2, 0]); k.ball(0.04, 0, BONE_D, [0, -0.4, 0]);
  k.cyl(0.025, 0.02, 0.36, 5, BONE, [0, -0.6, 0]); k.box(0.08, 0.04, 0.18, BONE_D, [0, -0.8, -0.05]);
  const legGeo = k.geometry();
  legL.add(new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  legR.add(new THREE.Mesh(legGeo, legL.children[0].material));
  body.add(legL, legR);
  const armL = new THREE.Group(); armL.position.set(-0.26, 1.45, 0);
  const armR = new THREE.Group(); armR.position.set(0.26, 1.45, 0);
  for (const arm of [armL, armR]) {
    k = new Kit();
    k.cyl(0.025, 0.022, 0.3, 5, BONE, [0, -0.16, 0]); k.ball(0.035, 0, BONE_D, [0, -0.32, 0]);
    k.cyl(0.02, 0.02, 0.26, 5, BONE, [0, -0.46, 0]); k.box(0.06, 0.08, 0.04, BONE_D, [0, -0.62, 0]);
    arm.add(k.mesh());
  }
  k = new Kit(); addCutlass(k, 0.6, [0, -0.62, -0.005]); const sword = k.mesh(); sword.visible = true; armR.add(sword);
  body.add(armL, armR);
  armL.rotation.z = -0.1; armR.rotation.z = 0.1;
  return { g, body, legL, legR, armL, armR, head, sword, type: 'skeleton', phase: Math.random() * 6, attack: -1, cheer: 0, pose: null, dead: false, deadT: 0, lookT: 0 };
}

// A musket carried across the chest (a sharpshooter: points it with the 'aim' pose)
export function giveMusket(p) {
  const k = new Kit(); addMusket(k, 1);
  const m = k.mesh();
  m.position.set(0.1, 1.32, -0.32); m.rotation.set(0.06, 0.08, 0);
  p.body.add(m); p.musket = m; p.sword.visible = false;
  return m;
}
