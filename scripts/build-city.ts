// Omsætter rå OSM-data (data/osm-raw.json) til spillets bydata (public/data/city.json).
// Kør: npm run data:build
// Kortdata © OpenStreetMap contributors (ODbL).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { BBOX, project } from './area.ts';
import type {
  Area, AreaKind, BarSpot, Building, Canopy, CityData, HeightSource, LandmarkId, NavGraph,
  ParkSpot, PlatformSite, Rail, Road, RoadKind, SquareId, V2,
} from '../src/shared/cityTypes.ts';
import {
  GridIndex, bbox, centroid, cleanRing, closestOnSegment, dist, distToRing, hash, minAreaRect,
  nearestOnPolyline, pointAlong, pointInPolygon, pointInShape, polylineLength, rng, signedArea, withWinding,
} from '../src/shared/geom.ts';
import { NavIndex } from '../src/shared/nav.ts';
import polygonClipping from 'polygon-clipping';

// ---------------------------------------------------------------- input
interface LatLon { lat: number; lon: number }
interface OsmMember { type: string; ref: number; role: string; geometry?: LatLon[] }
interface OsmEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: LatLon[];
  members?: OsmMember[];
  tags?: Record<string, string>;
}

const raw = JSON.parse(readFileSync('data/osm-raw.json', 'utf8')) as { elements: OsmEl[] };
const els = raw.elements;
const P = (g: LatLon[]): V2[] => g.map((p) => project(p.lat, p.lon));
const r1 = (v: number) => Math.round(v * 10) / 10;
const rv = (p: V2): V2 => [r1(p[0]), r1(p[1])];

const [minX, maxZ] = project(BBOX.south, BBOX.west);
const [maxX, minZ] = project(BBOX.north, BBOX.east);
const inBounds = (p: V2, m = 0) => p[0] >= minX - m && p[0] <= maxX + m && p[1] >= minZ - m && p[1] <= maxZ + m;

const LANDMARKS: Record<number, LandmarkId> = {
  254079854: 'domkirken',
  23568150: 'aros',
  428972747: 'raadhus',
  51265304: 'teater',
  107363057: 'salling',
  5977884: 'parkeringshus',
};
const LANDMARK_HEIGHT: Record<LandmarkId, number> = {
  domkirken: 22, aros: 44, raadhus: 24, teater: 18, salling: 24, parkeringshus: 24,
};

