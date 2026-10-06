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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function safeConfig(policy) {
  return policy && policy.config && typeof policy.config === 'object' && !Array.isArray(policy.config)
    ? policy.config : {};
}

async function currentMuid(env, user) {
  if (!user?.id) return null;
  const links = await rows(env,
    'm_auth_user_links?' +
    `auth_user_id=eq.${encodeURIComponent(user.id)}&is_primary=eq.true&select=m_uid&limit=1`
  );
  return links[0]?.m_uid || null;
}

async function explicitPreferences(env, mUid, surfaceKey) {
  if (!mUid) return {};
  const prefs = await rows(env,
    'experience_preferences?' +
    `m_uid=eq.${encodeURIComponent(mUid)}&namespace=eq.${encodeURIComponent(surfaceKey)}` +
    '&revoked_at=is.null&select=key,value,source,updated_at&limit=200'
  );
  return Object.fromEntries(prefs.map((p) => [String(p.key), String(p.value)]));
}

async function recentEvents(env, user, deviceId, windowDays) {
  const days = Math.max(1, Math.min(30, Number(windowDays) || 14));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const subject = user?.id
    ? `uid=eq.${encodeURIComponent(user.id)}`
    : `device_id=eq.${encodeURIComponent(deviceId)}`;
  return rows(env,
    'events?' + subject +
    `&at=gte.${encodeURIComponent(since)}` +
    '&select=at,name,path,props&order=at.desc&limit=250'
  );
}

function eventWeight(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'experience_outcome') return 1;
  if (n === 'experience_interaction') return 0.8;
  if (n === 'experience_dismissed') return -0.7;
  if (n === 'experience_visible') return 0.12;
  if (/conversion|purchase|checkout.*success|mission_(created|joined|taken)|assignment_created/.test(n)) return 0.95;
  if (/complete|finish|verified/.test(n)) return 0.85;
  if (/rotation_add|save|follow|signup|account_created/.test(n)) return 0.7;
  if (/album_play|music_video_view|listen|play/.test(n)) return 0.55;
  if (/cta|open|search|view/.test(n)) return 0.3;
  if (/rotation_drop|unfollow|cancel/.test(n)) return -0.35;
  return 0.18;
}

function textForEvent(event) {
  const props = event?.props && typeof event.props === 'object' ? event.props : {};
  return [
    event?.name, event?.path, props.track, props.album, props.album_slug,
    props.campaign, props.candidate_id, props.domain, props.topic, props.goal,
    props.surface, props.label
  ].filter(Boolean).join(' ').toLowerCase();
}

