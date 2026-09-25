// Tredjepersonskamera: mus styrer yaw/pitch, undgår vægge, centrerer bag køretøjer og ryster ved sammenstød.
import * as THREE from 'three';
import type { Physics } from '../physics.ts';

export type CamMode = 'foot' | 'bike' | 'car';

const DIST: Record<CamMode, number> = { foot: 4.6, bike: 5.6, car: 8.2 };
const HEIGHT: Record<CamMode, number> = { foot: 1.55, bike: 1.6, car: 1.4 };

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.32;
  private dist = 4.6;
  private idle = 0;
  private shakeT = 0;
  private shakeAmp = 0;
  private readonly physics: Physics;
  private readonly focus = new THREE.Vector3();
  private readonly smooth = new THREE.Vector3();
  private first = true;

  constructor(camera: THREE.PerspectiveCamera, physics: Physics) {
    this.camera = camera;
    this.physics = physics;
  }

  snap() {
    this.first = true;
  }

  look(dx: number, dy: number, sensitivity: number, invertY: boolean) {
    const k = 0.0024 * sensitivity;
    this.yaw -= dx * k;
    this.pitch += dy * k * (invertY ? -1 : 1);
    this.pitch = Math.max(-0.25, Math.min(1.25, this.pitch));
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.idle = 0;
  }

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = 0.4;
  }

  update(dt: number, target: THREE.Vector3, mode: CamMode, headingYaw: number | null, speed: number) {
    this.idle += dt;
    if (headingYaw !== null && this.idle > 1.0 && speed > 2) {
      // Glid tilbage bag køretøjet
      let d = headingYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2.2);
      this.pitch += ((mode === 'car' ? 0.24 : 0.3) - this.pitch) * Math.min(1, dt * 1.5);
    }
    const want = DIST[mode] + (mode === 'car' ? Math.min(2.5, speed * 0.08) : 0);
    this.dist += (want - this.dist) * Math.min(1, dt * 3);
    this.focus.set(target.x, target.y + HEIGHT[mode], target.z);
    if (this.first) {
      this.smooth.copy(this.focus);
      this.first = false;
    } else this.smooth.lerp(this.focus, Math.min(1, dt * (mode === 'car' ? 12 : 16)));

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    let d = this.dist;
    const hit = this.physics.ray(this.smooth.x, this.smooth.y, this.smooth.z, dir.x, dir.y, dir.z, d + 0.3);
    if (hit) d = Math.max(0.6, hit.toi - 0.3);
    const pos = this.smooth.clone().addScaledVector(dir, d);
    if (pos.y < 0.3) pos.y = 0.3;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.4);
      pos.x += (Math.random() - 0.5) * a;
      pos.y += (Math.random() - 0.5) * a;
      pos.z += (Math.random() - 0.5) * a;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.smooth.x, this.smooth.y + 0.1, this.smooth.z);
    const fov = 66 + Math.min(12, speed * 0.45);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Vandret fremadretning for kameraet (bruges til at styre figuren). */
  forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