/** Samler ring(e) fra relationsmedlemmer, der kan være splittet over flere veje. */
function assembleRings(members: OsmMember[], role: string): V2[][] {
  const parts = members.filter((m) => m.type === 'way' && m.role === role && m.geometry && m.geometry.length > 1)
    .map((m) => P(m.geometry!));
  const rings: V2[][] = [];
  const same = (a: V2, b: V2) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  while (parts.length) {
    let ring = parts.shift()!;
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 500) {
      const end = ring[ring.length - 1];
      const i = parts.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(same(p[0], end) ? p.slice(1) : p.slice().reverse().slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

// ---------------------------------------------------------------- farver
const WALL_PALETTE = ['#d9b36c', '#a24b3a', '#e8e0d0', '#d9a38f', '#c9c2b4', '#8a3b32', '#cbb38a', '#a9b99a', '#9fb0b8', '#e6d3a3', '#b8644a', '#efe9dc'];
const NAMED: Record<string, string> = {
  white: '#ecebe6', black: '#3a3a3a', gray: '#8f8f8f', grey: '#8f8f8f', red: '#9c3b30', brick: '#a0503c',
  stone: '#b8b0a0', glass: '#8fb3c7', timber_framing: '#e8dcc0', yellow: '#e2c16b', brown: '#7a5238', beige: '#d8c8a8',
  plaster: '#e3d9c6', concrete: '#a8a59e', metal: '#9aa0a6', wood: '#8a6a48',
};
function colorOf(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const t = tag.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  return NAMED[t];
}

// ---------------------------------------------------------------- bygninger
interface RawB { id: number; outer: V2[]; holes: V2[][]; tags: Record<string, string>; landmark?: LandmarkId }
const rawBuildings: RawB[] = [];
const canopies: Canopy[] = [];
const relMemberWays = new Set<number>();

for (const e of els) {
  if (e.type !== 'relation' || !e.tags?.building || !e.members) continue;
  const t = e.tags;
  if (t.location === 'underground' || t.location === 'indoor') continue;
  const outers = assembleRings(e.members, 'outer');
  const inners = assembleRings(e.members, 'inner');
  e.members.forEach((m) => relMemberWays.add(m.ref));
  for (const o of outers) {
    const holes = inners.filter((h) => pointInPolygon(h[0], o));
    rawBuildings.push({ id: e.id, outer: o, holes, tags: t, landmark: LANDMARKS[e.id] });
  }
}
for (const e of els) {
  if (e.type !== 'way' || !e.tags?.building || !e.geometry) continue;
  const t = e.tags;
  if (t.location === 'underground' || t.location === 'indoor' || t.building === 'bridge') continue;
  if (relMemberWays.has(e.id)) continue;
  const ring = P(e.geometry);
  if (t.building === 'roof') {
    const r = cleanRing(ring);
    if (r.length >= 3 && Math.abs(signedArea(r)) > 6) {
      const h = num(t.height) ?? num(t.min_height) ?? 3.6;
      canopies.push({ outer: withWinding(r, true).map(rv), h: Math.max(2.8, Math.min(8, h)) });
    }
    continue;
  }
  rawBuildings.push({ id: e.id, outer: ring, holes: [], tags: t, landmark: LANDMARKS[e.id] });
}

interface WorkB extends Building { levels?: number; area: number; c: V2 }
const buildings: WorkB[] = [];
for (const rb of rawBuildings) {
  const outer = cleanRing(rb.outer);
  if (outer.length < 3) continue;
  const area = Math.abs(signedArea(outer));
  if (area < 4) continue;
  const c = centroid(outer);
  if (!inBounds(c, 40)) continue;
  const t = rb.tags;
  const h = num(t.height);
  const lv = num(t['building:levels']);
  const roofLv = num(t['roof:levels']) ?? 0;
  const minH = num(t.min_height) ?? (num(t['building:min_level']) ?? 0) * 3.1;
  let heightSource: HeightSource = 'default';
  let eaves = 0;
  let levels: number | undefined;
  if (rb.landmark) {
    heightSource = 'landmark';
    eaves = LANDMARK_HEIGHT[rb.landmark];
  } else if (h !== undefined) {
    heightSource = 'osm-height';
    eaves = h;
  } else if (lv !== undefined) {
    heightSource = 'osm-levels';
    levels = lv;
    eaves = lv * 3.1 + 0.6;
  }
  buildings.push({
    id: rb.id,
    outer: withWinding(outer, true),
    holes: rb.holes.map((hh) => withWinding(cleanRing(hh), false)).filter((hh) => hh.length >= 3),
    h: eaves,
    minH: Math.max(0, minH),
    roof: 'flat',
    roofH: 0,
    color: '',
    roofColor: '',
    kind: t.building,
    shop: false,
    landmark: rb.landmark,
    heightSource,
    levels: levels ?? (lv !== undefined ? lv + roofLv * 0.5 : undefined),
    area,
    c,
  });
}

// Højder for bygninger uden data: median af kendte naboer inden for 45 m, ellers 4 etager.
const known = buildings.filter((b) => b.levels !== undefined);
const knownIdx = new GridIndex<WorkB>(50);
known.forEach((b) => knownIdx.insert(b, b.c[0], b.c[1], b.c[0], b.c[1]));
const SMALL_KINDS = new Set(['shed', 'garage', 'garages', 'kiosk', 'service', 'guardhouse', 'tent', 'bunker', 'storage_tank', 'construction']);
for (const b of buildings) {
  if (b.heightSource !== 'default') continue;
  let lv: number;
  if (SMALL_KINDS.has(b.kind) || b.area < 25) lv = 1;
  else if (b.area < 60) lv = 2;
  else if (b.kind === 'church') lv = 5;
  else if (b.kind === 'house' || b.kind === 'detached' || b.kind === 'semidetached_house') lv = 2;
  else {
    const nb = knownIdx.query(b.c[0], b.c[1], 45).filter((k) => dist(k.c, b.c) < 45).map((k) => k.levels!).sort((x, y) => x - y);
    if (nb.length >= 2) {
      lv = Math.round(nb[Math.floor(nb.length / 2)]);
      b.heightSource = 'neighbors';
    } else lv = 4;
  }
  b.levels = lv;
  b.h = lv * 3.1 + 0.6;
}


// ---------------------------------------------------------------- Sallings Parkeringshus: spiralrampe + gangbro
const ROOF_Y = LANDMARK_HEIGHT.salling;
function fitCircle(pts: V2[]): { c: V2; r: number } {
  // Kåsa-fit: x² + z² + D x + E z + F = 0
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, n = 0, sxb = 0, szb = 0, sb = 0;
  for (const [x, z] of pts) {
    const b = -(x * x + z * z);
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; n++;
    sxb += x * b; szb += z * b; sb += b;
  }
  const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]];
  const v = [sxb, szb, sb];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D0 = det(M);
  const col = (i: number) => M.map((row, k) => row.map((val, j) => (j === i ? v[k] : val)));
  const D = det(col(0)) / D0, E = det(col(1)) / D0, F = det(col(2)) / D0;
  const c: V2 = [-D / 2, -E / 2];
  return { c, r: Math.sqrt(Math.max(0, c[0] * c[0] + c[1] * c[1] - F)) };
}
const parkB = buildings.filter((b) => b.landmark === 'parkeringshus');
const sallingB = buildings.find((b) => b.landmark === 'salling')!;
let parkingHelix: CityData['parkingHelix'];
{
  const main = parkB.reduce((a, b) => (a.area > b.area ? a : b));
  const guess: V2 = [157, 77];
  const lobe = main.outer.filter((p) => dist(p, guess) < 15);
  const fit = lobe.length >= 5 ? fitCircle(lobe) : { c: guess, r: 11 };
  const rOuter = Math.min(12.5, Math.max(10, fit.r + 0.8));
  const rInner = 4.2;
  const bodyC = centroid(main.outer);
  const endAngle = Math.atan2(bodyC[1] - fit.c[1], bodyC[0] - fit.c[0]);
  parkingHelix = { center: rv(fit.c), rInner, rOuter: r1(rOuter), top: ROOF_Y, turns: 2.5, endAngle: Math.round(endAngle * 1000) / 1000 };
  // Skær spiralen (og en lille landingsplads) ud af bygningskroppen
  const circle: V2[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    circle.push([fit.c[0] + Math.cos(a) * (rOuter + 0.6), fit.c[1] + Math.sin(a) * (rOuter + 0.6)]);
  }
  const res = polygonClipping.difference([main.outer.concat([main.outer[0]]), ...main.holes.map((h) => h.concat([h[0]]))], [circle.concat([circle[0]])]);
  const idx = buildings.indexOf(main);
  buildings.splice(idx, 1);
  for (const poly of res) {
    const outer = cleanRing(poly[0] as V2[]);
    if (outer.length < 3 || Math.abs(signedArea(outer)) < 20) continue;
    buildings.push({
      ...main, outer: withWinding(outer, true), holes: poly.slice(1).map((h) => withWinding(cleanRing(h as V2[]), false)),
      area: Math.abs(signedArea(outer)), c: centroid(outer),
    });
  }
}
// Gangbro: nærmeste punkter mellem Sallings og parkeringshusets facader
let skybridge: CityData['skybridge'];
{
  let best = { d: Infinity, a: [0, 0] as V2, b: [0, 0] as V2 };
  const parkNow = buildings.filter((b) => b.landmark === 'parkeringshus');
  const S = sallingB.outer;
  for (let i = 0; i < S.length; i++) {
    const p = S[i], q = S[(i + 1) % S.length];
    const L = dist(p, q);
    for (let s = 6; s < L - 6; s += 1) {
      const pt: V2 = [p[0] + ((q[0] - p[0]) * s) / L, p[1] + ((q[1] - p[1]) * s) / L];
      for (const pb of parkNow) {
        const o = pb.outer;
        for (let j = 0; j < o.length; j++) {
          const c = closestOnSegment(pt, o[j], o[(j + 1) % o.length]);
          if (c.d < best.d && c.d > 3) best = { d: c.d, a: pt, b: c.pt };
        }
      }
    }
  }
  skybridge = { a: rv(best.a), b: rv(best.b), y: ROOF_Y, w: 7 };
}
const sallingRoof = { center: rv(centroid(sallingB.outer)), y: ROOF_Y, outer: sallingB.outer.map(rv) };

// Tagform, farver
const GABLE_SHAPES = new Set(['gabled', 'hipped', 'half-hipped', 'gambrel', 'mansard', 'side_hipped', 'side_half-hipped', 'pyramidal']);
const GABLE_KINDS = new Set(['yes', 'apartments', 'residential', 'house', 'terrace', 'church', 'detached', 'semidetached_house', 'dormitory', 'school', 'hotel', 'office']);
for (const b of buildings) {
  const t = rawBuildings.find((r) => r.id === b.id)!.tags;
  const obb = minAreaRect(b.outer);
  const shape = t['roof:shape'];
  let gabled = false;
  if (b.landmark) gabled = false;
  else if (shape) gabled = GABLE_SHAPES.has(shape);
  else gabled = GABLE_KINDS.has(b.kind) && b.area < 1100 && obb.fill > 0.72 && obb.halfWid < 11 && b.holes.length === 0 && hash(b.id) < 0.78;
  if (gabled && obb.halfWid > 0.8) {
    b.roof = 'gabled';
    b.roofH = Math.max(1.8, Math.min(7.5, num(t['roof:height']) ?? obb.halfWid * 0.8));
    if (b.heightSource === 'osm-height') b.h = Math.max(2.5, b.h - b.roofH);
  }
  const hs = hash(b.id * 7 + 3);
  b.color = colorOf(t['building:colour']) ?? colorOf(t['building:material']) ?? WALL_PALETTE[Math.floor(hs * WALL_PALETTE.length)];
  b.roofColor = colorOf(t['roof:colour']) ?? (b.roof === 'gabled' ? (hash(b.id * 13) < 0.68 ? '#9c4a33' : '#4d535a') : ['#7b7b78', '#8a8680', '#6c6f70'][Math.floor(hash(b.id * 5) * 3)]);
}

// ---------------------------------------------------------------- veje
const ROAD_KIND: Record<string, RoadKind> = {
  trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'street', unclassified: 'street',
  residential: 'street', living_street: 'street', busway: 'street', service: 'service',
  pedestrian: 'pedestrian', footway: 'footway', cycleway: 'cycleway', steps: 'steps', path: 'path', track: 'path', bridleway: 'path',
};
const ROAD_W: Record<RoadKind, number> = { major: 11, street: 8, service: 4.5, pedestrian: 7, footway: 2.4, cycleway: 2.4, steps: 2.6, path: 2 };
const roads: Road[] = [];
const areas: Area[] = [];
interface WayInfo { ids: number[]; pts: V2[]; kind: RoadKind; w: number; bridge: boolean }
const navWays: WayInfo[] = [];

for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags ?? {};
  const hw = t.highway;
  if (!hw) continue;
  const kind = ROAD_KIND[hw];
  if (!kind) continue;
  if (t.tunnel === 'yes' || t.tunnel === 'covered' || t.indoor === 'yes' || (num(t.layer) ?? 0) < 0) continue;
  const pts = P(e.geometry);
  if (t.area === 'yes') {
    const ring = cleanRing(pts);
    if (ring.length >= 3) areas.push({ outer: withWinding(ring, true), holes: [], kind: 'square' });
    continue;
  }
  const w = Math.max(1.5, Math.min(22, num(t.width) ?? (hw === 'service' && t.service === 'parking_aisle' ? 5 : ROAD_W[kind])));
  const bridge = t.bridge === 'yes' || t.bridge === 'viaduct';
  const crossing = t.footway === 'crossing' || t.cycleway === 'crossing' || (!!t.crossing && (hw === 'footway' || hw === 'cycleway' || hw === 'path'));
  if (t.tunnel !== 'building_passage') roads.push({ pts: pts.map(rv), w, kind, bridge, ...(crossing ? { crossing: true } : {}) });
  if (t.tunnel !== 'building_passage' && t.access !== 'private' && t.access !== 'no')
    navWays.push({ ids: e.nodes!, pts, kind, w, bridge });
}

