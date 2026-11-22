import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Kit, addCutlass } from './kit.js';

// High-detail pirates: characters made in Tripo (image to 3D), shrunk to ~14k triangles with
// the detail baked into textures, then given a skeleton with "idle" and "walk" moves in Blender.
// makeRigged() returns the same shape of object as makePerson() in people.js (g, body, head,
// arms, legs, sword, pose, attack, cheer, dead...), so all the crew / enemy / island code works
// with them unchanged. animateRigged() plays the walk / idle clips and bends the arm and leg
// bones on top of them for the work poses, sword swings, cheering and falling down.
//
// Each model file can be shown in colour variations (bandana / clothes and hair), done on the
// graphics card from one shared texture, so a variation costs no extra memory.

// clipSpeed: how fast the walk clip moves them (m/s); armDrop: models made in an A-pose
// (arms out at an angle, no clips) have their arms lowered by this much (radians).
const url = (f) => new URL('../models/' + f, import.meta.url).href;
export const MODELS = {
  lady: { url: url('tripo-pirate.glb'), clipSpeed: 1.3 },
  // Made in Blender from code (see docs/CHARACTERS.md), A-pose, no clips:
  hawkins: { url: url('pirates/hawkins.glb'), armDrop: 0.56 },
  bones: { url: url('pirates/bones.glb'), armDrop: 0.56 },
  captain: { url: url('pirates/captain.glb'), armDrop: 0.56 },
  deckhand: { url: url('pirates/deckhand.glb'), armDrop: 0.56 },
  lass: { url: url('pirates/lass.glb'), armDrop: 0.56 },
  goldie: { url: url('pirates/goldie.glb'), armDrop: 0.56 }, // the blonde lass
};
const loaded = {};

// Load every model (main.js waits for this before building the crew).
export function loadModels() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(MODELS).map(([name, M]) => new Promise((res) => {
    loader.load(M.url, (gltf) => { loaded[name] = gltf; res(); }, undefined, (e) => { console.warn('model failed to load', M.url, e); res(); });
  })));
}
export const hasModel = (name) => !!loaded[name];

// ---------- Colour variations ----------
// Pixels that are clearly red cloth become `red`; golden blonde hair becomes `hair`.
// The original shading (how light or dark each pixel is) is kept.
const RECOLOR = `
{
  vec3 kc = pow(diffuseColor.rgb, vec3(1.0 / 2.2)); // (judge colours as painted, not in linear light)
  float kMx = max(kc.r, max(kc.g, kc.b)), kMn = min(kc.r, min(kc.g, kc.b)), kD = kMx - kMn;
  float kS = kD / max(kMx, 1e-4);
  float kH = 0.0;
  if (kD > 1e-4) {
    if (kMx == kc.r) kH = mod((kc.g - kc.b) / kD, 6.0) / 6.0;
    else if (kMx == kc.g) kH = ((kc.b - kc.r) / kD + 2.0) / 6.0;
    else kH = ((kc.r - kc.g) / kD + 4.0) / 6.0;
  }
  float kRed = smoothstep(0.45, 0.6, kS) * (1.0 - smoothstep(0.025, 0.05, min(kH, 1.0 - kH))) * smoothstep(0.08, 0.18, kMx);
  float kHair = smoothstep(0.28, 0.36, kS) * (1.0 - smoothstep(0.74, 0.8, kS)) * smoothstep(0.076, 0.084, kH) * (1.0 - smoothstep(0.112, 0.125, kH)) * smoothstep(0.25, 0.4, kMx);
  vec3 kShade = vec3(kMx);
  kc = mix(kc, pow(uRed, vec3(1.0 / 2.2)) * kShade / 0.8, kRed * uRecolor.x);
  kc = mix(kc, pow(uHair, vec3(1.0 / 2.2)) * kShade / 0.85, kHair * uRecolor.y);
  diffuseColor.rgb = pow(kc, vec3(2.2));
}`;

