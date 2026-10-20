/* McCluster Resonance Atlas v1: deterministic AUDIO -> IDEALIZED MEMBRANE model.
 * No genome measurement, medical inference, or genre-to-geometry truth claim.
 * Pure ESM shared by the browser and the offline backend, with no dependencies.
 */
export const MODEL_VERSION = "mcc-resonance-membrane-v1";
export const RESONATOR = Object.freeze({
  kind: "fixed-edge-square-membrane", lengthMeters: 1, waveSpeedMps: 110,
  dampingRatio: 0.085, excitation: [0.37, 0.43], maxMode: 5
});
export const limit = (n, low, high) => Math.min(high, Math.max(low, n));
const round = (n, places = 5) => Number(n.toFixed(places));

export function modes(cfg = RESONATOR) {
  const output = [];
  for (let m = 1; m <= cfg.maxMode; m++) for (let n = 1; n <= cfg.maxMode; n++) {
    // Fixed-boundary membrane, NOT the more complex bending modes of a metal Chladni plate.
    const hz = cfg.waveSpeedMps / (2 * cfg.lengthMeters) * Math.hypot(m, n);
    const coupling = Math.abs(Math.sin(Math.PI * m * cfg.excitation[0]) *
      Math.sin(Math.PI * n * cfg.excitation[1]));
    output.push({ m, n, hz: round(hz, 3), coupling: round(coupling) });
  }
  return output.sort((a, b) => a.hz - b.hz || a.m - b.m || a.n - b.n);
}

export function fftPower(samples, size = 2048) {
  if (!Number.isInteger(size) || size < 256 || size > 8192 || (size & (size - 1))) {
    throw new RangeError("fft size must be a power of two between 256 and 8192");
  }
  const real = new Float64Array(size), imag = new Float64Array(size);
  for (let i = 0; i < Math.min(size, samples.length); i++) {
    const x = Number(samples[i]) || 0;
    real[i] = x * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = -2 * Math.PI / len;
    for (let start = 0; start < size; start += len) {
      for (let j = 0; j < len / 2; j++) {
        const a = start + j, b = a + len / 2, t = angle * j;
        const c = Math.cos(t), s = Math.sin(t);
        const re = real[b] * c - imag[b] * s, im = real[b] * s + imag[b] * c;
        real[b] = real[a] - re; imag[b] = imag[a] - im;
        real[a] += re; imag[a] += im;
      }
    }
  }
  const power = new Float64Array(size / 2 + 1);
  for (let k = 0; k < power.length; k++) {
    power[k] = (real[k] * real[k] + imag[k] * imag[k]) / (size * size);
  }
  return power;
}

function evaluateFrame(samples, sampleRate, position, cfg, shape, fftSize = 2048) {
  const window = samples.subarray(position, position + fftSize);
  const power = fftPower(window, fftSize);
  const spacing = sampleRate / fftSize;
  let total = 0, low = 0, centroid = 0, strongest = 0, peakHz = 0, logSum = 0, bins = 0;
  for (let k = 1; k < power.length; k++) {
    const hz = k * spacing;
    if (hz < 20 || hz > Math.min(sampleRate / 2, 8000)) continue;
    const v = power[k];
    total += v; centroid += hz * v;
    if (hz <= 250) low += v;
    if (hz <= 2000 && v > strongest) { strongest = v; peakHz = hz; }
    logSum += Math.log(v + 1e-14); bins++;
  }
  const mean = total / Math.max(1, bins);
  const flatness = limit(Math.exp(logSum / Math.max(1, bins)) / Math.max(1e-14, mean), 0, 1);
  const scores = shape.map(({hz, coupling}) => {
    if (total <= 1e-12) return 0;
    let response = 0;
    for (let k = 1; k < power.length; k++) {
      const f = k * spacing;
      if (f < 20 || f > Math.min(sampleRate / 2, 4000)) continue;
      const ratio = f / hz;
      const transfer = 1 / Math.sqrt((1 - ratio * ratio) ** 2 +
        (2 * cfg.dampingRatio * ratio) ** 2);
      response += power[k] * Math.min(transfer * transfer, 140);
    }
    return Math.sqrt(response / total) * coupling;
  });
  const max = Math.max(1e-12, ...scores);
  // Unitless visualization drive, normalized per frame; NOT membrane displacement.
  const weights = scores.map(v => round(v / max, 4));
  let rms = 0;
  for (let i = 0; i < window.length; i++) rms += window[i] ** 2;
  rms = Math.sqrt(rms / Math.max(1, window.length));
  return {
    atSeconds: round(position / sampleRate, 3),
    rms: round(rms, 6), peakHz: round(peakHz, 2),
    centroidHz: round(total ? centroid / total : 0, 2),
    lowBandFraction: round(total ? low / total : 0, 4),
    spectralFlatness: round(flatness, 4), weights
  };
}

