/* EVERY SAME-SITE REFERENCE ON EVERY PUBLISHED PAGE RESOLVES TO A FILE.
   scripts/test/seo-contract.test.mjs follows <a href> on eight authority
   pages; this walks the whole published tree (root, walls/, closet/,
   action/, engineering/, tracks/, portfolio/, whip/, auth/) and every
   attribute that fetches: href, src, srcset, poster, data-src. Anything
   that leaves the site, is a protocol other than http(s), or is a script
   template fragment is skipped; a directory resolves to its index.html;
   ?query and #hash are stripped; <base href> is honoured per page.
   Deliberately unpublished trees (_unfinished/, redirects/, demos/) are
   not pages and are not walked, but a published page may still point into
   them, and then the file must exist. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SITE = 'https://matthew.mccluster.org/';
const DIRS = ['', 'walls', 'closet', 'action', 'engineering', 'tracks', 'portfolio', 'auth'];
const SKIP = new Set(['_unfinished', 'redirects', 'demos', 'node_modules', '.git']);

function pages() {
  const out = [];
  for (const d of DIRS) {
    const dir = join(ROOT, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.html')) out.push(posix.join(d, f));
  }
  const whip = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      const rel = posix.join(d, f);
      if (SKIP.has(f)) continue;
      if (statSync(join(ROOT, rel)).isDirectory()) whip(rel);
      else if (f.endsWith('.html')) out.push(rel);
    }
  };
  if (existsSync(join(ROOT, 'whip'))) whip('whip');
  return out.sort();
}

/* the attribute values that fetch something, with the tag they sit on */
function references(html) {
  const refs = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of clean.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const attrs = m[2];
    for (const a of attrs.matchAll(/\s(href|src|poster|data-src)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      refs.push({ tag: m[1].toLowerCase(), attr: a[1], value: a[3] ?? a[4] });
    }
    for (const a of attrs.matchAll(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      for (const part of (a[2] ?? a[3]).split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) refs.push({ tag: m[1].toLowerCase(), attr: 'srcset', value: url });
      }
    }
  }
  return refs;
}

/* a same-site reference, resolved to a repository path, or null to skip */
function resolve(page, value, baseHref) {
  let v = value.trim();
  if (!v || v.startsWith('#')) return null;
  if (/^(mailto:|tel:|sms:|javascript:|data:|blob:|about:)/i.test(v)) return null;
  /* a script template fragment ('+esc(x)+', "+String(y)+", {{x}}, ${x}) is not a path */
  if (/\{\{|\$\{|['"]\s*\+|\+\s*['"]|__[A-Z]+__/.test(v)) return null;
  if (/^(https?:)?\/\//i.test(v)) {
    const abs = v.startsWith('//') ? 'https:' + v : v;
    if (!abs.startsWith(SITE)) return null;
    v = '/' + abs.slice(SITE.length);
  }
  v = v.split('#')[0].split('?')[0];
  if (!v) return null;
  try { v = decodeURIComponent(v); } catch (e) { /* keep as written */ }
  const pageDir = posix.dirname(page) === '.' ? '' : posix.dirname(page) + '/';
  let target;
  if (v.startsWith('/')) target = v.slice(1);
  else if (baseHref) target = posix.join(baseHref.startsWith('/') ? baseHref.slice(1) : pageDir + baseHref, v);
  else target = pageDir + v;
  target = posix.normalize(target);
  if (target === '.' || target === '') target = 'index.html';
  if (target.endsWith('/')) target += 'index.html';
  if (target.startsWith('..')) return { target, escapes: true };
  return { target };
}

/* KNOWN DEAD DOORS, NAMED. A line here is a bug the house knows about, not
   a pass: each names the page, the reference and why, and goes when the
   door is fixed. Add to it only with the reason written out. */
const KNOWN_DEAD = new Map([
  /* The Site 0 game shipped at /site0/ and was put away under
     _unfinished/site0-game/ (commit 66519043, "web root only, internals
     stripped"); _unfinished/ is stripped at publish, so the facility's
     ENTER door points at nothing live. js/hitman-facility.js writes the
     same path. Restoring the HITMAN door is its own task; this line goes
     with it. */
  ['hitman-facility.html site0/index.html', 'Site 0 game put away under _unfinished/site0-game/'],
]);

const PAGES = pages();

test('the published tree is actually walked', () => {
  assert.ok(PAGES.length > 100, `${PAGES.length} pages found`);
  assert.ok(PAGES.includes('index.html') && PAGES.includes('engineering/index.html') && PAGES.includes('closet/commission.html'));
  assert.ok(!PAGES.some((p) => p.startsWith('_unfinished/') || p.startsWith('redirects/') || p.startsWith('demos/')));
});

test('every same-site href, src, srcset, poster and data-src on every published page resolves to a file', () => {
  const broken = [];
  const known = [];
  let checked = 0;
  for (const page of PAGES) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const baseTag = /<base\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
    const baseHref = baseTag ? (baseTag[2] ?? baseTag[3]) : '';
    for (const ref of references(html)) {
      const r = resolve(page, ref.value, baseHref);
      if (!r) continue;
      checked += 1;
      const file = join(ROOT, r.target);
      const ok = !r.escapes && existsSync(file) && (statSync(file).isFile() ||
        (statSync(file).isDirectory() && existsSync(join(file, 'index.html'))));
      if (ok) continue;
      if (KNOWN_DEAD.has(`${page} ${r.target}`)) { known.push(`${page} ${r.target}`); continue; }
      broken.push(`${page}: <${ref.tag} ${ref.attr}="${ref.value}"> -> ${r.target}`);
    }
  }
  assert.ok(checked > 1000, `${checked} references checked`);
  assert.deepEqual(broken, [], `${broken.length} broken same-site reference(s):\n${broken.join('\n')}`);
  /* a known dead door that came back to life is a line to delete, loudly */
  const stale = [...KNOWN_DEAD.keys()].filter((k) => !known.includes(k));
  assert.deepEqual(stale, [], `KNOWN_DEAD entries that resolve now and must be removed: ${stale.join(', ')}`);
});
