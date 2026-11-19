/* The environmental globe's pure encodings (js/environment-layers.js, slice G1): every visual encodes a stated
   quantity, and an item's own time is never replaced by a fetch time. Run in a vm with a bare window: no Cesium. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-layers.js');
function load() {
  const window = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(source, { window, console });
  return window.MCC_ENVIRONMENT_LAYERS;
}
const RAW = load().encodings;
/* values made inside the vm realm carry another prototype: every encoding's answer is copied before a strict deep comparison */
const plain = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const E = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, typeof v === 'function' ? (...a) => plain(v(...a)) : v]));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test('quake disc radius: 25 km at M5, area ratio 10^1.5 per magnitude unit, clamped to 300 m and 1,000 km', () => {
  assert.equal(E.quakeRadiusM(5), 25000);
  assert.ok(near(E.quakeRadiusM(6) / E.quakeRadiusM(5), 10 ** 0.75), 'r ratio 10^0.75 (area 10^1.5)');
  assert.ok(near((E.quakeRadiusM(7) / E.quakeRadiusM(6)) ** 2, 10 ** 1.5));
  assert.ok(near(E.quakeRadiusM(4), 25000 * 10 ** -0.75));
  assert.equal(E.quakeRadiusM(0), 300, 'the floor');
  assert.equal(E.quakeRadiusM(9), 1000000, 'the cap');
  assert.equal(E.quakeRadiusM(7.14) <= 1000000, true);
  assert.equal(E.quakeRadiusM(null), null, 'no magnitude, no disc');
  assert.equal(E.quakeRadiusM(NaN), null);
});
test('depth colour bins, the null bin included', () => {
  assert.equal(E.depthColour(10), '#ff5a3c'); assert.equal(E.depthColour(32.9), '#ff5a3c');
  assert.equal(E.depthColour(33), '#ffb347'); assert.equal(E.depthColour(69.9), '#ffb347');
  assert.equal(E.depthColour(70), '#ffe066'); assert.equal(E.depthColour(299.9), '#ffe066');
  assert.equal(E.depthColour(300), '#8bb8ff'); assert.equal(E.depthColour(600), '#8bb8ff');
  assert.equal(E.depthColour(null), '#9aa0a6'); assert.equal(E.depthColour(undefined), '#9aa0a6');
});
test('quakeFromFacts reads the Worker\'s formatted facts and returns nulls otherwise', () => {
  assert.deepEqual(E.quakeFromFacts([{ label: 'Magnitude', value: '5.4' }, { label: 'Depth', value: '273.6 km' }]), { mag: 5.4, depth_km: 273.6 });
  assert.deepEqual(E.quakeFromFacts([{ label: 'Depth', value: '35 km' }]), { mag: null, depth_km: 35 });
  assert.deepEqual(E.quakeFromFacts([{ label: 'Magnitude', value: 'unknown' }]), { mag: null, depth_km: null });
  assert.deepEqual(E.quakeFromFacts(null), { mag: null, depth_km: null });
  assert.deepEqual(E.quakeFromFacts([{ label: 'Magnitude', value: '' }, { label: 'Depth', value: 'km' }]), { mag: null, depth_km: null });
});
test('fire radiative power ramp, null first', () => {
  assert.equal(E.frpColour(null), '#9aa0a6');
  assert.equal(E.frpColour(0), '#ffd166'); assert.equal(E.frpColour(4.9), '#ffd166');
  assert.equal(E.frpColour(5), '#ffa62b'); assert.equal(E.frpColour(19.9), '#ffa62b');
  assert.equal(E.frpColour(20), '#ff5e2b'); assert.equal(E.frpColour(59.9), '#ff5e2b');
  assert.equal(E.frpColour(60), '#ff2d55'); assert.equal(E.frpColour(199.9), '#ff2d55');
  assert.equal(E.frpColour(200), '#ffffff'); assert.equal(E.frpColour(5000), '#ffffff');
});
test('summary cells: radius clamp(4 + 2.2*sqrt(sum/10), 4, 40), grey when nothing reported power', () => {
  assert.equal(E.cellRadiusPx(0), 4);
  assert.ok(near(E.cellRadiusPx(10), 6.2));
  assert.ok(near(E.cellRadiusPx(1000), 4 + 2.2 * 10));
  assert.equal(E.cellRadiusPx(1e9), 40);
  assert.equal(E.cellRadiusPx(null), 4);
  assert.equal(E.cellColour({ frp_sum_mw: 0, frp_max_mw: null }), '#9aa0a6');
  assert.equal(E.cellColour({ frp_sum_mw: 120, frp_max_mw: 416.8 }), '#ffffff');
});
test('alert severity tints, Unknown and other included', () => {
  assert.deepEqual(E.severityTint('Extreme'), { hex: '#b3001b', alpha: 0.3 });
  assert.deepEqual(E.severityTint('Severe'), { hex: '#ff6a00', alpha: 0.26 });
  assert.deepEqual(E.severityTint('Moderate'), { hex: '#ffcc00', alpha: 0.22 });
  assert.deepEqual(E.severityTint('Minor'), { hex: '#3fa7ff', alpha: 0.18 });
  assert.deepEqual(E.severityTint('Unknown'), { hex: '#9aa0a6', alpha: 0.16 });
  assert.deepEqual(E.severityTint(null), { hex: '#9aa0a6', alpha: 0.16 });
  assert.deepEqual(E.severityTint('Catastrophic'), { hex: '#9aa0a6', alpha: 0.16 });
});
test('station columns: 5 km pedestal plus 30 km per metre above MLLW; colour by quality and sign', () => {
  assert.equal(E.stationColumnM(1), 35000);
  assert.equal(E.stationColumnM(0), 5000);
  assert.equal(E.stationColumnM(-0.31), 5000, 'at or below datum shows the pedestal only');
  assert.equal(E.stationColumnM(2.42), 5000 + 30000 * 2.42);
  assert.equal(E.stationColour('v', 1.2), '#35c4a8');
  assert.equal(E.stationColour('p', 0.4), '#9ddfcf');
  assert.equal(E.stationColour('p', -0.31), '#6d8a84');
  assert.equal(E.stationColour('v', -0.1), '#6d8a84');
});
test('ShakeMap contour colour: USGS\'s own colour first, then the MMI palette by rounded intensity', () => {
  assert.equal(E.mmiColour({ mmi: 2, color: '#bfccff' }), '#bfccff');
  assert.equal(E.mmiColour({ mmi: 2.5, color: '#AFD9FF' }), '#afd9ff');
  assert.equal(E.mmiColour({ mmi: 1, color: null }), '#ffffff');
  assert.equal(E.mmiColour({ mmi: 2.4, color: null }), '#bfccff');
  assert.equal(E.mmiColour({ mmi: 3 }), '#a0e6ff');
  assert.equal(E.mmiColour({ mmi: 4 }), '#80ffff');
  assert.equal(E.mmiColour({ mmi: 5 }), '#7aff93');
  assert.equal(E.mmiColour({ mmi: 6 }), '#ffff00');
  assert.equal(E.mmiColour({ mmi: 6.6, color: 'not a colour' }), '#ffc800');
  assert.equal(E.mmiColour({ mmi: 8 }), '#ff9100');
  assert.equal(E.mmiColour({ mmi: 9 }), '#ff0000');
  assert.equal(E.mmiColour({ mmi: 10 }), '#c80000');
  assert.equal(E.mmiColour({ mmi: 12 }), '#c80000');
});
test('EONET kind colours follow the feed\'s eventKind vocabulary', () => {
  const table = { fire: '#ff7a1a', cyclone: '#7cc7ff', tornado: '#9ad0ff', storm: '#7cc7ff', volcano: '#c04dff', ice: '#b8f3ff', flood: '#4aa3ff', heat: '#ff3d5e', dust: '#c8b89a', landslide: '#a0724a', snow: '#ffffff', quake: '#ff5a3c', wave: '#2bd9c7', other: '#cfd8dc' };
  for (const [kind, hex] of Object.entries(table)) assert.equal(E.eonetColour(kind), hex, kind);
  assert.equal(E.eonetColour('rain'), '#cfd8dc');
  assert.equal(E.eonetColour(undefined), '#cfd8dc');
});
test('level of detail swaps at 400 km', () => {
  assert.equal(E.lod(0), 'near'); assert.equal(E.lod(400000), 'near'); assert.equal(E.lod(400001), 'far'); assert.equal(E.lod(2e7), 'far');
});
test('pick ids are frozen, versioned and recognised', () => {
  const id = E.pickId({ layer: 'quakes', id: 'usgs:us7000tyhr', kind: 'quake' });
  assert.deepEqual(id, { env: 'mcc-environment/v1', layer: 'quakes', id: 'usgs:us7000tyhr', kind: 'quake' });
  assert.ok(Object.isFrozen(RAW.pickId({ layer: 'quakes', id: 'usgs:us7000tyhr', kind: 'quake' })), 'a pick id is frozen');
  const part = E.pickId({ layer: 'eonet', id: 'eonet:x', kind: 'natural', part: 'track', index: 2 });
  assert.equal(part.part, 'track'); assert.equal(part.index, 2);
  assert.equal(E.isEnvPick({ id }), true);
  assert.equal(E.isEnvPick({ id: { env: 'other' } }), false);
  assert.equal(E.isEnvPick({ id: { properties: {} } }), false);
  assert.equal(E.isEnvPick(null), false); assert.equal(E.isEnvPick({}), false);
  assert.equal(E.kindOf({ id: 'usgs:a' }), 'quake'); assert.equal(E.kindOf({ id: 'nws:a' }), 'alert'); assert.equal(E.kindOf({ id: 'eonet:a' }), 'natural'); assert.equal(E.kindOf({ id: 'nhc:a' }), 'cyclone'); assert.equal(E.kindOf({ id: 'x:a' }), 'event');
  assert.equal(E.providerOf('usgs:us7000tyhr'), 'usgs'); assert.equal(E.providerOf('nope'), 'nope');
});
test('factsFor puts the item\'s own time under its own label and never the fetch time', () => {
  const fetched = '2026-11-17T20:00:00.000Z';
  const quake = E.factsFor('quake', { id: 'usgs:a', title: 'Fixture region', lat: 1, lon: 2, observed_at: '2026-11-17T18:40:00.000Z', fetched_at: fetched, facts: [{ label: 'Magnitude', value: '6.2' }, { label: 'Depth', value: '35 km' }] });
  assert.equal(quake.observed_label, 'Observed'); assert.equal(quake.observed_at, '2026-11-17T18:40:00.000Z'); assert.equal(quake.observed_date_only, false);
  assert.deepEqual(quake.facts.slice(0, 2), [{ label: 'Magnitude', value: '6.2' }, { label: 'Depth', value: '35 km' }]);
  assert.equal(quake.title, 'Fixture region'); assert.equal(quake.lat, 1); assert.equal(quake.lon, 2); assert.equal(quake.modelled, false);
  const noMag = E.factsFor('quake', { id: 'usgs:b', title: 'x', lat: 1, lon: 2, observed_at: null, fetched_at: fetched, facts: [] });
  assert.ok(noMag.facts.some(f => /Magnitude not supplied/.test(f.value)));
  const cyclone = E.factsFor('cyclone', { id: 'nhc:fx', title: 'Tropical Storm Sara', lat: 16.2, lon: -83.4, observed_at: null, fetched_at: fetched, facts: [{ label: 'Classification', value: 'TS' }] });
  assert.equal(cyclone.observed_at, null, 'the fetch time never stands in'); assert.equal(cyclone.observed_label, 'unknown');
  const det = E.factsFor('fire_detection', { id: 'fire:NOAA-20:2026-11-17T10:00:00.000Z:-118.812:33.808', row: [-118.812, 33.808, 416.8, 'nominal', '2026-11-17T10:00:00.000Z', 'NOAA-20', 'D'] });
  assert.equal(det.observed_label, 'Acquired'); assert.equal(det.observed_at, '2026-11-17T10:00:00.000Z');
  assert.deepEqual(det.facts.map(f => f.label), ['Satellite', 'Radiative power', 'Confidence', 'Acquired', 'Overpass']);
  assert.equal(det.facts[1].value, '416.8 MW'); assert.equal(det.facts[4].value, 'day');
  const detNull = E.factsFor('fire_detection', { id: 'fire:x', row: [1, 2, null, null, '2026-11-17T10:00:00.000Z', 'NOAA-21', 'N'] });
  assert.equal(detNull.facts[1].value, 'not reported'); assert.equal(detNull.facts[2].value, 'not reported'); assert.equal(detNull.facts[4].value, 'night');
  const cell = E.factsFor('fire_cell', { id: 'cell:-119:34', cell: [-119, 34, 104, 18537.6, 416.8, '2026-11-17T19:30:00.000Z'] });
  assert.equal(cell.observed_label, 'Acquired'); assert.equal(cell.observed_at, '2026-11-17T19:30:00.000Z');
  assert.deepEqual(cell.facts.map(f => f.label), ['Detections', 'Summed radiative power', 'Peak radiative power', 'Latest overpass', 'Area']);
  assert.equal(cell.lat, 34.5); assert.equal(cell.lon, -118.5);
  const cell0 = E.factsFor('fire_cell', { id: 'cell:0:0', cell: [0, 0, 3, 0, null, '2026-11-17T19:30:00.000Z'] });
  assert.ok(cell0.facts.some(f => /FRP not reported/.test(f.value)));
  const per = E.factsFor('perimeter', { id: 'wfigs:a', name: 'Fixture Ridge', gis_acres: 45210.5, polygon_captured_at: '2026-11-17T06:10:00.000Z', last_edited_at: '2026-11-17T07:00:00.000Z', discovered_at: '2026-11-15T21:30:00.000Z', polygons: [[[[-118.9, 34.6], [-118.8, 34.6], [-118.8, 34.7], [-118.9, 34.6]]]], polygons_dropped: 1, geometry_truncated: true });
  assert.equal(per.observed_label, 'Captured'); assert.equal(per.observed_at, '2026-11-17T06:10:00.000Z'); assert.equal(per.title, 'Fixture Ridge');
  assert.ok(per.facts.some(f => f.label === 'GIS acres' && /45,210\.5|45210\.5/.test(f.value)));
  assert.ok(per.facts.some(f => /polygons dropped: 1/.test(f.value))); assert.ok(per.facts.some(f => /geometry truncated/.test(f.value)));
  assert.equal(per.lon, -118.9); assert.equal(per.lat, 34.6, 'the first vertex, never a centroid');
  const perNull = E.factsFor('perimeter', { id: 'wfigs:b', name: null, gis_acres: null, polygon_captured_at: null, polygons: [[[[0, 1], [0, 2], [1, 2], [0, 1]]]] });
  assert.ok(perNull.facts.some(f => f.label === 'GIS acres' && f.value === 'not supplied')); assert.equal(perNull.observed_at, null); assert.equal(perNull.observed_label, 'Captured');
  const alert = E.factsFor('alert', { id: 'nws:a', event: 'Flood Warning', headline: 'Flood Warning issued', severity: 'Severe', certainty: 'Likely', urgency: 'Expected', sent: '2026-11-17T15:21:00.000Z', onset: '2026-11-17T15:21:00.000Z', expires: '2026-11-24T18:00:00.000Z', ends: null, area: 'Maricopa, AZ', polygons: [[[[-113.33, 32.97], [-113.24, 33.01], [-113.19, 33.03], [-113.33, 32.97]]]] });
  assert.equal(alert.observed_label, 'Sent'); assert.equal(alert.observed_at, '2026-11-17T15:21:00.000Z'); assert.equal(alert.title, 'Flood Warning issued');
  assert.deepEqual(alert.facts.map(f => f.label), ['Event', 'Severity', 'Certainty', 'Urgency', 'Area', 'Sent', 'Onset', 'Expires', 'Ends']);
  assert.equal(alert.facts.at(-1).value, 'not supplied'); assert.equal(alert.lon, -113.33); assert.equal(alert.lat, 32.97);
  const nat = E.factsFor('natural', { event: { id: 'eonet:s', title: 'Tropical Cyclone Fengal', categories: ['Severe Storms'], kind: 'cyclone', reported_by: ['fixture'], track_count: 5, track_truncated: true }, point: { date: '2026-11-13T00:00:00.000Z', placeholder_time: true, type: 'Point', coordinates: [85.6, 8.1], magnitude: 35, unit: 'kts' } });
  assert.equal(nat.observed_label, 'Reported'); assert.equal(nat.observed_at, '2026-11-13T00:00:00.000Z'); assert.equal(nat.observed_date_only, true);
  assert.ok(nat.facts.some(f => f.label === 'Reported' && /date only \(time of day not reported\)/.test(f.value)));
  assert.ok(nat.facts.some(f => f.label === 'Magnitude' && f.value === '35 kts'));
  assert.ok(nat.facts.some(f => /track points: 5 \(truncated\)/.test(f.value)));
  assert.equal(nat.lon, 85.6); assert.equal(nat.lat, 8.1);
  const st = E.factsFor('station', { station: '8518750', place: 'The Battery, NY', name: 'The Battery', lon: -74.0142, lat: 40.7006, value_m: 1.024, observed_at: '2026-11-17T15:48:00.000Z', quality: 'preliminary', q: 'p', status: 'available', reason: null });
  assert.equal(st.observed_label, 'Observed'); assert.equal(st.observed_at, '2026-11-17T15:48:00.000Z');
  assert.ok(st.facts.some(f => f.label === 'Observed water level' && f.value === '1.024 m above MLLW'));
  assert.ok(st.facts.some(f => f.label === 'Quality' && f.value === 'preliminary'));
  assert.ok(st.facts.some(f => f.label === 'Status' && f.value === 'available'));
  const sm = E.factsFor('shakemap', { quake: { id: 'usgs:us7000tyhr', title: '20 km NW of Anamizu, Japan', lat: 37.3664, lon: 136.7444, observed_at: '2026-11-16T04:24:11.718Z', facts: [{ label: 'Magnitude', value: '5.4' }] }, shakemap: { version: 5, review_status: 'automatic', max_mmi: 2.9, process_time: '2026-11-17T04:28:22.000Z' }, contour: { mmi: 2.5, color: '#afd9ff' } });
  assert.equal(sm.observed_label, 'Computed'); assert.equal(sm.observed_at, '2026-11-17T04:28:22.000Z'); assert.equal(sm.modelled, true);
  assert.ok(sm.facts.some(f => f.label === 'ShakeMap' && f.value === 'modelled shaking (MMI), USGS ShakeMap v5 (automatic), max MMI 2.9, computed 2026-11-17T04:28:22.000Z'));
  assert.ok(sm.facts.some(f => f.label === 'Contour' && /MMI 2\.5/.test(f.value)));
  assert.equal(E.shakemapLabel({ version: 5, review_status: 'automatic', max_mmi: 2.9, process_time: '2026-11-17T04:28:22.000Z' }), 'modelled shaking (MMI), USGS ShakeMap v5 (automatic), max MMI 2.9, computed 2026-11-17T04:28:22.000Z');
  assert.doesNotMatch(JSON.stringify([quake, cyclone, det, cell, per, alert, nat, st, sm]), /2026-11-17T20:00:00/, 'no fetch time anywhere in a facts payload');
});
test('the encodings read no clock and the legend sentences name their quantities', () => {
  const begin = source.indexOf('ENCODINGS_BEGIN'), end = source.indexOf('ENCODINGS_END');
  assert.ok(begin > 0 && end > begin, 'the pure block is marked');
  assert.doesNotMatch(source.slice(begin, end), /Date\.now|performance\.now|new Date\(\)/);
  assert.match(E.legendFor('quakes'), /Disc area shows magnitude \(energy, 10\^1\.5M\), not the area affected; capped at 1,000 km/);
  assert.match(E.legendFor('quakes'), /colour shows depth: red shallow \(<33 km\) to blue deep \(>=300 km\)/);
  assert.match(E.legendFor('fires'), /375 m pixel/); assert.match(E.legendFor('fires'), /A detection is not a confirmed fire or a perimeter/);
  assert.match(E.legendFor('perimeters'), /operational mapping, not a legal boundary/);
  assert.match(E.legendFor('alerts'), /alerts that name zones only are listed, never placed/);
  assert.match(E.legendFor('eonet'), /not a forecast or an inferred path/);
  assert.match(E.legendFor('tides'), /MLLW, metres/); assert.match(E.legendFor('tides'), /Observations, never predictions or currents/);
  assert.match(E.legendFor('shakemap'), /modelled/); assert.doesNotMatch(E.legendFor('shakemap'), /measured/);
  assert.equal(E.RIPPLE_LABEL, 'Ripple is illustrative: not a recording of shaking');
});