// Arealer
const areaKind = (t: Record<string, string>): AreaKind | undefined => {
  if (t.natural === 'water') return t.water === 'reflecting_pool' || t.water === 'basin' || t.intermittent === 'yes' ? 'pool' : 'water';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.landuse === 'forest') return 'forest';
  if (t.landuse && /grass|recreation_ground|meadow|village_green/.test(t.landuse)) return 'grass';
  if (t.place === 'square' || t['area:highway']) return 'square';
  if (t.amenity === 'parking' && t.parking !== 'multi-storey' && t.parking !== 'underground' && !t.building) return 'parking';
  return undefined;
};
for (const e of els) {
  const t = e.tags ?? {};
  if (e.type === 'node' || t.highway || t.building) continue;
  const kind = areaKind(t);
  if (!kind) continue;
  if (e.type === 'way' && e.geometry) {
    const ring = cleanRing(P(e.geometry));
    if (ring.length >= 3 && Math.abs(signedArea(ring)) > 2) areas.push({ outer: withWinding(ring, true).map(rv), holes: [], kind });
  } else if (e.type === 'relation' && e.members) {
    const inners = assembleRings(e.members, 'inner').map((r) => withWinding(cleanRing(r), false).map(rv));
    for (const o of assembleRings(e.members, 'outer')) {
      const ring = cleanRing(o);
      if (ring.length >= 3) areas.push({ outer: withWinding(ring, true).map(rv), holes: inners.filter((h) => pointInPolygon(h[0], ring)), kind });
    }
  }
}
const waterAreas = areas.filter((a) => a.kind === 'water');

