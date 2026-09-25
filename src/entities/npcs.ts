// Byens liv: fodgængere (mange i rød-hvidt), svenske hooligans i grupper,
// betjente til fods og på cykel samt fadølsvogne med sælgere.
import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { TUNING } from '../config.ts';
import type { V2 } from '../shared/cityTypes.ts';
import { rng } from '../shared/geom.ts';
import { G, RAPIER, groups, type Physics } from '../physics.ts';
import type { World } from '../world/world.ts';
import { Humanoid, hooliganLook, policeLook, randomPedestrianLook } from './humanoid.ts';

export type AgentKind = 'ped' | 'hool' | 'cop' | 'vendor';
export type AgentState = 'wander' | 'down' | 'getup' | 'angry' | 'chase' | 'attack' | 'return' | 'ko' | 'calm' | 'dodge' | 'wait';

export interface Bubble {
  text: string;
  agent: Agent;
  until: number;
}

const R = rng(99);

export class Agent {
  readonly kind: AgentKind;
  readonly model: Humanoid;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  state: AgentState = 'wander';
  stateTime = 0;
  // graf-vandring
  from = 0;
  to = 0;
  t = 0;
  // mål-styring
  path: number[] | null = null;
  pathIdx = 0;
  repath = 0;
  // diverse
  slide = new THREE.Vector3();
  hits = 0;
  lastHitAt = -99;
  attackCd = 0;
  lastSeen = -99;
  onBike = false;
  bike: THREE.Object3D | null = null;
  groupId = -1;
  leader: Agent | null = null;
  formation: V2 = [0, 0];
  dodged = false;
  kcc: RAPIER_T.KinematicCharacterController | null = null;
  collider: RAPIER_T.Collider | null = null;
  body: RAPIER_T.RigidBody | null = null;
  walkSpeed: number;
  losAt = -99;
  losOk = false;

  constructor(kind: AgentKind, model: Humanoid, walkSpeed: number) {
    this.kind = kind;
    this.model = model;
    this.walkSpeed = walkSpeed;
  }

  setState(s: AgentState) {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
    }
  }

  get busy() {
    return this.state === 'down' || this.state === 'getup' || this.state === 'ko';
  }
}

export interface NpcEvents {
  bubble: (b: Bubble) => void;
  hooliganHitPlayer: (h: Agent) => void;
  arrest: (cop: Agent) => void;
}

export class NpcManager {
  readonly peds: Agent[] = [];
  readonly hools: Agent[] = [];
  readonly cops: Agent[] = [];
  readonly vendors: { agent: Agent; cart: THREE.Group; route: V2[]; s: number; dir: number; len: number }[] = [];
  readonly group = new THREE.Group();
  private world: World;
  private physics: Physics;
  private edgeLat = new Map<string, number>();
  now = 0;
  events: NpcEvents;

  constructor(world: World, events: NpcEvents) {
    this.world = world;
    this.physics = world.physics;
    this.events = events;
    this.group.name = 'npcs';
    this.computeEdgeLaterals();
  }

  // ------------------------------------------------------------ opsætning
  private computeEdgeLaterals() {
    const nav = this.world.nav;
    nav.adj.forEach((edges, a) => {
      for (const e of edges) {
        const p = nav.nodes[a], q = nav.nodes[e.to];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
        const rx = -dz, rz = dx; // højre for kørselsretningen
        let best = 0;
        for (const off of [e.w / 2 + 0.9, e.w / 2, e.w / 3, 1.2, 0.6]) {
          let ok = true;
          for (const f of [0.25, 0.5, 0.75]) {
            const x = p[0] + (q[0] - p[0]) * f + rx * off, z = p[1] + (q[1] - p[1]) * f + rz * off;
            if (this.world.insideBuilding(x, z, 0.5) || this.world.water.isWater(x, z)) { ok = false; break; }
          }
          if (ok) { best = off; break; }
        }
        this.edgeLat.set(a + '-' + e.to, best);
      }
    });
  }

