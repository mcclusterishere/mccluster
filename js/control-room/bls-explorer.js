/* Owner-requested, transient BLS snapshots through the existing authenticated broker.
   No credentials, browser storage, direct provider requests or automatic polling. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parameters(text) {
    var year = new Date().getUTCFullYear(), p = {};
    try { p = JSON.parse(text || '{}') || {}; } catch (_) { /* Render safe defaults. */ }
    return { series_id: typeof p.series_id === 'string' ? p.series_id : '',
      start_year: p.start_year == null ? year - 2 : p.start_year,
      end_year: p.end_year == null ? year : p.end_year };
  }
  function query(p) {
    var year = new Date().getUTCFullYear(), id = String(p.series_id || '').trim().toUpperCase();
    if (!/^[A-Z0-9_#-]{1,80}$/.test(id)) throw Error('Enter one BLS series ID, using letters, numbers, underscore, # or hyphen.');
    if (!/^\d{4}$/.test(String(p.start_year)) || !/^\d{4}$/.test(String(p.end_year)) ||
        Number(p.start_year) < 1940 || Number(p.end_year) > year ||
        Number(p.end_year) < Number(p.start_year) || Number(p.end_year) - Number(p.start_year) + 1 > 10) {
      throw Error('Choose 1–10 inclusive years between 1940 and ' + year + '.');
    }
    return { series_id: id, start_year: Number(p.start_year), end_year: Number(p.end_year) };
  }
  function form(state, source) {
    var p = parameters(state.parameters), year = new Date().getUTCFullYear();
    var blocked = state.reading || source.entitlement && source.entitlement.allowed === false;
    return '<form id="cuBlsSnapshot"><div class="cu-bls-fields">' +
      '<label>BLS series ID<input id="cuBlsSeries" required maxlength="80" autocomplete="off" spellcheck="false" placeholder="Example: LNS14000000" value="' + esc(p.series_id) + '"></label>' +
      '<label>Start year<input id="cuBlsStart" type="number" required min="1940" max="' + year + '" step="1" value="' + esc(p.start_year) + '"></label>' +
      '<label>End year<input id="cuBlsEnd" type="number" required min="1940" max="' + year + '" step="1" value="' + esc(p.end_year) + '"></label></div>' +
      '<p>One series, up to 10 inclusive years. <a href="https://www.bls.gov/data/" target="_blank" rel="noopener noreferrer">Find a series at BLS ↗</a></p>' +
      '<p class="cu-note">Keyless reads are available. An optional server-side BLS_API_KEY increases provider capacity. No keys belong in this form. Daily limits are provider-enforced, not a displayed remaining balance.</p>' +
      '<button type="submit"' + (blocked ? ' disabled' : '') + '>' + (state.reading ? 'Reading BLS…' : 'Read BLS snapshot') + '</button>' +
      '<button type="button" data-cu-bls-clear>Clear snapshot</button>' +
      '<p class="cu-note">Manual read only. No automatic polling or archive writes. The snapshot is held only in this page and clears on reload or sign-out.</p></form>';
  }
  function period(properties) {
    var p = properties || {}, code = String(p.period || ''), year = String(p.year || '');
    if (!/^\d{4}$/.test(year)) throw Error('BLS returned an unsupported reporting period.');
    var n = Number(code.slice(1)), kind, label, index;
    if (/^M(0[1-9]|1[0-2])$/.test(code)) { kind = 'Monthly'; label = year + '-' + String(n).padStart(2, '0'); index = Number(year) * 12 + n; }
    else if (/^Q0[1-4]$/.test(code)) { kind = 'Quarterly'; label = year + ' Q' + n; index = Number(year) * 4 + n; }
    else if (/^S0[12]$/.test(code)) { kind = 'Half-year'; label = year + ' H' + n; index = Number(year) * 2 + n; }
    else if (code === 'A01') { kind = 'Annual'; label = year; index = Number(year); }
    else if (/^(M13|Q05|S03)$/.test(code)) { kind = 'Annual average'; label = year + ' average (' + code + ')'; index = Number(year); }
    else throw Error('BLS returned an unsupported reporting period.');
    return { kind: kind, label: label, index: index, code: code, year: year };
  }
  function observations(result) {
    if (!result || result.source !== 'bls' || !Array.isArray(result.records) || result.records.length > 2000) throw Error('BLS snapshot unavailable.');
    var seen = new Set();
    return result.records.map(function (r) {
      var p = period(r.properties), id = String(r.metric || ''), key = id + ':' + p.year + ':' + p.code;
      if (!/^[A-Z0-9_#-]{1,80}$/.test(id) || seen.has(key)) throw Error('BLS snapshot contains invalid or duplicate observations.');
      seen.add(key);
      if (r.value_number != null && (typeof r.value_number !== 'number' || !Number.isFinite(r.value_number))) throw Error('BLS snapshot contains an invalid numeric value.');
      return Object.assign(p, { series: id, value: r.value_number == null ? null : r.value_number,
        unit: typeof r.unit === 'string' && r.unit ? r.unit : null,
        notes: Array.isArray(r.properties.footnote_codes) ? r.properties.footnote_codes.join(', ') : '' });
    }).sort(function (a, b) { return a.series.localeCompare(b.series) || a.year.localeCompare(b.year) || a.code.localeCompare(b.code); });
  }
  function value(n) { return n == null ? 'Not reported' : n.toLocaleString(undefined, { maximumFractionDigits: 10 }); }
  function chart(rows) {
    // Averages are not extra January observations. Missing/null periods break the line.
    var numeric = rows.filter(function (r) { return r.value != null; });
    if (!numeric.length || rows[0].kind === 'Annual average') return '';
    var low = Math.min.apply(null, numeric.map(function (r) { return r.value; }));
    var high = Math.max.apply(null, numeric.map(function (r) { return r.value; }));
    var first = rows[0].index, last = rows[rows.length - 1].index, previous = null, path = '', dots = '';
    rows.forEach(function (r) {
      if (r.value == null) { previous = null; return; }
      var x = last === first ? 160 : 12 + (r.index - first) / (last - first) * 296;
      var y = high === low ? 72 : 12 + (high - r.value) / (high - low) * 120;
      path += (previous != null && r.index === previous + 1 ? ' L' : ' M') + x.toFixed(2) + ',' + y.toFixed(2);
      dots += '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="3"><title>' + esc(r.label + ': ' + value(r.value)) + '</title></circle>';
      previous = r.index;
    });
    return '<figure class="cu-bls-chart"><figcaption>' + esc(rows[0].series + ' · ' + rows[0].kind) + '</figcaption>' +
      '<p>Displayed range: ' + esc(value(low)) + ' to ' + esc(value(high)) + '. Axis does not necessarily start at zero.</p>' +
      '<svg viewBox="0 0 320 144" role="img" aria-label="' + esc(rows[0].kind + ' series trend; exact values and footnote codes follow in the table. Gaps are not interpolated.') + '">' +
      '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2"/>' + dots + '</svg>' +
      '<div class="cu-bls-axis"><span>' + esc(rows[0].label) + '</span><span>' + esc(rows[rows.length - 1].label) + '</span></div></figure>';
  }
  function results(result) {
    var rows;
    try { rows = observations(result); } catch (e) { return '<p role="alert">' + esc(e.message) + '</p>'; }
    var groups = new Map();
    rows.forEach(function (r) { var key = r.series + ':' + r.kind; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    var mode = result.access_mode === 'registered' ? 'Registered' : result.access_mode === 'unregistered' ? 'Keyless' : 'Access mode unavailable';
    var fetched = new Date(result.fetched_at), retrieved = Number.isFinite(fetched.getTime()) ? fetched.toISOString() : 'Unknown';
    return '<section class="cu-bls-results" aria-label="BLS snapshot results"><h3>BLS observations</h3>' +
      '<p>' + esc(result.attribution || 'U.S. Bureau of Labor Statistics') + ' · ' + mode + ' · Retrieved ' + esc(retrieved) + '</p>' +
      '<p class="cu-note">Reporting periods, not release dates or live prices. Series definitions, geography, units and seasonal adjustment must be checked at BLS. No unit is inferred from the series ID. Annual averages remain separate from the period trend.</p>' +
      (result.truncated ? '<p role="alert">The provider result was truncated. This is not the complete requested history.</p>' : '') +
      (rows.length ? Array.from(groups.values()).map(function (group) { return chart(group.sort(function (a, b) { return a.index - b.index; })); }).join('') +
        '<table><caption>All ' + rows.length + ' returned observations. Missing values are not zero. Footnote codes are supplied by BLS.</caption><thead><tr><th scope="col">Series / period</th><th scope="col">Value / unit</th><th scope="col">Footnotes</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><th scope="row">' + esc(r.series) + '<br>' + esc(r.label) + '</th><td>' + esc(value(r.value)) + '<br><small>' + esc(r.unit || 'Unit not supplied') + '</small></td><td>' + esc(r.notes || 'None supplied') + '</td></tr>'; }).join('') + '</tbody></table>' :
        '<p>No observations were returned. This does not mean the value is zero or that the requested period has complete coverage.</p>') + '</section>';
  }
  function bind(root, state, submit, paint) {
    var f = root.querySelector('#cuBlsSnapshot');
    if (!f) return;
    function fields() { return { series_id: root.querySelector('#cuBlsSeries').value,
      start_year: root.querySelector('#cuBlsStart').value, end_year: root.querySelector('#cuBlsEnd').value }; }
    f.oninput = function () { state.parameters = JSON.stringify(fields()); };
    f.onsubmit = function (e) {
      e.preventDefault();
      if (state.reading) return;
      try { var p = query(fields()); state.parameters = JSON.stringify(p); submit(p); }
      catch (error) { state.recordError = error.message; state.records = null; state.result = null; paint(); }
    };
    var clear = root.querySelector('[data-cu-bls-clear]');
    if (clear) clear.onclick = function () {
      ++state.seq; state.reading = false; state.records = null; state.result = null; state.runs = null; state.recordError = null; paint();
    };
  }
  window.CR.blsExplorer = { form: form, results: results, bind: bind, query: query, observations: observations, chart: chart };
})();
