import { allowedOrigins } from '../lib/http.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const MAX_CANDIDATES = 50;
const MAX_ID = 160;
const MAX_META_KEYS = 12;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function db(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers || {})
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw Object.assign(new Error('Experience database request failed'), {
      status: 502,
      detail: body
    });
  }
  return body;
}

async function rows(env, path) {
  const body = await db(env, path);
  return Array.isArray(body) ? body : [];
}

function clean(value, max = MAX_ID) {
  const s = String(value || '').trim();
  return s ? s.slice(0, max) : null;
}

function compactMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, MAX_META_KEYS)) {
    const k = clean(key, 64);
    if (!k) continue;
    if (typeof raw === 'string') out[k] = raw.slice(0, 240);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[k] = raw;
    else if (typeof raw === 'boolean') out[k] = raw;
    else if (Array.isArray(raw)) out[k] = raw.slice(0, 12).map((x) => String(x).slice(0, 120));
  }
  return out;
}

function compactCandidate(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = clean(value.id);
  if (!id) return null;
  return {
    id,
    kind: clean(value.kind, 64) || 'content',
    position: Number.isFinite(Number(value.position)) ? Number(value.position) : index,
    meta: compactMeta(value.meta)
  };
}

async function hmacHex(secret, text) {
  const enc = new TextEncoder();
  if (secret) {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unitInterval(hex) {
  const n = Number.parseInt(String(hex).slice(0, 13), 16);
  return Number.isFinite(n) ? n / 0x10000000000000 : 0;
}

async function subjectHash(env, user, deviceId) {
  const subject = user?.id ? `u:${user.id}` : `d:${deviceId}`;
  const secret = env.EXPERIENCE_ASSIGNMENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  return hmacHex(secret, `mccluster:experience:subject:v1:${subject}`);
}

async function activeExperiment(env, surfaceId, subjectKeyHash) {
  const now = new Date().toISOString();
  const exps = await rows(env,
    'experience_experiments?' +
    `surface_id=eq.${encodeURIComponent(surfaceId)}&status=in.(canary,running)` +
    `&allocation=gt.0&or=(started_at.is.null,started_at.lte.${encodeURIComponent(now)})` +
    `&or=(ended_at.is.null,ended_at.gt.${encodeURIComponent(now)})` +
    '&select=id,key,allocation,intent,research_review,consent_mode,status,started_at,created_at' +
    '&order=started_at.asc.nullsfirst,created_at.asc&limit=5'
  );
  if (!exps.length) return null;

  const secret = env.EXPERIENCE_ASSIGNMENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  for (const exp of exps) {
    if (exp.intent === 'research' && !['exempt', 'approved'].includes(exp.research_review)) continue;
    const gate = unitInterval(await hmacHex(secret, `mccluster:experience:gate:v1:${exp.id}:${subjectKeyHash}`));
    if (gate < Number(exp.allocation || 0)) return exp;
  }
  return null;
}

async function assignedArm(env, experiment, subjectKeyHash) {
  const existing = await rows(env,
    'experience_assignments?' +
    `experiment_id=eq.${encodeURIComponent(experiment.id)}` +
    `&subject_key_hash=eq.${encodeURIComponent(subjectKeyHash)}` +
    '&assignment_version=eq.1&select=arm_key&limit=1'
  );
  if (existing[0]?.arm_key) return existing[0].arm_key;

  const arms = await rows(env,
    'experience_experiment_arms?' +
    `experiment_id=eq.${encodeURIComponent(experiment.id)}` +
    '&select=arm_key,policy_id,weight,is_control&order=arm_key.asc'
  );
  const total = arms.reduce((sum, arm) => sum + Math.max(0, Number(arm.weight || 0)), 0);
  if (!arms.length || total <= 0) return null;

  const secret = env.EXPERIENCE_ASSIGNMENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  let pick = unitInterval(await hmacHex(secret, `mccluster:experience:arm:v1:${experiment.id}:${subjectKeyHash}`)) * total;
  let selected = arms[arms.length - 1];
  for (const arm of arms) {
    pick -= Math.max(0, Number(arm.weight || 0));
    if (pick < 0) { selected = arm; break; }
  }

  await db(env, 'experience_assignments?on_conflict=experiment_id,subject_key_hash,assignment_version', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{
      experiment_id: experiment.id,
      subject_key_hash: subjectKeyHash,
      arm_key: selected.arm_key,
      assignment_version: 1
    }])
  });
  return selected.arm_key;
}

