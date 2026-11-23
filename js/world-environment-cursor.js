/* ONE TIME CURSOR FOR THE MAP AND THE FEED (event timeline slice S6, 2026-11-19; owner direction 2026-11-19: "Share selection and
   the time cursor across the map and feed; scrub without camera jumps"; the record is docs/control-plane/EUP-EVENT-TIMELINE.md).

   In the Equity Uprise tab, under the feed's row, one range control steps through the environmental events' own recorded times,
   oldest to newest; its newest end is Live (every event, and the new ones as they come). Wherever it stands, the tab's observation
   posts and the globe's events (js/environment-layers.js: quake discs, dots, glyphs and labels) show the same events: those recorded
   at or before the cursor. An event with no recorded time of its own is always shown, on both. Fire areas and fire perimeters are
   the latest readings of their layers, not events in time: they stay, as their layers stay on the globe.
     - Keys step from event to event (the range's own arrows), Home is the oldest event, End and the Live button are Live.
     - A scrub never moves the camera: the globe is told { at, seq, input:true } and only ever sets `show`; the visitor's hand on the
       cursor stops a tour, a replay or a push where it is (decision D15 as clarified, default adopted pending Matthew's
       confirmation).
     - The replay is the cursor's playback: each quake it reaches moves the cursor (hu:environment-time-state from the globe), taken
       unless the visitor has moved the cursor since the globe last heard from the page (its `ack` must be this page's `seq`).
     - A chosen event is never hidden: choosing one recorded after the cursor (a deep link, Show on globe, a row) moves the cursor up
       to it.
     - The address carries the time beside the event: ?feed=equity&event=<id>&t=<ISO time>, written in place (no history entry for a
       scrub); Back and Forward read it again. Live has no t.
   PURE PARTS (node --test scripts/test/world-environment-cursor.test.mjs): timeOf, marksOf, effectiveAt, visibleAt, filterAt,
   positionOf, atOfPosition, stepAt, timeFromSearch, searchWithTime, describe. THE PAGE'S PART (createCursor, started in the browser).
   Nothing here is stored, logged or sent anywhere but to the World's own globe frame. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory();
  if (node) module.exports = api;
  else {
    root.MCC_ENVIRONMENT_CURSOR = api;
    if (root.document && typeof root.addEventListener === 'function') api.start(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PARAM = 't';
  const ADDRESS_MS = 250;
  /* the latest readings of a layer (a 1-degree fire area, a fire perimeter): not events in time, never hidden by the cursor */
  const LATEST = Object.freeze(['fire_cell', 'perimeter']);

  /* ---------- pure ---------- */
  /* a post's own recorded time in ms, or null: a retrieval time standing in for a missing event time is not one */
  function timeOf(post) {
    if (!post || typeof post !== 'object' || LATEST.includes(post.kind)) return null;
    const s = post.stamp;
    if (!s || s.kind !== 'recorded' || typeof s.iso !== 'string' || s.iso.length > 40) return null;
    const t = Date.parse(s.iso);
    return Number.isFinite(t) ? t : null;
  }
  /* the marks: every distinct recorded time, oldest first */
  function marksOf(posts) {
    const set = new Set();
    for (const p of Array.isArray(posts) ? posts : []) { const t = timeOf(p); if (t !== null) set.add(t); }
    return [...set].sort((a, b) => a - b);
  }
  /* the cursor in effect for a wanted time: Live (null) at or past the newest event, the oldest event for a time before every one,
     else the wanted time itself; with no marks yet a wanted time waits as it is */
  function effectiveAt(marks, want) {
    if (want === null || want === undefined || !Number.isFinite(want)) return null;
    const m = Array.isArray(marks) ? marks : [];
    if (!m.length) return want;
    if (want >= m[m.length - 1]) return null;
    if (want < m[0]) return m[0];
    return want;
  }
  const visibleAt = (post, at) => at === null || at === undefined || timeOf(post) === null || timeOf(post) <= at;
  const filterAt = (posts, at) => (Array.isArray(posts) ? posts : []).filter((p) => visibleAt(p, at));
  /* the range's value for a cursor: the newest mark at Live, else the last mark at or before it */
  function positionOf(marks, at) {
    const m = Array.isArray(marks) ? marks : [];
    if (!m.length) return 0;
    if (at === null || at === undefined) return m.length - 1;
    let k = 0;
    for (let i = 0; i < m.length; i++) if (m[i] <= at) k = i;
    return k;
  }
  /* the cursor a value of the range stands for: the newest mark is Live */
  function atOfPosition(marks, value) {
    const m = Array.isArray(marks) ? marks : [];
    const v = Math.round(Number(value));
    if (!m.length || !Number.isFinite(v) || v >= m.length - 1) return null;
    return m[Math.max(0, v)];
  }
  /* one step from event to event (a key, or the e2e's ten scrub steps) */
  const stepAt = (marks, at, delta) => atOfPosition(marks, Math.max(0, Math.min((Array.isArray(marks) ? marks.length : 1) - 1, positionOf(marks, at) + (delta | 0))));
  /* the address */
  function timeFromSearch(search) {
    try {
      const v = new URLSearchParams(search || '').get(PARAM) || '';
      if (!v || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    } catch (e) { return null; }
  }
  /* the same address with this time (or none at Live): every other parameter kept in its order; a time names the tab */
  function searchWithTime(search, at) {
    let q;
    try { q = new URLSearchParams(search || ''); } catch (e) { q = new URLSearchParams(); }
    q.delete(PARAM);
    if (at !== null && at !== undefined && Number.isFinite(at)) {
      if (q.get('feed') !== 'equity') { q.delete('feed'); q.append('feed', 'equity'); }
      q.append(PARAM, new Date(at).toISOString());
    }
    const s = q.toString().replace(/event=([a-z]+)%3A/, 'event=$1:').replace(new RegExp('(^|&)' + PARAM + '=([^&]*)'), (m, a, v) => a + PARAM + '=' + decodeURIComponent(v));
    return s ? '?' + s : '';
  }
  const localTime = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const shortTime = (t, now) => {
    const d = new Date(t), n = new Date(now);
    const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return same ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  /* the words: what the control shows and what it tells a screen reader */
  function describe(posts, at, now) {
    const dated = (Array.isArray(posts) ? posts : []).filter((p) => timeOf(p) !== null);
    const shown = dated.filter((p) => visibleAt(p, at)).length, total = dated.length, events = total === 1 ? 'event' : 'events';
    if (at === null || at === undefined) return { live: true, short: 'Live', text: 'Live: all ' + total + ' ' + events + ' shown', shown, total };
    return { live: false, short: shortTime(at, now === undefined ? Date.now() : now), text: 'Up to ' + localTime(at) + ': ' + shown + ' of ' + total + ' ' + events + ' shown', shown, total };
  }

  /* ---------- the page's part ---------- */
  function createCursor(w, opts) {
    const o = opts || {}, clock = o.now || (() => Date.now());
    const st = { want: timeFromSearch(w.location && w.location.search), at: null, marks: [], posts: [], seq: 0, frameAck: 0 };
    st.at = effectiveAt(st.marks, st.want);
    let hooks = {}, host = null, range = null, value = null, live = null, addressTimer = 0, sentAt;
    const frameWindow = () => { try { const f = w.document.getElementById('mnWorldFrame'); return f ? f.contentWindow : null; } catch (e) { return null; } };
    const iso = (t) => (t === null ? null : new Date(t).toISOString());
    /* the globe hears the cursor in effect: on the visitor's input (which stops what flies there), on a change the page made (a
       chosen event, new marks), and again whenever it says it is ready */
    function tellFrame(input, force) {
      if (!input && !force && sentAt === st.at) return;
      sentAt = st.at;
      const msg = { type: 'hu:environment-time', at: iso(st.at), seq: st.seq, input: input === true };
      try { const fw = frameWindow(); if (fw) fw.postMessage(msg, w.location.origin); } catch (e) {}
    }
    function writeAddress() {
      if (!w.history || !w.location) return;
      w.clearTimeout(addressTimer);
      addressTimer = w.setTimeout(() => {
        const href = w.location.pathname + searchWithTime(w.location.search, st.at) + (w.location.hash || '');
        try { w.history.replaceState(w.history.state || null, '', href); } catch (e) {}
      }, ADDRESS_MS);
    }
    /* the control: built once into #mnTimeCursor, its attributes kept current (the feed below is drawn again; the control is not, so
       a keyboard on it keeps its focus through every step) */
    function build() {
      if (host || !w.document) return;
      host = w.document.getElementById('mnTimeCursor');
      if (!host) return;
      host.innerHTML = '<label class="mn__time-label" for="mnTimeRange">Time</label>' +
        '<input class="mn__time-range" id="mnTimeRange" type="range" min="0" max="0" step="1" value="0">' +
        '<output class="mn__time-value" id="mnTimeValue" for="mnTimeRange"></output>' +
        '<button class="mn__time-live" id="mnTimeLive" type="button" aria-pressed="true">Live</button>';
      range = host.querySelector('#mnTimeRange'); value = host.querySelector('#mnTimeValue'); live = host.querySelector('#mnTimeLive');
      range.addEventListener('input', () => set(atOfPosition(st.marks, range.value), { input: true }));
      live.addEventListener('click', () => set(null, { input: true }));
    }
    function paint() {
      build();
      if (!host) return;
      const m = st.marks, d = describe(st.posts, st.at, clock());
      host.hidden = m.length < 2;
      host.setAttribute('data-at', st.at === null ? 'live' : iso(st.at));
      range.max = String(Math.max(0, m.length - 1));
      const pos = String(positionOf(m, st.at));
      if (range.value !== pos) range.value = pos;
      range.setAttribute('aria-valuetext', d.text);
      value.textContent = d.short;
      value.setAttribute('aria-hidden', 'true');
      live.setAttribute('aria-pressed', String(d.live));
    }
    /* the cursor moves: by the visitor (input), by a chosen event, by the replay, or by the address */
    function set(want, how) {
      const h = how || {};
      if (h.input === true) st.seq += 1;
      st.want = want === null || want === undefined || !Number.isFinite(want) ? null : want;
      const before = st.at;
      st.at = effectiveAt(st.marks, st.want);
      paint();
      if (h.input === true) tellFrame(true);
      else if (h.fromFrame !== true) tellFrame(false);
      else sentAt = st.at;
      if (h.address !== false) writeAddress();
      if (before !== st.at || h.input === true) { try { if (hooks.render) hooks.render(); } catch (e) {} }
      return st.at;
    }
    /* the tab's observations, every one (before the search narrows them): the marks follow them, and the list shown is the cursor's */
    function sync(posts) {
      st.posts = Array.isArray(posts) ? posts : [];
      const marks = marksOf(st.posts);
      if (marks.length !== st.marks.length || marks.some((t, i) => t !== st.marks[i])) {
        st.marks = marks;
        const before = st.at;
        st.at = effectiveAt(st.marks, st.want);
        if (before !== st.at) tellFrame(false);
      }
      paint();
      return filterAt(st.posts, st.at);
    }
    /* a chosen event is never hidden: one recorded after the cursor moves the cursor up to it */
    function reveal(post) {
      const t = timeOf(post);
      if (st.at === null || t === null || t <= st.at) return false;
      set(t, { input: false });
      return true;
    }
    function onFrame(ev) {
      let frame = null;
      try { frame = w.document.getElementById('mnWorldFrame'); } catch (e) { frame = null; }
      if (!frame || !ev || ev.source !== frame.contentWindow || ev.origin !== (w.location && w.location.origin)) return;
      const d = ev.data || {};
      if (d.type === 'hu:globe-ready') { tellFrame(false, true); return; }
      if (d.type !== 'hu:environment-time-state') return;
      /* the globe moved the cursor (the replay): taken only when the globe had heard the page's latest input */
      if (!Number.isSafeInteger(d.ack) || d.ack !== st.seq) return;
      const at = d.at === null ? null : typeof d.at === 'string' && d.at.length <= 40 && Number.isFinite(Date.parse(d.at)) ? Date.parse(d.at) : undefined;
      if (at === undefined || at === st.at) return;
      set(at, { fromFrame: true });
    }
    function onPop() {
      const want = timeFromSearch(w.location && w.location.search);
      if (want === st.want) return;
      set(want, { input: true, address: false });
    }
    return {
      attach(h) { hooks = h && typeof h === 'object' ? h : {}; },
      listen() {
        w.addEventListener('message', onFrame);
        w.addEventListener('popstate', onPop);
      },
      sync, set, reveal,
      live: () => set(null, { input: true }),
      step: (delta) => set(stepAt(st.marks, st.at, delta), { input: true }),
      at: () => st.at,
      state: () => ({ at: iso(st.at), want: iso(st.want), seq: st.seq, marks: st.marks.map(iso), position: positionOf(st.marks, st.at), shown: filterAt(st.posts, st.at).map((p) => p.id) })
    };
  }
  let cursor = null;
  function start(w) {
    if (cursor) return cursor;
    cursor = createCursor(w);
    cursor.listen();
    return cursor;
  }
  const live = (name) => (...args) => (cursor ? cursor[name](...args) : undefined);

  return {
    PARAM, LATEST,
    timeOf, marksOf, effectiveAt, visibleAt, filterAt, positionOf, atOfPosition, stepAt, timeFromSearch, searchWithTime, describe, createCursor, start,
    attach: live('attach'), sync: (posts) => (cursor ? cursor.sync(posts) : posts), set: live('set'), reveal: (post) => !!(cursor && cursor.reveal(post)),
    step: live('step'), at: () => (cursor ? cursor.at() : null), state: live('state')
  };
});
