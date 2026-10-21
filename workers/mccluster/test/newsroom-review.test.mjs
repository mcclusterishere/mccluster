import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { approveNewsroomRevision, hasNewsroomApproval } from '../src/newsroom-review.js';
import { handlePlatformApi, publishDueNetworkPosts } from '../src/platform-api.js';
import { newsroomResponse, shapeArticle } from '../src/company-site/news.js';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function store() {
  const posts = new Map(), schedules = new Map(), state = { owner: true };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', b = init.body ? JSON.parse(init.body) : null;
    if (u.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'auth-owner' });
    if (u.pathname.endsWith('/m_auth_user_links')) return Response.json([{ m_uid: OWNER }]);
    if (u.pathname.endsWith('/rpc/mnet_admin_m_uids')) return Response.json(state.owner ? [OWNER] : []);
    if (u.pathname.endsWith('/platform_apps')) return Response.json([{ id: 'app' }]);
    const table = u.pathname.endsWith('/network_posts') ? posts : u.pathname.endsWith('/network_scheduled_posts') ? schedules : null;
    if (!table) return Response.json([]);
    if (method === 'POST') {
      if (table.has(b.id) || (b.scheduled_post_id && [...table.values()].some((p) => p.scheduled_post_id === b.scheduled_post_id))) return Response.json({ code: '23505' }, { status: 409 });
      const row = { ...b, status: b.status || 'scheduled', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (!row.id) row.id = crypto.randomUUID();
      table.set(row.id, row); return Response.json([row], { status: 201 });
    }
    let rows = [...table.values()];
    for (const key of ['id', 'author_m_uid', 'scheduled_post_id', 'status']) {
      const value = u.searchParams.get(key);
      if (value?.startsWith('eq.')) rows = rows.filter((r) => r[key] === value.slice(3));
    }
    if (method === 'PATCH') { rows.forEach((r) => Object.assign(r, b)); return Response.json(rows); }
    return Response.json(rows);
  };
  return { posts, schedules, state };
}
async function api(body, id = null) {
  try {
    return await handlePlatformApi(new Request(`https://api.test/v1/mnet/posts${id ? '/' + id : ''}?app_key=mccluster-web`, {
      method: id ? 'PATCH' : 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify(body)
    }), ENV);
  } catch (error) { return Response.json({ error: error.message }, { status: error.status || 500 }); }
}
const draft = { body: 'Harbor ferry resumes\n\nThe ferry operator announced service had resumed.', visibility: 'public', newsroom: true,
  newsroom_sources: [{ title: 'Operator announcement', url: 'https://example.org/ferry' }] };
const articleResponse = (row) => newsroomResponse(new Request('https://mccluster.org' + shapeArticle(row).path), ENV);

test('ordinary edit invalidates approval; explicit same-content re-review restores the exact revision', async () => {
  const db = store();
  assert.equal((await api(draft)).status, 201);
  const row = [...db.posts.values()][0], approvedHash = row.metadata.newsroom_review.revision_sha256;
  assert.equal((await articleResponse(row)).status, 200);
  assert.equal((await api({ body: 'Changed claim\n\nAn unreviewed assertion.' }, row.id)).status, 200);
  assert.equal(row.metadata.newsroom_review.state, 'needs_review');
  assert.equal((await articleResponse(row)).status, 410);
  assert.equal(await hasNewsroomApproval(row), false);
  assert.equal((await api({ newsroom: true }, row.id)).status, 200);
  assert.equal(await hasNewsroomApproval(row), true);
  assert.notEqual(row.metadata.newsroom_review.revision_sha256, approvedHash);
  assert.equal((await articleResponse(row)).status, 200);
  const hash = row.metadata.newsroom_review.revision_sha256;
  await api({ newsroom: true }, row.id);
  assert.equal(row.metadata.newsroom_review.revision_sha256, hash, 'same content has the same revision identity');
});

