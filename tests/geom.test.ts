import { describe, expect, it } from 'vitest';
import type { V2 } from '../src/shared/cityTypes.ts';
import { centroid, clipHalfPlane, cleanRing, minAreaRect, pointInPolygon, pointInShape, polylineLength, pointAlong, signedArea, withWinding, headingOf } from '../src/shared/geom.ts';
import { NavIndex } from '../src/shared/nav.ts';

const square: V2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('geometri', () => {
  it('areal og vikling', () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea(withWinding(square, false))).toBe(-100);
  });

  it('punkt i polygon med huller', () => {
    const hole: V2[] = [[4, 4], [6, 4], [6, 6], [4, 6]];
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInShape([5, 5], square, [hole])).toBe(false);
    expect(pointInShape([2, 2], square, [hole])).toBe(true);
  });

  it('rydder dubletter og kolineære punkter', () => {
    const r = cleanRing([[0, 0], [5, 0], [10, 0], [10, 10], [10, 10], [0, 10], [0, 0]]);
    expect(r.length).toBe(4);
  });

  it('tyngdepunkt og minimum-rektangel', () => {
    expect(centroid(square)).toEqual([5, 5]);
    const rot: V2[] = [[0, 0], [8, 6], [5, 10], [-3, 4]]; // 10×5 rektangel drejet
    const o = minAreaRect(rot);
    expect(o.halfLen).toBeCloseTo(5, 5);
    expect(o.halfWid).toBeCloseTo(2.5, 5);
    expect(o.fill).toBeCloseTo(1, 5);
  });

  it('klipper polygon med halvplan (til saddeltage)', () => {
    const left = clipHalfPlane(square, [1, 0], 5);
    expect(Math.abs(signedArea(left))).toBeCloseTo(50);
  });

  it('punkter langs en polylinje', () => {
    const line: V2[] = [[0, 0], [10, 0], [10, 10]];
    expect(polylineLength(line)).toBe(20);
    expect(pointAlong(line, 15).pt).toEqual([10, 5]);
  });

  it('retning: 0 = nord (-z)', () => {
    expect(headingOf([0, -1])).toBeCloseTo(0);
    expect(Math.abs(headingOf([0, 1]))).toBeCloseTo(Math.PI);
  });
});

describe('navigation (A*)', () => {
  // 0 —— 1 —— 2
  //  \         |
  //   3 ——————-4   (omvej)
  const nav = new NavIndex({
    nodes: [[0, 0], [10, 0], [20, 0], [0, 10], [20, 10]],
    edges: [[0, 1, 3], [1, 2, 3], [0, 3, 3], [3, 4, 3], [4, 2, 3]],
  });

  it('finder korteste vej', () => {
    expect(nav.path(0, 2)).toEqual([0, 1, 2]);
  });

  it('finder nærmeste knude', () => {
    expect(nav.nearest([19, 9])).toBe(4);
  });

  it('omkostningsfaktor kan tvinge en omvej', () => {
    const costly = new NavIndex(
      { nodes: [[0, 0], [10, 0], [20, 0], [0, 10], [20, 10]], edges: [[0, 1, 3], [1, 2, 3], [0, 3, 3], [3, 4, 3], [4, 2, 3]] },
      [10, 10, 1, 1, 1],
    );
    expect(costly.path(0, 2)).toEqual([0, 3, 4, 2]);
  });

  it('returnerer null uden forbindelse', () => {
    const iso = new NavIndex({ nodes: [[0, 0], [5, 5]], edges: [] });
    expect(iso.path(0, 1)).toBeNull();
  });
});
