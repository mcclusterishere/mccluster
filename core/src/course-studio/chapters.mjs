import { createHash } from 'node:crypto';
import { COURSE_STUDIO_SOURCES } from './source-catalog.mjs';

export const SOURCE_BYTE_LIMIT = 1024 * 1024;
const markers = {
  algebra: ['linear functions', 'average rate of change is constant', 'point-slope form', 'slope-intercept form'],
  calculus: ['elementary derivative rules', 'instantaneous rate of change', 'constant multiple rule', 'sum rule', 'power functions'],
  chemistry: ['composition of an atom', 'gain or lose electrons', 'number of protons', 'different number of neutrons', 'carbon-13'],
};

export function selectChapters(urls) {
  if (!Array.isArray(urls) || !urls.length || urls.length > COURSE_STUDIO_SOURCES.length ||
      new Set(urls).size !== urls.length) throw new Error('Study source selection is invalid');
  return urls.map(url => {
    const chapter = COURSE_STUDIO_SOURCES.find(s => s.url === url);
    if (!chapter) throw new Error('Study source is not in the supported catalog');
    return chapter;
  });
}

// Fetch only canonical GETs, with no user parameters, credentials, redirects,
// or private context. Keep only source evidence, never HTML or excerpts.
export async function verifyChapter(url, { fetchImpl = fetch, signal, now = () => new Date() } = {}) {
  const [chapter] = selectChapters([url]);
  const timeout = AbortSignal.timeout(9000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let reader;
  try {
    const res = await fetchImpl(chapter.url, {
      method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { accept: 'text/html' }, signal: combined,
    });
    reader = res.body?.getReader();
    if (!reader || res.status !== 200 || res.redirected || (res.url && res.url !== chapter.url) ||
        !/^text\/html(?:\s*;|$)/i.test(res.headers.get('content-type') || '') ||
        Number(res.headers.get('content-length') || 0) > SOURCE_BYTE_LIMIT) throw new Error();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > SOURCE_BYTE_LIMIT) throw new Error();
      chunks.push(value);
    }
    const body = Buffer.concat(chunks, bytes);
    // This result is used only for confirming chapter content, never rendered,
    // appended to a prompt, used as an answer, or copied into the bundle.
    const plain = body.toString('utf8').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').toLowerCase();
    if (!markers[chapter.topic].every(marker => plain.includes(marker))) throw new Error();
    const { topic: _topic, ...citation } = chapter;
    return { ...citation, sha256: createHash('sha256').update(body).digest('hex'),
      bytes, checked_at: now().toISOString() };
  } catch {
    // No fetch error text, document content, URL parameters or DB messages in
    // ops_agent_jobs.last_error, which the generic runner also logs.
    if (signal?.aborted) throw Object.assign(new Error('Study build lease ended'), { code: 'LEASE_LOST' });
    throw new Error('Study chapter could not be verified');
  } finally {
    if (reader) { try { await reader.cancel(); } catch { /* already aborted */ } finally { reader.releaseLock(); } }
  }
}