  private makeKcc(a: Agent) {
    a.body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(a.pos.x, a.pos.y + 0.9, a.pos.z));
    a.collider = this.physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(groups(G.NPC, G.STATIC)), a.body);
    a.kcc = this.physics.makeController(0.03);
    a.kcc.enableAutostep(0.45, 0.2, false);
    a.kcc.enableSnapToGround(0.4);
    a.kcc.setMaxSlopeClimbAngle(0.9);
  }

  private placeOnNode(a: Agent, node: number) {
    const nav = this.world.nav;
    a.from = node;
    const nb = nav.adj[node];
    a.to = nb.length ? nb[Math.floor(R() * nb.length)].to : node;
    a.t = 0;
    const p = nav.nodes[node];
    a.pos.set(p[0], 0, p[1]);
  }

  spawnPed(near: THREE.Vector3, minR: number, maxR: number): Agent | null {
    const nav = this.world.nav;
    for (let tries = 0; tries < 40; tries++) {
      const n = Math.floor(R() * nav.nodes.length);
      const p = nav.nodes[n];
      const d = Math.hypot(p[0] - near.x, p[1] - near.z);
      if (d < minR || d > maxR || nav.adj[n].length === 0) continue;
      const a = new Agent('ped', new Humanoid(randomPedestrianLook(R)), TUNING.pedestrianWalk * (0.8 + R() * 0.45));
      this.placeOnNode(a, n);
      a.t = R() * 0.8;
      this.peds.push(a);
      this.group.add(a.model.group);
      return a;
    }
    return null;
  }

  /** Flyt en fodgænger til et tilfældigt sted i en ring om spilleren. */
  private relocatePed(a: Agent, near: THREE.Vector3, minR: number, maxR: number) {
    const nav = this.world.nav;
    for (let tries = 0; tries < 30; tries++) {
      const n = Math.floor(R() * nav.nodes.length);
      const p = nav.nodes[n];
      const d = Math.hypot(p[0] - near.x, p[1] - near.z);
      if (d < minR || d > maxR || nav.adj[n].length === 0) continue;
      this.placeOnNode(a, n);
      a.t = R() * 0.8;
      a.setState('wander');
      a.model.setState('walk');
      return;
    }
  }

  spawnHooligans(count: number, avoid: THREE.Vector3) {
    const nav = this.world.nav;
    for (let gi = 0; gi < count; gi++) {
      let node = 0;
      for (let t = 0; t < 200; t++) {
        node = Math.floor(R() * nav.nodes.length);
        const p = nav.nodes[node];
        const far = Math.hypot(p[0] - avoid.x, p[1] - avoid.z) > 180;
        const spread = this.hools.every((h) => h.leader !== null || Math.hypot(h.pos.x - p[0], h.pos.z - p[1]) > 200);
        if (far && spread && nav.adj[node].length >= 2 && this.world.inPlayArea(p[0], p[1], 60)) break;
      }
      let leader: Agent | null = null;
      for (let k = 0; k < 3; k++) {
        const a = new Agent('hool', new Humanoid(hooliganLook(R)), TUNING.hooliganWalk);
        this.placeOnNode(a, node);
        a.groupId = gi;
        if (!leader) leader = a;
        else {
          a.leader = leader;
          a.formation = k === 1 ? [-0.9, 1.1] : [0.9, 1.1];
          a.pos.x += a.formation[0];
          a.pos.z += a.formation[1];
        }
        this.makeKcc(a);
        this.hools.push(a);
        this.group.add(a.model.group);
      }
    }
  }

  spawnPolice(onFoot: number, onBike: number, station: V2, bikeFactory: () => THREE.Object3D) {
    const nav = this.world.nav;
    const total = onFoot + onBike;
    for (let i = 0; i < total; i++) {
      const bike = i >= onFoot;
      const a = new Agent('cop', new Humanoid(policeLook(R)), bike ? 4.2 : 1.4);
      // spred betjentene ud over kortet; én gruppe starter ved politistationen
      let node = nav.nearest(station);
      if (i > 0) {
        for (let t = 0; t < 100; t++) {
          const n = Math.floor(R() * nav.nodes.length);
          const p = nav.nodes[n];
          if (this.world.inPlayArea(p[0], p[1], 60) && this.cops.every((c) => Math.hypot(c.pos.x - p[0], c.pos.z - p[1]) > 150)) { node = n; break; }
        }
      }
      this.placeOnNode(a, node);
      a.onBike = bike;
      if (bike) {
        a.bike = bikeFactory();
        a.model.group.add(a.bike);
        a.model.mesh.position.set(0, 0.08, 0.2);
      }
      this.makeKcc(a);
      this.cops.push(a);
      this.group.add(a.model.group);
    }
  }

  spawnVendors(routes: V2[][], cartFactory: () => THREE.Group) {
    for (const route of routes) {
      const look = randomPedestrianLook(R);
      look.shirt = '#f4f1ea';
      look.shirtStyle = 'plain';
      look.hat = 'cap';
      look.hatColor = '#c8102e';
      const a = new Agent('vendor', new Humanoid(look), 1.25);
      const cart = cartFactory();
      this.group.add(cart);
      this.group.add(a.model.group);
      let len = 0;
      for (let i = 1; i < route.length; i++) len += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
      this.vendors.push({ agent: a, cart, route, s: R() * len, dir: 1, len });
    }
  }

  // ------------------------------------------------------------ bevægelse
  /** Gå langs grafen (vandring). */
  private wander(a: Agent, dt: number, speed: number): void {
    const nav = this.world.nav;
    const p = nav.nodes[a.from], q = nav.nodes[a.to];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 0.01;
    a.t += (speed * dt) / L;
    if (a.t >= 1) {
      const prev = a.from;
      a.from = a.to;
      const nb = nav.adj[a.from];
      const opts = nb.filter((e) => e.to !== prev);
      if (opts.length === 0) a.to = prev;
      else {
        // foretræk at fortsætte ligeud
        const dx = q[0] - p[0], dz = q[1] - p[1];
        let pick = opts[Math.floor(R() * opts.length)];
        if (R() < 0.6) {
          let bestDot = -2;
          for (const e of opts) {
            const n = nav.nodes[e.to], c = nav.nodes[a.from];
            const ex = n[0] - c[0], ez = n[1] - c[1];
            const dot = (ex * dx + ez * dz) / ((Math.hypot(ex, ez) || 1) * (Math.hypot(dx, dz) || 1));
            if (dot > bestDot) { bestDot = dot; pick = e; }
          }
        }
        a.to = pick.to;
      }
      a.t = 0;
      return this.wander(a, 0, speed);
    }
    const lat = a.kind === 'ped' || a.kind === 'cop' ? this.edgeLat.get(a.from + '-' + a.to) ?? 0 : 0.6;
    const dist0 = a.t * L, dist1 = (1 - a.t) * L;
    const f = Math.min(1, dist0 / 3, dist1 / 3);
    const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
    const nx = p[0] + (q[0] - p[0]) * a.t + -dz * lat * f;
    const nz = p[1] + (q[1] - p[1]) * a.t + dx * lat * f;
    this.faceTowards(a, nx - a.pos.x, nz - a.pos.z, dt);
    a.pos.x = nx;
    a.pos.z = nz;
    a.pos.y = 0;
    a.speed = speed;
  }

  private faceTowards(a: Agent, dx: number, dz: number, dt: number, rate = 8) {
    if (Math.hypot(dx, dz) < 1e-4) return;
    const target = Math.atan2(-dx, -dz);
    let d = target - a.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.yaw += d * Math.min(1, dt * rate);
  }

  /** Styr direkte mod et punkt med kollision mod bygninger. */
  private steer(a: Agent, tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - a.pos.x, dz = tz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { a.speed = 0; return d; }
    const step = Math.min(d, speed * dt);
    const mx = (dx / d) * step, mz = (dz / d) * step;
    if (a.kcc && a.collider && a.body) {
      a.kcc.computeColliderMovement(a.collider, { x: mx, y: -0.3 * dt * 10, z: mz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC));
      const mv = a.kcc.computedMovement();
      const t = a.body.translation();
      const nt = { x: t.x + mv.x, y: Math.max(0.9, t.y + mv.y), z: t.z + mv.z };
      a.body.setNextKinematicTranslation(nt);
      a.pos.set(nt.x, nt.y - 0.9, nt.z);
      a.speed = dt > 0 ? Math.hypot(mv.x, mv.z) / dt : 0;
    } else {
      a.pos.x += mx;
      a.pos.z += mz;
      a.speed = speed;
    }
    this.faceTowards(a, dx, dz, dt, 10);
    return d;
  }

  private syncBody(a: Agent) {
    if (a.body) {
      const p = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z };
      a.body.setTranslation(p, true);
      a.body.setNextKinematicTranslation(p);
    }
  }

  /** Følg en A*-sti hen mod et mål. */
  private followPath(a: Agent, goal: THREE.Vector3, speed: number, dt: number) {
    const nav = this.world.nav;
    a.repath -= dt;
    if (!a.path || a.repath <= 0) {
      a.path = nav.path(nav.nearest([a.pos.x, a.pos.z]), nav.nearest([goal.x, goal.z]), 6000);
      a.pathIdx = 0;
      a.repath = 1.5 + R() * 0.5;
    }
    if (!a.path || a.pathIdx >= a.path.length) {
      this.steer(a, goal.x, goal.z, speed, dt);
      return;
    }
    const n = nav.nodes[a.path[a.pathIdx]];
    const d = this.steer(a, n[0], n[1], speed, dt);
    if (d < 1.4) a.pathIdx++;
  }

  /** Gå tilbage til grafen efter en jagt. */
  private rejoin(a: Agent, dt: number, speed: number): boolean {
    const nav = this.world.nav;
    const n = nav.nearest([a.pos.x, a.pos.z]);
    const p = nav.nodes[n];
    const d = this.steer(a, p[0], p[1], speed, dt);
    if (d < 0.8) {
      a.from = n;
      const nb = nav.adj[n];
      a.to = nb.length ? nb[Math.floor(R() * nb.length)].to : n;
      a.t = 0;
      a.path = null;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ reaktioner
  knockDown(a: Agent, dirX: number, dirZ: number, speed: number) {
    if (a.state === 'down' || a.state === 'getup') return;
    a.setState('down');
    a.slide.set(dirX * Math.min(9, speed * 0.7), 0, dirZ * Math.min(9, speed * 0.7));
    a.model.setState('down');
    a.yaw = Math.atan2(dirX, dirZ); // falder bagover væk fra køretøjet
    a.path = null;
  }

  say(a: Agent, text: string, secs = 2.2) {
    this.events.bubble({ text, agent: a, until: this.now + secs });
  }

  // ------------------------------------------------------------ opdatering
  update(dt: number, now: number, player: { pos: THREE.Vector3; onFoot: boolean; speed: number; vehicleKind: string | null; immune: boolean }, camPos: THREE.Vector3, wantedStars: number, lastSeen: THREE.Vector3) {
    this.now = now;
    // Fodgængere: fast pulje, der flyttes rundt om spilleren (ingen nye meshes/teksturer under spillet)
    let spawnBudget = 3;
    while (this.peds.length < TUNING.pedestrianCount && spawnBudget-- > 0) {
      if (!this.spawnPed(player.pos, this.peds.length < TUNING.pedestrianCount / 2 ? 15 : 70, 150)) break;
    }
    let relocate = 2;
    for (const a of this.peds) {
      if (relocate <= 0) break;
      if (!a.busy && Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z) > 175) {
        this.relocatePed(a, player.pos, 80, 150);
        relocate--;
      }
    }

    for (const a of this.peds) this.updatePed(a, dt, player);
    for (const a of this.hools) this.updateHooligan(a, dt, player);
    for (const a of this.cops) this.updateCop(a, dt, player, wantedStars, lastSeen);
    for (const v of this.vendors) this.updateVendor(v, dt);

    for (const a of [...this.peds, ...this.hools, ...this.cops]) {
      const d2 = (a.pos.x - camPos.x) ** 2 + (a.pos.z - camPos.z) ** 2;
      a.model.group.visible = d2 < 200 * 200;
      if (!a.model.group.visible) continue;
      a.model.group.position.copy(a.pos);
      a.model.group.rotation.y = a.yaw;
      if (d2 < 120 * 120) a.model.update(dt, a.speed);
    }
  }

  private updateDownState(a: Agent, dt: number, getupAfter: number): boolean {
    if (a.state === 'down') {
      a.slide.multiplyScalar(Math.exp(-4 * dt));
      a.pos.x += a.slide.x * dt;
      a.pos.z += a.slide.z * dt;
      if (this.world.insideBuilding(a.pos.x, a.pos.z)) { a.pos.x -= a.slide.x * dt; a.pos.z -= a.slide.z * dt; a.slide.set(0, 0, 0); }
      a.speed = 0;
      this.syncBody(a);
      if (a.stateTime > getupAfter) { a.setState('getup'); a.model.setState('getup'); }
      return true;
    }
    if (a.state === 'getup') {
      if (a.stateTime > 0.65) return false;
      return true;
    }
    return false;
  }

  private updatePed(a: Agent, dt: number, player: { pos: THREE.Vector3; onFoot: boolean; speed: number }) {
    a.stateTime += dt;
    if (this.updateDownState(a, dt, 2.8)) return;
    if (a.state === 'getup') {
      a.setState('angry');
      a.model.setState('fist');
      this.say(a, pick(['Hey!!', 'Pas på, din klovn!', 'Av for den!', 'Hallo?!', 'Kør dog ordentligt!']));
    }
    if (a.state === 'angry') {
      a.speed = 0;
      if (a.stateTime > 1.6) { a.setState('return'); }
      return;
    }
    if (a.state === 'dodge') {
      a.pos.addScaledVector(a.slide, dt);
      a.slide.multiplyScalar(Math.exp(-5 * dt));
      a.model.setState('run');
      a.speed = 5;
      if (a.stateTime > 0.5) a.setState('return');
      return;
    }
    if (a.state === 'return') {
      a.model.setState('walk');
      if (this.rejoin(a, dt, a.walkSpeed * 1.6)) a.setState('wander');
      return;
    }
    // vandring
    this.wander(a, dt, a.walkSpeed);
    a.model.setState('walk');
    // Spilleren går ind i fodgængeren: lille puf
    const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (player.onFoot && d < 0.7 && Math.abs(player.pos.y - a.pos.y) < 1) {
      a.slide.set((dx / (d || 1)) * 3, 0, (dz / (d || 1)) * 3);
      a.setState('dodge');
      if (R() < 0.3) this.say(a, pick(['Undskyld!', 'Hov!', 'Skål!', 'Danmark!']), 1.4);
    }
  }

  /** Køretøj nærmer sig hurtigt: fodgængere springer til side. */
  dodgeFrom(a: Agent, vx: number, vz: number) {
    if (a.state !== 'wander' || a.dodged) return;
    const sp = Math.hypot(vx, vz) || 1;
    const side = R() < 0.5 ? 1 : -1;
    a.slide.set((-vz / sp) * side * 6, 0, (vx / sp) * side * 6);
    a.setState('dodge');
    a.dodged = true;
    setTimeout(() => (a.dodged = false), 3000);
    if (R() < 0.4) this.say(a, pick(['Wow!', 'Pas på!', 'Hold da op!']), 1.2);
  }

  private updateHooligan(a: Agent, dt: number, player: { pos: THREE.Vector3; onFoot: boolean; speed: number; immune: boolean }) {
    a.stateTime += dt;
    a.attackCd = Math.max(0, a.attackCd - dt);
    if (a.state === 'ko') {
      a.model.setState('down');
      a.model.showStars(true);
      a.speed = 0;
      if (a.stateTime > 20) {
        a.model.showStars(false);
        a.setState('getup');
        a.model.setState('getup');
      }
      return;
    }
    if (this.updateDownState(a, dt, 2.4)) return;
    if (a.state === 'getup') {
      a.setState(a.hits >= 3 ? 'calm' : 'chase');
      a.hits = a.hits >= 3 ? 0 : a.hits;
    }
    if (now_hits_decay(a, this.now)) a.hits = 0;
    const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const dy = Math.abs(player.pos.y - a.pos.y);
    let canSee = false;
    if (d < TUNING.hooliganSight && dy < 3) {
      if (this.now - a.losAt > 0.2) {
        a.losAt = this.now;
        a.losOk = this.physics.lineOfSight(a.pos.x, a.pos.y + 1.6, a.pos.z, player.pos.x, player.pos.y + 1.4, player.pos.z);
      }
      canSee = a.losOk;
    }
    const members = this.hools.filter((h) => h.groupId === a.groupId);

    switch (a.state) {
      case 'calm':
        a.model.setState('walk');
        if (this.rejoin(a, dt, 1.2) || a.stateTime > 15) a.setState('return');
        return;
      case 'wander':
      case 'return': {
        if (player.onFoot && canSee && (d < 10 || R() < dt * 2)) {
          for (const m of members) if (m.state === 'wander' || m.state === 'return') { m.setState('chase'); m.lastSeen = this.now; }
          this.say(a, pick(['Där är han!', 'Dansk öl är vårt!', 'Kom hit, dansken!', 'Heja Sverige!']));
          return;
        }
        if (a.state === 'return') {
          a.model.setState('walk');
          if (a.leader) { a.setState('wander'); return; }
          if (this.rejoin(a, dt, 2)) a.setState('wander');
          return;
        }
        if (a.leader && a.leader.state === 'wander') {
          // følg lederen i formation
          const L = a.leader;
          const cs = Math.cos(L.yaw), sn = Math.sin(L.yaw);
          const tx = L.pos.x + a.formation[0] * cs + a.formation[1] * sn;
          const tz = L.pos.z - a.formation[0] * sn + a.formation[1] * cs;
          const dd = Math.hypot(tx - a.pos.x, tz - a.pos.z);
          if (dd > 0.2) this.steer(a, tx, tz, Math.min(3.5, dd * 2), dt);
          else a.speed = 0;
          a.model.setState(a.speed > 0.3 ? 'walk' : 'idle');
        } else if (!a.leader) {
          this.wander(a, dt, a.walkSpeed);
          this.syncBody(a);
          a.model.setState('walk');
        } else {
          a.model.setState('idle');
          a.speed = 0;
        }
        return;
      }
      case 'chase':
      case 'attack': {
        if (canSee) a.lastSeen = this.now;
        const give = !player.onFoot ? this.now - a.lastSeen > 2.5 : this.now - a.lastSeen > 5 || d > 50;
        if (give) {
          a.setState('return');
          if (!a.leader) this.say(a, pick(['Fegis!', 'Vi ses på stadion!', 'Typiskt danskar...']));
          return;
        }
        if (a.state === 'attack') {
          a.model.setState('punch');
          a.speed = 0;
          this.faceTowards(a, dx, dz, dt, 14);
          if (a.stateTime > 0.32 && a.stateTime - dt <= 0.32) {
            if (d < 1.7 && dy < 1.2 && player.onFoot && !player.immune) this.events.hooliganHitPlayer(a);
          }
          if (a.stateTime > 0.7) { a.setState('chase'); a.attackCd = 1.3; }
          return;
        }
        if (d < 1.25 && dy < 1.2 && a.attackCd <= 0 && player.onFoot) {
          a.setState('attack');
          a.model.setState('punch');
          return;
        }
        if (canSee && d < 30) this.steer(a, player.pos.x, player.pos.z, d < 1.2 ? 0 : TUNING.hooliganRun, dt);
        else this.followPath(a, player.pos, TUNING.hooliganRun, dt);
        a.model.setState(a.speed > 3 ? 'run' : a.speed > 0.3 ? 'walk' : 'idle');
        return;
      }
      default:
        a.setState('wander');
    }
  }

  /** Spilleren slår en hooligan. Returnerer true hvis han bliver slået ud. */
  punchHooligan(a: Agent, dirX: number, dirZ: number): boolean {
    if (a.state === 'ko' || a.state === 'down') return false;
    a.hits++;
    a.lastHitAt = this.now;
    a.model.setState('hit');
    a.pos.x += dirX * 0.5;
    a.pos.z += dirZ * 0.5;
    this.syncBody(a);
    for (const m of this.hools) if (m.groupId === a.groupId && (m.state === 'wander' || m.state === 'return')) m.setState('chase');
    if (a.hits >= 3) {
      a.setState('ko');
      a.slide.set(0, 0, 0);
      a.yaw = Math.atan2(dirX, dirZ);
      this.say(a, pick(['Aj aj aj...', 'Mamma...', 'Stjärnor...']));
      return true;
    }
    a.attackCd = Math.max(a.attackCd, 0.5);
    if (a.state === 'wander' || a.state === 'return' || a.state === 'calm') a.setState('chase');
    return false;
  }

  private updateCop(a: Agent, dt: number, player: { pos: THREE.Vector3; onFoot: boolean; speed: number; vehicleKind: string | null }, stars: number, lastSeen: THREE.Vector3) {
    a.stateTime += dt;
    if (this.updateDownState(a, dt, 2.5)) return;
    if (a.state === 'getup') a.setState(stars > 0 ? 'chase' : 'return');
    const chaseSpeed = a.onBike ? TUNING.policeBikeSpeed : TUNING.policeFootSpeed;
    const bikePose = () => a.model.setState('bike');
    if (stars > 0 && Math.hypot(lastSeen.x - a.pos.x, lastSeen.z - a.pos.z) < TUNING.policeChaseRange && a.state !== 'chase') {
      a.setState('chase');
      a.path = null;
    }
    if (a.state === 'chase') {
      if (stars === 0) { a.setState('return'); return; }
      const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (this.now - a.losAt > 0.2) {
        a.losAt = this.now;
        a.losOk = d < 35 && Math.abs(player.pos.y - a.pos.y) < 3 && this.physics.lineOfSight(a.pos.x, a.pos.y + 1.6, a.pos.z, player.pos.x, player.pos.y + 1.2, player.pos.z);
      }
      const see = a.losOk && d < 35;
      if (see) this.steer(a, player.pos.x, player.pos.z, chaseSpeed, dt);
      else this.followPath(a, lastSeen, chaseSpeed, dt);
      if (a.onBike) bikePose();
      else a.model.setState(a.speed > 3 ? 'run' : 'walk');
      if (see && a.stateTime > 0.5 && R() < dt * 0.25) this.say(a, pick(['Stop! Politi!', 'Bliv stående!', 'Du er anholdt!', 'Stands!']));
      // anholdelse
      const catchable = player.vehicleKind === null ? true : player.vehicleKind === 'car' ? player.speed < 1 : player.speed < 4;
      if (d < 1.35 && Math.abs(player.pos.y - a.pos.y) < 1.2 && catchable) this.events.arrest(a);
      return;
    }
    if (a.state === 'return') {
      if (this.rejoin(a, dt, a.onBike ? 5 : 2)) a.setState('wander');
      if (a.onBike) bikePose(); else a.model.setState('walk');
      return;
    }
    this.wander(a, dt, a.walkSpeed);
    this.syncBody(a);
    if (a.onBike) bikePose(); else a.model.setState('walk');
  }

  /** Ser en betjent hændelsen? (fri sigt og inden for rækkevidde) */
  witness(x: number, y: number, z: number): Agent | null {
    for (const c of this.cops) {
      if (c.busy) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < TUNING.witnessRange && this.physics.lineOfSight(c.pos.x, c.pos.y + 1.6, c.pos.z, x, y + 1.0, z)) return c;
    }
    return null;
  }

  /** Kan politiet se spilleren lige nu? */
  seesPlayer(p: THREE.Vector3): boolean {
    for (const c of this.cops) {
      if (c.busy) continue;
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < 60 && this.physics.lineOfSight(c.pos.x, c.pos.y + 1.6, c.pos.z, p.x, p.y + 1.2, p.z)) return true;
    }
    return false;
  }

  private updateVendor(v: { agent: Agent; cart: THREE.Group; route: V2[]; s: number; dir: number; len: number }, dt: number) {
    const a = v.agent;
    a.stateTime += dt;
    if (this.updateDownState(a, dt, 2.5)) {
      a.model.group.position.copy(a.pos);
      a.model.update(dt, 0);
      return;
    }
    if (a.state === 'getup') { a.setState('wander'); this.say(a, 'Min fadølsvogn!!'); }
    v.s += v.dir * a.walkSpeed * dt;
    if (v.s > v.len) { v.s = v.len; v.dir = -1; }
    if (v.s < 0) { v.s = 0; v.dir = 1; }
    const { pt, dir } = along(v.route, v.s);
    const fx = dir[0] * v.dir, fz = dir[1] * v.dir;
    const yaw = Math.atan2(-fx, -fz);
    v.cart.position.set(pt[0], 0, pt[1]);
    v.cart.rotation.y = yaw;
    a.pos.set(pt[0] - fx * 1.25, 0, pt[1] - fz * 1.25);
    a.yaw = yaw;
    a.speed = a.walkSpeed;
    a.model.setState('push');
    a.model.group.position.copy(a.pos);
    a.model.group.rotation.y = a.yaw;
    a.model.update(dt, a.speed);
  }
}

function along(route: V2[], s: number): { pt: V2; dir: V2 } {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === route.length - 1) {
      const t = l > 0 ? Math.min(1, s / l) : 0;
      return { pt: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] };
    }
    s -= l;
  }
  return { pt: route[0], dir: [1, 0] };
}

function now_hits_decay(a: Agent, now: number): boolean {
  return a.hits > 0 && a.hits < 3 && now - a.lastHitAt > 8;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(R() * arr.length)];
}
