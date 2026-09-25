// Vejvisning: GPS-rute til fanzonen og tips i første runde.
import type { V2 } from '../shared/cityTypes.ts';
import type { NavIndex } from '../shared/nav.ts';

/** Genberegner ruten (A* på gangnettet) højst én gang i sekundet. */
export class RouteFinder {
  private nav: NavIndex;
  private next = 0;
  route: V2[] | null = null;

  constructor(nav: NavIndex) {
    this.nav = nav;
  }

  reset() {
    this.route = null;
    this.next = 0;
  }

  update(now: number, from: V2, to: V2): V2[] | null {
    if (now < this.next) return this.route;
    this.next = now + 1;
    const a = this.nav.nearest(from), b = this.nav.nearest(to);
    const path = this.nav.path(a, b, 30000);
    this.route = path ? [from, ...path.map((i) => this.nav.nodes[i]), to] : null;
    return this.route;
  }
}

export interface Hint {
  at: number; // sekunder inde i runden
  text: string;
}

/** Korte tips i den første runde (vises kun én gang pr. besøg). */
export const FIRST_ROUND_HINTS: Hint[] = [
  { at: 3, text: 'Følg de gule lysstråler – der står en kold fadøl for enden af hver.' },
  { at: 14, text: 'Hurtigere frem? Tryk <span class="key">E</span> ved en cykel – eller bryd en bil op (pas på politiet).' },
  { at: 30, text: 'Stilladser, containere og halvtage har fadøl på toppen. Hop og tryk mod kanten for at trække dig op.' },
  { at: 50, text: 'Svenske hooligans vil have dine fadøl. Løb fra dem med <span class="key">Shift</span> – eller giv dem tre på skrinet.' },
  { at: 75, text: 'Tryk <span class="key">M</span> for at se hele kortet med alle fadøl.' },
];
