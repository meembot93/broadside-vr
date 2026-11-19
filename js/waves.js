// Shared wave model so ships float on exactly the surface the shader draws.
const RAW = [
  // amplitude, wavelength, direction x, direction z
  [0.50, 42, 1, 0.35],
  [0.30, 23, 0.35, 1],
  [0.15, 11.5, -0.75, 0.6],
];
export const WAVES = RAW.map(([A, L, dx, dz]) => {
  const n = Math.hypot(dx, dz), k = (2 * Math.PI) / L;
  return { A, k, dx: dx / n, dz: dz / n, w: Math.sqrt(9.81 * k) };
});

export function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin((w.dx * x + w.dz * z) * w.k + t * w.w);
  return h;
}

// GLSL that computes h, dhx, dhz from vec3 wp and float uTime.
export function waveGLSL() {
  const f = (v) => v.toFixed(6);
  let s = 'float h=0.0, dhx=0.0, dhz=0.0, ph;\n';
  for (const w of WAVES) {
    s += `ph=(${f(w.dx)}*wp.x+${f(w.dz)}*wp.z)*${f(w.k)}+uTime*${f(w.w)};` +
      `h+=${f(w.A)}*sin(ph); dhx+=${f(w.A * w.k * w.dx)}*cos(ph); dhz+=${f(w.A * w.k * w.dz)}*cos(ph);\n`;
  }
  return s;
}
