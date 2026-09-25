// Kontrol af de genererede bydata (public/data/city.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData, V2 } from '../src/shared/cityTypes.ts';
import { GridIndex, bbox, dist, pointInShape } from '../src/shared/geom.ts';
import { NavIndex } from '../src/shared/nav.ts';

const city = JSON.parse(readFileSync('public/data/city.json', 'utf8')) as CityData;
const idx = new GridIndex<CityData['buildings'][number]>(30);
for (const b of city.buildings) {
  const bb = bbox(b.outer);
  idx.insert(b, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
}
const inside = (p: V2) => idx.query(p[0], p[1]).some((b) => pointInShape(p, b.outer, b.holes));
const water = city.areas.filter((a) => a.kind === 'water');
const wet = (p: V2) => water.some((a) => pointInShape(p, a.outer, a.holes));

describe('bydata', () => {
  it('indeholder hele Midtbyen', () => {
    expect(city.buildings.length).toBeGreaterThan(1200);
    expect(city.roads.length).toBeGreaterThan(1000);
    expect(city.trees.length).toBeGreaterThan(500);
    expect(city.attribution).toMatch(/OpenStreetMap/);
  });

  it('har alle fem landemærker + parkeringshuset', () => {
    const ids = new Set(city.buildings.map((b) => b.landmark).filter(Boolean));
    for (const id of ['domkirken', 'aros', 'raadhus', 'teater', 'salling', 'parkeringshus']) expect(ids.has(id as never)).toBe(true);
  });

  it('barer står frit (ikke i bygninger eller vand) og har opdigtede navne', () => {
    const ground = city.bars.filter((b) => !b.y);
    expect(ground.length).toBeGreaterThan(40);
    for (const b of ground) {
      expect(inside(b.pos), b.name).toBe(false);
      expect(wet(b.pos), b.name).toBe(false);
    }
    const names = city.bars.map((b) => b.name);
    for (const real of ['Clemens Bar', 'Teaterkatten']) expect(names).not.toContain(real);
    expect(city.bars.some((b) => b.name === 'Tagterrassen' && b.y === city.sallingRoof.y)).toBe(true);
  });

  it('start, pladser og politistation er tilgængelige', () => {
    for (const p of [city.spawn.pos, city.policeStation, ...Object.values(city.squares)]) {
      expect(inside(p as V2)).toBe(false);
      expect(wet(p as V2)).toBe(false);
    }
    const fz = [city.squares.storeTorv, city.squares.bispetorv, city.squares.raadhuspladsen];
    expect(dist(fz[0], fz[2])).toBeGreaterThan(200); // fanzonerne ligger forskellige steder
  });

  it('parkerede køretøjer står ikke i huse eller vand', () => {
    const cars = city.parking.filter((p) => p.kind === 'car');
    expect(cars.length).toBeGreaterThan(50);
    expect(city.parking.filter((p) => p.kind === 'bike').length).toBeGreaterThan(30);
    expect(city.parking.filter((p) => p.kind === 'cargo').length).toBeGreaterThanOrEqual(3);
    for (const p of city.parking) {
      expect(inside(p.pos)).toBe(false);
      expect(wet(p.pos)).toBe(false);
    }
  });

  it('gangnettet hænger sammen fra start til alle fanzoner og barer', () => {
    const nav = new NavIndex(city.nav);
    const s = nav.nearest(city.spawn.pos);
    for (const p of [city.squares.storeTorv, city.squares.bispetorv, city.squares.raadhuspladsen, city.policeStation]) {
      expect(nav.path(s, nav.nearest(p as V2), 1e6)).not.toBeNull();
    }
  });

  it('platforme, vognruter, spiralrampe og gangbro findes', () => {
    expect(city.platforms.length).toBeGreaterThanOrEqual(10);
    expect(new Set(city.platforms.map((p) => p.kind))).toEqual(new Set(['container', 'scaffold', 'awning']));
    expect(city.cartRoutes.length).toBe(3);
    expect(city.parkingHelix.top).toBe(city.sallingRoof.y);
    expect(dist(city.skybridge.a, city.skybridge.b)).toBeLessThan(15);
  });

  it('bygningshøjder er fornuftige', () => {
    for (const b of city.buildings) {
      expect(b.h).toBeGreaterThan(1.5);
      expect(b.h).toBeLessThan(120);
    }
  });
});
