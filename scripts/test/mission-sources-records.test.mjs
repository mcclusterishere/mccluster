/* The records of Project Drawdown's source page stay true (docs/control-plane/WORLD-MISSION-SOURCES.md).
   D3, a default adopted pending Matthew's confirmation: data/missions/drawdown/README.md keeps "the logo appears nowhere" and
   "nothing implies endorsement", and its name rule names only the page heading and its door, dated, marked pending and
   superseding the 2026-11-17 rule for that page and door only. The feed brief records the request without promising an
   account and says no agent contacts Project Drawdown; the record says every decision is a default pending his confirmation;
   the promotion order and the pending README carry the source-page SQL as not applied. Mission publication has its own
   dated production evidence and does not establish permission for the source page.
     node --test scripts/test/mission-sources-records.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
const section = (text, heading) => { const a = text.indexOf(heading); assert.ok(a >= 0, heading); const b = text.indexOf('\n## ', a + heading.length); return flat(text.slice(a, b < 0 ? undefined : b)); };
const PRIVATE_WORD = ['bene', 'factor'].join(''); /* the owner's private word for the role: never in committed prose */

test('D3: the README keeps the logo nowhere and nothing implying endorsement, and limits the name to the page heading and its door', () => {
  const readme = flat(read('data/missions/drawdown/README.md'));
  assert.match(readme, /\*\*No images\.\*\* [^*]*Missions use the feed's own icons\./);
  const rule = /- \*\*The name and the logo\.\*\* (.*?)\*\(2026-11-19: [^)]*\)\*/.exec(readme);
  assert.ok(rule, 'the name rule is its own bullet, ending in a dated note');
  const text = rule[0];
  assert.match(text, /Drawdown's name and logo are registered trademarks\./);
  assert.match(text, /The logo appears nowhere, and nothing implies endorsement\./, 'the two rules stay');
  assert.match(text, /a default adopted pending Matthew's confirmation, including that the written permission covers it/);
  assert.match(text, /as the heading of that page and on its door in each Drawdown mission's dialog, only to identify the source\./);
  assert.match(text, /Any other place for the name needs a new dated amendment\./);
  assert.match(text, /this supersedes "the name appears only in credit lines" of 2026-11-17, for that page and its door only\./);
  assert.match(text, /a source page that McCluster Corp makes and Project Drawdown does not run/);
  assert.doesNotMatch(readme, /the name appears only in credit lines, the logo nowhere/, 'the old sentence is replaced, not left beside the new one');
  assert.doesNotMatch(readme.toLowerCase(), new RegExp(PRIVATE_WORD));
});

test('the feed brief records mission publication separately from the source-page request and permission boundary', () => {
  const brief = read('docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md');
  const s = section(brief, "## Owner request, 2026-11-19 (Project Drawdown's page in the World)");
  assert.match(s, /a public source page that McCluster Corp makes and keeps, not an account/);
  assert.match(s, /each part a default adopted pending Matthew's confirmation/);
  assert.match(s, /the missions were written by this site from Project Drawdown's climate solutions; the wording is original/);
  assert.match(s, /its public word for Project Drawdown's role is Source/);
  assert.match(s, /The owner handles any message to Project Drawdown outside this repository; no agent of this work sends, drafts, schedules or records one\./);
  assert.equal((flat(brief).match(/their own corporate account/g) || []).length, 1, 'the account words are quoted once, beside what was built');
  assert.match(flat(brief), /\| data\/missions\/drawdown\/README\.md, 2026-11-17: Drawdown's name "appears only in credit lines" \| 2026-11-19, a default adopted pending Matthew's confirmation:/);
  const status = section(brief, 'Status, 2026-11-20:');
  assert.match(status, /All 125 missions are published: 125 open missions, zero website quotations or quotation credits, and all 43 assessment citations retained\./);
  assert.match(status, /The source page remains draft; this release records no permission attestation for it\./);
  const ledger = JSON.parse(read('supabase/production-ledger.json')).migrations;
  for (const name of ['action_mission_drawdown_credit_fallback', 'action_mission_drawdown_publish']) {
    const applied = ledger.find((migration) => migration.name === name);
    assert.ok(applied, `${name} has production evidence`);
    assert.ok(status.includes(`${applied.version}_${name}`), `${name} uses its recorded production version`);
    assert.ok(read(`supabase/migrations/${applied.version}_${name}.sql`).length, `${name} has its applied SQL`);
  }
  assert.ok(!ledger.some((migration) => migration.name === 'mission_catalog_sources_v1'), 'mission publication does not imply source-page publication');
  assert.doesNotMatch(brief.toLowerCase(), new RegExp(PRIVATE_WORD));
});

test('the record: every decision a default pending Matthew\'s confirmation, nothing live, no private word', () => {
  const doc = read('docs/control-plane/WORLD-MISSION-SOURCES.md');
  const f = flat(doc);
  assert.match(f, /\*\*Nothing here is live\.\*\*/);
  for (let i = 1; i <= 14; i += 1) assert.match(doc, new RegExp(`^\\| D${i} \\|`, 'm'), `D${i} is recorded`);
  assert.match(f, /Decisions D1 to D14 \(map 00, section 8\), each a default adopted pending Matthew's confirmation/);
  assert.match(f, /Choices beyond D1 to D14, each a default adopted pending Matthew's confirmation/);
  assert.doesNotMatch(f, /Matthew (decided|approved|confirmed that)/, 'never written as his decision');
  assert.match(f, /no agent of this work sends, drafts, schedules or records one/);
  assert.match(f, /Inserting the organization row publishes it/);
  assert.match(f, /20261119140000_mission_catalog_sources_v1\.sql/);
  assert.doesNotMatch(doc.toLowerCase(), new RegExp(PRIVATE_WORD));
  assert.doesNotMatch(doc, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, 'no e-mail address');
});

test('the promotion order and the pending README carry the pair as not applied, after the publish', () => {
  const order = read('supabase/pending/PROMOTION-ORDER.md');
  const s = section(order, '. Mission catalog sources: Project Drawdown\'s source page (written 2026-11-19)');
  for (const t of ['20261119140000_mission_catalog_sources_v1.sql', '20261119140000_mission_catalog_sources_v1.rollback.sql', 'apply_migration',
    'mission_catalog_sources_v1', 'mission_catalog_sources_v1_rollback', '**Not applied. Owner approval required.**', 'Inserting the organization row publishes it',
    'the mission publish (section 10.4, release step 9) applied and recorded (release step 11)', 'Before Show:', 'refuses (55000), changing nothing']) {
    assert.ok(s.includes(t), t);
  }
  assert.match(read('supabase/pending/README.md'), /Pending \(2026-11-19\): mission catalog sources, `20261119140000_mission_catalog_sources_v1\.sql`/);
});
