import test from 'node:test';
import assert from 'node:assert/strict';

import { processInstagramPublishQueue, syncInstagramInsights } from '../src/social/meta.js';
import { createGeneration, getGeneration } from '../src/media/router.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = original; });
}

test('publish runtime claims work first and ignores forged social_accounts credential_ref', async () => {
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SOCIAL_IG_CLIENT_A_ACCESS_TOKEN: 'safe-instagram-token',
    STRIPE_SECRET_KEY: 'must-never-be-selected',
    META_GRAPH_API_VERSION: 'v26.0'
  };

  await withFetchMock(async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null });

    if (href.endsWith('/rest/v1/rpc/claim_social_publish_jobs')) {
      return jsonResponse([{
        id: 'job-1',
        org_id: ORG_ID,
        account_id: 'account-1',
        campaign_id: null,
        variant_id: null,
        publish_mode: 'reel',
        scheduled_at: new Date(0).toISOString(),
        state: 'queued',
        attempts: 0,
        payload: { video_url: 'https://cdn.example/video.mp4', caption: 'hello', share_to_feed: true }
      }]);
    }

    if (href.includes('/rest/v1/social_accounts?')) {
      return jsonResponse([{
        id: 'account-1',
        org_id: ORG_ID,
        platform: 'instagram',
        external_account_id: 'ig-123',
        credential_ref: 'STRIPE_SECRET_KEY'
      }]);
    }

    if (href.includes('/rest/v1/org_channels?')) {
      return jsonResponse([{
        token_env: 'SOCIAL_IG_CLIENT_A_ACCESS_TOKEN',
        secret_id: null,
        account_id: 'ig-123'
      }]);
    }

    if (href === 'https://graph.facebook.com/v26.0/ig-123/media') {
      const authorization = options.headers?.authorization || options.headers?.Authorization;
      assert.equal(authorization, 'Bearer safe-instagram-token');
      assert.notEqual(authorization, 'Bearer must-never-be-selected');
      return jsonResponse({ id: 'container-1' });
    }

    if (href.includes('/rest/v1/social_publish_jobs?') && (options.method || 'GET') === 'PATCH') {
      return jsonResponse([{ id: 'job-1' }]);
    }

    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${href}`);
  }, async () => {
    const result = await processInstagramPublishQueue(env, { limit: 10 });
    assert.equal(result.checked, 1);
    assert.equal(result.results[0].state, 'processing');
  });

  assert.match(calls[0].href, /rpc\/claim_social_publish_jobs$/);
  assert.equal(calls.filter((call) => call.href.includes('graph.facebook.com')).length, 1);
  assert.equal(calls.some((call) => String(call.body || '').includes('STRIPE_SECRET_KEY')), false);
});

test('insight runtime obtains work from the fair-claim RPC instead of newest-post selection', async () => {
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role'
  };

  await withFetchMock(async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || 'GET' });
    if (href.endsWith('/rest/v1/rpc/claim_social_insight_posts')) return jsonResponse([]);
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${href}`);
  }, async () => {
    const result = await syncInstagramInsights(env, { limit: 25 });
    assert.deepEqual(result, { checked: 0, results: [] });
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].href, /rpc\/claim_social_insight_posts$/);
});

test('media generation without org_id fails closed before any network access', async () => {
  let fetchCalled = false;
  await withFetchMock(async () => {
    fetchCalled = true;
    throw new Error('network should not be reached');
  }, async () => {
    const request = new Request('https://api.mccluster.org/v1/media/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model_id: 'model-1', prompt: 'test' })
    });
    await assert.rejects(
      () => createGeneration(request, {}, { id: 'user-1' }),
      (error) => error.status === 400 && /org_id is required/.test(error.message)
    );
  });
  assert.equal(fetchCalled, false);
});

test('media job lookup without org_id fails closed before any network access', async () => {
  let fetchCalled = false;
  await withFetchMock(async () => {
    fetchCalled = true;
    throw new Error('network should not be reached');
  }, async () => {
    const request = new Request('https://api.mccluster.org/v1/media/jobs/123e4567-e89b-42d3-a456-426614174001');
    await assert.rejects(
      () => getGeneration(request, {}, { id: 'user-1' }, '123e4567-e89b-42d3-a456-426614174001'),
      (error) => error.status === 400 && /org_id is required/.test(error.message)
    );
  });
  assert.equal(fetchCalled, false);
});
