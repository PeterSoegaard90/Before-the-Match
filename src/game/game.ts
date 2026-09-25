// Spillets dirigent: tilstande (menu → valg → nedtælling → runde → slut), spilløkke og samspil mellem systemerne.
import * as THREE from 'three';
import { ROLIGANS, RULES, TUNING, VEHICLES } from '../config.ts';
import { audio } from '../core/audio.ts';
import { Input } from '../core/input.ts';
import { addScore, loadScores, loadSettings, qualifies, saveSettings, type ScoreEntry, type Settings } from '../core/storage.ts';
import { BeerSystem, makeBeerCart, type Beer } from '../entities/beers.ts';
import { NpcManager, type Agent, type Bubble } from '../entities/npcs.ts';
import { Player } from '../entities/player.ts';
import { VehicleManager, makePoliceBike, type Vehicle } from '../entities/vehicles.ts';
import { Physics, RAPIER } from '../physics.ts';
import type { CityData } from '../shared/cityTypes.ts';
import { rng } from '../shared/geom.ts';
import { UI } from '../ui/ui.ts';
import { MapRenderer, type MapDot } from '../ui/minimap.ts';
import { Fanzone } from '../world/fanzone.ts';
import { WATER_Y } from '../world/water.ts';
import { World } from '../world/world.ts';
import { ThirdPersonCamera, type CamMode } from './camera.ts';
import { FIRST_ROUND_HINTS, RouteFinder } from './guidance.ts';
import { FANZONE_NAMES, Round, Wanted, formatPoints } from './rules.ts';

export type GameState = 'loading' | 'menu' | 'select' | 'countdown' | 'playing' | 'paused' | 'map' | 'ended';

