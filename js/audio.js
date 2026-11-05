// Tiny procedural sound engine - no external assets needed.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.oceanGain = null;
    this.windGain = null;
    this.ready = false;
    this.muted = false;
  }

  init() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    const master = this.master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    const noiseBuffer = this.makeNoise(3.2);
    // Ocean rumble
    const ocean = ctx.createBufferSource();
    ocean.buffer = noiseBuffer;
    ocean.loop = true;
    const oceanFilter = ctx.createBiquadFilter();
    oceanFilter.type = 'lowpass';
    oceanFilter.frequency.value = 420;
    oceanFilter.Q.value = 0.7;
    const oceanGain = this.oceanGain = ctx.createGain();
    oceanGain.gain.value = 0.16;
    ocean.connect(oceanFilter).connect(oceanGain).connect(master);
    ocean.start();
    // Slow swell
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.07;
    lfo.connect(lfoGain).connect(oceanGain.gain);
    lfo.start();

    // Wind
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    wind.playbackRate.value = 0.7;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    const windGain = this.windGain = ctx.createGain();
    windGain.gain.value = 0.0;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  setStorm(value) {
    if (!this.ready) return;
    const g = this.windGain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.linearRampToValueAtTime(0.02 + value * 0.3, this.ctx.currentTime + 1.2);
    const o = this.oceanGain.gain;
    o.cancelScheduledValues(this.ctx.currentTime);
    o.linearRampToValueAtTime(0.14 + value * 0.1, this.ctx.currentTime + 1.5);
  }

  setMuted(value) {
    this.muted = value;
    if (!this.ready) return;
    this.master.gain.linearRampToValueAtTime(value ? 0 : 0.7, this.ctx.currentTime + 0.2);
  }

  tone(freq, dur = 0.15, type = 'sine', gain = 0.12, slide = 0) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  noiseBurst(dur = 0.2, gain = 0.14, filterFreq = 900, type = 'lowpass') {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoise(Math.max(0.12, dur));
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  click() { this.tone(620, 0.06, 'triangle', 0.05, 180); }
  pickup() { this.tone(660, 0.09, 'sine', 0.09, 260); setTimeout(() => this.tone(990, 0.1, 'sine', 0.07, 140), 60); }
  craft() { this.tone(440, 0.12, 'triangle', 0.1, 220); setTimeout(() => this.tone(660, 0.18, 'triangle', 0.1, 180), 100); }
  chop() { this.noiseBurst(0.16, 0.2, 620); this.tone(160, 0.08, 'square', 0.05, -60); }
  mine() { this.noiseBurst(0.13, 0.18, 1500, 'bandpass'); this.tone(110, 0.07, 'square', 0.06, -40); }
  hit() { this.noiseBurst(0.18, 0.24, 420); this.tone(90, 0.14, 'sawtooth', 0.08, -40); }
  hurt() { this.tone(200, 0.25, 'sawtooth', 0.14, -120); this.noiseBurst(0.2, 0.12, 700); }
  splash() { this.noiseBurst(0.34, 0.14, 1900, 'highpass'); }
  bite() { this.tone(320, 0.12, 'square', 0.09, 240); setTimeout(() => this.tone(520, 0.12, 'square', 0.08, 160), 90); }
  eat() { this.noiseBurst(0.12, 0.1, 600); this.tone(240, 0.09, 'triangle', 0.06, -40); }
  drink() { this.tone(380, 0.16, 'sine', 0.07, 120); setTimeout(() => this.tone(300, 0.14, 'sine', 0.05, 80), 110); }
  thunder() {
    this.noiseBurst(1.4, 0.42, 240, 'lowpass');
    this.tone(55, 1.2, 'sine', 0.16, -20);
  }
  victory() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.5, 'triangle', 0.12, 40), i * 150));
  }
  lose() {
    [330, 262, 196, 147].forEach((n, i) => setTimeout(() => this.tone(n, 0.5, 'sine', 0.1, -20), i * 190));
  }
}
