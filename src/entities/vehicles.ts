// Biler, cykler og ladcykler: low-poly modeller, parkeret (skubbes rundt af fysikken)
// og kørt af spilleren med arcade-styring via Rapiers kinematiske figurstyring.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { VEHICLES, type VehicleSpec } from '../config.ts';
import { G, RAPIER, groups, quatYawPitch, type Physics } from '../physics.ts';
import { GeoBuilder, color } from '../world/geo.ts';
import { makeFlatMaterial } from '../world/materials.ts';

export type VehicleKind = 'car' | 'bike' | 'cargo';

const CAR_COLORS = ['#c0392b', '#2e5c9a', '#f2f2f2', '#222428', '#a7abb0', '#2f7a4a', '#e5b92e', '#7a2e8c', '#d9772b', '#5fa8c8'];
const BIKE_COLORS = ['#1f1f22', '#2e5c9a', '#2f7a4a', '#c0392b', '#e8e2d0', '#6a6f75'];

// ---------------------------------------------------------------- modeller
interface Model {
  geo: THREE.BufferGeometry;
  wheels: { x: number; y: number; z: number; r: number; front: boolean; type: 'car' | 'bike' | 'small' }[];
}

const modelCache = new Map<string, Model>();

function carModel(variant: number, col: string): Model {
  const key = `car${variant}${col}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const gb = new GeoBuilder();
  const body = color(col);
  const glass = color('#1c2a38');
  const dark = color('#26282b');
  const L = variant === 2 ? 2.35 : variant === 1 ? 2.3 : 2.1; // halv længde
  const W = 0.9;
  const beltY = variant === 2 ? 1.25 : 0.98;
  const roofY = variant === 2 ? 2.05 : 1.48;
  // Underkrop (profil ekstruderet på tværs)
  const prof: [number, number][] = variant === 2
    ? [[-L, 0.35], [L, 0.35], [L + 0.05, 0.6], [L - 0.05, 1.05], [L - 0.5, beltY], [-L, beltY], [-L - 0.05, 0.6]]
    : [[-L, 0.35], [L, 0.35], [L + 0.07, 0.58], [L, 0.84], [L - 1.0, beltY], [-L + 0.4, beltY], [-L - 0.05, 0.9], [-L - 0.05, 0.5]];
  extrudeProfile(gb, prof, W, body);
  // Kabine (glas) + tag
  const front = variant === 2 ? L - 0.6 : L - 1.05;
  const back = variant === 2 ? -L + 0.05 : variant === 1 ? -L + 0.75 : -L + 0.35;
  const cab: [number, number][] = [[back, beltY], [front, beltY], [front - (roofY - beltY) * 0.75, roofY], [back + (variant === 1 ? 0.45 : 0.15), roofY]];
  extrudeProfile(gb, cab, W - 0.08, glass);
  // tagplade + stolper
  gb.box(0, roofY + 0.03, (cab[2][0] + cab[3][0]) / 2, W - 0.06, 0.04, (cab[2][0] - cab[3][0]) / 2 + 0.03, body);
  for (const s of [-1, 1]) {
    gb.box(s * (W - 0.05), (beltY + roofY) / 2, (cab[1][0] + cab[2][0]) / 2, 0.035, (roofY - beltY) / 2, 0.06, body);
    gb.box(s * (W - 0.05), (beltY + roofY) / 2, (cab[0][0] + cab[3][0]) / 2, 0.035, (roofY - beltY) / 2, 0.08, body);
    gb.box(s * (W - 0.05), (beltY + roofY) / 2, (front + back) / 2 - 0.1, 0.035, (roofY - beltY) / 2, 0.05, body);
  }
  // Kofangere, lygter, nummerplader
  gb.box(0, 0.45, -L - 0.08, W - 0.02, 0.1, 0.06, dark);
  gb.box(0, 0.45, L + 0.08, W - 0.02, 0.1, 0.06, dark);
  for (const s of [-1, 1]) {
    gb.box(s * (W - 0.22), 0.7, -L - 0.07, 0.16, 0.07, 0.03, color('#fff8d8'));
    gb.box(s * (W - 0.2), 0.75, L + 0.06, 0.14, 0.07, 0.03, color('#c81d1d'));
  }
  gb.box(0, 0.55, -L - 0.12, 0.26, 0.06, 0.01, color('#f4f4f4'));
  gb.box(0, 0.55, L + 0.12, 0.26, 0.06, 0.01, color('#f4f4f4'));
  // hjulkasser (mørke)
  const wz = L - 0.62;
  for (const s of [-1, 1]) for (const z of [-wz, wz]) gb.box(s * (W - 0.02), 0.42, z, 0.02, 0.2, 0.42, dark);
  const m: Model = {
    geo: gb.build(),
    wheels: [-1, 1].flatMap((s) => [-wz, wz].map((z) => ({ x: s * (W - 0.12), y: 0.33, z, r: 0.33, front: z < 0, type: 'car' as const }))),
  };
  modelCache.set(key, m);
  return m;
}

function extrudeProfile(gb: GeoBuilder, prof: [number, number][], halfW: number, c: THREE.Color) {
  // profil i (z, y); ekstruder langs x fra -halfW til +halfW
  const n = prof.length;
  const sides: [number, number][] = [[-halfW, -1], [halfW, 1]];
  for (const [x, nx] of sides) {
    const shape = prof.map(([z, y]) => new THREE.Vector2(z, y));
    const tris = THREE.ShapeUtils.triangulateShape(shape, []);
    const base = gb.vertexCount;
    for (const [z, y] of prof) gb.v(x, y, z, nx, 0, 0, c);
    for (const [a, b, d] of tris) {
      // orienter efter side
      const pa = prof[a], pb = prof[b], pd = prof[d];
      const cr = (pb[0] - pa[0]) * (pd[1] - pa[1]) - (pb[1] - pa[1]) * (pd[0] - pa[0]);
      if ((cr > 0) === (nx > 0)) gb.tri(base + a, base + d, base + b);
      else gb.tri(base + a, base + b, base + d);
    }
  }
  for (let i = 0; i < n; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[(i + 1) % n];
    const dz = z1 - z0, dy = y1 - y0;
    const l = Math.hypot(dz, dy) || 1;
    let ny = -dz / l, nz = dy / l;
    // sørg for udadvendt normal (profilens centrum)
    const cz = prof.reduce((s, p) => s + p[0], 0) / n, cy = prof.reduce((s, p) => s + p[1], 0) / n;
    if ((z0 - cz) * nz + (y0 - cy) * ny < 0) { ny = -ny; nz = -nz; }
    const a = gb.v(-halfW, y0, z0, 0, ny, nz, c), b = gb.v(halfW, y0, z0, 0, ny, nz, c);
    const cc = gb.v(halfW, y1, z1, 0, ny, nz, c), d = gb.v(-halfW, y1, z1, 0, ny, nz, c);
    const t = new THREE.Vector3(halfW * 2, 0, 0).cross(new THREE.Vector3(0, y1 - y0, z1 - z0));
    if (t.y * ny + t.z * nz > 0) gb.quad(a, b, cc, d);
    else gb.quad(a, d, cc, b);
  }
}

function bikeModel(col: string, basket: boolean): Model {
  const key = `bike${col}${basket}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const gb = new GeoBuilder();
  const f = color(col), dark = color('#222'), chrome = color('#b8bcc2');
  const tube = (y0: number, z0: number, y1: number, z1: number, c = f, w = 0.028) => {
    const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, L = Math.hypot(y1 - y0, z1 - z0);
    const g = new THREE.BoxGeometry(w * 2, L, w * 2);
    const m = new THREE.Matrix4().makeRotationX(Math.atan2(z1 - z0, y1 - y0)).setPosition(0, cy, cz);
    gb.addGeometry(g, m, c);
  };
  // stel (front = -z)
  tube(0.34, 0.52, 0.6, 0.05); // bag-gaffel → kranklejet
  tube(0.6, 0.05, 0.92, -0.45); // skrårør
  tube(0.6, 0.05, 0.98, 0.18); // saddelrør
  tube(0.95, 0.15, 0.95, -0.4); // overrør
  tube(0.34, 0.52, 0.95, 0.18); // bagstag
  tube(0.34, -0.55, 1.08, -0.42, chrome); // forgaffel
  gb.box(0, 1.1, -0.42, 0.28, 0.02, 0.02, dark); // styr
  gb.box(0, 1.02, 0.18, 0.08, 0.03, 0.13, dark); // sadel
  gb.box(0, 0.58, 0.52, 0.12, 0.015, 0.2, dark); // bagagebærer
  if (basket) gb.box(0, 0.95, -0.66, 0.17, 0.12, 0.14, color('#8a6440'));
  const m: Model = {
    geo: gb.build(),
    wheels: [
      { x: 0, y: 0.34, z: -0.55, r: 0.34, front: true, type: 'bike' },
      { x: 0, y: 0.34, z: 0.52, r: 0.34, front: false, type: 'bike' },
    ],
  };
  modelCache.set(key, m);
  return m;
}

