// NES NTSC 2A03 AudioWorklet Processor
// Generates NES-accurate pulse and triangle tones via exact 2A03 period formulas.
// Drift, swell, and smooth vibrato are WebAudio simulation enhancements —
// on real hardware these would be stepped at the 60 Hz CPU frame rate.

const CPU = 1789773; // NTSC 2A03 clock, Hz

// 32-step triangle: 15,14,…,1,0,0,1,…,14,15
const TRIANGLE_STEPS = (() => {
  const s = [];
  for (let i = 15; i >= 0; i--) s.push(i);
  for (let i = 0; i <= 15; i++) s.push(i);
  return s; // 32 values, indices 0–31
})();

function freqToPulsePeriod(f) { return Math.round(CPU / (16 * f) - 1); }
function freqToTriPeriod(f)   { return Math.round(CPU / (32 * f) - 1); }
function pulseActualFreq(t)   { return CPU / (16 * (t + 1)); }
function triActualFreq(t)     { return CPU / (32 * (t + 1)); }

// Multi-partial oscillator for organic pitch drift.
// Three partials at different sub-rates create an aperiodic contour.
// Returns value in [-1, +1].
function driftOsc(ph, ph2, ph3) {
  return 0.55 * Math.sin(6.2832 * ph)
       + 0.30 * Math.sin(6.2832 * ph2)
       + 0.15 * Math.sin(6.2832 * ph3);
}

// Swell oscillator — same shape but with fixed phase offsets so swell peaks
// and pitch peaks do not coincide (more like a resonating string).
function swellOsc(ph, ph2, ph3) {
  return 0.55 * Math.sin(6.2832 * ph  + 1.5708)  // +π/2
       + 0.30 * Math.sin(6.2832 * ph2 + 2.1991)  // +0.7π
       + 0.15 * Math.sin(6.2832 * ph3 + 3.4558); // +1.1π
}

class NESProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this._sr      = sr;
    this._lpAlpha = 1 - Math.exp(-6.2832 * 14000 / sr); // 14 kHz LP, precomputed

    // Channel state
    this.pulse1   = { on: true, freq: 146.83,  duty: 0.25, vol: 12, phase: 0, detuneCents: 0 };
    this.pulse2   = { on: true, freq: 220.245, duty: 0.25, vol: 9,  phase: 0, detuneCents: 7 };
    this.triangle = { on: true, freq: 73.415,  phase: 0 };

    // Global vibrato
    this.vibratoDepth = 0;
    this.vibratoRate  = 5;
    this.vibratoPhase = 0;

    // Pitch drift LFO
    // Per-channel rate multipliers so channels slowly drift in/out of phase
    // (beat period tri↔p1 ~110s, p1↔p2 ~55s at default 0.13 Hz)
    this.driftDepth = 8;   // cents peak
    this.driftRate  = 0.13; // Hz primary
    this._driftMult = [1.0, 0.93, 1.07]; // tri, p1, p2
    // Phases: [primary, secondary(×0.55), tertiary(×0.37)] per channel
    this._dph = [[0, 0.41, 0.83], [0.33, 0.74, 0.17], [0.67, 0.08, 0.52]];
    this._dRates = [0, 0, 0]; // cached per-sample increments

    // Amplitude swell
    this.swellDepth = 0.45;
    this.swellRate  = 0.18;
    this._swellMult = [1.0, 0.89, 1.11];
    this._sph = [[0.25, 0.60, 0.92], [0.58, 0.93, 0.27], [0.83, 0.18, 0.54]];
    this._sRates = [0, 0, 0];

    this._ratesDirty = true; // recompute cached rates on first block

    // DC-block state
    this._dcX1 = 0;
    this._dcY1 = 0;
    this._lpY  = 0;

    this.port.onmessage = (e) => this._recv(e.data);
  }

  _recomputeRates() {
    const sr = this._sr;
    const DR2 = 0.55, DR3 = 0.37;
    const SR2 = 0.51, SR3 = 0.34;
    for (let c = 0; c < 3; c++) {
      const dr = this.driftRate * this._driftMult[c] / sr;
      this._dRates[c] = dr; // primary rate (per sample)
      // secondary and tertiary are stored as separate elements below
      // but we advance them inline as dr*DR2 and dr*DR3 — no need to store separately
      const sr_ = this.swellRate * this._swellMult[c] / sr;
      this._sRates[c] = sr_;
    }
    this._DR2 = DR2; this._DR3 = DR3;
    this._SR2 = SR2; this._SR3 = SR3;
    this._ratesDirty = false;
  }

  _recv(data) {
    if (data.type !== 'params') return;
    const p = data.params;

    if (p.masterVolume !== undefined) this.masterVolume = p.masterVolume;
    if (p.vibratoDepth !== undefined) this.vibratoDepth = p.vibratoDepth;
    if (p.vibratoRate  !== undefined) this.vibratoRate  = p.vibratoRate;

    if (p.drift) {
      if (p.drift.depth !== undefined) this.driftDepth = p.drift.depth;
      if (p.drift.rate  !== undefined) { this.driftRate = p.drift.rate; this._ratesDirty = true; }
    }
    if (p.swell) {
      if (p.swell.depth !== undefined) this.swellDepth = p.swell.depth;
      if (p.swell.rate  !== undefined) { this.swellRate = p.swell.rate; this._ratesDirty = true; }
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

    if (this._ratesDirty) this._recomputeRates();

    const sr   = this._sr;
    const dph  = this._dph;
    const sph  = this._sph;
    const dR   = this._dRates;
    const sR   = this._sRates;
    const DR2  = this._DR2, DR3 = this._DR3;
    const SR2  = this._SR2, SR3 = this._SR3;

    for (let i = 0, n = out.length; i < n; i++) {

      // ── Advance LFO phases (no allocation — mutate in place) ──
      for (let c = 0; c < 3; c++) {
        dph[c][0] = (dph[c][0] + dR[c])        % 1;
        dph[c][1] = (dph[c][1] + dR[c] * DR2)  % 1;
        dph[c][2] = (dph[c][2] + dR[c] * DR3)  % 1;
        sph[c][0] = (sph[c][0] + sR[c])        % 1;
        sph[c][1] = (sph[c][1] + sR[c] * SR2)  % 1;
        sph[c][2] = (sph[c][2] + sR[c] * SR3)  % 1;
      }

      // ── Pitch drift multipliers ────────────────────────────────
      const ddepth = this.driftDepth;
      const pitchMult = (c) => ddepth > 0
        ? Math.pow(2, ddepth * driftOsc(dph[c][0], dph[c][1], dph[c][2]) / 1200)
        : 1;

      // ── Amplitude swell (returns fraction 0–1) ─────────────────
      const sdepth = this.swellDepth;
      const swellMult = (c) => {
        if (sdepth === 0) return 1;
        // swellOsc ∈ [-1,+1]; map to [0,1]; apply depth
        const s = (swellOsc(sph[c][0], sph[c][1], sph[c][2]) + 1) * 0.5;
        return 1 - sdepth * (1 - s); // range: [1-sdepth, 1]
      };

      // ── Global vibrato ─────────────────────────────────────────
      const vibMult = this.vibratoDepth > 0
        ? Math.pow(2, this.vibratoDepth / 1200 * Math.sin(6.2832 * this.vibratoPhase))
        : 1;
      this.vibratoPhase = (this.vibratoPhase + this.vibratoRate / sr) % 1;

      // ── Triangle (channel 0) ───────────────────────────────────
      let triOut = 0;
      {
        const ch = this.triangle;
        const f  = ch.freq * vibMult * pitchMult(0);
        const t  = Math.max(0, Math.min(2047, freqToTriPeriod(f)));
        if (ch.on && t >= 2) {
          ch.phase = (ch.phase + triActualFreq(t) / sr) % 1;
          triOut   = TRIANGLE_STEPS[Math.floor(ch.phase * 32)]; // index 0–31 guaranteed
        }
      }

      // ── Pulse 1 (channel 1) ────────────────────────────────────
      let p1out = 0;
      {
        const ch  = this.pulse1;
        const f   = ch.freq * vibMult * pitchMult(1) * Math.pow(2, ch.detuneCents / 1200);
        const t   = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          ch.phase  = (ch.phase + pulseActualFreq(t) / sr) % 1;
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(1))));
          p1out = ch.phase < ch.duty ? vol : 0;
        }
      }

      // ── Pulse 2 (channel 2) ────────────────────────────────────
      let p2out = 0;
      {
        const ch  = this.pulse2;
        const f   = ch.freq * vibMult * pitchMult(2) * Math.pow(2, ch.detuneCents / 1200);
        const t   = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          ch.phase  = (ch.phase + pulseActualFreq(t) / sr) % 1;
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(2))));
          p2out = ch.phase < ch.duty ? vol : 0;
        }
      }

      // ── NES nonlinear mixer (documented approximation) ─────────
      const psum        = p1out + p2out;
      const pulseLinear = psum   > 0 ? 95.88  / (8128  / psum        + 100) : 0;
      const tndLinear   = triOut > 0 ? 159.79 / (8227  / triOut      + 100) : 0;
      let   sample      = (pulseLinear + tndLinear) * this.masterVolume;

      // ── DC block (high-pass ~7 Hz) ─────────────────────────────
      const dcY = sample - this._dcX1 + 0.999 * this._dcY1;
      this._dcX1 = sample;
      this._dcY1 = dcY;
      sample = dcY;

      // ── Output low-pass ~14 kHz ────────────────────────────────
      this._lpY += this._lpAlpha * (sample - this._lpY);
      out[i] = this._lpY;
    }
    return true;
  }
}

registerProcessor('nes-processor', NESProcessor);
