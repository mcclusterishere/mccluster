/* Helix geometry contract. Pure math: no renderer or browser dependencies. */
export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function albumProfile(trackCount, overrides = {}) {
  const count = clamp(Math.floor(Number(trackCount) || 1), 1, 100);
  return {
    count,
    radius: overrides.radius ?? 0.68,
    height: overrides.height ?? 5.4,
    // Enough turn to read as a real helix even on a short record.
    turns: overrides.turns ?? clamp(0.75 + count * 0.125, 1.25, 2.5),
    phase: overrides.phase ?? -Math.PI / 2
  };
}

export function strandPoint(u, side, profile) {
  const t = clamp(u, 0, 1);
  const angle = profile.phase + profile.turns * TAU * t + (side ? Math.PI : 0);
  return {
    x: profile.radius * Math.cos(angle),
    y: (t - 0.5) * profile.height,
    z: profile.radius * Math.sin(angle)
  };
}

export function rungPositions(trackCount, profile = albumProfile(trackCount)) {
  const count = clamp(Math.floor(Number(trackCount) || 1), 1, 100);
  return Array.from({ length: count }, (_, index) => {
    const u = (index + 1) / (count + 1);
    return {
      index,
      u,
      y: (u - 0.5) * profile.height,
      a: strandPoint(u, 0, profile),
      b: strandPoint(u, 1, profile)
    };
  });
}

export function classifyGesture(dx, dy, threshold = 28) {
  if (Math.hypot(dx, dy) < threshold) return "tap";
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
}

export function catalogueOffset(index, selected, total) {
  if (total <= 1) return 0;
  let delta = (index - selected + total) % total;
  if (delta > total / 2) delta -= total;
  return delta;
}

// A procedural identity shape, NOT a measured recording waveform.
// Actual measured peaks may be supplied by the publishing pipeline later.
export function visualPeaks(key, count = 31) {
  let seed = 2166136261;
  for (const char of String(key)) {
    seed ^= char.codePointAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return Array.from({ length: count }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const envelope = 0.45 + 0.45 * Math.sin(Math.PI * (i + 0.5) / count);
    return clamp((0.25 + (seed / 4294967296) * 0.75) * envelope, 0.08, 1);
  });
}

export function lyricText(record) {
  if (typeof record === "string") return record;
  if (!record || typeof record !== "object") return "";
  if (typeof record.plain === "string") return record.plain;
  return Array.isArray(record.lines)
    ? record.lines.map(line => typeof line === "string" ? line : line?.text || "").join("\n")
    : "";
}
