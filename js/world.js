import * as THREE from 'three';
import { waveGLSL } from './waves.js';
import { buildLand, landHeightTexture, landHeight, landGradient, avoidLand, isOpenWater } from './land.js';

export const FOG = { color: '#c3d3dc', near: 140, far: 1700 };
const SUN_DIR = new THREE.Vector3(0.45, 0.42, -0.79).normalize();
let LANDMAP = null;

function oceanMaterial(flat, inner) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#062a40') },
      uMid: { value: new THREE.Color('#0f4a63') },
      uShallow: { value: new THREE.Color('#1f8f94') },
      uSkyLo: { value: new THREE.Color(FOG.color) },
      uSkyHi: { value: new THREE.Color('#4f86bd') },
      uSunDir: { value: SUN_DIR },
      uFogColor: { value: new THREE.Color(FOG.color) },
      uFogNear: { value: FOG.near }, uFogFar: { value: FOG.far },
      uCenter: { value: new THREE.Vector2() },
      uLand: { value: LANDMAP.tex }, uLandOrigin: { value: LANDMAP.origin }, uLandSize: { value: LANDMAP.size },
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
      uniform float uTime; uniform vec3 uDeep, uMid, uShallow, uSkyLo, uSkyHi, uSunDir, uFogColor; uniform float uFogNear, uFogFar;
      uniform sampler2D uLand; uniform vec2 uLandOrigin; uniform float uLandSize;
      varying vec3 vWorld; varying vec3 vNormal; varying float vH;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float d = length(cameraPosition - vWorld);
        float near = 1.0 - smoothstep(25.0, 110.0, d), mid = 1.0 - smoothstep(60.0, 260.0, d);
        vec3 n = normalize(vNormal);
        float r1 = sin(vWorld.x*0.9 + uTime*1.7 + sin(vWorld.z*0.53));
        float r2 = sin(vWorld.z*1.3 - uTime*1.3 + sin(vWorld.x*0.71));
        float r3 = sin((vWorld.x+vWorld.z)*2.7 + uTime*2.9);
        float r4 = sin(vWorld.x*4.3 - vWorld.z*3.1 + uTime*4.1) * sin(vWorld.z*5.1 + uTime*3.3);
        n = normalize(n + vec3((r1*0.05)*mid + (r3*0.02 + r4*0.025)*near, 0.0, (r2*0.05)*mid + (-r3*0.02 + r4*0.02)*near));

        // How deep is the sea floor here? (land map: 0..1 => -20..+4 m)
        vec2 luv = (vWorld.xz - uLandOrigin) / uLandSize;
        float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
        float floorH = mix(-20.0, texture2D(uLand, clamp(luv, 0.0, 1.0)).r * 24.0 - 20.0, inside);
        float shallow = smoothstep(-11.0, -0.8, floorH);

        vec3 v = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 body = mix(uDeep, uMid, clamp(vH*0.6 + 0.5, 0.0, 1.0));
        body = mix(body, uShallow, shallow * 0.75);
        // light glowing through the wave crests
        float sss = pow(max(dot(-v, uSunDir) * 0.5 + 0.5, 0.0), 3.0) * smoothstep(-0.1, 0.8, vH);
        body += vec3(0.05, 0.22, 0.2) * sss * 0.6;
        vec3 r = reflect(-v, n);
        vec3 skyc = mix(uSkyLo, uSkyHi, pow(clamp(r.y, 0.0, 1.0), 0.6));
        vec3 col = mix(body, skyc, clamp(fres * 0.9, 0.0, 1.0));
        float spec = pow(max(dot(r, uSunDir), 0.0), 220.0);
        col += vec3(1.0, 0.9, 0.72) * spec * 2.2;
        col += vec3(1.0, 0.85, 0.6) * pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.08;

        // Foam: patchy whitecaps on crests, and surf lapping the shore
        float fpatch = vnoise(vWorld.xz * 0.12 + vec2(uTime * 0.15, uTime * 0.05)) * vnoise(vWorld.xz * 0.45 - uTime * 0.2);
        float crest = smoothstep(0.55, 0.95, vH) * smoothstep(0.12, 0.45, fpatch);
        float surfBand = smoothstep(-2.6, -0.7, floorH + vH * 0.8) * (1.0 - smoothstep(0.6, 2.0, floorH));
        float surf = surfBand * (0.55 + 0.45 * sin(floorH * 2.4 + uTime * 1.6 + vnoise(vWorld.xz * 0.2) * 4.0));
        surf *= smoothstep(0.15, 0.55, vnoise(vWorld.xz * 0.6 + uTime * 0.3) + surfBand * 0.4);
        float foam = clamp(crest * 0.6 + surf * 0.85, 0.0, 1.0);
        col = mix(col, vec3(0.9, 0.95, 0.97), foam);

        float fog = smoothstep(uFogNear, uFogFar, d);
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function makeWorld(scene) {
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
  scene.background = new THREE.Color(FOG.color);
  LANDMAP = landHeightTexture();

  const hemi = new THREE.HemisphereLight(0xcfe2f2, 0x5a4a34, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8c4, 2.1);
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
      uHorizon: { value: new THREE.Color(FOG.color) }, uZenith: { value: new THREE.Color('#3f78b5') },
      uSunDir: { value: SUN_DIR }, uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uHorizon, uZenith, uSunDir; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; } return s / 0.9375; }
      void main(){ vec3 d = normalize(vDir); float y = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(y, 0.5));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0,0.86,0.62) * (pow(s, 8.0)*0.12 + pow(s, 220.0)*0.35);
        // clouds on a far-off ceiling
        vec2 cp = d.xz / (d.y + 0.06) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fbm(cp * 0.9);
        float cov = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.12, d.y);
        float lit = clamp(0.75 + (fbm(cp * 0.9 + uSunDir.xz * 0.06) - c) * 3.0, 0.55, 1.1);
        vec3 cloud = mix(vec3(0.72, 0.76, 0.82), vec3(1.0, 0.98, 0.94), lit);
        col = mix(col, cloud, cov * 0.85);
        col += vec3(1.0,0.95,0.85) * smoothstep(0.99986, 0.99992, s) * 2.5 * (1.0 - cov);
        col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.1, d.y)) * 0.6);
        gl_FragColor = vec4(col,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), skyMat);
  sky.renderOrder = -1; scene.add(sky);

  // The cove: coastline all around except the mouth out to sea, plus a small islet
  buildLand(scene);

  return {
    islands: [],
    landHeight, landGradient, avoidLand, isOpenWater,
    update(t, center, camPos) {
      innerMat.uniforms.uTime.value = t; ringMat.uniforms.uTime.value = t; skyMat.uniforms.uTime.value = t;
      inner.position.x = Math.round(center.x / STEP) * STEP; inner.position.z = Math.round(center.z / STEP) * STEP;
      innerMat.uniforms.uCenter.value.set(inner.position.x, inner.position.z);
      ring.position.x = inner.position.x; ring.position.z = inner.position.z;
      sky.position.copy(camPos);
    },
  };
}
