/* THE WEATHER DESK (weather-desk.html, owner only): Rain now, Radar, Forecast & alerts, Tide.

   Reads McCluster Core's Connecticut snapshot through the Worker (./client.mjs).
   Every card shows its source, product, observed or issued time and age, and a
   STALE or MISSING badge; ages keep counting between polls. Observations,
   forecasts, alerts and the game's simulated weather are labelled separately. */
import { createWeatherLayer, decodeRaster, ageNow, ageText, staleNow } from './client.mjs';
import { gameWeather } from './game-weather.mjs';
import { storedToken } from '../owner-only.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—');
const KIND = { observation: 'Observed', forecast: 'Forecast', alert: 'Official alert', simulated: 'Simulated' };
let snap = null;
let radarFeed = 'radar_reflectivity';

async function token() {
  try { if (window.MCC && typeof window.MCC.refreshIfNeeded === 'function') { const s = await window.MCC.refreshIfNeeded(); if (s?.access_token) return s.access_token; } } catch { /* fall back */ }
  return storedToken();
}

/* card footer: provenance, time, age, flags */
function meta(record) {
  if (!record) return '<p class="wd-meta">No record.</p>';
  if (record.status === 'missing') return `<p class="wd-meta"><span class="wd-badge is-missing">Missing</span> ${esc(record.source_id)} · ${esc(record.product)} did not answer (${esc(record.missing_reason)}).</p>`;
  const stale = staleNow(record);
  const at = record.observed_at || record.issued_at;
  const label = record.observed_at ? 'observed' : 'issued';
  const badges = [
    `<span class="wd-badge is-${esc(record.data_kind)}">${esc(KIND[record.data_kind] || record.data_kind)}</span>`,
    stale ? '<span class="wd-badge is-stale">Stale</span>' : '',
    record.status === 'carried_forward' ? '<span class="wd-badge is-stale">Carried forward</span>' : '',
  ].join(' ');
  return `<p class="wd-meta">${badges} ${esc(label)} <time datetime="${esc(at)}">${esc(time(at))}</time> · <b data-age="${esc(record.feed)}">${esc(ageText(ageNow(record, snap)))}</b><br>
    ${esc(record.attribution)} · ${esc(record.product)}${record.quality_flags?.length ? ` · <span class="wd-flags">${esc(record.quality_flags.join(', '))}</span>` : ''}</p>`;
}

/* colour ramps (the house palette rule, tested): rain blue -> green -> yellow -> red; reflectivity NWS-like, top end white;
   velocity green toward the radar, red away */
function rainColour(v) {
  if (!(v > 0)) return null;
  if (v < 1) return [120, 190, 240, 170];
  if (v < 4) return [40, 140, 220, 200];
  if (v < 10) return [30, 170, 80, 220];
  if (v < 25) return [240, 200, 30, 230];
  if (v < 50) return [240, 120, 20, 240];
  return [210, 30, 30, 250];
}
function reflColour(v) {
  if (!(v >= 5)) return null;
  const stops = [[5, [100, 200, 230]], [20, [30, 160, 60]], [35, [240, 210, 40]], [45, [240, 120, 20]], [55, [200, 20, 20]], [65, [250, 250, 250]]];
  let c = stops[0][1];
  for (const [t, col] of stops) if (v >= t) c = col;
  return [...c, 210];
}
function velColour(v) {
  if (v === null || Number.isNaN(v)) return null;
  const a = Math.min(1, Math.abs(v) / 30);
  if (Math.abs(v) < 1) return [150, 150, 150, 120];
  return v < 0 ? [20, Math.round(120 + 135 * a), 60, 210] : [Math.round(120 + 135 * a), 30, 30, 210];
}

function paint(canvas, raster, colour) {
  const { nx, ny } = raster.grid;
  canvas.width = nx; canvas.height = ny;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(nx, ny);
  for (let k = 0; k < nx * ny; k += 1) {
    let c = raster.special[k] === 3 ? [40, 44, 48, 255] : raster.special[k] === 2 ? [90, 80, 60, 180] : colour(raster.values[k]);
    if (!c) c = [16, 22, 28, 255];
    img.data.set(c, k * 4);
  }
  ctx.putImageData(img, 0, 0);
}

function focusMark(grid) {
  const x = ((snap.focus.lon - grid.west) / (grid.east - grid.west)) * 100;
  const y = ((grid.north - snap.focus.lat) / (grid.north - grid.south)) * 100;
  return `<i class="wd-focus" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" title="${esc(snap.focus.name)}"></i>`;
}

