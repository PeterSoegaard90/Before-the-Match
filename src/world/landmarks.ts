// Håndlavede landemærker oven på de genererede bygninger:
// Domkirkens tårn, ARoS' regnbue, Rådhustårnet, Aarhus Teaters gavle/kuppel,
// Sallings tagterrasse, parkeringshusets spiralrampe og gangbroen.
import * as THREE from 'three';
import type { Building, CityData, LandmarkId, V2 } from '../shared/cityTypes.ts';
import { centroid, dist, minAreaRect } from '../shared/geom.ts';
import type { Physics } from '../physics.ts';
import { GeoBuilder, color } from './geo.ts';
import { FACADE, facadeCode, makeFacadeMaterial, makeFlatMaterial } from './materials.ts';

export interface LandmarkResult {
  group: THREE.Group;
  /** Punkter hvor der kan stå parkerede biler på parkeringshusets tag. */
  roofParking: { pos: V2; y: number; heading: number }[];
  helixEntrance: THREE.Vector3;
}

export function buildLandmarks(city: CityData, physics: Physics): LandmarkResult {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const facade = new GeoBuilder({ facade: true }); // tårne med vinduer
  const flat = new GeoBuilder(); // alt andet
  const byId = (id: LandmarkId) => city.buildings.filter((b) => b.landmark === id);
  const one = (id: LandmarkId) => byId(id).reduce((a, b) => (area(a) > area(b) ? a : b));

  // ------------------------------------------------------------ Domkirken
  {
    const b = one('domkirken');
    const o = minAreaRect(b.outer);
    const sgn = o.axis[0] < 0 ? 1 : -1; // vestenden
    const t: V2 = [o.center[0] + o.axis[0] * sgn * (o.halfLen - 7.5), o.center[1] + o.axis[1] * sgn * (o.halfLen - 7.5)];
    const yaw = Math.atan2(o.axis[0], o.axis[1]);
    towerWalls(facade, t, 6.5, 6.5, yaw, 0, 56, '#b0543d', FACADE.CHURCH, 3.2);
    flat.box(t[0], 56.4, t[1], 7, 0.4, 7, color('#9a4a36'), yaw);
    const spire = new THREE.ConeGeometry(6.6, 38, 4, 1).rotateY(Math.PI / 4);
    flat.addGeometry(spire, new THREE.Matrix4().makeRotationY(yaw).setPosition(t[0], 56.8 + 19, t[1]), color('#5f9f86'));
    const ball = new THREE.SphereGeometry(0.6, 8, 6);
    flat.addGeometry(ball, new THREE.Matrix4().setPosition(t[0], 95.4, t[1]), color('#d8b04a'));
    // Små hjørnespir
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cx = t[0] + (Math.cos(yaw) * dx + Math.sin(yaw) * dz) * 6.2;
      const cz = t[1] + (-Math.sin(yaw) * dx + Math.cos(yaw) * dz) * 6.2;
      flat.addGeometry(new THREE.ConeGeometry(0.8, 5, 4), new THREE.Matrix4().setPosition(cx, 59.3, cz), color('#5f9f86'));
    }
    physics.addBox(t[0], 28, t[1], 6.5, 28, 6.5, yaw);
  }

  // ------------------------------------------------------------ ARoS og "Your rainbow panorama"
  {
    const b = one('aros');
    const c = centroid(b.outer);
    const o = minAreaRect(b.outer);
    const R = Math.min(24, o.halfWid * 0.92);
    const y0 = b.h + 3.2;
    const ring = rainbowRing(R, 3.4);
    ring.position.set(c[0], y0, c[1]);
    group.add(ring);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      flat.box(c[0] + Math.cos(a) * R, b.h + 1.6, c[1] + Math.sin(a) * R, 0.12, 1.6, 0.12, color('#e8e8e8'));
    }
  }

  // ------------------------------------------------------------ Rådhuset: tårn med ur
  {
    const b = one('raadhus');
    const o = minAreaRect(b.outer);
    const sq = city.squares.raadhuspladsen;
    const e1: V2 = [o.center[0] + o.axis[0] * o.halfLen, o.center[1] + o.axis[1] * o.halfLen];
    const e2: V2 = [o.center[0] - o.axis[0] * o.halfLen, o.center[1] - o.axis[1] * o.halfLen];
    const sgn = dist(e1, sq) < dist(e2, sq) ? 1 : -1;
    const t: V2 = [o.center[0] + o.axis[0] * sgn * (o.halfLen - 6), o.center[1] + o.axis[1] * sgn * (o.halfLen - 6)];
    const yaw = Math.atan2(o.axis[0], o.axis[1]);
    towerWalls(facade, t, 4.6, 3.8, yaw, 0, 49, '#dcd9d0', FACADE.TOWNHALL, 2.2);
    // Åben top: 4 hjørnestolper + tag + mast
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cx = t[0] + (Math.cos(yaw) * dx * 4.2 + Math.sin(yaw) * dz * 3.4);
      const cz = t[1] + (-Math.sin(yaw) * dx * 4.2 + Math.cos(yaw) * dz * 3.4);
      flat.box(cx, 53, cz, 0.35, 4, 0.35, color('#d0cdc4'), yaw);
    }
    flat.box(t[0], 57.3, t[1], 4.8, 0.3, 4, color('#c9c6bd'), yaw);
    flat.box(t[0], 59.8, t[1], 0.08, 2.4, 0.08, color('#555555'));
    // Urskiver på alle fire sider
    const clockTex = clockTexture();
    const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.6 });
    const faces: [number, number, number][] = [[0, 0, 3.85], [0, 0, -3.85], [4.65, 0, 0], [-4.65, 0, 0]];
    for (const [lx, , lz] of faces) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), clockMat);
      const wx = t[0] + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
      const wz = t[1] - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
      m.position.set(wx, 44, wz);
      m.lookAt(wx + (wx - t[0]), 44, wz + (wz - t[1]));
      group.add(m);
    }
    physics.addBox(t[0], 24.5, t[1], 4.6, 24.5, 3.8, yaw);
  }

  // ------------------------------------------------------------ Aarhus Teater: gavle + kuppel
  {
    const b = one('teater');
    const o = minAreaRect(b.outer);
    const sq = city.squares.bispetorv;
    // facaden ud mod Bispetorvet
    let best = { d: Infinity, i: 0 };
    b.outer.forEach((p, i) => {
      const q = b.outer[(i + 1) % b.outer.length];
      const L = dist(p, q);
      const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (L > 12 && dist(m, sq) < best.d) best = { d: dist(m, sq), i };
    });
    const p = b.outer[best.i], q = b.outer[(best.i + 1) % b.outer.length];
    const L = dist(p, q);
    const u: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const n: V2 = [u[1], -u[0]];
    const brick = color('#a5503a'), trim = color('#efe6d2');
    for (const t of [0.2, 0.5, 0.8]) {
      const c: V2 = [p[0] + (q[0] - p[0]) * t + n[0] * 0.3, p[1] + (q[1] - p[1]) * t + n[1] * 0.3];
      const w = t === 0.5 ? 5 : 3.4, hgt = t === 0.5 ? 8 : 5.5;
      gable(flat, c, u, n, b.h, w, hgt, brick, trim);
    }
    const c = o.center;
    const drum = new THREE.CylinderGeometry(3, 3, 3, 12);
    flat.addGeometry(drum, new THREE.Matrix4().setPosition(c[0], b.h + 5.5, c[1]), color('#efe6d2'));
    const dome = new THREE.SphereGeometry(3.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    flat.addGeometry(dome, new THREE.Matrix4().setPosition(c[0], b.h + 7, c[1]), color('#5f9f86'));
    flat.addGeometry(new THREE.ConeGeometry(0.4, 2.5, 6), new THREE.Matrix4().setPosition(c[0], b.h + 11.4, c[1]), color('#d8b04a'));
  }

  // ------------------------------------------------------------ Sallings tagterrasse
  const sallingB = one('salling');
  const roofY = city.sallingRoof.y;
  const sb = city.skybridge;
  {
    const deck = new GeoBuilder();
    const inner = shrink(sallingB.outer, 1.2);
    deck.polygon(inner, [], roofY + 0.06, color('#a57a4d'), true);
    addMesh(group, deck, makeFlatMaterial({ layer: 2, roughness: 0.8 }), false);
    // Glasrækværk (kolliderer) med åbning mod gangbroen
    railing(flat, physics, sallingB.outer, roofY, 1.1, color('#bfe3ef'), (m) => dist(m, sb.a) < 5, 0.3);
    // Parasoller og liggestole
    const c = city.sallingRoof.center;
    const o = minAreaRect(sallingB.outer);
    const cols = ['#e63946', '#f1c40f', '#2a9d8f', '#ffffff', '#e76f51', '#457b9d'];
    for (let k = 0; k < 6; k++) {
      const u = ((k % 3) - 1) * o.halfLen * 0.55, v = (k < 3 ? -1 : 1) * o.halfWid * 0.45;
      const x = c[0] + o.axis[0] * u - o.axis[1] * v, z = c[1] + o.axis[1] * u + o.axis[0] * v;
      flat.box(x, roofY + 1.2, z, 0.05, 1.2, 0.05, color('#dddddd'));
      flat.addGeometry(new THREE.ConeGeometry(1.6, 0.7, 8), new THREE.Matrix4().setPosition(x, roofY + 2.5, z), color(cols[k]));
      for (const s of [-1, 1]) {
        const lx = x + o.axis[0] * s * 1.2, lz = z + o.axis[1] * s * 1.2;
        flat.box(lx, roofY + 0.3, lz, 0.35, 0.12, 0.9, color('#f4efe6'), Math.atan2(o.axis[1], -o.axis[0]));
      }
      physics.addBox(x, roofY + 1.2, z, 0.08, 1.2, 0.08);
    }
    // Barkiosk
    const kx = c[0] + o.axis[0] * o.halfLen * 0.1 + o.axis[1] * 4, kz = c[1] + o.axis[1] * o.halfLen * 0.1 - o.axis[0] * 4;
    const kyaw = Math.atan2(o.axis[0], o.axis[1]);
    flat.box(kx, roofY + 0.6, kz, 2.2, 0.6, 0.8, color('#6b4a2e'), kyaw);
    flat.box(kx, roofY + 1.25, kz, 2.4, 0.05, 1.0, color('#d9c7a5'), kyaw);
    flat.box(kx, roofY + 2.8, kz, 2.6, 0.12, 1.4, color('#c8102e'), kyaw);
    for (const s of [-1, 1]) flat.box(kx + Math.cos(kyaw) * s * 2.3, roofY + 1.9, kz - Math.sin(kyaw) * s * 2.3, 0.08, 0.9, 0.08, color('#444'));
    physics.addBox(kx, roofY + 0.6, kz, 2.2, 0.6, 0.8, kyaw);
  }

  // ------------------------------------------------------------ Parkeringshuset: rækværk, striber, spiralrampe
  const H = city.parkingHelix;
  const roofParking: LandmarkResult['roofParking'] = [];
  {
    const parts = byId('parkeringshus');
    const deckMarks = new GeoBuilder();
    for (const b of parts) {
      railing(flat, physics, b.outer, roofY, 1.0, color('#a9a69f'), (m) => dist(m, sb.b) < 5 || dist(m, H.center) < H.rOuter + 5, 0.25);
      const o = minAreaRect(b.outer);
      // P-striber + et par biler på taget
      for (let u = -o.halfLen + 3; u < o.halfLen - 3; u += 2.6) {
        for (const v of [-o.halfWid * 0.55, o.halfWid * 0.55]) {
          const x = o.center[0] + o.axis[0] * u - o.axis[1] * v, z = o.center[1] + o.axis[1] * u + o.axis[0] * v;
          if (!inside(b.outer, [x, z], 3)) continue;
          deckMarks.box(x, roofY + 0.02, z, 2.4, 0.01, 0.06, color('#f1f0ea'), Math.atan2(o.axis[0], o.axis[1]) + Math.PI / 2);
          if (roofParking.length < 6 && (Math.round(u * 10) % 7 === 0) && dist([x, z], H.center) > H.rOuter + 8 && dist([x, z], sb.b) > 8) {
            const px = x + o.axis[0] * 1.3, pz = z + o.axis[1] * 1.3;
            roofParking.push({ pos: [px, pz], y: roofY, heading: Math.atan2(o.axis[1], -o.axis[0]) + (v > 0 ? Math.PI : 0) });
          }
        }
      }
    }
    addMesh(group, deckMarks, makeFlatMaterial({ layer: 3 }), false);
  }
  // Spiralrampe
  const concrete = color('#a8a59e'), curb = color('#d0ccc2');
  const thetaEnd = H.endAngle;
  const thetaStart = thetaEnd - H.turns * Math.PI * 2;
  const segs = Math.round(H.turns * 40);
  const rMid = (H.rInner + H.rOuter) / 2;
  const yAt = (th: number) => (H.top * (th - thetaStart)) / (thetaEnd - thetaStart);
  // Rampen som ét sammenhængende bånd (glat trimesh – ingen kanter mellem segmenter)
  const ramp = new GeoBuilder();
  const th = 0.3;
  const P = (t: number, r: number, y: number): [number, number, number] => [H.center[0] + Math.cos(t) * r, y, H.center[1] + Math.sin(t) * r];
  for (let i = 0; i < segs; i++) {
    const t0 = thetaStart + ((thetaEnd - thetaStart) * i) / segs;
    const t1 = thetaStart + ((thetaEnd - thetaStart) * (i + 1)) / segs;
    const y0 = yAt(t0), y1 = yAt(t1);
    const a = P(t0, H.rInner, y0), b = P(t0, H.rOuter, y0), c = P(t1, H.rOuter, y1), d = P(t1, H.rInner, y1);
    const quad = (q: [number, number, number][], col: THREE.Color) => {
      const n = new THREE.Vector3().crossVectors(
        new THREE.Vector3(q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]),
        new THREE.Vector3(q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]),
      ).normalize();
      const ids = q.map((v) => ramp.v(v[0], v[1], v[2], n.x, n.y, n.z, col));
      ramp.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    };
    const down = (v: [number, number, number]): [number, number, number] => [v[0], v[1] - th, v[2]];
    quad([a, d, c, b], concrete); // top (op)
    quad([down(a), down(b), down(c), down(d)], concrete); // bund
    quad([b, c, down(c), down(b)], curb); // yderkant
    quad([a, down(a), down(d), d], curb); // inderkant
    // Ydermur (åbning ved ind- og udkørsel)
    const tm = (t0 + t1) / 2;
    if (tm - thetaStart > 0.5 && thetaEnd - tm > 0.6) {
      const wi0 = P(t0, H.rOuter + 0.05, y0), wi1 = P(t1, H.rOuter + 0.05, y1);
      const wo0 = P(t0, H.rOuter + 0.3, y0), wo1 = P(t1, H.rOuter + 0.3, y1);
      const up = (v: [number, number, number]): [number, number, number] => [v[0], v[1] + 1.1, v[2]];
      quad([wi0, up(wi0), up(wi1), wi1], curb);
      quad([wo0, wo1, up(wo1), up(wo0)], curb);
      quad([up(wi0), up(wo0), up(wo1), up(wi1)], curb);
    }
  }
  const rampData = ramp.colliderData();
  physics.addTrimesh(rampData.vertices, rampData.indices);
  addMesh(group, ramp, makeFlatMaterial({ roughness: 0.8, side: THREE.DoubleSide }), true);
  // Kerne + søjler
  flat.addGeometry(new THREE.CylinderGeometry(H.rInner - 0.1, H.rInner - 0.1, H.top + 1.2, 16), new THREE.Matrix4().setPosition(H.center[0], (H.top + 1.2) / 2, H.center[1]), color('#bdb9b0'));
  physics.addCylinder(H.center[0], (H.top + 1.2) / 2, H.center[1], (H.top + 1.2) / 2, H.rInner - 0.1);
  // Landingsplads: fortsætter fra rampens ende (samme højde) og ud over parkeringsdækket
  {
    const land = new GeoBuilder();
    const sector: V2[] = [];
    const span = 1.0;
    for (let k = 0; k <= 10; k++) {
      const t = thetaEnd + (span * k) / 10;
      sector.push([H.center[0] + Math.cos(t) * H.rInner, H.center[1] + Math.sin(t) * H.rInner]);
    }
    for (let k = 10; k >= 0; k--) {
      const t = thetaEnd + (span * k) / 10;
      sector.push([H.center[0] + Math.cos(t) * (H.rOuter + 5), H.center[1] + Math.sin(t) * (H.rOuter + 5)]);
    }
    const ring = signed(sector) > 0 ? sector : sector.slice().reverse();
    land.polygon(ring, [], H.top, concrete, true);
    land.polygon(ring, [], H.top - 0.3, concrete, false);
    for (let i = 0; i < ring.length; i++) land.wall(ring[i], ring[(i + 1) % ring.length], H.top - 0.3, H.top, H.top - 0.3, H.top, curb);
    const ld = land.colliderData();
    physics.addTrimesh(ld.vertices, ld.indices);
    addMesh(group, land, makeFlatMaterial({ roughness: 0.8 }), true);
  }
  const sx = Math.cos(thetaStart), sz = Math.sin(thetaStart);
  const helixEntrance = new THREE.Vector3(H.center[0] + sx * rMid - Math.cos(thetaStart + Math.PI / 2) * 6, 0, H.center[1] + sz * rMid - Math.sin(thetaStart + Math.PI / 2) * 6);

  // ------------------------------------------------------------ Gangbro
  {
    const dx = sb.b[0] - sb.a[0], dz = sb.b[1] - sb.a[1];
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const cx = (sb.a[0] + sb.b[0]) / 2, cz = (sb.a[1] + sb.b[1]) / 2;
    const yaw = Math.atan2(ux, uz);
    const hl = L / 2 + 1.5;
    flat.box(cx, sb.y - 0.25, cz, sb.w / 2, 0.25, hl, color('#8f9296'), yaw);
    physics.addBox(cx, sb.y - 0.25, cz, sb.w / 2, 0.25, hl, yaw);
    for (const s of [-1, 1]) {
      const rx = cx + Math.cos(yaw) * s * (sb.w / 2), rz = cz - Math.sin(yaw) * s * (sb.w / 2);
      flat.box(rx, sb.y + 0.55, rz, 0.06, 0.55, hl, color('#bfe3ef'), yaw);
      physics.addBox(rx, sb.y + 0.55, rz, 0.06, 0.55, hl, yaw);
    }
  }

  const fm = new THREE.Mesh(facade.build(), makeFacadeMaterial());
  fm.castShadow = fm.receiveShadow = true;
  group.add(fm);
  addMesh(group, flat, makeFlatMaterial({ roughness: 0.75 }), true);
  return { group, roofParking, helixEntrance };
}

