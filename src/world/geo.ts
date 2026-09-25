// Hjælper til at bygge store, sammenflettede geometrier (få draw calls) med vertex-farver.
import * as THREE from 'three';
import type { V2 } from '../shared/cityTypes.ts';

const tmpC = new THREE.Color();

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly fac: number[] = [];
  readonly idx: number[] = [];
  private readonly withUv: boolean;
  private readonly withFacade: boolean;

  constructor(opts: { uv?: boolean; facade?: boolean } = {}) {
    this.withUv = !!opts.uv;
    this.withFacade = !!opts.facade;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, u = 0, vv = 0, f?: [number, number, number]): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    if (this.withUv) this.uv.push(u, vv);
    if (this.withFacade) this.fac.push(f ? f[0] : -1, f ? f[1] : 0, f ? f[2] : -1);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    // a-b-c-d mod uret set fra forsiden
    this.idx.push(a, b, c, a, c, d);
  }

  /** Lodret væg fra p til q (udadvendt normal = højre side af p→q). */
  wall(p: V2, q: V2, y0p: number, y1p: number, y0q: number, y1q: number, c: THREE.Color, f?: { u0: number; u1: number; style: number }) {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L;
    const fa = (u: number, y: number): [number, number, number] | undefined => (f ? [u, y, f.style] : undefined);
    const a = this.v(p[0], y0p, p[1], nx, 0, nz, c, 0, y0p, fa(f?.u0 ?? -1, y0p));
    const b = this.v(p[0], y1p, p[1], nx, 0, nz, c, 0, y1p, fa(f?.u0 ?? -1, y1p));
    const cc = this.v(q[0], y1q, q[1], nx, 0, nz, c, L, y1q, fa(f?.u1 ?? -1, y1q));
    const d = this.v(q[0], y0q, q[1], nx, 0, nz, c, L, y0q, fa(f?.u1 ?? -1, y0q));
    this.idx.push(a, b, d, d, b, cc);
  }

  /** Vandret polygon (med huller) i højden y, normal op (eller ned). */
  polygon(outer: V2[], holes: V2[][], y: number | ((p: V2) => number), c: THREE.Color, up = true, facadeStyle = -1) {
    const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, hs);
    } catch {
      return;
    }
    const all = outer.concat(...holes);
    const base = this.vertexCount;
    const yf = typeof y === 'number' ? () => y : y;
    for (const p of all) this.v(p[0], yf(p), p[1], 0, up ? 1 : -1, 0, c, p[0], p[1], [-1, 0, facadeStyle]);
    for (const [a, b, d] of faces) {
      const pa = all[a], pb = all[b], pd = all[d];
      const cross = (pb[0] - pa[0]) * (pd[1] - pa[1]) - (pb[1] - pa[1]) * (pd[0] - pa[0]);
      // cross < 0 ⇒ normal op (se buildings-kommentar)
      if ((cross < 0) === up) this.tri(base + a, base + b, base + d);
      else this.tri(base + a, base + d, base + b);
    }
    if (typeof y !== 'number') this.recomputeNormalsFrom(base);
  }

  /** Genberegn flade-normaler for trekanter der bruger vertices fra `from` (til skrå tage). */
  recomputeNormalsFrom(from: number) {
    const P = this.pos, N = this.nor;
    const acc = new Map<number, [number, number, number]>();
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i], b = this.idx[i + 1], c = this.idx[i + 2];
      if (a < from && b < from && c < from) continue;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (const k of [a, b, c]) {
        const s = acc.get(k) ?? [0, 0, 0];
        acc.set(k, [s[0] + n[0], s[1] + n[1], s[2] + n[2]]);
      }
    }
    for (const [k, n] of acc) {
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      N[k * 3] = n[0] / l;
      N[k * 3 + 1] = n[1] / l;
      N[k * 3 + 2] = n[2] / l;
    }
  }

  /** Kasse (med valgfri drejning om y). */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: THREE.Color, yaw = 0, f = -1) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    // lokal (x,z) → verden: x' = x cos + z sin, z' = -x sin + z cos (samme som Three.js rotation.y)
    const T = (x: number, z: number): [number, number] => [cx + x * cs + z * sn, cz - x * sn + z * cs];
    const faces: [number[], number[]][] = [
      [[1, 0, 0], [1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1]],
      [[-1, 0, 0], [-1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1]],
      [[0, 1, 0], [-1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1]],
      [[0, -1, 0], [-1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1]],
      [[0, 0, 1], [1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1]],
      [[0, 0, -1], [-1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1]],
    ];
    for (const [n, v] of faces) {
      const [nx, nz] = [n[0] * cs + n[2] * sn, -n[0] * sn + n[2] * cs];
      const ids: number[] = [];
      for (let i = 0; i < 12; i += 3) {
        const [x, z] = T(v[i] * hx, v[i + 2] * hz);
        ids.push(this.v(x, cy + v[i + 1] * hy, z, nx, n[1], nz, c, 0, 0, [-1, 0, f]));
      }
      this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }

  /** Tilføj en Three.js-geometri transformeret med matrix og farvet ensfarvet. */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color) {
    const geo = g.index ? g.toNonIndexed() : g;
    const p = geo.getAttribute('position');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const n = geo.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const vp = new THREE.Vector3(), vn = new THREE.Vector3();
    const base = this.vertexCount;
    for (let i = 0; i < p.count; i++) {
      vp.fromBufferAttribute(p, i).applyMatrix4(m);
      vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.v(vp.x, vp.y, vp.z, vn.x, vn.y, vn.z, c);
    }
    for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withFacade) g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Positioner + indeks til en Rapier-trimesh. */
  colliderData(): { vertices: Float32Array; indices: Uint32Array } {
    return { vertices: new Float32Array(this.pos), indices: new Uint32Array(this.idx) };
  }
}

export function color(hex: string): THREE.Color {
  return tmpC.set(hex).clone();
}