/* event timeline slice S5 (2026-11-19): the fire summaries step back, the quake glyph is in the legend, and a documented rupture
   is called a model in words a visitor reads */
test('fire summary cells are drawn 1.1 times their radius across (44 px at most, no longer 80) at half opacity; their size still grows with the power', () => {
  assert.equal(E.cellPx(0), 4); assert.equal(E.cellPx(1e9), 44, 'the largest is 44 px');
  assert.ok(E.cellPx(10) < E.cellPx(1000), 'larger power, larger cell');
  assert.equal(E.CELL_ALPHA, 0.5);
  assert.equal(E.cellRadiusPx(1e9), 40, 'the radius encoding itself is unchanged');
});
test('the quake legend names the glyph and its label; a rupture is the modelled up-dip edge, and nothing drawn says why', () => {
  assert.match(E.legendFor('quakes'), /^Each quake is a seismograph glyph sized by magnitude; the largest are labelled with it \(M6\.3\) and a short place\./);
  assert.match(E.legendFor('rupture'), /modelled up-dip edge of the fault plane USGS estimated \(finite fault model\): a model, not a mapped crack/);
  assert.equal(E.RUPTURE_LABEL, 'modelled rupture plane (USGS finite fault)');
  assert.equal(E.ruptureLine({ available: true, top_depth_km: 0.1, model_created: '2026-11-03 14:59:26' }), 'modelled rupture plane (USGS finite fault): up-dip edge drawn, top at 0.1 km depth, model of 2026-11-03');
  assert.equal(E.ruptureLine({ available: false, reason: 'point_source' }), 'none drawn: USGS models this quake as a point (no finite-fault model)');
  assert.equal(E.ruptureLine({ available: false, reason: 'withdrawn' }), 'none drawn: USGS has withdrawn this event');
  assert.equal(E.ruptureLine({ available: false, reason: 'something new' }), 'none drawn');
  assert.doesNotMatch(source, /crack (drawn|shown)/i, 'never called a crack');
});