function cargoModel(col: string): Model {
  const key = `cargo${col}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const gb = new GeoBuilder();
  const wood = color('#a8784a'), f = color(col), dark = color('#222');
  gb.box(0, 0.62, -0.62, 0.42, 0.22, 0.5, wood); // kassen
  gb.box(0, 0.86, -0.62, 0.43, 0.02, 0.51, color('#8a6440'));
  gb.box(0, 0.38, -0.62, 0.44, 0.03, 0.52, dark);
  gb.box(0, 0.62, 0.2, 0.03, 0.03, 0.55, f);
  gb.box(0, 0.8, 0.35, 0.03, 0.22, 0.03, f);
  gb.box(0, 1.03, 0.38, 0.08, 0.03, 0.13, dark);
  gb.box(0, 1.08, -0.02, 0.32, 0.02, 0.02, dark);
  gb.box(0, 0.95, -0.02, 0.025, 0.14, 0.025, f);
  const m: Model = {
    geo: gb.build(),
    wheels: [
      { x: -0.36, y: 0.25, z: -0.62, r: 0.25, front: true, type: 'small' },
      { x: 0.36, y: 0.25, z: -0.62, r: 0.25, front: true, type: 'small' },
      { x: 0, y: 0.34, z: 0.72, r: 0.34, front: false, type: 'bike' },
    ],
  };
  modelCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- hjul (instanced)
class WheelPool {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  alloc(): number {
    const i = this.used++;
    this.mesh.count = this.used;
    return i;
  }
}

// ---------------------------------------------------------------- køretøj
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), tmpE = new THREE.Euler();

export class Vehicle {
  readonly kind: VehicleKind;
  readonly spec: VehicleSpec;
  readonly group = new THREE.Group();
  readonly body: RAPIER_T.RigidBody;
  readonly collider: RAPIER_T.Collider;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  steer = 0;
  pitch = 0;
  roll = 0;
  vy = 0;
  spin = 0;
  driven = false;
  locked: boolean;
  stolen = false;
  lastCrash = 0;
  skid = 0;
  throttle = 0;
  private wheels: { pool: WheelPool; idx: number; x: number; y: number; z: number; r: number; front: boolean }[] = [];
  private physics: Physics;
  private kcc: RAPIER_T.KinematicCharacterController | null = null;
  readonly id: number;
  private static nextId = 1;

  constructor(kind: VehicleKind, x: number, y: number, z: number, yaw: number, physics: Physics, pools: Record<'car' | 'bike' | 'small', WheelPool>, mat: THREE.Material, rand: () => number) {
    this.id = Vehicle.nextId++;
    this.kind = kind;
    this.spec = VEHICLES[kind];
    this.physics = physics;
    this.locked = kind === 'car';
    this.yaw = yaw;
    this.pos.set(x, y, z);
    const model = kind === 'car'
      ? carModel(Math.floor(rand() * 3), CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)])
      : kind === 'bike' ? bikeModel(BIKE_COLORS[Math.floor(rand() * BIKE_COLORS.length)], rand() < 0.4) : cargoModel(BIKE_COLORS[Math.floor(rand() * 3)]);
    const mesh = new THREE.Mesh(model.geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    for (const w of model.wheels) this.wheels.push({ pool: pools[w.type], idx: pools[w.type].alloc(), ...w });

    const [hx, hy, hz] = this.spec.halfExtents;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y + this.spec.rideHeight, z)
      .setRotation(quatYawPitch(yaw))
      .setLinearDamping(kind === 'car' ? 1.2 : 2.5)
      .setAngularDamping(4)
      .setCcdEnabled(kind === 'car');
    this.body = physics.world.createRigidBody(desc);
    this.body.setEnabledRotations(false, true, false, true);
    const vol = 8 * hx * hy * hz;
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(this.spec.mass / vol)
        .setFriction(kind === 'car' ? 0.9 : 0.6)
        .setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.VEHICLE | G.PLAYER)),
      this.body,
    );
    this.body.sleep();
    this.syncVisual(0);
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Spilleren sætter sig op/ind. */
  startDriving() {
    this.driven = true;
    const t = this.body.translation();
    this.pos.set(t.x, t.y - this.spec.rideHeight, t.z);
    const lv = this.body.linvel();
    this.vel.set(lv.x, 0, lv.z);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.collider.setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.VEHICLE));
    if (!this.kcc) {
      this.kcc = this.physics.makeController(0.05);
      this.kcc.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
      this.kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
      this.kcc.enableAutostep(this.kind === 'car' ? 0.28 : 0.2, 0.3, false);
      this.kcc.enableSnapToGround(0.6);
      this.kcc.setApplyImpulsesToDynamicBodies(true);
      this.kcc.setCharacterMass(this.spec.mass);
    }
  }

  stopDriving() {
    this.driven = false;
    this.throttle = 0;
    this.skid = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setEnabledRotations(false, true, false, true);
    this.collider.setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.VEHICLE | G.PLAYER));
    this.body.setLinvel({ x: this.vel.x, y: 0, z: this.vel.z }, true);
  }

  /** Arcade-kørsel. Returnerer største kollisionshastighed (til lyd/rystelse). */
  drive(dt: number, throttle: number, steerIn: number, handbrake: boolean): number {
    const s = this.spec;
    this.throttle = throttle;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vr = this.vel.x * rx + this.vel.z * rz;
    if (throttle > 0) {
      if (vf < -0.5) vf = Math.min(0, vf + s.brake * dt);
      else vf += s.accel * Math.max(0.1, 1 - (vf / s.maxSpeed) ** 2) * dt;
    } else if (throttle < 0) {
      if (vf > 0.5) vf = Math.max(0, vf - s.brake * dt);
      else vf = Math.max(-s.reverseMax, vf - s.accel * 0.6 * dt);
    } else {
      const drag = (1.4 + 0.012 * vf * vf) * dt;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag);
    }
    if (handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (this.kind === 'car' ? 5 : s.brake) * dt);
    this.steer += (steerIn - this.steer) * Math.min(1, dt * (this.kind === 'car' ? 7 : 9));
    const sp = Math.abs(vf);
    let yawRate = this.steer * s.turnRate * Math.min(1, sp / 4.5) * Math.sign(vf || 1) * (1 - 0.38 * Math.min(1, sp / s.maxSpeed));
    if (handbrake && this.kind === 'car') yawRate *= 1.45;
    this.yaw += yawRate * dt;
    // behold momentum i verdensrum → sideglid ved sving
    const wx = fx * vf + rx * vr, wz = fz * vf + rz * vr;
    const fx2 = -Math.sin(this.yaw), fz2 = -Math.cos(this.yaw), rx2 = Math.cos(this.yaw), rz2 = -Math.sin(this.yaw);
    vf = wx * fx2 + wz * fz2;
    vr = wx * rx2 + wz * rz2;
    const grip = handbrake ? s.driftGrip : s.grip;
    vr *= Math.exp(-grip * dt);
    this.skid = this.kind === 'car' ? Math.min(1, Math.abs(vr) / 5) : 0;
    this.vel.set(fx2 * vf + rx2 * vr, 0, fz2 * vf + rz2 * vr);
    return this.moveKinematic(dt);
  }

  /** Flyt det kinematiske legeme med figurstyringen og håndter kollisioner. */
  moveKinematic(dt: number): number {
    if (!this.kcc) return 0;
    this.vy -= 22 * dt;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.collider.setRotation(quatYawPitch(this.yaw));
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.VEHICLE));
    const mv = this.kcc.computedMovement();
    if (this.kcc.computedGrounded()) this.vy = Math.max(this.vy, -1);
    let impact = 0;
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c) continue;
      const n = c.normal1;
      if (Math.abs(n.y) > 0.6) continue;
      const nl = Math.hypot(n.x, n.z) || 1;
      const nx = n.x / nl, nz = n.z / nl;
      const into = this.vel.x * nx + this.vel.z * nz;
      if (into <= 0) continue;
      const other = c.collider?.parent();
      if (other && other.isDynamic() && other.mass() < 100) {
        // Cykler o.l. flyver bare af vejen
        other.applyImpulse({ x: nx * into * other.mass() * 1.2, y: into * other.mass() * 0.25, z: nz * into * other.mass() * 1.2 }, true);
        continue;
      }
      const e = 0.25;
      this.vel.x -= (1 + e) * into * nx;
      this.vel.z -= (1 + e) * into * nz;
      impact = Math.max(impact, into);
    }
    if (impact > 0) this.vel.multiplyScalar(0.8);
    const t = this.body.translation();
    const nt = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(nt);
    this.body.setNextKinematicRotation(quatYawPitch(this.yaw));
    this.pos.set(nt.x, nt.y - this.spec.rideHeight, nt.z);
    // faktisk hastighed (fx når man kører ind i noget)
    if (dt > 0) {
      const ax = mv.x / dt, az = mv.z / dt;
      if (Math.hypot(ax, az) < this.speed * 0.6) this.vel.set(ax, 0, az);
    }
    return impact;
  }

  /** Synk visuelt med fysik (parkeret/forladt) eller med kørsel. */
  syncVisual(dt: number) {
    if (!this.driven) {
      const t = this.body.translation();
      const r = this.body.rotation();
      tmpQ.set(r.x, r.y, r.z, r.w);
      tmpE.setFromQuaternion(tmpQ, 'YXZ');
      this.yaw = tmpE.y;
      this.pos.set(t.x, t.y - this.spec.rideHeight, t.z);
      const lv = this.body.linvel();
      this.vel.set(lv.x, 0, lv.z);
    }
    // hældning fra jorden (for/bag) og krængning i sving
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const hz = this.spec.halfExtents[2];
    const y0 = this.pos.y + 1.2;
    const gF = this.physics.groundY(this.pos.x + fx * hz, y0, this.pos.z + fz * hz, 2.5);
    const gB = this.physics.groundY(this.pos.x - fx * hz, y0, this.pos.z - fz * hz, 2.5);
    const targetPitch = gF !== null && gB !== null ? Math.atan2(gF - gB, hz * 2) : 0;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 10 + (dt === 0 ? 1 : 0));
    const lean = this.kind === 'car' ? -this.steer * Math.min(1, this.speed / 15) * 0.05 : -this.steer * Math.min(1, this.speed / 6) * 0.35;
    this.roll += (lean - this.roll) * Math.min(1, dt * 6);
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    // hjul
    const fwdSpeed = this.vel.x * fx + this.vel.z * fz;
    this.spin += (fwdSpeed * dt) / 0.33;
    this.group.updateMatrixWorld();
    for (const w of this.wheels) {
      tmpE.set(-this.spin * (0.33 / w.r), w.front ? this.steer * 0.45 : 0, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(w.x, w.y, w.z), tmpQ, tmpS.set(w.r / 0.33, w.r / 0.33, w.r / 0.33));
      tmpM.premultiply(this.group.matrixWorld);
      w.pool.mesh.setMatrixAt(w.idx, tmpM);
    }
  }

  /** Punkt hvor en fører stiger af (venstre side, ellers højre). */
  exitPoints(): THREE.Vector3[] {
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const d = this.kind === 'car' ? 1.6 : 0.9;
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
    return [
      new THREE.Vector3(this.pos.x - rx * d, this.pos.y, this.pos.z - rz * d),
      new THREE.Vector3(this.pos.x + rx * d, this.pos.y, this.pos.z + rz * d),
      new THREE.Vector3(this.pos.x + bx * (this.spec.halfExtents[2] + 1), this.pos.y, this.pos.z + bz * (this.spec.halfExtents[2] + 1)),
    ];
  }

  /** Er punktet (x,z) inden for køretøjets fodaftryk + margen? */
  hits(x: number, z: number, margin: number): boolean {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const lx = dx * rx + dz * rz, lz = dx * fx + dz * fz;
    return Math.abs(lx) < this.spec.halfExtents[0] + margin && Math.abs(lz) < this.spec.halfExtents[2] + margin;
  }
}

// ---------------------------------------------------------------- manager
export class VehicleManager {
  readonly list: Vehicle[] = [];
  readonly group = new THREE.Group();
  private pools: Record<'car' | 'bike' | 'small', WheelPool>;
  private mat = makeFlatMaterial({ roughness: 0.45 });
  private physics: Physics;

  constructor(physics: Physics) {
    this.physics = physics;
    this.group.name = 'vehicles';
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.8 });
    const carW = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2);
    // fælge
    const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 8).rotateZ(Math.PI / 2);
    const carWheel = mergeColored([[carW, '#1d1d1f'], [rim, '#b8bcc2']]);
    const bikeW = mergeColored([[new THREE.TorusGeometry(0.33, 0.035, 5, 16).rotateY(Math.PI / 2), '#1d1d1f'], [new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6).rotateZ(Math.PI / 2), '#b8bcc2'], [new THREE.BoxGeometry(0.01, 0.62, 0.01), '#9aa0a6'], [new THREE.BoxGeometry(0.01, 0.01, 0.62), '#9aa0a6']]);
    const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.pools = {
      car: new WheelPool(carWheel, wm, 600),
      bike: new WheelPool(bikeW, wm, 600),
      small: new WheelPool(bikeW, wm, 60),
    };
    void wheelMat;
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
  }

  spawn(kind: VehicleKind, x: number, y: number, z: number, yaw: number, rand: () => number): Vehicle {
    const v = new Vehicle(kind, x, y, z, yaw, this.physics, this.pools, this.mat, rand);
    this.list.push(v);
    this.group.add(v.group);
    return v;
  }

  update(dt: number, camPos: THREE.Vector3) {
    for (const v of this.list) {
      const d2 = (v.pos.x - camPos.x) ** 2 + (v.pos.z - camPos.z) ** 2;
      v.group.visible = d2 < 320 * 320;
      if (v.driven || !v.body.isSleeping() || d2 < 60 * 60) v.syncVisual(dt);
      // Fald ud af verden → sæt tilbage
      if (v.pos.y < -20) {
        v.body.setTranslation({ x: v.pos.x, y: 3, z: v.pos.z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    for (const p of Object.values(this.pools)) p.mesh.instanceMatrix.needsUpdate = true;
  }

  nearest(p: THREE.Vector3, maxD: number, filter?: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null, bd = maxD;
    for (const v of this.list) {
      if (v.driven || (filter && !filter(v))) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - (v.kind === 'car' ? 1.2 : 0.4);
      if (Math.abs(v.pos.y - p.y) < 2 && d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }
}

function mergeColored(parts: [THREE.BufferGeometry, string][]): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  for (const [g, c] of parts) gb.addGeometry(g, new THREE.Matrix4(), color(c));
  return gb.build();
}

/** Politicykel (selvstændig model, bruges af betjente på cykel). */
export function makePoliceBike(): THREE.Group {
  const g = new THREE.Group();
  const model = bikeModel('#f2f2f2', false);
  const mesh = new THREE.Mesh(model.geo, makeFlatMaterial({ roughness: 0.5 }));
  mesh.castShadow = true;
  g.add(mesh);
  const wheelGeo = new THREE.TorusGeometry(0.33, 0.035, 5, 14).rotateY(Math.PI / 2);
  const wm = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.8 });
  for (const w of model.wheels) {
    const m = new THREE.Mesh(wheelGeo, wm);
    m.position.set(w.x, w.y, w.z);
    g.add(m);
  }
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.35), new THREE.MeshStandardMaterial({ color: 0x1b2a4a }));
  bag.position.set(0, 0.72, 0.52);
  g.add(bag);
  return g;
}
