// Genererer alle bygninger som få, sammenflettede meshes (fliser á 160 m) + Rapier-trimesh.
import * as THREE from 'three';
import type { Building, CityData, LandmarkId, V2 } from '../shared/cityTypes.ts';
import { clipHalfPlane, hash, minAreaRect, pointInPolygon, signedArea } from '../shared/geom.ts';
import type { Physics } from '../physics.ts';
import { GeoBuilder, color } from './geo.ts';
import { FACADE, facadeCode, makeFacadeMaterial } from './materials.ts';

interface Style {
  color: string;
  roofColor: string;
  style: number;
  roof: 'flat' | 'gabled';
  roofH: number;
  bay: number;
}

const LANDMARK_STYLE: Record<LandmarkId, Partial<Style>> = {
  domkirken: { color: '#b0543d', roofColor: '#5f9f86', style: FACADE.CHURCH, roof: 'gabled', roofH: 11, bay: 4.6 },
  aros: { color: '#a9452f', roofColor: '#8c8c88', style: FACADE.MUSEUM, roof: 'flat', bay: 4 },
  raadhus: { color: '#d9d6cd', roofColor: '#b8b5ac', style: FACADE.TOWNHALL, roof: 'flat', bay: 2.2 },
  teater: { color: '#a5503a', roofColor: '#5f9f86', style: FACADE.RESIDENTIAL, roof: 'gabled', roofH: 7, bay: 3.4 },
  salling: { color: '#e2e0da', roofColor: '#8b8f94', style: FACADE.STORE, roof: 'flat', bay: 3.6 },
  parkeringshus: { color: '#b9b6ae', roofColor: '#76787a', style: FACADE.PARKING, roof: 'flat', bay: 5 },
};

const TILE = 160;

export function styleOf(b: Building): Style {
  const base: Style = {
    color: b.color,
    roofColor: b.roofColor,
    style: b.shop ? FACADE.SHOP : FACADE.RESIDENTIAL,
    roof: b.roof,
    roofH: b.roofH,
    bay: 2.8 + hash(b.id * 3) * 1.1,
  };
  if (b.kind === 'church') Object.assign(base, { style: FACADE.CHURCH, bay: 4.4 });
  return b.landmark ? { ...base, ...LANDMARK_STYLE[b.landmark] } : base;
}

export function buildBuildings(city: CityData, physics: Physics): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buildings';
  const chunks = new Map<string, GeoBuilder>();
  for (const b of city.buildings) {
    const cx = b.outer.reduce((s, p) => s + p[0], 0) / b.outer.length;
    const cz = b.outer.reduce((s, p) => s + p[1], 0) / b.outer.length;
    const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`;
    let gb = chunks.get(key);
    if (!gb) chunks.set(key, (gb = new GeoBuilder({ facade: true })));
    emitBuilding(gb, b, styleOf(b));
  }
  const mat = makeFacadeMaterial();
  for (const gb of chunks.values()) {
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const cd = gb.colliderData();
    physics.addTrimesh(cd.vertices, cd.indices);
  }
  return group;
}

function emitBuilding(gb: GeoBuilder, b: Building, s: Style) {
  const wallC = color(s.color);
  const roofC = color(s.roofColor);
  const seed = hash(b.id);
  const code = facadeCode(s.style, seed);
  const bottom = b.minH;
  const h = Math.max(bottom + 2.2, b.h);
  const edgeU = (p: V2, q: V2) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return L < 1.6 ? 0 : Math.max(1, Math.round(L / s.bay));
  };

  if (s.roof === 'gabled' && b.holes.length === 0) {
    const obb = minAreaRect(b.outer);
    const perp: V2 = [-obb.axis[1], obb.axis[0]];
    const cp = perp[0] * obb.center[0] + perp[1] * obb.center[1];
    const hw = Math.max(0.5, obb.halfWid);
    const roofH = Math.min(s.roofH, hw * 1.4);
    const roofY = (p: V2) => h + roofH * (1 - Math.min(1, Math.abs(perp[0] * p[0] + perp[1] * p[1] - cp) / hw));
    // Vægge – del kanter, der krydser rygningen, så gavlen når helt op
    for (let i = 0; i < b.outer.length; i++) {
      const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length];
      const n = edgeU(p, q);
      const dp = perp[0] * p[0] + perp[1] * p[1] - cp;
      const dq = perp[0] * q[0] + perp[1] * q[1] - cp;
      const f = (u0: number, u1: number) => ({ u0: n ? u0 : -1, u1: n ? u1 : -1, style: code });
      if (dp * dq < 0) {
        const t = dp / (dp - dq);
        const m: V2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        gb.wall(p, m, bottom, roofY(p), bottom, roofY(m), wallC, f(0, n * t));
        gb.wall(m, q, bottom, roofY(m), bottom, roofY(q), wallC, f(n * t, n));
      } else gb.wall(p, q, bottom, roofY(p), bottom, roofY(q), wallC, f(0, n));
    }
    const A = clipHalfPlane(b.outer, perp, cp);
    const B = clipHalfPlane(b.outer, [-perp[0], -perp[1]], -cp);
    if (A.length >= 3 && Math.abs(signedArea(A)) > 0.5) gb.polygon(ensurePos(A), [], roofY, roofC, true);
    if (B.length >= 3 && Math.abs(signedArea(B)) > 0.5) gb.polygon(ensurePos(B), [], roofY, roofC, true);
    // Skorsten
    if (hash(b.id * 11) < 0.55 && obb.halfLen > 3) {
      const t = (hash(b.id * 17) - 0.5) * obb.halfLen;
      const cx = obb.center[0] + obb.axis[0] * t, cz = obb.center[1] + obb.axis[1] * t;
      gb.box(cx, h + roofH - 0.2, cz, 0.35, 0.8, 0.5, color('#7a4a3a'), Math.atan2(obb.axis[0], obb.axis[1]));
    }
  } else {
    for (const ring of [b.outer, ...b.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const n = edgeU(p, q);
        gb.wall(p, q, bottom, h, bottom, h, wallC, { u0: n ? 0 : -1, u1: n ? n : -1, style: code });
      }
    }
    gb.polygon(b.outer, b.holes, h, roofC, true);
    if (bottom > 0.1) gb.polygon(b.outer, b.holes, bottom, wallC, false);
    // Tagudstyr (ventilation) på store flade tage
    const area = Math.abs(signedArea(b.outer));
    if (!b.landmark && area > 250) {
      const obb = minAreaRect(b.outer);
      const n = 1 + Math.floor(hash(b.id * 5) * 3);
      for (let k = 0; k < n; k++) {
        const u = (hash(b.id * 7 + k) - 0.5) * obb.halfLen, v = (hash(b.id * 13 + k) - 0.5) * obb.halfWid;
        const cx = obb.center[0] + obb.axis[0] * u - obb.axis[1] * v;
        const cz = obb.center[1] + obb.axis[1] * u + obb.axis[0] * v;
        if (!pointInPolygon([cx, cz], b.outer) || b.holes.some((hh) => pointInPolygon([cx, cz], hh))) continue;
        gb.box(cx, h + 0.6, cz, 1.2, 0.6, 0.9, color('#9a9d9f'), Math.atan2(obb.axis[0], obb.axis[1]));
      }
    }
  }
}

function ensurePos(poly: V2[]): V2[] {
  return signedArea(poly) > 0 ? poly : poly.slice().reverse();
}
