import { defineInstallation } from '../installation/config.mjs';
const UUID = '[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
const assignment = new RegExp(`^/assignments/${UUID}/(?:proof|share)$`);
const proofReview = new RegExp(`^/proofs/${UUID}/review$`);
const planningPaths=['/planning/context','/planning/review','/planning/mission','/planning/sponsor-draft','/planning/companies'];
const mission = new RegExp(`^/missions/${UUID}/(?:join|review)$`);
export function createEnvironmentTransport({ installation, fetchImpl, token, allowLocalhost = false, messages = {} }) {
  // Snapshot before any asynchronous work. No production default or storage reads.
  const config = defineInstallation(installation, { allowLocalhost });
  if (!config.modules.environment) throw new Error('The environment module is disabled.');
  if (typeof fetchImpl !== 'function' || typeof token !== 'function') throw new TypeError('Supply fetch and the installation-owned session callback.');
  const errors = { ...messages };
  return Object.freeze({ async request(path, options = {}) {
    const { method = 'GET', body, signal } = options;
    const publicRead = path === '' && method === 'GET';
    const privateRead = method === 'GET' && (['/team', '/oversight','/proofs'].includes(path) || (typeof path==='string' && assignment.test(path) && path.endsWith('/proof')));
    const privateWrite = method === 'POST' && (path === '/team' || path === '/missions/propose' || planningPaths.includes(path) || (typeof path === 'string' && (mission.test(path) || assignment.test(path) || proofReview.test(path))));
    if (!publicRead && !privateRead && !privateWrite) throw new Error('Unsupported environmental operation.');
    // Every mutation must carry the identity and lifecycle guard captured when the
    // action was confirmed (audit EQ1, 2026-11-09). A handler cannot opt out: a
    // confirmed action must never be rebound to a later account or sent after unmount.
    if (privateWrite && (typeof options.expectedToken !== 'string' || !options.expectedToken || typeof options.isCurrent !== 'function')) throw new TypeError('Environmental mutations require the identity and lifecycle guard (expectedToken, isCurrent).');
    if (typeof options.isCurrent==='function' && options.isCurrent()!==true) throw Object.assign(new Error('This action is no longer current. Reopen it before continuing.'),{status:409});
    const credential = publicRead ? null : await token();
    if (!publicRead && (typeof credential !== 'string' || !credential)) throw Object.assign(new Error(errors.sign_in_required || 'Sign in to participate.'), { status: 401 });
    if (!publicRead && options.expectedToken !== undefined) {
      if (credential !== options.expectedToken || await token() !== credential) throw Object.assign(new Error('Your account changed. Reopen this action before continuing.'),{status:409});
    }
    if (typeof options.isCurrent==='function' && options.isCurrent()!==true) throw Object.assign(new Error('This action is no longer current. Reopen it before continuing.'),{status:409});
    // A redirect must never carry the bearer token to another recipient. The
    // caller cannot supply headers, credentials, an origin or a URL override.
    const response = await fetchImpl(config.apiOrigin + '/v1/world/environment' + path, {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
      headers: { accept: 'application/json', ...(credential ? { authorization: 'Bearer ' + credential } : {}), ...(privateWrite ? { 'content-type': 'application/json' } : {}) },
      ...(privateWrite ? { body: JSON.stringify(body ?? {}) } : {})
    });
    let result;
    try { result = await response.json(); } catch {
      throw new Error('Environmental response could not be read. No change was confirmed; refresh before retrying.');
    }
    if (!response.ok) throw Object.assign(new Error(errors[result?.code] || 'Environmental request could not be confirmed. Refresh before trying again.'), { status: response.status });
    if (!result || typeof result !== 'object' || Array.isArray(result) || (!publicRead && result.ok !== true)) throw new Error('Unsupported environmental response.');
    return result;
  } });
}
