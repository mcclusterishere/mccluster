/* Fetch a public page and keep both the raw HTML and a text view.
   The email rule checks the RAW fetched content: an address counts only if that exact string is on the page. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
export function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<a\s[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function createFetcher(config, { fetchImpl = globalThis.fetch, fixturePages } = {}) {
  const cache = new Map();
  const pages = fixturePages ? JSON.parse(fs.readFileSync(fixturePages, 'utf8')) : null;
  return async function fetchPage(url) {
    if (cache.has(url)) return cache.get(url);
    let raw = null, status = 0, error = null;
    if (pages) {
      raw = pages[url] ?? null; status = raw == null ? 404 : 200;
    } else {
      try {
        const res = await fetchImpl(url, { headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        status = res.status;
        if (res.ok) raw = (await res.text()).slice(0, 2_000_000);
      } catch (e) { error = e.message; }
    }
    const page = raw == null ? { url, ok: false, status, error } : {
      url, ok: true, status, raw, text: htmlToText(raw),
      sha256: createHash('sha256').update(raw).digest('hex'), fetchedAt: new Date().toISOString(),
    };
    cache.set(url, page);
    return page;
  };
}

export function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
export function registrable(host) { const p = String(host).split('.'); return p.slice(-2).join('.'); }
