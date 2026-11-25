import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { executeProvider } from '../../workers/mccluster/src/seek-first/gateway.js';

const source = { key: 'bls', name: 'Bureau of Labor Statistics', configured: true, credential_required: false, entitlement: { allowed: true } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const c = { window: { CR: {} }, Intl, console, setTimeout, clearTimeout };
  vm.createContext(c);
  for (const name of ['bls-explorer', 'analytics-unified']) vm.runInContext(readFileSync(`js/control-room/${name}.js`, 'utf8'), c);
  const U = c.window.CR.analyticsUnified, B = c.window.CR.blsExplorer;
  U.state.sources = [source]; U.state.source = 'bls';
  return { U, B };
}
function form(U, request, fields = {}) {
  const nodes = {
    '#cuBlsSnapshot': {}, '#cuBlsSeries': { value: 'lns14000000' },
    '#cuBlsStart': { value: '2024' }, '#cuBlsEnd': { value: '2024' }, '[data-cu-bls-clear]': {},
    ...fields,
  };
  const root = { querySelector: key => nodes[key] || null, querySelectorAll: () => [] };
  U.bind(root, request, () => {});
  return { nodes, submit: () => nodes['#cuBlsSnapshot'].onsubmit({ preventDefault() {} }) };
}
function record(year, period, value, extra = {}) {
  return { metric: 'LNS14000000', value_number: value, unit: null,
    properties: { year, period, footnote_codes: ['P'], time_basis: 'period_start_not_release_time' }, ...extra };
}
function result(records) { return { source: 'bls', operation: 'timeseries', access_mode: 'unregistered', fetched_at: '2026-11-07T12:00:00Z', records }; }

