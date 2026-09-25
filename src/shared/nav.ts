// Gang-/cykelnetværk (fra OSM-veje) med nærmeste-knude-opslag og A*.
import type { NavGraph, V2 } from './cityTypes.ts';
import { GridIndex } from './geom.ts';

export interface NavEdge {
  to: number;
  len: number;
  w: number;
}

export class NavIndex {
  readonly nodes: V2[];
  readonly adj: NavEdge[][];
  private grid = new GridIndex<number>(24);

  /** costMul: valgfri omkostningsfaktor pr. kant (fx for at foretrække gågader). */
  constructor(g: NavGraph, costMul?: number[]) {
    this.nodes = g.nodes;
    this.adj = g.nodes.map(() => []);
    for (let i = 0; i < g.edges.length; i++) {
      const [a, b, w] = g.edges[i];
      const len = Math.hypot(g.nodes[a][0] - g.nodes[b][0], g.nodes[a][1] - g.nodes[b][1]) * (costMul?.[i] ?? 1);
      this.adj[a].push({ to: b, len, w });
      this.adj[b].push({ to: a, len, w });
    }
    g.nodes.forEach((p, i) => this.grid.insert(i, p[0], p[1], p[0], p[1]));
  }

  nearest(p: V2, maxR = 200): number {
    let best = -1, bestD = Infinity;
    for (let r = 24; r <= maxR && best < 0; r *= 2) {
      for (const i of this.grid.query(p[0], p[1], r)) {
        const n = this.nodes[i];
        const d = (n[0] - p[0]) ** 2 + (n[1] - p[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** A* fra knude a til b. Returnerer knudeliste (inkl. a og b) eller null. */
  path(a: number, b: number, maxExpand = 20000): number[] | null {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const target = this.nodes[b];
    const h = (i: number) => Math.hypot(this.nodes[i][0] - target[0], this.nodes[i][1] - target[1]);
    const heap = new MinHeap();
    g[a] = 0;
    heap.push(a, h(a));
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === b) {
        const out = [b];
        let c = b;
        while (came[c] >= 0) out.push((c = came[c]));
        return out.reverse();
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > maxExpand) return null;
      for (const e of this.adj[cur]) {
        const ng = g[cur] + e.len;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = cur;
          heap.push(e.to, ng + h(e.to));
        }
      }
    }
    return null;
  }

  edgeWidth(a: number, b: number): number {
    for (const e of this.adj[a]) if (e.to === b) return e.w;
    return 3;
  }
}

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    this.ids.push(id);
    this.pri.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.pri[par] <= this.pri[i]) break;
      this.swap(i, par);
      i = par;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastP = this.pri.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.pri[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number) {
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
    [this.pri[i], this.pri[j]] = [this.pri[j], this.pri[i]];
  }
}
