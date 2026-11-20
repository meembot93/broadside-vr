import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PEOPLE } from './people.js';

// Meem's pirate made in Tripo (image to 3D), shrunk to 14k triangles with the detail baked into
// her textures, then given a skeleton and two moves ("idle" and "walk") in Blender
// (models/tripo-pirate.glb, 1.8 MB). She strolls up and down the port side of the main deck,
// stopping at each end for a look around. Purely for show: not part of the game state, so in
// multiplayer each headset just runs its own copy.
// Shown only with the "Adults" crew setting (title screen); Kids mode leaves her out.
const ENDS = [[-0.7, 2.6], [-0.7, -0.1]]; // ship-local x, z (clear of the mainmast at z = -1)
const SPEED = 1.0;           // m/s on deck
const CLIP_SPEED = 1.3;      // how fast the walk clip moves her at normal playback
const PAUSE = [3, 7];        // seconds of idling at each end

export class DeckGuest {
  constructor(G) {
    this.g = new THREE.Group();
    this.g.name = 'tripoPirate';
    this.g.position.set(ENDS[0][0], 0, ENDS[0][1]);
    this.g.visible = PEOPLE.adult; // main.js flips this when the setting changes
    G.ship.root.add(this.g);
    this.mixer = null; this.acts = {}; this.cur = null;
    this.target = 1; this.wait = 2;
    new GLTFLoader().load('models/tripo-pirate.glb', (gltf) => {
      // Same simple lighting as the rest of the crew (cheaper on the Quest than the file's
      // shiny material, and without reflections that one looks too dark here).
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        o.material = new THREE.MeshLambertMaterial({ map: m.map, normalMap: m.normalMap });
        o.frustumCulled = false; // skinned: the bind-pose bounds don't follow her steps
        m.dispose();
      });
      this.g.add(gltf.scene);
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) this.acts[clip.name] = this.mixer.clipAction(clip);
      this.play('idle');
    }, undefined, (e) => console.warn('tripo pirate failed to load', e));
  }

  get visible() { return this.g.visible; }
  set visible(v) { this.g.visible = v; }

  play(name) {
    const a = this.acts[name];
    if (!a || this.cur === a) return;
    a.reset().play();
    if (this.cur) this.cur.crossFadeTo(a, 0.35, false);
    this.cur = a;
  }

  // Turn smoothly toward a direction on deck (the model faces +Z)
  face(dx, dz, dt) {
    if (Math.hypot(dx, dz) < 0.01) return;
    let turn = Math.atan2(dx, dz) - this.g.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.g.rotation.y += turn * Math.min(1, dt * 6);
  }

  update(dt) {
    if (!this.g.visible || !this.mixer) return;
    const p = this.g.position;
    if (this.wait > 0) {
      this.wait -= dt;
      this.play('idle');
      // turn round to face the way she'll go next
      const [x, z] = ENDS[this.target];
      this.face(x - p.x, z - p.z, dt * 0.5);
    } else {
      const [x, z] = ENDS[this.target], dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.05) {
        this.target = 1 - this.target;
        this.wait = PAUSE[0] + Math.random() * (PAUSE[1] - PAUSE[0]);
      } else {
        const k = Math.min(d, SPEED * dt) / d; p.x += dx * k; p.z += dz * k;
        this.face(dx, dz, dt);
        this.play('walk');
        this.acts.walk.timeScale = SPEED / CLIP_SPEED;
      }
    }
    this.mixer.update(dt);
  }
}
