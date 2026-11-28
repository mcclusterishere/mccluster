// The Creator Suite side of a production job, as a small client of the
// staging production API (production-api.mjs). Creator Suite needs three
// things from Core and nothing else: submit a typed shot, watch it, open
// the preview the worker produced. This module is that contract in code;
// docs/control-plane/PRODUCTION-PIPELINE.md → "Creator Suite contract"
// gives the same calls as plain HTTP for a client in another language.
//
//   const core = productionClient({ baseUrl, token, client: 'creator-suite' });
//   const { job } = await core.submit(manifest);                 // core.production.render.submit
//   const done = await core.waitFor(job.id, { onProgress });     // core.production.job.get, polled
//   const { url, path } = await core.openPreview(done.id);       // a playable URL and the local file
//
// The client never names a worker path, a command or the actor; the API
// stamps the owner and the staging org.

export class ProductionClientError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) { super(message); this.status = status; this.code = code; this.body = body; }
}

export const TERMINAL = Object.freeze(['succeeded', 'failed', 'canceled']);

export function productionClient({ baseUrl, token, client = 'creator-suite', fetchImpl = globalThis.fetch } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new ProductionClientError('the staging production API is loopback only (http://127.0.0.1:<port>)');
  if (!token) throw new ProductionClientError('the owner token is required');

  async function request(method, route, body) {
    const res = await fetchImpl(`${base}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-mccluster-client': client, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) throw new ProductionClientError(parsed?.error || `HTTP ${res.status}`, { status: res.status, code: parsed?.code || null, body: parsed });
    return parsed;
  }

  const call = (tool, args = {}) => request('POST', `/v1/production/tools/${tool}`, args);

  return {
    call,
    validate: (manifest) => call('core.production.shot.validate', { manifest }),
    submit: (manifest, { maxAttempts } = {}) => call('core.production.render.submit', { manifest, ...(maxAttempts ? { max_attempts: maxAttempts } : {}) }),
    retake: (jobId, changes = {}) => call('core.production.render.submit', { retake_of: jobId, changes }),
    cancel: (jobId, reason) => call('core.production.job.cancel', { job_id: jobId, ...(reason ? { reason } : {}) }),
    artifacts: (jobId) => call('core.production.artifact.get', { job_id: jobId }),
    job: async (jobId) => (await request('GET', `/v1/production/jobs/${jobId}`)).job,
    async waitFor(jobId, { onProgress = () => {}, intervalMs = 2000, timeoutMs = 3_600_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last = '';
      for (;;) {
        const job = await this.job(jobId);
        const sig = JSON.stringify([job.status, job.progress, job.worker?.node_id, job.attempts]);
        if (sig !== last) { last = sig; onProgress(job); }
        if (TERMINAL.includes(job.status)) return job;
        if (Date.now() > deadline) throw new ProductionClientError(`job ${jobId} is still ${job.status} after ${Math.round(timeoutMs / 1000)} s`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    // A succeeded job's verified preview: a URL any player on this machine
    // can open (a 10-minute ticket, Range requests) and the file itself.
    async openPreview(jobId) {
      const ticket = await request('POST', `/v1/production/jobs/${jobId}/preview-ticket`);
      return { url: `${base}${ticket.url}`, path: ticket.path, bytes: ticket.bytes, expires_in_s: ticket.expires_in_s };
    }
  };
}
