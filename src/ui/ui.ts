// Al DOM-brugerflade: menuer, roligan-valg, HUD, bannere, bobler, kort og slutskærm.
import { ROLIGANS, type RoliganDef } from '../config.ts';
import type { ScoreEntry, Settings } from '../core/storage.ts';
import { formatPoints, formatTime, type RoundStats } from '../game/rules.ts';

export type ScreenName = 'loading' | 'menu' | 'select' | 'countdown' | 'hud' | 'pause' | 'settings' | 'controls' | 'credits' | 'highscores' | 'bigmap' | 'end' | 'error';

export interface UICallbacks {
  play(): void;
  pickRoligan(i: number): void;
  confirmRoligan(): void;
  resume(): void;
  quitRound(): void;
  restart(): void;
  changeRoligan(): void;
  toMenu(): void;
  settingsChanged(s: Settings): void;
  saveScore(name: string): void;
  back(): void;
}

const BEER_SVG = `<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M6 10h24l-2 34a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#f2b233" stroke="#0e1b2e" stroke-width="3"/><path d="M30 16h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-5" fill="none" stroke="#0e1b2e" stroke-width="3"/><path d="M4 12c0-6 5-9 9-7 2-4 9-4 11 0 4-2 9 1 8 7z" fill="#fffbf0" stroke="#0e1b2e" stroke-width="3"/></svg>`;
const STAR_SVG = (on: boolean) => `<svg viewBox="0 0 24 24" class="${on ? 'on' : ''}" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" fill="${on ? '#ffffff' : 'rgba(255,255,255,0.12)'}" stroke="${on ? '#0e1b2e' : 'rgba(255,255,255,0.55)'}" stroke-width="1.8"/></svg>`;
const FLAG_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2v20" stroke="#fff" stroke-width="2.5"/><path d="M6 3h13l-3 4 3 4H6z" fill="#2fbf71" stroke="#0e1b2e" stroke-width="1.5"/></svg>`;

export class UI {
  readonly root: HTMLElement;
  private screens = new Map<ScreenName, HTMLElement>();
  private cb: UICallbacks;
  private hudEls!: {
    time: HTMLElement; timer: HTMLElement; fz: HTMLElement; beers: HTMLElement; beerBox: HTMLElement; points: HTMLElement; stars: HTMLElement;
    feed: HTMLElement; prompt: HTMLElement; progress: HTMLElement; progressBar: HTMLElement; banner: HTMLElement; minimap: HTMLCanvasElement; lockhint: HTMLElement;
    layer: HTMLElement; marker: HTMLElement;
  };
  private lastStars = -1;
  private lastBeers = -1;
  private bannerTimer = 0;
  private settings: Settings;
  selected = 0;

  constructor(root: HTMLElement, cb: UICallbacks, settings: Settings) {
    this.root = root;
    this.cb = cb;
    this.settings = settings;
    this.build();
  }

  // ------------------------------------------------------------ opbygning
  private add(name: ScreenName, html: string, cls = 'screen'): HTMLElement {
    const el = document.createElement('div');
    el.className = cls + ' hidden';
    el.dataset.screen = name;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screens.set(name, el);
    return el;
  }

