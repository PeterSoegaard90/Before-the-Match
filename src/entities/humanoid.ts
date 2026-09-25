// Procedural low-poly figur som ét SkinnedMesh (1 draw call) med kodestyret animation.
// Bruges til roligans, fodgængere, hooligans, betjente og publikum i fanzonen.
import * as THREE from 'three';

export type AnimState =
  | 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'mantle' | 'punch' | 'hit' | 'down' | 'getup'
  | 'bike' | 'drive' | 'cheer' | 'fist' | 'dazed' | 'push' | 'steal' | 'swim';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald' | 'braids' | 'bun' | 'mohawk';
  shirt: string;
  shirtStyle: 'dk' | 'se' | 'police' | 'plain' | 'stripes' | 'hoodie';
  shirtText?: string;
  pants: string;
  shorts: boolean;
  socks?: string;
  shoes: string;
  hat: 'viking' | 'bucket' | 'police' | 'cap' | 'none' | 'jester';
  hatColor?: string;
  cape: 'dk' | 'se' | 'none';
  facePaint: 'dk-cheeks' | 'dk-full' | 'se-cheeks' | 'none';
  beard: boolean;
  belly: number; // 0–1
  female: boolean;
  glasses?: boolean;
  scale?: number;
}

type BoneName = 'root' | 'hips' | 'torso' | 'head' | 'armL' | 'foreL' | 'armR' | 'foreR' | 'legL' | 'shinL' | 'legR' | 'shinR' | 'cape';
const BONES: [BoneName, BoneName | null, [number, number, number]][] = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.95, 0]],
  ['torso', 'hips', [0, 0.08, 0]],
  ['head', 'torso', [0, 0.52, 0]],
  ['armL', 'torso', [-0.27, 0.44, 0]],
  ['foreL', 'armL', [0, -0.3, 0]],
  ['armR', 'torso', [0.27, 0.44, 0]],
  ['foreR', 'armR', [0, -0.3, 0]],
  ['legL', 'hips', [-0.1, -0.04, 0]],
  ['shinL', 'legL', [0, -0.43, 0]],
  ['legR', 'hips', [0.1, -0.04, 0]],
  ['shinR', 'legR', [0, -0.43, 0]],
  ['cape', 'torso', [0, 0.42, 0.14]],
];

// Atlas (128×128): ansigt | trøje-front / trøje-ryg | kappe | hvid
const UV = {
  face: [0, 0, 64, 64],
  front: [64, 0, 128, 64],
  back: [0, 64, 64, 128],
  cape: [64, 64, 128, 96],
  white: [100, 110, 104, 114],
} as const;
type UvRect = readonly [number, number, number, number];

class SkinBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];

  box(bone: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: THREE.Color, faces: { front?: UvRect; back?: UvRect } = {}, rotX = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const F: [number[], number[], UvRect | undefined][] = [
      [[1, 0, 0], [1, -1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1], undefined],
      [[-1, 0, 0], [-1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1], undefined],
      [[0, 1, 0], [-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1], undefined],
      [[0, -1, 0], [-1, -1, 1, 1, -1, 1, 1, -1, -1, -1, -1, -1], undefined],
      [[0, 0, -1], [1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, -1], faces.front], // front (-z)
      [[0, 0, 1], [-1, -1, 1, -1, 1, 1, 1, 1, 1, 1, -1, 1], faces.back],
    ];
    const cr = Math.cos(rotX), sr = Math.sin(rotX);
    for (const [n, v, rect] of F) {
      const base = this.pos.length / 3;
      const ny = n[1] * cr - n[2] * sr, nz = n[1] * sr + n[2] * cr;
      for (let i = 0; i < 4; i++) {
        const x = v[i * 3] * hx, y = v[i * 3 + 1] * hy, z = v[i * 3 + 2] * hz;
        this.pos.push(cx + x, cy + y * cr - z * sr, cz + y * sr + z * cr);
        this.nor.push(n[0], ny, nz);
        const r = rect ?? UV.white;
        // hjørner: (0) nederst-venstre, (1) øverst-venstre, (2) øverst-højre, (3) nederst-højre set udefra
        const us = [r[0], r[0], r[2], r[2]], vs = [r[3], r[1], r[1], r[3]];
        this.uv.push(us[i] / 128, 1 - vs[i] / 128);
        const cc = rect ? WHITE : c;
        this.col.push(cc.r, cc.g, cc.b);
        this.si.push(bone, 0, 0, 0);
        this.sw.push(1, 0, 0, 0);
      }
      this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  geom(bone: number, g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.computeVertexNormals();
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(vn.x, vn.y, vn.z);
      this.uv.push(102 / 128, 1 - 112 / 128);
      this.col.push(c.r, c.g, c.b);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
      this.idx.push(base + i);
    }
  }

  quad(bone: number, a: number[], b: number[], c: number[], d: number[], rect: UvRect) {
    const base = this.pos.length / 3;
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), new THREE.Vector3(...d).sub(new THREE.Vector3(...a))).normalize();
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(1, 1, 1);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    this.uv.push(rect[0] / 128, 1 - rect[1] / 128, rect[2] / 128, 1 - rect[1] / 128, rect[2] / 128, 1 - rect[3] / 128, rect[0] / 128, 1 - rect[3] / 128);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
    return g;
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const C = (s: string) => new THREE.Color(s);

