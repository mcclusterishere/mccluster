import test from 'node:test';
import assert from 'node:assert/strict';

import research from '../src/research/index.js';
import { exportCitations } from '../src/research/citations.js';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const OWNER = { id: 'owner' };

const SOURCE = {
  citation_key: 'smith_2026',
  title: 'Measured Systems',
  authors: [{ family: 'Smith', given: 'Ada' }],
  published_year: 2026,
  doi: '10.1234/example',
  canonical_url: 'https://example.org/paper',
  source_type: 'paper',
  category: 'methods',
  relevance: 'Methods reference',
  verified_at: '2026-10-12T00:00:00Z'
};

test('citation exporter produces CSL JSON, BibTeX and RIS without inventing metadata', () => {
  const csl = exportCitations([SOURCE], 'csl-json').data[0];
  assert.equal(csl.title, SOURCE.title);
  assert.equal(csl.DOI, SOURCE.doi);
  assert.equal(csl.author[0].family, 'Smith');
  assert.equal('publisher' in csl, false);

  const bib = exportCitations([SOURCE], 'bibtex').data;
  assert.match(bib, /@article\{smith_2026/);
  assert.match(bib, /doi = \{10\.1234\/example\}/);

  const ris = exportCitations([SOURCE], 'ris').data;
  assert.match(ris, /TY  - JOUR/);
  assert.match(ris, /DO  - 10\.1234\/example/);
});

function options({ sources = [SOURCE] } = {}) {
  return {
    requireHouseOwner: async () => OWNER,
    sb: async (_env, path) => {
      if (path.startsWith('research_sources?citation_key=')) return sources;
      if (path.startsWith('research_sources?select=')) return sources;
      if (path.startsWith('research_projects?key=')) return [{
        id: '11111111-1111-4111-8111-111111111111',
        key: 'lab',
        title: 'Lab',
        research_question: 'What happened?',
        human_subjects_status: 'undetermined'
      }];
      if (path.startsWith('research_projects?select=')) return [];
      if (path.startsWith('research_artifacts?')) return [];
      if (path.startsWith('research_evidence_snapshots?')) return [];
      if (path.startsWith('research_claims?')) return [];
      throw new Error('unexpected path ' + path);
    }
  };
}

test('research routes require the house owner before reading research data', async () => {
  let reads = 0;
  const opts = {
    requireHouseOwner: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); },
    sb: async () => { reads++; return []; }
  };
  await assert.rejects(
    () => research.fetch(new Request('https://api.mccluster.org/v1/research/projects'), env, opts),
    (error) => error.status === 403
  );
  assert.equal(reads, 0);
});

test('citation export reports missing keys and preserves verified provenance', async () => {
  const request = new Request('https://api.mccluster.org/v1/research/citations/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ citation_keys: ['smith_2026', 'missing_source'], format: 'csl-json' })
  });
  const response = await research.fetch(request, env, options());
  assert.equal(response.status, 200);
  const out = await response.json();
  assert.deepEqual(out.missing, ['missing_source']);
  assert.equal(out.provenance[0].verified_at, SOURCE.verified_at);
  assert.equal(out.citations[0].DOI, SOURCE.doi);
});

test('project packet exposes evidence and publication readiness without raw visitor rows', async () => {
  const response = await research.fetch(
    new Request('https://api.mccluster.org/v1/research/project-packet?project_key=lab'),
    env,
    options()
  );
  assert.equal(response.status, 200);
  const out = await response.json();
  assert.equal(out.project.key, 'lab');
  assert.equal(out.publication_readiness.citation_sources, 1);
  assert.deepEqual(out.evidence, []);
  assert.equal('visitors' in out, false);
});
