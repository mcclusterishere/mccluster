/* Optional adapter for the canonical McCluster owner-authorized levels API.
 * The standalone preview has no MCC_SUPA session and remains device-local.
 * Tokens are obtained afresh per request; no credentials or revisions are stored here.
 */
(function (root) {
  'use strict';
  const BASE = 'https://api.mccluster.org/v1/prim3/levels';
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
  class LevelAPIError extends Error {
    constructor(message, code, status, detail) { super(message); this.name = 'LevelAPIError'; this.code = code; this.status = status; this.detail = detail; }
  }
  const configured = () => typeof root.MCC_SUPA?.token === 'function';
  function idPath(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new LevelAPIError('This level has an invalid ID.', 'invalid_id', 0);
    return '/' + encodeURIComponent(id);
  }
  function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new LevelAPIError('Open the cloud draft before updating it.', 'revision_required', 0);
    return value;
  }
  async function request(method, path, body) {
    if (!configured()) throw new LevelAPIError('Cloud tools are available in McCluster Control. This preview saves drafts on this device.', 'not_configured', 0);
    let token;
    try { token = await root.MCC_SUPA.token(); } catch (_) {}
    if (typeof token !== 'string' || !token.trim()) throw new LevelAPIError('Sign in to your McCluster account, then try again.', 'authentication_required', 401);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    let response, payload;
    try {
      response = await fetch(BASE + path, {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      try { payload = await response.json(); }
      catch (_) { throw new LevelAPIError('The server returned an unexpected response. Open the cloud draft to verify its state before saving again.', 'unexpected_response', response.status); }
    } catch (error) {
      if (error instanceof LevelAPIError) throw error;
      const uncertain = method === 'GET' ? 'Try again when the connection is available.' : 'Open the cloud draft to verify whether the change was saved before trying again.';
      throw new LevelAPIError(`The cloud request did not complete. ${uncertain}`, error?.name === 'AbortError' ? 'request_timeout' : 'network_error', 0);
    } finally { clearTimeout(timer); token = null; }
    if (!response.ok || payload?.ok !== true) {
      const code = payload?.code || 'request_failed';
      let message = payload?.error || 'The cloud request could not be completed.';
      if (code === 'level_exists') message = 'A cloud draft already uses this level ID. Open that cloud draft before saving changes to it.';
      if (code === 'revision_conflict') message = 'This cloud draft changed in another session. Export your local work, then open the cloud draft again. Nothing was overwritten.';
      if (code === 'authentication_required') message = 'Sign in to your McCluster account, then try again.';
      if (code === 'owner_required') message = 'This account does not have permission to manage PRIM3 levels.';
      if (code === 'schema_not_installed') message = 'Cloud level storage is not ready yet. Your device draft is still available.';
      throw new LevelAPIError(message, code, response.status, payload?.detail);
    }
    return payload;
  }
  root.P3LevelClient = Object.freeze({
    isConfigured: configured,
    list: ({ offset = 0, limit = 50 } = {}) => {
      const n = Math.max(0, Math.floor(Number(offset) || 0)), size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
      return request('GET', `?offset=${n}&limit=${size}`);
    },
    get: id => request('GET', idPath(id)),
    create: level => request('POST', '', { level }),
    save: (id, level, expectedRevision) => request('PATCH', idPath(id), { level, expectedRevision: revision(expectedRevision) }),
    freeze: (id, expectedRevision) => request('POST', idPath(id) + '/publish', { expectedRevision: revision(expectedRevision) }),
    versions: id => request('GET', idPath(id) + '/versions'),
    version: (id, versionNumber) => {
      if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new LevelAPIError('Choose a valid saved version.', 'invalid_version', 0);
      return request('GET', idPath(id) + '/versions/' + versionNumber);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
