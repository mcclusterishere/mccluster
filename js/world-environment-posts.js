/* ENVIRONMENTAL OBSERVATION POSTS (owner, 2026-11-17: "the environmental globe updates should be updates like as posts from the
   admin system, like from the system, like it would look like posts just like on the news feed … obviously what time the event
   was recorded"). docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, target 13; slice G1 (lane L2).

   The pure parts, read by the World page (js/mnet.js draws the posts) and by node --test
   (scripts/test/world-environment-posts.test.mjs). Nothing here touches the page, the network, storage or the clock: the page
   passes `now`. The feed itself is fetched once, by the Environmental Justice panel, and handed to the page as the DOM
   CustomEvent mcc:world-environment-events; this module turns that detail into posts.
   - significance: one pure rule per provider. USGS at M5.5 or with a ShakeMap; NWS Extreme or Severe with a point of its own
     (a zone-only alert is never placed and never significant); every NHC storm; EONET fires, cyclones, tornadoes, storms and
     volcanoes. Digest rows: a 1-degree fire area from 500 MW of summed radiative power, a perimeter from 10,000 acres.
   - stamp: the recorded time (observed_at) as local time and how long ago; when the source gives no event time, the retrieval
     time, labelled as such; else "Time not supplied by provider". A fetch time never stands in the recorded slot.
   - observationPosts: one post per event id, by the system author "Environmental desk", typed "Environmental observation";
     fires are summarised per 1-degree area (never one post per detection); perimeters post with their acres and dates.
   - interleaveByTime: the Equity Uprise tab's one list of mission posts and observation posts, newest first.
   - withObservations: Global carries the significant ones, one after every six other items, each once, never padding. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MCC_ENVIRONMENT_POSTS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* one observation after every EVERY_OBS other items in Global */
  const EVERY_OBS = 6;
  const AUTHOR = 'Environmental desk', TYPE = 'Environmental observation';
  const SIGNIFICANT_SEVERITY = ['Extreme', 'Severe'];
  const SIGNIFICANT_NATURAL = ['fire', 'cyclone', 'tornado', 'storm', 'volcano'];
  const ICONS = ['quake', 'alert', 'fire', 'storm', 'volcano', 'water', 'other'];

  const line = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  /* an https address with no credentials in it, else nothing (the page passes every link through its own safe URL helper too) */
  function https(v) {
    if (typeof v !== 'string' || !v.trim()) return '';
    try { const u = new URL(v.trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const provider = (row) => line(row && row.id, 300).split(':')[0];
  const placed = (row) => !!row && Number.isFinite(row.lat) && Number.isFinite(row.lon) && Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180;
  /* the value of one fact by its label, as the feed formats it (Magnitude "5.4", Depth "273.6 km", Severity "Severe") */
  function fact(row, label) {
    const list = row && Array.isArray(row.facts) ? row.facts : [];
    for (const f of list) if (f && f.label === label && typeof f.value === 'string') return f.value;
    return null;
  }
  const localTime = (at) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  /* ---------- significance ---------- */
  function significance(row) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string') return false;
    const p = provider(row);
    if (p === 'usgs') return Number(fact(row, 'Magnitude')) >= 5.5 || row.shakemap_available === true;
    if (p === 'nws') return SIGNIFICANT_SEVERITY.includes(fact(row, 'Severity')) && placed(row);
    if (p === 'nhc') return true;
    if (p === 'eonet') return SIGNIFICANT_NATURAL.includes(row.category);
    return false;
  }
  function significanceOfDigest(kind, row) {
    if (kind === 'fire_cell') return num(row && row.frp_sum_mw) !== null && row.frp_sum_mw >= 500;
    if (kind === 'perimeter') return num(row && row.gis_acres) !== null && row.gis_acres >= 10000;
    return false;
  }

  /* ---------- time ---------- */
  /* how long ago, by the feed's own rules (js/mnet.js timeAgo): now, Nm, Nh, Nd, then a short date (with its year when it is
     not this year); a time just ahead of the clock reads "now", never negative */
  function agoLabel(at, now) {
    const t = Date.parse(at);
    if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
    const sec = Math.max(0, Math.floor((now - t) / 1000));
    if (sec < 60) return 'now';
    const min = Math.floor(sec / 60); if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60); if (hr < 24) return hr + 'h';
    const day = Math.floor(hr / 24); if (day < 7) return day + 'd';
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
  }
  /* the recorded time, else the retrieval time labelled as such, else none; sort_key sorts the undated last */
  function stamp(row, now) {
    const observed = iso(row && row.observed_at), fetched = iso(row && row.fetched_at);
    if (observed) {
      const local = localTime(observed), ago = agoLabel(observed, now);
      return { kind: 'recorded', iso: observed, local, ago, text: 'Recorded ' + local + ' · ' + ago, sort_key: observed };
    }
    if (fetched) {
      const local = localTime(fetched), ago = agoLabel(fetched, now);
      return { kind: 'retrieved', iso: fetched, local, ago, text: 'Retrieved ' + local + ' · ' + ago + ' · source gives no event time', sort_key: fetched };
    }
    return { kind: 'none', iso: null, local: '', ago: '', text: 'Time not supplied by provider', sort_key: '' };
  }

  /* ---------- the post's words ---------- */
  const NATURAL_ICON = { fire: 'fire', cyclone: 'storm', tornado: 'storm', storm: 'storm', wind: 'storm', rain: 'storm', volcano: 'volcano', flood: 'water', wave: 'water', ice: 'water', snow: 'water' };
  /* a plain line icon by kind: never the brand's mark */
  function iconFor(row) {
    const p = provider(row);
    if (p === 'usgs') return 'quake';
    if (p === 'nws') return 'alert';
    if (p === 'nhc') return 'storm';
    if (p === 'eonet') return NATURAL_ICON[row && row.category] || 'other';
    return 'other';
  }
  /* quake "M<mag> · <place>"; alert "<event> · <area>"; EONET its title; NHC "<name> · <classification>" */
  function titleFor(row) {
    const p = provider(row), title = line(row && row.title, 180) || 'Environmental event';
    if (p === 'usgs') { const mag = fact(row, 'Magnitude'); return line(mag ? 'M' + mag + ' · ' + title : title, 160); }
    if (p === 'nws') {
      const area = line(fact(row, 'Area'), 300), event = line((/^(.+?)\s+issued\b/i.exec(title) || [])[1], 80);
      return line(event && area ? event + ' · ' + area : title, 160);
    }
    if (p === 'nhc') { const cls = fact(row, 'Classification'); return line(cls ? title + ' · ' + cls : title, 160); }
    return line(title, 160);
  }
  /* the feed's own facts, clipped as the panel clips them (at most 16 of label 80, value 320) */
  function factsFor(row) {
    const out = [];
    for (const f of (row && Array.isArray(row.facts) ? row.facts : []).slice(0, 16)) {
      if (!f || typeof f.label !== 'string' || typeof f.value !== 'string') continue;
      const label = line(f.label, 80), value = line(f.value, 320);
      if (label && value) out.push({ label, value });
    }
    return out;
  }
  const KIND = { usgs: 'quake', nws: 'alert', eonet: 'natural', nhc: 'cyclone' };
  /* FNV-1a over the words that matter: a later load with the same words is the same post; "ago" and the clock are not words */
  function contentHash(post) {
    const s = JSON.stringify([post && post.title, post && post.facts, post && post.stamp && post.stamp.iso, post && post.stamp && post.stamp.kind, post && post.status, post && post.reason, post && post.coverage, post && post.source && post.source.url, post && post.lat, post && post.lon]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /* ---------- the posts ---------- */
  function sourceOf(sources, id) {
    for (const s of sources) if (s && typeof s === 'object' && s.id === id) return s;
    return null;
  }
  function finish(post) {
    post.coverage = line(post.coverage, 200) || 'Not stated by the source';
    post.status = ['available', 'stale', 'unavailable'].includes(post.status) ? post.status : 'unavailable';
    post.reason = line(post.reason, 40) || null;
    post.sort_key = post.stamp.sort_key;
    post.hash = contentHash(post);
    return post;
  }
  /* detail: the mcc:world-environment-events detail (events, sources, layers, unavailable); now: the page's clock */
  function observationPosts(detail, now) {
    const out = [];
    if (!detail || typeof detail !== 'object' || detail.unavailable === true) return out;
    const sources = Array.isArray(detail.sources) ? detail.sources : [], seen = new Set();
    for (const row of (Array.isArray(detail.events) ? detail.events : [])) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      const p = provider(row), health = sourceOf(sources, p), on = placed(row);
      out.push(finish({
        observationPost: true, id: row.id, globe_id: row.id, kind: KIND[p] || 'event', type: TYPE, author: AUTHOR, icon: iconFor(row),
        title: titleFor(row), facts: factsFor(row),
        source: { label: line(row.source && row.source.label, 120) || line(health && health.label, 120) || p.toUpperCase(), url: https(row.source && row.source.url) },
        coverage: health ? health.coverage : '', status: health ? health.status : (row.stale === true ? 'stale' : 'available'), reason: health ? health.reason : null,
        stamp: stamp(row, now), significant: significance(row), lat: on ? row.lat : null, lon: on ? row.lon : null
      }));
    }
    const layers = detail.layers && typeof detail.layers === 'object' ? detail.layers : {};
    const fires = layers.fires;
    /* thousands of detections are never thousands of posts: one post per 1-degree area that reported radiative power */
    if (fires && typeof fires === 'object' && Array.isArray(fires.cells)) {
      for (const c of fires.cells.slice(0, 10)) {
        if (!Array.isArray(c) || c.length < 6) continue;
        const west = num(c[0]), south = num(c[1]), detections = num(c[2]), sum = num(c[3]), peak = num(c[4]), latest = iso(c[5]);
        if (west === null || south === null || detections === null || sum === null || sum <= 0) continue;
        const id = 'firecell:' + west + ':' + south;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(finish({
          observationPost: true, id, globe_id: 'cell:' + west + ':' + south, kind: 'fire_cell', type: TYPE, author: AUTHOR, icon: 'fire',
          title: 'Fire detections · 1° area at ' + south + '°, ' + west + '° (south-west corner)',
          facts: [{ label: 'Detections', value: String(detections) }, { label: 'Summed radiative power', value: sum + ' MW' }, { label: 'Peak radiative power', value: peak === null ? 'not reported' : peak + ' MW' },
            { label: 'Latest overpass', value: latest ? localTime(latest) + ' (acquired)' : 'not reported' }, { label: 'Sensor', value: 'VIIRS NOAA-20/21' }],
          source: { label: line(fires.label, 120) || 'NASA FIRMS', url: https(fires.url) },
          coverage: fires.coverage, status: fires.status, reason: fires.reason,
          stamp: stamp({ observed_at: latest, fetched_at: fires.fetched_at }, now), significant: significanceOfDigest('fire_cell', { frp_sum_mw: sum }), lat: south, lon: west
        }));
      }
    }
    const rims = layers.perimeters;
    if (rims && typeof rims === 'object' && Array.isArray(rims.top)) {
      for (const r of rims.top.slice(0, 10)) {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
        seen.add(r.id);
        const acres = num(r.gis_acres), captured = iso(r.polygon_captured_at), edited = iso(r.last_edited_at), found = iso(r.discovered_at), on = placed(r);
        out.push(finish({
          observationPost: true, id: r.id, globe_id: r.id, kind: 'perimeter', type: TYPE, author: AUTHOR, icon: 'fire',
          title: line((line(r.name, 120) || 'Unnamed') + ' fire perimeter', 160),
          facts: [{ label: 'GIS acres', value: acres === null ? 'not supplied' : acres.toLocaleString() }, { label: 'Captured', value: captured ? localTime(captured) : 'not supplied' },
            { label: 'Last edited', value: edited ? localTime(edited) : 'not supplied' }, { label: 'Discovered', value: found ? localTime(found) : 'not supplied' }],
          source: { label: line(rims.label, 120) || 'NIFC WFIGS', url: https(rims.url) },
          coverage: rims.coverage, status: rims.status, reason: rims.reason,
          stamp: stamp({ observed_at: captured, fetched_at: rims.fetched_at }, now), significant: significanceOfDigest('perimeter', { gis_acres: acres }), lat: on ? r.lat : null, lon: on ? r.lon : null
        }));
      }
    }
    return out;
  }

  /* ---------- the Equity Uprise tab: one list by time ---------- */
  /* missions by created_at, observations by their stamp's sort_key, newest first; the undated after the dated, in the order given
     (missions before observations); every id once; sliced to the page */
  function interleaveByTime(missions, observations, opts) {
    const size = opts && opts.pageSize > 0 ? Math.floor(opts.pageSize) : Infinity;
    const seen = new Set(), rows = [];
    const push = (item, key, at) => { if (!item || !key || seen.has(key)) return; seen.add(key); rows.push({ item, i: rows.length, t: Date.parse(at) }); };
    (Array.isArray(missions) ? missions : []).forEach((m) => push(m, m && m.id ? 'm:' + m.id : '', m && m.created_at));
    (Array.isArray(observations) ? observations : []).forEach((o) => push(o, o && o.id ? 'o:' + o.id : '', o && o.sort_key));
    rows.sort((a, b) => {
      const at = Number.isFinite(a.t), bt = Number.isFinite(b.t);
      if (at && bt && a.t !== b.t) return b.t - a.t;
      if (at !== bt) return at ? -1 : 1;
      return a.i - b.i;
    });
    return rows.slice(0, size).map((r) => r.item);
  }

  /* ---------- Global: a low ratio ---------- */
  /* one significant observation after every `every` other items, each once, in the order given; when the other items run out the
     observations stop too (a low ratio means at most one per six others: a short feed is never padded with observations) */
  function withObservations(others, observations, opts) {
    const every = opts && opts.every > 0 ? Math.floor(opts.every) : EVERY_OBS;
    const list = Array.isArray(others) ? others : [], seen = new Set(), pool = [], out = [];
    (Array.isArray(observations) ? observations : []).forEach((o) => { if (o && o.id && o.significant === true && !seen.has(o.id)) { seen.add(o.id); pool.push(o); } });
    let at = 0;
    list.forEach((item, k) => { out.push(item); if ((k + 1) % every === 0 && at < pool.length) out.push(pool[at++]); });
    return out;
  }

  return { EVERY_OBS, AUTHOR, TYPE, ICONS, significance, significanceOfDigest, agoLabel, stamp, iconFor, titleFor, factsFor, contentHash, observationPosts, interleaveByTime, withObservations };
});
