import { describe, expect, it } from 'vitest';
import { RULES } from '../src/config.ts';
import { Round, Wanted, arrestPenalty, formatPoints, formatTime, latePenalty } from '../src/game/rules.ts';

describe('point og straffe', () => {
  it('giver 100 point pr. fadøl', () => {
    const r = new Round(() => 0);
    r.addBeer();
    r.addBeer();
    expect(r.points).toBe(200);
    expect(r.beers).toBe(2);
    expect(r.stats.beersCollected).toBe(2);
  });

  it('anholdelse koster 10 % pr. stjerne', () => {
    expect(arrestPenalty(1000, 1)).toBe(100);
    expect(arrestPenalty(1000, 3)).toBe(300);
    expect(arrestPenalty(1000, 5)).toBe(300); // maks 3 stjerner
    const r = new Round(() => 0);
    for (let i = 0; i < 17; i++) r.addBeer();
    expect(r.arrest(2)).toBe(340);
    expect(r.points).toBe(1360);
    expect(r.stats.pointsLostToPolice).toBe(340);
  });

  it('for sent til kickoff = halvdelen af pointene', () => {
    expect(latePenalty(1700)).toBe(850);
    const r = new Round(() => 0);
    for (let i = 0; i < 5; i++) r.addBeer();
    const ev = r.tick(RULES.roundSeconds + 1);
    expect(ev.some((e) => e.type === 'reveal')).toBe(true);
    expect(ev.find((e) => e.type === 'finished')).toEqual({ type: 'finished', outcome: 'late', lost: 250 });
    expect(r.points).toBe(250);
    expect(r.outcome).toBe('late');
  });

  it('fanzonen afsløres i det sidste minut og kan først nås derefter', () => {
    const r = new Round(() => 0.5);
    expect(r.reachFanzone()).toBeNull();
    r.tick(RULES.roundSeconds - RULES.fanzoneRevealSeconds - 1);
    expect(r.revealed).toBe(false);
    const ev = r.tick(1.5);
    expect(ev).toContainEqual({ type: 'reveal', fanzone: r.fanzone });
    expect(r.reachFanzone()).toEqual({ type: 'finished', outcome: 'ontime', lost: 0 });
    expect(r.finished).toBe(true);
    expect(r.tick(100)).toEqual([]);
  });

  it('fanzonen er en af de tre pladser', () => {
    const seen = new Set<string>();
    for (const x of [0, 0.34, 0.67, 0.999]) seen.add(new Round(() => x).fanzone);
    expect([...seen].sort()).toEqual(['bispetorv', 'raadhuspladsen', 'storeTorv']);
  });

  it('tabt fadøl fjerner 100 point, men aldrig under 0 fadøl', () => {
    const r = new Round(() => 0);
    expect(r.loseBeer()).toBe(false);
    r.addBeer();
    expect(r.loseBeer()).toBe(true);
    expect(r.points).toBe(0);
    r.addBeer(true);
    expect(r.stats.beersRecovered).toBe(1);
  });
});

describe('politiets stjerner', () => {
  it('stiger til maks 3 og nulstilles ved anholdelse med immunitet', () => {
    const w = new Wanted();
    w.offense(); w.offense(); w.offense(); w.offense();
    expect(w.stars).toBe(3);
    w.arrested();
    expect(w.stars).toBe(0);
    expect(w.offense()).toBeNull(); // immun i 5 sekunder
    w.update(RULES.arrestImmunitySeconds + 0.1, false);
    expect(w.offense()).toEqual({ type: 'stars', stars: 1 });
  });

  it('man slipper væk efter at have været ude af syne længe nok', () => {
    const w = new Wanted();
    w.offense();
    expect(w.update(w.escapeTime() - 1, false)).toBeNull();
    expect(w.update(0.5, true)).toBeNull(); // set igen → timer nulstilles
    expect(w.update(w.escapeTime() - 0.1, false)).toBeNull();
    expect(w.update(0.2, false)).toEqual({ type: 'escaped' });
    expect(w.stars).toBe(0);
  });
});

describe('formattering', () => {
  it('viser tid som m:ss og point med dansk tusindtalsseparator', () => {
    expect(formatTime(300)).toBe('5:00');
    expect(formatTime(59.2)).toBe('1:00');
    expect(formatTime(0)).toBe('0:00');
    expect(formatPoints(12500)).toMatch(/^12.500$/);
  });
});
