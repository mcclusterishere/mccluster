/* THE ENVIRONMENTAL TIMELINE IN THE EQUITY UPRISE TAB (event timeline slice S4, 2026-11-19; owner direction 2026-11-19: a
   signed-out environmental event timeline tied to the globe, "one stable canonical event ID and revision drive the post, globe
   object, selection and deep link"; the record is docs/control-plane/EUP-EVENT-TIMELINE.md).

   The public timeline comes from the event store through GET /v1/world/environment/events (a page, newest observation first)
   and /events/:id (one event for a deep link, by its canonical id or any alias). Its USGS posts carry the store's canonical id
   and revision, the observed, USGS-updated and retrieved times, automatic or reviewed, an official correction as old -> new, and
   a withdrawn event as a tombstone with no globe object. The other providers stay the live observation posts the page builds
   from the panel's feed (js/world-environment-posts.js) until their own store ingests exist. One list, newest first, beside the
   missions' own list (decision D8, default adopted pending Matthew's confirmation; js/mnet.js paintMissionFeed).

   PURE PARTS (node --test scripts/test/world-environment-timeline.test.mjs): timelinePost, correctionLine, mergeTimeline,
   eventIdFromSearch, searchWithEvent. THE PAGE'S PART (createController, started in the browser): it reads the timeline only
   after the panel's feed answered (so a refusing gate is never asked again: js/environment-layers-client.js holds the refusal)
   and only while the tab is the scope or a deep link wants an event, at most once a minute (the Worker keeps a page a minute);
   a visitor's choice of an event writes ?feed=equity&event=<id> as one history entry, and Back and Forward choose again from
   the address. Nothing here is stored, logged or sent anywhere else; reads carry no credential. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const POSTS = node ? require('./world-environment-posts.js') : root.MCC_ENVIRONMENT_POSTS;
  const api = factory(POSTS || null);
  if (node) module.exports = api;
  else {
    root.MCC_ENVIRONMENT_TIMELINE = api;
    if (root.document && typeof root.addEventListener === 'function') api.start(root);
  }
})(typeof self !== 'undefined' ? self : this, function (POSTS) {
  'use strict';
  const EVENT_ID = /^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
  const API = 'https://api.mccluster.org/v1/world/environment/events';
  const PAGE = 20, FRESH_MS = 60000, TIMEOUT_MS = 15000;
  const AUTHOR = (POSTS && POSTS.AUTHOR) || 'Environmental desk', TYPE = (POSTS && POSTS.TYPE) || 'Environmental observation';
  /* the providers whose events the store holds (S1, S3: USGS); the others stay the panel's live posts until their ingests exist */
  const OWNED = Object.freeze(['usgs']);
  const LABELS = Object.freeze({ usgs: 'USGS', nws: 'NOAA NWS', nhc: 'NOAA NHC', eonet: 'NASA EONET', firms: 'NASA FIRMS', wfigs: 'NIFC WFIGS', coops: 'NOAA CO-OPS' });
  const COVERAGE = 'Earthquakes the timeline publishes: by default M4.5 and larger, and any with a PAGER alert, a tsunami flag or a USGS significance above 600';
  const NOTES = Object.freeze({
    gone: 'That environmental event is not on the timeline.',
    held: 'That environmental event is not available right now.',
    failed: 'That environmental event could not be loaded right now.'
  });

  const line = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const one = (n) => String(Math.round(n * 10) / 10);
  /* a magnitude as USGS writes it: one decimal (5.0, not 5) */
  const magText = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const localTime = (at) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const localDate = (at) => new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' });
  function https(v) {
    if (typeof v !== 'string' || !v.trim()) return '';
    try { const u = new URL(v.trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  const providerOf = (id) => String(id).split(':')[0];

  /* ---------- an official correction in words: old -> new, field by field ---------- */
  const said = (v) => (v === null || v === undefined || v === '' ? 'none' : String(v));
  const review = (v) => (v === 'reviewed' || v === 'automatic' || v === 'deleted' ? v : 'none');
  function changeWords(changes) {
    const c = changes && typeof changes === 'object' ? changes : {};
    const out = [];
    const m = (v) => (num(v) !== null ? magText(v) : said(v));
    if (c.magnitude) out.push('magnitude ' + m(c.magnitude.from) + ' → ' + m(c.magnitude.to));
    if (c.magnitude_type) out.push('magnitude type ' + said(c.magnitude_type.from) + ' → ' + said(c.magnitude_type.to));
    if (c.depth_km) out.push('depth ' + said(c.depth_km.from) + ' → ' + said(c.depth_km.to) + ' km');
    if (c.location) out.push(num(c.location.km) !== null ? 'location moved ' + one(c.location.km) + ' km' : 'location changed');
    if (c.observed_at) {
      const a = iso(c.observed_at.from), b = iso(c.observed_at.to);
      out.push('origin time ' + (a ? localTime(a) : 'none') + ' → ' + (b ? localTime(b) : 'none'));
    }
    if (c.status) out.push('review ' + review(c.status.from) + ' → ' + review(c.status.to));
    if (c.tsunami) out.push('tsunami flag ' + (c.tsunami.from === true ? 'on' : 'off') + ' → ' + (c.tsunami.to === true ? 'on' : 'off'));
    if (c.alert) out.push('PAGER alert ' + said(c.alert.from) + ' → ' + said(c.alert.to));
    return out;
  }
  /* "Corrected by USGS: magnitude 6.6 → 6.3; location moved 3 km"; '' when the revision is not a correction */
  function correctionLine(correction, label) {
    const who = label || 'USGS';
    const lead = { source_revised: 'Corrected by ' + who, source_restored: 'Restored by ' + who, owner_rollback: 'Restored to an earlier ' + who + ' reading' };
    if (!correction || typeof correction !== 'object' || !lead[correction.cause]) return '';
    const words = changeWords(correction.changes);
    return words.length ? lead[correction.cause] + ': ' + words.join('; ') : '';
  }
  /* the deep link's correction history (newest first, decision D12): the earlier corrections, each with its revision, the one the
     post already shows left out; a withdrawal is the tombstone's own line and a restoration says it came back */
  function earlierLines(history, current, label) {
    if (!Array.isArray(history)) return [];
    const now = current && Number.isSafeInteger(current.revision) ? current.revision : null;
    return history.filter((r) => r && typeof r === 'object' && r.revision !== now && r.cause !== 'source_deleted').slice(0, 5)
      .map((r) => { const c = correctionLine(r, label); return c && Number.isSafeInteger(r.revision) ? 'Revision ' + r.revision + ': ' + c : c; }).filter(Boolean);
  }

  /* ---------- one post from one public event (the Worker's whitelisted shape) ---------- */
  function hashOf(parts) {
    const s = JSON.stringify(parts);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  const postHash = (p) => hashOf([p.title, p.facts, p.revision, p.state, p.times, p.correction, p.earlier, p.tombstone, p.review, p.source.url, p.lat, p.lon]);
  function timelinePost(e, now) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !EVENT_ID.test(e.id)) return null;
    const tomb = e.state === 'withdrawn_by_source' || e.state === 'retracted';
    if (!tomb && e.state !== 'published') return null;
    const provider = providerOf(e.id), label = LABELS[provider] || provider.toUpperCase();
    const mag = num(e.magnitude), place = line(e.place, 180) || line(e.title, 180) || 'Environmental event';
    const title = line(provider === 'usgs' && mag !== null ? 'M' + magText(mag) + ' · ' + place : place, 160);
    const facts = [];
    if (mag !== null) facts.push({ label: 'Magnitude', value: magText(mag) + (line(e.magnitude_type, 12) ? ' ' + line(e.magnitude_type, 12) : '') });
    if (!tomb && num(e.depth_km) !== null) facts.push({ label: 'Depth', value: e.depth_km + ' km' });
    if (!tomb && e.tsunami === true) facts.push({ label: 'USGS tsunami flag', value: 'Flagged by source; consult official warnings' });
    if (!tomb && line(e.alert, 10)) facts.push({ label: 'PAGER alert', value: line(e.alert, 10) });
    const src = e.source && typeof e.source === 'object' ? e.source : {};
    const observed = iso(e.observed_at), updated = tomb ? null : iso(src.updated_at), fetched = tomb ? null : iso(src.fetched_at);
    const revision = Number.isSafeInteger(e.revision) && e.revision >= 1 ? e.revision : null;
    const stamp = POSTS && POSTS.stamp ? POSTS.stamp({ observed_at: observed }, now) : { kind: observed ? 'recorded' : 'none', iso: observed, text: observed ? localTime(observed) : 'Time not supplied by provider', sort_key: observed || '' };
    if (stamp.kind === 'recorded') stamp.text = 'Observed ' + stamp.local + ' · ' + stamp.ago;
    const times = [revision && revision > 1 ? 'Revision ' + revision : '', updated ? label + ' updated ' + localTime(updated) : '', fetched ? 'Retrieved ' + localTime(fetched) : ''].filter(Boolean).join(' · ');
    const withdrawnAt = iso(e.state === 'retracted' ? e.retracted_at : e.withdrawn_at);
    const tombstone = tomb ? (e.state === 'withdrawn_by_source' ? 'Withdrawn by ' + label : 'Withdrawn from the timeline') + (withdrawnAt ? ' on ' + localDate(withdrawnAt) : '') : '';
    const placed = !tomb && num(e.lat) !== null && num(e.lon) !== null && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180;
    const post = {
      observationPost: true, timeline: true, id: e.id, globe_id: e.id, revision, state: e.state, provider,
      kind: provider === 'usgs' ? 'quake' : 'event', type: TYPE, author: AUTHOR, icon: provider === 'usgs' ? 'quake' : 'other',
      title, facts, source: { label, url: https(src.url) }, coverage: COVERAGE, status: 'available', reason: null, stamp,
      review: tomb ? '' : e.review_status === 'reviewed' ? 'Reviewed by ' + label : e.review_status === 'automatic' ? 'Automatic, not yet reviewed by ' + label : '',
      times, correction: tomb ? '' : correctionLine(e.correction, label), earlier: earlierLines(e.history, tomb ? null : e.correction, label), tombstone,
      significant: provider === 'usgs' && mag !== null && mag >= 5.5, lat: placed ? e.lat : null, lon: placed ? e.lon : null
    };
    post.sort_key = stamp.sort_key || '';
    post.hash = postHash(post);
    return post;
  }

  /* ---------- one list for the tab ----------
     The timeline's posts (the store's pages loaded so far, plus a deep-linked event) and the live posts of the providers the
     store does not hold yet; while the store has older pages to give, live posts older than the oldest loaded timeline post wait
     (so what shows is always a true prefix of the timeline). Newest first, the undated last; each id once. */
  const timeOf = (p) => { const t = Date.parse(p && p.sort_key); return Number.isFinite(t) ? t : null; };
  function mergeTimeline(timelinePosts, livePosts, opts) {
    const o = opts || {};
    const owned = new Set(Array.isArray(o.owned) ? o.owned : OWNED);
    const seen = new Set(), rows = [];
    const add = (p, extra) => { if (!p || typeof p.id !== 'string' || seen.has(p.id)) return; seen.add(p.id); rows.push({ p, i: rows.length, t: timeOf(p), extra: !!extra }); };
    const tl = (Array.isArray(timelinePosts) ? timelinePosts : []).filter(Boolean);
    tl.forEach((p) => add(p, false));
    (Array.isArray(o.extra) ? o.extra : []).forEach((p) => add(p, true));
    let floor = null;
    if (o.hasMore) for (const p of tl) { const t = timeOf(p); if (t !== null && (floor === null || t < floor)) floor = t; }
    (Array.isArray(livePosts) ? livePosts : []).forEach((p) => {
      if (!p || typeof p.id !== 'string' || owned.has(providerOf(p.id))) return;
      if (o.hasMore) { const t = timeOf(p); if (t === null || (floor !== null && t < floor)) return; }
      add(p, false);
    });
    rows.sort((a, b) => {
      if (a.t !== null && b.t !== null && a.t !== b.t) return b.t - a.t;
      if ((a.t !== null) !== (b.t !== null)) return a.t !== null ? -1 : 1;
      return a.i - b.i;
    });
    return rows.map((r) => r.p);
  }

  /* ---------- the address ---------- */
  function eventIdFromSearch(search) {
    try { const id = new URLSearchParams(search || '').get('event') || ''; return EVENT_ID.test(id) ? id : ''; } catch (e) { return ''; }
  }
  /* the same address with the tab and this event (or none): every other parameter kept in its order, then feed and event */
  function searchWithEvent(search, id) {
    let q;
    try { q = new URLSearchParams(search || ''); } catch (e) { q = new URLSearchParams(); }
    q.delete('feed'); q.delete('event');
    q.append('feed', 'equity');
    if (typeof id === 'string' && EVENT_ID.test(id)) q.append('event', id);
    const s = q.toString().replace(/event=([a-z]+)%3A/, 'event=$1:');
    return s ? '?' + s : '';
  }

  /* ---------- the page's part ---------- */
  function createController(w, opts) {
    const o = opts || {}, api = o.api || API, clock = o.now || (() => Date.now());
    const st = { gate: 'unknown', status: 'idle', posts: [], next: null, loadedAt: 0, failedAt: 0, busy: false, extra: {}, selected: '', selectedRevision: null, note: '', wanted: eventIdFromSearch(w.location && w.location.search) };
    let hooks = {};
    const scope = () => { try { return w.MCC_FEED_SCOPE && w.MCC_FEED_SCOPE.get ? w.MCC_FEED_SCOPE.get() : ''; } catch (e) { return ''; } };
    const changed = () => { try { if (hooks.render) hooks.render(); } catch (e) {} };
    const find = (id) => st.posts.find((p) => p.id === id) || st.extra[id] || null;
    /* event timeline slice S6: a live post of the page (any provider, by its own id or its globe id), for the globe's selection */
    const livePost = (id) => { try { return hooks.livePost ? hooks.livePost(id) || null : null; } catch (e) { return null; } };
    const owned = (id) => typeof id === 'string' && EVENT_ID.test(id) && OWNED.includes(providerOf(id));
    const revisionOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
    /* a chosen event is never hidden by the time cursor (js/world-environment-cursor.js): one recorded after it moves it up to it */
    const reveal = (p) => { const c = w.MCC_ENVIRONMENT_CURSOR; if (p && c && typeof c.reveal === 'function') { try { c.reveal(p); } catch (e) {} } };
    /* the globe's pick: its post comes into view in the feed's own scrolling column (never the window, so the globe stays where it
       is) and nothing takes the focus; after the panel's own answer to the same message, which scrolls its card */
    function keepInView(id) {
      if (!/^[A-Za-z0-9:_./-]{1,200}$/.test(id) || !w.document || typeof w.setTimeout !== 'function') return;
      w.setTimeout(() => {
        let el = null;
        try { el = w.document.querySelector('#mnFeed [data-observation-post="' + id + '"]'); } catch (e) { el = null; }
        if (!el || typeof el.getBoundingClientRect !== 'function') return;
        let box = el.parentElement;
        while (box && box !== w.document.body) {
          const s = typeof w.getComputedStyle === 'function' ? w.getComputedStyle(box) : null;
          if (s && /(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight) break;
          box = box.parentElement;
        }
        if (!box || box === w.document.body) return;
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        const dy = r.top < b.top + 8 ? r.top - b.top - 8 : r.bottom > b.bottom - 8 ? Math.min(r.top - b.top - 8, r.bottom - b.bottom + 8) : 0;
        if (!dy) return;
        const still = !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
        if (typeof box.scrollBy === 'function') box.scrollBy({ top: dy, behavior: still ? 'auto' : 'smooth' }); else box.scrollTop += dy;
      }, 0);
    }
    async function getJson(url) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? w.setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
      try {
        const r = await w.fetch(url, { credentials: 'omit', headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
        let body = null;
        try { body = await r.json(); } catch (e) { body = null; }
        return { status: r.status, body };
      } catch (e) { return { status: 0, body: null }; } finally { if (timer) w.clearTimeout(timer); }
    }
    const pageOf = (r) => (r.status === 200 && r.body && Array.isArray(r.body.events) ? r.body : null);
    function take(events) {
      const t = clock();
      for (const e of events) { const p = timelinePost(e, t); if (p && !st.posts.some((x) => x.id === p.id)) { st.posts.push(p); delete st.extra[p.id]; } }
    }
    function writeAddress(id, push) {
      if (!w.history || !w.location) return;
      const href = w.location.pathname + searchWithEvent(w.location.search, id) + (w.location.hash || '');
      try {
        if (push) w.history.pushState(Object.assign({}, w.history.state || {}, { mccEvent: id }), '', href);
        else w.history.replaceState(w.history.state || null, '', href);
      } catch (e) {}
    }
    /* the globe is pointed at an event the address named; a frame that was not up yet when it was told (a deep link lands before
       Cesium has booted) is told again when it says it is ready, until it reports that event selected or the visitor's own pick */
    let focusWanted = '';
    function focus(p) {
      if (!p || p.lat === null || p.lon === null || !hooks.focus) return;
      focusWanted = p.globe_id;
      try { hooks.focus(p.globe_id); } catch (e) {}
    }
    function onFrame(ev) {
      let frame = null;
      try { frame = w.document.getElementById('mnWorldFrame'); } catch (e) { frame = null; }
      if (!frame || !ev || ev.source !== frame.contentWindow || ev.origin !== (w.location && w.location.origin)) return;
      const d = ev.data || {};
      if (d.type === 'hu:environment-selected') {
        if (d.id === focusWanted || d.via === 'pick') focusWanted = '';
        /* ONE SELECTION FOR THE GLOBE AND THE FEED (event timeline slice S6): what the visitor chose on the globe (a tap) or through it (a
           row, Show on globe, a deep link) marks its post; the tour's and the replay's own arrivals never move the feed */
        if (d.via === 'pick' || d.via === 'focus') fromGlobe(d);
      }
      else if (d.type === 'hu:globe-ready' && focusWanted && scope() === 'equity' && hooks.focus) try { hooks.focus(focusWanted); } catch (e) {}
    }
    function fromGlobe(d) {
      if (typeof d.id !== 'string' || !d.id) return;
      const p = find(d.id) || livePost(d.id);
      if (!p && !owned(d.id)) return;
      const id = p ? p.id : d.id, revision = revisionOf(d.revision) || (p ? revisionOf(p.revision) : null);
      if (st.selected !== id || st.selectedRevision !== revision) select(id, { push: true, revision });
      if (d.via === 'pick') keepInView(id);
    }
    async function load(force) {
      if (st.gate !== 'open' || st.busy) return;
      if (!force && st.status === 'ready' && clock() - st.loadedAt < FRESH_MS) { if (st.wanted) open(st.wanted, { fromAddress: true }); return; }
      /* a failed read is not asked again within the minute: the page keeps the feed's own quakes (the same canonical ids) */
      if (!force && st.status === 'failed' && clock() - st.failedAt < FRESH_MS) { if (st.wanted) open(st.wanted, { fromAddress: true }); return; }
      st.busy = true;
      const r = await getJson(api + '?limit=' + PAGE);
      st.busy = false;
      const page = pageOf(r);
      if (page) { st.posts = []; take(page.events); st.next = typeof page.next_cursor === 'string' ? page.next_cursor : null; st.status = 'ready'; st.loadedAt = clock(); }
      else if (st.status !== 'ready') { st.status = 'failed'; st.failedAt = clock(); }
      changed();
      if (st.wanted) open(st.wanted, { fromAddress: true });
    }
    async function more() {
      if (st.status !== 'ready' || !st.next || st.busy) return;
      st.busy = true;
      const r = await getJson(api + '?limit=' + PAGE + '&cursor=' + encodeURIComponent(st.next));
      st.busy = false;
      const page = pageOf(r);
      if (page) { take(page.events); st.next = typeof page.next_cursor === 'string' ? page.next_cursor : null; }
      changed();
    }
    /* the address named this event (a deep link, Back or Forward): marked and shown on the globe at once when a loaded page holds
       it; the event's own answer follows (an alias or a merge resolved to the canonical id, its correction history) */
    async function open(id, { fromAddress = false } = {}) {
      if (typeof id !== 'string' || !EVENT_ID.test(id)) { st.wanted = ''; st.note = NOTES.gone; changed(); return; }
      if (st.gate !== 'open') { st.wanted = id; return; }
      st.wanted = '';
      const known = find(id);
      if (known) { st.selected = known.id; st.selectedRevision = revisionOf(known.revision); st.note = ''; reveal(known); changed(); focus(known); }
      const r = await getJson(api + '/' + encodeURIComponent(id));
      const p = r.status === 200 && r.body && r.body.event ? timelinePost(r.body.event, clock()) : null;
      if (p) {
        const have = find(p.id);
        /* the page's post of the same revision gains the history the page carries none of; a newer answer replaces it */
        if (have && have.revision === p.revision) { have.earlier = p.earlier; have.hash = postHash(have); }
        else if (have && st.extra[p.id]) st.extra[p.id] = p;
        else if (have) { const i = st.posts.indexOf(have); if (i >= 0) st.posts[i] = p; }
        else st.extra[p.id] = p;
        if (!known) {
          st.selected = p.id; st.selectedRevision = revisionOf(p.revision); st.note = '';
          /* an alias or a merge answers the canonical id: the address says the canonical id, with no new entry */
          if (fromAddress && p.id !== id) writeAddress(p.id, false);
          reveal(p); changed(); focus(p); return;
        }
        changed(); return;
      }
      if (known) return;
      st.note = r.status === 404 ? (r.body && r.body.code === 'not_available' ? NOTES.held : NOTES.gone) : NOTES.failed;
      changed();
    }
    /* a visitor chose this event (Show on globe on a timeline post, or on a live post of a provider the store holds: the same
       canonical id): one history entry, the address names it; one not loaded yet is marked when its page arrives */
    /* event timeline slice S6: one selection, keyed by canonical id and revision, for the store's events and the live posts alike (a
       live post is marked, never written in the address: its id is not the store's); a chosen event the cursor hides is revealed */
    function select(id, opts2) {
      const o2 = opts2 || {};
      const p = find(id) || (owned(id) ? null : livePost(id));
      if (!p && !owned(id)) return false;
      st.selected = p ? p.id : id; st.selectedRevision = revisionOf(o2.revision) || (p ? revisionOf(p.revision) : null); st.note = '';
      if (o2.push && owned(st.selected) && eventIdFromSearch(w.location && w.location.search) !== st.selected) writeAddress(st.selected, true);
      reveal(p);
      changed();
      return true;
    }
    function onFeed(ev) {
      const d = ev && ev.detail;
      if (!d || typeof d !== 'object') return;
      st.gate = d.unavailable === true ? 'refused' : 'open';
      /* the module turned off or became unreachable after the timeline had loaded: what it showed goes with it (the tab's honest
         line stands, as for the feed's own posts) */
      if (st.gate === 'refused' && st.status !== 'idle') {
        st.posts = []; st.extra = {}; st.next = null; st.status = 'idle'; st.loadedAt = 0; st.failedAt = 0; st.selected = ''; st.note = '';
        changed();
        return;
      }
      if (st.gate === 'open' && (scope() === 'equity' || st.wanted)) load(false);
    }
    function onScope() { if (st.gate === 'open' && scope() === 'equity') load(false); }
    function onPop() {
      const id = eventIdFromSearch(w.location && w.location.search);
      if (id === st.selected) return;
      if (!id) { st.selected = ''; changed(); return; }
      open(id, { fromAddress: true });
    }
    return {
      attach(h) { hooks = h && typeof h === 'object' ? h : {}; },
      listen() {
        w.addEventListener('mcc:world-environment-events', onFeed);
        w.addEventListener('mcc:feed-scope', onScope);
        w.addEventListener('popstate', onPop);
        w.addEventListener('message', onFrame);
      },
      /* the tab's one list (mergeTimeline) from the page's live posts */
      merged(live) { return st.status === 'ready' ? mergeTimeline(st.posts, live, { hasMore: !!st.next, extra: Object.values(st.extra) }) : (Array.isArray(live) ? live : []); },
      post: find,
      hasMore: () => st.status === 'ready' && !!st.next,
      more, open, select, load,
      selected: () => st.selected,
      note: () => st.note,
      state: () => ({ gate: st.gate, status: st.status, posts: st.posts.map((p) => [p.id, p.revision, p.state]), next: st.next, extra: Object.keys(st.extra), selected: st.selected, note: st.note, wanted: st.wanted })
    };
  }
  let controller = null;
  function start(w) {
    if (controller) return controller;
    controller = createController(w);
    controller.listen();
    return controller;
  }
  /* the page's calls go to the one controller started for this page */
  const live = (name) => (...args) => (controller ? controller[name](...args) : undefined);

  return {
    EVENT_ID, API, PAGE, FRESH_MS, NOTES, COVERAGE, OWNED,
    changeWords, correctionLine, earlierLines, timelinePost, mergeTimeline, eventIdFromSearch, searchWithEvent, createController, start,
    attach: live('attach'), merged: (list) => (controller ? controller.merged(list) : list), post: live('post'),
    hasMore: () => !!(controller && controller.hasMore()), more: live('more'), open: live('open'), select: live('select'),
    selected: () => (controller ? controller.selected() : ''), note: () => (controller ? controller.note() : ''), state: live('state')
  };
});
