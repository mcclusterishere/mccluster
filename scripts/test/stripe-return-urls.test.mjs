/* STRIPE SENDS PEOPLE BACK TO A PAGE THAT EXISTS.
   ============================================================
   After Checkout or Connect onboarding, Stripe returns the browser to the
   success_url / cancel_url / return_url / refresh_url the server named.
   The Worker's action-connect named action-network.html, a page that never
   existed, so every recipient onboarding came back to a 404.

   This walks every such literal under supabase/functions and
   workers/mccluster/src, resolves the host it is built on (a same-file
   const, or the string fallback of its env lookup) and, when that host is
   matthew.mccluster.org, requires the path to be a file in this repo.
   URLs the request supplies (whip: input.successUrl) are not literals and
   are left to their own validation. Retired functions on the dead Here
   origin are not on this host and are pinned by their RETIRED switch.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOUSE = 'https://matthew.mccluster.org';
/* Stripe's snake_case keys, and the camelCase ones the Worker's own helpers
   take (connect.js createAccountLink, whip/stripe.js) before mapping them */
const KEYS = /\b(success_url|cancel_url|return_url|refresh_url|successUrl|cancelUrl|returnUrl|refreshUrl)\s*:\s*/g;

/* a page kept in the repo but deliberately off the live site, whose function
   is kept on purpose so the shop can be un-shelved without a rebuild
   (_unfinished/README.md, "shake-shop") */
const SHELVED = { '/shakes.html': '_unfinished/shake-shop/shakes.html' };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/* the expression after `key:` up to the next top-level comma, bracket or
   line end; quotes and template literals are skipped over */
function exprAt(src, i) {
  let j = i, depth = 0, q = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (c === '\\') { j++; continue; }
      if (q === '`' && c === '$' && src[j + 1] === '{') { depth++; j++; continue; }
      if (c === q && depth === 0) q = null;
      else if (q === '`' && c === '}' && depth > 0) depth--;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth--; }
    else if ((c === ',' || c === '\n') && depth === 0) break;
  }
  return src.slice(i, j);
}

/* a same-file `const NAME = …`: the last https:// string in its initialiser,
   so `env.X || 'https://…'` and `Deno.env.get("X") ?? "https://…"` resolve to
   their fallback; one identifier hop is followed (`const origin = ORIGIN`) */