// ---------------------------------------------------------------- hjælpere
function area(b: Building) {
  let a = 0;
  for (let i = 0; i < b.outer.length; i++) {
    const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

function towerWalls(gb: GeoBuilder, c: V2, hx: number, hz: number, yaw: number, y0: number, y1: number, col: string, style: number, bay: number) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (x: number, z: number): V2 => [c[0] + x * cs + z * sn, c[1] - x * sn + z * cs];
  // mod uret (positiv vikling i x/z) set som i buildings.ts
  const corners: V2[] = [P(-hx, -hz), P(-hx, hz), P(hx, hz), P(hx, -hz)];
  const pos = signed(corners) > 0 ? corners : corners.slice().reverse();
  const cc = color(col);
  const code = facadeCode(style, 0.4);
  for (let i = 0; i < 4; i++) {
    const p = pos[i], q = pos[(i + 1) % 4];
    const n = Math.max(1, Math.round(dist(p, q) / bay));
    gb.wall(p, q, y0, y1, y0, y1, cc, { u0: 0, u1: n, style: code });
  }
}

function signed(poly: V2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function gable(gb: GeoBuilder, c: V2, u: V2, n: V2, y: number, w: number, h: number, brick: THREE.Color, trim: THREE.Color) {
  // Trekantet gavl (prisme) stående på tagfoden
  const d = 0.8;
  const pts = [
    [c[0] - u[0] * w, c[1] - u[1] * w],
    [c[0] + u[0] * w, c[1] + u[1] * w],
  ];
  const top: [number, number, number] = [c[0], y + h, c[1]];
  for (const off of [0, -d]) {
    const a = gb.v(pts[0][0] + n[0] * off, y, pts[0][1] + n[1] * off, n[0], 0, n[1], brick);
    const b = gb.v(pts[1][0] + n[0] * off, y, pts[1][1] + n[1] * off, n[0], 0, n[1], brick);
    const t = gb.v(top[0] + n[0] * off, top[1], top[2] + n[1] * off, n[0], 0, n[1], brick);
    if (off === 0) gb.tri(a, t, b);
    else gb.tri(a, b, t);
  }
  // Skrå sider
  for (const s of [0, 1]) {
    const p = pts[s];
    const a = gb.v(p[0], y, p[1], 0, 1, 0, trim);
    const b = gb.v(top[0], top[1], top[2], 0, 1, 0, trim);
    const b2 = gb.v(top[0] - n[0] * d, top[1], top[2] - n[1] * d, 0, 1, 0, trim);
    const a2 = gb.v(p[0] - n[0] * d, y, p[1] - n[1] * d, 0, 1, 0, trim);
    gb.idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
  }
  gb.box(c[0] + n[0] * 0.05, y + h * 0.45, c[1] + n[1] * 0.05, 0.6, 0.9, 0.05, color('#26303a'), Math.atan2(n[0], n[1]));
}

function railing(gb: GeoBuilder, physics: Physics, ring: V2[], y: number, h: number, c: THREE.Color, skip: (mid: V2) => boolean, thick: number) {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const L = dist(p, q);
    if (L < 0.3) continue;
    const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L;
    const nx = uz, nz = -ux;
    const steps = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k < steps; k++) {
      const a = k / steps, b = (k + 1) / steps;
      const m: V2 = [p[0] + (q[0] - p[0]) * (a + b) / 2 - nx * 0.3, p[1] + (q[1] - p[1]) * (a + b) / 2 - nz * 0.3];
      if (skip(m)) continue;
      const hl = (L * (b - a)) / 2;
      const yaw = Math.atan2(ux, uz);
      gb.box(m[0], y + h / 2, m[1], thick / 2, h / 2, hl, c, yaw);
      physics.addBox(m[0], y + h / 2, m[1], thick / 2, h / 2, hl, yaw);
    }
  }
}

