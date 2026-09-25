// Kulissebyen uden for spilområdet: enkle klodser med vinduer, så horisonten ikke slutter brat.
import * as THREE from 'three';
import type { CityData } from '../shared/cityTypes.ts';
import { GeoBuilder, color } from './geo.ts';
import { FACADE, facadeCode, makeFacadeMaterial } from './materials.ts';

const COLORS = ['#cdb68c', '#a9553f', '#e2dccf', '#c9a58f', '#bdb7aa', '#8f4a3c', '#d8c49a', '#aab4b8', '#e8e2d4', '#b8705a', '#c7c0b0', '#9fa9ad'];

export function buildBackdrop(city: CityData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const gb = new GeoBuilder({ facade: true });
  const roof = color('#7d7d7a');
  for (const b of city.backdrop) {
    const wall = color(COLORS[b.c % COLORS.length]);
    const code = facadeCode(FACADE.RESIDENTIAL, (b.c * 0.083) % 1);
    for (let i = 0; i < b.outer.length; i++) {
      const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = L < 2 ? 0 : Math.max(1, Math.round(L / 3.2));
      gb.wall(p, q, 0, b.h, 0, b.h, wall, { u0: n ? 0 : -1, u1: n ? n : -1, style: code });
    }
    gb.polygon(b.outer, [], b.h, roof, true);
  }
  const mesh = new THREE.Mesh(gb.build(), makeFacadeMaterial());
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  return group;
}
