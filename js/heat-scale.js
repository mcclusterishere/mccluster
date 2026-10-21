/* HEAT: how much, as a colour, for the World's news map and the Control Room's Analytics globe.

   Owner, 2026-10-21: "aggregate each mention of a state or country with a heat map of how many articles or mentions it has
   ... so people aren't just needlessly searching for tiny pins", and of the Analytics map: "lackluster, really lackluster,
   because the shading isn't dynamic enough".

   Why the old shading was flat: it was value ÷ the largest value (square-rooted), so one big country pushed every other
   one into the bottom fifth of a two-colour blend. Here a value's level is half its rank among the places that have any
   (so the ramp is used end to end, whatever the spread) and half its size on a log scale (so a place with ten times more
   still looks it). Ties share a level; the smallest non-zero level is LOW, never invisible; a place with none has no level.

   The ramps run dark to bright (the anchor flipped for dark surfaces): the World's is semantic heat, deep red through
   orange to pale yellow, its lightness rising at every stop; Analytics builds a one-hue ramp from its own accent token
   (js/control-room/analytics-globe.js), since everything red on that screen derives from that token.

   Pure: no DOM, no Cesium. Colours are [r, g, b, a] in 0..1; css() gives a CSS colour. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HuHeat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LOW = 0.08;
  /* the World's news heat over the satellite Earth, at night as by day: even the least is a clear crimson, the most a pale gold;
     more opaque as it rises */
  const HEAT = Object.freeze([
    Object.freeze({ at: 0, hex: '#8c1a3e', a: 0.55 }),
    Object.freeze({ at: 0.25, hex: '#bf2a3c', a: 0.62 }),
    Object.freeze({ at: 0.5, hex: '#e8562e', a: 0.68 }),
    Object.freeze({ at: 0.75, hex: '#f8a12f', a: 0.75 }),
    Object.freeze({ at: 1, hex: '#ffe27a', a: 0.84 }),
  ]);

  const hexRgb = (hex) => { const h = String(hex).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
  /* each value's level, 0..1 (LOW..1 for any above zero; null for none): half rank, half log size */
  function levels(values) {
    const pos = (values || []).map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    const n = pos.length, max = n ? pos[n - 1] : 0, lmax = Math.log1p(max);
    const level = new Map();
    for (let i = 0; i < n; ) {
      let j = i; while (j + 1 < n && pos[j + 1] === pos[i]) j++;
      const v = pos[i], rank = n === 1 ? 1 : ((i + j) / 2) / (n - 1), size = lmax > 0 ? Math.log1p(v) / lmax : 1;
      level.set(v, Math.max(LOW, Math.min(1, 0.5 * rank + 0.5 * size)));
      i = j + 1;
    }
    return (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? level.get(x) ?? null : null; };
  }
  /* a ramp's colour at t (0..1): straight between its stops; stops: [{at, hex, a}] or [{at, rgb: [r,g,b], a}] */
  function at(stops, t) {
    const s = stops || HEAT, x = Math.max(0, Math.min(1, Number(t) || 0));
    let k = 0; while (k < s.length - 2 && x > s[k + 1].at) k++;
    const a = s[k], b = s[k + 1] || a, f = b.at > a.at ? (x - a.at) / (b.at - a.at) : 0;
    const ca = a.rgb || hexRgb(a.hex), cb = b.rgb || hexRgb(b.hex);
    return [0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * f).concat([(a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * f]);
  }
  /* a one-hue ramp from a surface colour to an accent and on to a light tint of it: dark (little) to bright (most) */
  function accentRamp(surface, accent, opaque) {
    const mix = (p, q, f) => p.map((v, i) => v + (q[i] - v) * f), white = [1, 1, 1];
    return [
      { at: 0, rgb: mix(surface, accent, 0.28), a: opaque ? 1 : 0.5 },
      { at: 0.5, rgb: accent.slice(0, 3), a: opaque ? 1 : 0.7 },
      { at: 1, rgb: mix(accent, white, 0.62), a: opaque ? 1 : 0.85 },
    ];
  }
  const css = (c) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (Math.round(c[3] * 100) / 100) + ')';
  /* the legend's bar: the ramp, opaque, left (little) to right (most) */
  function gradient(stops) { return 'linear-gradient(90deg,' + (stops || HEAT).map((s) => { const c = at(stops || HEAT, s.at); c[3] = 1; return css(c) + ' ' + Math.round(s.at * 100) + '%'; }).join(',') + ')'; }
  /* the OKLab lightness of an sRGB colour (0..1), for the test that each ramp only gets lighter */
  function lightness(c) {
    const lin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
    const [r, g, b] = c.slice(0, 3).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  }
  /* "1 story", "1,234 stories" */
  function stories(n) { const x = Math.max(0, Math.round(Number(n) || 0)); return x.toLocaleString('en-US') + (x === 1 ? ' story' : ' stories'); }
  return { HEAT, LOW, levels, at, accentRamp, css, gradient, lightness, hexRgb, stories };
});
