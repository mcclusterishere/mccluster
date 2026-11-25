import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { emailsOnPage, findPublishedEmail, findWealthSignal, wealthSignalOnPage } from '../src/verify.mjs';

const page = (url, raw) => ({ url, ok: true, raw, text: raw.replace(/<[^>]+>/g, ' '), sha256: 'x', fetchedAt: 'now' });

test('an address counts only when its exact string is on the fetched page, and the URL is kept', async () => {
  const t = setup();
  const hit = await findPublishedEmail({ person: { name: 'Dana Whitfield', organization: 'Larkspur Ventures' }, search: t.search, fetchPage: t.fetchPage });
  assert.equal(hit.email, 'dana@danawhitfield.example');
  assert.equal(hit.url, 'https://danawhitfield.example/contact');
  assert.equal(hit.literal, 'raw');
});
test('obfuscated, guessed and broker addresses are never accepted', async () => {
  const t = setup();
  assert.equal(await findPublishedEmail({ person: { name: 'Harlan Voss' }, search: t.search, fetchPage: t.fetchPage }), null);
  assert.equal(await findPublishedEmail({ person: { name: 'Ellis Brandt' }, search: t.search, fetchPage: t.fetchPage }), null);
  assert.deepEqual(emailsOnPage(page('https://rocketreach.co/x', 'Jane Roe jane@roe.example'), 'Jane Roe'), []);
});
test('generic and unrelated addresses on a page are skipped', () => {
  const p = page('https://news.example.com/a', 'Jane Roe spoke. Contact info@news.example.com or tips@other.example.');
  assert.deepEqual(emailsOnPage(p, 'Jane Roe'), []);
});
test('wealth needs a recognized source, the person, and $1M or more next to their name', async () => {
  const t = setup();
  const dana = await findWealthSignal({ person: { name: 'Dana Whitfield' }, search: t.search, fetchPage: t.fetchPage });
  assert.equal(dana.kind, 'forbes');
  assert.equal(dana.amountUsd, 1.4e9);
  assert.equal(dana.url, 'https://www.forbes.com/profile/dana-whitfield/');
  assert.equal(await findWealthSignal({ person: { name: 'Jordan Pike' }, search: t.search, fetchPage: t.fetchPage }), null);
  assert.equal(wealthSignalOnPage(page('https://randomblog.example/x', 'Jane Roe is worth $9 billion'), 'Jane Roe'), null);
  assert.equal(wealthSignalOnPage(page('https://www.sec.gov/x', 'Jane Roe total compensation $2,400,000'), 'Jane Roe').kind, 'disclosed_pay');
});
