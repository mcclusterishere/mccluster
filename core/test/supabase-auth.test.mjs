import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSupabaseHeaders } from '../src/supabase.mjs';

test('modern Supabase secret key is sent only as apikey', () => {
  const headers = buildSupabaseHeaders({ secretKey: 'sb_secret_test', legacyServiceKey: 'legacy-jwt' });
  assert.equal(headers.apikey, 'sb_secret_test');
  assert.equal(headers.authorization, undefined);
});

test('legacy service_role key remains bearer-compatible during migration', () => {
  const headers = buildSupabaseHeaders({ secretKey: '', legacyServiceKey: 'legacy-jwt' });
  assert.equal(headers.apikey, 'legacy-jwt');
  assert.equal(headers.authorization, 'Bearer legacy-jwt');
});

test('call-specific headers cannot remove the API key', () => {
  const headers = buildSupabaseHeaders({ secretKey: 'sb_secret_test', extra: { Prefer: 'return=representation' } });
  assert.equal(headers.apikey, 'sb_secret_test');
  assert.equal(headers.Prefer, 'return=representation');
});
