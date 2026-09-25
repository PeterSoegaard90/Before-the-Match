// Træer, lygtepæle, bænke, Dannebrog-guirlander, flagstænger, halvtage (building=roof)
// og platformene (containere, stilladser, halvtage) med fadøl på toppen.
import * as THREE from 'three';
import type { CityData, PlatformSite, V2 } from '../shared/cityTypes.ts';
import { bbox, pointAlong, pointInPolygon, polylineLength, rng } from '../shared/geom.ts';
import type { Physics } from '../physics.ts';
import { GeoBuilder, color } from './geo.ts';
import { makeFlatMaterial } from './materials.ts';

export interface PropsResult {
  group: THREE.Group;
  platformBeers: THREE.Vector3[];
  update(dt: number): void;
}

type Blocked = (x: number, z: number, margin?: number) => boolean;

export function buildProps(city: CityData, physics: Physics, blocked: Blocked, isWater: (x: number, z: number) => boolean): PropsResult {
  const group = new THREE.Group();
  group.name = 'props';
  const R = rng(2024);
  const time = { value: 0 };

  // ------------------------------------------------------------ træer (instanced)
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6).translate(0, 1.6, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4f36, roughness: 1 }), city.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), city.trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const greens = ['#5f8f3c', '#6c9a42', '#4f7f34', '#7aa64a', '#58883a'].map((c) => color(c));
  city.trees.forEach((t, i) => {
    const sc = 0.8 + R() * 0.5;
    m.compose(p.set(t[0], 0, t[1]), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), s.set(sc, sc, sc));
    trunks.setMatrixAt(i, m);
    const r = (2.1 + R() * 1.1) * sc;
    m.compose(p.set(t[0], 3.2 * sc + r * 0.75, t[1]), q.setFromEuler(new THREE.Euler(R(), R() * 6, R())), s.set(r, r * (0.85 + R() * 0.3), r));
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, greens[Math.floor(R() * greens.length)]);
    physics.addCylinder(t[0], 1.5, t[1], 1.5, 0.28 * sc);
  });
  for (const im of [trunks, crowns]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ------------------------------------------------------------ lygtepæle og bænke
  const furn = new GeoBuilder();
  const poleC = color('#3b3f44');
  const lampC = color('#f3ecd2');
  const woodC = color('#8a6440');
  let lamps = 0;
  for (const r of city.roads) {
    if (lamps > 420) break;
    if (r.kind !== 'major' && r.kind !== 'street' && r.kind !== 'pedestrian') continue;
    const L = polylineLength(r.pts);
    for (let d = 8 + R() * 10, side = 1; d < L - 5; d += 26 + R() * 8, side = -side) {
      const a = pointAlong(r.pts, d);
      const off = r.kind === 'pedestrian' ? r.w / 2 - 0.6 : r.w / 2 + 0.7;
      const x = a.pt[0] - a.dir[1] * off * side, z = a.pt[1] + a.dir[0] * off * side;
      if (blocked(x, z, 0.8) || isWater(x, z)) continue;
      furn.box(x, 2.6, z, 0.07, 2.6, 0.07, poleC);
      const ax = -a.dir[1] * side * 0.45, az = a.dir[0] * side * 0.45;
      furn.box(x - ax, 5.2, z - az, 0.08, 0.06, 0.08, poleC, Math.atan2(ax, az));
      furn.box(x - ax * 1.6, 5.1, z - az * 1.6, 0.22, 0.09, 0.3, lampC, Math.atan2(ax, az));
      physics.addCylinder(x, 1.5, z, 1.5, 0.1);
      lamps++;
    }
  }
  let benches = 0;
  for (const a of city.areas) {
    if (benches > 90 || (a.kind !== 'square' && a.kind !== 'park' && a.kind !== 'grass')) continue;
    const b = bbox(a.outer);
    const n = a.kind === 'square' ? 3 : 2;
    for (let k = 0, tries = 0; k < n && tries < 20; tries++) {
      const x = b.minX + R() * (b.maxX - b.minX), z = b.minZ + R() * (b.maxZ - b.minZ);
      if (!pointInPolygon([x, z], a.outer) || blocked(x, z, 1.2) || isWater(x, z)) continue;
      const yaw = R() * Math.PI;
      furn.box(x, 0.45, z, 0.9, 0.05, 0.25, woodC, yaw);
      const bx = Math.sin(yaw) * 0.22, bz = Math.cos(yaw) * 0.22;
      furn.box(x - bx, 0.75, z - bz, 0.9, 0.2, 0.04, woodC, yaw);
      furn.box(x, 0.22, z, 0.8, 0.22, 0.2, poleC, yaw);
      physics.addBox(x, 0.4, z, 0.9, 0.4, 0.3, yaw);
      benches++;
      k++;
    }
  }
  addMesh(group, furn, makeFlatMaterial({ roughness: 0.7 }), true);

  // ------------------------------------------------------------ Dannebrog-guirlander over gågaderne
  const bunt = new GeoBuilder();
  const red = color('#c8102e'), white = color('#ffffff'), rope = color('#444444');
  let lines = 0;
  for (const r of city.roads) {
    if (r.kind !== 'pedestrian' || lines > 140) continue;
    const L = polylineLength(r.pts);
    for (let d = 6; d < L - 4; d += 15) {
      const a = pointAlong(r.pts, d);
      const n: V2 = [-a.dir[1], a.dir[0]];
      const hit = (sgn: number) => {
        for (let o = r.w / 2; o < r.w / 2 + 9; o += 0.5) if (blocked(a.pt[0] + n[0] * o * sgn, a.pt[1] + n[1] * o * sgn)) return o;
        return -1;
      };
      const o1 = hit(1), o2 = hit(-1);
      if (o1 < 0 || o2 < 0) continue;
      const A: V2 = [a.pt[0] + n[0] * (o1 - 0.2), a.pt[1] + n[1] * (o1 - 0.2)];
      const B: V2 = [a.pt[0] - n[0] * (o2 - 0.2), a.pt[1] - n[1] * (o2 - 0.2)];
      const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const y0 = 5.6, sag = Math.min(1.2, span * 0.06);
      const count = Math.floor(span / 0.55);
      for (let k = 0; k < count; k++) {
        const t0 = k / count, t1 = (k + 0.7) / count, tm = (k + 0.35) / count;
        const P = (t: number): [number, number, number] => [A[0] + (B[0] - A[0]) * t, y0 - sag * 4 * t * (1 - t), A[1] + (B[1] - A[1]) * t];
        const p0 = P(t0), p1 = P(t1), pm = P(tm);
        const c = k % 2 === 0 ? red : white;
        const i0 = bunt.v(p0[0], p0[1], p0[2], a.dir[0], 0, a.dir[1], c);
        const i1 = bunt.v(p1[0], p1[1], p1[2], a.dir[0], 0, a.dir[1], c);
        const i2 = bunt.v(pm[0], pm[1] - 0.42, pm[2], a.dir[0], 0, a.dir[1], c);
        bunt.tri(i0, i1, i2);
      }
      // snor
      for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8;
        const x0 = A[0] + (B[0] - A[0]) * t0, z0 = A[1] + (B[1] - A[1]) * t0, y0a = y0 - sag * 4 * t0 * (1 - t0);
        const x1 = A[0] + (B[0] - A[0]) * t1, z1 = A[1] + (B[1] - A[1]) * t1, y1a = y0 - sag * 4 * t1 * (1 - t1);
        const i0 = bunt.v(x0, y0a + 0.02, z0, 0, 1, 0, rope), i1 = bunt.v(x1, y1a + 0.02, z1, 0, 1, 0, rope);
        const i2 = bunt.v(x1, y1a - 0.02, z1, 0, 1, 0, rope), i3 = bunt.v(x0, y0a - 0.02, z0, 0, 1, 0, rope);
        bunt.quad(i0, i1, i2, i3);
      }
      lines++;
    }
  }
  const buntMat = makeFlatMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  buntMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uTime * 2.6 + position.z * 0.7 + position.x * 0.3) * 0.06 * (5.6 - position.y);\ntransformed.z += cos(uTime * 2.1 + position.x * 0.6) * 0.06 * (5.6 - position.y);');
  };
  buntMat.customProgramCacheKey = () => 'bunting';
  addMesh(group, bunt, buntMat, false);

  // ------------------------------------------------------------ flagstænger med vajende Dannebrog
  const flagTex = dannebrogTexture();
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 });
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat k = uv.x;\ntransformed.z += sin(uTime * 5.0 - uv.x * 6.0) * 0.28 * k;\ntransformed.y += sin(uTime * 3.0 - uv.x * 4.0) * 0.05 * k;');
  };
  flagMat.customProgramCacheKey = () => 'flag';
  const flagGeo = new THREE.PlaneGeometry(3, 2.2, 12, 4).translate(1.5, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 11, 8).translate(0, 5.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const flagSpots: V2[] = Object.values(city.squares).map((sq) => sq as V2);
  for (const sq of flagSpots) {
    let x = sq[0] + 6, z = sq[1] - 4;
    for (let k = 0; k < 12 && (blocked(x, z, 1) || isWater(x, z)); k++) {
      x = sq[0] + (R() - 0.5) * 24;
      z = sq[1] + (R() - 0.5) * 24;
    }
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 0, z);
    pole.castShadow = true;
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0, 9.8, 0);
    flag.rotation.y = -0.6;
    flag.castShadow = true;
    pole.add(flag);
    group.add(pole);
    physics.addCylinder(x, 3, z, 3, 0.12);
  }

  // ------------------------------------------------------------ halvtage fra OSM (building=roof)
  const canopy = new GeoBuilder();
  const canC = color('#8f949a'), postC = color('#5a5e63');
  for (const c of city.canopies) {
    const slab = new GeoBuilder();
    slab.polygon(c.outer, [], c.h, canC, true);
    slab.polygon(c.outer, [], c.h - 0.25, canC, false);
    for (let i = 0; i < c.outer.length; i++) slab.wall(c.outer[i], c.outer[(i + 1) % c.outer.length], c.h - 0.25, c.h, c.h - 0.25, c.h, canC);
    const cd = slab.colliderData();
    physics.addTrimesh(cd.vertices, cd.indices);
    for (let i = 0; i < slab.pos.length; i += 3) canopy.pos.push(slab.pos[i], slab.pos[i + 1], slab.pos[i + 2]);
    const base = canopy.vertexCount - slab.vertexCount;
    canopy.nor.push(...slab.nor);
    canopy.col.push(...slab.col);
    canopy.idx.push(...slab.idx.map((k) => k + base));
    for (let i = 0; i < c.outer.length; i += 2) {
      const [x, z] = c.outer[i];
      if (blocked(x, z, 0.1)) continue;
      canopy.box(x, (c.h - 0.25) / 2, z, 0.1, (c.h - 0.25) / 2, 0.1, postC);
      physics.addBox(x, (c.h - 0.25) / 2, z, 0.1, (c.h - 0.25) / 2, 0.1);
    }
  }
  addMesh(group, canopy, makeFlatMaterial({ roughness: 0.6, side: THREE.DoubleSide }), true);

  // ------------------------------------------------------------ platforme
  const plat = new GeoBuilder();
  const platformBeers: THREE.Vector3[] = [];
  for (const site of city.platforms) platformBeers.push(buildPlatform(site, plat, physics, R));
  addMesh(group, plat, makeFlatMaterial({ roughness: 0.75 }), true);

  return {
    group,
    platformBeers,
    update(dt: number) {
      time.value += dt;
    },
  };
}

