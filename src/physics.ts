// Tynd indpakning af Rapier: statiske kollidere, kinematiske figurstyringer og stråle-forespørgsler.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Kollisionsgrupper (bitmasker). */
export const G = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  VEHICLE: 0x0004,
  NPC: 0x0008,
  PROP: 0x0010,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export interface RayHit {
  toi: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  collider: RAPIER.Collider;
}

const BATCH_TILE = 160;

/**
 * Statiske kasser og cylindre samles i trimesh-fliser á 160 m. Tusindvis af små primitive
 * kollidere (træer, lygtepæle, rækværk …) koster ellers ~1 µs stykket i hvert fysiktrin.
 */
class StaticBatch {
  private tiles = new Map<string, { v: number[]; i: number[] }>();
  private tile(x: number, z: number) {
    const k = `${Math.floor(x / BATCH_TILE)},${Math.floor(z / BATCH_TILE)}`;
    let t = this.tiles.get(k);
    if (!t) this.tiles.set(k, (t = { v: [], i: [] }));
    return t;
  }
  /** Tilføj et konvekst legeme givet ved hjørner og flader (lokale indeks). */
  add(cx: number, cz: number, verts: number[][], faces: number[][]) {
    const t = this.tile(cx, cz);
    const base = t.v.length / 3;
    for (const v of verts) t.v.push(v[0], v[1], v[2]);
    for (const f of faces) for (let k = 1; k < f.length - 1; k++) t.i.push(base + f[0], base + f[k], base + f[k + 1]);
  }
  flush(world: RAPIER.World, body: RAPIER.RigidBody): number {
    let n = 0;
    for (const t of this.tiles.values()) {
      if (!t.i.length) continue;
      const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(t.v), new Uint32Array(t.i)).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.7);
      world.createCollider(desc, body);
      n++;
    }
    this.tiles.clear();
    return n;
  }
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly staticBody: RAPIER.RigidBody;
  private batch = new StaticBatch();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  static async init(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array, group: number = G.STATIC): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(group, 0xffff)).setFriction(0.6);
    return this.world.createCollider(desc, this.staticBody);
  }

  /** Statisk kasse (samles i trimesh-fliser, se flushStatic). */
  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, pitch = 0) {
    const q = quatYawPitch(yaw, pitch);
    const verts: number[][] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const [x, y, z] = rotate(q, sx * hx, sy * hy, sz * hz);
      verts.push([cx + x, cy + y, cz + z]);
    }
    // hjørneindeks: (sx,sy,sz) → 4*(sx>0)+2*(sy>0)+(sz>0)
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    this.batch.add(cx, cz, verts, faces);
  }

  /** Statisk lodret cylinder (8-kantet prisme i batchen). */
  addCylinder(cx: number, cy: number, cz: number, halfH: number, r: number) {
    const n = 8;
    const verts: number[][] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      verts.push([cx + Math.cos(a) * r, cy - halfH, cz + Math.sin(a) * r]);
      verts.push([cx + Math.cos(a) * r, cy + halfH, cz + Math.sin(a) * r]);
    }
    const faces: number[][] = [];
    for (let k = 0; k < n; k++) {
      const a = k * 2, b = ((k + 1) % n) * 2;
      faces.push([a, a + 1, b + 1, b]);
    }
    faces.push(Array.from({ length: n }, (_, k) => k * 2));
    faces.push(Array.from({ length: n }, (_, k) => (n - 1 - k) * 2 + 1));
    this.batch.add(cx, cz, verts, faces);
  }

  /** Opret de samlede statiske trimesh-kollidere. Kaldes når byen er bygget. */
  flushStatic(): number {
    return this.batch.flush(this.world, this.staticBody);
  }

  makeController(offset = 0.02): RAPIER.KinematicCharacterController {
    const c = this.world.createCharacterController(offset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    return c;
  }

  /** Stråle mod statisk geometri (+ evt. andre grupper). */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, filter: number = G.STATIC, exclude?: RAPIER.Collider): RayHit | null {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, groups(0xffff, filter), exclude);
    if (!hit) return null;
    return {
      toi: hit.timeOfImpact,
      point: { x: ox + dx * hit.timeOfImpact, y: oy + dy * hit.timeOfImpact, z: oz + dz * hit.timeOfImpact },
      normal: hit.normal,
      collider: hit.collider,
    };
  }

  /** Fri sigtelinje mellem to punkter (kun statisk geometri blokerer). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    return this.ray(ax, ay, az, dx / L, dy / L, dz / L, L - 0.05) === null;
  }

  /** Højeste gulv under et punkt (til at finde jorden/tage). */
  groundY(x: number, fromY: number, z: number, maxDrop = 60): number | null {
    const h = this.ray(x, fromY, z, 0, -1, 0, maxDrop, G.STATIC);
    return h ? h.point.y : null;
  }

  step(dt: number) {
    this.world.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.world.step();
  }
}

function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number): [number, number, number] {
  // v' = q v q*
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ];
}

export function quatYawPitch(yaw: number, pitch = 0, roll = 0): { x: number; y: number; z: number; w: number } {
  // Rækkefølge YXZ (som Three.js' Euler 'YXZ')
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return {
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
    w: cy * cp * cr + sy * sp * sr,
  };
}
