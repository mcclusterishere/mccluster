/* ============================================================
   THE OPERATOR API CLIENT.

   One place that knows how to talk to api.mccluster.org, so no module
   re-invents auth, error shape or the difference between "empty" and
   "could not read". That distinction is the whole reason this file
   exists as a layer rather than a fetch helper: an operator console
   that renders a failed read as an empty table is worse than one that
   shows nothing, because it looks answered.

   Every call resolves to a Result:

     { ok: true,  data }
     { ok: false, status, code, message, detail, auth }

   Nothing here throws on an HTTP error. Callers branch on `ok`, and the
   shared primitives in ui.js render a failed Result as a visible,
   explained error state rather than as absence.
   ============================================================ */

export const API_BASE = 'https://api.mccluster.org';

/* mcc-auth.js owns the Supabase session for the whole site. The console
   borrows it rather than starting a second auth story. */
function tokenSource() {
  if (window.MCC_SUPA && typeof window.MCC_SUPA.token === 'function') return window.MCC_SUPA.token();
  if (window.MCC_AUTH && typeof window.MCC_AUTH.token === 'function') return window.MCC_AUTH.token();
  return Promise.resolve(null);
}

let cachedToken = null;
let cachedAt = 0;

export async function authToken({ force = false } = {}) {
  if (!force && cachedToken && Date.now() - cachedAt < 30_000) return cachedToken;
  try {
    cachedToken = await tokenSource();
    cachedAt = Date.now();
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export function clearToken() { cachedToken = null; cachedAt = 0; }

function failure(status, code, message, detail, auth = false) {
  return { ok: false, status, code, message, detail: detail ?? null, auth };
}

/* A single request. Timeouts, aborts and non-JSON bodies all become
   Results rather than exceptions, because an operator needs to see
   "the edge timed out" in the panel that wanted the data, not in a
   console the browser already scrolled past. */
export async function request(path, {
  method = 'GET', body, auth = true, timeoutMs = 20_000, headers = {}
} = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };

  if (auth) {
    const token = await authToken();
    if (!token) return failure(401, 'no_session', 'Not signed in.', null, true);
    init.headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return failure(
      0,
      timedOut ? 'timeout' : 'network',
      timedOut ? `No answer from the edge within ${Math.round(timeoutMs / 1000)}s.` : 'Could not reach api.mccluster.org.',
      error?.message || String(error)
    );
  }

  const text = await response.text().catch(() => '');
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { raw: text.slice(0, 600) }; }
  }

  if (!response.ok) {
    const isAuth = response.status === 401 || response.status === 403;
    return failure(
      response.status,
      data?.detail?.code || data?.code || `http_${response.status}`,
      data?.error || data?.message || `${response.status} ${response.statusText}`,
      data?.detail ?? data,
      isAuth
    );
  }
  return { ok: true, data };
}

export const get = (path, options) => request(path, { ...options, method: 'GET' });
export const post = (path, body, options) => request(path, { ...options, method: 'POST', body });

/* Fan-out for panels that aggregate several reads. Each leg keeps its own
   Result, so one dead endpoint greys one panel instead of blanking the
   board — and the caller can still say which leg died. */
export async function all(spec) {
  const names = Object.keys(spec);
  const results = await Promise.all(names.map((name) => spec[name]));
  const out = {};
  names.forEach((name, index) => { out[name] = results[index]; });
  out.degraded = names.filter((name) => !out[name].ok);
  out.anyOk = names.some((name) => out[name].ok);
  return out;
}

/* ---------- the endpoint surface, named once ----------
   Modules call these rather than string literals, so a route change is
   one edit and the audit doc has something to match against. */
export const endpoints = {
  health:            () => get('/health', { auth: false }),
  healthz:           () => get('/healthz', { auth: false }),
  catalogue:         () => get('/v1', { auth: false }),
  me:                () => get('/v1/me'),
  status:            () => get('/v1/status'),
  apps:              () => get('/v1/apps', { auth: false }),
  feeQuote:          (params) => get(`/v1/fees/quote?${new URLSearchParams(params)}`, { auth: false }),

  aiCatalogue:       () => get('/v1/ai'),
  aiStatus:          () => get('/v1/ai/status'),
  aiSystemHealth:    () => get('/v1/ai/system-health'),
  aiRefreshHealth:   (body) => post('/v1/ai/system-health', body || {}),
  aiTask:            (body) => post('/v1/ai/task', body),
  aiEnqueue:         (body) => post('/v1/ai/jobs', body),
  aiJob:             (id) => get(`/v1/ai/jobs/${encodeURIComponent(id)}`),
  aiRetrieve:        (body) => post('/v1/ai/retrieve', body),
  aiDecision:        (body) => post('/v1/ai/decisions', body),
  coreBridge:        () => get('/v1/core'),

  comms:             () => get('/v1/comms'),
  commsThreads:      (query) => get(`/v1/comms/threads${query ? `?${new URLSearchParams(query)}` : ''}`),
  commsTakeover:     (id) => post(`/v1/comms/threads/${encodeURIComponent(id)}/takeover`, {}),
  commsRelease:      (id) => post(`/v1/comms/threads/${encodeURIComponent(id)}/release`, {}),
  commsSend:         (id, body) => post(`/v1/comms/threads/${encodeURIComponent(id)}/send`, body),

  mediaModels:       () => get('/v1/media/models'),
  mediaRecommend:    (body) => post('/v1/media/recommend', body),
  mediaGenerate:     (body) => post('/v1/media/generate', body),
  mediaBakeoff:      (body) => post('/v1/media/bakeoff', body),
  mediaJob:          (id) => get(`/v1/media/jobs/${encodeURIComponent(id)}`),

  socialAccounts:    () => get('/v1/social/accounts'),
  socialCampaigns:   () => get('/v1/social/campaigns'),
  socialAutomations: () => get('/v1/social/automations'),
  socialCreateAccount: (body) => post('/v1/social/accounts', body),
  socialCreateCampaign: (body) => post('/v1/social/campaigns', body),
  socialVariants:    (body) => post('/v1/social/variants/generate', body),
  socialPublish:     (body) => post('/v1/social/publish', body),
  socialMetrics:     (body) => post('/v1/social/metrics', body),

  platformCatalog:   () => get('/v1/platform/catalog'),
  platformPlans:     () => get('/v1/platform/plans'),
  developerConsumers:() => get('/v1/developer/consumers'),
  computeCatalog:    () => get('/v1/compute/catalog'),
  computeBalance:    () => get('/v1/compute/balance'),

  prim3:             () => get('/v1/prim3', { auth: false }),
  prim3Course:       () => get('/v1/prim3/course', { auth: false }),
  prim3CourseHealth: () => get('/v1/prim3/course/health', { auth: false }),

  whipOperators:     () => get('/api/operators/mine'),
  whipLeads:         () => get('/api/sales/leads'),
  whipIdentityStatus:() => get('/api/identity/status')
};