test('a changed body or source cannot reuse approval metadata, including a direct row edit', async () => {
  const db = store(); await api(draft);
  const row = [...db.posts.values()][0];
  row.body += ' An added assertion.';
  assert.equal(await hasNewsroomApproval(row), false);
  assert.equal((await articleResponse(row)).status, 410);
  row.metadata.newsroom_review = await approveNewsroomRevision(row, OWNER);
  row.metadata.newsroom_sources[0].url = 'https://different.example/';
  assert.equal(await hasNewsroomApproval(row), false);
});

test('re-review can clear sources and the newsroom note without retaining a stale hash input', async () => {
  const db = store();
  await api({ ...draft, newsroom_note: 'morning_brief', metadata: { track: 'community' } });
  const row = [...db.posts.values()][0];
  assert.equal((await api({ newsroom: true, newsroom_sources: [] }, row.id)).status, 200);
  assert.equal(row.metadata.newsroom_sources, undefined);
  assert.equal(row.metadata.newsroom_note, 'morning_brief');
  assert.equal(await hasNewsroomApproval(row), true);
  assert.equal((await articleResponse(row)).status, 200);
  assert.equal((await api({ newsroom: true, newsroom_note: null }, row.id)).status, 200);
  assert.equal(row.metadata.newsroom_note, undefined);
  assert.equal(row.metadata.newsroom_sources, undefined);
  assert.equal(await hasNewsroomApproval(row), true);
  assert.equal((await articleResponse(row)).status, 200);
});

test('duplicate direct publication converges, and withdrawal cannot be undone by replay', async () => {
  const db = store();
  const results = await Promise.all([api(draft), api(draft)]);
  assert.deepEqual(results.map((r) => r.status), [201, 201]);
  assert.equal(db.posts.size, 1);
  const row = [...db.posts.values()][0]; row.deleted_at = new Date().toISOString();
  assert.equal((await api(draft)).status, 409);
  assert.equal((await articleResponse(row)).status, 410);
});

test('current owner authority and native visibility govern every article read', async () => {
  const db = store(); await api(draft); const row = [...db.posts.values()][0];
  const live = await articleResponse(row);
  assert.equal(live.headers.get('cache-control'), 'no-store');
  db.state.owner = false;
  assert.equal((await articleResponse(row)).status, 404);
  assert.equal((await api({ newsroom: true }, row.id)).status, 403);
  db.state.owner = true; row.visibility = 'private';
  assert.equal((await articleResponse(row)).status, 410);
});

test('duplicate scheduled requests converge and overlapping cron publishes once', async () => {
  const db = store(), body = { ...draft, publish_at: new Date(Date.now() + 3600000).toISOString() };
  await Promise.all([api(body), api(body)]);
  assert.equal(db.schedules.size, 1);
  await Promise.all([publishDueNetworkPosts(ENV), publishDueNetworkPosts(ENV)]);
  assert.equal(db.posts.size, 1);
  assert.equal([...db.schedules.values()][0].status, 'published');
});

test('a cancelled newsroom schedule cannot be recreated by replaying the request', async () => {
  const db = store(), body = { ...draft, publish_at: new Date(Date.now() + 3600000).toISOString() };
  await api(body);
  [...db.schedules.values()][0].status = 'cancelled';
  assert.equal((await api(body)).status, 409);
  assert.equal(db.schedules.size, 1);
  assert.deepEqual(await publishDueNetworkPosts(ENV), { published: 0, failed: 0 });
  assert.equal(db.posts.size, 0);
});

test('scheduled content edited after review or revoked publisher cannot publish', async () => {
  for (const cause of ['edited', 'revoked']) {
    const db = store(); await api({ ...draft, publish_at: new Date(Date.now() + 3600000).toISOString() });
    const scheduled = [...db.schedules.values()][0];
    if (cause === 'edited') scheduled.payload.body += ' Changed after review.';
    else db.state.owner = false;
    const result = await publishDueNetworkPosts(ENV);
    assert.equal(result.published, 0, cause); assert.equal(result.failed, 1, cause);
    assert.equal(db.posts.size, 0, cause);
    assert.equal(scheduled.status, 'failed');
  }
});
