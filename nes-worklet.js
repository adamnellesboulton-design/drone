// NES NTSC 2A03 AudioWorklet Processor
const CPU = 1789773;

// 32-step triangle: 15,14,...,0,0,...,14,15
const TRIANGLE_STEPS = (() => {
  const s = [];
  for (let i = 15; i >= 0; i--) s.push(i);
  for (let i = 0; i <= 15; i++) s.push(i);
  return s;
})();

function freqToPulsePeriod(f) { return Math.round(CPU / (16 * f) - 1); }
function freqToTriPeriod(f)   { return Math.round(CPU / (32 * f) - 1); }
function pulseActualFreq(t)   { return CPU / (16 * (t + 1)); }
function triActualFreq(t)     { return CPU / (32 * (t + 1)); }

// Asymmetric multi-harmonic drift oscillator.
// Combines 3 partials at slightly offset sub-rates so the shape is never
// perfectly periodic — feels like a resonating string, not an LFO.
// Returns value in [-1, +1].
function driftOsc(ph, ph2, ph3) {
  return (
    0.55 * Math.sin(2 * Math.PI * ph)  +   // fundamental
    0.30 * Math.sin(2 * Math.PI * ph2) +   // secondary (≈55% rate)
    0.15 * Math.sin(2 * Math.PI * ph3)     // tertiary  (≈37% rate)
  );
}

// Same shape for amplitude swell, but offset π/2 so swell peaks ≠ pitch peaks.
function swellOsc(ph, ph2, ph3) {
  return (
    0.55 * Math.sin(2 * Math.PI * ph  + Math.PI * 0.5) +
    0.30 * Math.sin(2 * Math.PI * ph2 + Math.PI * 0.7) +
    0.15 * Math.sin(2 * Math.PI * ph3 + Math.PI * 1.1)
  );
}

class NESProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sr = sampleRate;
    this._lpAlpha = 1 - Math.exp(-2 * Math.PI * 14000 / sampleRate);

    this.pulse1   = { on: true, freq: 146.83,  duty: 0.25, vol: 12, phase: 0, detuneCents: 0 };
    this.pulse2   = { on: true, freq: 220.245, duty: 0.25, vol: 9,  phase: 0, detuneCents: 7 };
    this.triangle = { on: true, freq: 73.415,  phase: 0 };

    this.vibratoDepth = 0;
    this.vibratoRate  = 5;
    this.vibratoPhase = 0;

    // Drift: 3 independent LFO phases per channel.
    // Each channel has a slightly different primary rate multiplier so they
    // drift in and out of phase with each other over time (30–90 sec cycles).
    // Secondary/tertiary rates are shared ratios of primary.
    this.driftDepth = 8;
    this.driftRate  = 0.13;  // Hz, primary
    // Rate multipliers per channel — creates ever-shifting intersection patterns
    this._driftMult = [1.0, 0.93, 1.07]; // tri, p1, p2
    this._driftPh   = [[0, 0.41, 0.83], [0.33, 0.74, 0.17], [0.67, 0.08, 0.52]];

    // Swell: same 3-channel scheme
    this.swellDepth = 0.45;
    this.swellRate  = 0.18;
    this._swellMult = [1.0, 0.89, 1.11];
    this._swellPh   = [[0.25, 0.60, 0.92], [0.58, 0.93, 0.27], [0.83, 0.18, 0.54]];

    this.masterVolume = 0.8;
    this._dcX1 = 0;
    this._dcY1 = 0;
    this._lpY  = 0;

    this.port.onmessage = (e) => this._recv(e.data);
  }

  _recv(data) {
    if (data.type !== 'params') return;
    const p = data.params;
    if (p.masterVolume !== undefined) this.masterVolume = p.masterVolume;
    if (p.vibratoDepth !== undefined) this.vibratoDepth = p.vibratoDepth;
    if (p.vibratoRate  !== undefined) this.vibratoRate  = p.vibratoRate;
    if (p.drift) {
      if (p.drift.depth !== undefined) this.driftDepth = p.drift.depth;
      if (p.drift.rate  !== undefined) this.driftRate  = p.drift.rate;
    }
    if (p.swell) {
      if (p.swell.depth !== undefined) this.swellDepth = p.swell.depth;
      if (p.swell.rate  !== undefined) this.swellRate  = p.swell.rate;
    }
    const set = (src, dst) => {
      if (!src) return;
      if (src.on          !== undefined) dst.on          = src.on;
      if (src.freq        !== undefined) dst.freq        = src.freq;
      if (src.duty        !== undefined) dst.duty        = src.duty;
      if (src.vol         !== undefined) dst.vol         = src.vol;
      if (src.detuneCents !== undefined) dst.detuneCents = src.detuneCents;
    };
    set(p.pulse1,   this.pulse1);
    set(p.pulse2,   this.pulse2);
    set(p.triangle, this.triangle);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const n  = out.length;
    const sr = this._sr;

    // Precompute per-sample phase increments for drift/swell channels
    const dRates = this._driftMult.map(m => this.driftRate * m / sr);
    const sRates = this._swellMult.map(m => this.swellRate * m / sr);
    // Secondary/tertiary rate ratios
    const DR2 = 0.55, DR3 = 0.37;
    const SR2 = 0.51, SR3 = 0.34;

    const dph = this._driftPh;
    const sph = this._swellPh;

    for (let i = 0; i < n; i++) {
      // ── Advance all LFO phases ─────────────────────────
      for (let c = 0; c < 3; c++) {
        dph[c][0] = (dph[c][0] + dRates[c])           % 1;
        dph[c][1] = (dph[c][1] + dRates[c] * DR2)     % 1;
        dph[c][2] = (dph[c][2] + dRates[c] * DR3)     % 1;
        sph[c][0] = (sph[c][0] + sRates[c])           % 1;
        sph[c][1] = (sph[c][1] + sRates[c] * SR2)     % 1;
        sph[c][2] = (sph[c][2] + sRates[c] * SR3)     % 1;
      }

      // ── Drift multipliers (pitch) ──────────────────────
      const driftMult = (ci) => {
        if (this.driftDepth === 0) return 1;
        const v = driftOsc(dph[ci][0], dph[ci][1], dph[ci][2]);
        return Math.pow(2, (this.driftDepth * v) / 1200);
      };

      // ── Swell multiplier (amplitude 0–1) ───────────────
      const swellMult = (ci) => {
        if (this.swellDepth === 0) return 1;
        // swellOsc returns roughly -1 to +1; map to 0–1 range, then apply depth
        const raw = (swellOsc(sph[ci][0], sph[ci][1], sph[ci][2]) + 1) * 0.5;
        return 1 - this.swellDepth * (1 - raw);
      };

      // ── Global vibrato ─────────────────────────────────
      const vibMult = this.vibratoDepth > 0
        ? Math.pow(2, (this.vibratoDepth / 1200) * Math.sin(2 * Math.PI * this.vibratoPhase))
        : 1;
      this.vibratoPhase = (this.vibratoPhase + this.vibratoRate / sr) % 1;

      // ── Triangle (channel index 0) ─────────────────────
      let triOut = 0;
      {
        const ch = this.triangle;
        const f  = ch.freq * vibMult * driftMult(0);
        const t  = Math.max(0, Math.min(2047, freqToTriPeriod(f)));
        if (ch.on && t >= 2) {
          const af = triActualFreq(t);
          ch.phase = (ch.phase + af / sr) % 1;
          triOut   = TRIANGLE_STEPS[Math.floor(ch.phase * 32)];
        }
      }

      // ── Pulse 1 (channel index 1) ──────────────────────
      let p1out = 0;
      {
        const ch  = this.pulse1;
        const dm  = Math.pow(2, ch.detuneCents / 1200);
        const f   = ch.freq * vibMult * dm * driftMult(1);
        const t   = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          const af  = pulseActualFreq(t);
          ch.phase  = (ch.phase + af / sr) % 1;
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(1))));
          p1out = ch.phase < ch.duty ? vol : 0;
        }
      }

      // ── Pulse 2 (channel index 2) ──────────────────────
      let p2out = 0;
      {
        const ch  = this.pulse2;
        const dm  = Math.pow(2, ch.detuneCents / 1200);
        const f   = ch.freq * vibMult * dm * driftMult(2);
        const t   = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          const af  = pulseActualFreq(t);
          ch.phase  = (ch.phase + af / sr) % 1;
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(2))));
          p2out = ch.phase < ch.duty ? vol : 0;
        }
      }

      // ── NES nonlinear mixer ────────────────────────────
      const psum       = p1out + p2out;
      const pulseLinear = psum > 0 ? 95.88 / ((8128 / psum) + 100) : 0;
      const tndLinear   = triOut > 0 ? 159.79 / ((1 / (triOut / 8227)) + 100) : 0;
      let sample        = (pulseLinear + tndLinear) * this.masterVolume;

      // ── DC block (~10 Hz high-pass) ────────────────────
      const dcY = sample - this._dcX1 + 0.999 * this._dcY1;
      this._dcX1 = sample; this._dcY1 = dcY;
      sample = dcY;

      // ── Low-pass ~14 kHz ───────────────────────────────
      this._lpY += this._lpAlpha * (sample - this._lpY);

      out[i] = this._lpY;
    }
    return true;
  }
}

registerProcessor('nes-processor', NESProcessor);
