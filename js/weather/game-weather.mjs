/* GAME WEATHER: real Connecticut conditions -> fictional city effects, as a pure function.

     import { gameWeather } from './js/weather/game-weather.mjs';
     const w = gameWeather(snapshot, { nowMs: Date.now() });
     // w.effects.rain (0..1), w.effects.wind_ms, w.effects.water_y_navd88, w.real_alerts, w.labels ...

   The city can consume this later; this file does not touch js/fictional-city/.

   What it is: game weather (data_kind 'simulated'), INSPIRED by observed
   records. Every output says which record it came from and how old that was;
   when a record is missing or stale the effect falls back to a calm,
   deterministic default and says "simulated", never pretending to be live.

   What it is not: a forecast or an observation. Real warnings are passed
   through untouched in `real_alerts` so a fictional skin can never hide them.

   Inputs used:
     rain  <- rain_now (MRMS rate at the Bridgeport focus cell), else the station's text
     wind  <- observation (KBDR station wind, at 10 m). Radar radial velocity is
              NOT used for wind: it is the component along the KOKX beam, aloft.
     tide  <- water_level (NAVD88 m) and tide_predictions (next high/low -> rising/falling)
   The city-Y water offset (cityY = NAVD88 - 0.23) is the PROPOSAL in
   docs/fictional-city/PLANET-CONNECTICUT.md, not an accepted contract: it is
   returned as `water_city_y_proposed` and flagged so. */

const FOCUS = { lat: 41.172, lon: -73.1885 };
export const CITY_Y_OFFSET_PROPOSED = -0.23;

function fresh(record, nowMs) {
  if (!record || record.status === 'missing' || !record.payload) return false;
  const at = Date.parse(record.stale_at || '');
  return Number.isFinite(at) && at > nowMs;
}
function basis(record) { return record ? record.observed_at || record.issued_at || null : null; }

/* rain rate (mm/h) -> 0..1 intensity, roughly log: drizzle 0.1, moderate 4 mm/h ~0.55, heavy 16+ ~0.9 */
export function rainIntensity(mmh) {
  if (!(mmh > 0)) return 0;
  return Math.min(1, Math.round((Math.log10(mmh * 10 + 1) / Math.log10(400)) * 100) / 100);
}
export function rainLabel(mmh) {
  if (!(mmh > 0)) return 'dry';
  if (mmh < 0.5) return 'drizzle';
  if (mmh < 4) return 'light rain';
  if (mmh < 16) return 'moderate rain';
  if (mmh < 50) return 'heavy rain';
  return 'violent rain';
}

function focusRate(snapshot) {
  const p = snapshot?.feeds?.rain_now?.payload;
  const v = p?.focus?.precip_rate_mmh;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function gameWeather(snapshot, { nowMs = Date.now() } = {}) {
  const feeds = snapshot?.feeds || {};
  const inputs = [];
  const labels = ['Game weather: fictional effects inspired by real readings'];

  // rain
  let rain = { intensity: 0, label: 'dry', source: 'simulated_default' };
  if (fresh(feeds.rain_now, nowMs) && focusRate(snapshot) !== null) {
    const r = focusRate(snapshot);
    rain = { intensity: rainIntensity(r), label: rainLabel(r), mmh: r, source: 'rain_now' };
    inputs.push({ feed: 'rain_now', at: basis(feeds.rain_now) });
  } else if (fresh(feeds.observation, nowMs) && /rain|drizzle|shower|thunder/i.test(feeds.observation.payload.description || '')) {
    rain = { intensity: 0.4, label: 'rain (station report)', source: 'observation' };
    inputs.push({ feed: 'observation', at: basis(feeds.observation) });
  }

  // wind (station, never radar velocity)
  let wind = { speed_ms: 2, from_deg: 225, gust_ms: null, source: 'simulated_default' };
  const v = fresh(feeds.observation, nowMs) ? feeds.observation.payload.values : null;
  if (v && typeof v.wind_speed === 'number') {
    const kmh = feeds.observation.units?.wind_speed === 'km_h-1';
    const toMs = (x) => (typeof x === 'number' ? Math.round((kmh ? x / 3.6 : x) * 10) / 10 : null);
    wind = { speed_ms: toMs(v.wind_speed), from_deg: typeof v.wind_direction === 'number' ? v.wind_direction : null, gust_ms: toMs(v.wind_gust), source: 'observation' };
    if (!inputs.some((i) => i.feed === 'observation')) inputs.push({ feed: 'observation', at: basis(feeds.observation) });
  }

  // tide
  let tide = { level_navd88_m: 0, trend: 'unknown', next: null, source: 'simulated_default' };
  if (fresh(feeds.water_level, nowMs)) {
    tide = { ...tide, level_navd88_m: feeds.water_level.payload.water_level, source: 'water_level' };
    inputs.push({ feed: 'water_level', at: basis(feeds.water_level) });
  }
  const events = feeds.tide_predictions?.payload?.events || [];
  const next = events.find((e) => Date.parse(e.t) > nowMs);
  if (next) {
    tide.next = next;
    tide.trend = next.type === 'high' ? 'rising' : 'falling';
    inputs.push({ feed: 'tide_predictions', at: basis(feeds.tide_predictions) });
  }

  const realAlerts = fresh(feeds.alerts, nowMs) || feeds.alerts?.status === 'carried_forward'
    ? (feeds.alerts?.payload?.alerts || []).map((a) => ({ event: a.event, severity: a.severity, headline: a.headline, expires: a.expires, link: a.link }))
    : [];
  if (!fresh(feeds.alerts, nowMs)) labels.push('Official alerts could not be confirmed current: check weather.gov');
  if ([rain, wind, tide].some((x) => x.source === 'simulated_default')) labels.push('Some effects use simulated defaults because a reading was missing or stale');

  return {
    data_kind: 'simulated',
    schema: 'mccluster.game-weather.v1',
    region: snapshot?.region || null,
    computed_at: new Date(nowMs).toISOString(),
    focus: FOCUS,
    rain, wind, tide,
    effects: {
      rain: rain.intensity,
      wetness: Math.min(1, rain.intensity * 1.2),
      puddles: rain.intensity > 0.5,
      wind_ms: wind.speed_ms ?? 2,
      wind_from_deg: wind.from_deg ?? 225,
      gusty: typeof wind.gust_ms === 'number' && wind.gust_ms > 10,
      water_y_navd88: tide.level_navd88_m,
      water_city_y_proposed: Math.round((tide.level_navd88_m + CITY_Y_OFFSET_PROPOSED) * 1000) / 1000,
      water_city_y_status: 'proposal: cityY = NAVD88 - 0.23 is not an accepted contract',
    },
    real_alerts: realAlerts,
    inputs,
    labels,
  };
}
