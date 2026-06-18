// NES NTSC 2A03 AudioWorklet Processor
const CPU = 1789773;

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

// Two-sine drift LFO: combines a primary and a slow secondary so the
// pitch contour never feels metronomic.
function driftMult(depth, phase, phase2) {
  if (depth === 0) return 1;
  const cents = depth * (0.65 * Math.sin(2 * Math.PI * phase) +
                         0.35 * Math.sin(2 * Math.PI * phase2));
  return Math.pow(2, cents / 1200);
}

class NESProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sr = sampleRate;

    this.pulse1   = { on: true, freq: 146.83, duty: 0.25, vol: 12, phase: 0, detuneCents: 0 };
    this.pulse2   = { on: true, freq: 220.245, duty: 0.25, vol: 9,  phase: 0, detuneCents: 7 };
    this.triangle = { on: true, freq: 73.415, phase: 0 };

    // Global vibrato
    this.vibratoDepth = 0;
    this.vibratoRate  = 5;
    this.vibratoPhase = 0;

    // Per-channel slow drift (pitch wander, tanpura-like)
    // Each channel has its own phase + a slower secondary phase, staggered.
    // Offsets in [0,1) so they breathe at different points in the cycle.
    this.drift = {
      depth: 8,    // cents peak
      rate:  0.13, // Hz primary
      rate2: 0.07, // Hz secondary (creates aperiodic feel)
      // per-channel phases — staggered by 1/3 cycle
      tri:  { ph: 0,      ph2: 0      },
      p1:   { ph: 0.333,  ph2: 0.2   },
      p2:   { ph: 0.667,  ph2: 0.55  },
    };

    // Per-channel amplitude swell (pulse channels only, steps through 4-bit vol)
    // Triangle has no volume control so swell is pitch-only for it.
    this.swell = {
      depth: 0.45, // fraction of vol range to dip (0=none, 1=silence→full)
      rate:  0.18, // Hz primary
      rate2: 0.09, // Hz secondary
      tri:  { ph: 0,      ph2: 0.1   },
      p1:   { ph: 0.25,   ph2: 0.6   },
      p2:   { ph: 0.6,    ph2: 0.85  },
    };

    this.masterVolume = 0.8;
    this._dcX1 = 0; this._dcY1 = 0;
    this._lpY  = 0;

    // lpAlpha is constant per sample rate — precompute
    this._lpAlpha = 1 - Math.exp(-2 * Math.PI * 14000 / this._sr);

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(data) {
    if (data.type !== 'params') return;
    const p = data.params;

    if (p.masterVolume !== undefined) this.masterVolume = p.masterVolume;
    if (p.vibratoDepth !== undefined) this.vibratoDepth = p.vibratoDepth;
    if (p.vibratoRate  !== undefined) this.vibratoRate  = p.vibratoRate;

    if (p.drift) {
      if (p.drift.depth !== undefined) this.drift.depth = p.drift.depth;
      if (p.drift.rate  !== undefined) this.drift.rate  = p.drift.rate;
      // secondary always at ~55% of primary for organic feel
      this.drift.rate2 = this.drift.rate * 0.55;
    }
    if (p.swell) {
      if (p.swell.depth !== undefined) this.swell.depth = p.swell.depth;
      if (p.swell.rate  !== undefined) this.swell.rate  = p.swell.rate;
      this.swell.rate2 = this.swell.rate * 0.5;
    }

    const ch = (src, dst) => {
      if (!src) return;
      if (src.on    !== undefined) dst.on    = src.on;
      if (src.freq  !== undefined) dst.freq  = src.freq;
      if (src.duty  !== undefined) dst.duty  = src.duty;
      if (src.vol   !== undefined) dst.vol   = src.vol;
      if (src.detuneCents !== undefined) dst.detuneCents = src.detuneCents;
    };
    ch(p.pulse1,   this.pulse1);
    ch(p.pulse2,   this.pulse2);
    ch(p.triangle, this.triangle);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const n  = out.length;
    const sr = this._sr;

    const dr = this.drift;
    const sw = this.swell;

    for (let i = 0; i < n; i++) {
      // ── Advance all slow LFO phases ──────────────────────
      dr.tri.ph  = (dr.tri.ph  + dr.rate  / sr) % 1;
      dr.tri.ph2 = (dr.tri.ph2 + dr.rate2 / sr) % 1;
      dr.p1.ph   = (dr.p1.ph   + dr.rate  / sr) % 1;
      dr.p1.ph2  = (dr.p1.ph2  + dr.rate2 / sr) % 1;
      dr.p2.ph   = (dr.p2.ph   + dr.rate  / sr) % 1;
      dr.p2.ph2  = (dr.p2.ph2  + dr.rate2 / sr) % 1;

      sw.tri.ph  = (sw.tri.ph  + sw.rate  / sr) % 1;
      sw.tri.ph2 = (sw.tri.ph2 + sw.rate2 / sr) % 1;
      sw.p1.ph   = (sw.p1.ph   + sw.rate  / sr) % 1;
      sw.p1.ph2  = (sw.p1.ph2  + sw.rate2 / sr) % 1;
      sw.p2.ph   = (sw.p2.ph   + sw.rate  / sr) % 1;
      sw.p2.ph2  = (sw.p2.ph2  + sw.rate2 / sr) % 1;

      // ── Global vibrato ────────────────────────────────────
      const vibMult = this.vibratoDepth > 0
        ? Math.pow(2, (this.vibratoDepth / 1200) * Math.sin(2 * Math.PI * this.vibratoPhase))
        : 1;
      this.vibratoPhase = (this.vibratoPhase + this.vibratoRate / sr) % 1;

      // ── Amplitude swell helper (returns 0–1 multiplier) ──
      // Swell signal goes 0→1→0 slowly; depth controls how far it dips.
      // s = 0.5 + 0.5*sin → range [0,1]; then scale by depth.
      // effectiveMult = 1 - depth*(1 - s)  → at s=0 dips to (1-depth), at s=1 stays at 1
      const swellMult = (ph, ph2) => {
        if (sw.depth === 0) return 1;
        const s = 0.5 + 0.5 * (0.65 * Math.sin(2 * Math.PI * ph) +
                                0.35 * Math.sin(2 * Math.PI * ph2));
        return 1 - sw.depth * (1 - Math.max(0, s));
      };

      // ── Triangle ──────────────────────────────────────────
      let triOut = 0;
      {
        const ch = this.triangle;
        const f  = ch.freq * vibMult * driftMult(dr.depth, dr.tri.ph, dr.tri.ph2);
        const t  = Math.max(0, Math.min(2047, freqToTriPeriod(f)));
        if (ch.on && t >= 2) {
          const actualF = triActualFreq(t);
          ch.phase = (ch.phase + actualF / sr) % 1;
          triOut = TRIANGLE_STEPS[Math.floor(ch.phase * 32)];
        }
      }

      // ── Pulse 1 ───────────────────────────────────────────
      let p1out = 0;
      {
        const ch   = this.pulse1;
        const detM = Math.pow(2, ch.detuneCents / 1200);
        const f    = ch.freq * vibMult * detM * driftMult(dr.depth, dr.p1.ph, dr.p1.ph2);
        const t    = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          const actualF = pulseActualFreq(t);
          ch.phase = (ch.phase + actualF / sr) % 1;
          // 4-bit volume stepped by swell
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(sw.p1.ph, sw.p1.ph2))));
          p1out = (ch.phase < ch.duty) ? vol : 0;
        }
      }

      // ── Pulse 2 ───────────────────────────────────────────
      let p2out = 0;
      {
        const ch   = this.pulse2;
        const detM = Math.pow(2, ch.detuneCents / 1200);
        const f    = ch.freq * vibMult * detM * driftMult(dr.depth, dr.p2.ph, dr.p2.ph2);
        const t    = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        if (ch.on && t >= 8) {
          const actualF = pulseActualFreq(t);
          ch.phase = (ch.phase + actualF / sr) % 1;
          const vol = Math.max(0, Math.min(15, Math.round(ch.vol * swellMult(sw.p2.ph, sw.p2.ph2))));
          p2out = (ch.phase < ch.duty) ? vol : 0;
        }
      }

      // ── NES nonlinear mixer ───────────────────────────────
      const psum = p1out + p2out;
      const pulseLinear = psum > 0 ? 95.88 / ((8128 / psum) + 100) : 0;
      const tndLinear   = triOut > 0 ? 159.79 / ((1 / (triOut / 8227)) + 100) : 0;
      let sample = (pulseLinear + tndLinear) * this.masterVolume;

      // ── DC block ──────────────────────────────────────────
      const dcY = sample - this._dcX1 + 0.999 * this._dcY1;
      this._dcX1 = sample;
      this._dcY1 = dcY;
      sample = dcY;

      // ── Low-pass ~14 kHz ──────────────────────────────────
      this._lpY += this._lpAlpha * (sample - this._lpY);

      out[i] = this._lpY;
    }
    return true;
  }
}

registerProcessor('nes-processor', NESProcessor);