const materials = new Map(); // one material per model + variation, shared by everyone wearing it
function variantMaterial(name, src, look) {
  const key = `${name}|${look.red ?? ''}|${look.hair ?? ''}`;
  if (materials.has(key)) return materials.get(key);
  // Plain lighting like the rest of the crew (cheaper on the Quest than the file's shiny material)
  const mat = new THREE.MeshLambertMaterial({ map: src.map, normalMap: src.normalMap });
  if (look.red != null || look.hair != null) {
    const u = {
      uRed: { value: new THREE.Color(look.red ?? 0xffffff) }, uHair: { value: new THREE.Color(look.hair ?? 0xffffff) },
      uRecolor: { value: new THREE.Vector2(look.red != null ? 1 : 0, look.hair != null ? 1 : 0) },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRed, uHair; uniform vec2 uRecolor;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + RECOLOR);
    };
    mat.customProgramCacheKey = () => 'rig-recolor';
  }
  materials.set(key, mat);
  return mat;
}

// ---------- Building one ----------
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3();

// look: { red, hair } colours (optional), cutlass: carries one
export function makeRigged(name, look = {}, type = name) {
  const src = loaded[name];
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const model = cloneSkinned(src.scene);
  model.rotation.y = Math.PI; // the files face +Z, our pirates face -Z
  body.add(model);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.material = variantMaterial(name, o.material, look);
      o.frustumCulled = false; // skinned: the bind-pose bounds don't follow the moves
      o.castShadow = false;
    }
  });
  const mixer = new THREE.AnimationMixer(model), acts = {};
  for (const clip of src.animations) acts[clip.name] = mixer.clipAction(clip);
  // Stand-ins for the low-poly pirate's limbs: the game code may set their rotations, but
  // here only animateRigged() moves anything.
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  // The head: an empty that follows the head bone (things are attached to / measured from it)
  const head = new THREE.Group(); head.position.y = 0.1; bones.head.add(head);
  const p = { g, body, legL, legR, armL, armR, head, type, phase: Math.random() * 6, attack: -1, cheer: 0, pose: null, dead: false, deadT: 0, lookT: 0,
    rig: { name, model, bones, mixer, acts, cur: null, al: 0, ar: 0, legs: 0, lean: 0, last: null, speed: 0, clipSpeed: MODELS[name].clipSpeed || 1.3,
      clips: !!acts.idle, drop: MODELS[name].armDrop || 0, rest: null, step: Math.random() * 6 } };
  if (p.rig.clips) {
    // Start in the idle pose (and at a random point in it, so a crowd doesn't move in step)
    play(p, 'idle'); mixer.update(Math.random() * 3);
  } else {
    // No clips: remember the rest pose (moves are worked out from it every frame)
    p.rig.rest = Object.values(bones).map((bn) => [bn, bn.quaternion.clone(), bn.position.clone()]);
    armsDown(p);
  }
  // The cutlass, gripped in the right hand: lined up so that with the arm hanging down
  // the blade points forward, as on the low-poly pirates.
  const hand = bones.handR;
  const holder = new THREE.Group(); hand.add(holder);
  g.updateMatrixWorld(true);
  hand.getWorldQuaternion(_q); body.getWorldQuaternion(_qb);
  holder.quaternion.copy(_q.invert().multiply(_qb));
  holder.position.set(0, 0.07, 0);
  const k = new Kit(); addCutlass(k, 0.66, [0, 0, 0]);
  const sword = k.mesh(); sword.visible = !!look.cutlass; holder.add(sword);
  p.sword = sword;
  return p;
}

function play(p, name, fade = 0.3) {
  const R = p.rig, a = R.acts[name];
  if (!a || R.cur === a) return;
  a.reset().play();
  if (R.cur) R.cur.crossFadeTo(a, fade, false);
  R.cur = a;
}