// Skinner
const rails: Rail[] = [];
for (const e of els) {
  const t = e.tags ?? {};
  if (e.type !== 'way' || !e.geometry) continue;
  if ((t.railway === 'rail' || t.railway === 'light_rail') && t.tunnel !== 'yes') rails.push({ pts: P(e.geometry).map(rv), light: t.railway === 'light_rail' });
}

// ---------------------------------------------------------------- indeks
const bIdx = new GridIndex<WorkB>(30);
for (const b of buildings) {
  const bb = bbox(b.outer);
  bIdx.insert(b, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
}
const insideBuilding = (p: V2, margin = 0): boolean => {
  for (const b of bIdx.query(p[0], p[1], margin + 1)) {
    if (pointInShape(p, b.outer, b.holes)) return true;
    if (margin > 0 && distToRing(p, b.outer) < margin) return true;
  }
  return false;
};
const inWater = (p: V2, margin = 0) =>
  waterAreas.some((a) => pointInShape(p, a.outer, a.holes) || (margin > 0 && distToRing(p, a.outer) < margin));
const carRoads = roads.filter((r) => r.kind === 'major' || r.kind === 'street' || r.kind === 'service');
const rIdx = new GridIndex<Road>(40);
for (const r of roads) {
  const bb = bbox(r.pts);
  rIdx.insert(r, bb.minX - r.w, bb.minZ - r.w, bb.maxX + r.w, bb.maxZ + r.w);
}
const onCarRoad = (p: V2, margin = 0) =>
  rIdx.query(p[0], p[1], 12).some((r) => (r.kind === 'major' || r.kind === 'street' || r.kind === 'service') && nearestOnPolyline(p, r.pts).d < r.w / 2 + margin);
const nearRoadKind = (p: V2, kinds: RoadKind[], within: number) =>
  rIdx.query(p[0], p[1], within + 12).some((r) => kinds.includes(r.kind) && nearestOnPolyline(p, r.pts).d < within + r.w / 2);

// Butiksfacader langs gågader og store gader
for (const b of buildings) {
  if (b.landmark) continue;
  b.shop = ['retail', 'commercial', 'hotel', 'bank'].includes(b.kind) ||
    b.outer.some((p, i) => {
      const q = b.outer[(i + 1) % b.outer.length];
      const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return nearRoadKind(mid, ['pedestrian', 'major'], 4);
    });
}

// ---------------------------------------------------------------- træer
const trees: V2[] = [];
for (const e of els) {
  if (e.type !== 'node' || e.tags?.natural !== 'tree') continue;
  const p = project(e.lat!, e.lon!);
  if (!inBounds(p) || insideBuilding(p, 0.8) || inWater(p, 0.5) || onCarRoad(p, 0.3)) continue;
  trees.push(rv(p));
}

// ---------------------------------------------------------------- navigationsnet
const nodeIndex = new Map<number, number>();
const navNodes: V2[] = [];
const navEdges: [number, number, number][] = [];
const edgeKinds: RoadKind[] = [];
const idOf = (osmId: number, p: V2) => {
  let i = nodeIndex.get(osmId);
  if (i === undefined) {
    i = navNodes.length;
    nodeIndex.set(osmId, i);
    navNodes.push(rv(p));
  }
  return i;
};
for (const w of navWays) {
  for (let k = 0; k < w.ids.length - 1; k++) {
    const a = w.pts[k], b = w.pts[k + 1];
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!inBounds(a, -2) || !inBounds(b, -2)) continue;
    if (insideBuilding(mid) || (!w.bridge && inWater(mid))) continue;
    navEdges.push([idOf(w.ids[k], a), idOf(w.ids[k + 1], b), r1(w.w)]);
    edgeKinds.push(w.kind);
  }
}
// Behold største sammenhængende komponent
{
  const adj: number[][] = navNodes.map(() => []);
  navEdges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const comp = new Int32Array(navNodes.length).fill(-1);
  let bestC = -1, bestN = 0, c = 0;
  for (let s = 0; s < navNodes.length; s++) {
    if (comp[s] >= 0) continue;
    let n = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const u = stack.pop()!;
      n++;
      for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); }
    }
    if (n > bestN) { bestN = n; bestC = c; }
    c++;
  }
  const remap = new Int32Array(navNodes.length).fill(-1);
  const nodes2: V2[] = [];
  navNodes.forEach((p, i) => { if (comp[i] === bestC) { remap[i] = nodes2.length; nodes2.push(p); } });
  const edges2: [number, number, number][] = [];
  const kinds2: RoadKind[] = [];
  navEdges.forEach(([a, b, w], i) => {
    if (remap[a] >= 0 && remap[b] >= 0 && remap[a] !== remap[b]) { edges2.push([remap[a], remap[b], w]); kinds2.push(edgeKinds[i]); }
  });
  navNodes.length = 0; navNodes.push(...nodes2);
  navEdges.length = 0; navEdges.push(...edges2);
  edgeKinds.length = 0; edgeKinds.push(...kinds2);
}
const nav: NavGraph = { nodes: navNodes, edges: navEdges };