function renderRain() {
  const r = snap.feeds.rain_now;
  const el = $('#wdRain');
  const raster = decodeRaster(r, snap.grid);
  const f = r?.payload?.focus;
  el.innerHTML = `<h2>Rain now</h2>
    <p class="wd-lede">${f && f.precip_rate_mmh !== null ? `${esc(f.precip_rate_mmh)} mm/h at ${esc(f.name)}` : 'No rate at the harbour'}${r?.payload?.stats ? ` · ${esc(r.payload.stats.wet_cells)} wet cells of ${esc(r.payload.stats.covered_cells)}` : ''}</p>
    ${raster ? `<div class="wd-map"><canvas aria-label="Estimated rain rate over Connecticut"></canvas>${focusMark(snap.grid)}</div>
    <p class="wd-legend"><span style="--c:#78bef0"></span>&lt;1 <span style="--c:#288cdc"></span>1–4 <span style="--c:#1eaa50"></span>4–10 <span style="--c:#f0c81e"></span>10–25 <span style="--c:#f07814"></span>25–50 <span style="--c:#d21e1e"></span>50+ mm/h <span style="--c:#5a503c"></span>no coverage</p>` : ''}
    <p class="wd-note">${esc(r?.payload?.meaning || 'MRMS precipitation rate.')}</p>${meta(r)}`;
  if (raster) paint($('canvas', el), raster, rainColour);
}

function renderRadar() {
  const r = snap.feeds[radarFeed];
  const el = $('#wdRadar');
  const raster = decodeRaster(r, snap.grid);
  const vel = radarFeed === 'radar_velocity';
  const f = r?.payload?.focus;
  el.innerHTML = `<h2>Radar · KOKX</h2>
    <div class="wd-seg" role="group" aria-label="Radar product">
      <button type="button" data-radar="radar_reflectivity" aria-pressed="${!vel}">Reflectivity</button>
      <button type="button" data-radar="radar_velocity" aria-pressed="${vel}">Radial velocity</button>
    </div>
    ${f ? `<p class="wd-lede">${f.value === null ? 'No return' : `${esc(f.value)} ${esc(vel ? 'm/s' : 'dBZ')}`} at ${esc(f.name)} · ${esc(f.range_km)} km from the radar, beam about ${esc(f.beam_centre_height_m)} m up</p>` : ''}
    ${raster ? `<div class="wd-map"><canvas aria-label="${vel ? 'Radial velocity relative to KOKX' : 'Reflectivity from KOKX'}"></canvas>${focusMark(snap.grid)}</div>` : ''}
    <p class="wd-legend">${vel
      ? '<span style="--c:#1ef03c"></span>toward KOKX <span style="--c:#969696"></span>near 0 <span style="--c:#f01e1e"></span>away from KOKX <span style="--c:#5a503c"></span>range folded'
      : '<span style="--c:#64c8e6"></span>5 <span style="--c:#1ea03c"></span>20 <span style="--c:#f0d228"></span>35 <span style="--c:#f07814"></span>45 <span style="--c:#c81414"></span>55 <span style="--c:#fafafa"></span>65+ dBZ'}</p>
    <p class="wd-note">${esc(r?.payload?.meaning || '')}${r?.payload?.radar ? ` Tilt ${esc(r.payload.radar.elevation_deg)}°, volume ${esc(time(r.payload.radar.volume_start))}.` : ''}</p>${meta(r)}`;
  if (raster) paint($('canvas', el), raster, vel ? velColour : reflColour);
  el.querySelectorAll('[data-radar]').forEach((b) => b.addEventListener('click', () => { radarFeed = b.dataset.radar; renderRadar(); }));
}