// Turn a bone by quaternion Q given in the pirate's own frame (x right, y up, -z forward),
// about the bone's own joint, on top of whatever the animation clip has it doing.
function turnBone(p, bone, Q) {
  bone.parent.getWorldQuaternion(_q);
  p.body.getWorldQuaternion(_qb).invert();
  _q.premultiply(_qb);                 // parent's turn, in the pirate's frame
  _q2.copy(_q).invert().multiply(Q).multiply(_q);
  bone.quaternion.premultiply(_q2);
}
const _Q = new THREE.Quaternion();
// Lower A-pose arms to hang at the sides (models without clips)
function armsDown(p, extraL = 0, extraR = 0) {
  const R = p.rig; if (!R.drop) return;
  turnBone(p, R.bones.upperarmL, _Q.setFromEuler(_e.set(0, 0, R.drop + extraL)));
  turnBone(p, R.bones.upperarmR, _Q.setFromEuler(_e.set(0, 0, -R.drop - extraR)));
}
// Base pose for models without clips: rest pose, arms down, a walk cycle or gentle breathing.
// Returns the arm swing to add (radians, + = forward) for the left and right arm.
function procedural(p, dt, walking, t) {
  const R = p.rig, b = R.bones;
  for (const [bn, q, ps] of R.rest) { bn.quaternion.copy(q); bn.position.copy(ps); }
  if (walking) R.step += dt * R.speed / 1.25 * Math.PI * 2; // one stride (two steps) per 1.25 m
  const w = walking ? 1 : 0;
  R.walkW = (R.walkW || 0) + (w - (R.walkW || 0)) * Math.min(1, dt * 6);
  const W = R.walkW, s = Math.sin(R.step), c = Math.cos(R.step);
  // breathing and a slow look about
  turnBone(p, b.chest, _Q.setFromEuler(_e.set(Math.sin(t * 1.6 + R.step) * 0.02 * (1 - W), Math.sin(t * 0.35 + p.phase) * 0.05 * (1 - W), 0)));
  turnBone(p, b.head, _Q.setFromEuler(_e.set(0, Math.sin(t * 0.27 + p.phase * 2) * 0.25 * (1 - W), 0)));
  armsDown(p, 0.06 * (1 - W) * Math.sin(t * 1.1 + p.phase), 0.06 * (1 - W) * Math.sin(t * 1.3));
  if (W > 0.01) {
    // legs: swing from the hip, bend the knee on the way through, a little bob and sway
    turnBone(p, b.thighL, _Q.setFromEuler(_e.set(s * 0.5 * W, 0, 0)));
    turnBone(p, b.thighR, _Q.setFromEuler(_e.set(-s * 0.5 * W, 0, 0)));
    turnBone(p, b.shinL, _Q.setFromEuler(_e.set(-Math.max(0, c) * 0.85 * W, 0, 0)));
    turnBone(p, b.shinR, _Q.setFromEuler(_e.set(-Math.max(0, -c) * 0.85 * W, 0, 0)));
    turnBone(p, b.hips, _Q.setFromEuler(_e.set(0, s * 0.12 * W, 0)));
    turnBone(p, b.chest, _Q.setFromEuler(_e.set(0.04 * W, -s * 0.18 * W, 0)));
    b.hips.position.y += Math.abs(c) * 0.025 * W - 0.012 * W;
  }
  return [-s * 0.4 * W, s * 0.4 * W];
}
const qx = (a) => _Q.setFromEuler(_e.set(a, 0, 0));
const qxz = (a, z) => _Q.setFromEuler(_e.set(a, 0, z));