// Punkt på gangbart underlag (ikke i bygning/vand) tæt på p
function walkablePointNear(p: V2, maxR = 40): V2 | null {
  let best: V2 | null = null, bestD = Infinity;
  for (const r of rIdx.query(p[0], p[1], maxR)) {
    if (r.kind === 'steps') continue;
    const n = nearestOnPolyline(p, r.pts);
    if (n.d > maxR || n.d >= bestD) continue;
    let cand = n.pt;
    // På bilveje: flyt ud på fortovet mod p
    if (r.kind === 'major' || r.kind === 'street') {
      const dx = p[0] - n.pt[0], dz = p[1] - n.pt[1];
      const l = Math.hypot(dx, dz);
      if (l > 0.5) {
        const off = Math.min(l, r.w / 2 + 1.2);
        cand = [n.pt[0] + (dx / l) * off, n.pt[1] + (dz / l) * off];
      }
    }
    if (insideBuilding(cand, 0.6) || inWater(cand, 1)) {
      if (insideBuilding(n.pt, 0.6) || inWater(n.pt, 1)) continue;
      cand = n.pt;
    }
    best = cand;
    bestD = n.d;
  }
  return best;
}

// ---------------------------------------------------------------- barer (opdigtede navne)
const BAR_NAMES = [
  'Den Tørstige Viking', 'Roligan-Kroen', 'Skum & Skål', 'Hjelmen', 'Hornet', 'Det Gyldne Skum', 'Kickoff Bodega',
  'Tolvte Mand', 'Straffesparket', 'Offside Pub', 'Stolpe Ud', 'Hattrick Bar', 'Frisparket', 'Hjørnesparket',
  'Målmandens Stamkro', 'Det Røde Kort', 'Det Gule Kort', 'Dommerfløjten', 'Ekstra Tid', 'Overtid', 'Halvlegen',
  'Fadølsfabrikken', 'Ølstuen ved Åen', 'Dannebrog Bar', 'Vikingeskibet', 'Langskibet', 'Mjødhallen', 'Skjoldmøen',
  'Bodega Bold', 'Netmaskerne', 'Stamgæsten', 'Krogen', 'Tapstedet', 'Skænkestuen', 'Den Glade Tønde', 'Humle & Malt',
  'Pokalen', 'Fanzonen Light', 'Tribunen', 'Langskuddet', 'Indkastet', 'Lige i Krydset', 'Sejrsbrølet', 'Heppekoret',
  'Klaphatten', 'Rød-Hvid', 'Hornblæseren', 'Dommerbordet', 'Sidelinjen', 'Straffesparksfeltet', 'Lysreklamen',
];
const barNodes: V2[] = [];
for (const e of els) {
  const a = e.tags?.amenity;
  if (!a || !/^(bar|pub|biergarten|nightclub)$/.test(a)) continue;
  if (e.type === 'node') barNodes.push(project(e.lat!, e.lon!));
  else if (e.type === 'way' && e.geometry) barNodes.push(centroid(P(e.geometry)));
}
const bars: BarSpot[] = [];
{
  const R = rng(1984);
  const names = BAR_NAMES.slice().sort(() => R() - 0.5);
  const clusters: V2[][] = [];
  for (const p of barNodes) {
    if (!inBounds(p, -10)) continue;
    const c = clusters.find((cl) => dist(centroid2(cl), p) < 26);
    if (c) c.push(p); else clusters.push([p]);
  }
  bars.push({ pos: sallingRoof.center, name: 'Tagterrassen', y: ROOF_Y });
  for (const cl of clusters) {
    const c = centroid2(cl);
    const w = walkablePointNear(c, 35);
    if (!w || bars.some((b) => dist(b.pos, w) < 18)) continue;
    bars.push({ pos: rv(w), name: names[bars.length % names.length] });
  }
}
function centroid2(ps: V2[]): V2 {
  return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
}

