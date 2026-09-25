// Delte materialer. Facader får vinduer via en procedural shader (ingen teksturer).
import * as THREE from 'three';

export const FACADE = {
  RESIDENTIAL: 0,
  SHOP: 1,
  CHURCH: 2,
  MUSEUM: 3,
  PARKING: 4,
  TOWNHALL: 5,
  STORE: 6,
} as const;

/** Koder stil + tilfældigt frø i én float: stil + frø*0.9 */
export function facadeCode(style: number, seed: number): number {
  return style + Math.max(0, Math.min(0.999, seed)) * 0.9;
}

const FACADE_GLSL = /* glsl */ `
varying vec3 vFacade;
float bandAA(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
}
vec3 facadePattern(vec3 col) {
  float style = floor(vFacade.z);
  if (vFacade.z < 0.0) return col;
  float seed = fract(vFacade.z) / 0.9;
  float u = vFacade.x;
  float y = vFacade.y;
  // sokkel
  col *= 1.0 - 0.28 * (1.0 - smoothstep(0.28, 0.42, y));
  if (u < 0.0) return col;
  float fu = fract(u);
  float aaU = max(fwidth(u) * 1.1, 1e-4);
  float fh = 3.1;
  float fl = (y - 0.6) / fh;
  float fy = fract(fl);
  float aaY = max(fwidth(fl) * 1.1, 1e-4);
  float aaH = max(fwidth(y) * 1.1, 1e-4);
  float cellR = fract(sin(dot(vec2(floor(u), floor(fl)), vec2(12.9898, 78.233)) + seed * 91.7) * 43758.5453);
  vec3 glass = mix(vec3(0.05, 0.07, 0.10), vec3(0.28, 0.36, 0.46), smoothstep(0.05, 0.95, fy));
  glass *= 0.75 + 0.5 * cellR;
  float win = 0.0;
  float frame = 0.0;
  if (style < 1.5) {
    float ww = 0.24 + 0.1 * seed;
    float upper = step(3.7, y);
    win = bandAA(fu, 0.5 - ww, 0.5 + ww, aaU) * bandAA(fy, 0.30, 0.80, aaY) * upper;
    frame = bandAA(fu, 0.5 - ww - 0.06, 0.5 + ww + 0.06, aaU) * bandAA(fy, 0.25, 0.86, aaY) * upper;
    if (y < 3.7) {
      if (style > 0.5) {
        float sx = bandAA(fu, 0.07, 0.93, aaU) * bandAA(y, 0.45, 2.85, aaH);
        win = max(win, sx);
        float sign = bandAA(y, 3.0, 3.5, aaH);
        col = mix(col, vec3(0.06, 0.06, 0.07), sign * 0.85);
      } else {
        win = max(win, bandAA(fu, 0.5 - ww, 0.5 + ww, aaU) * bandAA(y, 1.05, 2.7, aaH));
      }
    }
  } else if (style < 2.5) {
    float arch = 12.5 + 1.8 * (1.0 - clamp(abs(fu - 0.5) / 0.13, 0.0, 1.0));
    win = bandAA(fu, 0.37, 0.63, aaU) * bandAA(y, 3.2, arch, aaH);
    glass = vec3(0.10, 0.12, 0.2) + 0.06 * cellR;
  } else if (style < 3.5) {
    float line = bandAA(fract(y / 0.9), 0.0, 0.06, max(fwidth(y / 0.9), 1e-4));
    col *= 1.0 - line * 0.12;
    win = bandAA(fu, 0.1, 0.9, aaU) * bandAA(y, 0.4, 5.5, aaH) * step(fract(u * 0.25 + seed), 0.25);
  } else if (style < 4.5) {
    float fo = y / 3.0;
    float open = bandAA(fract(fo), 0.38, 0.86, max(fwidth(fo), 1e-4)) * step(0.5, y);
    float pillar = bandAA(fu, 0.0, 0.07, aaU);
    col = mix(col, vec3(0.05, 0.05, 0.055), open * (1.0 - pillar) * 0.92);
  } else if (style < 5.5) {
    float u2 = u * 2.0;
    win = bandAA(fract(u2), 0.22, 0.78, max(fwidth(u2), 1e-4)) * bandAA(fy, 0.22, 0.86, aaY) * step(0.9, y);
    glass *= 0.9;
  } else {
    win = bandAA(fu, 0.02, 0.98, aaU) * bandAA(fy, 0.3, 0.78, aaY) * step(3.7, y);
    if (y < 3.7) win = bandAA(fu, 0.05, 0.95, aaU) * bandAA(y, 0.4, 3.05, aaH);
  }
  float fade = 1.0 - smoothstep(0.22, 0.55, max(aaU, aaY));
  col = mix(col, col * 1.12 + 0.03, frame * fade * 0.7);
  col = mix(col, glass, win * fade);
  col = mix(col, mix(col, glass, 0.22), (1.0 - fade) * step(style, 1.5));
  return col;
}
`;

export function makeFacadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFacade;\nvarying vec3 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = facadePattern(diffuseColor.rgb);');
  };
  m.customProgramCacheKey = () => 'facade-v1';
  return m;
}

export function makeFlatMaterial(opts: { layer?: number; roughness?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness ?? 0.95, metalness: 0, side: opts.side ?? THREE.FrontSide });
  if (opts.layer) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -opts.layer;
    m.polygonOffsetUnits = -opts.layer * 4;
  }
  return m;
}

/** Vand med bølgende farve (tid via uniform). */
export function makeWaterMaterial(time: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float w = sin(vWPos.x * 0.9 + uTime * 1.3) * sin(vWPos.z * 0.7 - uTime * 1.1) + sin((vWPos.x + vWPos.z) * 2.1 + uTime * 2.3) * 0.35;
        diffuseColor.rgb *= 0.92 + 0.12 * w;
        diffuseColor.rgb += vec3(0.05, 0.08, 0.09) * smoothstep(0.9, 1.3, w);`,
      );
  };
  m.customProgramCacheKey = () => 'water-v1';
  return m;
}

/** Lille canvas-tekstur med belægningssten/fliser til jorden. */
export function makePavingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b9b3a8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 150 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(90,85,78,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