function drawAtlas(look: Look): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // ---------- ansigt
  g.fillStyle = look.skin;
  g.fillRect(0, 0, 64, 64);
  if (look.facePaint === 'dk-full') {
    g.fillStyle = '#c8102e'; g.fillRect(0, 14, 64, 50);
    g.fillStyle = '#ffffff'; g.fillRect(20, 14, 8, 50); g.fillRect(0, 34, 64, 7);
  }
  const cheek = (x: number, a: string, b: string) => {
    g.fillStyle = a; g.fillRect(x, 38, 14, 10);
    g.fillStyle = b; g.fillRect(x + 4, 38, 3, 10); g.fillRect(x, 41.5, 14, 3);
  };
  if (look.facePaint === 'dk-cheeks') { cheek(4, '#c8102e', '#ffffff'); cheek(46, '#c8102e', '#ffffff'); }
  if (look.facePaint === 'se-cheeks') { cheek(4, '#006aa7', '#fecc00'); cheek(46, '#006aa7', '#fecc00'); }
  // hår-kant i panden
  if (look.hairStyle !== 'bald') { g.fillStyle = look.hair; g.fillRect(0, 0, 64, look.hat === 'none' ? 12 : 6); }
  // øjne
  g.fillStyle = '#ffffff'; g.fillRect(14, 24, 11, 8); g.fillRect(39, 24, 11, 8);
  g.fillStyle = '#2b1d14'; g.fillRect(18, 25, 5, 6); g.fillRect(43, 25, 5, 6);
  g.fillStyle = look.hair === '#e8c35a' ? '#b8913a' : '#2b1d14';
  g.fillRect(12, 19, 14, 3); g.fillRect(38, 19, 14, 3);
  if (look.glasses) { g.strokeStyle = '#111'; g.lineWidth = 2; g.strokeRect(12, 22, 15, 12); g.strokeRect(37, 22, 15, 12); g.fillRect(27, 26, 10, 2); }
  // næse + mund
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(29, 30, 6, 10);
  if (look.beard) { g.fillStyle = look.hair; g.fillRect(6, 44, 52, 20); g.fillRect(4, 30, 6, 20); g.fillRect(54, 30, 6, 20); }
  g.fillStyle = '#7a2a22'; g.fillRect(22, 48, 20, 6);
  g.fillStyle = '#ffffff'; g.fillRect(24, 48, 16, 2);
  if (look.female) { g.fillStyle = '#b3474f'; g.fillRect(22, 48, 20, 2); }
  // ---------- trøje front + ryg
  const kit = (x: number, y: number, back: boolean) => {
    g.fillStyle = look.shirt; g.fillRect(x, y, 64, 64);
    if (look.shirtStyle === 'dk') {
      g.fillStyle = '#ffffff';
      if (!back) { g.beginPath(); g.moveTo(x + 20, y); g.lineTo(x + 32, y + 14); g.lineTo(x + 44, y); g.lineTo(x + 40, y); g.lineTo(x + 32, y + 9); g.lineTo(x + 24, y); g.fill(); g.fillRect(x + 42, y + 18, 8, 8); }
      else { g.fillRect(x + 20, y, 24, 3); }
      g.fillRect(x, y + 58, 64, 6);
    } else if (look.shirtStyle === 'se') {
      g.fillStyle = '#006aa7';
      if (!back) { g.fillRect(x + 22, y, 20, 5); g.fillRect(x + 42, y + 18, 8, 8); } else g.fillRect(x + 22, y, 20, 3);
      g.fillRect(x, y + 58, 64, 6);
    } else if (look.shirtStyle === 'police') {
      g.fillStyle = '#e7ff3a'; g.fillRect(x + 4, y + 4, 56, 56);
      g.fillStyle = '#9aa3ad'; g.fillRect(x + 4, y + 34, 56, 6);
      g.fillStyle = '#1b2a4a'; g.font = 'bold 13px Arial'; g.textAlign = 'center';
      g.fillText('POLITI', x + 32, y + (back ? 24 : 22));
    } else if (look.shirtStyle === 'stripes') {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let k = 0; k < 64; k += 12) g.fillRect(x, y + k, 64, 5);
    } else if (look.shirtStyle === 'hoodie') {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 16, y + 34, 32, 18);
    }
    if (back && look.shirtText) {
      g.fillStyle = look.shirtStyle === 'se' ? '#006aa7' : '#ffffff';
      g.textAlign = 'center';
      g.font = 'bold 11px Arial';
      g.fillText(look.shirtText.toUpperCase().slice(0, 9), x + 32, y + 16);
      g.font = 'bold 26px Arial';
      g.fillText(look.shirtStyle === 'se' ? '10' : '12', x + 32, y + 44);
    }
  };
  kit(64, 0, false);
  kit(0, 64, true);
  // ---------- kappe (flag)
  if (look.cape === 'se') {
    g.fillStyle = '#006aa7'; g.fillRect(64, 64, 64, 32);
    g.fillStyle = '#fecc00'; g.fillRect(84, 64, 8, 32); g.fillRect(64, 76, 64, 7);
  } else {
    g.fillStyle = '#c8102e'; g.fillRect(64, 64, 64, 32);
    g.fillStyle = '#ffffff'; g.fillRect(84, 64, 8, 32); g.fillRect(64, 76, 64, 7);
  }
  return cv;
}

