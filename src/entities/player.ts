// Roliganen: gå/løbe/hoppe/klatre op over kanter/slå, samt stige på og af køretøjer.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { PLAYER_COLORS, TUNING, type RoliganDef } from '../config.ts';
import { G, RAPIER, groups, type Physics } from '../physics.ts';
import { Humanoid, type Look } from './humanoid.ts';
import type { Vehicle } from './vehicles.ts';

export type PlayerMode = 'foot' | 'mantle' | 'entering' | 'vehicle' | 'water' | 'hit' | 'frozen';

export interface PlayerInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jump: boolean;
  punch: boolean;
  camYaw: number;
}

export function roliganLook(def: RoliganDef): Look {
  return {
    skin: def.skin,
    hair: def.hair,
    hairStyle: def.braids ? 'braids' : def.female ? 'long' : 'short',
    shirt: PLAYER_COLORS.shirt,
    shirtStyle: 'dk',
    shirtText: def.name,
    pants: PLAYER_COLORS.shorts,
    shorts: true,
    socks: '#c8102e',
    shoes: '#1d1d1d',
    hat: 'viking',
    cape: 'dk',
    facePaint: def.id === 'kasper' ? 'dk-full' : 'dk-cheeks',
    beard: def.beard,
    belly: def.belly,
    female: def.female,
  };
}

const CAPSULE_HALF = 0.55, CAPSULE_R = 0.33, CENTER = CAPSULE_HALF + CAPSULE_R;

export class Player {
  model: Humanoid;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  mode: PlayerMode = 'foot';
  grounded = true;
  vehicle: Vehicle | null = null;
  punchCooldown = 0;
  punchPending = -1;
  private readonly physics: Physics;
  readonly body: RAPIER_T.RigidBody;
  readonly collider: RAPIER_T.Collider;
  private readonly kcc: RAPIER_T.KinematicCharacterController;
  private coyote = 0;
  private modeTime = 0;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  private stepAcc = 0;
  private airTime = 0;
  onStep: (run: boolean) => void = () => {};
  onLand: (fall: number) => void = () => {};
  onJump: () => void = () => {};