function resolveConst(src, name, depth = 0) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`).exec(src);
  if (!m) return null;
  const init = m[1].trim();
  const urls = [...init.matchAll(/['"`](https?:\/\/[^'"`]+)['"`]/g)].map((x) => x[1]);
  if (urls.length) return urls[urls.length - 1];
  const hop = /^([A-Za-z_$][\w$]*)$/.exec(init);
  return hop && depth < 2 ? resolveConst(src, hop[1], depth + 1) : null;
}

/* the URL an expression names: a template literal (with a `${CONST}` head),
   a quoted string (with a `CONST +` head), or a bare const; null when the
   value comes from the request */
function urlOf(src, expr) {
  let m;
  if ((m = /`((?:[^`\\]|\\.)*)`/.exec(expr))) {
    const head = /^\$\{([A-Za-z_$][\w$]*)\}([\s\S]*)$/.exec(m[1]);
    if (!head) return m[1];
    const base = resolveConst(src, head[1]);
    return base == null ? null : base + head[2];
  }
  if ((m = /(?:([A-Za-z_$][\w$]*)\s*\+\s*)?(['"])((?:(?!\2).)*)\2/.exec(expr))) {
    if (!m[1]) return m[3];
    const base = resolveConst(src, m[1]);
    return base == null ? null : base + m[3];
  }
  if ((m = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(expr))) return resolveConst(src, m[1]);
  return null;
}

function literals() {
  const found = [];
  for (const dir of ['supabase/functions', 'workers/mccluster/src']) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(KEYS)) {
        const expr = exprAt(src, m.index + m[0].length);
        found.push({ file: relative(ROOT, file), key: m[1], expr, url: urlOf(src, expr) });
      }
    }
  }
  return found;
}

/* on this host: an absolute URL on it, or a root-relative path (the whip
   Worker's appUrl(env, '/whip/…') joins PUBLIC_APP_URL, which is this host) */
const onHouse = (u) => u != null && (u === HOUSE || u.startsWith(HOUSE + '/') || (u.startsWith('/') && !u.startsWith('//')));
const pathOf = (u) => new URL(u, HOUSE).pathname;
const fileOf = (path) => (path.endsWith('/') ? path + 'index.html' : path).replace(/^\//, '');

test('the scanner sees the return URLs it is meant to guard', () => {
  const all = literals();
  assert.ok(all.length >= 20, `found only ${all.length} return-url literals`);
  const files = new Set(all.map((l) => l.file));
  for (const f of ['workers/mccluster/src/action-connect.js', 'workers/mccluster/src/creator-billing.js', 'workers/mccluster/src/connect.js',
    'workers/mccluster/src/whip/worker.js', 'supabase/functions/checkout/index.ts', 'supabase/functions/music-checkout/index.ts', 'supabase/functions/shake-order/index.ts',
    'supabase/functions/org-connect-onboard/index.ts', 'supabase/functions/connect-org/index.ts']) {
    assert.ok(files.has(f), f + ' has no return-url literal in view');
  }
  const house = all.filter((l) => onHouse(l.url));
  assert.ok(house.length >= 12, `only ${house.length} literals resolve to ${HOUSE}`);
  /* request-supplied values are not literals and are skipped, not mis-read */
  for (const l of all.filter((l) => l.file === 'workers/mccluster/src/whip/stripe.js')) assert.equal(l.url, null, l.expr);
});

test('every server-side Stripe return URL on matthew.mccluster.org lands on a page in this repo', () => {
  const missing = [];
  for (const l of literals().filter((l) => onHouse(l.url))) {
    const path = pathOf(l.url);
    const ok = existsSync(join(ROOT, fileOf(path))) || (SHELVED[path] && existsSync(join(ROOT, SHELVED[path])));
    if (!ok) missing.push(`${l.file} ${l.key} -> ${l.url}`);
  }
  assert.deepEqual(missing, [], 'Stripe would send people to a 404:\n' + missing.join('\n'));
  /* the shelved shop's page is where the README says it is, or the allowance is stale */
  for (const [path, kept] of Object.entries(SHELVED)) assert.ok(existsSync(join(ROOT, kept)), `${path} is shelved at ${kept}`);
});

test('nothing names action-network.html, the page that never existed', () => {
  for (const l of literals()) assert.doesNotMatch(l.expr, /action-network\.html/, l.file);
  const connect = literals().filter((l) => l.file === 'workers/mccluster/src/action-connect.js');
  assert.deepEqual(connect.map((l) => [l.key, l.url]).sort(), [
    ['refresh_url', HOUSE + '/action-network-hire.html?connect=refresh'],
    ['return_url', HOUSE + '/action-network-hire.html?connect=returned']
  ]);
  assert.ok(existsSync(join(ROOT, 'action-network-hire.html')));
});

test('the pages the live functions return to are the ones that exist', () => {
  const by = (file) => literals().filter((l) => l.file === file && onHouse(l.url)).map((l) => pathOf(l.url));
  assert.deepEqual(by('supabase/functions/checkout/index.ts'), ['/pay.html', '/pay.html']);
  assert.deepEqual(by('workers/mccluster/src/whip/worker.js'), Array(4).fill('/whip/rider/operator.html'));
  /* the rentals return is built by a helper the scanner cannot see through; pin it by hand */
  const whip = readFileSync(join(ROOT, 'workers/mccluster/src/whip/worker.js'), 'utf8');
  assert.match(whip, /const rentalReturn = status => appUrl\(env, '\/whip\/rentals\/\?rental_payment='/);
  assert.ok(existsSync(join(ROOT, 'whip/rentals/index.html')));
  assert.deepEqual(by('supabase/functions/music-checkout/index.ts'), ['/listen.html', '/listen.html']);
  assert.deepEqual(by('workers/mccluster/src/creator-billing.js'), Array(3).fill('/customer-commerce.html'));
  assert.deepEqual(by('supabase/functions/org-connect-onboard/index.ts'), ['/account.html', '/account.html']);
  assert.deepEqual(by('supabase/functions/connect-org/index.ts'), ['/account.html', '/account.html']);
  assert.deepEqual(by('workers/mccluster/src/connect.js'), ['/control.html', '/control.html']);
});

test('shake-order returns to matthew.mccluster.org when SITE_URL is unset', () => {
  const src = readFileSync(join(ROOT, 'supabase/functions/shake-order/index.ts'), 'utf8');
  assert.match(src, /const SITE = Deno\.env\.get\("SITE_URL"\) \?\? "https:\/\/matthew\.mccluster\.org";/);
  assert.deepEqual(literals().filter((l) => l.file === 'supabase/functions/shake-order/index.ts').map((l) => pathOf(l.url)), ['/shakes.html', '/shakes.html']);
});

test('connect-onboard, whose return URLs point at the dead Here origin, refuses every request before Stripe is touched', () => {
  const src = readFileSync(join(ROOT, 'supabase/functions/connect-onboard/index.ts'), 'utf8');
  assert.match(src, /const RETIRED = true;/);
  const serve = src.indexOf('Deno.serve(');
  const refuse = src.indexOf('if (RETIRED) return json({ error: "gone", use: "connect" }, 410);');
  assert.ok(serve > 0 && refuse > serve, 'the refusal is inside the handler');
  assert.ok(refuse < src.indexOf('req.headers.get("Authorization")', serve), 'it runs before the request is read');
  assert.ok(refuse < src.indexOf('stripe.accounts.create', serve), 'and before any Stripe account');
  assert.ok(refuse < src.indexOf('stripe.accountLinks.create', serve), 'and before any account link');
  for (const l of literals().filter((l) => l.file === 'supabase/functions/connect-onboard/index.ts')) assert.equal(onHouse(l.url), false, 'its return URLs are not on this host');
  /* and the manifest still names it, so the config check stays complete while the directory exists */
  assert.match(readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8'), /\[functions\.connect-onboard\]\nverify_jwt = true/);
});
