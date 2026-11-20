import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PEOPLE } from './people.js';

// Meem's pirate made in Tripo (image to 3D), shrunk to 14k triangles with the detail baked into
// her textures (models/tripo-pirate.glb, 1.5 MB). For now she just stands on the main deck
// facing the wheel: no skeleton yet, so she can't walk or animate.
// Shown only with the "Adults" crew setting (title screen); Kids mode leaves her out.
const SPOT = { x: -0.7, z: 2.3 };

export function addDeckGuest(G) {
  const g = new THREE.Group();
  g.name = 'tripoPirate';
  g.position.set(SPOT.x, 0, SPOT.z);
  g.rotation.y = 0.25; // model faces +Z (toward the helm); turned a touch toward the middle
  g.visible = PEOPLE.adult; // (set from the title screen before the game starts; main.js flips it after)
  G.ship.root.add(g);
  new GLTFLoader().load('models/tripo-pirate.glb', (gltf) => {
    // Same simple lighting as the rest of the crew (cheaper on the Quest than the file's
    // shiny material, and without reflections that one looks too dark here).
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshLambertMaterial({ map: m.map, normalMap: m.normalMap });
      m.dispose();
    });
    g.add(gltf.scene);
  }, undefined, (e) => console.warn('tripo pirate failed to load', e));
  return g;
}