export function analyzePcm(samples, sampleRate, {
  fftSize = 2048, maxFrames = 48, maxSeconds = 180, cfg = RESONATOR
} = {}) {
  if (!(samples instanceof Float32Array || samples instanceof Float64Array)) {
    throw new TypeError("PCM must be Float32Array or Float64Array");
  }
  if (!(Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000)) {
    throw new RangeError("unsupported sample rate");
  }
  if (samples.length < 256) throw new RangeError("audio is too short");
  const shape = modes(cfg);
  const length = Math.min(samples.length, Math.floor(maxSeconds * sampleRate));
  const count = Math.min(limit(Math.floor(maxFrames), 1, 120),
    Math.max(1, Math.ceil(length / (sampleRate * 0.3))));
  const frames = [];
  for (let j = 0; j < count; j++) {
    const position = Math.max(0, Math.floor((length - fftSize) * j / Math.max(1, count - 1)));
    frames.push(evaluateFrame(samples, sampleRate, position, cfg, shape, fftSize));
  }
  const scores = shape.map((mode, i) => ({
    m: mode.m, n: mode.n, hz: mode.hz,
    weight: round(frames.reduce((s, f) => s + f.weights[i], 0) / frames.length, 4)
  })).sort((a, b) => b.weight - a.weight || a.hz - b.hz);
  const mean = key => round(frames.reduce((s, f) => s + f[key], 0) / frames.length, 4);
  return {
    schema: "mcc.resonance.analysis.v1", model: MODEL_VERSION,
    interpretation: "Idealized driven membrane simulation, not measured cymatics or DNA response",
    source: {sampleRate, durationSeconds: round(samples.length / sampleRate, 3),
      analyzedSeconds: round(length / sampleRate, 3), frames: frames.length},
    features: {rms: mean("rms"), centroidHz: mean("centroidHz"),
      lowBandFraction: mean("lowBandFraction"), spectralFlatness: mean("spectralFlatness")},
    dominantModes: scores.slice(0, 6), frames
  };
}

export function analyzeTrackouts(stems, options = {}) {
  if (!Array.isArray(stems) || !stems.length || stems.length > 32) {
    throw new RangeError("1–32 stems required");
  }
  const hz = stems[0].sampleRate;
  if (stems.some(x => x.sampleRate !== hz || !(x.samples instanceof Float32Array))) {
    throw new TypeError("stem PCM must be aligned to a common sample rate");
  }
  const shortest = Math.min(...stems.map(s => s.samples.length));
  if (shortest < 256) throw new RangeError("one stem is too short");
  if (shortest > hz * 360) throw new RangeError("stem set exceeds the 6-minute prototype cap");
  const pcm = new Float32Array(shortest);
  // Unity-gain approximation averaged to bound clipping. Phase is retained in
  // aligned PCM; this is NOT the mastered mix or artist's original fader settings.
  for (const stem of stems) for (let i = 0; i < shortest; i++) {
    pcm[i] += stem.samples[i] / stems.length;
  }
  return {
    schema: "mcc.resonance.trackouts.v1", combinedMeaning: "Equal-gain aligned stem sum; not a mastered mix",
    combined: analyzePcm(pcm, hz, options),
    stems: stems.map((s, i) => ({
      name: String(s.name || "stem-" + (i + 1)).slice(0, 100),
      analysis: analyzePcm(s.samples, s.sampleRate, options)
    }))
  };
}

// Sample a *visualized* nodal pattern, not an observed plate or cellular state.
// A_mn(t) comes from analyzed spectral power; unknown phases are set to zero.
export function fieldAt(x, y, weights, cfg = RESONATOR) {
  const shape = modes(cfg);
  let sum = 0, scale = 0;
  for (let i = 0; i < shape.length; i++) {
    const mode = shape[i], w = limit(Number(weights?.[i]) || 0, 0, 1);
    sum += w * Math.sin(Math.PI * mode.m * x) * Math.sin(Math.PI * mode.n * y);
    scale += w;
  }
  return scale ? sum / Math.sqrt(scale) : 0;
}

/* Scientific/algorithmic index keys describe one calibrated MODEL only.
 * Never use them as DNA, listener personality, therapeutic or genre labels.
 */
export function resonanceClass(analysis) {
  if (analysis?.schema !== "mcc.resonance.analysis.v1" ||
      analysis?.model !== MODEL_VERSION || !analysis.dominantModes?.length) {
    throw new TypeError("A matching Resonance Atlas analysis is required");
  }
  const top = analysis.dominantModes[0];
  const flatness = Number(analysis.features?.spectralFlatness || 0);
  const centroid = Number(analysis.features?.centroidHz || 0);
  const texture = flatness < 0.15 ? "tonal" : flatness < 0.55 ? "mixed" : "broadband";
  const spectralRegion = centroid < 500 ? "low" : centroid < 2000 ? "mid" : "high";
  return {
    schema: "mcc.resonance.class.v1",
    model: MODEL_VERSION,
    key: "membrane-m" + top.m + "n" + top.n + "/" + texture + "/" + spectralRegion,
    dominantMode: {m: top.m, n: top.n, hz: top.hz},
    texture, spectralRegion,
    note: "Acoustic/model cluster only; not a music genre or biological prediction"
  };
}

/* Acoustic-index candidate similarity; content-based discovery, NOT evidence
 * of a listener's preference. Higher = more similar within this one model.
 */
export function signatureSimilarity(a, b) {
  if (a?.model !== MODEL_VERSION || b?.model !== MODEL_VERSION) {
    throw new TypeError("Cannot compare mismatched resonance model versions");
  }
  const shape = modes();
  const drive = signature => {
    const values = new Map((signature.dominantModes || []).map(x => [x.m + ":" + x.n, x.weight]));
    return shape.map(mode => Number(values.get(mode.m + ":" + mode.n)) || 0);
  };
  const x = drive(a), y = drive(b);
  const dot = x.reduce((sum,value,i) => sum + value * y[i], 0);
  const lenA = Math.hypot(...x), lenB = Math.hypot(...y);
  const modal = lenA && lenB ? dot / (lenA * lenB) : 0;
  const centroidA = Math.max(20, Number(a.features?.centroidHz) || 20);
  const centroidB = Math.max(20, Number(b.features?.centroidHz) || 20);
  const distance = Math.abs(Math.log2(centroidA / centroidB));
  const centroidMatch = Math.exp(-distance);
  return round(limit(0.8 * modal + 0.2 * centroidMatch, 0, 1), 4);
}
