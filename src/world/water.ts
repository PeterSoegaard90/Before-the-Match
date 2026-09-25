// Aarhus Å og havnebassiner: vandflade under kajkanten + kajmure. Man kan falde i (PLASK!).
import * as THREE from 'three';
import type { Area, CityData, Road, V2 } from '../shared/cityTypes.ts';
import { GridIndex, bbox, nearestOnPolyline, pointInShape } from '../shared/geom.ts';
import { GeoBuilder, color } from './geo.ts';
import { makeFlatMaterial, makeWaterMaterial } from './materials.ts';

export const WATER_Y = -0.9;

export class Water {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  private areas: Area[];
  private idx = new GridIndex<Area>(60);
  private bridges: Road[];
  private bridgeIdx = new GridIndex<Road>(40);

  constructor(city: CityData) {
    this.group.name = 'water';
    this.areas = city.areas.filter((a) => a.kind === 'water');
    for (const a of this.areas) {
      const b = bbox(a.outer);
      this.idx.insert(a, b.minX, b.minZ, b.maxX, b.maxZ);
    }
    this.bridges = city.roads.filter((r) => r.bridge);
    for (const r of this.bridges) {
      const b = bbox(r.pts);
      this.bridgeIdx.insert(r, b.minX - r.w, b.minZ - r.w, b.maxX + r.w, b.maxZ + r.w);
    }

    const surf = new GeoBuilder();
    const walls = new GeoBuilder();
    const wallC = color('#8a857b');
    const copeC = color('#b7b2a8');
    const bnd = city.bounds;
    const onBounds = (p: V2) => Math.abs(p[0] - bnd.minX) < 3 || Math.abs(p[0] - bnd.maxX) < 3 || Math.abs(p[1] - bnd.minZ) < 3 || Math.abs(p[1] - bnd.maxZ) < 3;
    for (const a of this.areas) {
      surf.polygon(a.outer, a.holes, WATER_Y, color('#ffffff'), true);
      for (const ring of [a.outer, ...a.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 0.05 || (onBounds(p) && onBounds(q))) continue;
          // Kant delt med et andet vandareal? (ydersiden er også vand) → ingen mur
          const nx = (q[1] - p[1]) / L, nz = -(q[0] - p[0]) / L;
          const outside: V2 = [mid[0] + nx * 0.8, mid[1] + nz * 0.8];
          if (this.areas.some((o) => o !== a && pointInShape(outside, o.outer, o.holes))) continue;
          // Muren vender ind mod vandet: tegn q→p
          walls.wall(q, p, WATER_Y - 0.6, 0.04, WATER_Y - 0.6, 0.04, wallC);
          // Kantsten
          const inside: V2 = [-nx * 0.35, -nz * 0.35];
          const pi: V2 = [p[0] + inside[0], p[1] + inside[1]], qi: V2 = [q[0] + inside[0], q[1] + inside[1]];
          const po: V2 = [p[0] + nx * 0.35, p[1] + nz * 0.35], qo: V2 = [q[0] + nx * 0.35, q[1] + nz * 0.35];
          const ids = [po, qo, qi, pi].map((v) => walls.v(v[0], 0.06, v[1], 0, 1, 0, copeC));
          walls.tri(ids[0], ids[2], ids[1]);
          walls.tri(ids[0], ids[3], ids[2]);
        }
      }
    }
    const water = new THREE.Mesh(surf.build(), makeWaterMaterial(this.time));
    water.receiveShadow = true;
    water.matrixAutoUpdate = false;
    this.group.add(water);
    const wm = new THREE.Mesh(walls.build(), makeFlatMaterial({ side: THREE.DoubleSide }));
    wm.receiveShadow = true;
    wm.matrixAutoUpdate = false;
    this.group.add(wm);
  }

  /** Står man i vandet (og ikke på en bro)? */
  isWater(x: number, z: number): boolean {
    const p: V2 = [x, z];
    let wet = false;
    for (const a of this.idx.query(x, z)) if (pointInShape(p, a.outer, a.holes)) { wet = true; break; }
    if (!wet) return false;
    for (const r of this.bridgeIdx.query(x, z, 2)) if (nearestOnPolyline(p, r.pts).d < r.w / 2 + 0.6) return false;
    return true;
  }

  /** Nærmeste tørre punkt (til at kravle op efter et plask). */
  nearestDry(x: number, z: number): V2 {
    for (let r = 1; r < 40; r += 1) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.isWater(px, pz) && !this.isWater(px + Math.cos(a) * 1.5, pz + Math.sin(a) * 1.5)) return [px + Math.cos(a) * 1.5, pz + Math.sin(a) * 1.5];
      }
    }
    return [x, z];
  }

  update(dt: number) {
    this.time.value += dt;
  }
}