// ---------------------------------------------------------------- pladser, politi, start
const SQUARE_IDS: Record<SquareId, number> = {
  storeTorv: 158676455, bispetorv: 51355743, raadhuspladsen: 1157718522, banegaardspladsen: 1157718523,
};
const squares = {} as Record<SquareId, V2>;
for (const [k, id] of Object.entries(SQUARE_IDS) as [SquareId, number][]) {
  const e = els.find((x) => x.id === id)!;
  const ring = P(e.geometry!);
  let c = centroid(ring);
  if (!pointInPolygon(c, ring) || insideBuilding(c, 1.5)) c = walkablePointNear(c, 60) ?? c;
  squares[k] = rv(c);
}
const policeB = els.find((x) => x.id === 107363070)!;
const policeStation = rv(walkablePointNear(centroid(P(policeB.geometry!)), 60)!);
const spawn = { pos: squares.banegaardspladsen, heading: 0 };
{
  // Kig mod byen (nord)
  const target = squares.storeTorv;
  spawn.heading = Math.atan2(-(target[0] - spawn.pos[0]), -(target[1] - spawn.pos[1]));
}

// ---------------------------------------------------------------- parkerede køretøjer
const parking: ParkSpot[] = [];
{
  const R = rng(42);
  const junctions = new Set<string>();
  const degree = new Map<string, number>();
  for (const r of carRoads) for (const p of r.pts) { const k = p.join(','); degree.set(k, (degree.get(k) ?? 0) + 1); }
  for (const r of carRoads) { const a = r.pts[0].join(','), b = r.pts[r.pts.length - 1].join(','); degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1); }
  for (const [k, d] of degree) if (d >= 3) junctions.add(k);
  const junctionPts = [...junctions].map((k) => k.split(',').map(Number) as V2);
  const jIdx = new GridIndex<V2>(30);
  junctionPts.forEach((p) => jIdx.insert(p, p[0], p[1], p[0], p[1]));
  const nearJunction = (p: V2, r: number) => jIdx.query(p[0], p[1], r).some((j) => dist(j, p) < r);
  const clear = (p: V2, r: number) => !parking.some((s) => dist(s.pos, p) < r);
  const carOk = (c: V2, dir: V2, hw: number) => {
    const n: V2 = [-dir[1], dir[0]];
    for (const [a, b] of [[2.3, 1], [-2.3, 1], [2.3, -1], [-2.3, -1], [0, 0]] as const) {
      const q: V2 = [c[0] + dir[0] * a + n[0] * b * hw, c[1] + dir[1] * a + n[1] * b * hw];
      if (insideBuilding(q, 0.4) || inWater(q, 1) || !inBounds(q, -8)) return false;
    }
    return true;
  };
  const streets = carRoads.filter((r) => (r.kind === 'street' || r.kind === 'major') && !r.bridge);
  for (const r of streets.sort(() => R() - 0.5)) {
    const L = polylineLength(r.pts);
    for (let s = 10 + R() * 15; s < L - 10; s += 16 + R() * 22) {
      if (parking.filter((p) => p.kind === 'car').length >= 70) break;
      const { pt, dir } = pointAlong(r.pts, s);
      const side = R() < 0.5 ? 1 : -1;
      const off = Math.max(1.2, r.w / 2 - 1.2) * side;
      const c: V2 = [pt[0] - dir[1] * off, pt[1] + dir[0] * off];
      if (nearJunction(c, 12) || !clear(c, 7) || !carOk(c, dir, 1)) continue;
      const heading = Math.atan2(-dir[0] * side, -dir[1] * side);
      parking.push({ pos: rv(c), heading: r1(heading * 100) / 100, kind: 'car' });
    }
  }
  // P-pladser (overflade)
  let lotCars = 0;
  for (const a of areas.filter((x) => x.kind === 'parking').sort(() => R() - 0.5)) {
    if (lotCars >= 22) break;
    const obb = minAreaRect(a.outer);
    if (obb.halfWid < 3) continue;
    const u = obb.axis, v: V2 = [-u[1], u[0]];
    let placed = 0;
    for (let i = -obb.halfLen + 2; i < obb.halfLen - 2 && placed < 6; i += 3) {
      for (let j = -obb.halfWid + 3; j < obb.halfWid - 2 && placed < 6; j += 6) {
        if (R() < 0.45) continue;
        const c: V2 = [obb.center[0] + u[0] * i + v[0] * j, obb.center[1] + u[1] * i + v[1] * j];
        if (!pointInPolygon(c, a.outer) || !clear(c, 3.2) || !carOk(c, v, 1)) continue;
        parking.push({ pos: rv(c), heading: r1(Math.atan2(-v[0], -v[1]) * 100) / 100, kind: 'car' });
        placed++;
        lotCars++;
      }
    }
  }
  // Cykler ved barer, pladser og banegården; ladcykler ved pladser
  const bikeAt = (p: V2, kind: 'bike' | 'cargo', n: number, spread: number) => {
    let placed = 0;
    for (let tries = 0; tries < n * 8 && placed < n; tries++) {
      const ang = R() * Math.PI * 2, rr = 2 + R() * spread;
      const c: V2 = [p[0] + Math.cos(ang) * rr, p[1] + Math.sin(ang) * rr];
      if (insideBuilding(c, 0.8) || inWater(c, 1) || onCarRoad(c, 0.5) || !clear(c, kind === 'cargo' ? 3 : 1.6) || !inBounds(c, -5)) continue;
      parking.push({ pos: rv(c), heading: r1(R() * Math.PI * 2), kind });
      placed++;
    }
  };
  bars.forEach((b, i) => bikeAt(b.pos, 'bike', i % 2 === 0 ? 2 : 1, 5));
  (Object.values(squares) as V2[]).forEach((s) => bikeAt(s, 'bike', 4, 12));
  bikeAt(squares.banegaardspladsen, 'bike', 6, 14);
  (Object.values(squares) as V2[]).forEach((s) => bikeAt(s, 'cargo', 1, 16));
  [bars[3], bars[9], bars[15], bars[21]].filter(Boolean).forEach((b) => bikeAt(b.pos, 'cargo', 1, 8));
}

