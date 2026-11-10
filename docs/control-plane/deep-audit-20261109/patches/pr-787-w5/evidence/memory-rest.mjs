// Scratch verification aid (not part of any patch). An in-memory PostgREST double for the
// requests the PRIM3 learning Worker makes, so the PR's own browser journey can run here.
// NOT PostgreSQL and NOT PostgREST: the PR's acceptance runs PostgreSQL 17.6 + PostgREST
// 13.0.7 in Docker, which this machine cannot start. It follows
// workers/mccluster/test/support/adaptive-evidence-db.mjs (sessions, chained evidence) and adds
// the reviewed-release table and the two RPCs with the rules of
// supabase/pending/prim3_reviewed_releases_v1.sql: owner-scoped dedupe, exact-retry publish,
// 24 h expiry, first-revocation-only, claim binding, and the evidence guard that refuses
// events for a revoked or expired release.
export function memoryRest() {
  const tables = { learning_lab_sessions: [], learning_evidence_events: [], prim3_reviewed_releases: [],
    prim3_release_sessions: [], media_news_articles: [] }, calls = [];
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const refuse = (message, code, status) => json({ code, message }, status);
  const now = () => new Date().toISOString();
  function match(row, params) {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const val = row[k];
      if (v.startsWith('eq.') && String(val) !== v.slice(3)) return false;
      if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(val))) return false;
      if (v === 'is.null' && val != null) return false;
      if (v.startsWith('gte.') && !(Date.parse(val) >= Date.parse(v.slice(4)))) return false;
      if (v.startsWith('lte.') && !(Date.parse(val) <= Date.parse(v.slice(4)))) return false;
    }
    return true;
  }
  function order(rows, spec) {
    if (!spec) return rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const keys = spec.split(',').map(s => { const [col, dir] = s.split('.'); return { col, desc: dir === 'desc' }; });
    return rows.sort((a, b) => { for (const { col, desc } of keys) { const c = String(a[col] ?? '').localeCompare(String(b[col] ?? '')); if (c) return desc ? -c : c; } return 0; });
  }
  const project = (row, select) => !select || select === '*' ? structuredClone(row) : Object.fromEntries(select.split(',').map(c => [c, row[c] ?? null]));
  function publish(a) {
    const existing = tables.prim3_reviewed_releases.find(r => r.owner_id === a.p_owner && r.dedupe_key === a.p_dedupe);
    if (existing) return existing.recipe_hash !== a.p_hash ? refuse('Conflicting release revision', '23505', 409) : json(structuredClone(existing));
    if (a.p_input?.review?.fiction !== true || a.p_input?.review?.geography !== true) return refuse('Owner review required', 'P0001', 400);
    if (a.p_article != null) return refuse('Source unavailable or expired', 'P0001', 400); // the fixture holds no articles
    if (a.p_input?.source != null) return refuse('Offline release cannot claim a source', 'P0001', 400);
    if (tables.prim3_reviewed_releases.some(r => r.id === a.p_id)) return refuse('duplicate key', '23505', 409);
    const t = now(), row = { id: a.p_id, owner_id: a.p_owner, article_id: null, dedupe_key: a.p_dedupe, recipe_id: a.p_recipe_id,
      recipe_hash: a.p_hash, recipe_input: structuredClone(a.p_input), checkpoint_ids: structuredClone(a.p_checkpoints), source_snapshot: null,
      published_at: null, reviewed_at: t, expires_at: new Date(Date.parse(t) + 86400000).toISOString(), revoked_at: null };
    tables.prim3_reviewed_releases.push(row); return json(structuredClone(row));
  }
  function claim(a) {
    const bound = tables.prim3_release_sessions.find(b => b.session_id === a.p_session);
    if (bound) {
      if (bound.owner_id !== a.p_owner || bound.release_id !== a.p_release) return refuse('Conflicting session identity', '23505', 409);
      return json(structuredClone(tables.learning_lab_sessions.find(s => s.id === a.p_session && s.user_id === a.p_owner) ?? null));
    }
    const r = tables.prim3_reviewed_releases.find(x => x.id === a.p_release && x.owner_id === a.p_owner);
    if (!r || r.revoked_at || Date.now() >= Date.parse(r.expires_at)) return refuse('Release unavailable or expired', 'P0001', 400);
    if (!Number.isSafeInteger(a.p_seed) || a.p_seed < 0 || a.p_seed >= 2 ** 31) return refuse('Invalid seed', 'P0001', 400);
    if (tables.learning_lab_sessions.some(s => s.id === a.p_session)) return refuse('duplicate key', '23505', 409);
    const s = { id: a.p_session, user_id: a.p_owner, pack_id: 'prim3-coordinate-practice', pack_version: '1.0.0', scenario_id: 'PRIM3-RELAY-DISTANCE-V1',
      mode: 'SIMULATION', execution_target: 'SANDBOX', difficulty: 'FOUNDATION', seed: a.p_seed, outcome: 'in_progress', started_at: now(), ended_at: null, last_event_seq: 0 };
    tables.learning_lab_sessions.push(s); tables.prim3_release_sessions.push({ session_id: a.p_session, release_id: a.p_release, owner_id: a.p_owner, claimed_at: now() });
    return json(structuredClone(s));
  }
  async function fetchImpl(url, init = {}) {
    const u = new URL(url), method = init.method || 'GET', path = u.pathname.replace(/^\/rest\/v1\//, '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: u.search });
    if (method === 'POST' && path === 'rpc/prim3_release_publish') return publish(body);
    if (method === 'POST' && path === 'rpc/prim3_release_claim') return claim(body);
    const rows = tables[path];
    if (!rows) throw new Error('Unexpected fixture request: ' + method + ' ' + path);
    const params = [...u.searchParams];
    if (method === 'GET') {
      const hits = order(rows.filter(r => match(r, params)), u.searchParams.get('order'));
      return json(hits.slice(0, Number(u.searchParams.get('limit')) || 1000).map(r => project(r, u.searchParams.get('select'))));
    }
    if (method === 'POST') {
      if (rows.some(r => r.id === body.id)) return refuse('duplicate key value violates unique constraint', '23505', 409);
      const row = structuredClone(body);
      if (path === 'learning_lab_sessions') Object.assign(row, { outcome: 'in_progress', started_at: now(), ended_at: null, last_event_seq: 0 });
      else if (path === 'learning_evidence_events') {
        const session = tables.learning_lab_sessions.find(s => s.id === row.session_id && s.user_id === row.user_id);
        if (!session || session.outcome !== 'in_progress') return refuse('session closed', 'P0001', 400);
        const bound = tables.prim3_release_sessions.find(b => b.session_id === row.session_id);
        if (bound) {
          const r = tables.prim3_reviewed_releases.find(x => x.id === bound.release_id);
          if (bound.owner_id !== row.user_id || r.owner_id !== row.user_id || r.revoked_at || Date.now() >= Date.parse(r.expires_at)) return refuse('Release unavailable or expired', '23514', 400);
          if (row.payload?.type === 'release' && (row.payload?.reviewed_release?.id !== r.id || row.payload?.reviewed_release?.recipe_hash !== r.recipe_hash)) return refuse('Release binding required', '23514', 400);
        }
        row.seq = ++session.last_event_seq; row.event_hash = String(row.seq).padStart(64, 'a');
      } else return refuse('fixture: insert not allowed on ' + path, '42501', 403);
      rows.push(row); return json([structuredClone(row)], 201);
    }
    if (method === 'PATCH') {
      const hits = rows.filter(r => match(r, params));
      if (path === 'prim3_reviewed_releases') for (const r of hits) { if (Object.keys(body).some(k => k !== 'revoked_at') || r.revoked_at) return refuse('Only first revocation is allowed', 'P0001', 400); }
      for (const r of hits) Object.assign(r, body);
      return json(hits.map(r => structuredClone(r)));
    }
    return json({}, 405);
  }
  return { tables, calls, fetchImpl };
}
