// Minikort (roterer med kameraet) og stort kort (M). Byen forudtegnes én gang til et lærred.
import type { CityData, RoadKind } from '../shared/cityTypes.ts';

export interface MapDot {
  x: number;
  z: number;
  kind: 'beer' | 'cart' | 'cop' | 'hool' | 'car' | 'fanzone';
}

const PX = 1.2; // pixel pr. meter i grundkortet
const ROAD: Record<RoadKind, string> = {
  major: '#8b93a3', street: '#7b8394', service: '#646c7b', pedestrian: '#c9b98f', footway: '#566070', cycleway: '#566070', steps: '#566070', path: '#4f6a4b',
};

export class MapRenderer {
  readonly base: HTMLCanvasElement;
  private readonly city: CityData;
  private readonly ox: number;
  private readonly oz: number;

  constructor(city: CityData) {
    this.city = city;
    const b = city.bounds;
    this.ox = b.minX;
    this.oz = b.minZ;
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil((b.maxX - b.minX) * PX);
    this.base.height = Math.ceil((b.maxZ - b.minZ) * PX);
    this.drawBase();
  }

  private X(x: number) { return (x - this.ox) * PX; }
  private Z(z: number) { return (z - this.oz) * PX; }

  private drawBase() {
    const g = this.base.getContext('2d')!;
    const c = this.city;
    g.fillStyle = '#39414f';
    g.fillRect(0, 0, this.base.width, this.base.height);
    const poly = (pts: [number, number][], fill: string) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(this.X(p[0]), this.Z(p[1])) : g.moveTo(this.X(p[0]), this.Z(p[1]))));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    for (const a of c.areas) {
      const col = a.kind === 'water' ? '#3f8fc4' : a.kind === 'pool' ? '#6fb2d6' : a.kind === 'square' ? '#6f6a5c' : a.kind === 'parking' ? '#4a515e' : '#4f7d45';
      poly(a.outer, col);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const order: RoadKind[] = ['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'service', 'street', 'major'];
    for (const k of order) {
      g.strokeStyle = ROAD[k];
      for (const r of c.roads) {
        if (r.kind !== k) continue;
        g.lineWidth = Math.max(1.2, r.w * PX * 0.9);
        g.beginPath();
        r.pts.forEach((p, i) => (i ? g.lineTo(this.X(p[0]), this.Z(p[1])) : g.moveTo(this.X(p[0]), this.Z(p[1]))));
        g.stroke();
      }
    }
    for (const b of c.buildings) poly(b.outer, b.landmark ? '#a3524a' : '#1f2530');
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (const b of c.buildings) {
      g.beginPath();
      b.outer.forEach((p, i) => (i ? g.lineTo(this.X(p[0]), this.Z(p[1])) : g.moveTo(this.X(p[0]), this.Z(p[1]))));
      g.closePath();
      g.stroke();
    }
    // Navne på pladser og landemærker
    g.font = 'bold 15px Nunito, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    const lbl: [string, [number, number]][] = [
      ['Store Torv', c.squares.storeTorv], ['Bispetorv', c.squares.bispetorv], ['Rådhuspladsen', c.squares.raadhuspladsen], ['Banegården', c.squares.banegaardspladsen],
    ];
    for (const [t, p] of lbl) g.fillText(t, this.X(p[0]), this.Z(p[1]) - 10);
  }

  /** Minikort centreret om spilleren, roteret så kameraets retning peger op. */
  drawMini(cv: HTMLCanvasElement, px: number, pz: number, camYaw: number, playerYaw: number, dots: MapDot[], fanzone: { x: number; z: number } | null) {
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    const scale = W / 260; // ~260 m på tværs
    g.save();
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#39414f';
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.rotate(camYaw);
    g.scale(scale / PX, scale / PX);
    g.drawImage(this.base, -this.X(px), -this.Z(pz));
    g.restore();
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = (x - px) * scale, dz = (z - pz) * scale;
      const c = Math.cos(camYaw), s = Math.sin(camYaw);
      return [W / 2 + dx * c - dz * s, H / 2 + dx * s + dz * c];
    };
    for (const d of dots) {
      const [sx, sy] = toScreen(d.x, d.z);
      if (Math.hypot(sx - W / 2, sy - H / 2) > W / 2 - 6) continue;
      drawDot(g, sx, sy, d.kind, 1);
    }
    if (fanzone) {
      const [sx, sy] = toScreen(fanzone.x, fanzone.z);
      const r = W / 2 - 14;
      const dx = sx - W / 2, dy = sy - H / 2;
      const dd = Math.hypot(dx, dy);
      if (dd > r) drawArrow(g, W / 2 + (dx / dd) * r, H / 2 + (dy / dd) * r, Math.atan2(dy, dx));
      else drawDot(g, sx, sy, 'fanzone', 1.3);
    }
    // spiller
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(camYaw - playerYaw);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 9);
    g.lineTo(0, 4);
    g.lineTo(-8, 9);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#c8102e';
    g.lineWidth = 3;
    g.stroke();
    g.fill();
    g.restore();
    // nord
    const [nx, ny] = [W / 2 + Math.sin(camYaw) * (W / 2 - 12), H / 2 - Math.cos(camYaw) * (H / 2 - 12)];
    g.font = 'bold 14px Nunito, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText('N', nx, ny);
  }

  /** Stort kort, nord op. */
  drawBig(cv: HTMLCanvasElement, px: number, pz: number, playerYaw: number, dots: MapDot[], fanzone: { x: number; z: number } | null) {
    const g = cv.getContext('2d')!;
    const k = cv.width / this.base.width;
    g.drawImage(this.base, 0, 0, cv.width, cv.height);
    const S = (x: number, z: number): [number, number] => [this.X(x) * k, this.Z(z) * k];
    for (const d of dots) {
      const [sx, sy] = S(d.x, d.z);
      drawDot(g, sx, sy, d.kind, 1.2);
    }
    if (fanzone) {
      const [sx, sy] = S(fanzone.x, fanzone.z);
      drawDot(g, sx, sy, 'fanzone', 2);
    }
    const [sx, sy] = S(px, pz);
    g.save();
    g.translate(sx, sy);
    g.rotate(-playerYaw);
    g.beginPath();
    g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath();
    g.fillStyle = '#fff'; g.strokeStyle = '#c8102e'; g.lineWidth = 3; g.stroke(); g.fill();
    g.restore();
  }
}

