import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLANETARY_SOURCES, objectIndexSources, directSources, planetaryByKey
} from '../src/seek-first/planetary.js';
import { SOURCE_CLASSES, PERSISTENCE } from '../src/seek-first/source-registry.js';
import { SOURCES } from '../src/seek-first/source-registry.js';

test('the planetary sources cover the physical systems, not just built objects', () => {
  const caps = new Set(PLANETARY_SOURCES.flatMap((s) => s.capabilities));
  for (const required of ['radar', 'wind', 'currents', 'lightning', 'seismic', 'space_weather', 'tides']) {
    assert.ok(caps.has(required), `no source provides ${required}`);
  }
});

test('field sources are indexed, never ingested — that is what makes the scale possible', () => {
  const indexed = objectIndexSources();
  assert.ok(indexed.length >= 6, 'expected the gridded/binary sources to be index-only');
  for (const source of indexed) {
    assert.equal(source.persistence, PERSISTENCE.TRANSIENT,
      `${source.key} is a gridded field; copying every timestep is not viable, so it must not be marked persistent`);
    assert.equal(source.adapter, null, `${source.key} must not claim a row adapter`);
  }
});

test('direct sources return rows and declare an adapter', () => {
  const direct = directSources();
  assert.ok(direct.length >= 4);
  for (const source of direct) {
    assert.equal(typeof source.adapter, 'string');
    assert.equal(source.transport, 'http');
  }
});

test('every planetary source is keyless, open, and attributed', () => {
  for (const source of PLANETARY_SOURCES) {
    assert.equal(source.credentialEnv.length, 0, `${source.key} should need no credential`);
    assert.equal(source.sourceClass, SOURCE_CLASSES.PUBLIC_OPEN, source.key);
    assert.ok(source.attribution && source.attribution.length > 4, `${source.key} has no attribution`);
    assert.ok(source.upstream.startsWith('https://'), `${source.key} upstream must be https`);
    assert.ok(source.cadence, `${source.key} must state its cadence`);
  }
});

test('planetary keys do not collide with the existing adapter registry', () => {
  const existing = new Set(SOURCES.map((s) => s.key));
  for (const source of PLANETARY_SOURCES) {
    assert.ok(!existing.has(source.key), `${source.key} collides with an existing source key`);
  }
});

test('keys are unique within the planetary set and resolvable', () => {
  const keys = PLANETARY_SOURCES.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate planetary source key');
  assert.equal(planetaryByKey('nexrad_level2').capabilities.includes('velocity'), true);
  assert.equal(planetaryByKey('rtofs').capabilities.includes('currents'), true);
  assert.equal(planetaryByKey('nope'), null);
});
