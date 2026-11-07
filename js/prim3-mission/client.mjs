/* One pending request, scoped to the server-confirmed owner. No client correctness claims.
 * Persist before sending; delete only after ACK. A 409 or timeout keeps the pending request.
 */
const BASE = 'https://api.mccluster.org/v1/prim3/learning/adaptive';
const UUID = /^[0-9a-f-]{36}$/;
export function createPracticeClient({ fetchImpl = globalThis.fetch, token, storage = globalThis.sessionStorage }) {
  let scope = null, key = null, data = { sessionId: null, pending: null }, current = null, busy = false, maxEvents = 0;
  const mustFinish = () => Boolean(current && current.flow.nextSeq >= maxEvents);
  const mustAnswer = () => Boolean(current && current.flow.nextSeq === maxEvents - 1 && !current.flow.debrief.attempts);
  const persist = () => { if (key) storage.setItem(key, JSON.stringify(data)); };
  function clear() { if (key) storage.removeItem(key); data = { sessionId: null, pending: null }; current = null; }
  async function request(method, path, body) {
    const auth = token(); if (!auth) { clear(); throw new Error('Sign in again.'); }
    const r = await fetchImpl(BASE + path, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (token() !== auth) { clear(); throw new Error('Account changed. Reload before continuing.'); }
    const out = await r.json();
    if (!r.ok) { const e = new Error(out.error || out.message || 'Practice service unavailable. Retry the pending request.'); e.status = r.status; throw e; }
    return out;
  }
  async function retry() {
    if (!data.pending || busy) throw new Error('No pending request, or a request is still running.');
    busy = true;
    try { const out = await request('POST', data.pending.path, data.pending.body);
      current = out; data.sessionId = out.session_id; data.pending = null; persist(); return out;
    } finally { busy = false; }
  }
  async function queue(path, body) {
    if (!scope) throw new Error('Connect first.');
    if (data.pending || busy) throw new Error('Retry the pending request before another action.');
    data.pending = { path, body };
    try { persist(); } catch { data.pending = null; throw new Error('Browser storage is unavailable; nothing was submitted.'); }
    return retry();
  }
  return {
    async connect() {
      const config = await request('GET', '');
      if (!UUID.test(config.owner_id || '')) throw new Error('Server owner scope missing.');
      if (!Number.isSafeInteger(config.max_events) || config.max_events < 4) throw new Error('Practice event limit unavailable.');
      maxEvents = config.max_events;
      scope = config.owner_id; key = `prim3.adaptive.pending.v1:${scope}`;
      try { const saved = JSON.parse(storage.getItem(key) || 'null');
        // Treat storage as untrusted: requests are restricted to this API's session routes.
        if (saved && typeof saved === 'object' && !Array.isArray(saved) && (!saved.sessionId || UUID.test(saved.sessionId)) && (!saved.pending ||
          (/^\/sessions(?:\/[0-9a-f-]{36}\/events)?$/.test(saved.pending.path) && saved.pending.body && typeof saved.pending.body === 'object' && !Array.isArray(saved.pending.body)))) data = saved;
      } catch { storage.removeItem(key); }
      if (data.sessionId) current = await request('GET', `/sessions/${data.sessionId}`);
      return { config, current };
    },
    start(review, { releaseId, learningContext } = {}) {
      if (data.sessionId) throw new Error('Continue the current session.');
      if (review?.fictionChecked !== true || review?.geographyChecked !== true) throw new Error('Complete both owner review checks first.');
      if (releaseId !== undefined && !UUID.test(releaseId)) throw new Error('Release UUID required.');
      return queue('/sessions', { ...(releaseId ? {release_id:releaseId}:{}), ...(learningContext ? {learning_context:learningContext}:{}), session_id: crypto.randomUUID(), template_id: 'relay-distance-v1', review });
    },
    submit(type, fields = {}) {
      if (!current) throw new Error('Start the reviewed mission first.');
      if (type !== 'finish' && mustFinish()) throw new Error('Practice limit reached. Save your debrief.');
      if (type === 'hint' && mustAnswer()) throw new Error('Answer this checkpoint before saving your debrief.');
      if (type === 'answer' && !(typeof fields.answer === 'string' && /^-?\d{1,8}$/.test(fields.answer.trim()))) throw new Error('Enter a whole-number distance.');
      return queue(`/sessions/${current.session_id}/events`, { ...fields, id: crypto.randomUUID(), seq: current.flow.nextSeq,
        type, questionId: current.flow.question?.id ?? null });
    },
    newPractice() {
      if (busy || data.pending || current?.flow?.phase !== 'debrief' || current?.evidence?.closed !== true)
        throw new Error('Save and acknowledge your debrief before starting another practice.');
      clear();
    },
    progress: () => request('GET', '/progress'),
    retry, clear,
    get current() { return current; },
    get pending() { return data.pending !== null; },
    get mustFinish() { return mustFinish(); },
    get mustAnswer() { return mustAnswer(); },
  };
}
