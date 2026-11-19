// Small procedural touches for existing materials (no texture files needed).

// Horizontal wooden planks with seams and a faint grain, computed from the mesh's own
// coordinates (y = up, z = along the ship), so it works on shapes without texture coordinates.
export function woodify(mat, plank = 0.3) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float py = vWoodPos.y / ${plank.toFixed(3)};
          float id = floor(py), f = fract(py);
          float rnd = fract(sin(id * 91.7) * 43758.5);
          float seam = mix(0.62, 1.0, smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.95, f));
          float z = vWoodPos.z + rnd * 7.0;
          float butt = step(0.985, fract(z / 4.2));
          float grain = 0.94 + 0.06 * sin(z * 2.3 + sin(z * 0.6 + id * 3.0) * 2.5 + f * 9.0);
          diffuseColor.rgb *= (0.86 + 0.24 * rnd) * grain * seam * (1.0 - butt * 0.3);
        }`);
  };
  mat.customProgramCacheKey = () => 'wood' + plank;
  return mat;
}
