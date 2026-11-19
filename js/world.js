import * as THREE from 'three';
import { waveGLSL } from './waves.js';
import { rand } from './util.js';

export const FOG = { color: '#b7cfe0', near: 70, far: 900 };
const SUN_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();

function oceanMaterial(flat, inner) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#0a3552') },
      uShallow: { value: new THREE.Color('#1d7088') },
      uSky: { value: new THREE.Color('#c9e0ef') },
      uSunDir: { value: SUN_DIR },
      uFogColor: { value: new THREE.Color(FOG.color) },
      uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far },
      uCenter: { value: new THREE.Vector2() },
    },
    vertexShader: `
      uniform float uTime; uniform vec2 uCenter;
      varying vec3 vWorld; varying vec3 vNormal; varying float vH;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        ${flat ? 'float h=0.0, dhx=0.0, dhz=0.0;' : waveGLSL()}
        ${flat ? '' : `float fade = 1.0 - smoothstep(${inner * 0.72}, ${inner * 0.94}, length(wp.xz-uCenter));
        h*=fade; dhx*=fade; dhz*=fade;`}
        wp.y += h;
        vWorld = wp.xyz; vH = h;
        vNormal = normalize(vec3(-dhx, 1.0, -dhz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunDir, uFogColor; uniform float uFogNear, uFogFar;
      varying vec3 vWorld; varying vec3 vNormal; varying float vH;
      void main(){
        vec3 n = normalize(vNormal);
        float r1 = sin(vWorld.x*0.9 + uTime*1.7 + sin(vWorld.z*0.53));
        float r2 = sin(vWorld.z*1.3 - uTime*1.3 + sin(vWorld.x*0.71));
        float r3 = sin((vWorld.x+vWorld.z)*2.7 + uTime*2.9);
        n = normalize(n + vec3(r1*0.05 + r3*0.02, 0.0, r2*0.05 - r3*0.02));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 col = mix(uDeep, uShallow, clamp(vH*0.55 + 0.45, 0.0, 1.0));
        col = mix(col, uSky, clamp(fres*0.75, 0.0, 1.0));
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, uSunDir), 0.0), 160.0);
        col += vec3(1.0, 0.92, 0.75) * spec * 1.6;
        float foam = smoothstep(0.62, 0.9, vH) * (0.6 + 0.4*r3);
        col = mix(col, vec3(0.88, 0.94, 0.97), foam*0.55);
        float d = length(cameraPosition - vWorld);
        float fog = smoothstep(uFogNear, uFogFar, d);
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function makeWorld(scene) {
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
  scene.background = new THREE.Color(FOG.color);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a3a28, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.9);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);

  // Detailed wave patch that follows the player, plus a flat ring out to the horizon.
  const SIZE = 480, SEG = 192, STEP = SIZE / SEG, INNER = SIZE / 2;
  const innerGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); innerGeo.rotateX(-Math.PI / 2);
  const innerMat = oceanMaterial(false, INNER);
  const inner = new THREE.Mesh(innerGeo, innerMat); inner.frustumCulled = false; scene.add(inner);
  const ringGeo = new THREE.RingGeometry(INNER * 0.93, 3000, 96, 1); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = oceanMaterial(true, INNER);
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = -0.03; ring.frustumCulled = false; scene.add(ring);

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(FOG.color) }, uZenith: { value: new THREE.Color('#3d7fc0') },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uHorizon, uZenith, uSunDir; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float y = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(y, 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0,0.9,0.7) * (pow(s, 900.0)*5.0 + pow(s, 12.0)*0.25);
        vec2 cp = d.xz / (d.y + 0.08) * 1.4;
        float c = sin(cp.x*1.3 + sin(cp.y*0.9))*0.5 + sin(cp.y*1.7 + cp.x*0.4 + 1.3)*0.35 + sin(cp.x*3.1 - cp.y*2.3)*0.15;
        col = mix(col, vec3(1.0), smoothstep(0.35, 0.85, c) * smoothstep(0.0, 0.08, d.y) * 0.7);
        gl_FragColor = vec4(col,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), skyMat);
  sky.renderOrder = -1; scene.add(sky);

  // Islands scattered around the start
  const islands = [];
  const sand = new THREE.MeshLambertMaterial({ color: 0xd9c48f });
  const grass = new THREE.MeshLambertMaterial({ color: 0x4f7a34 });
  const rock = new THREE.MeshLambertMaterial({ color: 0x7a7066 });
  const trunk = new THREE.MeshLambertMaterial({ color: 0x7a5a36 });
  const leaf = new THREE.MeshLambertMaterial({ color: 0x3f8a3a, side: THREE.DoubleSide });
  const spots = [[380, -520], [-640, -300], [-260, 700], [820, 360], [120, -1150], [-1100, 520], [1250, -600], [-500, -1100]];
  for (const [x, z] of spots) {
    const r = rand(40, 90);
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const beach = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 3, 18), sand); beach.position.y = -0.8; g.add(beach);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, r * rand(0.35, 0.7), 14), Math.random() < 0.5 ? grass : rock);
    hill.position.y = (hill.geometry.parameters.height / 2) + 0.5; g.add(hill);
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2), d = r * rand(0.82, 0.95);
      const palm = new THREE.Group(); palm.position.set(Math.cos(a) * d, 0.6, Math.sin(a) * d);
      const h = rand(7, 11);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), trunk); t.position.y = h / 2; t.rotation.z = rand(-0.2, 0.2); palm.add(t);
      for (let k = 0; k < 6; k++) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 5), leaf);
        l.geometry.translate(0, 2.5, 0);
        l.position.y = h; l.rotation.set(0, (k / 6) * Math.PI * 2, 0); l.rotateX(-1.1);
        palm.add(l);
      }
      g.add(palm);
    }
    scene.add(g);
    islands.push({ x, z, r: r * 1.15 });
  }

  return {
    islands,
    update(t, center, camPos) {
      innerMat.uniforms.uTime.value = t; ringMat.uniforms.uTime.value = t;
      inner.position.x = Math.round(center.x / STEP) * STEP; inner.position.z = Math.round(center.z / STEP) * STEP;
      innerMat.uniforms.uCenter.value.set(inner.position.x, inner.position.z);
      ring.position.x = inner.position.x; ring.position.z = inner.position.z;
      sky.position.copy(camPos);
    },
  };
}
