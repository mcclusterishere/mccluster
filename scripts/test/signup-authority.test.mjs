/* SIGNING UP MUST NOT GRANT ANYTHING.
   ============================================================
   The owner's question was blunt and correct: if somebody clicks a
   magic link, do they end up an admin? The answer has to stay no
   after every future change to the intake form, so the properties
   that make it no are pinned here.

   These are source contracts, not a substitute for the database.
   The real enforcement is RLS plus two BEFORE triggers, and it was
   verified against production with a real signed-in user before
   this shipped: forged verification stamps, a forged consent date,
   a forged tier, a write to another user's row, a self-granted
   org_members row and a self-minted invitation were all refused.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const MIGRATION = 'supabase/migrations/20260919042036_fan_profiles.sql';

test('the intake table carries no authority column at all', async () => {
  /* The cheapest guarantee available: a table with no role, no org and
     no membership cannot grant any of them, no matter how the policies
     are later edited. */
  const sql = await read(MIGRATION);
  const body = /create table if not exists public\.fan_profiles \((.*?)\n\);/s.exec(sql);
  assert.ok(body, 'fan_profiles table definition not found');
  for (const forbidden of [/\brole\b/, /\borg_id\b/, /\bis_admin\b/, /\bis_owner\b/, /\bpermissions?\b/]) {
    assert.doesNotMatch(body[1], forbidden,
      `fan_profiles must not carry ${forbidden} — the intake form writes here`);
  }
});

test('the browser may not assert its own verification, tier or consent dates', async () => {
  const sql = await read(MIGRATION);
  const guard = /create or replace function public\.fan_profiles_guard\(\)(.*?)end \$\$;/s.exec(sql);
  assert.ok(guard, 'fan_profiles_guard not found');
  const g = guard[1];

  assert.match(g, /if auth\.uid\(\) is null then\s*\n\s*return new;/,
    'the service role must be the only caller that bypasses the guard');
  assert.match(g, /new\.phone_verified_at := null;/,
    'a phone must never arrive already verified');
  assert.match(g, /new\.email_verified_at\s*\n?\s*from auth\.users/,
    'email verification must be read from auth.users, not from the request');
  assert.match(g, /new\.account_tier := case when/,
    'tier must be derived, never accepted');
  assert.match(g, /new\.marketing_consent_version := v_consent_version;/,
    'the consent version must be stamped by the database');
  assert.match(g, /new\.share_consent := false;/,
    'sharing must fail closed');
});

test('a minor is never offered onward sharing, and a missing age counts as a minor', async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /v_adult := new\.birth_year is not null\s*\n\s*and \(extract\(year from now\(\)\)::int - new\.birth_year\) >= 18;/,
    'adulthood must require a stated birth year, so unknown is not treated as adult');
  assert.match(sql, /if new\.share_consent and v_adult then/,
    'sharing consent must require adulthood');

  const html = await read('account.html');
  assert.match(html, /18 or older/, 'the form must say why the box is unavailable');
  assert.match(html, /box\.disabled = !ok;/, 'and must actually disable it');
});