// ---------------------------------------------------------------- platforme (let platforming)
const platforms: PlatformSite[] = [];
{
  const R = rng(7);
  const far = (p: V2, d: number) => !platforms.some((s) => dist(s.pos, p) < d) && !bars.some((b) => dist(b.pos, p) < 8);
  const stripClear = (p: V2, u: V2, n: V2, halfL: number, depth: number) => {
    for (let a = -halfL; a <= halfL; a += 1) for (let d = 0.6; d <= depth; d += 0.8) {
      const q: V2 = [p[0] + u[0] * a + n[0] * d, p[1] + u[1] * a + n[1] * d];
      if (insideBuilding(q) || inWater(q, 1) || onCarRoad(q, 0.5) || !inBounds(q, -10)) return false;
    }
    return true;
  };
  // Facader ud mod gågader: stilladser og halvtage
  const facadeCands: { pos: V2; heading: number; len: number }[] = [];
  for (const b of buildings) {
    if (b.landmark || b.h < 8) continue;
    for (let i = 0; i < b.outer.length; i++) {
      const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length];
      const L = dist(p, q);
      if (L < 10) continue;
      const u: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      const n: V2 = [u[1], -u[0]]; // udadvendt normal for positiv vikling
      const mid: V2 = [(p[0] + q[0]) / 2 + n[0] * 0.05, (p[1] + q[1]) / 2 + n[1] * 0.05];
      if (!nearRoadKind(mid, ['pedestrian', 'footway'], 5)) continue;
      if (!stripClear(mid, u, n, 4.5, 3)) continue;
      facadeCands.push({ pos: mid, heading: Math.atan2(-n[0], -n[1]), len: L });
    }
  }
  facadeCands.sort(() => R() - 0.5);
  let nScaffold = 0, nAwning = 0;
  for (const c of facadeCands) {
    if (!far(c.pos, 110)) continue;
    if (nScaffold < 5) { platforms.push({ kind: 'scaffold', pos: rv(c.pos), heading: r1(c.heading * 100) / 100 }); nScaffold++; }
    else if (nAwning < 4) { platforms.push({ kind: 'awning', pos: rv(c.pos), heading: r1(c.heading * 100) / 100 }); nAwning++; }
    if (nScaffold >= 5 && nAwning >= 4) break;
  }
  // Containere på åbne pladser
  const openCands: V2[] = [];
  for (const a of areas.filter((x) => x.kind === 'square' || x.kind === 'parking')) {
    const bb = bbox(a.outer);
    for (let t = 0; t < 30; t++) {
      const p: V2 = [bb.minX + R() * (bb.maxX - bb.minX), bb.minZ + R() * (bb.maxZ - bb.minZ)];
      if (!pointInPolygon(p, a.outer)) continue;
      if (insideBuilding(p, 7) || inWater(p, 4) || onCarRoad(p, 3) || !inBounds(p, -15)) continue;
      openCands.push(p);
    }
  }
  openCands.sort(() => R() - 0.5);
  let nCont = 0;
  for (const p of openCands) {
    if (nCont >= 4 || !far(p, 120)) continue;
    platforms.push({ kind: 'container', pos: rv(p), heading: r1(R() * Math.PI) });
    nCont++;
  }
}

