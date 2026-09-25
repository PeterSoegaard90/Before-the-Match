// Jord, arealer (græs, pladser …), veje med striber, fodgængerovergange, skinner og broer.
import * as THREE from 'three';
import type { AreaKind, CityData, RoadKind, V2 } from '../shared/cityTypes.ts';
import { pointAlong, polylineLength } from '../shared/geom.ts';
import type { Physics } from '../physics.ts';
import { GeoBuilder, color } from './geo.ts';
import { makeFlatMaterial, makePavingTexture } from './materials.ts';

const AREA_COLOR: Record<AreaKind, string> = {
  water: '#2f6f8f', pool: '#78b3cc', grass: '#86b35a', park: '#7bab52', forest: '#55863f',
  square: '#d3c6a8', parking: '#7a7b7e', pitch: '#62a048', playground: '#dcbd82',
};
const ROAD_COLOR: Record<RoadKind, string> = {
  major: '#4a4b4f', street: '#55565a', service: '#636467', pedestrian: '#d9ccb0',
  footway: '#c8c2b7', cycleway: '#6b7079', steps: '#b8ad9b', path: '#c9b98f',
};
const ROAD_LAYER: Record<RoadKind, number> = {
  footway: 2, cycleway: 2, steps: 2, path: 2, pedestrian: 3, service: 4, street: 5, major: 5,
};

/** Trekant med normal op uanset rækkefølge. */
function upTri(gb: GeoBuilder, a: V2, b: V2, c: V2, y: number, col: THREE.Color) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const i = gb.v(a[0], y, a[1], 0, 1, 0, col);
  const j = gb.v(b[0], y, b[1], 0, 1, 0, col);
  const k = gb.v(c[0], y, c[1], 0, 1, 0, col);
  if (cross < 0) gb.tri(i, j, k);
  else gb.tri(i, k, j);
}

function upQuad(gb: GeoBuilder, a: V2, b: V2, c: V2, d: V2, y: number, col: THREE.Color) {
  upTri(gb, a, b, c, y, col);
  upTri(gb, a, c, d, y, col);
}

/** Bånd langs en polylinje med runde samlinger. */
export function strip(gb: GeoBuilder, pts: V2[], hw: number, y: number, col: THREE.Color, joins = true) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.01) continue;
    const nx = (-dz / L) * hw, nz = (dx / L) * hw;
    upQuad(gb, [p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz], y, col);
  }
  if (!joins) return;
  const seg = hw > 3 ? 10 : 6;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1) {
      // Spring samlinger over, hvor retningen næsten ikke ændrer sig
      const a = pts[i - 1], c0 = pts[i], b = pts[i + 1];
      const a1 = Math.atan2(c0[1] - a[1], c0[0] - a[0]), a2 = Math.atan2(b[1] - c0[1], b[0] - c0[0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < 0.12) continue;
    }
    const c = pts[i];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      upTri(gb, c, [c[0] + Math.cos(a0) * hw, c[1] + Math.sin(a0) * hw], [c[0] + Math.cos(a1) * hw, c[1] + Math.sin(a1) * hw], y, col);
    }
  }
}

