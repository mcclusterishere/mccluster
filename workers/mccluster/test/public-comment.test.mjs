/* FILE A PUBLIC COMMENT (owner mission curation, 2026-10-15): open federal
   comment periods, read only, members only, behind a flag that is off by
   default. Fixtures are synthetic, shaped after each API's documented response. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  handlePublicComment, listOpenComments, commentHandoff, parseQuery, regulationsGovUrl, federalRegisterUrl,
  normalizeRegulationsGov, normalizeFederalRegister, mergeDocuments, enabled, PUBLIC_COMMENT_FLAG, REGULATIONS_GOV_KEY_ENV
} from '../src/public-comment.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/public-comment/${name}`, import.meta.url), 'utf8'));
const RG = await fixture('regulations-gov-documents.json');
const FR = await fixture('federal-register-documents.json');
const NOW = Date.parse('2026-10-15T12:00:00Z');
const KEY = 'test-key-not-a-secret';
const BASE = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const ON = { ...BASE, [PUBLIC_COMMENT_FLAG]: 'true', [REGULATIONS_GOV_KEY_ENV]: KEY };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const req = (path, { method = 'GET', auth = 'Bearer member-token', body } = {}) => new Request(`https://api.mccluster.org${path}`, {
  method, body, headers: { origin: 'https://matthew.mccluster.org', ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }
});

function provider({ rgStatus = 200, frStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: init.headers || {}, redirect: init.redirect });
    if (u === 'https://sb.test/auth/v1/user') return init.headers.authorization === 'Bearer member-token' ? json({ id: 'auth-member' }) : json({}, 401);
    if (u.startsWith('https://api.regulations.gov/v4/documents?')) return rgStatus === 200 ? json(RG) : json({ error: { code: 'OVER_RATE_LIMIT' } }, rgStatus);
    if (u.startsWith('https://www.federalregister.gov/api/v1/documents.json?')) return frStatus === 200 ? json(FR) : json({}, frStatus);
    throw new Error('unexpected ' + u);
  };
  return { fetchImpl, calls };
}
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, size: () => m.size }; }

test('off by default: unset, "false" or anything but "true" answers 404 and calls nobody', async () => {
  for (const flag of [undefined, '', 'false', '1', 'yes']) {
    const env = { ...BASE, [REGULATIONS_GOV_KEY_ENV]: KEY, ...(flag === undefined ? {} : { [PUBLIC_COMMENT_FLAG]: flag }) };
    assert.equal(enabled(env), false);
    const { fetchImpl, calls } = provider();
    const res = await handlePublicComment(req('/v1/public-comment/open'), env, { fetchImpl });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  }
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /^PUBLIC_COMMENT_LISTING_ENABLED = "false"$/m, 'the deployed default is off');
  assert.doesNotMatch(wrangler, /REGULATIONS_GOV_API_KEY\s*=/, 'the key is a secret, never a var');
});

test('other paths are not this module', async () => {
  assert.equal(await handlePublicComment(req('/v1/public-comment/submit'), ON, provider()), null);
  assert.equal(await handlePublicComment(req('/v1/world/layers/flights'), ON, provider()), null);
});

test('members only: no bearer, no listing', async () => {
  const { fetchImpl, calls } = provider();
  const res = await handlePublicComment(req('/v1/public-comment/open', { auth: '' }), ON, { fetchImpl });
  assert.equal(res.status, 401);
  assert.equal(calls.filter((c) => !c.url.startsWith('https://sb.test')).length, 0);
});

test('query is bounded to agency, topic and a real state', () => {
  const q = parseQuery(new URL('https://x/?agency=epa;drop&agency_slug=Environmental-Protection-Agency!&q=' + 'a'.repeat(300) + '&state=ct&extra=1'));
  assert.deepEqual(Object.keys(q), ['agency', 'agency_slug', 'q', 'state']);
  assert.equal(q.agency, 'EPADROP');
  assert.equal(q.agency_slug, 'environmental-protection-agency');
  assert.equal(q.q.length, 120);
  assert.equal(q.state, 'CT');
  assert.equal(parseQuery(new URL('https://x/?state=ZZ')).state, '');
});

test('provider URLs use the documented filters', () => {
  const rg = new URL(regulationsGovUrl({ agency: 'EPA', agency_slug: '', q: 'battery', state: 'CT' }));
  assert.equal(rg.searchParams.get('filter[withinCommentPeriod]'), 'true');
  assert.equal(rg.searchParams.get('filter[documentType]'), 'Proposed Rule');
  assert.equal(rg.searchParams.get('filter[agencyId]'), 'EPA');
  assert.equal(rg.searchParams.get('filter[searchTerm]'), 'battery Connecticut');
  assert.equal(rg.searchParams.get('page[size]'), '25');
  assert.equal(rg.searchParams.get('api_key'), null, 'the key travels in a header, never the URL');
  const fr = new URL(federalRegisterUrl({ agency: '', agency_slug: 'environmental-protection-agency', q: '', state: '' }, NOW));
  assert.deepEqual(fr.searchParams.getAll('conditions[type][]'), ['PRORULE']);
  assert.deepEqual(fr.searchParams.getAll('conditions[agencies][]'), ['environmental-protection-agency']);
  assert.equal(fr.searchParams.get('conditions[comment_date][gte]'), '2026-10-15');
  assert.ok(fr.searchParams.getAll('fields[]').includes('comments_close_on'));
});

test('normalizers keep open, well-formed proceedings and the official form link', () => {
  const rg = normalizeRegulationsGov(RG);
  assert.equal(rg.length, 1, 'closed and malformed rows dropped');
  assert.equal(rg[0].comment_url, 'https://www.regulations.gov/commenton/EPA-HQ-OAR-2099-0001-0001');
  const fr = normalizeFederalRegister(FR, NOW);
  assert.equal(fr.length, 2, 'a document with no deadline is not shown as open');
  assert.equal(fr.find((d) => d.fr_doc_num === '2099-11111').comment_url, 'https://www.regulations.gov/commenton/EPA-HQ-OAR-2099-0001-0001');
  assert.equal(fr.find((d) => d.fr_doc_num === '2099-22222').comment_url, 'https://www.federalregister.gov/documents/2099/10/01/2099-22222/fixture#open-comment');
  assert.equal(normalizeFederalRegister(FR, Date.parse('2026-10-25T00:00:00Z')).length, 1, 'a passed deadline drops out');
});

test('the same proceeding from both sources is one entry, soonest deadline first', () => {
  const merged = mergeDocuments([normalizeRegulationsGov(RG), normalizeFederalRegister(FR, NOW)]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].fr_doc_num, '2099-22222');
  const epa = merged.find((d) => d.fr_doc_num === '2099-11111');
  assert.equal(epa.provider, 'regulations_gov');
  assert.deepEqual(epa.also_in, ['federal_register']);
});

test('listing: key in X-Api-Key, both sources, honest provider status', async () => {
  const { fetchImpl, calls } = provider();
  const res = await handlePublicComment(req('/v1/public-comment/open?agency=EPA&q=battery'), ON, { fetchImpl, now: NOW, cacheImpl: memoryCache() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.providers.regulations_gov.status, 'ok');
  assert.equal(body.providers.federal_register.status, 'ok');
  assert.equal(body.documents.length, 2);
  assert.equal(body.submission, 'official_form_only');
  const rgCall = calls.find((c) => c.url.startsWith('https://api.regulations.gov/'));
  assert.equal(rgCall.headers['x-api-key'], KEY);
  assert.equal(rgCall.redirect, 'manual');
  assert.doesNotMatch(JSON.stringify(body), new RegExp(KEY), 'the key never reaches the member');
});

test('no key: Regulations.gov is "not_configured", never zero results', async () => {
  const env = { ...ON }; delete env[REGULATIONS_GOV_KEY_ENV];
  const { fetchImpl, calls } = provider();
  const body = await listOpenComments({ agency: '', agency_slug: '', q: '', state: '' }, env, { fetchImpl, now: NOW });
  assert.deepEqual(body.providers.regulations_gov, { status: 'not_configured', env: REGULATIONS_GOV_KEY_ENV });
  assert.equal(body.providers.regulations_gov.count, undefined);
  assert.equal(calls.some((c) => c.url.startsWith('https://api.regulations.gov/')), false);
  assert.equal(body.documents.length, 2);
});

test('a failing source is "error"; both failing is a 502 and nothing is cached', async () => {
  const one = await listOpenComments(parseQuery(new URL('https://x/')), ON, { ...provider({ rgStatus: 429 }), now: NOW });
  assert.equal(one.providers.regulations_gov.status, 'error');
  assert.equal(one.providers.regulations_gov.count, undefined);
  assert.equal(one.ok, true);
  const cache = memoryCache();
  const res = await handlePublicComment(req('/v1/public-comment/open'), ON, { ...provider({ rgStatus: 503, frStatus: 503 }), now: NOW, cacheImpl: cache });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.documents, []);
  assert.equal(cache.size(), 0);
});

test('a good answer is cached for 15 minutes per query', async () => {
  const cache = memoryCache();
  const p = provider();
  await handlePublicComment(req('/v1/public-comment/open?q=river'), ON, { ...p, now: NOW, cacheImpl: cache });
  const fr = () => p.calls.filter((c) => c.url.startsWith('https://www.federalregister.gov/')).length;
  assert.equal(fr(), 1);
  await handlePublicComment(req('/v1/public-comment/open?q=river'), ON, { ...p, now: NOW + 60_000, cacheImpl: cache });
  assert.equal(fr(), 1, 'served from cache inside the window');
  await handlePublicComment(req('/v1/public-comment/open?q=river'), ON, { ...p, now: NOW + 16 * 60_000, cacheImpl: cache });
  assert.equal(fr(), 2, 'refetched after the window');
});

test('handoff: the member files it; we only check the draft and hand back the official link', async () => {
  const ok = commentHandoff({ comment_url: 'https://www.regulations.gov/commenton/EPA-HQ-OAR-2099-0001-0001', text: '  I support stronger battery take-back rules.  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'I support stronger battery take-back rules.');
  assert.equal(ok.filed_by, 'you');
  assert.equal(commentHandoff({ comment_url: 'https://evil.example/commenton/x', text: 'x' }).ok, false, 'only official forms');
  assert.equal(commentHandoff({ comment_url: 'https://www.regulations.gov/commenton/x', text: '' }).ok, false);
  const long = commentHandoff({ comment_url: 'https://www.regulations.gov/commenton/x', text: 'a'.repeat(5001) });
  assert.equal(long.ok, false); assert.equal(long.chars, 5001); assert.match(long.warnings[0], /5000/);
  assert.match(commentHandoff({ comment_url: 'https://www.regulations.gov/commenton/x', text: 'yes 👍' }).warnings.join(' '), /emoji/);

  const p = provider();
  const res = await handlePublicComment(req('/v1/public-comment/handoff', { method: 'POST', body: JSON.stringify({ comment_url: 'https://www.regulations.gov/commenton/EPA-HQ-OAR-2099-0001-0001', text: 'My comment.' }) }), ON, p);
  assert.equal(res.status, 200);
  assert.equal(p.calls.filter((c) => !c.url.startsWith('https://sb.test')).length, 0, 'the handoff sends nothing anywhere');
  assert.equal((await handlePublicComment(req('/v1/public-comment/handoff'), ON, provider())).status, 405);
});

test('the module has no code path that posts a comment', async () => {
  const src = await readFile(new URL('../src/public-comment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(src, /\/v4\/comments['"`]/);
  assert.doesNotMatch(src, /submission-keys/);
});
