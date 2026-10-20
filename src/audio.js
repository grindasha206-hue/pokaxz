// Звук без файлов: синтез через Web Audio. Шорох, сдача, покупка, спокойный фон.
// Громкость общая, эффектов и фона настраивается отдельно.

export class Sound {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, effects: 0.9, ambient: 0.5 };
  }

  /** Создаётся по первому действию игрока (требование Safari). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.effects = ctx.createGain();
    this.ambient = ctx.createGain();
    this.effects.connect(this.master);
    this.ambient.connect(this.master);
    this.master.connect(ctx.destination);
    this.noise = this.makeNoise(2, 'white');
    this.brown = this.makeNoise(6, 'brown');
    this.applyVolumes();
    this.startAmbient();
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.effects.gain.setTargetAtTime(this.vol.effects, t, 0.05);
    this.ambient.gain.setTargetAtTime(this.vol.ambient * 0.5, t, 0.05);
  }

  /** Пауза приглушает фон и не даёт звукам копиться. */
  setPaused(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend?.(); else this.ctx.resume?.();
  }

  makeNoise(seconds, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  burst({ dur = 0.25, freq = 3000, q = 0.8, gain = 0.4, type = 'bandpass', attack = 0.01, sweep = 0, out = this.effects, when = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, freq + sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone(freq, { dur = 0.3, gain = 0.2, type = 'sine', when = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq + slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.effects);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Шорох листьев в мешке; громче, если листьев больше. */
  rustle(n = 1) {
    const k = Math.min(1, 0.45 + n * 0.08);
    this.burst({ dur: 0.16 + 0.03 * Math.min(n, 6), freq: 2600 + Math.random() * 1500, q: 0.7, gain: 0.32 * k });
    this.burst({ dur: 0.12, freq: 5200, q: 1.2, gain: 0.12 * k, when: 0.04, type: 'highpass' });
    if (n > 2) this.burst({ dur: 0.22, freq: 1800, q: 0.6, gain: 0.18 * k, when: 0.08 });
  }

  /** Тихий шорох под ногами. */
  step() {
    this.burst({ dur: 0.1, freq: 3200 + Math.random() * 1200, q: 0.9, gain: 0.07 });
  }

  deposit(n) {
    this.burst({ dur: 0.55, freq: 2200, q: 0.5, gain: 0.35, sweep: -1400 });
    this.tone(95, { dur: 0.22, gain: 0.25, slide: -40, when: 0.08 });
    if (n > 0) {
      this.tone(1318, { dur: 0.35, gain: 0.08, when: 0.25, type: 'triangle' });
      this.tone(1760, { dur: 0.45, gain: 0.07, when: 0.33, type: 'triangle' });
    }
  }

  purchase() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, { dur: 0.4, gain: 0.09, when: i * 0.07, type: 'triangle' }));
  }

  denied() {
    this.tone(220, { dur: 0.14, gain: 0.08, type: 'triangle', slide: -40 });
  }

  startAmbient() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brown; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.55;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 0.25;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(this.ambient);
    src.start(); lfo.start();
    const birds = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') this.chirp();
      setTimeout(birds, 4000 + Math.random() * 9000);
    };
    setTimeout(birds, 3000);
    const gust = () => {
      if (this.ctx.state === 'running') this.burst({ dur: 1.6, freq: 1400, q: 0.4, gain: 0.05, attack: 0.6, out: this.ambient, sweep: 600 });
      setTimeout(gust, 7000 + Math.random() * 12000);
    };
    setTimeout(gust, 5000);
  }

  chirp() {
    const ctx = this.ctx, base = 2600 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * 0.13;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g).connect(this.ambient);
      o.start(t); o.stop(t + 0.13);
    }
  }
}
