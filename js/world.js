import * as THREE from 'three';
import { waveGLSL, waveAmps, WAVE_FADE } from './waves.js';
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
      // Weather and time of day (set by weather.js)
      uWaveA: { value: new THREE.Vector4() }, uSunCol: { value: new THREE.Color(1, 0.9, 0.72) },
      uLight: { value: 1 }, uStorm: { value: 0 }, uFlash: { value: 0 },
      uLand: { value: LANDMAP.tex }, uLandOrigin: { value: LANDMAP.origin }, uLandSize: { value: LANDMAP.size },
    },
    vertexShader: `
      uniform float uTime; uniform vec2 uCenter; uniform vec4 uWaveA;
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
      uniform vec3 uSunCol; uniform float uLight, uStorm, uFlash;
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
        float chop = 1.0 + uStorm * 1.2;
        n = normalize(n + chop * vec3((r1*0.05)*mid + (r3*0.02 + r4*0.025)*near, 0.0, (r2*0.05)*mid + (-r3*0.02 + r4*0.02)*near));

        // How deep is the sea floor here? (land map: 0..1 => -20..+4 m)
        vec2 luv = (vWorld.xz - uLandOrigin) / uLandSize;
        float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
        float floorH = mix(-20.0, texture2D(uLand, clamp(luv, 0.0, 1.0)).r * 24.0 - 20.0, inside);
        float shallow = smoothstep(-11.0, -0.8, floorH);

        vec3 v = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 body = mix(uDeep, uMid, clamp(vH*0.6 + 0.5, 0.0, 1.0));
        body = mix(body, uShallow, shallow * 0.75) * uLight;
        // light glowing through the wave crests
        float sss = pow(max(dot(-v, uSunDir) * 0.5 + 0.5, 0.0), 3.0) * smoothstep(-0.1, 0.8, vH);
        body += vec3(0.05, 0.22, 0.2) * sss * 0.6 * uSunCol;
        vec3 r = reflect(-v, n);
        vec3 skyc = mix(uSkyLo, uSkyHi, pow(clamp(r.y, 0.0, 1.0), 0.6)) + vec3(0.75, 0.8, 0.95) * uFlash * 0.35;
        vec3 col = mix(body, skyc, clamp(fres * 0.9, 0.0, 1.0));
        float spec = pow(max(dot(r, uSunDir), 0.0), 220.0);
        col += uSunCol * spec * 2.2;
        col += uSunCol * vec3(1.0, 0.94, 0.83) * pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.08;

        // Foam: patchy whitecaps on crests, and surf lapping the shore
        float fpatch = vnoise(vWorld.xz * 0.12 + vec2(uTime * 0.15, uTime * 0.05)) * vnoise(vWorld.xz * 0.45 - uTime * 0.2);
        float crest = smoothstep(0.55 + uStorm * 0.25, 0.95 + uStorm * 0.6, vH) * smoothstep(0.12 - uStorm * 0.08, 0.45 - uStorm * 0.15, fpatch);
        float surfBand = smoothstep(-2.6, -0.7, floorH + vH * 0.8) * (1.0 - smoothstep(0.6, 2.0, floorH));
        float surf = surfBand * (0.55 + 0.45 * sin(floorH * 2.4 + uTime * 1.6 + vnoise(vWorld.xz * 0.2) * 4.0));
        surf *= smoothstep(0.15, 0.55, vnoise(vWorld.xz * 0.6 + uTime * 0.3) + surfBand * 0.4);
        float foam = clamp(crest * (0.6 + uStorm * 0.3) + surf * 0.85, 0.0, 1.0);
        col = mix(col, vec3(0.9, 0.95, 0.97) * (uLight * 0.85 + 0.15 + uFlash * 0.4), foam);

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
  WAVE_FADE.r0 = INNER * 0.72; WAVE_FADE.r1 = INNER * 0.94;
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = -0.03; ring.frustumCulled = false; scene.add(ring);

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(FOG.color) }, uZenith: { value: new THREE.Color('#3f78b5') },
      uSunDir: { value: SUN_DIR }, uTime: { value: 0 },
      // Weather and time of day (set by weather.js)
      uSunCol: { value: new THREE.Color(1, 0.86, 0.62) }, uDisc: { value: new THREE.Color(1, 0.95, 0.85) }, uDiscSize: { value: 0 },
      uNight: { value: 0 }, uCloud: { value: 0 }, uCloudT: { value: 0 }, uFlash: { value: 0 },
      uCloudDark: { value: new THREE.Color(0.72, 0.76, 0.82) }, uCloudLit: { value: new THREE.Color(1, 0.98, 0.94) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uHorizon, uZenith, uSunDir, uSunCol, uDisc, uCloudDark, uCloudLit;
      uniform float uTime, uDiscSize, uNight, uCloud, uCloudT, uFlash; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; } return s / 0.9375; }
      void main(){ vec3 d = normalize(vDir); float y = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(y, 0.5));
        float s = max(dot(d, uSunDir), 0.0);
        // stars, only on clear nights
        vec3 sc = d * 260.0; vec3 cell = floor(sc);
        float sh = hash(cell.xy + cell.z * 17.31);
        float star = step(0.993, sh) * (1.0 - smoothstep(0.08, 0.32, length(fract(sc) - 0.5))) * smoothstep(0.03, 0.25, d.y);
        col += vec3(0.8, 0.85, 1.0) * star * uNight * (0.5 + 0.5 * fract(sh * 91.0));
        // clouds on a far-off ceiling: more, darker and faster in a storm
        vec2 cp = d.xz / (d.y + 0.06) * 1.6 + vec2(uCloudT, uCloudT * 0.5);
        float c = fbm(cp * 0.9);
        float cov = smoothstep(mix(0.5, 0.12, uCloud), mix(0.78, 0.55, uCloud), c) * smoothstep(0.0, 0.12, d.y);
        float lit = clamp(0.75 + (fbm(cp * 0.9 + uSunDir.xz * 0.06) - c) * 3.0, 0.55, 1.1);
        vec3 cloud = mix(uCloudDark, uCloudLit, lit);
        col += uSunCol * (pow(s, 8.0)*0.12 + pow(s, 220.0)*0.35) * (1.0 - cov * 0.8);
        col = mix(col, cloud, cov * mix(0.85, 0.97, uCloud));
        col += uDisc * smoothstep(0.99986 - uDiscSize, 0.99992 - uDiscSize, s) * 2.5 * (1.0 - cov);
        col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.1, d.y)) * 0.6);
        col += vec3(0.75, 0.8, 1.0) * uFlash * (0.35 + cov * 0.65);
        gl_FragColor = vec4(col,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), skyMat);
  sky.renderOrder = -1; scene.add(sky);

  // The cove: coastline all around except the mouth out to sea, plus a small islet
  buildLand(scene);

  // Handles for weather.js, which sets the sky, light, fog and sea for the time of day and weather
  const look = { scene, hemi, sun, sky: skyMat.uniforms, ocean: [innerMat.uniforms, ringMat.uniforms] };

  return {
    islands: [], look,
    landHeight, landGradient, avoidLand, isOpenWater,
    update(t, center, camPos) {
      innerMat.uniforms.uTime.value = t; ringMat.uniforms.uTime.value = t; skyMat.uniforms.uTime.value = t;
      waveAmps(innerMat.uniforms.uWaveA.value);
      inner.position.x = Math.round(center.x / STEP) * STEP; inner.position.z = Math.round(center.z / STEP) * STEP;
      innerMat.uniforms.uCenter.value.set(inner.position.x, inner.position.z);
      WAVE_FADE.x = inner.position.x; WAVE_FADE.z = inner.position.z;
      ring.position.x = inner.position.x; ring.position.z = inner.position.z;
      sky.position.copy(camPos);
    },
  };
}
