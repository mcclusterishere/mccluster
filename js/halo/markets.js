/* HALO MARKETS: the owner's markets layer on the Halo globe (owner, 2026-11-02: "live financial markets on the globe,
   geographically placed, so when you click a country you can look at its GDP ... the stock market, all the stocks and
   businesses that are registered there ... and news tied to that"). Owner globe only, first.

   Reads only the canonical Worker `mccluster`, owner-gated routes in workers/mccluster/src/intel/world-markets.js:
     GET /v1/intel/markets/exchanges                 every exchange in the reference set, placed at its city, open/closed now
     GET /v1/intel/markets/country/:iso2             GDP (WDI + IMF), the country's exchanges, market news
     GET /v1/intel/markets/country/:iso2/listings    listed securities, paged and searchable, prices where the plan allows
     GET /v1/intel/markets/company/:symbol?mic=      one company's profile, quote and news

   Exchange pins: lit when the regular session is open, dim when closed (the schedule, not an exchange status feed). A tap
   on a pin, or on a country while the layer is on, opens the Markets card: a bottom sheet on a phone, a side panel from
   760px. Every number carries its source and age; a missing key or plan is said in words, never filled with a guess.
   Mounted by js/halo/halo.js (the "Markets" group in World data); nothing is stored anywhere. */
