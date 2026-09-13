import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const computeApi = await readFile(new URL('../src/compute-api.js', import.meta.url), 'utf8');
const routeGuard = await readFile(new URL('../../../supabase/migrations/20260913_008_compute_route_resale_guard.sql', import.meta.url), 'utf8');
const scopeGuard = await readFile(new URL('../../../supabase/migrations/20260913_009_platform_api_scope_entitlements.sql', import.meta.url), 'utf8');

test('BYOK-only providers never fall through to McCluster platform credentials', () => {
  assert.match(computeApi, /provider\.reseller_status === 'byok_only'/);
  assert.match(computeApi, /Customer BYOK credential required/);
  assert.match(computeApi, /provider\.reseller_status !== 'allowed'/);
  assert.doesNotMatch(computeApi, /\['allowed',\s*'byok_only'\]\.includes\(provider\.reseller_status\)/);
});

test('database route selection only admits commercially allowed providers', () => {
  assert.match(routeGuard, /p\.reseller_status\s*=\s*'allowed'/i);
  assert.doesNotMatch(routeGuard, /reseller_status\s+in\s*\([^)]*byok_only/i);
});

test('developer API key issuance rejects wildcard privilege escalation', () => {
  assert.match(scopeGuard, /api_enforce_key_scopes/i);
  assert.match(scopeGuard, /developer_issuable/i);
  assert.match(scopeGuard, /api_plan_scopes/i);
  assert.match(scopeGuard, /scope/i);
});
