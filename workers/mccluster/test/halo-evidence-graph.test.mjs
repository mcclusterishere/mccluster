import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHaloEvidenceGraph } from '../src/seek-first/halo-evidence-graph.js';
import { sourceToCsl, sourcesToBibtex, sourcesToRis } from '../src/seek-first/halo-citations.js';

const entities = [
  { external_id: 'pdb:fac:1', name: 'Facility', source: 'peeringdb', point: { lat: 41, lon: -72 }, source_url: 'https://www.peeringdb.com/' },
  { external_id: 'atlas:probe:2', name: 'Probe', source: 'ripe_atlas', point: { lat: 41.1, lon: -72.1 } }
];
test('Halo graph never invents proximity edges', () => {
  const graph = buildHaloEvidenceGraph({ entities });
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.inferred_links, 0);
});
test('Halo graph accepts only explicit attributed links to known nodes', () => {
  const graph = buildHaloEvidenceGraph({ entities, links: [
    { from: 'pdb:fac:1', to: 'atlas:probe:2', relationship: 'connects', source_url: 'https://example.org/evidence' },
    { from: 'pdb:fac:1', to: 'atlas:probe:2', relationship: 'connects' },
    { from: 'pdb:fac:1', to: 'missing', relationship: 'connects', source_url: 'https://example.org/evidence' }
  ] });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source_url, 'https://example.org/evidence');
});
test('Halo graph enforces node bounds', () => {
  assert.throws(() => buildHaloEvidenceGraph({ entities, maxNodes: 1 }), RangeError);
});
test('Halo citation exports preserve source URL and title', () => {
  const source = { citation_key: 'peeringdb-facilities', source_type: 'dataset', title: 'PeeringDB facilities', canonical_url: 'https://www.peeringdb.com/' };
  assert.equal(sourceToCsl(source).URL, source.canonical_url);
  assert.match(sourcesToBibtex([source]), /PeeringDB facilities/);
  assert.match(sourcesToRis([source]), /peeringdb\.com/);
});
