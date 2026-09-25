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

export class Physics {
  readonly world: RAPIER.World;
  private readonly staticBody: RAPIER.RigidBody;

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

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, pitch = 0, group: number = G.STATIC): RAPIER.Collider {
    const q = quatYawPitch(yaw, pitch);
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRotation(q)
      .setCollisionGroups(groups(group, 0xffff))
      .setFriction(0.7);
    return this.world.createCollider(desc, this.staticBody);
  }

  addCylinder(cx: number, cy: number, cz: number, halfH: number, r: number, group: number = G.STATIC): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz).setCollisionGroups(groups(group, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
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