function shrink(poly: V2[], d: number): V2[] {
  const c = centroid(poly);
  return poly.map((p) => {
    const dx = p[0] - c[0], dz = p[1] - c[1];
    const L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dx / L) * d, p[1] - (dz / L) * d] as V2;
  });
}

function inside(poly: V2[], p: V2, margin: number): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
  }
  if (!ins) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
    if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t) < margin) return false;
  }
  return true;
}

function rainbowRing(R: number, h: number): THREE.Mesh {
  const seg = 96, w = 1.4;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    c.setHSL(i / seg, 0.85, 0.58);
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const [r, y] of [[R + w / 2, 0], [R + w / 2, h], [R - w / 2, h], [R - w / 2, 0]] as [number, number][]) {
      pos.push(ca * r, y, sa * r);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 4, b = (i + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide, emissive: 0x222222 }));
  m.castShadow = true;
  return m;
}

function clockTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f7f4ea';
  g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#222'; g.lineWidth = 8; g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = i % 3 === 0 ? 10 : 5;
    g.beginPath(); g.moveTo(128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100); g.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116); g.stroke();
  }
  // 17:55 – fem minutter i kickoff
  const hand = (a: number, len: number, w: number) => { g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len); g.stroke(); };
  hand(((5 + 55 / 60) / 12) * Math.PI * 2, 62, 10);
  hand((55 / 60) * Math.PI * 2, 96, 6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addMesh(group: THREE.Group, gb: GeoBuilder, mat: THREE.Material, cast: boolean) {
  if (gb.vertexCount === 0) return;
  const mesh = new THREE.Mesh(gb.build(), mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
}