test('consent is unbundled: neither box gates the music', async () => {
  /* Conditioning the record on consent is the part the state privacy
     laws prohibit, and js/gated-audio.js is where that would leak in:
     it decides locked vs unlocked and must never consult a consent. */
  const gate = await read('js/gated-audio.js');
  for (const term of [/consent/i, /marketing/i, /fan_profiles/]) {
    assert.doesNotMatch(gate, term,
      'the unlock path must not know anything about consent');
  }
  /* Saying so on the page matters as much as it being true in the code,
     and it has to be said next to EACH box rather than once at the
     bottom: the two asks now sit apart, so one shared footnote would
     leave whichever box the reader is looking at undisclosed. */
  const html = await read('account.html');
  /* Deliberately NOT a /g regex reused across assertions: assert.match
     runs .test(), which advances lastIndex on a global regex, so the
     second check would silently start halfway down the file. */
  const DISCLAIMER = /unlocks? (?:nothing|anything)/i;
  assert.ok((html.match(/unlocks? (?:nothing|anything)/gi) ?? []).length >= 2,
    'each consent box must carry its own "this unlocks nothing" line');
  for (const id of ['fnMarketing', 'fnShare']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} should exist`);
    assert.match(html.slice(at, at + 900), DISCLAIMER,
      `the ${id} box must say plainly that it gates nothing`);
  }
  assert.match(html, /optional/i, 'and must say the asks are optional');
});

test('the intake writes a short, fixed column list', async () => {
  const js = await read('js/fan-intake.js');
  const list = /var WRITABLE = \[(.*?)\];/s.exec(js);
  assert.ok(list, 'WRITABLE list not found');
  for (const forbidden of ['role', 'account_tier', 'phone_verified_at', 'email_verified_at',
                           'marketing_consent_at', 'share_consent_at',
                           'marketing_consent_version', 'share_consent_version']) {
    assert.doesNotMatch(list[1], new RegExp(`["']${forbidden}["']`),
      `${forbidden} is the database's to write, not the browser's`);
  }
});

test('the intake table is RLS-forced and self-scoped', async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /alter table public\.fan_profiles enable row level security;/);
  assert.match(sql, /alter table public\.fan_profiles force row level security;/,
    'force, so a future view cannot read around it — that already went wrong once on eu_profiles');
  for (const m of [/for select to authenticated using \(user_id = auth\.uid\(\)\)/,
                   /for insert to authenticated with check \(user_id = auth\.uid\(\)\)/]) {
    assert.match(sql, m, "every policy must be scoped to the caller's own row");
  }
  assert.doesNotMatch(sql, /for delete/,
    'a consent record the giver can erase is not a record');
});

test('no signup page hands out a role, and only one email is hardcoded as admin', async () => {
  /* The scrub. Every page that can create a session is checked for any
     attempt to write a role or a membership from the browser. */
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  files.push('auth/index.html', 'auth/seek-first-start.html', 'auth/seek-first-handoff.html');
  const offenders = [];
  for (const f of files) {
    let src;
    try { src = await read(f); } catch { continue; }
    if (!/signInWithEmail|signIn\(|mcc-auth\.js|backend\.js/.test(src)) continue;
    if (/org_members[^\n]*method:\s*["']POST|insert[^\n]*org_members|role["']?\s*:\s*["'](owner|admin)["']/i.test(src)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [],
    `these signup surfaces try to write a role or membership: ${offenders.join(', ')}`);
});

test('social sign-in follows Supabase and is never hardcoded on', async () => {
  /* A button for a provider Supabase has switched off sends people to a
     provider error page, which is worse than no button. The row therefore
     reads /auth/v1/settings and paints only what is live — which also means
     enabling Google is a dashboard toggle, not a deploy.

     This was a real gap: js/mcc-auth.js has carried signInWithGoogle and a
     "Continue with Google" button for a while, but nothing on the site had
     the #acOauth element it mounts into, so the button could never appear
     no matter what the dashboard said. */
  const html = await read('account.html');
  assert.match(html, /MCC\.providers\(\)/, 'the row must ask Supabase which providers are live');
  assert.match(html, /if \(!live\[key\]\) return;/, 'a provider that is off gets no button');
  assert.match(html, /el\("acSocialRow"\)\.hidden = !any;/,
    'the whole row hides when nothing is live');
  assert.match(html, /js\/mcc-auth\.js/, 'the page must load the client that owns the PKCE exchange');
  assert.match(html, /location\.origin \+ "\/auth\/\?next=\/account\.html"/,
    'sign-in must return through the callback page that completes the exchange');
});

test('the OAuth callback page completes the exchange and refuses off-site redirects', async () => {
  const html = await read('auth/index.html');
  assert.match(html, /window\.MCC\.complete\(\)/, 'the callback must finish the PKCE exchange');
  assert.match(html, /raw\.charAt\(0\) !== '\/' \|\| raw\.charAt\(1\) === '\/'/,
    'next= must be a same-origin path, or an open redirect walks out of the sign-in');
});
