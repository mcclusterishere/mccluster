import observations from '../../../core/data/equiquant/observations.json' with { type: 'json' };
import { MOSAIC_SOURCE } from '../../../core/src/equiquant-mosaic-contract.mjs';
import { fail, reply } from './lib/http.js';
import { requireMembership } from './workspaces.js';

// Present the very same versioned measurements that the Core executor reads.
// Only the primary configuration is shown in this first dataset browser.
const dataset = {
  title: 'MOSAiC sea-ice deformation',
  creators: 'Luisa von Albedyll and Nils Hutter (2023)',
  license: 'CC BY 4.0',
  doi: MOSAIC_SOURCE.dataset_doi,
  source_commit: MOSAIC_SOURCE.source_commit,
  observations_sha256: MOSAIC_SOURCE.observations_sha256,
  observations: observations.map(({ week, start, end, scenarios }) => ({
    week, start, end,
    proxy_per_day: scenarios.primary.proxy_per_day,
    target_per_day: scenarios.primary.target_per_day
  }))
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = value => typeof value === 'string' && UUID.test(value);
const ACTION_FIELDS = new Map(Object.entries({
  list: [], state: [], create: ['title'], invite: ['profile_id'], accept: [],
  evidence: ['role', 'credit_name', 'statement', 'consent'],
  replay: ['scenario'], review: ['evidence_ids', 'confirmed', 'job_id'], citation: []
}));

const SCENARIOS = ['pooled', 'group_levels', 'group_slopes'];
const DB_ERRORS = {
  '42501': [403, 'You do not have access to this project or action.'],
  P0002: [404, 'This project or workspace member is unavailable.'],
  '22023': [400, 'Check the information supplied for this action.'],
  '22P02': [400, 'An identifier is invalid.'],
  '23505': [409, 'A conflicting record already exists.'],
  '23514': [400, 'The supplied value is outside the supported range.'],
  '23503': [409, 'A related record is unavailable.']
};

function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function onlyFields(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key));
}

async function parseInput(request) {
  // Bound chunked bodies too. A review is a selection of evidence IDs, never a file.
  const reader = request.body?.getReader();
  if (!reader) throw problem('A JSON body is required.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        throw problem('Request is too large.', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(text + decoder.decode()); } catch { throw problem('Invalid JSON.'); }
  if (!onlyFields(body, ['org_id', 'action', 'project_id', 'data'])) throw problem('Unsupported request fields.');
  const { org_id, action, project_id = null, data = {} } = body;
  if (!isId(org_id) || !ACTION_FIELDS.has(action)) throw problem('A workspace and supported action are required.');
  if (project_id === null ? !['list', 'create'].includes(action) : !isId(project_id) || action === 'list') {
    throw problem('Invalid project identifier for this action.');
  }
  if (!onlyFields(data, ACTION_FIELDS.get(action))) throw problem('Unexpected action fields.');
  if (action === 'replay' && !SCENARIOS.includes(data.scenario)) throw problem('Choose an available model.');
  if (action === 'invite' && !isId(data.profile_id)) throw problem('Enter a workspace member profile ID.');
  if (action === 'review' && (!isId(data.job_id) || !Array.isArray(data.evidence_ids) ||
      !data.evidence_ids.length || !data.evidence_ids.every(isId) || data.confirmed !== true)) {
    throw problem('Select a completed run and evidence, then confirm the credits.');
  }
  if (action === 'evidence' && data.consent !== true) throw problem('Your consent is required to record a credit.');
  return { org_id, project_id, action, data };
}

function citationExport(release) {
  if (!release) throw problem('Review the release credits before exporting a citation.', 409);
  const authors = new Map();
  for (const credit of release.credits) {
    if (!authors.has(credit.profile_id)) authors.set(credit.profile_id, credit.credit_name);
  }
  const run = release.run;
  // The DOI belongs to the source dataset. The private release has its own local ID.
  return {
    filename: 'equity-quantized-' + release.id + '.csl.json',
    citation: {
      id: release.id,
      type: 'report',
      title: release.title,
      genre: 'Private research release',
      author: [...authors.values()].map(literal => ({ literal })),
      issued: { 'date-parts': [release.reviewed_at.slice(0, 10).split('-').map(Number)] },
      note: [
        'Reviewed CRediT roles: ' + release.credits.map(c => c.credit_name + ' (' + c.role + ')').join(', '),
        'Derived observations: Luisa von Albedyll & Nils Hutter (2023), PANGAEA, DOI ' + run.dataset_doi + ', CC BY 4.0',
        'MOSAiC pilot commit ' + run.source_commit,
        'Observations SHA-256 ' + run.observations_sha256,
        'Model ' + run.scenario + ', Core job ' + run.job_id,
        'Result SHA-256 ' + run.result_sha256
      ].join('. ') + '.'
    }
  };
}

export async function handleEquiquant(request, env, authenticate) {
  let response;
  try {
    if (request.method !== 'POST') throw problem('POST required.', 405);
    const user = await authenticate(request, env);
    if (!isId(user?.id)) throw problem('Sign in to your workspace.', 401);
    if (env.EQUIQUANT_ENABLED !== 'true') throw problem('The research workspace is unavailable.', 503);
    const input = await parseInput(request);
    await requireMembership(env, user, input.org_id);
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/equiquant_action', {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_actor: user.id, p_org: input.org_id, p_project: input.project_id,
        p_action: input.action === 'citation' ? 'state' : input.action, p_data: input.data
      })
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result) {
      const code = result?.code;
      // PT4xx denotes a deliberately raised business error with a safe message.
      if (/^PT4\d\d$/.test(code)) throw problem(result.message, Number(code.slice(2)));
      const [status, message] = Object.hasOwn(DB_ERRORS, code) ? DB_ERRORS[code] : [503, 'The research workspace is unavailable.'];
      throw problem(message, status);
    }
    let payload = result;
    if (input.action === 'citation') payload = citationExport(result.release);
    else if (['owner', 'member'].includes(result.project?.membership)) payload = { ...result, dataset };
    response = reply(request, env, payload);
  } catch (error) {
    response = fail(request, env, error.status < 500 ? error.message : 'The research workspace is unavailable.', error.status || 503);
  }
  response.headers.set('cache-control', 'private, no-store');
  return response;
}