interface SpawnRec { v: Vehicle; x: number; y: number; z: number; yaw: number }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly ui: UI;
  settings: Settings;
  state: GameState = 'loading';
  physics!: Physics;
  world!: World;
  cam!: ThirdPersonCamera;
  vehicles!: VehicleManager;
  npcs!: NpcManager;
  beers!: BeerSystem;
  map!: MapRenderer;
  player!: Player;
  round: Round = new Round();
  wanted = new Wanted();
  fanzone: Fanzone | null = null;
  roligan = 0;
  now = 0;
  private realTime = 0;
  private spawnRecs: SpawnRec[] = [];
  private bubbles: Bubble[] = [];
  private stealing: { v: Vehicle; t: number; smashed: boolean } | null = null;
  private splashT = -1;
  private frozenT = 0;
  private hitImmune = 0;
  private endTimer = -1;
  private countdownT = 0;
  private seenTimer = 0;
  private seen = false;
  private lastSeenPos = new THREE.Vector3();
  private fps = { acc: 0, frames: 0, good: 0 };
  private pixelRatio: number;
  private menuAngle = 0;
  private lastScore: { entry: ScoreEntry; lost: number; saved: boolean; rank: number } | null = null;
  private minimapAcc = 0;
  private drumBpm = 0;
  private readonly clock = new THREE.Clock();
  private routeFinder!: RouteFinder;
  private roundsStarted = 0;
  private hintIdx = 0;
  private hintUntil = -1;
  readonly testMode: boolean;
  private qAA = true;
  private qPixelRatio: number | null = null;
  private qShadow: number | null = null;
  private qFixedQuality = false;
  private qPcfSoft = true;
  /** ?view=x,y,z,tx,ty,tz (kun test): fast kamera i menuen til skærmbilleder. */
  private fixedView: number[] | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const qs = new URLSearchParams(location.search);
    this.testMode = qs.has('test');
    this.qAA = !(this.testMode && qs.get('aa') === '0');
    this.qPixelRatio = this.testMode && qs.get('pr') ? +qs.get('pr')! : null;
    this.qShadow = this.testMode && qs.get('shadow') ? +qs.get('shadow')! : null;
    this.qFixedQuality = this.testMode && qs.has('fixedq');
    this.qPcfSoft = !(this.testMode && qs.get('pcf') === '0');
    const view = qs.get('view')?.split(',').map(Number);
    if (this.testMode && view && view.length === 6 && view.every(Number.isFinite)) this.fixedView = view;
    if (this.testMode && qs.has('noui')) uiRoot.style.display = 'none';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qAA, powerPreference: 'high-performance' });
    this.pixelRatio = this.qPixelRatio ?? Math.min(window.devicePixelRatio || 1, 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.qPcfSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Dithering giver kun støj i software-rendering; slå det fra
    this.renderer.getContext().disable(this.renderer.getContext().DITHER);
    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.3, 2600);
    this.input = new Input(canvas);
    this.settings = loadSettings();
    audio.setVolume(this.settings.volume);
    this.ui = new UI(uiRoot, {
      play: () => this.toSelect(),
      pickRoligan: (i) => this.pickRoligan(i),
      confirmRoligan: () => this.startCountdown(),
      resume: () => this.resume(),
      quitRound: () => this.toMenu(),
      restart: () => this.startCountdown(),
      changeRoligan: () => this.toSelect(),
      toMenu: () => this.toMenu(),
      settingsChanged: (s) => { this.settings = s; saveSettings(s); audio.setVolume(s.volume); },
      saveScore: (name) => this.saveScore(name),
      back: () => this.back(),
    }, this.settings);
    this.ui.scoresProvider = loadScores;
    this.ui.show('loading');
    window.addEventListener('resize', () => this.resize());
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.testMode) this.pause();
    };
    canvas.addEventListener('click', () => {
      audio.unlock();
      if (this.state === 'playing') this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
  }

  // ------------------------------------------------------------ opstart
  async init() {
    const step = (f: number, t: string) => new Promise<void>((res) => { this.ui.setLoading(f, t); requestAnimationFrame(() => res()); });
    await step(0.05, 'Henter kortdata fra OpenStreetMap …');
    const [city, physics] = await Promise.all([
      fetch(import.meta.env.BASE_URL + 'data/city.json').then((r) => {
        if (!r.ok) throw new Error('Kunne ikke hente bydata (' + r.status + ')');
        return r.json() as Promise<CityData>;
      }),
      Physics.init(),
    ]);
    this.physics = physics;
    await step(0.3, 'Bygger 1.600 huse, Domkirken og ARoS …');
    this.world = new World(city, physics, this.scene, { shadowSize: this.qShadow ?? 2048 });
    this.cam = new ThirdPersonCamera(this.camera, physics);
    this.routeFinder = new RouteFinder(this.world.nav);
    await step(0.55, 'Parkerer biler og låser cykler (ikke så godt) …');
    this.vehicles = new VehicleManager(physics);
    this.scene.add(this.vehicles.group);
    const R = rng(7);
    for (const p of city.parking) {
      const v = this.vehicles.spawn(p.kind, p.pos[0], 0, p.pos[1], p.heading, R);
      this.spawnRecs.push({ v, x: p.pos[0], y: 0, z: p.pos[1], yaw: p.heading });
    }
    for (const p of this.world.landmarks.roofParking) {
      const v = this.vehicles.spawn('car', p.pos[0], p.y + 0.05, p.pos[1], p.heading, R);
      this.spawnRecs.push({ v, x: p.pos[0], y: p.y + 0.05, z: p.pos[1], yaw: p.heading });
    }
    await step(0.72, 'Tapper fadøl og vækker svenske hooligans …');
    this.npcs = new NpcManager(this.world, {
      bubble: (b) => this.bubbles.push(b),
      hooliganHitPlayer: (h) => this.onHooliganHit(h),
      arrest: (cop) => this.onArrest(cop),
    });
    this.scene.add(this.npcs.group);
    this.npcs.spawnVendors(city.cartRoutes, makeBeerCart);
    this.npcs.spawnPolice(TUNING.policeOnFoot, TUNING.policeOnBike, city.policeStation, makePoliceBike);
    this.npcs.spawnHooligans(TUNING.hooliganGroups, this.world.square('banegaardspladsen'));
    this.beers = new BeerSystem(this.world.beerSpots, this.npcs.vendors.map((v) => v.cart));
    this.scene.add(this.beers.group);
    await step(0.88, 'Maler Dannebrog på kinderne …');
    this.map = new MapRenderer(city);
    this.player = new Player(ROLIGANS[0], physics);
    this.scene.add(this.player.model.group);
    this.player.onStep = (run) => audio.step(run);
    this.player.onJump = () => audio.jump();
    this.player.onLand = (v) => { if (v > 6) audio.land(); };
    const sp = city.spawn;
    this.player.teleport(sp.pos[0], 0, sp.pos[1], sp.heading);
    // Varm skyggerne/shaderne op
    this.renderer.compile(this.scene, this.camera);
    await step(1, 'Klar!');
    if (this.testMode) Object.assign(window as object, { __btm: this, __RAPIER: RAPIER, __audio: audio });
    this.toMenu();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ tilstande
  toMenu() {
    this.cleanupRound();
    this.state = 'menu';
    this.input.exitLock();
    this.ui.show('menu');
    audio.setEngine(false);
    audio.setSkid(0);
    audio.setDrums(0);
    audio.setAmbience(true, 0.2);
  }

  toSelect() {
    audio.unlock();
    audio.click();
    this.cleanupRound();
    this.state = 'select';
    this.input.exitLock();
    const sp = this.world.city.spawn;
    this.player.teleport(sp.pos[0], 0, sp.pos[1], sp.heading);
    this.ui.show('select');
    this.pickRoligan(this.roligan);
    audio.setDrums(96);
  }

  pickRoligan(i: number) {
    audio.click();
    this.roligan = i;
    this.ui.setSelected(i);
    this.player.setLook(ROLIGANS[i]);
    if (!this.player.model.group.parent) this.scene.add(this.player.model.group);
    this.player.model.setState('cheer');
  }

  startCountdown() {
    audio.unlock();
    this.cleanupRound();
    this.resetWorldForRound();
    this.state = 'countdown';
    this.countdownT = RULES.countdownSeconds + 0.3;
    this.ui.resetHud();
    this.ui.show('countdown', true);
    this.ui.setCountdown('3');
    audio.beep();
    audio.setDrums(0);
    this.input.requestLock();
    this.cam.yaw = this.player.yaw;
    this.cam.pitch = 0.3;
    this.cam.snap();
  }

  private startRound() {
    this.state = 'playing';
    this.roundsStarted++;
    this.hintIdx = this.roundsStarted === 1 ? 0 : FIRST_ROUND_HINTS.length;
    this.hintUntil = -1;
    this.routeFinder.reset();
    this.ui.show('hud');
    audio.kickoffWhistle();
    this.ui.banner('Afsted!', 'Find fadøl – og nå fanzonen inden kickoff', '#ffffff', 2.2);
    this.input.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.show('pause', true);
    audio.setEngine(false);
    audio.setSkid(0);
    audio.setDrums(0);
    this.input.exitLock();
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'map') return;
    this.state = 'playing';
    this.ui.show('hud');
    this.input.requestLock();
    this.clock.getDelta();
  }

  private back() {
    if (!this.ui.popOverlay()) this.toMenu();
  }

  private openMap() {
    if (this.state !== 'playing') return;
    this.state = 'map';
    this.ui.show('bigmap');
    audio.setEngine(false);
    audio.setSkid(0);
    const cv = this.ui.bigmapCanvas;
    const b = this.world.city.bounds;
    const aspect = (b.maxX - b.minX) / (b.maxZ - b.minZ);
    const h = Math.min(window.innerHeight * 0.78, (window.innerWidth * 0.92) / aspect);
    cv.width = Math.round(h * aspect);
    cv.height = Math.round(h);
    this.map.drawBig(cv, this.player.pos.x, this.player.pos.z, this.player.yaw, this.mapDots(true), this.round.revealed && this.fanzone ? { x: this.fanzone.center.x, z: this.fanzone.center.z } : null, this.round.revealed ? this.routeFinder.route : null);
    this.input.exitLock();
  }

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Escape') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') { if (!this.ui.popOverlay()) this.resume(); }
      else if (this.state === 'map') this.resume();
      else if (this.state === 'select') this.toMenu();
      else if (this.state === 'menu') this.ui.popOverlay();
    }
    if (e.code === 'KeyM') {
      if (this.state === 'playing') this.openMap();
      else if (this.state === 'map') this.resume();
    }
    if (this.state === 'select') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.pickRoligan((this.roligan + ROLIGANS.length - 1) % ROLIGANS.length);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.pickRoligan((this.roligan + 1) % ROLIGANS.length);
    }
  }

  // ------------------------------------------------------------ rundestart/-slut
  private cleanupRound() {
    this.fanzone?.dispose();
    this.fanzone = null;
    this.stealing = null;
    this.ui.progress(null);
    this.ui.prompt(null);
    this.ui.marker(null);
    this.endTimer = -1;
    if (this.player?.vehicle) {
      const v = this.player.vehicle;
      this.player.exitVehicle(v.exitPoints()[0]);
    }
    audio.setEngine(false);
    audio.setSkid(0);
  }

  private resetWorldForRound() {
    this.round = new Round();
    this.wanted = new Wanted();
    this.now = 0;
    this.bubbles = [];
    this.splashT = -1;
    this.frozenT = 0;
    this.hitImmune = 0;
    this.lastScore = null;
    this.beers.reset();
    for (const r of this.spawnRecs) {
      if (r.v.driven) continue;
      r.v.body.setTranslation({ x: r.x, y: r.y + r.v.spec.rideHeight, z: r.z }, true);
      r.v.body.setRotation({ x: 0, y: Math.sin(r.yaw / 2), z: 0, w: Math.cos(r.yaw / 2) }, true);
      r.v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      r.v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      r.v.locked = r.v.kind === 'car';
      r.v.stolen = false;
      r.v.syncVisual(0);
    }
    for (const c of this.npcs.cops) c.setState('return');
    for (const h of this.npcs.hools) { h.hits = 0; h.model.showStars(false); if (h.state !== 'wander') h.setState('return'); }
    const sp = this.world.city.spawn;
    this.player.setMode('foot');
    this.player.teleport(sp.pos[0], 0, sp.pos[1], sp.heading);
    this.player.model.setState('idle');
  }

  private finishRound(outcome: 'ontime' | 'late', lost: number) {
    this.state = 'ended';
    this.ui.prompt(null);
    this.ui.progress(null);
    this.ui.marker(null);
    this.stealing = null;
    this.endTimer = 3.2;
    this.input.exitLock();
    audio.setEngine(false);
    audio.setSkid(0);
    audio.setDrums(0);
    if (this.player.vehicle) this.player.exitVehicle(this.safeExitPoint(this.player.vehicle));
    if (outcome === 'ontime') {
      audio.kickoffWhistle();
      audio.cheer(1.2);
      this.ui.banner('Du nåede det!', `${formatPoints(this.round.points)} point`, '#2fbf71', 3.2);
      this.player.model.setState('cheer');
    } else {
      audio.kickoffWhistle();
      setTimeout(() => audio.boo(), 900);
      this.ui.banner('For sent!', `Kickoff er fløjtet – du mister ${formatPoints(lost)} point`, '#ff4d5e', 3.2);
      this.player.model.setState('idle');
    }
    const def = ROLIGANS[this.roligan];
    const entry: ScoreEntry = { name: def.name, roligan: def.name, points: this.round.points, beers: this.round.stats.beersCollected, onTime: outcome === 'ontime', date: new Date().toISOString().slice(0, 10) };
    this.lastScore = { entry, lost, saved: false, rank: -1 };
  }

  private showEnd() {
    const ls = this.lastScore!;
    const q = !ls.saved && ls.entry.points > 0 && qualifies(ls.entry.points);
    this.ui.renderEnd({
      outcome: this.round.outcome ?? 'late', points: this.round.points, lost: ls.lost, beers: this.round.beers, stats: this.round.stats,
      roligan: ROLIGANS[this.roligan], qualifies: q, list: loadScores(), myRank: ls.rank, saved: ls.saved,
    });
    this.ui.show('end');
  }

  private saveScore(name: string) {
    if (!this.lastScore || this.lastScore.saved) return;
    this.lastScore.entry.name = name.slice(0, 16);
    const { rank } = addScore(this.lastScore.entry);
    this.lastScore.saved = true;
    this.lastScore.rank = rank;
    audio.pointsUp();
    this.showEnd();
  }

  // ------------------------------------------------------------ spilløkke
  /** Glidende gennemsnit af CPU-tid til spillogik pr. frame (ms). */
  cpuMs = 0;
  /** Glidende gennemsnit pr. sektion (ms) – kun i testtilstand. */
  readonly prof: Record<string, number> = {};
  private profT = 0;
  private mark(label: string) {
    if (!this.testMode) return;
    const t = performance.now();
    if (label !== 'start') this.prof[label] = (this.prof[label] ?? 0) + (t - this.profT - (this.prof[label] ?? 0)) * 0.05;
    this.profT = t;
  }

  private frame() {
    const raw = this.clock.getDelta();
    const tCpu = performance.now();
    this.trackFps(raw);
    // Lange frames deles i fysiktrin á højst 1/30 s, så tiden går i realtid selv ved lav fps
    let remaining = Math.min(this.testMode ? 0.25 : 0.1, raw);
    do {
      const dt = Math.min(1 / 30, remaining);
      remaining -= dt;
      this.realTime += dt;
      switch (this.state) {
        case 'menu': this.updateMenu(dt); break;
        case 'select': this.updateSelect(dt); break;
        case 'countdown': this.updateCountdown(dt); break;
        case 'playing': this.updatePlaying(dt); break;
        case 'ended': this.updateEnded(dt); break;
        default: break; // pause/kort: frys
      }
      this.input.endFrame();
    } while (remaining > 1e-4);
    this.cpuMs += (performance.now() - tCpu - this.cpuMs) * 0.05;
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number) {
    // Langsom flyvetur rundt om Domkirken
    this.menuAngle += dt * 0.05;
    const c = this.world.square('storeTorv');
    if (this.fixedView) {
      const [x, y, z, tx, ty, tz] = this.fixedView;
      this.camera.position.set(x, y, z);
      this.camera.lookAt(tx, ty, tz);
      const f = new THREE.Vector3(tx, 0, tz);
      this.world.update(dt, f, this.camera);
      this.npcs.update(dt, this.realTime, { pos: f, onFoot: false, speed: 0, vehicleKind: 'car', immune: true }, this.camera.position, 0, f);
      this.beers.update(dt, this.realTime);
      this.physics.step(dt);
      this.vehicles.update(dt, this.camera.position);
      return;
    }
    const a = this.menuAngle + 2.2;
    this.camera.position.set(c.x + 40 + Math.cos(a) * 290, 105, c.z + 60 + Math.sin(a) * 290);
    this.camera.lookAt(c.x + 40, 10, c.z + 60);
    this.world.update(dt, c, this.camera);
    this.npcs.update(dt, this.realTime, { pos: c, onFoot: false, speed: 0, vehicleKind: 'car', immune: true }, this.camera.position, 0, c);
    this.beers.update(dt, this.realTime);
    this.physics.step(dt);
    this.vehicles.update(dt, this.camera.position);
  }

  private updateSelect(dt: number) {
    const p = this.player.pos;
    this.menuAngle += dt * 0.25;
    const yaw = this.player.yaw + Math.sin(this.menuAngle) * 0.5;
    this.camera.position.set(p.x - Math.sin(yaw) * 4.2, p.y + 1.7, p.z - Math.cos(yaw) * 4.2);
    this.camera.lookAt(p.x, p.y + 1.2, p.z);
    this.player.model.setState('cheer');
    this.player.syncModel(dt);
    this.world.update(dt, p, this.camera);
    this.npcs.update(dt, this.realTime, { pos: p, onFoot: false, speed: 0, vehicleKind: 'car', immune: true }, this.camera.position, 0, p);
    this.physics.step(dt);
    this.vehicles.update(dt, this.camera.position);
  }

  private updateCountdown(dt: number) {
    const before = Math.ceil(this.countdownT - 0.3);
    this.countdownT -= dt;
    const after = Math.ceil(this.countdownT - 0.3);
    if (after !== before && after > 0) { this.ui.setCountdown(String(after)); audio.beep(); }
    if (this.countdownT <= 0.3 && before > 0) { this.ui.setCountdown('Afsted!'); audio.beep(true); }
    this.player.model.setState('idle');
    this.player.syncModel(dt);
    this.cam.update(dt, this.player.pos, 'foot', null, 0);
    this.world.update(dt, this.player.pos, this.camera);
    this.npcs.update(dt, this.realTime, this.playerInfo(), this.camera.position, 0, this.lastSeenPos);
    this.physics.step(dt);
    this.vehicles.update(dt, this.camera.position);
    this.beers.update(dt, this.now);
    this.drawHud(dt);
    if (this.countdownT <= 0) this.startRound();
  }

  private updateEnded(dt: number) {
    const p = this.player.pos;
    this.menuAngle += dt * 0.3;
    this.camera.position.set(p.x + Math.cos(this.menuAngle) * 6, p.y + 2.6, p.z + Math.sin(this.menuAngle) * 6);
    this.camera.lookAt(p.x, p.y + 1.3, p.z);
    this.player.syncModel(dt);
    this.world.update(dt, p, this.camera);
    this.fanzone?.update(dt, this.camera.position);
    this.physics.step(dt);
    this.vehicles.update(dt, this.camera.position);
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.showEnd();
    }
  }

  private playerInfo() {
    const v = this.player.vehicle;
    return {
      pos: this.player.pos,
      onFoot: !v && this.player.mode !== 'water',
      speed: v ? v.speed : Math.hypot(this.player.vel.x, this.player.vel.z),
      vehicleKind: v ? v.kind : null,
      immune: this.hitImmune > 0 || this.frozenT > 0,
    };
  }

  private updatePlaying(dt: number) {
    this.mark('start');
    this.now += dt;
    const inp = this.input;
    this.cam.look(inp.mouseDX, inp.mouseDY, this.settings.sensitivity, this.settings.invertY);
    // Tips i første runde
    const elapsed = RULES.roundSeconds - this.round.timeLeft;
    if (this.hintIdx < FIRST_ROUND_HINTS.length && elapsed >= FIRST_ROUND_HINTS[this.hintIdx].at) {
      this.ui.hint(FIRST_ROUND_HINTS[this.hintIdx].text, Infinity);
      this.hintUntil = this.now + 7;
      this.hintIdx++;
    }
    if (this.hintUntil > 0 && this.now > this.hintUntil) {
      this.ui.hint(null);
      this.hintUntil = -1;
    }
    this.hitImmune = Math.max(0, this.hitImmune - dt);
    const p = this.player;

    // --- vand
    if (this.splashT >= 0) {
      this.splashT += dt;
      p.sink(dt, WATER_Y);
      if (this.splashT > 1.8) {
        const [x, z] = this.world.water.nearestDry(p.pos.x, p.pos.z);
        p.teleport(x, 0.05, z);
        p.setMode('foot');
        this.splashT = -1;
      }
    } else if (this.frozenT > 0) {
      this.frozenT -= dt;
      p.updateFoot(dt, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false, camYaw: this.cam.yaw }, false);
      p.model.setState('idle');
    } else if (this.stealing) {
      this.updateStealing(dt);
    } else if (p.vehicle) {
      this.updateDriving(dt);
    } else {
      this.updateOnFoot(dt);
    }

    // --- faldet ud af verden
    if (p.pos.y < -15) {
      const sp = this.world.city.spawn;
      p.teleport(sp.pos[0], 0, sp.pos[1]);
    }

    this.mark('player');
    this.physics.step(dt);
    this.mark('physics');

    // --- fadøl
    const radius = p.vehicle ? p.vehicle.spec.pickupRadius : 1.35;
    const b = this.beers.collect(p.pos, radius, this.now);
    if (b) this.onBeer(b);

    // --- NPC'er og politi
    this.mark('beers');
    this.npcs.update(dt, this.now, this.playerInfo(), this.camera.position, this.wanted.stars, this.lastSeenPos);
    this.mark('npcs');
    this.seenTimer -= dt;
    if (this.seenTimer <= 0) {
      this.seenTimer = 0.25;
      this.seen = this.wanted.stars > 0 && this.npcs.seesPlayer(p.pos);
      if (this.seen) this.lastSeenPos.copy(p.pos);
    }
    const wev = this.wanted.update(dt, this.seen);
    if (wev?.type === 'escaped') {
      this.ui.banner('Du slap væk!', 'Politiet har mistet sporet', '#5aa9ff', 2);
      audio.pointsUp();
    }

    // --- tid og fanzone
    for (const ev of this.round.tick(dt)) {
      if (ev.type === 'minute') this.ui.feed(`${ev.left / 60} minutter til kickoff`, 'info');
      if (ev.type === 'reveal') this.revealFanzone();
      if (ev.type === 'finished') this.finishRound('late', ev.lost);
    }
    if (this.fanzone && this.round.revealed && !this.round.finished && this.fanzone.contains(p.pos)) {
      const ev = this.round.reachFanzone();
      if (ev?.type === 'finished') this.finishRound('ontime', 0);
    }
    this.fanzone?.update(dt, this.camera.position);

    this.mark('rules');
    // --- visuelt
    this.vehicles.update(dt, this.camera.position);
    this.mark('vehicles');
    this.beers.update(dt, this.now);
    this.mark('beervis');
    const mode: CamMode = p.vehicle ? (p.vehicle.kind === 'car' ? 'car' : 'bike') : 'foot';
    this.cam.update(dt, p.vehicle ? p.vehicle.pos : p.pos, mode, p.vehicle ? p.vehicle.yaw : null, p.horizontalSpeed);
    this.world.update(dt, p.pos, this.camera);
    this.mark('world');

    // --- lyd
    const crowd = this.fanzone ? Math.max(0, 1 - this.fanzone.center.distanceTo(p.pos) / 120) : 0;
    audio.setAmbience(true, crowd);
    const bpm = this.round.revealed ? (this.round.timeLeft < 15 ? 150 : 120) : 0;
    if (bpm !== this.drumBpm) { audio.setDrums(0); audio.setDrums(bpm); this.drumBpm = bpm; }
    if (this.state !== 'playing') { audio.setDrums(0); this.drumBpm = 0; }

    this.mark('audio');
    this.drawHud(dt);
    this.mark('hud');
  }

  private updateOnFoot(dt: number) {
    const p = this.player;
    const ax = this.input.axis();
    const punchNow = p.updateFoot(dt, {
      moveX: ax.x, moveY: ax.y, sprint: this.input.down('ShiftLeft') || this.input.down('ShiftRight'),
      jump: this.input.hit('Space'), punch: this.input.mouseHit(0), camYaw: this.cam.yaw,
    }, true);
    if (this.input.mouseHit(0) && p.model.state === 'punch' && p.model.stateTime < 0.02) audio.swing();
    if (punchNow) this.resolvePunch();

    // vand?
    if (this.world.water.isWater(p.pos.x, p.pos.z) && p.pos.y < 0.5 && p.mode !== 'mantle') this.splash();

    // køretøjer
    const v = this.vehicles.nearest(p.pos, TUNING.enterRange);
    if (v && p.mode === 'foot') {
      const label = v.kind === 'car' ? (v.locked ? 'Stjæl bil' : 'Kør bil') : v.kind === 'bike' ? 'Tag cyklen' : 'Tag ladcyklen';
      this.ui.prompt(`<span class="key">E</span> ${label}`);
      if (this.input.hit('KeyE')) this.beginEnter(v);
    } else this.ui.prompt(null);
  }

  private beginEnter(v: Vehicle) {
    const p = this.player;
    p.yaw = Math.atan2(-(v.pos.x - p.pos.x), -(v.pos.z - p.pos.z));
    if (v.kind === 'car' && v.locked) {
      this.stealing = { v, t: 0, smashed: false };
      p.model.setState('steal');
      return;
    }
    this.enter(v);
  }

  private updateStealing(dt: number) {
    const s = this.stealing!;
    const p = this.player;
    s.t += dt;
    p.updateFoot(dt, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false, camYaw: this.cam.yaw }, false);
    p.model.setState('steal');
    this.ui.prompt('Bryder bilen op …');
    this.ui.progress(Math.min(1, s.t / TUNING.carTheftSeconds));
    if (!s.smashed && s.t > TUNING.carTheftSeconds * 0.45) {
      s.smashed = true;
      audio.glassSmash();
      this.cam.shake(0.08);
      this.round.stats.carsStolen++;
      const cop = this.npcs.witness(s.v.pos.x, s.v.pos.y, s.v.pos.z);
      if (cop) this.offense(cop, 'Politiet så dig stjæle bilen!');
    }
    // afbryd hvis man bevæger sig
    const ax = this.input.axis();
    if (!s.smashed && (ax.x !== 0 || ax.y !== 0)) {
      this.stealing = null;
      this.ui.progress(null);
      return;
    }
    if (s.t >= TUNING.carTheftSeconds) {
      s.v.locked = false;
      s.v.stolen = true;
      this.stealing = null;
      this.ui.progress(null);
      this.enter(s.v);
    }
  }

  private enter(v: Vehicle) {
    const p = this.player;
    p.enterVehicle(v);
    this.ui.prompt(null);
    if (v.kind !== 'car') { audio.bell(); this.round.stats.bikesTaken++; }
    this.cam.yaw = v.yaw;
    this.ui.feed(v.kind === 'car' ? 'Du kører bil' : v.kind === 'bike' ? 'Du har taget en cykel' : 'Ladcykel! Langsom, men sjov', 'info');
  }

  private safeExitPoint(v: Vehicle): THREE.Vector3 {
    for (const pt of v.exitPoints()) {
      const gy = this.world.groundY(pt.x, pt.z, v.pos.y + 2);
      if (Math.abs(gy - v.pos.y) > 1.5) continue;
      if (this.world.insideBuilding(pt.x, pt.z, 0.3) && v.pos.y < 1) continue;
      if (this.world.water.isWater(pt.x, pt.z) && gy < 0.5) continue;
      const blocked = this.physics.ray(v.pos.x, v.pos.y + 1, v.pos.z, pt.x - v.pos.x, 0, pt.z - v.pos.z, 1);
      if (blocked) continue;
      return new THREE.Vector3(pt.x, gy + 0.05, pt.z);
    }
    return new THREE.Vector3(v.pos.x, v.pos.y + 2.2, v.pos.z);
  }

  private updateDriving(dt: number) {
    const p = this.player;
    const v = p.vehicle!;
    const ax = this.input.axis();
    if (this.input.hit('KeyE') && v.speed < 6) {
      p.exitVehicle(this.safeExitPoint(v));
      audio.setEngine(false);
      audio.setSkid(0);
      return;
    }
    const impact = v.drive(dt, ax.y, -ax.x, this.input.down('Space'));
    p.followVehicle(dt);
    if (impact > 4 && this.realTime - v.lastCrash > 0.4) {
      v.lastCrash = this.realTime;
      audio.crash(Math.min(1, impact / 18));
      this.cam.shake(Math.min(0.6, impact * 0.03));
    }
    if (v.kind === 'car') {
      audio.setEngine(true, v.speed, Math.abs(ax.y));
      audio.setSkid(v.skid * Math.min(1, v.speed / 6));
    }
    this.ui.prompt(v.speed < 6 ? `<span class="key">E</span> Stig ${v.kind === 'car' ? 'ud' : 'af'}` : null);

    // påkørsler og undvigelser
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const check = (a: Agent) => {
      if (a.busy) return;
      const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z;
      if (dx * dx + dz * dz > 64 || Math.abs(a.pos.y - v.pos.y) > 1.5) return;
      if (v.speed > 2.5 && v.hits(a.pos.x, a.pos.z, 0.35)) {
        const side = (dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw)) >= 0 ? 1 : -1;
        const rx = Math.cos(v.yaw) * side, rz = -Math.sin(v.yaw) * side;
        const kx = fx * 0.7 + rx * 0.7, kz = fz * 0.7 + rz * 0.7;
        this.npcs.knockDown(a, kx, kz, v.speed);
        audio.thud(Math.min(1, v.speed / 12));
        v.vel.multiplyScalar(v.kind === 'car' ? 0.9 : 0.6);
        if (a.kind !== 'hool') {
          this.round.stats.pedestriansKnocked++;
          const cop = a.kind === 'cop' ? a : this.npcs.witness(a.pos.x, a.pos.y, a.pos.z);
          if (cop) this.offense(cop, a.kind === 'cop' ? 'Du kørte en betjent ned!' : 'Politiet så påkørslen!');
        }
        return;
      }
      // undvig
      const ahead = dx * fx + dz * fz;
      const lat = Math.abs(dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw));
      if (a.kind === 'ped' && v.speed > 7 && ahead > 0 && ahead < 9 && lat < 2 && Math.random() < 0.5) this.npcs.dodgeFrom(a, v.vel.x, v.vel.z);
    };
    for (const a of this.npcs.peds) check(a);
    for (const a of this.npcs.hools) check(a);
    for (const a of this.npcs.cops) check(a);
    for (const vd of this.npcs.vendors) check(vd.agent);

    // i vandet med køretøjet
    if (this.world.water.isWater(v.pos.x, v.pos.z) && v.pos.y < 0.5) {
      const [x, z] = this.world.water.nearestDry(v.pos.x, v.pos.z);
      p.exitVehicle(new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z));
      v.body.setTranslation({ x: x + 2, y: 1.5, z: z + 2 }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      audio.setEngine(false);
      audio.setSkid(0);
      this.splash();
    }
  }

  private splash() {
    if (this.splashT >= 0) return;
    this.splashT = 0;
    this.player.setMode('water');
    this.round.stats.splashes++;
    audio.splash();
    this.ui.banner('PLASK!', 'Roliganen røg i Åen', '#5aa9ff', 1.8);
  }

  private resolvePunch() {
    const p = this.player;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best: Agent | null = null, bd: number = TUNING.punchRange;
    for (const h of this.npcs.hools) {
      if (h.state === 'ko' || h.state === 'down') continue;
      const dx = h.pos.x - p.pos.x, dz = h.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(h.pos.y - p.pos.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.35) continue;
      best = h;
      bd = d;
    }
    if (best) {
      audio.punchHit();
      this.cam.shake(0.12);
      const ko = this.npcs.punchHooligan(best, fx, fz);
      const sp = this.project(best.pos.x, best.pos.y + 2, best.pos.z);
      if (sp) this.ui.floater(ko ? 'K.O.!' : 'BAM!', sp.x, sp.y);
      if (ko) {
        this.round.stats.hooligansKO++;
        this.ui.feed('Hooligan slået ud!', 'good');
        audio.cheer(0.4);
      }
      return;
    }
    // fodgængere kan ikke slås ned – de bliver bare sure
    for (const a of this.npcs.peds) {
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < TUNING.punchRange && (dx * fx + dz * fz) / (d || 1) > 0.35 && a.state === 'wander') {
        this.npcs.say(a, ['Hov hov!', 'Rolig nu, roligan!', 'Er du gal?'][Math.floor(Math.random() * 3)], 1.6);
        a.slide.set(fx * 2.5, 0, fz * 2.5);
        a.setState('dodge');
        return;
      }
    }
  }

  private onHooliganHit(h: Agent) {
    const p = this.player;
    if (this.hitImmune > 0 || p.vehicle || p.mode === 'mantle') return;
    this.hitImmune = 1.0;
    const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    p.knockback(dx / d, dz / d, 3.2);
    audio.punchHit(0.9);
    this.cam.shake(0.25);
    if (this.round.loseBeer()) {
      audio.drop();
      this.beers.drop(p.pos, dx / d, dz / d, this.now, (x, z) => !this.world.insideBuilding(x, z, 0.4) && !this.world.water.isWater(x, z));
      this.ui.feed('En hooligan slog en fadøl ud af hånden! Snup den igen!', 'bad');
      const sp = this.project(p.pos.x, p.pos.y + 2.2, p.pos.z);
      if (sp) this.ui.floater('−100', sp.x, sp.y);
    }
  }

  private offense(cop: Agent, text: string) {
    const ev = this.wanted.offense();
    if (!ev) return;
    this.lastSeenPos.copy(this.player.pos);
    this.round.stats.maxStars = Math.max(this.round.stats.maxStars, this.wanted.stars);
    audio.whistle(1);
    this.ui.feed(text, 'bad');
    this.npcs.say(cop, ['Stop!', 'Hey, dig der!', 'Politi! Stå stille!'][Math.floor(Math.random() * 3)]);
  }

  private onArrest(cop: Agent) {
    if (this.wanted.stars === 0 || this.wanted.immunity > 0 || this.frozenT > 0 || this.round.finished) return;
    const stars = this.wanted.stars;
    const lost = this.round.arrest(stars);
    this.wanted.arrested();
    const p = this.player;
    if (p.vehicle) {
      p.exitVehicle(this.safeExitPoint(p.vehicle));
      audio.setEngine(false);
      audio.setSkid(0);
    }
    this.frozenT = 1.6;
    this.stealing = null;
    this.ui.progress(null);
    audio.whistle(1.2);
    this.ui.banner('Anholdt!', `${stars} ${stars === 1 ? 'stjerne' : 'stjerner'} · −${formatPoints(lost)} point`, '#5aa9ff', 2.4);
    this.npcs.say(cop, 'Så er det slut med sjov! Bøde!', 2);
    for (const c of this.npcs.cops) if (c.state === 'chase') c.setState('return');
  }

  private onBeer(b: Beer) {
    const recovered = b.kind === 'dropped';
    this.round.addBeer(recovered);
    audio.beer();
    const sp = this.project(b.pos.x, b.pos.y + 1.4, b.pos.z);
    if (sp) this.ui.floater('+100', sp.x, sp.y);
    this.ui.feed(recovered ? 'Fadøllen er reddet!' : b.name ? `+100 · ${b.name}` : b.kind === 'cart' ? '+100 · Fadølsvognen' : '+100 · Fadøl i højden!', 'good');
  }

  private revealFanzone() {
    const id = this.round.fanzone;
    const c = this.world.square(id);
    this.fanzone = new Fanzone(c, RULES.fanzoneRadius, (x, z) => !this.world.insideBuilding(x, z, 0.6) && !this.world.water.isWater(x, z));
    this.scene.add(this.fanzone.group);
    this.ui.banner('Fanzonen er åben!', `Nå til ${FANZONE_NAMES[id]} inden kickoff`, '#2fbf71', 3);
    audio.cheer(0.6);
  }

  // ------------------------------------------------------------ HUD m.m.
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private mapDots(big: boolean): MapDot[] {
    const dots: MapDot[] = [];
    const p = this.player.pos;
    for (const b of this.beers.beers) {
      if (!b.available || b.kind === 'dropped') continue;
      if (!big && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) > 190) continue;
      dots.push({ x: b.pos.x, z: b.pos.z, kind: b.kind === 'cart' ? 'cart' : 'beer' });
    }
    if (this.wanted.stars > 0) for (const c of this.npcs.cops) dots.push({ x: c.pos.x, z: c.pos.z, kind: 'cop' });
    for (const h of this.npcs.hools) if (h.state !== 'ko' && Math.hypot(h.pos.x - p.x, h.pos.z - p.z) < (big ? 9999 : 90)) dots.push({ x: h.pos.x, z: h.pos.z, kind: 'hool' });
    return dots;
  }

  private drawHud(dt: number) {
    const p = this.player;
    const fz = this.round.revealed && this.fanzone ? this.fanzone.center : null;
    this.ui.updateHud({
      timeLeft: this.round.timeLeft, beers: this.round.beers, points: this.round.points, stars: this.wanted.stars,
      fanzone: fz ? FANZONE_NAMES[this.round.fanzone] : null, fanzoneDist: fz ? Math.hypot(fz.x - p.pos.x, fz.z - p.pos.z) : null,
      locked: this.input.locked || this.testMode, playing: this.state === 'playing',
    });
    this.minimapAcc += dt;
    if (this.minimapAcc > 1 / 30) {
      this.minimapAcc = 0;
      const route = fz && this.state === 'playing' ? this.routeFinder.update(this.now, [p.pos.x, p.pos.z], [fz.x, fz.z]) : null;
      this.map.drawMini(this.ui.minimapCanvas, p.pos.x, p.pos.z, this.cam.yaw, p.yaw, this.mapDots(false), fz ? { x: fz.x, z: fz.z } : null, route);
    }
    // bobler og barnavne
    const items: { key: string; kind: 'bubble' | 'label'; text: string; x: number; y: number }[] = [];
    this.bubbles = this.bubbles.filter((b) => b.until > this.now || (this.state !== 'playing' && b.until > this.realTime));
    for (const b of this.bubbles) {
      const a = b.agent;
      if (a.pos.distanceTo(p.pos) > 45) continue;
      const sp = this.project(a.pos.x, a.pos.y + 2.35, a.pos.z);
      if (sp) items.push({ key: 'b' + this.bubbles.indexOf(b) + b.text, kind: 'bubble', text: b.text, x: sp.x, y: sp.y });
    }
    let labels = 0;
    for (const b of this.beers.beers) {
      if (!b.available || !b.name || labels >= 4) continue;
      if (Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) > 28) continue;
      const sp = this.project(b.pos.x, b.pos.y + 1.7, b.pos.z);
      if (sp) { items.push({ key: 'l' + b.id, kind: 'label', text: b.name, x: sp.x, y: sp.y }); labels++; }
    }
    this.ui.drawWorldLabels(items);
    if (fz) {
      const sp = this.project(fz.x, 7, fz.z);
      this.ui.marker(sp ? { x: sp.x, y: sp.y, dist: Math.hypot(fz.x - p.pos.x, fz.z - p.pos.z), onScreen: true } : null);
    } else this.ui.marker(null);
  }

  // ------------------------------------------------------------ ydelse
  private trackFps(dt: number) {
    if (this.qFixedQuality) return;
    if (this.state !== 'playing' && this.state !== 'menu') return;
    this.fps.acc += dt;
    this.fps.frames++;
    if (this.fps.acc < 2) return;
    const fps = this.fps.frames / this.fps.acc;
    this.fps.acc = 0;
    this.fps.frames = 0;
    if (fps < 50) {
      // Trin for trin: bløde skygger → skarpe, opløsning ned, mindre skyggekort
      this.fps.good = 0;
      if (this.renderer.shadowMap.type === THREE.PCFSoftShadowMap) {
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
          else if (m) m.needsUpdate = true;
        });
      } else if (this.pixelRatio > 0.85) {
        this.pixelRatio = Math.max(0.85, this.pixelRatio - 0.15);
        this.renderer.setPixelRatio(this.pixelRatio);
      } else if (this.world.sky.sun.shadow.mapSize.x > 1024) {
        this.world.sky.setShadowQuality(1024);
      } else if (this.pixelRatio > 0.7) {
        this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.15);
        this.renderer.setPixelRatio(this.pixelRatio);
      }
    } else if (fps > 58) {
      this.fps.good++;
      const max = Math.min(window.devicePixelRatio || 1, 1.5);
      if (this.fps.good > 3 && this.pixelRatio < max) {
        this.pixelRatio = Math.min(max, this.pixelRatio + 0.25);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.fps.good = 0;
      }
    }
  }

  /** Til automatiske tests. */
  debugState() {
    const p = this.player;
    return {
      state: this.state, pos: [p.pos.x, p.pos.y, p.pos.z], mode: p.mode, vehicle: p.vehicle?.kind ?? null,
      beers: this.round.beers, points: this.round.points, stars: this.wanted.stars, timeLeft: this.round.timeLeft,
      revealed: this.round.revealed, fanzone: this.round.fanzone, outcome: this.round.outcome, pixelRatio: this.pixelRatio,
      calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      peds: this.npcs.peds.length, hools: this.npcs.hools.length, cops: this.npcs.cops.length, vehicles: this.vehicles.list.length, cpuMs: this.cpuMs,
    };
  }
}

void VEHICLES;
