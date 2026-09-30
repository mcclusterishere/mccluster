/* UPRISE ACTION NETWORK — the contract behind /action/ and the gateway.
   ============================================================
   The page is people-first and money-off by construction. These are the
   promises a screenshot cannot show:

     1. money is off by default and invisible on every public surface
        until the owner switches it on for a campaign
     2. only the owner writes campaigns and the ledger; participants read
        only themselves; the funnel is the owner's alone
     3. every seeded fact carries its source
     4. the Reel attribution the page records is the attribution the
        owner's funnel reads (same event name, same keys)
     5. the pages follow the mobile rules, and nothing plays sound on
        its own
     6. a page in a folder never picks up the home page's content edits
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

/* pending until applied, then it moves into migrations/ under its real
   version; the contract holds either way */
async function migration() {
  for (const dir of ['supabase/migrations', 'supabase/pending_migrations']) {
    const hit = (await readdir(join(ROOT, dir))).find((f) => f.endsWith('_uprise_action_network.sql'));
    if (hit) return read(join(dir, hit));
  }
  throw new Error('the Action Network migration is missing');
}

test('money is off by default, and the public read hides it while off', async () => {
  const sql = await migration();
  assert.match(sql, /money_enabled boolean not null default false/);
  assert.match(sql, /'money', case when c\.money_enabled then jsonb_build_object\([\s\S]*?\) else null end/);
  assert.match(sql, /'mobilize', 10000, 100000000, false,/, 'Campaign 001 is seeded with money off');
  assert.match(sql, /Allocation pending partner and intervention due diligence/);
  /* the public meter counts published receipts only */
  assert.match(sql, /l\.published and l\.kind = 'received'/);
});

test('only the owner writes; participants see only themselves; the funnel is owner-only', async () => {
  const sql = await migration();
  for (const t of ['action_campaigns', 'action_participants', 'action_events', 'action_ledger']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} has RLS`);
  }
  assert.match(sql, /create policy "owner writes campaigns"[\s\S]*?using \(\(select public\.eu_is_admin\(\)\)\) with check \(\(select public\.eu_is_admin\(\)\)\)/);
  assert.match(sql, /create policy "owner writes the ledger"[\s\S]*?with check \(\(select public\.eu_is_admin\(\)\)\)/);
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\) or \(select public\.eu_is_admin\(\)\)\)/);
  assert.match(sql, /if not public\.eu_is_admin\(\) then\s+raise exception 'owner only'/);
  for (const fn of ['action_me\\(text\\)', 'action_join\\(text, jsonb, text\\[\\], text\\[\\], text\\)', 'action_act\\(text, text, jsonb\\)', 'action_funnel\\(text\\)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon;`), `${fn} is not callable signed out`);
  }
  assert.match(sql, /revoke all on function public\.action_clean_origin\(jsonb\) from public, anon, authenticated;/);
  /* every definer function pins its search path */
  const definers = sql.match(/security definer\s+set search_path = ''/g) || [];
  assert.equal(definers.length, 6);
});

test('joining is serialized, idempotent, and keeps only plain attribution', async () => {
  const sql = await migration();
  const join = sql.slice(sql.indexOf('create function public.action_join'), sql.indexOf('create function public.action_act'));
  assert.ok(join.indexOf('pg_advisory_xact_lock') < join.indexOf('if exists (select 1 from public.action_participants'),
    'the lock is taken before the already-joined check');
  assert.match(join, /widen what they offer, never renumber or re-attribute/);
  assert.match(sql, /unnest\(array\['src','med','reel','cmp'\]\)/);
  assert.match(sql, /\^\[a-z0-9\]\[a-z0-9\._-\]\*\$/);
  assert.match(sql, /interval '1 hour'/, 'repeat actions within the hour do not inflate the count');
});

