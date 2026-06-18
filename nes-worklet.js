// NES NTSC 2A03 AudioWorklet Processor
// CPU clock = 1789773 Hz (NTSC)

const CPU = 1789773;

// 32-step triangle waveform: 15,14,...,1,0,0,1,...,14,15
const TRIANGLE_STEPS = (() => {
  const s = [];
  for (let i = 15; i >= 0; i--) s.push(i);
  for (let i = 0; i <= 15; i++) s.push(i);
  return s;
})();

function freqToPulsePeriod(f) {
  return Math.round(CPU / (16 * f) - 1);
}
function freqToTriPeriod(f) {
  return Math.round(CPU / (32 * f) - 1);
}
function pulseActualFreq(t) {
  return CPU / (16 * (t + 1));
}
function triActualFreq(t) {
  return CPU / (32 * (t + 1));
}
function cents(actual, target) {
  return 1200 * Math.log2(actual / target);
}

class NESProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._sr = sampleRate;

    // Channel state
    this.pulse1 = { on: true, freq: 146.83, duty: 0.5, vol: 10, phase: 0, detuneCents: 0 };
    this.pulse2 = { on: true, freq: 220.245, duty: 0.25, vol: 8, phase: 0, detuneCents: 0 };
    this.triangle = { on: true, freq: 73.415, phase: 0 };

    // Vibrato
    this.vibratoDepth = 0;   // cents
    this.vibratoRate = 5;    // Hz
    this.vibratoPhase = 0;

    // Master volume
    this.masterVolume = 0.8;

    // DC-block state
    this._dcX1 = 0; this._dcY1 = 0;
    // LP state
    this._lpY = 0;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(data) {
    if (data.type === 'params') {
      const p = data.params;
      if (p.masterVolume !== undefined) this.masterVolume = p.masterVolume;
      if (p.vibratoDepth !== undefined) this.vibratoDepth = p.vibratoDepth;
      if (p.vibratoRate !== undefined) this.vibratoRate = p.vibratoRate;

      if (p.pulse1) {
        const ch = this.pulse1;
        if (p.pulse1.on !== undefined) ch.on = p.pulse1.on;
        if (p.pulse1.freq !== undefined) ch.freq = p.pulse1.freq;
        if (p.pulse1.duty !== undefined) ch.duty = p.pulse1.duty;
        if (p.pulse1.vol !== undefined) ch.vol = p.pulse1.vol;
        if (p.pulse1.detuneCents !== undefined) ch.detuneCents = p.pulse1.detuneCents;
      }
      if (p.pulse2) {
        const ch = this.pulse2;
        if (p.pulse2.on !== undefined) ch.on = p.pulse2.on;
        if (p.pulse2.freq !== undefined) ch.freq = p.pulse2.freq;
        if (p.pulse2.duty !== undefined) ch.duty = p.pulse2.duty;
        if (p.pulse2.vol !== undefined) ch.vol = p.pulse2.vol;
        if (p.pulse2.detuneCents !== undefined) ch.detuneCents = p.pulse2.detuneCents;
      }
      if (p.triangle) {
        const ch = this.triangle;
        if (p.triangle.on !== undefined) ch.on = p.triangle.on;
        if (p.triangle.freq !== undefined) ch.freq = p.triangle.freq;
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const sr = this._sr;

    for (let i = 0; i < n; i++) {
      // Vibrato LFO
      const vibratoMult = this.vibratoDepth > 0
        ? Math.pow(2, (this.vibratoDepth / 1200) * Math.sin(2 * Math.PI * this.vibratoPhase))
        : 1;
      this.vibratoPhase += this.vibratoRate / sr;
      if (this.vibratoPhase >= 1) this.vibratoPhase -= 1;

      // --- Pulse 1 ---
      let p1out = 0;
      {
        const ch = this.pulse1;
        const detMult = Math.pow(2, ch.detuneCents / 1200);
        const f = ch.freq * vibratoMult * detMult;
        const t = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        const muted = !ch.on || t < 8;
        if (!muted) {
          const actualF = pulseActualFreq(t);
          ch.phase += actualF / sr;
          if (ch.phase >= 1) ch.phase -= 1;
          p1out = (ch.phase < ch.duty) ? ch.vol : 0;
        }
      }

      // --- Pulse 2 ---
      let p2out = 0;
      {
        const ch = this.pulse2;
        const detMult = Math.pow(2, ch.detuneCents / 1200);
        const f = ch.freq * vibratoMult * detMult;
        const t = Math.max(0, Math.min(2047, freqToPulsePeriod(f)));
        const muted = !ch.on || t < 8;
        if (!muted) {
          const actualF = pulseActualFreq(t);
          ch.phase += actualF / sr;
          if (ch.phase >= 1) ch.phase -= 1;
          p2out = (ch.phase < ch.duty) ? ch.vol : 0;
        }
      }

      // --- Triangle ---
      let triOut = 0;
      {
        const ch = this.triangle;
        const f = ch.freq * vibratoMult;
        const t = Math.max(0, Math.min(2047, freqToTriPeriod(f)));
        const muted = !ch.on || t < 2;
        if (!muted) {
          const actualF = triActualFreq(t);
          ch.phase += actualF / sr;
          if (ch.phase >= 1) ch.phase -= 1;
          const step = Math.floor(ch.phase * 32);
          triOut = TRIANGLE_STEPS[step];
        }
      }

      // --- NES nonlinear mixer ---
      const psum = p1out + p2out;
      const pulseLinear = psum > 0 ? 95.88 / ((8128 / psum) + 100) : 0;
      const tndLinear = triOut > 0 ? 159.79 / ((1 / (triOut / 8227)) + 100) : 0;
      let sample = (pulseLinear + tndLinear) * this.masterVolume;

      // --- DC block (high-pass ~10 Hz) ---
      const dcCoeff = 0.999;
      const dcY = sample - this._dcX1 + dcCoeff * this._dcY1;
      this._dcX1 = sample;
      this._dcY1 = dcY;
      sample = dcY;

      // --- Low-pass ~14 kHz (one-pole IIR) ---
      const lpAlpha = 1 - Math.exp(-2 * Math.PI * 14000 / sr);
      this._lpY += lpAlpha * (sample - this._lpY);
      sample = this._lpY;

      out[i] = sample;
    }
    return true;
  }
}

registerProcessor('nes-processor', NESProcessor);