  private build() {
    this.add('loading', `
      <h1 class="title outline">Before<span>the Match</span></h1>
      <div class="loader" role="progressbar" aria-label="Indlæser"><i id="loadbar"></i></div>
      <p class="tagline outline-sm" id="loadtext">Bygger Aarhus Midtby …</p>`, 'screen solid');

    const menu = this.add('menu', `
      <h1 class="title outline">Before<span>the Match</span></h1>
      <p class="tagline outline-sm">Aarhus Midtby. Fem minutter til kickoff. Find så mange fadøl som muligt – og nå fanzonen i tide.</p>
      <div class="stack">
        <button class="btn" data-act="play">Spil</button>
        <div class="row">
          <button class="btn secondary small" data-act="controls">Styring</button>
          <button class="btn secondary small" data-act="highscores">Highscore</button>
          <button class="btn secondary small" data-act="settings">Indstillinger</button>
          <button class="btn secondary small" data-act="credits">Credits</button>
        </div>
      </div>
      <p class="fineprint">Et fanprojekt – ikke tilknyttet DBU. Nyd din fadøl med måde.</p>`, 'screen dim');
    menu.addEventListener('click', (e) => this.onAct(e));

    const sel = this.add('select', `
      <div class="select-top"><h2 class="outline">Vælg din roligan</h2></div>
      <div class="select-name"><div class="name outline" id="selname"></div><p class="tag outline-sm" id="seltag"></p></div>
      <div class="select-actions">
        <button class="btn secondary arrow-btn" data-act="prev" aria-label="Forrige roligan">‹</button>
        <button class="btn" data-act="confirm">Afsted!</button>
        <button class="btn secondary arrow-btn" data-act="next" aria-label="Næste roligan">›</button>
      </div>
      <div class="cards" role="group" aria-label="Roligans">${ROLIGANS.map((r, i) => `
        <button class="card" data-idx="${i}" aria-pressed="false">
          <div class="avatar" style="background:${r.skin}">${avatarSvg(r)}</div>
          <div class="cname">${r.name}</div>
        </button>`).join('')}
      </div>`, 'screen');
    sel.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (card) { this.cb.pickRoligan(+card.dataset.idx!); return; }
      this.onAct(e);
    });

    this.add('countdown', `<div class="count outline" id="countnum">3</div>`, 'screen');

    const hud = this.add('hud', `
      <div id="hud">
        <div class="timer" aria-live="off"><div class="label outline-sm">KICKOFF OM</div><div class="time outline" id="time">5:00</div><div class="fz hidden" id="fz"></div></div>
        <div class="score">
          <div class="beers outline" id="beerbox">${BEER_SVG}<span id="beers">0</span></div>
          <div class="points outline-sm" id="points">0 point</div>
          <div class="stars" id="stars" aria-label="Politiets efterlysning"></div>
        </div>
        <div class="feed" id="feed" aria-live="polite"></div>
        <div id="layer"></div>
        <div class="marker3d hidden" id="marker">${FLAG_SVG}<div class="outline-sm">FANZONE</div><div class="dist" id="markerdist"></div></div>
        <div class="banner" id="banner"></div>
        <div class="progress hidden" id="progress"><i id="progressbar"></i></div>
        <div class="prompt hidden" id="prompt"></div>
        <div class="minimap"><canvas id="minimap" width="196" height="196"></canvas></div>
        <div class="lockhint hidden interactive" id="lockhint">Klik for at styre kameraet med musen</div>
      </div>`, 'screen');
    hud.style.pointerEvents = 'none';
    hud.style.display = '';
    const q = (id: string) => hud.querySelector('#' + id) as HTMLElement;
    this.hudEls = {
      time: q('time'), timer: hud.querySelector('.timer') as HTMLElement, fz: q('fz'), beers: q('beers'), beerBox: q('beerbox'), points: q('points'), stars: q('stars'),
      feed: q('feed'), prompt: q('prompt'), progress: q('progress'), progressBar: q('progressbar'), banner: q('banner'),
      minimap: q('minimap') as HTMLCanvasElement, lockhint: q('lockhint'), layer: q('layer'), marker: q('marker'),
    };

    const pause = this.add('pause', `
      <h1 class="title outline" style="font-size:88px">Pause</h1>
      <div class="stack">
        <button class="btn" data-act="resume">Fortsæt</button>
        <button class="btn secondary small" data-act="settings">Indstillinger</button>
        <button class="btn secondary small" data-act="controls">Styring</button>
        <button class="btn secondary small" data-act="quit">Afslut runden</button>
      </div>`, 'screen dim');
    pause.addEventListener('click', (e) => this.onAct(e));

    const settings = this.add('settings', `
      <div class="panel">
        <h2>Indstillinger</h2>
        <div class="setting"><label for="sens">Musefølsomhed</label><input id="sens" type="range" min="0.2" max="3" step="0.1"><output id="senso"></output></div>
        <div class="setting"><label for="vol">Lydstyrke</label><input id="vol" type="range" min="0" max="1" step="0.05"><output id="volo"></output></div>
        <div class="setting"><span id="invl">Omvendt kamera (op/ned)</span><button class="toggle" id="inv" role="switch" aria-labelledby="invl"></button><span></span></div>
        <div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn small" data-act="back">Tilbage</button></div>
      </div>`, 'screen dim');
    settings.addEventListener('click', (e) => this.onAct(e));
    const sens = settings.querySelector('#sens') as HTMLInputElement;
    const vol = settings.querySelector('#vol') as HTMLInputElement;
    const inv = settings.querySelector('#inv') as HTMLButtonElement;
    const sync = () => {
      sens.value = String(this.settings.sensitivity);
      vol.value = String(this.settings.volume);
      (settings.querySelector('#senso') as HTMLOutputElement).textContent = this.settings.sensitivity.toFixed(1);
      (settings.querySelector('#volo') as HTMLOutputElement).textContent = Math.round(this.settings.volume * 100) + '%';
      inv.setAttribute('aria-checked', String(this.settings.invertY));
    };
    sync();
    sens.addEventListener('input', () => { this.settings.sensitivity = +sens.value; sync(); this.cb.settingsChanged(this.settings); });
    vol.addEventListener('input', () => { this.settings.volume = +vol.value; sync(); this.cb.settingsChanged(this.settings); });
    inv.addEventListener('click', () => { this.settings.invertY = !this.settings.invertY; sync(); this.cb.settingsChanged(this.settings); });

    const controls = this.add('controls', `
      <div class="panel">
        <h2>Styring</h2>
        <div class="controls-grid">
          <div><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span></div><div>Gå / kør</div>
          <div><span class="key">Mus</span></div><div>Kamera</div>
          <div><span class="key">Shift</span></div><div>Løb</div>
          <div><span class="key">Mellemrum</span></div><div>Hop og klatr op · håndbremse i bil</div>
          <div><span class="key">E</span></div><div>Stig ind / af (biler skal brydes op)</div>
          <div><span class="key">Venstre klik</span></div><div>Slå (kun hooligans kan slås ned)</div>
          <div><span class="key">M</span></div><div>Kort</div>
          <div><span class="key">Esc</span></div><div>Pause</div>
        </div>
        <p>Saml fadøl ved barerne (gule lysstråler), på fadølsvognene og oppe på stilladser, containere og halvtage. Hver fadøl giver 100 point.</p>
        <p>Stjæler du en bil eller kører en fodgænger ned, mens en betjent ser det, får du en stjerne. Bliver du anholdt, mister du 10 % af pointene pr. stjerne. Hold dig ude af syne for at slippe væk.</p>
        <p>I det sidste minut åbner fanzonen. Når du den inden kickoff, beholder du dine point – ellers mister du halvdelen.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn small" data-act="back">Tilbage</button></div>
      </div>`, 'screen dim');
    controls.addEventListener('click', (e) => this.onAct(e));

    const credits = this.add('credits', `
      <div class="panel scroll">
        <h2>Credits</h2>
        <p><b>Before the Match</b> – et fanprojekt om Aarhus Midtby på kampdag. Ikke tilknyttet DBU, Aarhus Kommune eller nogen af byens forretninger. Barerne har opdigtede navne.</p>
        <p>Kortdata © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, ODbL.</p>
        <p>3D: <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> · Fysik: <a href="https://rapier.rs" target="_blank" rel="noopener">Rapier</a></p>
        <p>Skrifttyper: Luckiest Guy og Nunito (SIL Open Font License).</p>
        <p>Alle lyde er genereret af spillets egen kode i browseren og frigives som CC0.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn small" data-act="back">Tilbage</button></div>
      </div>`, 'screen dim');
    credits.addEventListener('click', (e) => this.onAct(e));

    const hs = this.add('highscores', `
      <div class="panel scroll"><h2>Highscore</h2><div id="hstable"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn small" data-act="back">Tilbage</button></div></div>`, 'screen dim');
    hs.addEventListener('click', (e) => this.onAct(e));

    this.add('bigmap', `
      <canvas id="bigmap"></canvas>
      <div class="legend outline-sm">
        <span><i style="background:#f2b233"></i>Fadøl</span><span><i style="background:#ff8a00"></i>Fadølsvogn</span>
        <span><i style="background:#2fbf71"></i>Fanzone</span><span><i style="background:#3d7bff"></i>Politi (efterlyst)</span>
        <span><i style="background:#fecc00;border-color:#006aa7"></i>Hooligans</span>
      </div>
      <p class="fineprint outline-sm">Tryk <span class="key">M</span> for at lukke kortet</p>`, 'screen bigmap');

    const end = this.add('end', `<div class="panel result" id="endpanel"></div>`, 'screen dim');
    end.addEventListener('click', (e) => this.onAct(e));

    this.add('error', `<div class="panel"><h2>Øv!</h2><p id="errtext"></p></div>`, 'screen solid');
  }

  private onAct(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b) return;
    const act = b.dataset.act!;
    const map: Record<string, () => void> = {
      play: () => this.cb.play(),
      controls: () => this.overlay('controls'),
      highscores: () => this.overlay('highscores'),
      settings: () => this.overlay('settings'),
      credits: () => this.overlay('credits'),
      back: () => this.cb.back(),
      prev: () => this.cb.pickRoligan((this.selected + ROLIGANS.length - 1) % ROLIGANS.length),
      next: () => this.cb.pickRoligan((this.selected + 1) % ROLIGANS.length),
      confirm: () => this.cb.confirmRoligan(),
      resume: () => this.cb.resume(),
      quit: () => this.cb.quitRound(),
      restart: () => this.cb.restart(),
      change: () => this.cb.changeRoligan(),
      menu: () => this.cb.toMenu(),
      save: () => {
        const inp = this.root.querySelector('#hsname') as HTMLInputElement | null;
        this.cb.saveScore((inp?.value ?? '').trim() || 'Roligan');
      },
    };
    map[act]?.();
  }

  // ------------------------------------------------------------ skærmstyring
  private overlayStack: ScreenName[] = [];
  current: ScreenName = 'loading';

  show(name: ScreenName, keepHud = false) {
    this.overlayStack = [];
    for (const [n, el] of this.screens) el.classList.toggle('hidden', !(n === name || (keepHud && n === 'hud')));
    this.current = name;
    this.focusFirst(name);
  }

  /** Vis en undermenu oven på den nuværende (Tilbage lukker den). */
  overlay(name: ScreenName) {
    if (name === 'highscores') this.renderHighscores();
    this.overlayStack.push(this.current);
    this.screens.get(this.current)?.classList.add('hidden');
    this.screens.get(name)!.classList.remove('hidden');
    this.current = name;
    this.focusFirst(name);
  }

  /** Luk undermenu. Returnerer false hvis der ikke var nogen. */
  popOverlay(): boolean {
    const prev = this.overlayStack.pop();
    if (!prev) return false;
    this.screens.get(this.current)?.classList.add('hidden');
    this.screens.get(prev)!.classList.remove('hidden');
    this.current = prev;
    this.focusFirst(prev);
    return true;
  }

  private focusFirst(name: ScreenName) {
    const el = this.screens.get(name);
    const b = el?.querySelector('button, input') as HTMLElement | null;
    if (b && name !== 'hud' && name !== 'countdown') setTimeout(() => b.focus({ preventScroll: true }), 30);
  }

  setLoading(frac: number, text: string) {
    (this.root.querySelector('#loadbar') as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
    (this.root.querySelector('#loadtext') as HTMLElement).textContent = text;
  }

  showError(text: string) {
    (this.root.querySelector('#errtext') as HTMLElement).textContent = text;
    this.show('error');
  }

  setSelected(i: number) {
    this.selected = i;
    const r = ROLIGANS[i];
    (this.root.querySelector('#selname') as HTMLElement).textContent = r.name;
    (this.root.querySelector('#seltag') as HTMLElement).textContent = r.tagline;
    this.root.querySelectorAll('.card').forEach((c, k) => c.setAttribute('aria-pressed', String(k === i)));
  }

  setCountdown(text: string) {
    const el = this.root.querySelector('#countnum') as HTMLElement;
    el.textContent = text;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  // ------------------------------------------------------------ HUD
  updateHud(s: { timeLeft: number; beers: number; points: number; stars: number; fanzone: string | null; fanzoneDist: number | null; locked: boolean; playing: boolean }) {
    const h = this.hudEls;
    h.time.textContent = formatTime(s.timeLeft);
    h.timer.classList.toggle('urgent', s.timeLeft <= 60);
    if (s.fanzone) {
      h.fz.classList.remove('hidden');
      h.fz.textContent = `Fanzone: ${s.fanzone}${s.fanzoneDist !== null ? ` · ${Math.round(s.fanzoneDist)} m` : ''}`;
    } else h.fz.classList.add('hidden');
    if (s.beers !== this.lastBeers) {
      h.beers.textContent = String(s.beers);
      if (this.lastBeers >= 0 && s.beers > this.lastBeers) {
        h.beerBox.classList.remove('bump');
        void h.beerBox.offsetWidth;
        h.beerBox.classList.add('bump');
      }
      this.lastBeers = s.beers;
    }
    h.points.textContent = `${formatPoints(s.points)} point`;
    if (s.stars !== this.lastStars) {
      h.stars.innerHTML = [0, 1, 2].map((i) => STAR_SVG(i < s.stars)).join('');
      h.stars.setAttribute('aria-label', `Efterlyst: ${s.stars} af 3 stjerner`);
      this.lastStars = s.stars;
    }
    h.lockhint.classList.toggle('hidden', s.locked || !s.playing);
  }

  resetHud() {
    this.lastBeers = -1;
    this.lastStars = -1;
    this.hudEls.feed.innerHTML = '';
    this.hudEls.banner.innerHTML = '';
    this.hudEls.layer.innerHTML = '';
  }

  prompt(text: string | null) {
    const p = this.hudEls.prompt;
    if (!text) { p.classList.add('hidden'); return; }
    p.innerHTML = text;
    p.classList.remove('hidden');
  }

  progress(frac: number | null) {
    const p = this.hudEls.progress;
    if (frac === null) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    this.hudEls.progressBar.style.width = `${Math.round(frac * 100)}%`;
  }

  feed(text: string, kind: 'good' | 'bad' | 'info' = 'good') {
    const d = document.createElement('div');
    d.className = kind;
    d.textContent = text;
    this.hudEls.feed.prepend(d);
    while (this.hudEls.feed.children.length > 5) this.hudEls.feed.lastElementChild!.remove();
    setTimeout(() => d.remove(), 4200);
  }

  banner(big: string, sub = '', color = '#ffffff', secs = 2.4) {
    const b = this.hudEls.banner;
    b.innerHTML = `<div class="big outline" style="color:${color}">${big}</div>${sub ? `<div class="sub outline-sm">${sub}</div>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.innerHTML = ''), secs * 1000);
  }

  floater(text: string, x: number, y: number) {
    const f = document.createElement('div');
    f.className = 'floater outline-sm';
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    this.hudEls.layer.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  get minimapCanvas() {
    return this.hudEls.minimap;
  }

  /** Tegn bobler/etiketter i skærmkoordinater (kaldes hver frame). */
  drawWorldLabels(items: { key: string; kind: 'bubble' | 'label'; text: string; x: number; y: number }[]) {
    const layer = this.hudEls.layer;
    const keep = new Set<string>();
    for (const it of items) {
      keep.add(it.key);
      let el = layer.querySelector(`[data-k="${it.key}"]`) as HTMLElement | null;
      if (!el) {
        el = document.createElement('div');
        el.dataset.k = it.key;
        el.className = it.kind === 'bubble' ? 'bubble' : 'label3d';
        layer.appendChild(el);
      }
      if (el.textContent !== it.text) el.textContent = it.text;
      el.style.left = `${it.x}px`;
      el.style.top = `${it.y}px`;
    }
    for (const el of Array.from(layer.querySelectorAll('[data-k]'))) if (!keep.has((el as HTMLElement).dataset.k!)) el.remove();
  }

  marker(pos: { x: number; y: number; dist: number; onScreen: boolean } | null) {
    const m = this.hudEls.marker;
    if (!pos) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.style.left = `${pos.x}px`;
    m.style.top = `${pos.y}px`;
    (m.querySelector('#markerdist') as HTMLElement).textContent = `${Math.round(pos.dist)} m`;
  }

  get bigmapCanvas() {
    return this.root.querySelector('#bigmap') as HTMLCanvasElement;
  }

  // ------------------------------------------------------------ slutskærm og highscore
  renderEnd(r: { outcome: 'ontime' | 'late'; points: number; lost: number; beers: number; stats: RoundStats; roligan: RoliganDef; qualifies: boolean; list: ScoreEntry[]; myRank: number; saved: boolean }) {
    const p = this.root.querySelector('#endpanel') as HTMLElement;
    const on = r.outcome === 'ontime';
    const s = r.stats;
    p.innerHTML = `
      <div class="endgrid">
        <div class="endcol">
          <h1 class="outline" style="color:${on ? '#2fbf71' : '#ff4d5e'}">${on ? 'Du nåede kickoff!' : 'For sent til kickoff!'}</h1>
          <p class="endsub">${on ? `${r.roligan.name} står klar i fanzonen med en kold fadøl.` : `Dommeren har fløjtet. Du mister halvdelen: −${formatPoints(r.lost)} point.`}</p>
          <div class="pts outline">${formatPoints(r.points)}<small> point</small></div>
          <div class="statgrid">
            <div><b>${s.beersCollected}</b><span>fadøl fundet</span></div>
            <div><b>${s.beersDropped}</b><span>tabt til hooligans</span></div>
            <div><b>${s.hooligansKO}</b><span>hooligans slået ud</span></div>
            <div><b>${s.arrests}</b><span>anholdelser (−${formatPoints(s.pointsLostToPolice)})</span></div>
            <div><b>${s.carsStolen}</b><span>biler stjålet</span></div>
            <div><b>${s.pedestriansKnocked}</b><span>fodgængere væltet</span></div>
          </div>
        </div>
        <div class="endcol">
          ${r.qualifies && !r.saved ? `
            <label for="hsname" class="hslabel">Du kom på highscore-listen! Skriv dit navn:</label>
            <div class="namebox"><input id="hsname" maxlength="16" value="${escapeHtml(r.roligan.name)}" autocomplete="off"><button class="btn small" data-act="save">Gem</button></div>` : '<h2 class="hshead">Highscore</h2>'}
          ${r.saved || !r.qualifies ? this.highscoreTable(r.list, r.myRank) : ''}
          <div class="row endbtns">
            <button class="btn" data-act="restart">Spil igen</button>
            <button class="btn secondary small" data-act="change">Skift roligan</button>
            <button class="btn secondary small" data-act="menu">Menu</button>
          </div>
        </div>
      </div>`;
    const inp = p.querySelector('#hsname') as HTMLInputElement | null;
    if (inp) {
      setTimeout(() => { inp.focus({ preventScroll: true }); inp.select(); }, 60);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.cb.saveScore(inp.value.trim() || 'Roligan'); e.stopPropagation(); });
    } else this.focusFirst('end');
  }

  highscoreTable(list: ScoreEntry[], me = -1): string {
    if (!list.length) return `<p>Ingen scores endnu – vær den første!</p>`;
    return `<table class="hs"><thead><tr><th>#</th><th>Navn</th><th>Roligan</th><th class="num">Fadøl</th><th class="num">Point</th></tr></thead><tbody>
      ${list.map((e, i) => `<tr class="${i === me ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(e.name)}${e.onTime ? '' : ' <span title="For sent til kickoff">⏱</span>'}</td><td>${escapeHtml(e.roligan)}</td><td class="num">${e.beers}</td><td class="num">${formatPoints(e.points)}</td></tr>`).join('')}
      </tbody></table>`;
  }

  scoresProvider: () => ScoreEntry[] = () => [];

  private renderHighscores() {
    (this.root.querySelector('#hstable') as HTMLElement).innerHTML = this.highscoreTable(this.scoresProvider());
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function avatarSvg(r: RoliganDef): string {
  return `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
    <rect width="64" height="64" fill="${r.skin}"/>
    <rect x="6" y="36" width="14" height="10" fill="#c8102e"/><rect x="10" y="36" width="3" height="10" fill="#fff"/><rect x="6" y="39.5" width="14" height="3" fill="#fff"/>
    <rect x="44" y="36" width="14" height="10" fill="#c8102e"/><rect x="48" y="36" width="3" height="10" fill="#fff"/><rect x="44" y="39.5" width="14" height="3" fill="#fff"/>
    <rect x="16" y="24" width="10" height="8" fill="#fff"/><rect x="38" y="24" width="10" height="8" fill="#fff"/>
    <rect x="19" y="25" width="5" height="6" fill="#2b1d14"/><rect x="41" y="25" width="5" height="6" fill="#2b1d14"/>
    ${r.beard ? `<rect x="8" y="44" width="48" height="20" fill="${r.hair}"/>` : ''}
    <rect x="24" y="48" width="16" height="5" fill="#7a2a22"/>
    <path d="M6 16 Q32 -6 58 16 L58 12 Q32 -10 6 12z" fill="#9aa3ab"/><rect x="4" y="12" width="56" height="6" fill="#6f777e"/>
    <path d="M4 14 L-2 0 L8 10z" fill="#efe6cf"/><path d="M60 14 L66 0 L56 10z" fill="#efe6cf"/>
  </svg>`;
}