export class Humanoid {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones = {} as Record<BoneName, THREE.Bone>;
  readonly look: Look;
  state: AnimState = 'idle';
  stateTime = 0;
  private phase = Math.random() * 10;
  private stars: THREE.Group | null = null;
  private capeSwing = 0;
  speed = 0;

  constructor(look: Look) {
    this.look = look;
    const sb = new SkinBuilder();
    const bi: Record<string, number> = {};
    BONES.forEach(([n], i) => (bi[n] = i));
    const skin = C(look.skin), shirt = C(look.shirt), pants = C(look.pants), shoes = C(look.shoes);
    const socks = C(look.socks ?? look.pants);
    const wide = look.female ? 0.92 : 1;
    // ben
    for (const [leg, shin, x] of [['legL', 'shinL', -0.1], ['legR', 'shinR', 0.1]] as const) {
      const thighC = look.shorts ? pants : pants;
      sb.box(bi[leg], x, 0.69, 0, 0.17 * wide, look.shorts ? 0.3 : 0.44, 0.18, thighC);
      if (look.shorts) sb.box(bi[leg], x, 0.49, 0, 0.14, 0.14, 0.15, skin);
      sb.box(bi[shin], x, 0.27, 0, 0.14, 0.36, 0.15, look.shorts ? socks : pants);
      sb.box(bi[shin], x, 0.05, -0.04, 0.15, 0.1, 0.27, shoes);
    }
    // krop
    sb.box(bi.hips, 0, 0.95, 0, 0.36 * wide, 0.18, 0.22, pants);
    const tw = look.female ? 0.38 : 0.42;
    sb.box(bi.torso, 0, 1.28, 0, tw, 0.5, 0.24, shirt, { front: UV.front, back: UV.back });
    if (look.belly > 0) sb.box(bi.torso, 0, 1.16, -0.13, tw * 0.8, 0.26, 0.1 * (0.5 + look.belly), shirt);
    if (look.female) sb.box(bi.torso, 0, 1.36, -0.13, tw * 0.75, 0.12, 0.05, shirt);
    // arme
    for (const [arm, fore, x] of [['armL', 'foreL', -0.27], ['armR', 'foreR', 0.27]] as const) {
      sb.box(bi[arm], x, 1.33, 0, 0.12, 0.3, 0.13, look.shirtStyle === 'police' ? C('#1b2a4a') : shirt);
      sb.box(bi[fore], x, 1.04, 0, 0.11, 0.28, 0.12, look.shirtStyle === 'hoodie' || look.shirtStyle === 'police' ? (look.shirtStyle === 'police' ? C('#1b2a4a') : shirt) : skin);
      sb.box(bi[fore], x, 0.86, 0, 0.1, 0.1, 0.1, skin);
    }
    // hoved
    sb.box(bi.head, 0, 1.56, 0, 0.12, 0.06, 0.12, skin);
    sb.box(bi.head, 0, 1.74, 0, 0.28, 0.3, 0.28, skin, { front: UV.face });
    const hair = C(look.hair);
    if (look.hairStyle !== 'bald') {
      sb.box(bi.head, 0, 1.9, 0.02, 0.3, 0.05, 0.3, hair);
      sb.box(bi.head, 0, 1.76, 0.14, 0.29, 0.28, 0.04, hair);
      if (look.hairStyle === 'long') sb.box(bi.head, 0, 1.55, 0.13, 0.3, 0.3, 0.06, hair);
      if (look.hairStyle === 'braids') for (const x of [-0.16, 0.16]) sb.box(bi.head, x, 1.52, 0.02, 0.07, 0.34, 0.07, hair);
      if (look.hairStyle === 'bun') sb.box(bi.head, 0, 1.94, 0.12, 0.12, 0.12, 0.12, hair);
      if (look.hairStyle === 'mohawk') sb.box(bi.head, 0, 1.97, 0.02, 0.06, 0.1, 0.3, hair);
    }
    // hat
    const hatC = C(look.hatColor ?? '#9aa3ab');
    if (look.hat === 'viking') {
      const dome = new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      sb.geom(bi.head, dome, new THREE.Matrix4().makeScale(1, 0.85, 1).setPosition(0, 1.84, 0), C('#9aa3ab'));
      sb.geom(bi.head, new THREE.CylinderGeometry(0.205, 0.205, 0.05, 12), new THREE.Matrix4().setPosition(0, 1.85, 0), C('#6f777e'));
      for (const s of [-1, 1]) {
        const horn = new THREE.ConeGeometry(0.05, 0.26, 7);
        const m = new THREE.Matrix4().makeRotationZ(-s * 1.0).setPosition(s * 0.25, 1.95, 0);
        sb.geom(bi.head, horn, m, C('#efe6cf'));
      }
    } else if (look.hat === 'bucket') {
      sb.geom(bi.head, new THREE.CylinderGeometry(0.17, 0.2, 0.14, 10), new THREE.Matrix4().setPosition(0, 1.93, 0), hatC);
      sb.geom(bi.head, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), new THREE.Matrix4().setPosition(0, 1.87, 0), C('#fecc00'));
    } else if (look.hat === 'police') {
      sb.geom(bi.head, new THREE.CylinderGeometry(0.17, 0.16, 0.1, 10), new THREE.Matrix4().setPosition(0, 1.93, 0), C('#1b2a4a'));
      sb.box(bi.head, 0, 1.89, -0.18, 0.24, 0.02, 0.12, C('#111111'));
      sb.box(bi.head, 0, 1.94, -0.155, 0.08, 0.05, 0.02, C('#d8b04a'));
    } else if (look.hat === 'cap') {
      sb.box(bi.head, 0, 1.92, 0, 0.3, 0.08, 0.3, hatC);
      sb.box(bi.head, 0, 1.89, -0.2, 0.24, 0.02, 0.14, hatC);
    } else if (look.hat === 'jester') {
      for (const s of [-1, 1]) sb.geom(bi.head, new THREE.ConeGeometry(0.1, 0.35, 6), new THREE.Matrix4().makeRotationZ(-s * 0.7).setPosition(s * 0.13, 2.03, 0), s < 0 ? C('#c8102e') : C('#ffffff'));
    }
    // kappe
    if (look.cape !== 'none') {
      const b = bi.cape;
      // Kappen hænger fra skuldrene (knoglens origo: y 1.45, z 0.14)
      const P = (x: number, y: number, z: number) => [x, 1.45 + y, 0.14 + z];
      sb.quad(b, P(-0.24, 0, 0.005), P(0.24, 0, 0.005), P(0.26, -0.78, 0.03), P(-0.26, -0.78, 0.03), UV.cape);
      sb.quad(b, P(0.24, 0, 0), P(-0.24, 0, 0), P(-0.26, -0.78, 0.025), P(0.26, -0.78, 0.025), UV.cape);
    }
    // Knogler i bind-positur
    const bones: THREE.Bone[] = [];
    for (const [name, parent, off] of BONES) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(...off);
      this.bones[name] = bone;
      bones.push(bone);
      if (parent) this.bones[parent].add(bone);
    }
    // Geometrien er bygget i modelrum; bone-positionerne er relative – flyt vertices til knoglerum er ikke nødvendigt,
    // da bind() bruger knoglernes verdensmatricer i bind-positur.
    const tex = new THREE.CanvasTexture(drawAtlas(look));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.85, side: THREE.FrontSide });
    this.mesh = new THREE.SkinnedMesh(sb.build(), mat);
    this.mesh.add(bones[0]);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    const s = look.scale ?? 1;
    this.mesh.scale.setScalar(s);
    this.group.add(this.mesh);
  }

  setState(s: AnimState) {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
    }
  }

  showStars(on: boolean) {
    if (on && !this.stars) {
      this.stars = new THREE.Group();
      const g = new THREE.OctahedronGeometry(0.07, 0);
      const m = new THREE.MeshBasicMaterial({ color: 0xffe14d });
      for (let i = 0; i < 4; i++) {
        const st = new THREE.Mesh(g, m);
        const a = (i / 4) * Math.PI * 2;
        st.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
        this.stars.add(st);
      }
      this.stars.position.y = 2.1;
      this.group.add(this.stars);
    } else if (!on && this.stars) {
      this.group.remove(this.stars);
      this.stars = null;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.dispose();
  }

  /** Sæt knoglernes rotationer ud fra tilstand. speed i m/s. */
  update(dt: number, speed = this.speed) {
    this.stateTime += dt;
    const B = this.bones;
    const t = this.stateTime;
    for (const k of Object.keys(B) as BoneName[]) B[k].rotation.set(0, 0, 0);
    B.root.position.set(0, 0, 0);
    B.root.rotation.set(0, 0, 0);
    B.hips.position.y = 0.95;
    let capeTarget = 0.12 + Math.min(1.1, speed * 0.12);

    const walkCycle = (freq: number, amp: number, armAmp: number, lean: number) => {
      this.phase += dt * freq;
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      B.legL.rotation.x = s * amp;
      B.legR.rotation.x = -s * amp;
      B.shinL.rotation.x = -Math.max(0, -c) * amp * 1.4 - 0.05;
      B.shinR.rotation.x = -Math.max(0, c) * amp * 1.4 - 0.05;
      B.armL.rotation.x = -s * armAmp;
      B.armR.rotation.x = s * armAmp;
      B.foreL.rotation.x = 0.3 + Math.max(0, -s) * armAmp * 0.6;
      B.foreR.rotation.x = 0.3 + Math.max(0, s) * armAmp * 0.6;
      B.torso.rotation.x = lean;
      B.torso.rotation.y = s * 0.08;
      B.hips.position.y = 0.95 + Math.abs(c) * 0.04 * amp;
    };

    switch (this.state) {
      case 'idle': {
        const b = Math.sin(t * 2.2);
        B.torso.rotation.x = b * 0.015;
        B.armL.rotation.z = -0.08 - b * 0.02;
        B.armR.rotation.z = 0.08 + b * 0.02;
        B.head.rotation.y = Math.sin(t * 0.5) * 0.25;
        break;
      }
      case 'walk':
        walkCycle(Math.max(4, speed * 3.3), 0.45, 0.4, 0.04);
        break;
      case 'run':
        walkCycle(Math.max(7, speed * 1.9), 0.85, 0.95, 0.18);
        B.foreL.rotation.x = B.foreR.rotation.x = 1.2;
        break;
      case 'jump':
      case 'fall': {
        B.legL.rotation.x = 0.7; B.shinL.rotation.x = -1.1;
        B.legR.rotation.x = 0.1; B.shinR.rotation.x = -0.4;
        B.armL.rotation.z = -1.1; B.armR.rotation.z = 1.1;
        B.armL.rotation.x = B.armR.rotation.x = 0.4;
        capeTarget = 1.1;
        break;
      }
      case 'mantle': {
        const k = Math.min(1, t / 0.45);
        B.armL.rotation.x = B.armR.rotation.x = 2.9 - k * 2.4;
        B.legL.rotation.x = 1.2 * Math.sin(k * Math.PI);
        B.shinL.rotation.x = -1.6 * Math.sin(k * Math.PI);
        B.legR.rotation.x = 0.6 * Math.sin(k * Math.PI);
        B.shinR.rotation.x = -0.8;
        B.torso.rotation.x = 0.3;
        break;
      }
      case 'punch': {
        const k = Math.min(1, t / 0.14);
        const back = t > 0.22 ? Math.max(0, 1 - (t - 0.22) / 0.2) : 1;
        B.armR.rotation.x = 1.55 * k * back;
        B.foreR.rotation.x = 0.1;
        B.armL.rotation.x = 0.9; B.foreL.rotation.x = 1.6;
        B.torso.rotation.y = -0.45 * k * back;
        B.legL.rotation.x = 0.25; B.legR.rotation.x = -0.2;
        break;
      }
      case 'hit': {
        B.torso.rotation.x = -0.35 * Math.max(0, 1 - t / 0.4);
        B.head.rotation.x = -0.4 * Math.max(0, 1 - t / 0.4);
        B.armL.rotation.z = -0.6; B.armR.rotation.z = 0.6;
        break;
      }
      case 'down': {
        const k = Math.min(1, t / 0.35);
        B.root.rotation.x = (Math.PI / 2) * k;
        B.root.position.y = 0.16 * k;
        B.root.position.z = 0;
        B.armL.rotation.z = -1.2; B.armR.rotation.z = 1.2;
        B.legL.rotation.z = -0.2; B.legR.rotation.z = 0.2;
        capeTarget = 0;
        break;
      }
      case 'getup': {
        const k = Math.min(1, t / 0.6);
        B.root.rotation.x = (Math.PI / 2) * (1 - k);
        B.root.position.y = 0.16 * (1 - k);
        B.legL.rotation.x = 1.2 * (1 - k); B.shinL.rotation.x = -1.8 * (1 - k);
        break;
      }
      case 'bike': {
        this.phase += dt * Math.max(0.5, speed * 1.4);
        const s = Math.sin(this.phase);
        B.hips.position.y = 0.95;
        B.legL.rotation.x = 1.15 + s * 0.45; B.shinL.rotation.x = -1.2 + s * 0.35;
        B.legR.rotation.x = 1.15 - s * 0.45; B.shinR.rotation.x = -1.2 - s * 0.35;
        B.armL.rotation.x = B.armR.rotation.x = 1.0;
        B.foreL.rotation.x = B.foreR.rotation.x = 0.3;
        B.torso.rotation.x = 0.28;
        break;
      }
      case 'drive': {
        B.legL.rotation.x = B.legR.rotation.x = 1.45;
        B.shinL.rotation.x = B.shinR.rotation.x = -1.35;
        B.armL.rotation.x = B.armR.rotation.x = 1.1;
        B.foreL.rotation.x = B.foreR.rotation.x = 0.3;
        capeTarget = 0;
        break;
      }
      case 'cheer': {
        const w = Math.sin(t * 7 + this.phase);
        B.armL.rotation.z = -2.5 - w * 0.25;
        B.armR.rotation.z = 2.5 + w * 0.25;
        B.hips.position.y = 0.95 + Math.max(0, Math.sin(t * 7 + this.phase)) * 0.12;
        B.head.rotation.x = -0.2;
        break;
      }
      case 'fist': {
        B.armR.rotation.x = 2.6 + Math.sin(t * 16) * 0.15;
        B.foreR.rotation.x = 0.6;
        B.torso.rotation.x = -0.05;
        break;
      }
      case 'dazed': {
        B.torso.rotation.z = Math.sin(t * 3) * 0.12;
        B.head.rotation.z = Math.sin(t * 3 + 1) * 0.2;
        B.armL.rotation.z = -0.3; B.armR.rotation.z = 0.3;
        if (this.stars) this.stars.rotation.y += dt * 4;
        break;
      }
      case 'push': {
        walkCycle(Math.max(3, speed * 3.3), 0.35, 0, 0.12);
        B.armL.rotation.x = B.armR.rotation.x = 1.3;
        B.foreL.rotation.x = B.foreR.rotation.x = 0.2;
        break;
      }
      case 'steal': {
        B.armR.rotation.x = 1.5 + Math.sin(t * 20) * 0.5;
        B.foreR.rotation.x = 0.4;
        B.armL.rotation.x = 1.0;
        break;
      }
      case 'swim': {
        B.root.rotation.x = -1.2;
        B.armL.rotation.x = Math.sin(t * 6) * 2;
        B.armR.rotation.x = -Math.sin(t * 6) * 2;
        break;
      }
    }
    this.capeSwing += (capeTarget - this.capeSwing) * Math.min(1, dt * 6);
    B.cape.rotation.x = -(this.capeSwing + Math.sin(t * 9 + this.phase) * 0.05 * (0.3 + speed * 0.1));
  }
}