// Same arguments as animatePerson() in people.js (which hands over to this one).
// Arm and leg angles are the low-poly pirate's: 0 = hanging down, + = swung forward.
export function animateRigged(p, dt, moving, t = 0) {
  const R = p.rig, b = R.bones;
  // How fast are we really going? (so the feet don't skate)
  const pos = p.g.position;
  if (!R.last || R.last.parent !== p.g.parent) R.last = { x: pos.x, z: pos.z, parent: p.g.parent };
  const sp = dt > 0 ? Math.hypot(pos.x - R.last.x, pos.z - R.last.z) / dt : 0;
  R.last.x = pos.x; R.last.z = pos.z;
  R.speed += (Math.min(sp, 4) - R.speed) * Math.min(1, dt * 8);
  if (p.dead) {
    p.deadT += dt;
    const u = Math.min(1, p.deadT / 0.6);
    if (R.clips) {
      play(p, 'idle', 0.2);
      if (R.cur) R.cur.timeScale = Math.max(0, 1 - u * 2);
      R.mixer.update(dt);
    } else procedural(p, 0, false, 0);
    p.body.rotation.x = -u * u * Math.PI * 0.48;
    R.al += (-1.2 - R.al) * Math.min(1, dt * 6); R.ar = R.al;
    turnBone(p, b.upperarmL, qxz(R.al, -0.3)); turnBone(p, b.upperarmR, qxz(R.ar, 0.3));
    return;
  }
  const walking = moving && R.speed > 0.15;
  let sw = [0, 0];
  if (!R.clips) sw = procedural(p, dt, walking, t);
  else {
    if (walking) { play(p, 'walk'); R.cur.timeScale = Math.max(0.5, R.speed / R.clipSpeed); }
    else { play(p, 'idle'); if (R.cur) R.cur.timeScale = 1; }
    R.mixer.update(dt);
  }

  // Extra arm swing on top of the clip (0 = leave the clip's arms alone)
  let al = 0, ar = 0, lean = 0, legs = 0, armOut = 0;
  if (!moving && p.pose) {
    const w = t * 3 + p.phase;
    if (p.pose === 'steer') { al = 1.15 + Math.sin(t * 0.7) * 0.12; ar = 1.15 - Math.sin(t * 0.7) * 0.12; }
    else if (p.pose === 'haul') { const k = Math.sin(w); al = -2.6 + k * 0.5; ar = -2.6 - k * 0.5; lean = 0.08; }
    else if (p.pose === 'ram') { const k = Math.sin(w * 1.4); al = ar = 1.25 + k * 0.35; lean = -0.1 - k * 0.05; }
    else if (p.pose === 'point') { ar = 1.55; }
    else if (p.pose === 'aim') { al = 1.45; ar = 1.15; }
    else if (p.pose === 'sit') { al = ar = 0.35; }
    else if (p.pose === 'row') { const k = Math.sin(w * 1.4); al = ar = 1.2 + k * 0.45; lean = -0.1 - k * 0.12; }
  }
  if (p.pose === 'sit' || p.pose === 'row') legs = 1.45;
  let swing = false;
  if (p.attack >= 0) {
    p.attack += dt / 0.55;
    const u = p.attack;
    ar = u < 0.45 ? -2.6 * (u / 0.45) : -2.6 + 3.3 * Math.min(1, (u - 0.45) / 0.35);
    swing = true;
    if (u >= 1) p.attack = -1;
  }
  if (p.cheer > 0) {
    p.cheer -= dt;
    const w = Math.sin(t * 9) * 0.25;
    al = -2.8 + w; ar = -2.8 - w; armOut = 0.25;
  }
  // Ease toward the wanted angles (a sword swing is quick, everything else is gentle)
  const k = Math.min(1, dt * 9);
  R.al += (al - R.al) * k;
  R.ar = swing ? ar : R.ar + (ar - R.ar) * k;
  R.legs += (legs - R.legs) * k;
  R.lean += (lean - R.lean) * k;
  p.body.rotation.x = R.lean;
  const al2 = R.al + sw[0] * (1 - Math.min(1, Math.abs(R.al))), ar2 = R.ar + sw[1] * (1 - Math.min(1, Math.abs(R.ar)));
  if (Math.abs(al2) > 1e-3 || armOut) turnBone(p, b.upperarmL, qxz(al2, -armOut));
  if (Math.abs(ar2) > 1e-3 || armOut) turnBone(p, b.upperarmR, qxz(ar2, armOut));
  if (R.legs > 1e-3) { turnBone(p, b.thighL, qx(R.legs)); turnBone(p, b.thighR, qx(R.legs)); turnBone(p, b.shinL, qx(-R.legs)); turnBone(p, b.shinR, qx(-R.legs)); }
}