async function policyForArm(env, experimentId, armKey) {
  const links = await rows(env,
    'experience_experiment_arms?' +
    `experiment_id=eq.${encodeURIComponent(experimentId)}&arm_key=eq.${encodeURIComponent(armKey)}` +
    '&select=policy_id&limit=1'
  );
  if (!links[0]?.policy_id) return null;
  const policies = await rows(env,
    'experience_policies?' +
    `id=eq.${encodeURIComponent(links[0].policy_id)}&enabled=eq.true` +
    '&select=id,key,version,plane,mode,algorithm,config&limit=1'
  );
  return policies[0] || null;
}

async function productionPolicy(env) {
  const policies = await rows(env,
    'experience_policies?key=eq.control-order&version=eq.v1&plane=eq.production&enabled=eq.true' +
    '&select=id,key,version,plane,mode,algorithm,config&limit=1'
  );
  return policies[0] || null;
}

function applyPolicy(policy, candidates, maxItems) {
  // Evidence Plane v1 intentionally implements only the identity policy.
  // Research policies are added in a later PR and cannot affect live traffic
  // merely by appearing in the registry.
  if (!policy || policy.algorithm !== 'identity_order') return null;
  const selected = candidates.slice(0, maxItems);
  return {
    selected,
    propensities: selected.map((c) => ({ id: c.id, probability: 1 })),
    reasons: ['evidence_plane_v1', 'caller_order_preserved']
  };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

export async function handleExperienceRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path !== '/v1/experience/decide') return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!allowedOrigin(request, env)) return json({ ok: false, error: 'Origin not allowed' }, 403);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const surfaceKey = clean(body?.surface, 80);
  const deviceId = clean(body?.device_id, 64);
  const sessionId = clean(body?.session_id, 64);
  if (!surfaceKey) return json({ ok: false, error: 'surface required' }, 400);
  if (!user?.id && !deviceId) return json({ ok: false, error: 'device_id required for anonymous decisions' }, 400);

  const input = Array.isArray(body?.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : [];
  const candidates = input.map(compactCandidate).filter(Boolean);
  if (!candidates.length) return json({ ok: false, error: 'At least one candidate is required' }, 400);
  const maxItems = Math.max(1, Math.min(candidates.length, Number(body?.max_items) || candidates.length));

  const surfaces = await rows(env,
    `experience_surfaces?key=eq.${encodeURIComponent(surfaceKey)}&enabled=eq.true` +
    '&select=id,key,risk_tier,allowed_mutations&limit=1'
  );
  const surface = surfaces[0];
  if (!surface) return json({ ok: false, error: 'Unknown or disabled experience surface' }, 404);

  const subjectKeyHash = await subjectHash(env, user, deviceId);
  const control = await productionPolicy(env);
  if (!control) return json({ ok: false, error: 'Production experience policy is not configured' }, 503);

  let experiment = await activeExperiment(env, surface.id, subjectKeyHash);
  let armKey = null;
  let policy = control;
  const reasonCodes = [];

  if (experiment) {
    armKey = await assignedArm(env, experiment, subjectKeyHash);
    const experimental = armKey ? await policyForArm(env, experiment.id, armKey) : null;
    const result = applyPolicy(experimental, candidates, maxItems);
    if (result && ['live', 'promoted'].includes(experimental.mode)) {
      policy = experimental;
    } else {
      // Unsupported/shadow policies never silently alter production traffic.
      reasonCodes.push('experiment_fallback_to_control');
      experiment = null;
      armKey = null;
    }
  }

  const result = applyPolicy(policy, candidates, maxItems);
  if (!result) return json({ ok: false, error: 'Experience policy is not executable' }, 503);
  reasonCodes.push(...result.reasons);

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const context = compactMeta(body?.context);
  const inserted = await db(env, 'experience_decisions?select=id,created_at', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify([{
      surface_id: surface.id,
      subject_key_hash: subjectKeyHash,
      session_id: sessionId,
      policy_id: policy.id,
      experiment_id: experiment?.id || null,
      arm_key: armKey,
      eligible_candidates: candidates,
      selected_candidates: result.selected,
      propensities: result.propensities,
      reason_codes: reasonCodes,
      objective_weights: {},
      client_context: context,
      expires_at: expiresAt
    }])
  });
  const decision = Array.isArray(inserted) ? inserted[0] : null;
  if (!decision?.id) return json({ ok: false, error: 'Decision was not recorded' }, 502);

  return json({
    ok: true,
    evidence_only: policy.key === 'control-order' && policy.version === 'v1',
    decision_id: decision.id,
    surface: surface.key,
    policy: { key: policy.key, version: policy.version, plane: policy.plane, algorithm: policy.algorithm },
    experiment: experiment ? { key: experiment.key, arm: armKey } : null,
    candidates: result.selected,
    propensities: result.propensities,
    reason_codes: reasonCodes,
    expires_at: expiresAt
  });
}