test('every seeded fact and source links an https primary source', async () => {
  const sql = await migration();
  const facts = JSON.parse(sql.match(/'(\[\s*\{"text"[\s\S]*?\])'::jsonb/)[1].replace(/''/g, "'"));
  assert.ok(facts.length >= 5);
  for (const f of facts) {
    assert.ok(f.text && f.source, 'fact has text and source');
    assert.match(f.url, /^https:\/\//);
  }
  const sources = JSON.parse(sql.match(/'(\[\s*\{"label"[\s\S]*?\])'::jsonb/)[1].replace(/''/g, "'"));
  for (const s of sources) assert.match(s.url, /^https:\/\//);
});

test('the attribution the page records is what the funnel reads', async () => {
  const [sql, js] = await Promise.all([migration(), read('js/action.js')]);
  assert.match(sql, /e\.name = 'action_view' and e\.props->>'campaign' = v_slug/);
  assert.match(sql, /e\.props->>'reel'/);
  assert.match(sql, /e\.props->>'src'/);
  assert.match(js, /track\("action_view", \{ campaign: SLUG, reel: o\.reel \|\| "", src: o\.src \|\| "" \}\)/);
  assert.match(js, /p_origin: o,/);
  assert.match(js, /p_ref: referral\(\)/);
  /* utm_* works as well as the short form a Reel caption carries */
  assert.match(js, /\["reel", "utm_content"\]/);
});

test('the campaign page shows no money UI unless the campaign carries money', async () => {
  const [js, html] = await Promise.all([read('js/action.js'), read('action/index.html')]);
  assert.match(js, /return HAVE\.filter\(function \(h\) \{ return h\[0\] !== "give" \|\| \(C && C\.money\); \}\);/);
  assert.match(js, /if \(l\[0\] === "give_intent" && !\(C && C\.money\)\) return;/);
  assert.match(js, /\$\("anMoney"\)\.hidden = !m;/);
  assert.match(html, /<section class="an-sec an-meter an-meter--money" id="anMoney" hidden/);
  /* choices the page did not show are never sent */
  assert.match(js, /filter\(function \(k\) \{ return shown\.indexOf\(k\) > -1; \}\)/);
});

test('the pages follow the mobile rules', async () => {
  for (const page of ['action/index.html', 'heal-the-3rd-world.html', '404.html']) {
    const html = await read(page);
    assert.match(html, /<meta name="viewport" content="width=device-width,\s?initial-scale=1/, page);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale/, page);
  }
  for (const css of ['css/action.css', 'css/gateway.css']) {
    const src = await read(css);
    assert.doesNotMatch(src, /@media[^{]*max-width/, `${css} only adds room`);
    assert.doesNotMatch(src, /repeat\(\d+,\s*1fr\)|(?<!minmax\(0,\s?)\b1fr\b(?!\))/, `${css} uses minmax(0,1fr)`);
  }
  const action = await read('css/action.css');
  /* overflow on body breaks the sticky bar and floats the app bar on older iPhones */
  assert.doesNotMatch(action.match(/body\.an-body \{[^}]*\}/)[0], /overflow/);
  assert.match(action, /\.an-field input, \.an-share__url \{[\s\S]*?font: 600 max\(16px, 1rem\)/);
  /* no lookbehind: it is a parse error on older iOS and would take the whole page down */
  for (const js of ['js/action.js', 'js/gateway.js']) assert.doesNotMatch(await read(js), /\(\?<[=!]/, js);
});

test('the gateway never plays sound or film on its own, and scores dark to light', async () => {
  const [html, js] = await Promise.all([read('heal-the-3rd-world.html'), read('js/gateway.js')]);
  assert.doesNotMatch(html, /\bautoplay\b/);
  assert.match(html, /id="look" data-score="deep"/);
  assert.match(html, /id="do" data-score="heal"/);
  assert.match(js, /return act === "look" \? "deep" : "heal";/);
  assert.match(js, /var soundOn = false;/);
  assert.match(js, /if \(v && !quiet && !saveData\)/);
  /* the supplied cover art is shown whole, never cropped */
  assert.match(html, /src="assets\/img\/heal-the-3-cover\.jpg"/);
  assert.doesNotMatch(await read('css/gateway.css'), /\.gw-cover img \{[^}]*object-fit:\s*cover/);
  /* the album keeps working and only Heal the 3 grows the door */
  const album = await read('album.html');
  assert.match(album, /document\.getElementById\("albGate"\)\.hidden = ALBUM !== "heal-the-3";/);
  assert.match(album, /id="albGate" href="heal-the-3rd-world\.html" hidden/);
});

test('a page in a folder never inherits the home page content edits', async () => {
  const src = await read('js/live-content.js');
  const body = src.match(/var PAGE = \(function \(p\) \{([\s\S]*?)\}\)\(location\.pathname\);/)[1];
  const key = new Function('p', body);
  assert.equal(key('/'), 'index.html');
  assert.equal(key('/index.html'), 'index.html');
  assert.equal(key('/give.html'), 'give.html');
  assert.equal(key('/action/'), 'action/index.html');
  assert.equal(key('/action/index.html'), 'action/index.html');
});

test('/action/<slug> forwards to the campaign with its tags', async () => {
  const html = await read('404.html');
  const re = new RegExp(html.match(/var m = \/(.+?)\/i\.exec\(location\.pathname\);/)[1], 'i');
  assert.equal(re.exec('/action/cobalt')[1], 'cobalt');
  assert.equal(re.exec('/action/cobalt/')[1], 'cobalt');
  assert.equal(re.exec('/action/'), null);
  assert.equal(re.exec('/action/a/b'), null);
  assert.match(html, /location\.replace\("\/action\/\?c=" \+ m\[1\]\.toLowerCase\(\) \+ rest \+ location\.hash\)/);
});

test('Control carries the campaign desk, and the money switch asks first', async () => {
  const [html, v2, mod] = await Promise.all([read('control.html'), read('js/control-room-v2.js'), read('js/control-room/action-network.js')]);
  assert.match(html, /js\/control-room\/action-network\.js/);
  assert.match(v2, /window\.CR\.actionNetwork\.render\(\)/);
  assert.match(v2, /window\.CR\.actionNetwork\.bind\(/);
  assert.match(v2, /window\.CR\.actionNetwork\.init\(\{ supa: supa, render: render \}\)/);
  assert.match(mod, /rpc\/action_funnel/);
  assert.match(mod, /if\(on&&!confirm\("Turn money ON/);
  assert.match(mod, /published:false/, 'ledger entries start private');
  assert.match(mod, /status:"draft"/, 'new campaigns start as drafts');
});