// ---------------------------------------------------------------- udseender
const SKINS = ['#f1c7a5', '#e9b48f', '#d49a72', '#b5835e', '#8d5a3b', '#f3d2b8'];
const HAIRS = ['#2e2420', '#5a3a22', '#8a5a33', '#c9a24a', '#e8c35a', '#1d1512', '#9c9c9c', '#b0412a'];
const SHIRTS = ['#3b5b8c', '#6b8f3a', '#d9d4c7', '#2f2f35', '#8c3b5b', '#e0a030', '#4a7f8c', '#f0f0f0', '#7a4a8c'];
const PANTS = ['#2f3d5c', '#1f2226', '#5b4a3a', '#6a7078', '#3a4f7a'];

export function randomPedestrianLook(r: () => number): Look {
  const female = r() < 0.5;
  const fan = r() < 0.4; // kampdag: mange er i rød-hvidt
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: female ? pick(['long', 'bun', 'long', 'short'] as const) : pick(['short', 'short', 'bald', 'mohawk'] as const),
    shirt: fan ? '#c8102e' : pick(SHIRTS),
    shirtStyle: fan ? 'dk' : pick(['plain', 'plain', 'stripes', 'hoodie'] as const),
    pants: pick(PANTS),
    shorts: false,
    shoes: pick(['#222222', '#f2f2f2', '#6b4a2e']),
    hat: fan && r() < 0.35 ? (r() < 0.5 ? 'jester' : 'viking') : r() < 0.12 ? 'cap' : 'none',
    hatColor: pick(['#c8102e', '#223355', '#f2f2f2']),
    cape: fan && r() < 0.3 ? 'dk' : 'none',
    facePaint: fan && r() < 0.5 ? 'dk-cheeks' : 'none',
    beard: !female && r() < 0.25,
    belly: !female && r() < 0.25 ? 0.6 : 0,
    female,
    glasses: r() < 0.15,
    scale: 0.92 + r() * 0.14,
  };
}

