// Ren spillogik (ingen grafik) – kan unit-testes.
import { RULES } from '../config.ts';
import type { SquareId } from '../shared/cityTypes.ts';

export const FANZONES: SquareId[] = ['storeTorv', 'raadhuspladsen', 'bispetorv'];
export const FANZONE_NAMES: Record<SquareId, string> = {
  storeTorv: 'Store Torv',
  raadhuspladsen: 'Rådhuspladsen',
  bispetorv: 'Bispetorv',
  banegaardspladsen: 'Banegårdspladsen',
};

export function arrestPenalty(points: number, stars: number): number {
  return Math.round(points * RULES.arrestPenaltyPerStar * Math.max(0, Math.min(RULES.maxStars, stars)));
}

export function latePenalty(points: number): number {
  return Math.floor(points * RULES.latePenaltyFraction);
}

export interface RoundStats {
  beersCollected: number;
  beersDropped: number;
  beersRecovered: number;
  arrests: number;
  pointsLostToPolice: number;
  hooligansKO: number;
  pedestriansKnocked: number;
  carsStolen: number;
  bikesTaken: number;
  splashes: number;
  maxStars: number;
}

export type RoundEvent =
  | { type: 'reveal'; fanzone: SquareId }
  | { type: 'finished'; outcome: 'ontime' | 'late'; lost: number }
  | { type: 'minute'; left: number };

export class Round {
  timeLeft: number = RULES.roundSeconds;
  points = 0;
  beers = 0;
  readonly fanzone: SquareId;
  revealed = false;
  finished = false;
  outcome: 'ontime' | 'late' | null = null;
  readonly stats: RoundStats = {
    beersCollected: 0, beersDropped: 0, beersRecovered: 0, arrests: 0, pointsLostToPolice: 0,
    hooligansKO: 0, pedestriansKnocked: 0, carsStolen: 0, bikesTaken: 0, splashes: 0, maxStars: 0,
  };

  constructor(rand: () => number = Math.random) {
    this.fanzone = FANZONES[Math.floor(rand() * FANZONES.length) % FANZONES.length];
  }

  addBeer(recovered = false) {
    if (this.finished) return;
    this.beers++;
    this.points += RULES.pointsPerBeer;
    if (recovered) this.stats.beersRecovered++;
    else this.stats.beersCollected++;
  }

  /** Hooligan slår en fadøl ud af hånden. Returnerer true hvis der var en at tabe. */
  loseBeer(): boolean {
    if (this.finished || this.beers <= 0) return false;
    this.beers--;
    this.points = Math.max(0, this.points - RULES.pointsPerBeer);
    this.stats.beersDropped++;
    return true;
  }

  arrest(stars: number): number {
    if (this.finished) return 0;
    const p = arrestPenalty(this.points, stars);
    this.points -= p;
    this.stats.arrests++;
    this.stats.pointsLostToPolice += p;
    return p;
  }

  reachFanzone(): RoundEvent | null {
    if (this.finished || !this.revealed) return null;
    this.finished = true;
    this.outcome = 'ontime';
    return { type: 'finished', outcome: 'ontime', lost: 0 };
  }

  tick(dt: number): RoundEvent[] {
    if (this.finished) return [];
    const ev: RoundEvent[] = [];
    const before = this.timeLeft;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const m of [240, 180, 120]) if (before > m && this.timeLeft <= m) ev.push({ type: 'minute', left: m });
    if (!this.revealed && this.timeLeft <= RULES.fanzoneRevealSeconds) {
      this.revealed = true;
      ev.push({ type: 'reveal', fanzone: this.fanzone });
    }
    if (this.timeLeft <= 0) {
      this.finished = true;
      this.outcome = 'late';
      const lost = latePenalty(this.points);
      this.points -= lost;
      ev.push({ type: 'finished', outcome: 'late', lost });
    }
    return ev;
  }
}

export type WantedEvent = { type: 'stars'; stars: number } | { type: 'escaped' };

/** Politiets stjerner: forbrydelser set af en betjent giver +1 (maks 3). */
export class Wanted {
  stars = 0;
  unseenFor = 0;
  immunity = 0;

  offense(): WantedEvent | null {
    if (this.immunity > 0) return null;
    const before = this.stars;
    this.stars = Math.min(RULES.maxStars, this.stars + 1);
    this.unseenFor = 0;
    return this.stars !== before ? { type: 'stars', stars: this.stars } : null;
  }

  /** Sekunder uden for synsvidde før man er sluppet væk. */
  escapeTime(): number {
    return 7 + 3 * this.stars;
  }

  update(dt: number, seen: boolean): WantedEvent | null {
    this.immunity = Math.max(0, this.immunity - dt);
    if (this.stars === 0) return null;
    if (seen) this.unseenFor = 0;
    else this.unseenFor += dt;
    if (this.unseenFor >= this.escapeTime()) {
      this.stars = 0;
      this.unseenFor = 0;
      return { type: 'escaped' };
    }
    return null;
  }

  arrested() {
    this.stars = 0;
    this.unseenFor = 0;
    this.immunity = RULES.arrestImmunitySeconds;
  }
}

export function formatTime(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function formatPoints(p: number): string {
  return Math.round(p).toLocaleString('da-DK');
}