(function () {
  'use strict';

  const OPEN = '#4fdf98', CLOSED = '#7f90a6';
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);

  function create(G, opts) {
    const V = G.viewer(), C = window.Cesium, esc = (s) => G.esc(String(s == null ? '' : s));
    const changed = (opts && opts.changed) || function () {};
    let on = false, state = 'off', reason = '', exchanges = [], fetched = 0, timer = 0, pins = null, labels = null, alive = true;
    let card = null, ui = null, listing = null, company = null, listQ = '', listMic = null, searchTimer = 0;
    /* three independent generations: the pin refresh never invalidates a card, a card load or close invalidates its own
       listings and company reads, and only the newest listings request for the current search and exchange filter paints */
    let pinSeq = 0, cardSeq = 0, listSeq = 0, companySeq = 0;
    let chart = null, finance = null;

    async function ask(path) {
      const t = G.token();
      const r = await fetch(G.api + path, { headers: t ? { accept: 'application/json', authorization: 'Bearer ' + t } : { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const body = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error((body && body.detail && body.detail.code) || 'answered ' + r.status); e.status = r.status; throw e; }
      return body;
    }

    /* ---------- pins ---------- */
    const dotCache = {};
    function dot(color, lit) {
      const k = color + lit; if (dotCache[k]) return dotCache[k];
      const c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d');
      if (lit) { const r = g.createRadialGradient(24, 24, 4, 24, 24, 23); r.addColorStop(0, color + 'cc'); r.addColorStop(1, color + '00'); g.fillStyle = r; g.fillRect(0, 0, 48, 48); }
      g.beginPath(); g.arc(24, 24, lit ? 8 : 6, 0, Math.PI * 2); g.fillStyle = lit ? color : color + '99'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(2,6,16,.9)'; g.stroke();
      return (dotCache[k] = c.toDataURL('image/png'));
    }
    function clearPins() {
      if (!V) return;
      if (pins) { V.scene.primitives.remove(pins); pins = null; }
      if (labels) { V.scene.primitives.remove(labels); labels = null; }
    }
    function drawPins() {
      clearPins();
      if (!V || !on) return;
      pins = V.scene.primitives.add(new C.BillboardCollection());
      labels = V.scene.primitives.add(new C.LabelCollection());
      exchanges.forEach((x) => {
        const open = x.session && x.session.state === 'open', pos = C.Cartesian3.fromDegrees(x.lon, x.lat, 60);
        const id = { marketPick: true, mic: x.mic, country: x.country };
        pins.add({ position: pos, image: dot(open ? OPEN : CLOSED, open), width: open ? 30 : 20, height: open ? 30 : 20, id, scaleByDistance: new C.NearFarScalar(1e5, 1.4, 2e7, 0.8), disableDepthTestDistance: 5e6 });
        labels.add({ position: pos, text: x.short, font: '600 12px Inter, system-ui, sans-serif', fillColor: C.Color.fromCssColorString(open ? '#dffbea' : '#b7c3d3'), outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -16), verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 7e6), id });
      });
      V.scene.requestRender();
    }
    async function load() {
      const my = ++pinSeq;
      try {
        const d = await ask('/v1/intel/markets/exchanges');
        if (!alive || !on || my !== pinSeq) return;
        exchanges = Array.isArray(d && d.exchanges) ? d.exchanges.filter((x) => fin(x.lat) && fin(x.lon)) : [];
        fetched = Date.parse(d.generated_at) || Date.now(); state = 'on'; reason = '';
        drawPins();
      } catch (e) {
        if (!alive || !on) return;
        state = e.status === 401 || e.status === 403 ? 'locked' : 'error'; reason = e.message;
      }
      changed();
    }
    async function set(want) {
      want = !!want;
      if (want === on) return;
      on = want;
      if (on) { state = 'loading'; changed(); window.addEventListener('hu:country', onCountry); await load(); timer = setInterval(() => { if (!document.hidden) { load(); refreshQuote(); } }, 60e3); }
      else { clearInterval(timer); timer = 0; window.removeEventListener('hu:country', onCountry); clearPins(); close(); state = 'off'; reason = ''; changed(); }
    }
    function status() {
      return { state, reason, count: exchanges.length, open: exchanges.filter((x) => x.session && x.session.state === 'open').length, fetched, card: card ? card.country.iso2 : null };
    }

    /* ---------- the card ---------- */
    function onCountry(e) { const c = e && e.detail; if (!on || !c || c.stateOnly || !/^[A-Z]{2}$/.test(c.code || '')) return; openCountry(c.code, c.name); }
    function pick(id) { if (!on || !id || !id.marketPick) return false; if(id.financeCompany){build();ui.root.hidden=false;finance?.setVisible(true);finance?.selectLeadership(id.symbol,id.mic);document.documentElement.setAttribute('data-halo-markets','open');return true;} openCountry(id.country, null, id.mic); return true; }

    function ago(iso) {
      const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return 'age unknown';
      const s = Math.max(0, (Date.now() - t) / 1000);
      return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago';
    }
    function money(v, unit) {
      if (!fin(v)) return '—';
      const a = Math.abs(v), sign = v < 0 ? '-' : '';
      const f = (x, s) => sign + (unit === 'USD' || !unit ? '$' : '') + x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 2 : 1 }) + s + (unit && unit !== 'USD' ? ' ' + unit : '');
      return a >= 1e12 ? f(a / 1e12, ' trn') : a >= 1e9 ? f(a / 1e9, ' bn') : a >= 1e6 ? f(a / 1e6, ' m') : f(a, '');
    }
    const pct = (v) => (fin(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—');
    const price = (v) => (fin(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }) : '—');
    const PRICE_NOTE = { needs_paid_feed: 'Price needs paid feed', needs_key: 'Needs provider key', rate_limited: 'Provider rate limit, try again', no_quote: 'No quote from provider', on_request: 'Tap for price', key_rejected: 'Provider rejected the key', not_covered: 'Not covered by provider', unavailable: 'Price unavailable' };

    function build() {
      if (ui) return ui;
      const root = document.createElement('section');
      root.className = 'hm'; root.id = 'haloMarkets'; root.hidden = true;
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false'); root.setAttribute('aria-labelledby', 'hmTitle');
      root.innerHTML = '<div class="hm__head"><div class="hm__titles"><p class="hm__kicker">Markets</p><h2 id="hmTitle">…</h2><p class="hm__sub" data-sub></p></div>' +
        '<button type="button" class="hm__close" data-close aria-label="Close markets">' + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="hm__body" data-body><section class="hm__sec hm__finance" data-finance></section>' +
        '<section class="hm__sec" aria-labelledby="hmGdp"><h3 id="hmGdp">Economy</h3><div data-gdp></div></section>' +
        '<section class="hm__sec" aria-labelledby="hmEx"><h3 id="hmEx">Exchanges</h3><div data-ex></div></section>' +
        '<section class="hm__sec" aria-labelledby="hmList"><h3 id="hmList">Listed companies</h3><div data-company></div><div data-chart></div>' +
        '<label class="hm__find"><span class="hm__sr">Search listed companies</span><input type="search" data-q autocomplete="off" maxlength="40" placeholder="Search ticker or company"></label>' +
        '<p class="hm__note" data-list-note></p><ul class="hm__rows" data-rows></ul><button type="button" class="hm__more" data-more hidden>Show more</button></section>' +
        '<section class="hm__sec" aria-labelledby="hmNews"><h3 id="hmNews">Market news</h3><div data-news></div></section>' +
        '</div>';
      document.body.appendChild(root);
      if(window.HaloFinance) finance=window.HaloFinance.mount(root.querySelector('[data-finance]'),G);
      const $ = (s) => root.querySelector(s);
      ui = { root, title: $('#hmTitle'), sub: $('[data-sub]'), body: $('[data-body]'), gdp: $('[data-gdp]'), ex: $('[data-ex]'), company: $('[data-company]'), chart: $('[data-chart]'), q: $('[data-q]'), note: $('[data-list-note]'), rows: $('[data-rows]'), more: $('[data-more]'), news: $('[data-news]') };
      $('[data-close]').onclick = close;
      ui.q.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { listQ = ui.q.value.trim(); loadListings(false); }, 300); };
      ui.more.onclick = () => loadListings(true);
      root.addEventListener('click', (e) => {
        const ex = e.target.closest('[data-mic]');
        if (ex) { listMic = listMic === ex.dataset.mic ? null : ex.dataset.mic; paintExchanges(); loadListings(false); return; }
        const row = e.target.closest('[data-symbol]');
        if (row) openCompany(row.dataset.symbol, row.dataset.rowMic);
      });
      root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      return ui;
    }
    function close() {
      if (!ui) return;
      finance?.setVisible(false);
      ui.root.hidden = true; card = null; listing = null; company = null; chart = null; companySeq++; cardSeq++; listSeq++;
      document.documentElement.removeAttribute('data-halo-markets');
      changed();
    }
    async function openCountry(code, name, mic) {
      build();
      const my = ++cardSeq; listSeq++;
      card = { country: { iso2: code, name: name || code } }; listing = null; company = null; chart = null; companySeq++; listQ = ''; listMic = mic || null; ui.q.value = '';
      finance?.setVisible(true);
      ui.root.hidden = false; document.documentElement.setAttribute('data-halo-markets', 'open');
      ui.title.textContent = name || code; ui.sub.textContent = 'Loading…';
      ui.gdp.innerHTML = ui.ex.innerHTML = ui.company.innerHTML = ui.chart.innerHTML = ui.news.innerHTML = ui.rows.innerHTML = ''; ui.note.textContent = ''; ui.more.hidden = true;
      ui.body.scrollTop = 0; changed();
      try {
        const d = await ask('/v1/intel/markets/country/' + encodeURIComponent(code));
        if (my !== cardSeq) return;
        card = d; paintCard();
        if (d.listings && d.listings.state === 'ready') loadListings(false); else paintListingState(d.listings && d.listings.state);
      } catch (e) {
        if (my !== cardSeq) return;
        ui.sub.textContent = e.status === 403 || e.status === 401 ? 'Owner only' : 'Could not reach the Worker (' + e.message + ')';
      }
    }
    function paintCard() {
      const d = card, p = d.provider || {};
      ui.title.textContent = d.country.name || d.country.iso2;
      ui.sub.textContent = (d.exchanges.length ? d.exchanges.length + (d.exchanges.length === 1 ? ' exchange' : ' exchanges') : 'No exchange in the reference set') + ' · Listings: ' + (p.label || p.id) + (p.state === 'ready' ? '' : p.state === 'needs_key' ? ' (needs key)' : ' (' + p.state + ')');
      paintGdp(); paintExchanges(); paintNews();
    }
    function stat(label, value, line, tone) {
      return '<div class="hm__stat"' + (tone ? ' data-tone="' + tone + '"' : '') + '><span class="hm__stat-label">' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + esc(line) + '</small></div>';
    }
    function paintGdp() {
      const m = card.macro || {}, wb = (m.world_bank && m.world_bank.observations) || [], imf = (m.imf && m.imf.observations) || [];
      const w = (id) => wb.find((o) => o.indicator === id && fin(o.value));
      const i = (id) => imf.find((o) => o.indicator === id && fin(o.value));
      const rows = [];
      const g = i('NGDPD'), gw = w('NY.GDP.MKTP.CD');
      if (g) rows.push(stat('GDP, ' + g.period + ' IMF estimate', money(g.value_usd, 'USD'), 'IMF WEO · retrieved ' + ago(g.retrieved_at) + ' · not live'));
      if (gw) rows.push(stat('GDP, ' + gw.period + ' reported', money(gw.value, 'USD'), 'World Bank WDI · retrieved ' + ago(gw.retrieved_at)));
      const pc = i('NGDPDPC'), pw = w('NY.GDP.PCAP.CD');
      if (pc) rows.push(stat('Per person, ' + pc.period + ' IMF estimate', money(pc.value, 'USD'), 'IMF WEO · retrieved ' + ago(pc.retrieved_at)));
      else if (pw) rows.push(stat('Per person, ' + pw.period, money(pw.value, 'USD'), 'World Bank WDI · retrieved ' + ago(pw.retrieved_at)));
      const gr = i('NGDP_RPCH'), grw = w('NY.GDP.MKTP.KD.ZG');
      if (gr) rows.push(stat('Real growth, ' + gr.period + ' IMF estimate', pct(gr.value), (gr.previous ? gr.previous.period + ': ' + pct(gr.previous.value) + ' · ' : '') + 'IMF WEO', gr.value < 0 ? 'red' : 'green'));
      else if (grw) rows.push(stat('Real growth, ' + grw.period, pct(grw.value), 'World Bank WDI · retrieved ' + ago(grw.retrieved_at), grw.value < 0 ? 'red' : 'green'));
      const miss = [m.world_bank && m.world_bank.status !== 'available' ? 'World Bank unavailable' : '', m.imf && m.imf.status !== 'available' ? 'IMF unavailable' : ''].filter(Boolean).join(' · ');
      ui.gdp.innerHTML = (rows.length ? '<div class="hm__stats">' + rows.join('') + '</div>' : '<p class="hm__note">No GDP figure is available for this country right now.</p>') +
        '<p class="hm__note">GDP is published annual statistics, never live.' + (miss ? ' ' + esc(miss) + '.' : '') + '</p>';
    }
    function paintExchanges() {
      if (!card || !card.exchanges) return;
      const ex = card.exchanges;
      ui.ex.innerHTML = ex.length ? '<ul class="hm__ex">' + ex.map((x) => {
        const open = x.session && x.session.state === 'open';
        const hours = (x.sessions || []).map((s) => s[0] + '–' + s[1]).join(', ');
        return '<li><button type="button" data-mic="' + esc(x.mic) + '" aria-pressed="' + (listMic === x.mic ? 'true' : 'false') + '"><span class="hm__dot" data-open="' + open + '"></span><span class="hm__ex-main"><b>' + esc(x.name) + '</b><small>' + esc(x.city) + ' · ' + esc(x.mic) + ' · ' + esc(hours) + ' local</small></span><span class="hm__ex-state"><b>' + (open ? 'Open' : 'Closed') + '</b><small>' + esc((x.session && x.session.local_time) || '') + ' local</small></span></button></li>';
      }).join('') + '</ul><p class="hm__note">Open/closed is the regular schedule; holidays and auctions are not modeled. Tap an exchange to filter its listings.</p>'
        : '<p class="hm__note">No exchange for this country is in the reference set yet.</p>';
    }
    function paintListingState(s) {
      ui.rows.innerHTML = ''; ui.more.hidden = true;
      const p = (card && card.provider) || {};
      const words = { needs_key: 'Listings need the ' + (p.secret_name || 'provider') + ' secret on Worker mccluster. Nothing is shown until it is set.', no_exchange_in_dataset: 'No exchange here is in the reference set.', not_covered: 'The configured provider does not cover this country\'s exchanges.', unknown_provider: 'MARKETS_PROVIDER names no adapter.', needs_paid_feed: 'This exchange needs a paid feed on the current plan.', key_rejected: 'The provider rejected the key.', rate_limited: 'Provider rate limit reached; try again in a minute.', unavailable: 'The provider could not be reached.' };
      ui.note.textContent = words[s] || '';
      ui.q.disabled = s !== 'ok';
    }
    async function loadListings(more) {
      if (!card || !card.listings || card.listings.state !== 'ready') return;
      const cardGen = cardSeq, my = ++listSeq, key = listQ + '\u0000' + (listMic || '');
      /* a page is appended only to the list it continues: same search, same exchange filter */
      const cont = !!(more && listing && listing.key === key);
      const offset = cont ? listing.offset + listing.listings.length : 0;
      const qs = new URLSearchParams({ limit: '25', offset: String(offset) });
      if (listQ) qs.set('q', listQ); if (listMic) qs.set('mic', listMic);
      ui.q.disabled = false; ui.note.textContent = 'Loading listings…';
      try {
        const d = await ask('/v1/intel/markets/country/' + card.country.iso2 + '/listings?' + qs);
        if (cardGen !== cardSeq || my !== listSeq) return;
        if (cont) { d.listings = listing.listings.concat(d.listings); d.offset = listing.offset; }
        d.key = key; listing = d; paintListings();
      } catch (e) { if (cardGen === cardSeq && my === listSeq) ui.note.textContent = 'Listings unavailable (' + e.message + ').'; }
    }
    function paintListings() {
      const d = listing;
      if (d.state !== 'ok') { paintListingState(d.state); ui.q.disabled = false; return; }
      ui.note.textContent = d.total.toLocaleString('en-US') + (d.total === 1 ? ' common stock' : ' common stocks') + (listMic ? ' on ' + listMic : '') + (listQ ? ' matching "' + listQ + '"' : '') + ' · list from ' + (d.provider.label || d.provider.id) + ', ' + ago(d.listings_retrieved_at);
      ui.rows.innerHTML = d.listings.length ? d.listings.map((r) => {
        const has = fin(r.price), tone = has && fin(r.change) ? (r.change < 0 ? 'red' : 'green') : '';
        const right = has ? '<b>' + esc(price(r.price)) + (r.currency ? ' <span>' + esc(r.currency) + '</span>' : '') + '</b><small data-tone="' + tone + '">' + esc(freshnessLabel(r.freshness)) + ' · ' + esc(pct(r.change_pct)) + ' · ' + esc(ago(r.as_of)) + '</small>'
          : '<small class="hm__price-note">' + esc(PRICE_NOTE[r.price_status] || 'No price') + '</small>';
        return '<li><button type="button" data-symbol="' + esc(r.symbol) + '" data-row-mic="' + esc(r.mic) + '" aria-current="' + (company && company.symbol === r.symbol ? 'true' : 'false') + '"><span class="hm__tick">' + esc(r.display_symbol || r.symbol) + '</span><span class="hm__name">' + esc(r.name || '') + '<small>' + esc(r.exchange) + '</small></span><span class="hm__px">' + right + '</span></button></li>';
      }).join('') : '<li class="hm__note">No listing matches.</li>';
      ui.more.hidden = !d.has_more;
    }
    async function openCompany(symbol, mic) {
      const my = cardSeq, companyGen = ++companySeq;
      chart = { symbol, mic, points: [], loading: true }; refreshQuote();
      company = { symbol, mic, loading: true }; paintCompany(); if (listing) paintListings();
      try {
        const d = await ask('/v1/intel/markets/company/' + encodeURIComponent(symbol) + '?mic=' + encodeURIComponent(mic));
        if (my !== cardSeq || companyGen !== companySeq || !alive || !company || company.symbol !== symbol) return;
        company = Object.assign({ symbol, mic }, d); paintCompany(); paintNews();
      } catch (e) { if (my === cardSeq && companyGen === companySeq && alive && company && company.symbol === symbol) { company = { symbol, mic, error: e.message }; paintCompany(); } }
    }
    function paintCompany() {
      if (!company) { ui.company.innerHTML = ''; return; }
      const c = company, p = c.profile || {}, q = c.quote || {};
      let quote;
      if (c.loading) quote = '<p class="hm__note">Loading ' + esc(c.symbol) + '…</p>';
      else if (c.error) quote = '<p class="hm__note">Could not load ' + esc(c.symbol) + ' (' + esc(c.error) + ').</p>';
      else quote = q.status === 'quote'
        ? stat('Last price', price(q.price) + (p.currency ? ' ' + p.currency : ''), freshnessLabel(q.freshness) + ' · ' + pct(q.change_pct) + ' · trade ' + ago(q.as_of) + ' · ' + (q.source || ''), fin(q.change) && q.change < 0 ? 'red' : 'green')
        : stat('Last price', '—', PRICE_NOTE[q.status] || 'Price unavailable');
      const facts = c.loading || c.error ? '' : [p.industry, p.market_cap && fin(p.market_cap.value) ? 'Market cap ' + money(p.market_cap.value, p.market_cap.unit) : '', p.ipo ? 'Listed ' + p.ipo : ''].filter(Boolean).map(esc).join(' · ');
      ui.company.innerHTML = '<div class="hm__company"><div class="hm__company-head"><b>' + esc(p.name || c.symbol) + '</b><span>' + esc(c.symbol) + ' · ' + esc(c.mic) + '</span>' +
        '<button type="button" class="hm__close hm__close--small" data-clear-company aria-label="Clear the selected company"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="hm__stats">' + quote + '</div>' + (facts ? '<p class="hm__note">' + facts + (p.website ? '<a class="hm__link" href="' + esc(p.website) + '" target="_blank" rel="noopener noreferrer">Company website</a>' : '') + '</p>' : '') + '</div>';
      const clr = ui.company.querySelector('[data-clear-company]');
      if (clr) clr.onclick = () => { company = null; chart = null; companySeq++; paintChart(); paintCompany(); paintNews(); if (listing) paintListings(); };
    }
    function freshnessLabel(f) {
      return ({ real_time: 'Real-time feed · sampled', delayed: 'Delayed', stale: 'Stale',
        unverified: 'Timing unverified', unavailable: 'Unavailable' })[(f || {}).status] || 'Timing unverified';
    }
    async function refreshQuote() {
      const current = chart;
      if (!current || !alive || document.hidden || current.busy) return;
      current.busy = true; paintChart();
      try {
        const d = await ask('/v1/intel/markets/quote/' + encodeURIComponent(current.symbol) + '?mic=' + encodeURIComponent(current.mic));
        if (chart !== current || !alive) return;
        // Never connect observations across a provider/currency change.
        const identity = (d.provider || {}).id + ':' + (d.currency || '');
        if (current.identity && current.identity !== identity) current.points = [];
        current.identity = identity; current.data = d; current.error = false;
        const q = d.quote, t = Date.parse(q && q.as_of), last = current.points[current.points.length - 1];
        if (q && fin(q.price) && q.price > 0 && Number.isFinite(t) && (!last || t > last.time)) {
          current.points.push({ time: t, price: q.price });
          current.points = current.points.slice(-120);
        }
      } catch (_) { if (chart === current) current.error = true; }
      finally { current.loading = false; current.busy = false; if (chart === current && alive) paintChart(); }
    }
    function paintChart() {
      if (!ui) return;
      if (!chart) { ui.chart.innerHTML = ''; return; }
      const c = chart, d = c.data || {}, points = c.points, q = d.quote;
      const status = c.error ? (points.length ? 'Stale · connection unavailable' : 'Unavailable · connection failed') : freshnessLabel(d.freshness);
      const note = c.loading ? 'Waiting for the first provider observation…' :
        (d.freshness && d.freshness.note) || PRICE_NOTE[d.state] || (d.state === 'security_not_on_exchange' ? 'Security not found on this exchange.' : 'Price unavailable.');
      let plot = '';
      if (points.length) {
        const times = points.map(p => p.time), values = points.map(p => p.price);
        const lo = Math.min(...values), hi = Math.max(...values), start = times[0], end = times[times.length - 1];
        // Dots only: missing trades and provider outages are not interpolated.
        const dots = points.map(p => '<circle cx="' + (12 + 276 * (p.time - start) / (end - start || 1)).toFixed(2) +
          '" cy="' + (hi === lo ? 60 : 108 - 96 * (p.price - lo) / (hi - lo)).toFixed(2) + '" r="3"/>').join('');
        const stamp = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        plot = '<p class="hm__note">Observed range: ' + esc(price(lo)) + ' – ' + esc(price(hi)) + ' ' + esc(d.currency || 'currency unknown') + '</p>' +
          '<svg class="hm__chart" viewBox="0 0 300 120" role="img" aria-label="Observed prices for ' + esc(c.symbol) + '">' + dots + '</svg>' +
          '<p class="hm__note">' + esc(stamp(start)) + ' to ' + esc(stamp(end)) + '</p>' +
          '<details><summary>Observed prices (' + points.length + ')</summary><ol class="hm__observations">' + points.map(p => '<li>' + esc(stamp(p.time)) + ': ' + esc(price(p.price)) + '</li>').join('') + '</ol></details>';
      }
      ui.chart.innerHTML = '<section class="hm__company" aria-label="Selected security price observations"><b>' + esc(c.symbol) + ' · ' + esc(c.mic) + '</b>' +
        '<p class="hm__note">' + esc(status) + (q ? ' · ' + esc(q.source) + ' · ' + esc(price(q.price)) + ' ' + esc(d.currency || '') + ' · observation ' + esc(ago(q.as_of)) : '') + '</p>' +
        '<p class="hm__note">' + esc(note) + (d.freshness && d.freshness.fallback ? ' Showing the last verified quote; refresh failed.' : '') + '</p>' + plot +
        '<p class="hm__note">Observations collected while this stock is selected, up to 120 points. Refreshes once per minute while visible. No historical backfill or missing-trade interpolation.</p></section>';
    }

    function newsList(items, at) {
      return '<ul class="hm__news">' + items.map((n) => '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(n.title) + '</b><small>' + esc(n.publisher || n.source || '') + ' · ' + esc(ago(n[at] || n.seen_at || n.published_at)) + '</small></a></li>').join('') + '</ul>';
    }
    function paintNews() {
      if (!card || !card.news) return;
      const parts = [];
      if (company && company.news) {
        const cn = company.news;
        parts.push('<p class="hm__kicker">' + esc(company.symbol) + '</p>' + (cn.items && cn.items.length ? newsList(cn.items, 'published_at') : '<p class="hm__note">' + esc(cn.status === 'empty' ? 'No company headlines this week.' : PRICE_NOTE[cn.status] || 'Company news unavailable.') + '</p>'));
      }
      const c = card.news.country;
      parts.push('<p class="hm__kicker">' + esc(card.country.name) + ', last 72 hours</p>' + (c.stories.length ? newsList(c.stories, 'seen_at') : '<p class="hm__note">' + (c.status === 'unavailable' ? 'Stored news could not be read.' : 'No finance headline mentioning this country in the window.') + '</p>') +
        '<p class="hm__note">GDELT headline metadata matched by finance words; headlines are not verified.</p>');
      const g = card.news.provider;
      if (g && g.items && g.items.length) parts.push('<p class="hm__kicker">Global market headlines · ' + esc(g.source || '') + '</p>' + newsList(g.items, 'published_at'));
      ui.news.innerHTML = parts.join('');
    }

    function destroy() {
      alive = false; chart = null; companySeq++; clearInterval(timer); clearTimeout(searchTimer); window.removeEventListener('hu:country', onCountry); clearPins();
      if(finance)finance.destroy(); finance=null;
      if (ui) ui.root.remove(); ui = null; document.documentElement.removeAttribute('data-halo-markets');
    }
    return { set, on: () => on, refresh: () => (on ? load() : Promise.resolve()), status, pick, openCountry, openFinance: async () => { await set(true); await openCountry('US','United States'); }, close, destroy };
  }

  window.HaloMarkets = Object.freeze({ create });
})();