export function hooliganLook(r: () => number): Look {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(['#f1c7a5', '#f3d2b8', '#e9b48f']),
    hair: pick(['#e8c35a', '#c9a24a', '#8a5a33']),
    hairStyle: pick(['short', 'bald', 'mohawk'] as const),
    shirt: '#fecc00',
    shirtStyle: 'se',
    shirtText: pick(['SVERIGE', 'ZLATAN', 'BLÅGUL']),
    pants: '#006aa7',
    shorts: true,
    socks: '#fecc00',
    shoes: '#222222',
    hat: r() < 0.7 ? 'bucket' : 'none',
    hatColor: '#006aa7',
    cape: r() < 0.3 ? 'se' : 'none',
    facePaint: 'se-cheeks',
    beard: r() < 0.4,
    belly: r() < 0.4 ? 0.8 : 0.2,
    female: false,
    scale: 1.02 + r() * 0.08,
  };
}

export function policeLook(r: () => number): Look {
  const female = r() < 0.35;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: female ? 'bun' : 'short',
    shirt: '#1b2a4a',
    shirtStyle: 'police',
    pants: '#1b2a4a',
    shorts: false,
    shoes: '#111111',
    hat: 'police',
    cape: 'none',
    facePaint: 'none',
    beard: false,
    belly: 0,
    female,
    scale: 1.0,
  };
}
