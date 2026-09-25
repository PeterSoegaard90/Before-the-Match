// Fanzonen, der dukker op i det sidste minut: scene, storskærm, oppustelig port, publikum og grønt lys.
import * as THREE from 'three';
import { Humanoid, randomPedestrianLook } from '../entities/humanoid.ts';
import { rng } from '../shared/geom.ts';

export class Fanzone {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly radius: number;
  private crowd: Humanoid[] = [];
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private t = 0;

  constructor(center: THREE.Vector3, radius: number, isFree: (x: number, z: number) => boolean) {
    this.center.copy(center);
    this.radius = radius;
    this.group.name = 'fanzone';
    this.group.position.copy(center);
    const R = rng(1992);

    // Grøn cirkel på jorden + lyssøjle
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.8, radius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2fbf71, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.ring.position.y = 0.12;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, 90, 16, 1, true).translate(0, 45, 0),
      new THREE.MeshBasicMaterial({ color: 0x2fbf71, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.group.add(this.ring, this.beam);

    // Scene med storskærm
    const stage = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 5), new THREE.MeshStandardMaterial({ color: 0x222831 }));
    stage.position.set(0, 0.6, -radius + 3);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.5), new THREE.MeshBasicMaterial({ map: screenTexture() }));
    screen.position.set(0, 5.4, -radius + 1.2);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 5.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    frame.position.set(0, 5.4, -radius + 0.95);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      post.position.set(s * 4.4, 4, -radius + 1);
      this.group.add(post);
    }
    // Oppustelig port i rød-hvidt
    const arch = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const a = (i / 13) * Math.PI;
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xc8102e, roughness: 0.5 }));
      seg.position.set(Math.cos(a) * 6, Math.sin(a) * 6, radius - 1);
      arch.add(seg);
    }
    this.group.add(stage, screen, frame, arch);

    // Publikum
    for (let i = 0; i < 26; i++) {
      const look = randomPedestrianLook(R);
      look.shirt = '#c8102e';
      look.shirtStyle = 'dk';
      look.facePaint = R() < 0.6 ? 'dk-cheeks' : 'none';
      look.hat = R() < 0.4 ? 'viking' : R() < 0.5 ? 'jester' : 'none';
      look.cape = R() < 0.3 ? 'dk' : 'none';
      const h = new Humanoid(look);
      const a = R() * Math.PI * 2, r = 3 + R() * (radius - 5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!isFree(center.x + x, center.z + z)) { h.dispose(); continue; }
      h.group.position.set(x, 0, z);
      h.group.rotation.y = Math.atan2(-(0 - x), -(-radius + 1 - z)) + Math.PI;
      h.setState('cheer');
      this.crowd.push(h);
      this.group.add(h.group);
    }
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }

  update(dt: number, camPos: THREE.Vector3) {
    this.t += dt;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this.t * 4) * 0.25;
    const near = camPos.distanceTo(this.center) < 140;
    for (const h of this.crowd) if (near) h.update(dt, 0);
  }

  contains(p: THREE.Vector3): boolean {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) < this.radius && p.y < this.center.y + 4;
  }

  dispose() {
    for (const h of this.crowd) h.dispose();
    this.group.removeFromParent();
  }
}

function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 288);
  grd.addColorStop(0, '#1f7a3a');
  grd.addColorStop(1, '#0f4a22');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 288);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = 4;
  g.strokeRect(20, 20, 472, 248);
  g.beginPath(); g.moveTo(256, 20); g.lineTo(256, 268); g.stroke();
  g.beginPath(); g.arc(256, 144, 50, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 56px Arial';
  g.textAlign = 'center';
  g.fillText('DANMARK – SVERIGE', 256, 120);
  g.font = 'bold 40px Arial';
  g.fillStyle = '#ffd23a';
  g.fillText('KICKOFF KL. 18:00', 256, 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