function candidateMatch(event, candidate, surfaceKey) {
  const props = event?.props && typeof event.props === 'object' ? event.props : {};
  const candidateId = String(candidate.id || '');
  if (String(props.candidate_id || '') === candidateId) return 1;

  if (surfaceKey === 'action.next_step' && candidateId.startsWith('campaign:')) {
    const slug = candidateId.slice('campaign:'.length);
    if ([props.campaign, props.action_campaign_id, props.slug].some((x) => String(x || '') === slug)) return 0.9;
  }

  const text = textForEvent(event);
  const domain = String(candidate.meta?.domain || '').toLowerCase();
  if (domain === 'music' && /music|song|track|album|listen|lyric|rotation|video/.test(text)) return 0.45;
  if ((domain === 'action' || domain === 'civic') && /action|mission|campaign|proof|receipt|civic/.test(text)) return 0.45;
  if (domain === 'client' && /hire|offer|lead|quote|book|service|checkout|client/.test(text)) return 0.45;
  if (domain === 'artist' && /creator|artist|release|studio|collab|publish/.test(text)) return 0.45;

  const topic = String(candidate.meta?.topic || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (topic && topic.split(/\s+/).some((token) => token.length > 3 && text.includes(token))) return 0.35;
  return 0;
}

function featureVector(events, candidates, surfaceKey, prefs, policy) {
  const cfg = safeConfig(policy);
  const weights = cfg.weights || {};
  const fatigueCfg = cfg.fatigue || {};
  const businessMap = (cfg.business_priority && cfg.business_priority[surfaceKey]) || {};
  const now = Date.now();
  const halfLifeDays = 7;
  const total = Math.max(1, candidates.length - 1);
  const features = candidates.map((candidate, index) => {
    let signal = 0, visible = 0, answered = 0;
    for (const event of events) {
      const match = candidateMatch(event, candidate, surfaceKey);
      if (!match) continue;
      const ageDays = Math.max(0, (now - Date.parse(event.at || 0)) / 864e5);
      const decay = Number.isFinite(ageDays) ? Math.pow(0.5, ageDays / halfLifeDays) : 0;
      const props = event?.props && typeof event.props === 'object' ? event.props : {};
      const exact = String(props.candidate_id || '') === String(candidate.id);
      if (exact && event.name === 'experience_visible') visible += 1;
      if (exact && ['experience_interaction','experience_outcome','experience_dismissed'].includes(event.name)) answered += 1;
      signal += eventWeight(event.name) * match * decay;
    }
    const recentAffinity = clamp01(signal <= 0 ? 0 : 1 - Math.exp(-signal / 2.5));
    const preference = prefs[candidate.id] === 'more' ? 1 : prefs[candidate.id] === 'less' ? -1 : 0;
    const unanswered = Math.max(0, visible - answered);
    const fatiguePenalty = Math.min(
      Number(fatigueCfg.max_penalty ?? 0.48),
      unanswered * Number(fatigueCfg.per_unanswered_visible ?? 0.12)
    );
    const novelty = 1 / (1 + visible);
    const editorialPrior = candidates.length === 1 ? 1 : 1 - (index / total);
    const businessPriority = clamp01(Number(businessMap[candidate.id] || 0));
    const baseScore =
      Number(weights.editorial_prior ?? 0.20) * editorialPrior +
      Number(weights.recent_affinity ?? 0.35) * recentAffinity +
      Number(weights.explicit_preference ?? 0.30) * preference +
      Number(weights.novelty ?? 0.10) * novelty +
      Number(weights.business_priority ?? 0.05) * businessPriority -
      fatiguePenalty;
    return {
      id: candidate.id,
      editorial_prior: Number(editorialPrior.toFixed(4)),
      recent_affinity: Number(recentAffinity.toFixed(4)),
      explicit_preference: preference,
      visible_count: visible,
      answered_count: answered,
      novelty: Number(novelty.toFixed(4)),
      fatigue_penalty: Number(fatiguePenalty.toFixed(4)),
      business_priority: businessPriority,
      base_score: Number(baseScore.toFixed(5))
    };
  });
  return {
    schema_version: String(cfg.feature_schema || 'production-v1'),
    window_days: Math.max(1, Math.min(30, Number(cfg.behavior_window_days) || 14)),
    event_count: events.length,
    candidate_features: features
  };
}

function diversityPenalty(candidate, selected, config) {
  const div = config?.diversity || {};
  let penalty = 0;
  for (const chosen of selected) {
    if (candidate.meta?.domain && candidate.meta.domain === chosen.meta?.domain) {
      penalty = Math.max(penalty, Number(div.same_domain_penalty || 0));
    }
    if (candidate.kind && candidate.kind === chosen.kind) {
      penalty = Math.max(penalty, Number(div.same_kind_penalty || 0));
    }
    if (candidate.meta?.topic && candidate.meta.topic === chosen.meta?.topic) {
      penalty = Math.max(penalty, Number(div.same_topic_penalty || 0));
    }
  }
  return penalty;
}

async function storeFeatureSnapshot(env, subjectKeyHash, features) {
  const inserted = await db(env, 'experience_feature_snapshots?select=id', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify([{
      subject_key_hash: subjectKeyHash,
      schema_version: features.schema_version,
      features
    }])
  });
  return Array.isArray(inserted) ? inserted[0]?.id || null : null;
}

function sameOpportunity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((row, i) => String(row?.id || '') === String(b[i]?.id || ''));
}