  constructor(def: RoliganDef, physics: Physics) {
    this.physics = physics;
    this.model = new Humanoid(roliganLook(def));
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER, 0));
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.VEHICLE | G.PROP)),
      this.body,
    );
    this.kcc = physics.makeController(0.02);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.enableAutostep(0.42, 0.2, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80);
  }

  /** Skift roligan (kun udseende). */
  setLook(def: RoliganDef) {
    const parent = this.model.group.parent;
    parent?.remove(this.model.group);
    this.model.dispose();
    this.model = new Humanoid(roliganLook(def));
    parent?.add(this.model.group);
    this.syncModel(0);
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.body.setTranslation({ x, y: y + CENTER, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
    this.syncModel(0);
  }

  setMode(m: PlayerMode) {
    this.mode = m;
    this.modeTime = 0;
  }

  get time() {
    return this.modeTime;
  }

  get horizontalSpeed() {
    return this.vehicle ? this.vehicle.speed : Math.hypot(this.vel.x, this.vel.z);
  }

  /** Opdater til fods. Returnerer true hvis et slag rammer i denne frame. */
  updateFoot(dt: number, inp: PlayerInput, controlsEnabled: boolean): boolean {
    this.modeTime += dt;
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    let punchNow = false;
    if (this.punchPending >= 0) {
      this.punchPending -= dt;
      if (this.punchPending < 0) punchNow = true;
    }

    if (this.mode === 'mantle') {
      const k = Math.min(1, this.modeTime / 0.45);
      const up = Math.min(1, k / 0.6), fwd = Math.max(0, (k - 0.45) / 0.55);
      const p = new THREE.Vector3(
        this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * fwd,
        this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * (1 - (1 - up) ** 2),
        this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * fwd,
      );
      this.pos.copy(p);
      this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER, z: p.z });
      this.model.setState('mantle');
      if (k >= 1) {
        this.setMode('foot');
        this.vel.set(0, 0, 0);
        this.grounded = true;
      }
      this.syncModel(dt);
      return false;
    }

    if (this.mode === 'hit' && this.modeTime > 0.45) this.setMode('foot');
    const canControl = controlsEnabled && this.mode === 'foot';
    // Ønsket vandret hastighed relativt til kameraet
    const fx = -Math.sin(inp.camYaw), fz = -Math.cos(inp.camYaw);
    const rx = Math.cos(inp.camYaw), rz = -Math.sin(inp.camYaw);
    let mx = canControl ? fx * inp.moveY + rx * inp.moveX : 0;
    let mz = canControl ? fz * inp.moveY + rz * inp.moveX : 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const punching = this.model.state === 'punch' && this.model.stateTime < 0.35;
    const speed = (inp.sprint ? TUNING.sprintSpeed : TUNING.walkSpeed) * (punching ? 0.3 : 1);
    const accel = this.grounded ? 32 : 32 * TUNING.airControl;
    const tx = mx * speed, tz = mz * speed;
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dl > maxDv) { this.vel.x += (dvx / dl) * maxDv; this.vel.z += (dvz / dl) * maxDv; }
    else { this.vel.x = tx; this.vel.z = tz; }

    // Hop / klatring
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (canControl && inp.jump) {
      if (!this.tryMantle(1.25, mx, mz)) {
        if (this.coyote > 0) {
          this.vel.y = TUNING.jumpVelocity;
          this.coyote = 0;
          this.grounded = false;
          this.onJump();
        }
      }
    }
    if (canControl && !this.grounded && this.vel.y < 3.5 && ml > 0.3) this.tryMantle(0, mx, mz);
    if ((this.mode as PlayerMode) === 'mantle') return false;

    // Slag
    if (canControl && inp.punch && this.punchCooldown <= 0) {
      this.punchCooldown = TUNING.punchCooldown;
      this.punchPending = 0.12;
      this.model.setState('punch');
    }

    this.vel.y -= TUNING.gravity * dt;
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.VEHICLE | G.PROP));
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.vel.y < 0) {
      if (!wasGrounded && this.airTime > 0.25) this.onLand(-this.vel.y);
      this.vel.y = -1;
      this.airTime = 0;
    } else this.airTime += dt;
    if (!this.grounded && mv.y > desired.y + 0.001 && this.vel.y > 0) this.vel.y = 0; // loft
    const t = this.body.translation();
    const nt = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(nt);
    this.pos.set(nt.x, nt.y - CENTER, nt.z);
    if (dt > 0) {
      // Hastighed efter kollision (glid langs vægge)
      this.vel.x = mv.x / dt;
      this.vel.z = mv.z / dt;
    }

    // Retning og animation
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.3 && !punching) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    } else if (punching && ml > 0.1) {
      this.yaw = Math.atan2(-mx, -mz);
    }
    if (this.mode === 'hit') this.model.setState('hit');
    else if (!punching) {
      if (!this.grounded && this.airTime > 0.12) this.model.setState(this.vel.y > 0 ? 'jump' : 'fall');
      else if (hs > 5.2) this.model.setState('run');
      else if (hs > 0.4) this.model.setState('walk');
      else this.model.setState('idle');
    }
    if (this.grounded && hs > 0.5) {
      this.stepAcc += hs * dt;
      const stride = hs > 5.2 ? 1.45 : 0.85;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.onStep(hs > 5.2);
      }
    }
    this.syncModel(dt);
    return punchNow;
  }

  /** Forsøg at trække sig op over en kant foran figuren. */
  private tryMantle(minRel: number, mx: number, mz: number): boolean {
    let fx = mx, fz = mz;
    if (Math.hypot(fx, fz) < 0.2) { fx = -Math.sin(this.yaw); fz = -Math.cos(this.yaw); }
    const l = Math.hypot(fx, fz);
    fx /= l; fz /= l;
    const feet = this.pos.y;
    const top = feet + TUNING.mantleMax + 0.4;
    const filter = G.STATIC | G.VEHICLE | G.PROP;
    // Plads over hovedet til at komme op?
    for (const d of [0.55, 0.8, 1.05]) {
      const ox = this.pos.x + fx * d, oz = this.pos.z + fz * d;
      const hit = this.physics.ray(ox, top, oz, 0, -1, 0, top - (feet + TUNING.mantleMin) + 0.05, filter);
      if (!hit || hit.normal.y < 0.7) continue;
      const rel = hit.point.y - feet;
      if (rel < Math.max(TUNING.mantleMin, minRel) || rel > TUNING.mantleMax) continue;
      // må ikke starte inde i noget (strålen skal starte i fri luft)
      if (hit.toi < 0.05) continue;
      const clearTarget = !this.physics.ray(hit.point.x, hit.point.y + 0.05, hit.point.z, 0, 1, 0, 1.75, filter);
      const clearAbove = !this.physics.ray(this.pos.x, feet + 1.75, this.pos.z, 0, 1, 0, Math.max(0.05, rel + 0.1), filter);
      if (!clearTarget || !clearAbove) continue;
      this.mantleFrom.copy(this.pos);
      this.mantleTo.set(hit.point.x + fx * 0.3, hit.point.y + 0.02, hit.point.z + fz * 0.3);
      this.yaw = Math.atan2(-fx, -fz);
      this.vel.set(0, 0, 0);
      this.setMode('mantle');
      this.onJump();
      return true;
    }
    return false;
  }

  knockback(dx: number, dz: number, strength: number) {
    this.vel.x += dx * strength;
    this.vel.z += dz * strength;
    this.vel.y = Math.max(this.vel.y, 2.5);
    this.grounded = false;
    this.setMode('hit');
  }

  enterVehicle(v: Vehicle) {
    this.vehicle = v;
    this.setMode('vehicle');
    this.collider.setEnabled(false);
    v.startDriving();
    if (v.kind === 'car') this.model.group.visible = false;
    this.model.setState(v.kind === 'car' ? 'drive' : 'bike');
  }

  exitVehicle(at: THREE.Vector3) {
    const v = this.vehicle;
    if (!v) return;
    v.stopDriving();
    this.vehicle = null;
    this.collider.setEnabled(true);
    this.model.group.visible = true;
    this.teleport(at.x, at.y, at.z, v.yaw);
    this.setMode('foot');
    this.grounded = false;
  }

  /** Følg køretøjet mens man kører. */
  followVehicle(dt: number) {
    const v = this.vehicle!;
    this.modeTime += dt;
    this.pos.copy(v.pos);
    this.yaw = v.yaw;
    this.body.setNextKinematicTranslation({ x: v.pos.x, y: v.pos.y + CENTER, z: v.pos.z });
    this.model.setState(v.kind === 'car' ? 'drive' : 'bike');
    const g = this.model.group;
    g.position.copy(v.group.position);
    g.rotation.set(v.group.rotation.x, v.group.rotation.y, v.group.rotation.z, 'YXZ');
    const up = v.kind === 'car' ? -0.35 : 0.08;
    const back = v.kind === 'car' ? 0.2 : v.kind === 'cargo' ? 0.42 : 0.2;
    g.position.x += Math.sin(v.yaw) * back;
    g.position.z += Math.cos(v.yaw) * back;
    g.position.y += up;
    this.model.update(dt, v.speed);
  }

  syncModel(dt: number) {
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    this.model.update(dt, Math.hypot(this.vel.x, this.vel.z));
  }

  /** Brug under vand-plask: figuren synker. */
  sink(dt: number, waterY: number) {
    this.modeTime += dt;
    this.pos.y += (waterY - 1.2 - this.pos.y) * Math.min(1, dt * 3);
    this.model.setState('swim');
    this.syncModel(dt);
  }
}
