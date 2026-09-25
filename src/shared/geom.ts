// 2D-geometri i x/z-planet. Deles af data-pipelinen (Node) og spillet (browser).
import type { V2 } from './cityTypes.ts';

export const EPS = 1e-9;

export function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Returnerer en kopi med positivt signeret areal (eller negativt hvis positive=false). */
export function withWinding(poly: V2[], positive: boolean): V2[] {
  const a = signedArea(poly);
  return (a > 0) === positive ? poly.slice() : poly.slice().reverse();
}

/** Fjerner lukkende dublet, dubletter og (næsten) kolineære punkter. */
export function cleanRing(poly: V2[], tol = 0.05): V2[] {
  let pts = poly.slice();
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) pts.pop();
  }
  const dedup: V2[] = [];
  for (const p of pts) {
    const q = dedup[dedup.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) dedup.push(p);
  }
  pts = dedup;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (distToSegment(b, a, c) < tol) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  const x = p[0], z = p[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + EPS) + xi) inside = !inside;
  }
  return inside;
}

export function pointInShape(p: V2, outer: V2[], holes: V2[][]): boolean {
  if (!pointInPolygon(p, outer)) return false;
  for (const h of holes) if (pointInPolygon(p, h)) return false;
  return true;
}

export function closestOnSegment(p: V2, a: V2, b: V2): { pt: V2; t: number; d: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > EPS ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const pt: V2 = [a[0] + dx * t, a[1] + dz * t];
  return { pt, t, d: Math.hypot(p[0] - pt[0], p[1] - pt[1]) };
}

export function distToSegment(p: V2, a: V2, b: V2): number {
  return closestOnSegment(p, a, b).d;
}

export function nearestOnPolyline(p: V2, pts: V2[]): { pt: V2; d: number; seg: number; t: number } {
  let best = { pt: pts[0], d: Infinity, seg: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestOnSegment(p, pts[i], pts[i + 1]);
    if (c.d < best.d) best = { pt: c.pt, d: c.d, seg: i, t: c.t };
  }
  return best;
}

export function distToRing(p: V2, ring: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distToSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

export function polylineLength(pts: V2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Punkt i afstand s langs polylinjen + retningsvektor. */
export function pointAlong(pts: V2[], s: number): { pt: V2; dir: V2 } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === pts.length - 1) {
      const t = l > EPS ? Math.min(1, s / l) : 0;
      return { pt: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: l > EPS ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] };
    }
    s -= l;
  }
  return { pt: pts[0], dir: [1, 0] };
}

export function centroid(poly: V2[]): V2 {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as V2, [0, 0] as V2);
    return [s[0] / poly.length, s[1] / poly.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(poly: V2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ };
}

export function convexHull(points: V2[]): V2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface OBB {
  center: V2;
  axis: V2; // enhedsvektor langs den lange side
  halfLen: number;
  halfWid: number;
  fill: number; // polygonareal / rektangelareal
}

/** Minimum-areal-rektangel (roterende kalibre over konveks hylster). */
export function minAreaRect(poly: V2[]): OBB {
  const hull = convexHull(poly);
  let best: OBB | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < EPS) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uz;
      const v = -p[0] * uz + p[1] * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      const center: V2 = [cu * ux - cv * uz, cu * uz + cv * ux];
      const lu = (maxU - minU) / 2, lv = (maxV - minV) / 2;
      best = lu >= lv
        ? { center, axis: [ux, uz], halfLen: lu, halfWid: lv, fill: 0 }
        : { center, axis: [-uz, ux], halfLen: lv, halfWid: lu, fill: 0 };
    }
  }
  if (!best) return { center: poly[0], axis: [1, 0], halfLen: 0, halfWid: 0, fill: 0 };
  best.fill = Math.abs(signedArea(poly)) / Math.max(EPS, bestArea);
  return best;
}

/** Sutherland–Hodgman: behold den del af polygonen hvor dot(n, p) <= c. */
export function clipHalfPlane(poly: V2[], n: V2, c: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = p[0] * n[0] + p[1] * n[1] - c;
    const dq = q[0] * n[0] + q[1] * n[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export function segmentsIntersect(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Simpelt gitter-indeks til hurtige opslag af polygoner/segmenter nær et punkt. */
export class GridIndex<T> {
  private cells = new Map<number, T[]>();
  private readonly size: number;
  constructor(size = 32) {
    this.size = size;
  }
  private key(ix: number, iz: number) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.size;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++)
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const k = this.key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(item);
      }
  }
  query(x: number, z: number, r = 0): T[] {
    const s = this.size;
    const out = new Set<T>();
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++)
      for (let iz = Math.floor((z - r) / s); iz <= Math.floor((z + r) / s); iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (arr) for (const it of arr) out.add(it);
      }
    return [...out];
  }
}

/** Deterministisk PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function len(v: V2): number {
  return Math.hypot(v[0], v[1]);
}

export function sub(a: V2, b: V2): V2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function dist(a: V2, b: V2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Vinkel (radianer) for en retning i x/z hvor 0 = mod -z (nord) og positiv = mod uret set ovenfra. */
export function headingOf(dir: V2): number {
  return Math.atan2(-dir[0], -dir[1]);
}