async function reusableDecision(env, surfaceId, subjectKeyHash, policyId, candidates, maxItems) {
  const now = new Date().toISOString();
  const prior = await rows(env,
    'experience_decisions?' +
    `surface_id=eq.${encodeURIComponent(surfaceId)}&subject_key_hash=eq.${encodeURIComponent(subjectKeyHash)}` +
    `&policy_id=eq.${encodeURIComponent(policyId)}&experiment_id=is.null&expires_at=gt.${encodeURIComponent(now)}` +
    '&select=id,eligible_candidates,selected_candidates,propensities,reason_codes,objective_weights,feature_snapshot_id,expires_at' +
    '&order=created_at.desc&limit=3'
  );
  return prior.find((d) => sameOpportunity(d.eligible_candidates, candidates) &&
    Array.isArray(d.selected_candidates) && d.selected_candidates.length === maxItems) || null;
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
    '&allocation=gt.0' +
    '&select=id,key,allocation,intent,research_review,consent_mode,status,started_at,ended_at,created_at' +
    '&order=started_at.asc.nullsfirst,created_at.asc&limit=20'
  );
  if (!exps.length) return null;

  const nowMs = Date.parse(now);
  const secret = env.EXPERIENCE_ASSIGNMENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  for (const exp of exps) {
    const startMs = exp.started_at ? Date.parse(exp.started_at) : null;
    const endMs = exp.ended_at ? Date.parse(exp.ended_at) : null;
    if (Number.isFinite(startMs) && startMs > nowMs) continue;
    if (Number.isFinite(endMs) && endMs <= nowMs) continue;
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
  const mature = await rows(env,
    'experience_policies?key=eq.production-mature&version=eq.v1&plane=eq.production&enabled=eq.true' +
    '&select=id,key,version,plane,mode,algorithm,config&limit=1'
  );
  if (mature[0]) return mature[0];
  const control = await rows(env,
    'experience_policies?key=eq.control-order&version=eq.v1&plane=eq.production&enabled=eq.true' +
    '&select=id,key,version,plane,mode,algorithm,config&limit=1'
  );
  return control[0] || null;
}

