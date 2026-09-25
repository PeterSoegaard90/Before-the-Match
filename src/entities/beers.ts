// Fadøl: ved barer, på platforme, på fadølsvogne og tabte (5 sekunder til at samle op igen).
import * as THREE from 'three';
import { RULES } from '../config.ts';
import type { BeerSpot } from '../world/world.ts';

export type BeerKind = 'bar' | 'platform' | 'cart' | 'dropped';

export interface Beer {
  id: number;
  kind: BeerKind;
  pos: THREE.Vector3;
  name?: string;
  available: boolean;
  respawnAt: number;
  expiresAt: number;
  flight?: { from: THREE.Vector3; to: THREE.Vector3; t: number };
  cart?: THREE.Object3D;
}

const MAX_DROPPED = 8;

export class BeerSystem {
  readonly beers: Beer[] = [];
  readonly group = new THREE.Group();
  private glass: THREE.InstancedMesh;
  private foam: THREE.InstancedMesh;
  private ring: THREE.InstancedMesh;
  private beam: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private ringMat: THREE.MeshBasicMaterial;

  constructor(spots: BeerSpot[], carts: THREE.Object3D[]) {
    this.group.name = 'beers';
    let id = 0;
    for (const s of spots) this.beers.push({ id: id++, kind: s.kind, pos: s.pos.clone(), name: s.name, available: true, respawnAt: 0, expiresAt: Infinity });
    for (const c of carts) this.beers.push({ id: id++, kind: 'cart', pos: new THREE.Vector3(), available: true, respawnAt: 0, expiresAt: Infinity, cart: c });
    for (let i = 0; i < MAX_DROPPED; i++) this.beers.push({ id: id++, kind: 'dropped', pos: new THREE.Vector3(), available: false, respawnAt: Infinity, expiresAt: 0 });
    const n = this.beers.length;
    const glassGeo = new THREE.CylinderGeometry(0.2, 0.16, 0.5, 12).translate(0, 0.25, 0);
    const foamGeo = new THREE.CylinderGeometry(0.215, 0.2, 0.12, 12).translate(0, 0.55, 0);
    this.glass = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0xf0a81c, emissive: 0x6a3a00, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.93 }), n);
    this.foam = new THREE.InstancedMesh(foamGeo, new THREE.MeshStandardMaterial({ color: 0xfffbf0, emissive: 0x555555, roughness: 0.9 }), n);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.55, 0.8, 24).rotateX(-Math.PI / 2), this.ringMat, n);
    const beamGeo = new THREE.CylinderGeometry(0.22, 0.22, 14, 8, 1, true).translate(0, 7, 0);
    this.beam = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffc933, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), n);
    for (const im of [this.glass, this.foam, this.ring, this.beam]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.group.add(im);
    }
    this.glass.castShadow = true;
  }

  /** Nulstil alle fadøl til en ny runde. */
  reset() {
    for (const b of this.beers) {
      if (b.kind === 'dropped') { b.available = false; b.expiresAt = 0; }
      else { b.available = true; b.respawnAt = 0; }
    }
  }

  drop(from: THREE.Vector3, dirX: number, dirZ: number, now: number, isFree: (x: number, z: number) => boolean): Beer | null {
    const slot = this.beers.find((b) => b.kind === 'dropped' && !b.available && !b.flight) ?? this.beers.find((b) => b.kind === 'dropped' && !b.available);
    if (!slot) return null;
    let tx = from.x + dirX * 1.9, tz = from.z + dirZ * 1.9;
    if (!isFree(tx, tz)) { tx = from.x - dirX * 1.2; tz = from.z - dirZ * 1.2; }
    if (!isFree(tx, tz)) { tx = from.x; tz = from.z; }
    slot.flight = { from: new THREE.Vector3(from.x, from.y + 1.2, from.z), to: new THREE.Vector3(tx, from.y, tz), t: 0 };
    slot.pos.copy(slot.flight.from);
    slot.available = true;
    slot.expiresAt = now + RULES.droppedBeerSeconds + 0.5;
    return slot;
  }

  /** Samler den første tilgængelige fadøl inden for radius (3D). */
  collect(pos: THREE.Vector3, radius: number, now: number): Beer | null {
    for (const b of this.beers) {
      if (!b.available || b.flight) continue;
      const dy = pos.y - b.pos.y;
      if (dy < -1.4 || dy > 2.2) continue;
      if (Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) > radius) continue;
      b.available = false;
      if (b.kind === 'bar') b.respawnAt = now + RULES.barRespawnSeconds;
      else if (b.kind === 'platform') b.respawnAt = now + RULES.platformRespawnSeconds;
      else if (b.kind === 'cart') b.respawnAt = now + RULES.cartRespawnSeconds;
      else b.expiresAt = 0;
      return b;
    }
    return null;
  }

  nearestAvailable(p: THREE.Vector3, maxD = Infinity): Beer | null {
    let best: Beer | null = null, bd = maxD;
    for (const b of this.beers) {
      if (!b.available || b.kind === 'dropped') continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  update(dt: number, now: number) {
    for (const b of this.beers) {
      if (b.cart) b.pos.set(b.cart.position.x, 1.05, b.cart.position.z);
      if (!b.available && b.kind !== 'dropped' && now >= b.respawnAt) b.available = true;
      if (b.kind === 'dropped' && b.available && now > b.expiresAt) b.available = false;
      if (b.flight) {
        b.flight.t += dt / 0.5;
        const t = Math.min(1, b.flight.t);
        b.pos.lerpVectors(b.flight.from, b.flight.to, t);
        b.pos.y += Math.sin(t * Math.PI) * 1.2;
        if (t >= 1) b.flight = undefined;
      }
    }
    const pulse = 0.4 + Math.sin(now * 4) * 0.15;
    this.ringMat.opacity = pulse;
    this.beers.forEach((b, i) => {
      let show = b.available;
      if (b.kind === 'dropped' && show && b.expiresAt - now < 2) show = Math.floor(now * 8) % 2 === 0;
      const sc = show ? 1 : 0;
      const bob = b.kind === 'dropped' || b.kind === 'cart' ? 0.05 : 0.55 + Math.sin(now * 2.2 + i) * 0.12;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, now * 1.6 + i);
      this.m.compose(this.p.set(b.pos.x, b.pos.y + bob, b.pos.z), this.q, this.s.set(sc, sc, sc));
      this.glass.setMatrixAt(i, this.m);
      this.foam.setMatrixAt(i, this.m);
      const rs = show && b.kind !== 'cart' ? 1 : 0;
      this.m.compose(this.p.set(b.pos.x, b.pos.y + 0.06, b.pos.z), this.q.identity(), this.s.set(rs, rs, rs));
      this.ring.setMatrixAt(i, this.m);
      const bs = show && (b.kind === 'bar' || b.kind === 'platform' || b.kind === 'cart') ? 1 : 0;
      this.m.compose(this.p.set(b.pos.x, b.pos.y, b.pos.z), this.q.identity(), this.s.set(bs, bs, bs));
      this.beam.setMatrixAt(i, this.m);
    });
    for (const im of [this.glass, this.foam, this.ring, this.beam]) im.instanceMatrix.needsUpdate = true;
  }
}

