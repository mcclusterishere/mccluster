/* Private authoring on the existing media_workflows table. No generation,
   publishing, new queue, or schema change. Work projects remain their owners. */
import { requireMembership } from '../workspaces.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max) => { if (typeof v !== 'string' || v.length > max) fail('Text is missing or too long'); return v; };
const id = v => { if (!UUID.test(v || '')) fail('Invalid record id'); return v; };
async function boundedBody(request, max = 550000) {
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > max) { await reader.cancel(); fail('Plan request is too large', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('Invalid plan request'); }
}
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export async function planHash(v) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(v))))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function validatePlan(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('A plan is required');
  if (!text(p.title, 300).trim()) fail('Give the plan a title');
  text(p.script || '', 200000); text(p.canon || '', 30000); text(p.source_ref || '', 2000);
  if (p.work_project_id) id(p.work_project_id);
  if (!Array.isArray(p.scenes) || p.scenes.length > 100) fail('Use at most 100 scenes');
  const keys = new Set();
  for (const s of p.scenes) {
    if (!s || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || keys.has(s.id)) fail('Scene identifiers must be unique');
    keys.add(s.id);
    for (const [key, max] of [['title',300],['script',20000],['prompt',12000],['reference_notes',4000],['soundtrack',300]]) text(s[key] || '', max);
    if (!['draft','ready','review','selected'].includes(s.status || 'draft')) fail('Unknown scene status');
    if (s.model_id) id(s.model_id);
    if (s.input && (typeof s.input !== 'object' || Array.isArray(s.input))) fail('Scene inputs must be an object');
    if (stable(s.input || {}).length > 30000) fail('Scene references are too large; use asset links');
    if (!Array.isArray(s.takes || []) || (s.takes || []).length > 30) fail('Use at most 30 takes per scene');
    for (const t of s.takes || []) { id(t.job_id); if (t.asset_id) id(t.asset_id); }
    if (s.selected_asset_id) id(s.selected_asset_id);
    if (s.status === 'selected' && !s.selected_asset_id) fail('Select a completed take first');
  }
  if (new TextEncoder().encode(stable(p)).length > 500000) fail('Plan exceeds the authoring limit');
  return JSON.parse(JSON.stringify(p));
}
async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json', prefer: 'return=representation', ...(options.headers || {})
  } });
  const data = await res.json().catch(() => null);
  if (!res.ok) fail(res.status === 404 || data?.code === '42P01' ? 'Production plan storage is not available on this deployment' : 'Production plan storage request failed', 503);
  return data;
}
function projection(row) {
  const c = row?.config;
  if (!c || c.kind !== 'production-plan/v1') fail('Production plan not found', 404);
  return { id: row.id, updated_at: row.updated_at, revision: c.revision, hash: c.hash,
    plan: c.plan, history: c.history || [], saved_at: c.saved_at };
}
export async function handlePlans(request, env, user) {
  const u = new URL(request.url), match = u.pathname.match(/^\/v1\/media\/plans(?:\/([0-9a-f-]{36}))?$/i);
  if (!match) fail('Plan route not found', 404);
  const writing = ['POST','PATCH'].includes(request.method);
  if (!writing && request.method !== 'GET') fail('Method not allowed', 405);
  const body = writing ? await boundedBody(request) : {};
  const membership = await requireMembership(env, user, body.org_id || u.searchParams.get('org_id'));
  if (membership.role !== 'owner') fail('Only the workspace owner may open production plans', 403);
  const org = encodeURIComponent(membership.org_id), key = match[1] ? id(match[1]) : null;
  const filter = `org_id=eq.${org}&config->>kind=eq.production-plan/v1`;
  if (request.method === 'GET') {
    if (!key) return { plans: (await db(env, `media_workflows?${filter}&select=id,name,updated_at,config->revision,config->hash&order=updated_at.desc&limit=100`) || []) };
    return { saved: projection((await db(env, `media_workflows?${filter}&id=eq.${key}&select=*&limit=1`))?.[0]) };
  }
  if ((request.method === 'POST' && key) || (request.method === 'PATCH' && !key)) fail('Invalid plan write route');
  const plan = validatePlan(body.plan);
  const createId = !key ? id(body.client_id) : null;
  if (createId) {
    const found = (await db(env, `media_workflows?${filter}&id=eq.${createId}&select=*&limit=1`))?.[0];
    if (found) {
      const prior = projection(found);
      if (prior.hash === await planHash(plan)) return { saved: prior, changed: false };
      fail('This new plan was already saved with different content. Reload it before saving again.', 409);
    }
  }
  if (plan.work_project_id) {
    const project = await db(env, `work_projects?org_id=eq.${org}&id=eq.${plan.work_project_id}&select=id&limit=1`);
    if (!project?.length) fail('Linked Work project was not found', 404);
  }
  // A selected output is always an existing completed job's asset in this org.
  for (const scene of plan.scenes) {
    if (!scene.selected_asset_id) continue;
    const take = (scene.takes || []).find(t => t.asset_id === scene.selected_asset_id);
    if (!take) fail('Selected take is missing from this scene');
    const assets = await db(env, `media_assets?org_id=eq.${org}&id=eq.${id(take.asset_id)}&job_id=eq.${id(take.job_id)}&select=id&limit=1`);
    const jobs = await db(env, `media_jobs?org_id=eq.${org}&id=eq.${take.job_id}&status=eq.completed&select=id&limit=1`);
    if (!assets?.length || !jobs?.length) fail('Selected take is not a completed output in this workspace');
  }
  let previous = null, history = [], revision = 1;
  if (key) {
    previous = projection((await db(env, `media_workflows?${filter}&id=eq.${key}&select=*&limit=1`))?.[0]);
    if (body.expected_revision !== previous.revision || body.expected_hash !== previous.hash) fail('This plan changed elsewhere. Reload before saving; your draft is still here.', 409);
    history = previous.history.concat([{ revision: previous.revision, hash: previous.hash, saved_at: previous.saved_at, plan: previous.plan }]);
    revision = previous.revision + 1;
  }
  const hash = await planHash(plan), now = new Date().toISOString();
  if (previous && hash === previous.hash) return { saved: previous, changed: false };
  const config = { kind: 'production-plan/v1', revision, hash, saved_at: now, plan, history };
  if (new TextEncoder().encode(stable(config)).length > 8000000) fail('Saved history is full. Export this plan and create a continuation; no history was removed.', 413);
  const path = key ? `media_workflows?${filter}&id=eq.${key}&updated_at=eq.${encodeURIComponent(previous.updated_at)}&config->>hash=eq.${previous.hash}` : 'media_workflows';
  const rows = await db(env, path, { method: key ? 'PATCH' : 'POST', body: JSON.stringify({
    name: plan.title, objective: 'Private story production plan', status: 'draft', config, updated_at: now,
    ...(key ? {} : { id: createId, org_id: membership.org_id, created_by: user.id })
  }) });
  if (!rows?.[0]) fail('This plan changed during save. Reload before trying again.', 409);
  return { saved: projection(rows[0]), changed: true };
}