const DOT: Record<MapDot['kind'], [string, number]> = {
  beer: ['#f2b233', 4], cart: ['#ff8a00', 6], cop: ['#3d7bff', 5], hool: ['#fecc00', 4.5], car: ['#d0d4dc', 3], fanzone: ['#2fbf71', 8],
};

function drawDot(g: CanvasRenderingContext2D, x: number, y: number, kind: MapDot['kind'], s: number) {
  const [c, r] = DOT[kind];
  g.beginPath();
  if (kind === 'hool') {
    g.moveTo(x, y - r * s * 1.3); g.lineTo(x + r * s * 1.2, y + r * s); g.lineTo(x - r * s * 1.2, y + r * s); g.closePath();
    g.fillStyle = c; g.fill(); g.strokeStyle = '#006aa7'; g.lineWidth = 2; g.stroke();
    return;
  }
  g.arc(x, y, r * s, 0, Math.PI * 2);
  g.fillStyle = c;
  g.fill();
  g.strokeStyle = kind === 'fanzone' ? '#fff' : 'rgba(0,0,0,0.6)';
  g.lineWidth = kind === 'fanzone' ? 3 : 1.5;
  g.stroke();
}

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, ang: number) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(10, 0); g.lineTo(-7, -8); g.lineTo(-3, 0); g.lineTo(-7, 8); g.closePath();
  g.fillStyle = '#2fbf71'; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
  g.stroke(); g.fill();
  g.restore();
}