function renderForecast() {
  const a = snap.feeds.alerts, fc = snap.feeds.forecast_hourly, ob = snap.feeds.observation;
  const alerts = a?.payload?.alerts || [];
  const v = ob?.payload?.values || {};
  const periods = (fc?.payload?.periods || []).slice(0, 12);
  $('#wdForecast').innerHTML = `<h2>Forecast &amp; alerts</h2>
    <h3>Official alerts · ${esc(a?.payload?.zone_name || 'CTZ009')}</h3>
    ${alerts.length ? `<ul class="wd-alerts">${alerts.map((x) => `<li><b>${esc(x.event)}</b> ${esc(x.severity || '')} · until ${esc(time(x.expires || x.ends))}<br>${esc(x.headline || '')}${x.link ? ` <a href="${esc(x.link)}" rel="noopener" target="_blank">NWS text</a>` : ''}</li>`).join('')}</ul>` : `<p class="wd-lede">${a?.status === 'missing' ? 'Alerts could not be checked: see weather.gov.' : 'No active alerts.'}</p>`}
    ${meta(a)}
    <h3>Station now · ${esc(ob?.payload?.station || 'KBDR')}</h3>
    <p class="wd-lede">${ob?.payload ? `${esc(ob.payload.description || '')} · ${esc(v.temperature ?? '—')} °C · wind ${esc(typeof v.wind_speed === 'number' ? Math.round(v.wind_speed) : '—')} ${esc(String(ob.units?.wind_speed || '').replace('km_h-1', 'km/h').replace('m_s-1', 'm/s'))} from ${esc(v.wind_direction ?? '—')}°` : 'No station reading.'}</p>
    ${meta(ob)}
    <h3>Next hours · NWS ${esc(fc?.payload?.office || 'OKX')} ${esc(fc?.payload?.grid_x ?? '')},${esc(fc?.payload?.grid_y ?? '')}</h3>
    ${periods.length ? `<ol class="wd-hours">${periods.map((p) => `<li><time datetime="${esc(p.start)}">${esc(new Date(p.start).toLocaleTimeString([], { hour: 'numeric' }))}</time><b>${esc(p.temperature_c ?? '—')}°</b><span>${esc(p.precip_probability_pct ?? 0)}%</span><small>${esc(p.short_forecast || '')}</small></li>`).join('')}</ol>` : '<p class="wd-lede">No forecast periods.</p>'}
    ${meta(fc)}`;
}

function renderTide() {
  const wl = snap.feeds.water_level, pr = snap.feeds.tide_predictions;
  const events = (pr?.payload?.events || []).filter((e) => Date.parse(e.t) > Date.now() - 6 * 3_600_000).slice(0, 5);
  $('#wdTide').innerHTML = `<h2>Tide · Bridgeport</h2>
    <p class="wd-lede">${wl?.payload ? `${esc(wl.payload.water_level)} m NAVD88 (±${esc(wl.payload.sigma ?? '—')} m)` : 'No water level.'}</p>
    ${meta(wl)}
    ${events.length ? `<ul class="wd-tides">${events.map((e) => `<li class="${Date.parse(e.t) < Date.now() ? 'is-past' : ''}"><b>${esc(e.type)}</b> ${esc(time(e.t))} · ${esc(e.level)} m</li>`).join('')}</ul>` : ''}
    ${meta(pr)}`;
}

function renderGame() {
  const g = gameWeather(snap);
  $('#wdGame').innerHTML = `<h2>Game weather</h2>
    <p class="wd-lede"><span class="wd-badge is-simulated">Simulated</span> ${esc(g.rain.label)} · wind ${esc(g.effects.wind_ms)} m/s · tide ${esc(g.tide.trend)}</p>
    <p class="wd-note">${esc(g.labels.join('. '))}. Inputs: ${esc(g.inputs.map((i) => i.feed).join(', ') || 'none')}.</p>`;
}

function render() {
  const status = $('#wdStatus');
  if (!snap) return;
  if (!snap.available) { status.textContent = snap.note || 'No snapshot yet.'; return; }
  const c = snap.counts || {};
  status.textContent = `Snapshot ${ageText(snap.snapshot_age_s)} · ${c.ok || 0} fresh, ${c.carried_forward || 0} carried forward, ${c.missing || 0} missing`;
  renderRain(); renderRadar(); renderForecast(); renderTide(); renderGame();
}

function tickAges() {
  if (!snap?.feeds) return;
  document.querySelectorAll('[data-age]').forEach((el) => { el.textContent = ageText(ageNow(snap.feeds[el.dataset.age], snap)); });
}

const layer = createWeatherLayer({
  getToken: token,
  onUpdate: (s) => { snap = s; render(); },
  onError: (e) => { $('#wdStatus').textContent = e.status === 403 ? 'This is the house owner’s.' : `Weather could not load: ${e.message}`; },
});
layer.start();
setInterval(tickAges, 15_000);
$('#wdRefresh')?.addEventListener('click', () => layer.refresh());
window.MCC_WEATHER = { layer, gameWeather };
