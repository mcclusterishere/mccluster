import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/pending/20261014170000_action_mission_curated_catalog_resources.sql', import.meta.url), 'utf8');
const application = readFileSync(new URL('../../supabase/pending/20261014170100_equity_policy_memo_application_path.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../js/mnet.js', import.meta.url), 'utf8');
const publicHelp = readFileSync(new URL('../../help.html', import.meta.url), 'utf8');
const action = readFileSync(new URL('../../js/action.js', import.meta.url), 'utf8');

test('curation is non-destructive and preserves proof for in-progress participants', () => {
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.action_missions\b/i);
  assert.match(migration, /a\.status IN \('joined','in_progress','submitted','rejected'\)/);
  assert.match(migration, /THEN 'paused' ELSE 'closed'/);
  assert.match(migration, /'51000000-0000-4000-8000-000000000002'/); // care kits
  assert.match(migration, /'d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c'/); // generic spending
  assert.match(migration, /'7cfac26a-d757-42b9-803b-970f9d5030a8'/); // public comment
});

test('policy memo and Black business action remain, duplicate paper retired', () => {
  assert.match(migration, /'df26314d-d4e1-47e3-b980-1b60b1a682ea'/);
  assert.match(migration, /'ba66d4a3-cb62-4403-9b56-7ee00af059d8'/);
  assert.match(migration, /Spend \$20 at a Black-owned business/);
  assert.match(migration, /Write a Song for Equity Uprise/);
  assert.match(migration, /'music',2,150,true,'review'/);
});

test('hotel mission is a draft with strict recipient privacy controls', () => {
  assert.match(migration, /'One Safe Night'/);
  assert.match(migration, /'mutual_aid',3,200,true,'review',[\s\S]*?'draft'/);
  assert.match(migration, /requires_program_cohort,recipient_privacy_required/);
  assert.match(migration, /No public reservation or promise until approved and funded/);
});

test('resource directory is public read-only for non-admins, and link-only', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.action_resource_sources/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON public\.action_resource_sources TO anon, authenticated/);
  assert.match(migration, /GRANT INSERT,UPDATE,DELETE ON public\.action_resource_sources TO authenticated/);
  assert.match(migration, /public\.eu_is_admin\(\)/);
  assert.match(migration, /'link_only'/);
  assert.match(migration, /united-way-211-us/);
  assert.match(migration, /211-canada/);
  assert.match(migration, /byblack/);
  assert.match(migration, /r2-facilities/);
});

test('service gateway has no proof or join and directory links are external', () => {
  assert.match(ui, /Find services for yourself or someone you know/);
  assert.match(ui, /href="\/help\.html"/);
  assert.match(ui, /action_resource_sources\?category=eq/);
  assert.match(ui, /rel="noopener noreferrer"/);
});

test('verified policy memo qualifies for the existing application server-side', () => {
  assert.match(application, /368fd75a-77d2-4de0-9722-17020674a914/);
  assert.match(application, /a\.status='verified'/);
  assert.match(application, /if v_verified < public\.action_fellowship_min_verified\(\)/);
  assert.match(ui, /left=f\.eligible\?0:/);
  assert.match(ui, /Policy team application/);
});

test('help is publicly accessible and shareable without personal-data collection', () => {
  assert.match(ui, /href="\/help\.html"/);
  assert.match(publicHelp, /No account, photograph, public story, or proof of need required/);
  assert.match(publicHelp, /navigator\.share/);
  assert.doesNotMatch(publicHelp, /<form[\s>]/i);
  assert.match(publicHelp, /UNHCR Help/);
  assert.match(publicHelp, /IFRC National Societies/);
});

test('campaign landing hides paused/closed missions and bounties', () => {
  assert.match(action, /status=eq\.open/);
  assert.doesNotMatch(action, /status=in\.\(open,paused\)/);
  assert.match(action, /if \(!m\) return null; \/\* never resurrect/);
  assert.match(action, /b\.status==="open"/);
});
