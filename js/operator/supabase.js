/* ============================================================
   DIRECT SUPABASE READS.

   CRM and Back Office are not Worker surfaces: the existing site reads
   `/rest/v1/leads` and `/rest/v1/rights_flags` from PostgREST directly,
   with RLS as the wall. This console follows the same path rather than
   inventing Worker endpoints for data the Worker never served.

   It uses the OPERATOR'S OWN token, not a service key, so RLS applies
   exactly as it does to any signed-in user. The publishable key is
   public by design (AGENTS.md rule 5) but is not hardcoded here — it is
   read from whatever the page already configured, and when it is absent
   the caller degrades visibly instead of silently returning nothing.
   ============================================================ */

import { authToken } from './api.js';

export const SUPABASE_URL = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';

function publishableKey() {
  return window.MCC_SUPABASE_ANON_KEY
    || window.SB_KEY
    || (window.MCC_SUPA && window.MCC_SUPA.key)
    || (window.MCC_ENV && window.MCC_ENV.SUPABASE_ANON_KEY)
    || null;
}

export function configured() { return Boolean(publishableKey()); }

export const NOT_CONFIGURED = {
  ok: false, status: 0, code: 'supabase_key_unavailable', auth: false,
  message: 'This surface reads Supabase directly, and the publishable key is not exposed to this page. '
         + 'Set window.MCC_SUPABASE_ANON_KEY (it is public by design) or serve the console from a page that already defines it.',
  detail: null
};

export async function sbSelect(path) {
  const key = publishableKey();
  if (!key) return NOT_CONFIGURED;
  const token = await authToken();
  if (!token) return { ok:false, status:401, code:'no_session', message:'Not signed in.', auth:true, detail:null };

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    return { ok:false, status:0, code:'network', message:'Could not reach Supabase.', detail:error?.message, auth:false };
  }
  const text = await response.text().catch(() => '');
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text.slice(0,400) }; } }
  if (!response.ok) {
    return { ok:false, status:response.status, code:data?.code || `http_${response.status}`,
             message:data?.message || data?.hint || `${response.status} ${response.statusText}`,
             detail:data, auth:response.status===401||response.status===403 };
  }
  /* A 200 that is not an array means the query did not do what we think. */
  if (!Array.isArray(data)) {
    return { ok:false, status:200, code:'invalid_shape',
             message:'Supabase returned a non-array body where rows were expected.', detail:data, auth:false };
  }
  return { ok:true, data };
}
