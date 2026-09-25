// Alle lyde syntetiseres i browseren med Web Audio (ingen lydfiler).
// Lydene er genereret af spillets egen kode og frigives som CC0.

type Wave = OscillatorType;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noiseBuf!: AudioBuffer;
  private analyser: AnalyserNode | null = null;
  private volume = 0.8;
  private engine: { osc1: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private skid: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private ambience: { gain: GainNode; crowd: GainNode; crowdFilter: BiquadFilterNode } | null = null;
  private drumTimer: number | null = null;
  private drumBpm = 0;
  private nextBeat = 0;
  private beatIdx = 0;

  get ready() {
    return !!this.ctx;
  }

  /** Skal kaldes fra en brugerhandling (klik/tast). */
  unlock() {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      comp.connect(this.analyser);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Aktuelt lydniveau (RMS 0–1) – bruges af tests til at bekræfte, at der kommer lyd. */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    return Math.sqrt(s / buf.length);
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  private tone(freq: number, dur: number, vol: number, type: Wave = 'sine', freqEnd?: number, attack = 0.005, delay = 0, dest?: AudioNode) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, freqEnd?: number, delay = 0, attack = 0.004) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------ enkeltlyde
  beer() {
    // "klink" + et par slurke
    this.tone(2350, 0.25, 0.22, 'sine');
    this.tone(3520, 0.18, 0.12, 'sine', undefined, 0.003, 0.01);
    for (let i = 0; i < 3; i++) this.noise(0.09, 0.2, 'lowpass', 420, 6, 180, 0.12 + i * 0.11);
    this.tone(660, 0.12, 0.08, 'triangle', 990, 0.01, 0.42);
  }
  pointsUp() {
    this.tone(880, 0.08, 0.08, 'square', undefined, 0.002);
    this.tone(1320, 0.12, 0.08, 'square', undefined, 0.002, 0.07);
  }
  swing() {
    this.noise(0.16, 0.12, 'bandpass', 900, 1.5, 2600);
  }
  punchHit(vol = 1) {
    this.tone(110, 0.14, 0.5 * vol, 'sine', 55);
    this.noise(0.08, 0.35 * vol, 'lowpass', 1800, 1, 400);
  }
  thud(vol = 1) {
    this.tone(80, 0.2, 0.45 * vol, 'sine', 40);
    this.noise(0.12, 0.2 * vol, 'lowpass', 600, 1);
  }
  jump() {
    this.noise(0.18, 0.08, 'bandpass', 500, 2, 1400);
  }
  land() {
    this.noise(0.1, 0.12, 'lowpass', 500, 1);
  }
  step(run: boolean) {
    this.noise(0.05, run ? 0.07 : 0.045, 'bandpass', 1600 + Math.random() * 600, 2);
  }
  splash() {
    this.noise(0.9, 0.5, 'lowpass', 2400, 0.7, 300);
    for (let i = 0; i < 6; i++) this.tone(500 + Math.random() * 700, 0.08, 0.05, 'sine', 900 + Math.random() * 900, 0.005, 0.2 + i * 0.09);
  }
  crash(intensity: number) {
    const v = Math.min(1, intensity);
    this.noise(0.45, 0.6 * v, 'lowpass', 3000, 0.8, 200);
    this.tone(70, 0.3, 0.5 * v, 'sine', 35);
    if (v > 0.5) for (let i = 0; i < 5; i++) this.tone(3000 + Math.random() * 3000, 0.1, 0.05 * v, 'sine', undefined, 0.002, 0.05 + i * 0.04);
  }
  glassSmash() {
    this.noise(0.35, 0.4, 'highpass', 3000, 0.7);
    for (let i = 0; i < 8; i++) this.tone(2500 + Math.random() * 4000, 0.12, 0.06, 'sine', undefined, 0.002, 0.03 + i * 0.035);
  }
  bell() {
    this.tone(2100, 0.6, 0.18, 'sine');
    this.tone(2100 * 2.76, 0.3, 0.05, 'sine');
    this.tone(2100, 0.5, 0.14, 'sine', undefined, 0.003, 0.18);
  }
  whistle(vol = 1, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const o = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    const g = this.ctx.createGain();
    o.frequency.value = 2900;
    lfo.frequency.value = 28;
    lg.gain.value = 180;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18 * vol, t0 + 0.02);
    g.gain.setValueAtTime(0.18 * vol, t0 + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    o.connect(g).connect(this.sfx);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 0.6);
    lfo.stop(t0 + 0.6);
  }
  kickoffWhistle() {
    this.whistle(1.2, 0);
    this.whistle(1.2, 0.7);
    this.whistle(1.3, 1.4);
  }
  beep(high = false) {
    this.tone(high ? 1320 : 660, high ? 0.6 : 0.2, 0.18, 'square', undefined, 0.003);
  }
  click() {
    this.tone(1200, 0.05, 0.06, 'square', 800, 0.002);
  }
  drop() {
    this.tone(1900, 0.2, 0.12, 'sine', 900);
    this.noise(0.25, 0.18, 'lowpass', 900, 3, 300, 0.12);
  }
  cheer(vol = 1) {
    this.noise(2.2, 0.35 * vol, 'bandpass', 900, 0.6, 1500, 0, 0.4);
    this.noise(1.8, 0.2 * vol, 'bandpass', 2200, 0.8, 1800, 0.2, 0.3);
  }
  boo() {
    this.noise(1.4, 0.25, 'bandpass', 350, 1.5, 250, 0, 0.3);
  }
  horn() {
    this.tone(415, 0.35, 0.18, 'sawtooth');
    this.tone(523, 0.35, 0.14, 'sawtooth');
  }

  // ------------------------------------------------------------ vedvarende lyde
  setEngine(on: boolean, speed = 0, throttle = 0) {
    if (!this.ctx) return;
    if (on && !this.engine) {
      const ctx = this.ctx;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.sfx);
      osc1.start();
      osc2.start();
      this.engine = { osc1, osc2, filter, gain };
    }
    if (!this.engine) return;
    if (!on) {
      const e = this.engine;
      e.gain.gain.setTargetAtTime(0.0001, this.t, 0.08);
      setTimeout(() => { e.osc1.stop(); e.osc2.stop(); }, 400);
      this.engine = null;
      return;
    }
    // Simpel "gearkasse": omdrejninger stiger og falder pr. gear
    const gears = [0, 6, 12, 18, 30];
    let g = 1;
    while (g < gears.length - 1 && speed > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const rpm = 0.25 + 0.75 * Math.min(1, (speed - lo) / (hi - lo));
    const f = 38 + rpm * 70 + throttle * 12;
    this.engine.osc1.frequency.setTargetAtTime(f, this.t, 0.05);
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, this.t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(300 + rpm * 900 + throttle * 600, this.t, 0.05);
    this.engine.gain.gain.setTargetAtTime(0.06 + throttle * 0.06 + rpm * 0.03, this.t, 0.08);
  }

  setSkid(amount: number) {
    if (!this.ctx) return;
    if (amount > 0.05 && !this.skid) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1700;
      filter.Q.value = 6;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(this.sfx);
      src.start();
      this.skid = { src, gain, filter };
    }
    if (!this.skid) return;
    this.skid.gain.gain.setTargetAtTime(Math.min(0.25, amount * 0.25), this.t, 0.05);
    if (amount <= 0.05) {
      const s = this.skid;
      s.gain.gain.setTargetAtTime(0.0001, this.t, 0.05);
      setTimeout(() => s.src.stop(), 300);
      this.skid = null;
    }
  }

  /** Byens baggrundslyd + publikum (crowd 0–1, fx tæt på fanzonen). */
  setAmbience(on: boolean, crowd = 0) {
    if (!this.ctx) return;
    if (on && !this.ambience) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(this.master);
      const mk = (type: BiquadFilterType, f: number, q: number, v: number, dest: AudioNode) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const fl = ctx.createBiquadFilter();
        fl.type = type;
        fl.frequency.value = f;
        fl.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = v;
        src.connect(fl).connect(g).connect(dest);
        src.start();
        return fl;
      };
      mk('lowpass', 260, 0.5, 0.35, gain); // fjern trafik
      const crowdG = ctx.createGain();
      crowdG.gain.value = 0.0001;
      crowdG.connect(gain);
      const crowdFilter = mk('bandpass', 800, 0.7, 0.5, crowdG);
      mk('bandpass', 1900, 1.2, 0.2, crowdG);
      this.ambience = { gain, crowd: crowdG, crowdFilter };
    }
    if (!this.ambience) return;
    this.ambience.gain.gain.setTargetAtTime(on ? 0.12 : 0.0001, this.t, 0.4);
    this.ambience.crowd.gain.setTargetAtTime(0.05 + crowd * 1.2, this.t, 0.5);
    this.ambience.crowdFilter.frequency.setTargetAtTime(700 + Math.sin(this.t * 0.7) * 150, this.t, 0.3);
  }

  /** Stortromme-rytme (menu og sidste minut). bpm 0 = stop. */
  setDrums(bpm: number) {
    if (!this.ctx) return;
    this.drumBpm = bpm;
    if (bpm > 0 && this.drumTimer === null) {
      this.nextBeat = this.t + 0.05;
      this.beatIdx = 0;
      this.drumTimer = window.setInterval(() => this.scheduleDrums(), 50);
    } else if (bpm <= 0 && this.drumTimer !== null) {
      clearInterval(this.drumTimer);
      this.drumTimer = null;
    }
  }

  private scheduleDrums() {
    if (!this.ctx || this.drumBpm <= 0) return;
    const spb = 60 / this.drumBpm;
    // Mønster: BUM . BUM . BUM BUM BUM . (klassisk tribune-rytme) + klap
    const pattern = [1, 0, 1, 0, 1, 1, 1, 0];
    while (this.nextBeat < this.t + 0.15) {
      const i = this.beatIdx % pattern.length;
      const delay = Math.max(0, this.nextBeat - this.t);
      if (pattern[i]) {
        this.tone(95, 0.3, 0.32, 'sine', 48, 0.004, delay);
        this.noise(0.06, 0.12, 'lowpass', 900, 1, undefined, delay);
      } else this.noise(0.05, 0.1, 'bandpass', 1800, 1.5, undefined, delay);
      this.nextBeat += spb / 2;
      this.beatIdx++;
    }
  }
}

export const audio = new AudioEngine();