function applyPolicy(policy, candidates, maxItems, features) {
  if (!policy) return null;
  if (policy.algorithm === 'identity_order') {
    const selected = candidates.slice(0, maxItems).map((candidate, index) => ({ ...candidate, position: index }));
    return {
      selected,
      propensities: selected.map((candidate) => ({ id: candidate.id, probability: 1 })),
      reasons: ['control_order', 'caller_order_preserved'],
      diversityApplied: false
    };
  }
  if (policy.algorithm !== 'deterministic_score_mmr' || !features) return null;

  const config = safeConfig(policy);
  const featureById = new Map(features.candidate_features.map((x) => [x.id, x]));
  const remaining = candidates.map((candidate) => ({
    candidate,
    feature: featureById.get(candidate.id) || { base_score: 0 }
  }));
  const selected = [];
  let diversityApplied = false;

  while (remaining.length && selected.length < maxItems) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i];
      const penalty = diversityPenalty(row.candidate, selected.map((x) => x.candidate), config);
      const adjusted = Number(row.feature.base_score || 0) - penalty;
      if (penalty > 0) diversityApplied = true;
      if (adjusted > bestAdjusted ||
          (adjusted === bestAdjusted && Number(row.candidate.position) < Number(remaining[bestIndex]?.candidate?.position))) {
        bestAdjusted = adjusted;
        bestIndex = i;
      }
    }
    const [winner] = remaining.splice(bestIndex, 1);
    selected.push({ ...winner, adjusted: bestAdjusted });
  }

  const ranked = selected.map((row, index) => ({ ...row.candidate, position: index }));
  const reasons = ['production_policy_v1', 'deterministic_score', 'first_party_recent_behavior'];
  if (features.candidate_features.some((x) => x.explicit_preference !== 0)) reasons.push('explicit_preference_applied');
  if (features.candidate_features.some((x) => x.fatigue_penalty > 0)) reasons.push('fatigue_applied');
  if (diversityApplied) reasons.push('diversity_rerank_applied');
  reasons.push('business_priority_capped_5pct', 'commercial_relationship_excluded_from_rank');

  return {
    selected: ranked,
    propensities: ranked.map((candidate) => ({ id: candidate.id, probability: 1 })),
    reasons,
    diversityApplied
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

  if (path === '/v1/experience/preferences') {
    if (!allowedOrigin(request, env)) return json({ ok: false, error: 'Origin not allowed' }, 403);
    if (!user?.id) return json({ ok: false, error: 'Authentication required' }, 401);
    const mUid = await currentMuid(env, user);
    if (!mUid) return json({ ok: false, error: 'McCluster identity required' }, 409);

    if (request.method === 'GET') {
      const surface = clean(url.searchParams.get('surface'), 80);
      const suffix = surface ? `&namespace=eq.${encodeURIComponent(surface)}` : '';
      const prefs = await rows(env,
        `experience_preferences?m_uid=eq.${encodeURIComponent(mUid)}&revoked_at=is.null${suffix}` +
        '&select=namespace,key,value,source,updated_at&order=updated_at.desc&limit=200'
      );
      return json({ ok: true, preferences: prefs });
    }

    if (request.method === 'POST' || request.method === 'DELETE') {
      let prefBody;
      try { prefBody = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
      const namespace = clean(prefBody?.surface, 80);
      const key = clean(prefBody?.key, 160);
      if (!namespace || !key) return json({ ok: false, error: 'surface and key required' }, 400);

      if (request.method === 'DELETE') {
        await db(env,
          `experience_preferences?m_uid=eq.${encodeURIComponent(mUid)}&namespace=eq.${encodeURIComponent(namespace)}&key=eq.${encodeURIComponent(key)}`,
          { method: 'PATCH', headers: { prefer: 'return=minimal' },
            body: JSON.stringify({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }
        );
        return json({ ok: true, revoked: true, surface: namespace, key });
      }

      const value = clean(prefBody?.value, 20);
      if (!['more','less'].includes(value)) return json({ ok: false, error: 'value must be more or less' }, 400);
      await db(env, 'experience_preferences?on_conflict=m_uid,namespace,key', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          m_uid: mUid, namespace, key, value, source: 'explicit',
          metadata: {}, revoked_at: null, updated_at: new Date().toISOString()
        }])
      });
      return json({ ok: true, surface: namespace, key, value });
    }
    return json({ ok: false, error: 'GET, POST or DELETE only' }, 405);
  }

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
    const executable = experimental && ['identity_order','deterministic_score_mmr'].includes(experimental.algorithm);
    if (executable && ['live', 'promoted'].includes(experimental.mode)) {
      policy = experimental;
    } else {
      // Unsupported/shadow policies never silently alter production traffic.
      reasonCodes.push('experiment_fallback_to_control');
      experiment = null;
      armKey = null;
    }
  }

  if (!experiment) {
    const reused = await reusableDecision(env, surface.id, subjectKeyHash, policy.id, candidates, maxItems);
    if (reused) {
      return json({
        ok: true,
        evidence_only: policy.algorithm === 'identity_order',
        reused: true,
        decision_id: reused.id,
        surface: surface.key,
        policy: { key: policy.key, version: policy.version, plane: policy.plane, algorithm: policy.algorithm },
        experiment: null,
        candidates: reused.selected_candidates,
        propensities: reused.propensities,
        reason_codes: [...(reused.reason_codes || []), 'stable_ttl_reuse'],
        expires_at: reused.expires_at
      });
    }
  }

  let features = null;
  let featureSnapshotId = null;
  if (policy.algorithm === 'deterministic_score_mmr') {
    const cfg = safeConfig(policy);
    const mUid = await currentMuid(env, user);
    const [prefs, events] = await Promise.all([
      explicitPreferences(env, mUid, surface.key),
      recentEvents(env, user, deviceId, cfg.behavior_window_days)
    ]);
    features = featureVector(events, candidates, surface.key, prefs, policy);
    featureSnapshotId = await storeFeatureSnapshot(env, subjectKeyHash, features);
  }

  const result = applyPolicy(policy, candidates, maxItems, features);
  if (!result) return json({ ok: false, error: 'Experience policy is not executable' }, 503);
  reasonCodes.push(...result.reasons);

  const ttlSeconds = Math.max(60, Math.min(86400, Number(safeConfig(policy).stable_ttl_seconds) || 1800));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
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
      objective_weights: safeConfig(policy).weights || {},
      client_context: context,
      expires_at: expiresAt
    }])
  });
  const decision = Array.isArray(inserted) ? inserted[0] : null;
  if (!decision?.id) return json({ ok: false, error: 'Decision was not recorded' }, 502);

  return json({
    ok: true,
    evidence_only: policy.algorithm === 'identity_order',
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