/* Reference library reuses media_entities, separate from agent/persona creation.
   References are owner-authored instructions, never a verification of likeness. */
export async function handleReferences(request, env, user) {
  const u = new URL(request.url);
  if (!['GET','POST'].includes(request.method)) fail('Method not allowed', 405);
  const body = request.method === 'POST' ? await boundedBody(request, 15000) : {};
  const m = await requireMembership(env, user, body.org_id || u.searchParams.get('org_id'));
  if (m.role !== 'owner') fail('Only the workspace owner may open references', 403);
  const org = encodeURIComponent(m.org_id);
  if (request.method === 'GET') return { references: await db(env, `media_entities?org_id=eq.${org}&entity_type=eq.production-reference&active=eq.true&select=id,name,description,canonical_prompt,attributes&order=name.asc&limit=100`) || [] };
  const name = text(body.name, 120).trim(), description = text(body.description || '', 4000), prompt = text(body.prompt || '', 4000);
  if (!name) fail('Name the reference');
  const url = text(body.url, 2000); let parsed; try { parsed = new URL(url); } catch { fail('Use an HTTPS reference URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('Use an HTTPS reference URL without credentials');
  if (body.owned !== true) fail('Confirm that this is your reference or that you may use it');
  const rows = await db(env, 'media_entities', { method: 'POST', body: JSON.stringify({
    org_id: m.org_id, entity_type: 'production-reference', name, slug: 'production-' + crypto.randomUUID(),
    description, canonical_prompt: prompt, attributes: { url, owner_asserted: true, created_by: user.id }, active: true
  }) });
  if (!rows?.[0]) fail('The reference save was not confirmed', 502);
  return { reference: rows[0] };
}
