// Shared wave model so ships float on exactly the surface the shader draws.
// Each wave has a calm and a storm height; setSeaState() blends between them (weather.js
// calls it), and the ocean shader reads the same heights through the uWaveA uniform.
const RAW = [
  // calm amplitude, storm amplitude, wavelength, direction x, direction z
  [0.50, 0.80, 42, 1, 0.35],
  [0.30, 0.48, 23, 0.35, 1],
  [0.15, 0.26, 11.5, -0.75, 0.6],
  [0.00, 0.95, 96, 0.92, 0.5],   // long storm swell: big slow heave, gentle slopes
];
export const WAVES = RAW.map(([A0, A1, L, dx, dz]) => {
  const n = Math.hypot(dx, dz), k = (2 * Math.PI) / L;
  return { A: A0, A0, A1, k, dx: dx / n, dz: dz / n, w: Math.sqrt(9.81 * k) };
});

// 0 = fair weather, 1 = full storm
export function setSeaState(s) {
  for (const w of WAVES) w.A = w.A0 + (w.A1 - w.A0) * s;
}

// The ocean only draws waves on a patch round our ship and fades them out toward its edge
// (world.js), so far-off ships must ride the same fade or they'd bob above a flat sea.
export const WAVE_FADE = { x: 0, z: 0, r0: 1e9, r1: 2e9 };

export function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin((w.dx * x + w.dz * z) * w.k + t * w.w);
  const F = WAVE_FADE, d = Math.hypot(x - F.x, z - F.z);
  if (d > F.r0) { const u = Math.min(1, (d - F.r0) / (F.r1 - F.r0)); h *= 1 - u * u * (3 - 2 * u); }
  return h;
}

// The current heights packed for the shader's uWaveA uniform (a vec4, one per wave).
export function waveAmps(v4) { return v4.set(WAVES[0].A, WAVES[1].A, WAVES[2].A, WAVES[3].A); }

// GLSL that computes h, dhx, dhz from vec3 wp, float uTime and vec4 uWaveA.
export function waveGLSL() {
  const f = (v) => v.toFixed(6), c = 'xyzw';
  let s = 'float h=0.0, dhx=0.0, dhz=0.0, ph;\n';
  WAVES.forEach((w, i) => {
    const A = `uWaveA.${c[i]}`;
    s += `ph=(${f(w.dx)}*wp.x+${f(w.dz)}*wp.z)*${f(w.k)}+uTime*${f(w.w)};` +
      `h+=${A}*sin(ph); dhx+=${A}*${f(w.k * w.dx)}*cos(ph); dhz+=${A}*${f(w.k * w.dz)}*cos(ph);\n`;
  });
  return s;
}