export function buildGround(city: CityData, physics: Physics): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground';

  // Basis-jord med fliser
  const paving = makePavingTexture();
  paving.repeat.set(3000 / 3.2, 3000 / 3.2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: paving, color: 0xe6e0d6, roughness: 0.97 }),
  );
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  group.add(ground);
  physics.addBox(0, -0.5, 0, 1500, 0.5, 1500);

  // Arealer
  const areaGb = new GeoBuilder();
  const poolGb = new GeoBuilder();
  for (const a of city.areas) {
    if (a.kind === 'water') continue;
    if (a.kind === 'pool') poolGb.polygon(a.outer, a.holes, 0.03, color(AREA_COLOR.pool), true);
    else areaGb.polygon(a.outer, a.holes, a.kind === 'square' ? 0.025 : 0.02, color(AREA_COLOR[a.kind]), true);
  }
  addMesh(group, areaGb, makeFlatMaterial({ layer: 1 }));
  addMesh(group, poolGb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));

  // Skinner (ballast under vejene, skinner ovenpå)
  const ballast = new GeoBuilder();
  const steel = new GeoBuilder();
  for (const r of city.rails) {
    strip(ballast, r.pts, r.light ? 1.3 : 1.6, 0.03, color(r.light ? '#7d8a7a' : '#8e867a'));
    for (const off of [-0.72, 0.72]) strip(steel, offsetLine(r.pts, off), 0.06, 0.1, color('#3e3e40'), false);
  }
  addMesh(group, ballast, makeFlatMaterial({ layer: 1 }));

  // Veje pr. lag
  const layers = new Map<number, GeoBuilder>();
  const marks = new GeoBuilder();
  const white = color('#f1f0ea');
  for (const r of city.roads) {
    const layer = ROAD_LAYER[r.kind];
    let gb = layers.get(layer);
    if (!gb) layers.set(layer, (gb = new GeoBuilder()));
    strip(gb, r.pts, r.w / 2, 0.03 + layer * 0.008, color(ROAD_COLOR[r.kind]));
    if ((r.kind === 'major' || r.kind === 'street') && r.w >= 7) {
      // Stiplet midterlinje
      const L = polylineLength(r.pts);
      for (let s = 2; s < L - 3; s += 6) {
        const a = pointAlong(r.pts, s), b = pointAlong(r.pts, Math.min(L, s + 3));
        strip(marks, [a.pt, b.pt], 0.08, 0.1, white, false);
      }
    }
    if (r.crossing) {
      // Zebrastriber på tværs af kørebanen
      const L = polylineLength(r.pts);
      for (let s = 0.4; s < L - 0.3; s += 1.0) {
        const a = pointAlong(r.pts, s);
        const d = a.dir;
        const n: V2 = [-d[1], d[0]];
        const c = a.pt;
        const hl = 0.25, hw = 1.5;
        upQuad(
          marks,
          [c[0] + d[0] * hl + n[0] * hw, c[1] + d[1] * hl + n[1] * hw],
          [c[0] - d[0] * hl + n[0] * hw, c[1] - d[1] * hl + n[1] * hw],
          [c[0] - d[0] * hl - n[0] * hw, c[1] - d[1] * hl - n[1] * hw],
          [c[0] + d[0] * hl - n[0] * hw, c[1] + d[1] * hl - n[1] * hw],
          0.1, white,
        );
      }
    }
  }
  for (const [layer, gb] of layers) addMesh(group, gb, makeFlatMaterial({ layer }));
  addMesh(group, marks, makeFlatMaterial({ layer: 7, roughness: 0.7 }));
  addMesh(group, steel, makeFlatMaterial({ layer: 8, roughness: 0.4 }));

  // Broer: dæk + rækværk (med kollidere, så man ikke kører i åen)
  const bridge = new GeoBuilder();
  const railC = color('#5c5f63');
  const deckC = color('#8d8a84');
  for (const r of city.roads) {
    if (!r.bridge || (r.kind !== 'major' && r.kind !== 'street' && r.kind !== 'pedestrian' && r.kind !== 'footway' && r.kind !== 'cycleway')) continue;
    for (const side of [1, -1]) {
      const line = offsetLine(r.pts, (r.w / 2 + 0.1) * side);
      for (let i = 0; i < line.length - 1; i++) {
        const p = line[i], q = line[i + 1];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.2) continue;
        const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
        const cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2;
        bridge.box(cx, 0.55, cz, 0.08, 0.5, L / 2, railC, yaw);
        bridge.box(cx, -0.35, cz, 0.2, 0.4, L / 2, deckC, yaw);
        physics.addBox(cx, 0.55, cz, 0.08, 0.55, L / 2, yaw);
      }
    }
  }
  addMesh(group, bridge, makeFlatMaterial({ roughness: 0.6 }), true);
  return group;
}

export function offsetLine(pts: V2[], off: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    out.push([pts[i][0] - (dz / L) * off, pts[i][1] + (dx / L) * off]);
  }
  return out;
}

function addMesh(group: THREE.Group, gb: GeoBuilder, mat: THREE.Material, cast = false) {
  if (gb.vertexCount === 0) return;
  const m = new THREE.Mesh(gb.build(), mat);
  m.receiveShadow = true;
  m.castShadow = cast;
  m.matrixAutoUpdate = false;
  group.add(m);
}
