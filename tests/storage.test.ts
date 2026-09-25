import { beforeEach, describe, expect, it } from 'vitest';

// Simpel localStorage til Node
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { addScore, loadScores, loadSettings, qualifies, saveSettings, DEFAULT_SETTINGS } = await import('../src/core/storage.ts');

const entry = (points: number, name = 'X') => ({ name, roligan: 'Bjarne', points, beers: points / 100, onTime: true, date: '2026-09-25' });

describe('highscore', () => {
  beforeEach(() => mem.clear());

  it('sorterer og beholder top 10', () => {
    for (let i = 1; i <= 12; i++) addScore(entry(i * 100, 'n' + i));
    const list = loadScores();
    expect(list.length).toBe(10);
    expect(list[0].points).toBe(1200);
    expect(list[9].points).toBe(300);
  });

  it('returnerer placering og kvalifikation', () => {
    for (let i = 1; i <= 10; i++) addScore(entry(i * 100));
    expect(qualifies(50)).toBe(false);
    expect(qualifies(150)).toBe(true);
    const { rank } = addScore(entry(550, 'Lone'));
    expect(rank).toBe(5);
  });

  it('tåler ødelagte data', () => {
    mem.set('btm.highscores.v1', '{ikke json');
    expect(loadScores()).toEqual([]);
  });
});

describe('indstillinger', () => {
  beforeEach(() => mem.clear());

  it('standardværdier og afgrænsning', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ sensitivity: 99, volume: -1, invertY: true });
    expect(loadSettings()).toEqual({ sensitivity: 3, volume: 0, invertY: true });
  });
});