// ---------------------------------------------------------------- fadølsvogne: ruter ad gågader
const cartRoutes: V2[][] = [];
{
  // Alle gangbare kanter, men gågader er meget billigere, så ruten holder sig til dem hvor muligt.
  const pedNav = new NavIndex(nav, edgeKinds.map((k) => (k === 'pedestrian' ? 1 : k === 'footway' || k === 'path' ? 2.5 : 6)));
  const ends: [V2, V2][] = [
    [project(56.15105, 10.20480), project(56.15700, 10.20930)], // Ryesgade → Strøget → Store Torv
    [project(56.15590, 10.20420), project(56.15660, 10.21250)], // Åboulevarden
    [project(56.15720, 10.20880), project(56.16030, 10.20690)], // Store Torv → Latinerkvarteret
  ];
  for (const [a, b] of ends) {
    const path = pedNav.path(pedNav.nearest(a), pedNav.nearest(b), 60000);
    if (path && path.length > 3) cartRoutes.push(path.map((i) => navNodes[i]));
  }
}

// ---------------------------------------------------------------- output
const stats: Record<string, number> = {
  buildings: buildings.length,
  canopies: canopies.length,
  roads: roads.length,
  areas: areas.length,
  trees: trees.length,
  bars: bars.length,
  cars: parking.filter((p) => p.kind === 'car').length,
  bikes: parking.filter((p) => p.kind === 'bike').length,
  cargo: parking.filter((p) => p.kind === 'cargo').length,
  platforms: platforms.length,
  navNodes: navNodes.length,
  navEdges: navEdges.length,
  cartRoutes: cartRoutes.length,
};
for (const s of ['osm-height', 'osm-levels', 'neighbors', 'default', 'landmark'] as HeightSource[])
  stats['height_' + s] = buildings.filter((b) => b.heightSource === s).length;

const out: CityData = {
  version: 1,
  attribution: 'Kortdata © OpenStreetMap contributors (ODbL)',
  bounds: { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) },
  buildings: buildings.map((b) => ({
    id: b.id, outer: b.outer.map(rv), holes: b.holes.map((h) => h.map(rv)), h: r1(b.h), minH: r1(b.minH),
    roof: b.roof, roofH: r1(b.roofH), color: b.color, roofColor: b.roofColor, kind: b.kind, shop: b.shop,
    ...(b.landmark ? { landmark: b.landmark } : {}), heightSource: b.heightSource,
  })),
  canopies,
  roads,
  areas,
  rails,
  trees,
  bars,
  parking,
  platforms,
  nav,
  squares,
  policeStation,
  spawn: { pos: spawn.pos, heading: r1(spawn.heading * 100) / 100 },
  cartRoutes: cartRoutes.map((r) => r.map(rv)),
  parkingHelix,
  skybridge,
  sallingRoof,
  stats,
};
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/city.json', JSON.stringify(out));
console.log(JSON.stringify(stats, null, 1));
console.log('squares', squares, 'police', policeStation);
console.log('helix', parkingHelix, 'skybridge', skybridge);
