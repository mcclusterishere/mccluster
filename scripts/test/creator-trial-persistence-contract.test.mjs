import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/pending/20261010001000_creator_trial_reports_consultations.sql',import.meta.url),'utf8');
const page=readFileSync(new URL('../../mccluster-creator.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../js/mccluster-public-profile.js',import.meta.url),'utf8');
test('report cards are versioned and immutable',()=>{
 assert.match(sql,/unique\(creator_user_id,trial_start,policy_version\)/);
 assert.match(sql,/before update or delete on public\.creator_trial_report_cards/);
});
test('consultation entitlement is unique per creator and 15 minutes',()=>{
 assert.match(sql,/creator_user_id uuid primary key/);
 assert.match(sql,/check\(duration_minutes=15\)/);
});
test('creator-only report reads, no browser writes',()=>{
 assert.match(sql,/creator_user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/grant select on public\.creator_trial_report_cards,public\.creator_consultation_entitlements to authenticated/);
 assert.doesNotMatch(sql,/grant (insert|update|delete) on public\.creator_trial_report_cards/);
});
test('public profile events flow through consent-gated first-party collector',()=>{
 assert.match(page,/src="js\/analytics\.js"/);
 assert.match(js,/MCC_TRACK\('creator_profile_view'/);
 assert.match(js,/MCC_TRACK\('creator_service_click'/);
});
