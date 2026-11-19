// All sounds are synthesized, so there are no audio files to load.
export class Sound {
  constructor() { this.ctx = null; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // Ocean ambience: two slowly breathing layers of filtered noise, plus wind that rises with speed
    const mk = (type, f, g) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
      const gn = ctx.createGain(); gn.gain.value = g;
      src.connect(fl); fl.connect(gn); gn.connect(this.master); src.start(0, Math.random() * 2);
      return gn;
    };
    this.waveA = mk('lowpass', 380, 0.12); this.waveB = mk('lowpass', 900, 0.04);
    this.wind = mk('bandpass', 1400, 0.0);
  }

  get ok() { return !!this.ctx; }

  setListener(pos, fwd, up, t, speed) {
    if (!this.ctx) return;
    const L = this.ctx.listener, now = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, now, 0.02); L.positionY.setTargetAtTime(pos.y, now, 0.02); L.positionZ.setTargetAtTime(pos.z, now, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, now, 0.02); L.forwardY.setTargetAtTime(fwd.y, now, 0.02); L.forwardZ.setTargetAtTime(fwd.z, now, 0.02);
      L.upX.setTargetAtTime(up.x, now, 0.02); L.upY.setTargetAtTime(up.y, now, 0.02); L.upZ.setTargetAtTime(up.z, now, 0.02);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    this.waveA.gain.setTargetAtTime(0.1 + 0.05 * Math.sin(t * 0.7), now, 0.3);
    this.waveB.gain.setTargetAtTime(0.03 + 0.025 * Math.sin(t * 1.1 + 1), now, 0.3);
    this.wind.gain.setTargetAtTime(0.008 + speed * 0.006, now, 0.5);
  }

  out(pos, vol = 1) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (pos) {
      const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = 4; p.maxDistance = 2000; p.rolloffFactor = 0.8;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noise(out, { type = 'lowpass', f = 1000, q = 0.7, peak = 1, a = 0.005, d = 0.5, f2 = null, t0 = 0 }) {
    const c = this.ctx, t = c.currentTime + t0;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(fl); fl.connect(g); g.connect(out); src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }

  tone(out, { type = 'sine', f = 440, f2 = null, peak = 0.5, a = 0.005, d = 0.3, t0 = 0 }) {
    const c = this.ctx, t = c.currentTime + t0;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + a + d + 0.05);
  }

  cannon(pos) {
    if (!this.ctx) return; const o = this.out(pos, 1.6);
    this.noise(o, { f: 1400, f2: 120, peak: 1, a: 0.004, d: 1.8 });
    this.tone(o, { f: 85, f2: 28, peak: 0.9, a: 0.004, d: 0.9 });
    this.noise(o, { type: 'bandpass', f: 3000, q: 0.6, peak: 0.5, a: 0.001, d: 0.18 });
  }
  musket(pos) {
    if (!this.ctx) return; const o = this.out(pos, 1);
    this.noise(o, { type: 'highpass', f: 900, peak: 0.9, a: 0.001, d: 0.28 });
    this.noise(o, { f: 900, f2: 100, peak: 0.6, a: 0.002, d: 0.45 });
  }
  splash(pos, big = 1) {
    if (!this.ctx) return; const o = this.out(pos, big);
    this.noise(o, { type: 'bandpass', f: 700, f2: 250, q: 0.8, peak: 0.8, a: 0.01, d: 0.8 });
    this.noise(o, { type: 'highpass', f: 2500, peak: 0.25, a: 0.02, d: 0.6, t0: 0.05 });
  }
  woodHit(pos) {
    if (!this.ctx) return; const o = this.out(pos, 1.4);
    this.noise(o, { f: 700, f2: 90, peak: 1, a: 0.002, d: 0.6 });
    this.tone(o, { type: 'triangle', f: 140, f2: 60, peak: 0.6, a: 0.002, d: 0.25 });
    this.noise(o, { type: 'bandpass', f: 1800, q: 2, peak: 0.4, a: 0.001, d: 0.12, t0: 0.03 });
  }
  clang(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.7);
    this.tone(o, { type: 'square', f: 1250, peak: 0.25, a: 0.001, d: 0.35 });
    this.tone(o, { type: 'triangle', f: 1870, peak: 0.25, a: 0.001, d: 0.5 });
    this.noise(o, { type: 'highpass', f: 3000, peak: 0.4, a: 0.001, d: 0.08 });
  }
  thud(pos) {
    if (!this.ctx) return; const o = this.out(pos, 1);
    this.tone(o, { f: 160, f2: 70, peak: 0.7, a: 0.002, d: 0.18 });
    this.noise(o, { f: 600, peak: 0.5, a: 0.002, d: 0.15 });
  }
  swoosh(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.5);
    this.noise(o, { type: 'bandpass', f: 500, f2: 2200, q: 1.5, peak: 0.5, a: 0.06, d: 0.18 });
  }
  fuse(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.5);
    this.noise(o, { type: 'highpass', f: 4000, peak: 0.4, a: 0.02, d: 0.35 });
  }
  click(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.5);
    this.tone(o, { type: 'square', f: 2200, peak: 0.15, a: 0.001, d: 0.03 });
    this.tone(o, { type: 'square', f: 1600, peak: 0.12, a: 0.001, d: 0.04, t0: 0.07 });
  }
  hurt() {
    if (!this.ctx) return; const o = this.out(null, 0.6);
    this.tone(o, { type: 'sawtooth', f: 180, f2: 90, peak: 0.25, a: 0.01, d: 0.25 });
    this.noise(o, { f: 500, peak: 0.4, a: 0.005, d: 0.2 });
  }
  bell() {
    if (!this.ctx) return; const o = this.out(null, 0.35);
    for (const [f, t0] of [[880, 0], [880, 0.35]]) { this.tone(o, { type: 'sine', f, peak: 0.5, a: 0.002, d: 1.2, t0 }); this.tone(o, { type: 'sine', f: f * 2.76, peak: 0.12, a: 0.002, d: 0.5, t0 }); }
  }
  cheer() {
    if (!this.ctx) return; const o = this.out(null, 0.4);
    for (let i = 0; i < 4; i++) this.noise(o, { type: 'bandpass', f: 600 + i * 150, f2: 900 + i * 120, q: 4, peak: 0.3, a: 0.08, d: 0.6, t0: i * 0.07 });
  }
  creak(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.25);
    this.tone(o, { type: 'sawtooth', f: 95 + Math.random() * 40, f2: 70, peak: 0.12, a: 0.15, d: 0.6 });
  }
}
