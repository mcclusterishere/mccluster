/* HALO CHART: one small line chart for the Halo view's detail panel (a NOAA station's observed water level over 24 hours).
   One series, so no legend (the heading above it names it); a 2px line, a recessive grid, the latest reading marked; a
   crosshair readout on hover or touch; the readings as a table under a disclosure, so nothing is colour or shape alone.
   Text wears the panel's text colours (css/halo.css .hx-chart), never the line's. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => { const n = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k])); return n; };
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

  /* a few round steps between lo and hi */
  function ticks(lo, hi, want) {
    const span = hi - lo || 1, raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  /* points: [[ms, value], ...] sorted by time; opts: { unit, label, decimals } */
  function line(host, points, opts) {
    const o = Object.assign({ unit: '', label: '', decimals: 2 }, opts || {});
    host.textContent = '';
    const pts = (points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) { const p = document.createElement('p'); p.className = 'hx-note'; p.textContent = 'Not enough readings to draw.'; host.appendChild(p); return; }
    const W = 300, H = 140, L = 30, R = 10, T = 10, B = 22;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    const pad = (hi - lo) * 0.15 || 0.1; lo -= pad; hi += pad;
    const yt = ticks(lo, hi, 4); lo = Math.min(lo, yt[0]); hi = Math.max(hi, yt[yt.length - 1]);
    const x = (t) => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
    const fmt = (v) => v.toFixed(o.decimals) + (o.unit ? ' ' + o.unit : '');

    const wrap = document.createElement('div'); wrap.className = 'hx-chart';
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': (o.label ? o.label + ': ' : '') + pts.length + ' readings from ' + hhmm(t0) + ' to ' + hhmm(t1) + ' UTC, latest ' + fmt(pts[pts.length - 1][1]) });
    yt.forEach((v) => {
      svg.appendChild(el('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const t = el('text', { class: 'axis', x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = String(+v.toFixed(2)); svg.appendChild(t);
    });
    [t0, t0 + (t1 - t0) / 2, t1].forEach((t, i) => {
      const lab = el('text', { class: 'axis', x: x(t), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }); lab.textContent = hhmm(t); svg.appendChild(lab);
    });
    svg.appendChild(el('polyline', { class: 'line', points: pts.map((p) => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ') }));
    const last = pts[pts.length - 1];
    svg.appendChild(el('circle', { class: 'end', cx: x(last[0]), cy: y(last[1]), r: 4 }));
    const cross = el('line', { class: 'cross', y1: T, y2: H - B, x1: -10, x2: -10 }); svg.appendChild(cross);
    const hit = el('rect', { class: 'hit', x: L, y: T, width: W - L - R, height: H - T - B }); svg.appendChild(hit);
    const out = document.createElement('output'); out.hidden = true;
    wrap.append(svg, out);

    function at(clientX) {
      const r = svg.getBoundingClientRect(), sx = (clientX - r.left) / r.width * W;
      const t = t0 + (sx - L) / (W - L - R) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      cross.setAttribute('x1', x(best[0])); cross.setAttribute('x2', x(best[0]));
      out.hidden = false; out.textContent = hhmm(best[0]) + ' UTC · ' + fmt(best[1]);
      out.style.left = (x(best[0]) / W * 100) + '%';
    }
    const off = () => { out.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); };
    hit.addEventListener('pointermove', (e) => at(e.clientX));
    hit.addEventListener('pointerdown', (e) => at(e.clientX));
    hit.addEventListener('pointerleave', off);

    const table = document.createElement('details');
    table.innerHTML = '<summary class="hx-more">Show the readings</summary>';
    const t = document.createElement('table'); t.className = 'hx-rows';
    t.innerHTML = '<thead><tr><th scope="col">Time (UTC)</th><th scope="col">' + (o.label || 'Value') + '</th></tr></thead>';
    const tb = document.createElement('tbody');
    pts.slice(-24).reverse().forEach((p) => { const tr = document.createElement('tr'); tr.innerHTML = '<td>' + hhmm(p[0]) + '</td><td>' + fmt(p[1]) + '</td>'; tb.appendChild(tr); });
    t.appendChild(tb); table.appendChild(t);
    host.append(wrap, table);
  }

  window.HaloChart = Object.freeze({ line, ticks });
})();