function buildPlatform(site: PlatformSite, gb: GeoBuilder, physics: Physics, R: () => number): THREE.Vector3 {
  const h = site.heading;
  const rx = Math.cos(h), rz = -Math.sin(h); // lokal +x (langs facaden)
  const fx = -Math.sin(h), fz = -Math.cos(h); // lokal -z (ud fra facaden)
  const at = (x: number, d: number): [number, number] => [site.pos[0] + rx * x + fx * d, site.pos[1] + rz * x + fz * d];
  const solid = (x: number, y: number, d: number, hx: number, hy: number, hd: number, c: THREE.Color) => {
    const [cx, cz] = at(x, d);
    gb.box(cx, y, cz, hx, hy, hd, c, h);
    physics.addBox(cx, y, cz, hx, hy, hd, h);
  };
  const deco = (x: number, y: number, d: number, hx: number, hy: number, hd: number, c: THREE.Color) => {
    const [cx, cz] = at(x, d);
    gb.box(cx, y, cz, hx, hy, hd, c, h);
  };
  const tube = color('#9ea3a8'), plank = color('#b88a55'), crate = color('#9b6b3d');
  if (site.kind === 'container') {
    const cols = ['#b5392b', '#2f5f9e', '#3f8a4c', '#d9822b', '#6a6f75'];
    const c = color(cols[Math.floor(R() * cols.length)]);
    const [cx, cz] = at(0, 0);
    gb.box(cx, 1.3, cz, 3.03, 1.3, 1.22, c, h);
    physics.addBox(cx, 1.3, cz, 3.03, 1.3, 1.22, h);
    // riller
    for (let x = -2.7; x <= 2.7; x += 0.6) deco(x, 1.3, 1.24, 0.08, 1.2, 0.02, c.clone().multiplyScalar(0.8));
    for (let x = -2.7; x <= 2.7; x += 0.6) deco(x, 1.3, -1.24, 0.08, 1.2, 0.02, c.clone().multiplyScalar(0.8));
    solid(3.9, 0.55, 0, 0.55, 0.55, 0.55, crate);
    const [bx, bz] = at(-1, 0);
    return new THREE.Vector3(bx, 2.6, bz);
  }
  if (site.kind === 'scaffold') {
    for (const x of [-4, 0, 4]) for (const d of [0.25, 1.45]) deco(x, 3.6, d, 0.05, 3.6, 0.05, tube);
    for (const d of [0.25, 1.45]) for (const y of [1.0, 3.0, 5.0, 7.0]) deco(0, y, d, 4, 0.04, 0.04, tube);
    solid(0, 1.95, 0.85, 4, 0.06, 0.62, plank); // niveau 1: hele bredden (2.0 m)
    solid(-2, 3.95, 0.85, 2, 0.06, 0.62, plank); // niveau 2: venstre halvdel (4.0 m)
    solid(2, 5.95, 0.85, 2, 0.06, 0.62, plank); // niveau 3: højre halvdel (6.0 m)
    // net-/dug-banner på facaden for farve
    deco(0, 4.5, 0.06, 4, 2.5, 0.02, color('#d8d2c2'));
    const [bx, bz] = at(2.4, 0.85);
    return new THREE.Vector3(bx, 6.0, bz);
  }
  // Halvtag med kasser at klatre op ad
  const awn = color(R() < 0.5 ? '#2f6b3f' : '#8e2b2b');
  solid(0, 2.95, 1.1, 2.6, 0.08, 1.05, awn);
  for (let k = 0; k < 7; k++) deco(-2.4 + k * 0.8, 2.86, 2.16, 0.4, 0.14, 0.02, k % 2 === 0 ? white() : awn);
  for (const x of [-2.5, 2.5]) solid(x, 1.45, 2.05, 0.06, 1.45, 0.06, tube);
  solid(3.4, 0.55, 1.2, 0.55, 0.55, 0.55, crate);
  deco(3.4, 1.32, 1.2, 0.5, 0.22, 0.5, color('#7a5a35'));
  solid(3.4, 1.32, 1.2, 0.35, 0.22, 0.35, crate);
  const [bx, bz] = at(-0.5, 1.1);
  return new THREE.Vector3(bx, 3.03, bz);
}

function white() {
  return color('#f2f2f2');
}

export function dannebrogTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 222;
  c.height = 162;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 222, 162);
  g.fillStyle = '#ffffff';
  g.fillRect(66, 0, 24, 162);
  g.fillRect(0, 69, 222, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addMesh(group: THREE.Group, gb: GeoBuilder, mat: THREE.Material, cast: boolean) {
  if (gb.vertexCount === 0) return;
  const mesh = new THREE.Mesh(gb.build(), mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}