test('Control loads the isolated module and stylesheet, without changing global navigation', () => {
  const html = readFileSync('control.html', 'utf8');
  assert.match(html, /css\/control-bls-explorer.css/);
  assert.ok(html.indexOf('js/control-room/bls-explorer.js') < html.indexOf('js/control-room/analytics-unified.js'));
  const { U } = setup(), out = U.intelligence();
  assert.match(out, /id="cuBlsSnapshot"/);
  assert.doesNotMatch(out, /id="cuSnapshot"|id="cuParameters"/);
  assert.match(out, /No keys belong in this form/);
  assert.match(out, /clears on reload or sign-out/);
});
test('one series and keyless-compatible year bounds validate before requests', () => {
  const { B } = setup(), p = { series_id: ' lns14000000 ', start_year: 2017, end_year: 2026 };
  assert.equal(B.query(p).series_id, 'LNS14000000');
  for (const patch of [{ series_id: '' }, { series_id: 'A,B' }, { series_id: 'A'.repeat(81) }, { start_year: 1939 }, { start_year: 2016 }, { start_year: 2024.5 }, { end_year: 9999 }, { end_year: 2016 }]) {
    assert.throws(() => B.query({ ...p, ...patch }));
  }
});
test('manual form uses the canonical transient broker and repeated submit makes only one request', async () => {
  const { U } = setup(); let finish, calls = [];
  const f = form(U, (path, options) => { calls.push({ path, ...options }); return new Promise(resolve => { finish = resolve; }); });
  assert.equal(calls.length, 0);
  f.submit(); f.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/seek-first/fetch/bls');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), { series_id: 'LNS14000000', start_year: 2024, end_year: 2024, persist: false, include_raw: false, lane: 'INTERNAL' });
  finish({ result: result([record('2024', 'M07', 4.3)]) }); await tick();
  assert.match(U.intelligence(), /BLS observations/);
  assert.match(U.intelligence(), /2024-07/);
  assert.match(U.intelligence(), /4.3/);
  assert.match(U.intelligence(), /Unit not supplied/);
});
test('input survives repaint, validation errors clear old data, and a valid retry succeeds', async () => {
  const { U } = setup(); let calls = 0;
  const f = form(U, async () => { calls++; return { result: result([]) }; });
  f.nodes['#cuBlsSeries'].value = 'BAD INPUT'; f.nodes['#cuBlsSnapshot'].oninput();
  assert.match(U.intelligence(), /value="BAD INPUT"/);
  U.state.result = result([record('2024', 'M07', 4.3)]); U.state.records = U.state.result.records;
  f.submit(); assert.equal(calls, 0); assert.equal(U.state.result, null); assert.match(U.intelligence(), /Enter one BLS series ID/);
  f.nodes['#cuBlsSeries'].value = 'LNS14000000'; f.submit(); await tick();
  assert.equal(calls, 1); assert.match(U.intelligence(), /No observations were returned/);
});
test('null values and absent periods break lines; annual averages are never January chart points', () => {
  const { B } = setup(), rows = B.observations(result([
    record('2024', 'M01', 1), record('2024', 'M02', null), record('2024', 'M03', 3),
    record('2024', 'M05', 5), record('2024', 'M06', 6), record('2024', 'M13', 2),
  ]));
  const chart = B.chart(rows.filter(r => r.kind === 'Monthly')).match(/<path d="([^"]*)"/)[1];
  assert.equal((chart.match(/ M/g) || []).length, 3);
  assert.equal((chart.match(/ L/g) || []).length, 1);
  assert.equal(B.chart(rows.filter(r => r.kind === 'Annual average')), '');
  const out = B.results(result([record('2024', 'M13', 2), record('2024', 'M02', null)]));
  assert.match(out, /2024 average \(M13\)/); assert.match(out, /Not reported/);
  assert.doesNotMatch(out, /<svg/);
});
test('quarterly, half-year and annual series remain separate and unknown dates fail closed', () => {
  const { B } = setup();
  for (const [code, label] of [['Q03', '2024 Q3'], ['S02', '2024 H2'], ['A01', '2024'], ['Q05', '2024 average (Q05)'], ['S03', '2024 average (S03)']]) {
    assert.equal(B.observations(result([record('2024', code, 1)]))[0].label, label);
  }
  assert.throws(() => B.observations(result([record('2024', 'M00', 1)])));
  assert.throws(() => B.observations(result([record('2024', 'M01', 1), record('2024', 'M01', 2)])));
});
test('provider strings escape, zero stays zero, malformed numbers and truncation are explicit', () => {
  const { B } = setup(), r = result([record('2024', 'M01', 0, { unit: '<img src=x>', properties: { year: '2024', period: 'M01', footnote_codes: ['<script>'] } })]);
  r.attribution = '<script>'; r.truncated = true;
  const out = B.results(r);
  assert.match(out, /<td>0<br>/); assert.match(out, /&lt;img/); assert.match(out, /&lt;script/);
  assert.doesNotMatch(out, /<script>|<img/); assert.match(out, /not the complete requested history/);
  assert.match(B.results(result([record('2024', 'M01', '0')])), /invalid numeric value/);
});
test('denied source does not issue a request even on programmatic form submission', () => {
  const { U } = setup(); U.state.sources = [{ ...source, entitlement: { allowed: false } }];
  const f = form(U, () => assert.fail('denied source request'));
  assert.match(U.intelligence(), /disabled>Read BLS snapshot/); f.submit();
});
test('clear, sign-out and source switch reject late responses; another read remains possible', async () => {
  for (const action of ['clear', 'sign-out', 'source']) {
    const { U } = setup(); let finish;
    const f = form(U, () => new Promise(resolve => { finish = resolve; }));
    f.submit();
    if (action === 'clear') f.nodes['[data-cu-bls-clear]'].onclick();
    if (action === 'sign-out') U.clearPrivate();
    if (action === 'source') {
      const b = { dataset: { cuSource: 'usgs' } };
      U.bind({ querySelector: () => null, querySelectorAll: selector => selector === '[data-cu-source]' ? [b] : [] }, () => {}, () => {});
      b.onclick();
    }
    finish({ result: result([record('2024', 'M07', 99)]) }); await tick();
    assert.equal(U.state.result, null); assert.equal(U.state.reading, false);
    if (action === 'sign-out') assert.equal(U.state.parameters, '');
    U.state.sources = [source]; U.state.source = 'bls';
    form(U, async () => ({ result: result([]) })).submit(); await tick();
    assert.equal(U.state.reading, false); assert.ok(U.state.result);
  }
});
test('refresh status invalidates an in-flight snapshot without leaving the form locked', async () => {
  const { U } = setup(); let finish;
  form(U, () => new Promise(resolve => { finish = resolve; })).submit();
  await U.load(async path => path.includes('/sources') ? { sources: [source] } : { database_schema_ready: false }, () => {});
  finish({ result: result([record('2024', 'M07', 99)]) }); await tick();
  assert.equal(U.state.result, null); assert.equal(U.state.reading, false);
  form(U, async () => ({ result: result([]) })).submit(); await tick();
  assert.ok(U.state.result);
});
test('provider failure has no false empty success and can be retried', async () => {
  const { U } = setup();
  form(U, async () => { throw Error('BLS request unavailable'); }).submit(); await tick();
  assert.match(U.intelligence(), /BLS request unavailable/); assert.doesNotMatch(U.intelligence(), /No observations were returned/);
  form(U, async () => ({ result: result([]) })).submit(); await tick();
  assert.match(U.intelligence(), /No observations were returned/);
});
test('real keyless adapter output renders through owner controls without invented units or release dates', async () => {
  const { U } = setup(), previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.bls.gov/publicAPI/v1/timeseries/data/');
    assert.equal(JSON.parse(options.body).seriesid[0], 'LNS14000000');
    return Response.json({ status: 'REQUEST_SUCCEEDED', message: [], Results: { series: [{ seriesID: 'LNS14000000', data: [
      { year: '2024', period: 'M07', value: '4.3' }, { year: '2024', period: 'M13', value: '-' },
    ] }] } });
  };
  try {
    const f = form(U, async (_, options) => ({ result: await executeProvider('bls', options.body, {}) }));
    f.submit(); await tick();
    const out = U.intelligence();
    assert.match(out, /4.3/); assert.match(out, /Not reported/); assert.match(out, /Keyless/);
    assert.match(out, /Reporting periods, not release dates/); assert.match(out, /Unit not supplied/);
  } finally { globalThis.fetch = previous; }
});
