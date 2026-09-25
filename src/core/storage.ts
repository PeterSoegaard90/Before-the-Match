// Indstillinger og lokal highscore i localStorage. Alt er pakket ind i try/catch,
// så spillet virker, selv hvis browseren blokerer lagring.

export interface Settings {
  sensitivity: number; // 0.2 – 3
  volume: number; // 0 – 1
  invertY: boolean;
}

export interface ScoreEntry {
  name: string;
  roligan: string;
  points: number;
  beers: number;
  onTime: boolean;
  date: string;
}

const SETTINGS_KEY = 'btm.settings.v1';
const SCORES_KEY = 'btm.highscores.v1';
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, volume: 0.8, invertY: false };

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignorer */
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  return {
    sensitivity: clampNum(s.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    volume: clampNum(s.volume, 0, 1, DEFAULT_SETTINGS.volume),
    invertY: typeof s.invertY === 'boolean' ? s.invertY : DEFAULT_SETTINGS.invertY,
  };
}

export function saveSettings(s: Settings) {
  write(SETTINGS_KEY, s);
}

export function loadScores(): ScoreEntry[] {
  const list = read<ScoreEntry[]>(SCORES_KEY);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.points === 'number').slice(0, 10) : [];
}

/** Indsætter en score og returnerer (ny liste, placering 0-baseret eller -1). */
export function addScore(entry: ScoreEntry): { list: ScoreEntry[]; rank: number } {
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => b.points - a.points || b.beers - a.beers);
  const top = list.slice(0, 10);
  write(SCORES_KEY, top);
  return { list: top, rank: top.indexOf(entry) };
}

export function qualifies(points: number): boolean {
  const list = loadScores();
  return list.length < 10 || points > list[list.length - 1].points;
}

function clampNum(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}
