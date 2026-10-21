/* Private, explicit comparisons through the existing owner request client.
   GDELT metadata is not article text; annual observations are dated context. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var S = {economy:'', hours:72, article:'', data:null, error:'', busy:false, seq:0};
  var repaint = null;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits:20}) : 'Unavailable'; }
  function date(value) { if (!value) return 'Unknown'; var d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC') : 'Unknown'; }
  function url(value) { try { var u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function link(value, label) { var href = url(value); return href ? '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>' : '<span>'+esc(label)+' · link unavailable</span>'; }
  function status(value) { return value ? String(value).replace(/_/g, ' ') : 'Unavailable'; }
  function owner() { return !!window.MCC_BAR && window.MCC_BAR.admin() === true; }
  function globeCountry() { var country = window.CR.analytics && window.CR.analytics.state.geo && window.CR.analytics.state.geo.region; return /^[A-Z]{2}$/.test(country || '') ? country : ''; }
  function rows(items) { return '<dl class="nc-rows">'+items.map(function (x) { return '<div><dt>'+esc(x[0])+'</dt><dd>'+esc(x[1])+'</dd></div>'; }).join('')+'</dl>'; }
  function notes(items) { var clean = list(items).filter(function (x) { return typeof x === 'string' && x; }); return clean.length ? '<ul class="nc-notes">'+clean.map(function (x) { return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>' : ''; }
  function invalidate() { ++S.seq; S.data = null; S.busy = false; S.error = ''; S.article = ''; }

  function indicator(item) {
    var latest = item.latest, previous = item.previous, change = item.change;
    var values = [['Latest published observation', latest ? number(latest.value)+' '+(item.unit || '') : 'Unavailable'], ['Observation year', latest && latest.period || 'Unavailable']];
    values.push(['Previous observation', previous ? number(previous.value)+' '+(item.unit || '')+' · '+previous.period : 'Unavailable']);
    values.push(['Change between observations', change ? (change.value > 0 ? '+' : '')+number(change.value)+' '+(change.unit || '')+' · '+change.from_period+' → '+change.to_period : 'Unavailable']);
    if (change && typeof change.period_gap_years === 'number') values.push(['Comparison interval', number(change.period_gap_years)+' year'+(change.period_gap_years === 1 ? '' : 's')]);
    values.push(['Observation age at comparison year', typeof item.observation_age_years === 'number' ? number(item.observation_age_years)+' years' : 'Unavailable']);
    values.push(['Freshness', status(item.freshness)]);
    return '<article class="nc-indicator" data-nc-indicator="'+esc(item.id)+'"><h4>'+esc(item.label || item.id)+'</h4>'+rows(values)+link(item.source_url, 'World Bank source')+'</article>';
  }
  function story(item) {
    var geo = item.geography || {}, topics = list(item.topics), comparisons = list(item.comparisons), nearby = list(item.nearby_events);
    var matched = topics.map(function (topic) { return (topic.label || topic.key)+(list(topic.terms).length ? ' ('+topic.terms.join(', ')+')' : ''); }).join(' · ');
    var body = '<article class="nc-story"><h3>'+link(item.url, item.title || 'Untitled ingested story')+'</h3>'+rows([
      ['Publisher', item.publisher || 'Unknown'], ['Seen by GDELT', date(item.seen_at)], ['Imported', date(item.imported_at)],
      ['Mentioned geography', [geo.place, geo.country_iso || geo.country_fips].filter(Boolean).join(' · ') || 'Unresolved'],
      ['Geography basis', geo.basis === 'automated_place_mention' ? 'Automated place mention; event location unverified' : status(geo.basis)],
      ['Nearby evidence context', status(item.spatial_coverage)],
      ['Headline topic matches', matched || 'No supported topic match']
    ]);
    if (item.summary) body += '<p class="nc-context-note">'+esc(item.summary)+'</p>';
    if (comparisons.length) body += '<h4>Relevant observations before the story year</h4><ul class="nc-comparisons">'+comparisons.map(function (x) { return '<li><b>'+esc(x.label || x.id)+'</b><span>'+esc(x.latest ? number(x.latest.value)+' '+(x.unit || '')+' · '+x.latest.period : 'Unavailable')+'</span></li>'; }).join('')+'</ul>';
    body += notes(item.limitations);
    if (nearby.length) body += '<details><summary>'+nearby.length+' nearby stored event'+(nearby.length === 1 ? '' : 's')+'</summary><p>Spatial and time proximity supplies context. It does not establish a connection to this story.</p>'+nearby.map(function (x) { return '<div class="nc-event">'+link(x.url, x.title || 'Stored event')+rows([
      ['Observed', date(x.observed_at)], ['Retrieved', date(x.retrieved_at)], ['Review status', status(x.review_status)],
      ['Distance from mentioned place', number(x.distance_km)+' km'], ['Time offset from story observation', number(x.time_offset_hours)+' hours'],
      ['Magnitude', typeof x.magnitude === 'number' ? number(x.magnitude)+' '+(x.magnitude_type || '') : 'Unavailable']
    ])+'</div>'; }).join('')+'</details>';
    if (!S.article && item.id) body += '<button type="button" data-nc-story="'+esc(item.id)+'"'+(S.busy ? ' disabled' : '')+'>Inspect story context</button>';
    return body+'</article>';
  }
  function results(data) {
    var coverage = data.coverage || {}, window = data.window || {}, stories = list(data.stories), indicators = list(data.indicators);
    return '<div class="nc-results"><h3>'+esc(data.country_name || data.economy || 'Country unresolved')+(data.country_name && data.economy ? ' ('+esc(data.economy)+')' : '')+'</h3><p class="nc-snapshot">Snapshot generated '+esc(date(data.generated_at))+'</p>'+rows([
      ['News observation window', date(window.since)+' → '+date(window.until)], ['Ingested news', status(coverage.news_status)],
      ['Returned sample', number(coverage.news_returned)+' stories'+(coverage.news_has_more ? ' · more available beyond this sample' : '')],
      ['Annual indicators', status(coverage.indicator_status)], ['Spatial archive', status(coverage.spatial_status)]
    ])+'<details class="nc-source-status"><summary>Source status and limitations</summary>'+list(data.sources).map(function (source) { return '<div class="nc-source"><h4>'+esc(source.label || source.key)+' · '+esc(status(source.status))+'</h4><p>'+esc(source.detail || 'No further source detail returned.')+'</p>'+('retrieved_at' in source ? rows([['Retrieved',date(source.retrieved_at)],['Provider updated',date(source.provider_updated_at)]]) : '')+link(source.url,'Source')+(source.terms_url ? ' · '+link(source.terms_url,'Source terms') : '')+'</div>'; }).join('')+notes(data.limitations)+'</details>'+
      '<details class="nc-indicator-section"><summary>'+(indicators.length ? indicators.length+' annual country indicators' : 'Annual indicators unavailable')+'</summary><p>Each series keeps its own latest published year and unit. Annual observations can lag today’s news; a change is between the listed observations, not a response to a headline.</p><div class="nc-indicators">'+(indicators.length ? indicators.map(indicator).join('') : '<p>Indicator observations are unavailable.</p>')+'</div></details>'+
      '<div class="nc-stories">'+(stories.length ? stories.map(story).join('') : '<p>No matching ingested stories were returned. Check the news source status before interpreting this as an empty time window.</p>')+'</div></div>';
  }
  function render() {
    if (!owner()) return '';
    var country = S.economy || globeCountry(), selected = globeCountry();
    return '<section class="cu-card nc-card" data-nc-card aria-labelledby="ncTitle"><div class="cu-heading"><h2 id="ncTitle">News context</h2><span class="cu-badge">Private · owner</span></div><p><a href="brief.html">Morning brief ↗</a> Yesterday&#39;s headlines per country, drafted overnight, to read live and publish.</p><p>Compare ingested GDELT headline metadata with annual World Bank observations and nearby stored events. Article text is not read here. Country context does not establish causation.</p>'+
      '<form id="ncCompare"><label>Country code<input id="ncEconomy" name="economy" value="'+esc(country)+'" maxlength="2" pattern="[A-Za-z]{2}" required placeholder="US" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="ncScope"'+(S.busy ? ' disabled' : '')+'></label><label>News window<select id="ncHours" name="hours"'+(S.busy ? ' disabled' : '')+'>'+[[24,'24 hours'],[72,'72 hours'],[168,'7 days']].map(function (x) { return '<option value="'+x[0]+'"'+(S.hours === x[0] ? ' selected' : '')+'>'+x[1]+'</option>'; }).join('')+'</select></label><button type="submit"'+(S.busy ? ' disabled' : '')+'>'+(S.busy ? 'Comparing…' : 'Compare')+'</button></form>'+
      '<p id="ncScope">Country-level sources. State and city selections are not treated as country observations. Nothing is saved; each comparison is requested here.</p>'+
      (selected && selected !== country ? '<button type="button" data-nc-globe="'+esc(selected)+'"'+(S.busy ? ' disabled' : '')+'>Use globe country '+esc(selected)+'</button>' : '')+
      (S.article ? '<button type="button" data-nc-country'+(S.busy ? ' disabled' : '')+'>Back to country results</button>' : '')+
      (S.busy ? '<p role="status" aria-live="polite">Reading ingested metadata and published source observations…</p>' : '')+
      (S.error ? '<p class="cu-warning" role="alert">'+esc(S.error)+'</p>' : '')+
      (S.data ? results(S.data) : !S.busy && !S.error ? '<p class="nc-empty">Choose a two-letter country code, then Compare. Data is loaded only when requested.</p>' : '')+'</section>';
  }
  async function load(request, paint, query) {
    if (!owner() || S.busy) return;
    var economy = String(query.economy || S.economy || globeCountry()).trim().toUpperCase();
    if (!query.article && !/^[A-Z]{2}$/.test(economy)) { S.error = 'Enter a two-letter country code, such as US or GB.'; S.data = null; paint(); return; }
    var mine = ++S.seq; S.economy = economy; S.article = query.article || ''; S.data = null; S.error = ''; S.busy = true; paint();
    try {
      if (!await window.MCC_BAR.verifyAdmin() || !owner() || mine !== S.seq) return;
      var path = '/v1/intel/news-context?'+(S.article ? 'article_id='+encodeURIComponent(S.article) : 'economy='+encodeURIComponent(economy))+'&hours='+S.hours+'&limit=12';
      var data = await request(path);
      if (mine !== S.seq || !owner()) return;
      if (!data || data.ok !== true || data.schema !== 'news-context/v1' || !Array.isArray(data.stories) || !Array.isArray(data.indicators)) throw Error(data && data.error || 'News context returned an unavailable or unsupported response.');
      S.data = data;
    } catch (error) { if (mine === S.seq && owner()) S.error = error.message || 'News context is unavailable. Try Compare again.'; }
    finally { if (mine === S.seq) { S.busy = false; paint(); } }
  }
  function bind(root, request, paint) {
    repaint = paint;
    var form = root.querySelector('#ncCompare'); if (!form || !owner()) return;
    var economy = root.querySelector('#ncEconomy'), hours = root.querySelector('#ncHours');
    economy.oninput = function () { S.economy = economy.value; };
    hours.onchange = function () { S.hours = Number(hours.value); };
    form.onsubmit = function (event) { event.preventDefault(); S.hours = Number(hours.value); load(request, paint, {economy:economy.value}); };
    root.querySelectorAll('[data-nc-story]').forEach(function (button) { button.onclick = function () { load(request, paint, {article:button.dataset.ncStory}); }; });
    var back = root.querySelector('[data-nc-country]'); if (back) back.onclick = function () { load(request, paint, {economy:S.economy}); };
    var globe = root.querySelector('[data-nc-globe]'); if (globe) globe.onclick = function () { S.economy = globe.dataset.ncGlobe; paint(); };
  }
  window.addEventListener('mcc:appbar-admin', function () { if (!owner()) invalidate(); if (repaint) repaint(); });
  window.addEventListener('mcc:auth-changed', function (event) { if (event.detail && event.detail.signed_in === false) { invalidate(); if (repaint) repaint(); } });
  window.addEventListener('storage', function (event) { if (event.key === 'mccdb_session') { invalidate(); if (repaint) repaint(); } });
  window.CR.newsContext = {render:render, bind:bind, load:load, state:S};
})();