/** Fadølsvogn: trækvogn med parasol, hane og skilt. */
export function makeBeerCart(): THREE.Group {
  const g = new THREE.Group();
  const mat = (c: number, rough = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.6), mat(0xc8102e));
  body.position.y = 0.65;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.7), mat(0xf2f2f2));
  top.position.y = 1.02;
  const keg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), mat(0xb8bcc2, 0.3));
  keg.position.set(0, 0.65, -0.5);
  keg.rotation.z = Math.PI / 2;
  const tap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat(0xd8b04a, 0.3));
  tap.position.set(0.3, 1.2, 0.4);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6), mat(0xdddddd));
  pole.position.set(0, 1.8, 0);
  const umb = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  umb.position.set(0, 2.7, 0);
  const stripe = new THREE.Mesh(new THREE.ConeGeometry(1.21, 0.2, 8, 1, true), mat(0xc8102e));
  stripe.position.set(0, 2.58, 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36), new THREE.MeshBasicMaterial({ map: signTexture('FADØL!') }));
  sign.position.set(0.56, 0.72, 0);
  sign.rotation.y = Math.PI / 2;
  const sign2 = sign.clone();
  sign2.position.x = -0.56;
  sign2.rotation.y = -Math.PI / 2;
  for (const s of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12), mat(0x222222));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 0.6, 0.3, 0.3);
    g.add(wheel);
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), mat(0x444444));
  handle.position.set(0, 1.0, 0.95);
  g.add(body, top, keg, tap, pole, umb, stripe, sign, sign2, handle);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return g;
}

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 92;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff4d6';
  g.fillRect(0, 0, 256, 92);
  g.fillStyle = '#c8102e';
  g.font = 'bold 54px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
