// Samler hele byen: data, 3D, kollidere, navigationsnet og forespørgsler.
import * as THREE from 'three';
import type { Building, CityData, SquareId, V2 } from '../shared/cityTypes.ts';
import { GridIndex, bbox, distToRing, pointInShape } from '../shared/geom.ts';
import { NavIndex } from '../shared/nav.ts';
import type { Physics } from '../physics.ts';
import { buildBackdrop } from './backdrop.ts';
import { buildBuildings } from './buildings.ts';
import { buildGround } from './ground.ts';
import { buildLandmarks, type LandmarkResult } from './landmarks.ts';
import { buildProps, type PropsResult } from './props.ts';
import { Sky } from './sky.ts';
import { Water } from './water.ts';

export interface BeerSpot {
  pos: THREE.Vector3;
  kind: 'bar' | 'platform';
  name?: string;
}

export class World {
  readonly city: CityData;
  readonly physics: Physics;
  readonly nav: NavIndex;
  readonly water: Water;
  readonly sky: Sky;
  readonly props: PropsResult;
  readonly landmarks: LandmarkResult;
  readonly beerSpots: BeerSpot[] = [];
  private bIdx = new GridIndex<Building>(30);

  constructor(city: CityData, physics: Physics, scene: THREE.Scene, opts: { shadowSize?: number } = {}) {
    this.city = city;
    this.physics = physics;
    for (const b of city.buildings) {
      const bb = bbox(b.outer);
      this.bIdx.insert(b, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
    }
    this.nav = new NavIndex(city.nav);
    this.sky = new Sky(scene, opts.shadowSize ?? 2048);
    scene.add(buildGround(city, physics));
    this.water = new Water(city);
    scene.add(this.water.group);
    scene.add(buildBuildings(city, physics));
    if (city.backdrop?.length) scene.add(buildBackdrop(city));
    this.landmarks = buildLandmarks(city, physics);
    scene.add(this.landmarks.group);
    this.props = buildProps(city, physics, (x, z, m) => this.insideBuilding(x, z, m), (x, z) => this.water.isWater(x, z));
    scene.add(this.props.group);
    this.addBounds();
    this.physics.flushStatic();

    for (const b of city.bars) this.beerSpots.push({ pos: new THREE.Vector3(b.pos[0], b.y ?? 0, b.pos[1]), kind: 'bar', name: b.name });
    for (const p of this.props.platformBeers) this.beerSpots.push({ pos: p, kind: 'platform' });
  }

  /** Usynlige mure ved kortets kant. */
  private addBounds() {
    const b = this.city.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
    const m = 25; // margen inden for bbox
    // Opdelt i stykker á højst 100 m (præcision i kollisionerne)
    const seg = (x0: number, z0: number, x1: number, z1: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 100);
      for (let i = 0; i < n; i++) {
        const ax = x0 + ((x1 - x0) * (i + 0.5)) / n, az = z0 + ((z1 - z0) * (i + 0.5)) / n;
        const hl = L / n / 2;
        if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) this.physics.addBox(ax, 20, az, hl, 40, 1);
        else this.physics.addBox(ax, 20, az, 1, 40, hl);
      }
    };
    seg(cx - hx, b.minZ + m - 1, cx + hx, b.minZ + m - 1);
    seg(cx - hx, b.maxZ - m + 1, cx + hx, b.maxZ - m + 1);
    seg(b.minX + m - 1, cz - hz, b.minX + m - 1, cz + hz);
    seg(b.maxX - m + 1, cz - hz, b.maxX - m + 1, cz + hz);
  }

  insideBuilding(x: number, z: number, margin = 0): boolean {
    const p: V2 = [x, z];
    for (const b of this.bIdx.query(x, z, margin + 1)) {
      if (pointInShape(p, b.outer, b.holes)) return true;
      if (margin > 0 && distToRing(p, b.outer) < margin) return true;
    }
    return false;
  }

  square(id: SquareId): THREE.Vector3 {
    const s = this.city.squares[id];
    return new THREE.Vector3(s[0], 0, s[1]);
  }

  /** Jordhøjde under et punkt (tage, ramper …) – falder tilbage til 0. */
  groundY(x: number, z: number, fromY = 60): number {
    return this.physics.groundY(x, fromY, z, fromY + 5) ?? 0;
  }

  inPlayArea(x: number, z: number, margin = 30): boolean {
    const b = this.city.bounds;
    return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.water.update(dt);
    this.props.update(dt);
    this.sky.update(dt, focus, camera);
  }
}
