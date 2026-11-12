import { reply } from '../lib/http.js';
import { exportCitations } from './citations.js';

const FORMATS = ['csl-json', 'bibtex', 'ris'];

function rows(value) {
  return Array.isArray(value) ? value : [];
}

async function body(request) {
  let value;
  try { value = await request.json(); }
  catch { throw Object.assign(new Error('Request body must be JSON'), { status: 400 }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Request body must be a JSON object'), { status: 400 });
  }
  return value;
}

function safeKey(value, name = 'key') {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
    throw Object.assign(new Error(`${name} is invalid`), { status: 400 });
  }
  return key;
}

async function projectByKey(env, sb, key) {
  const projectKey = safeKey(key, 'project_key');
  const projects = rows(await sb(
    env,
    `research_projects?key=eq.${encodeURIComponent(projectKey)}&select=*&limit=1`
  ));
  if (!projects.length) throw Object.assign(new Error('Research project not found'), { status: 404 });
  return projects[0];
}

async function citationExport(request, env, sb) {
  const input = await body(request);
  const format = String(input.format || 'csl-json').trim().toLowerCase();
  if (!FORMATS.includes(format)) {
    throw Object.assign(new Error('format must be csl-json, bibtex, or ris'), { status: 400 });
  }
  const keys = [...new Set((Array.isArray(input.citation_keys) ? input.citation_keys : [])
    .map((value) => safeKey(value, 'citation_key')))];
  if (!keys.length || keys.length > 200) {
    throw Object.assign(new Error('citation_keys must contain 1 to 200 keys'), { status: 400 });
  }
  const filter = keys.map((key) => `"${key.replace(/"/g, '')}"`).join(',');
  const sources = rows(await sb(
    env,
    `research_sources?citation_key=in.(${encodeURIComponent(filter)})&select=citation_key,title,authors,published_year,doi,canonical_url,source_type,category,relevance,verified_at,metadata&order=citation_key.asc`
  ));
  const found = new Set(sources.map((source) => String(source.citation_key)));
  const missing = keys.filter((key) => !found.has(key));
  const exported = exportCitations(sources, format);
  return {
    ok: true,
    format,
    content_type: exported.content_type,
    source_count: sources.length,
    missing,
    citations: exported.data,
    provenance: sources.map((source) => ({
      citation_key: source.citation_key,
      canonical_url: source.canonical_url,
      doi: source.doi || null,
      verified_at: source.verified_at || null
    }))
  };
}

async function projectPacket(env, sb, url) {
  const project = await projectByKey(env, sb, url.searchParams.get('project_key'));
  const [sources, artifacts, snapshots, claims] = await Promise.all([
    sb(env, 'research_sources?select=citation_key,title,authors,published_year,doi,canonical_url,source_type,category,relevance,verified_at&order=citation_key.asc'),
    sb(env, `research_artifacts?research_project_id=eq.${encodeURIComponent(project.id)}&select=*&order=created_at.asc`),
    sb(env, `research_evidence_snapshots?research_project_id=eq.${encodeURIComponent(project.id)}&select=*&order=captured_at.asc`).catch(() => []),
    sb(env, `research_claims?research_project_id=eq.${encodeURIComponent(project.id)}&select=*&order=created_at.asc`).catch(() => [])
  ]);
  const sourceRows = rows(sources);
  return {
    ok: true,
    project,
    evidence: rows(snapshots),
    claims: rows(claims),
    artifacts: rows(artifacts),
    bibliography: {
      count: sourceRows.length,
      csl_json: sourceRows.map((source) => exportCitations([source], 'csl-json').data[0])
    },
    publication_readiness: {
      has_question: Boolean(String(project.research_question || '').trim()),
      human_subjects_status: project.human_subjects_status,
      evidence_snapshots: rows(snapshots).length,
      claims: rows(claims).length,
      released_artifacts: rows(artifacts).filter((artifact) => artifact.status === 'released').length,
      citation_sources: sourceRows.length
    }
  };
}

export default {
  async fetch(request, env, options = {}) {
    if (typeof options.requireHouseOwner !== 'function' || typeof options.sb !== 'function') {
      throw Object.assign(new Error('Research Plane dependencies are unavailable'), { status: 503 });
    }
    await options.requireHouseOwner(request, env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if ((path === '/v1/research' || path === '/v1/research/capabilities') && request.method === 'GET') {
      return reply(request, env, {
        ok: true,
        service: 'mccluster-research-intelligence',
        privacy: {
          default_evidence_mode: 'aggregate',
          direct_identifiers_for_publication: false
        },
        capabilities: {
          project_registry: true,
          evidence_snapshots: true,
          claim_evidence_graph: true,
          citation_export: FORMATS,
          analytics_source: '/v1/analytics/audience-science',
          spatial_source: '/v1/seek-first',
          publication_pipeline: ['Zenodo', 'OSF', 'ORCID']
        }
      });
    }

    if (path === '/v1/research/projects' && request.method === 'GET') {
      const projects = rows(await options.sb(
        env,
        'research_projects?select=*&order=updated_at.desc'
      ));
      return reply(request, env, { ok: true, projects });
    }

    if (path === '/v1/research/sources' && request.method === 'GET') {
      const sources = rows(await options.sb(
        env,
        'research_sources?select=*&order=citation_key.asc'
      ));
      return reply(request, env, { ok: true, sources });
    }

    if (path === '/v1/research/citations/export' && request.method === 'POST') {
      return reply(request, env, await citationExport(request, env, options.sb));
    }

    if (path === '/v1/research/project-packet' && request.method === 'GET') {
      return reply(request, env, await projectPacket(env, options.sb, url));
    }

    return reply(request, env, { error: 'Research Plane route not found' }, 404);
  }
};
