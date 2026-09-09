// CONTEXT-QUERY — authenticated search of the private cross-model context plane.
// Reconciled from Claude's verified identity/tenant boundary and Grok's canonical
// ai_retrieve RPC/schema. Browser callers never receive service credentials and
// never receive direct access to the private ai_context schema.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { authzResponse, verifyCaller } from '../_shared/authz.ts'

const SB = Deno.env.get('SUPABASE_URL') ?? ''
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function serviceGet(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: SRV, authorization: `Bearer ${SRV}` },
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`database read failed (${r.status})`)
  return data
}

async function serviceRpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SRV,
      authorization: `Bearer ${SRV}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.message || `${name} failed (${r.status})`)
  return data
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  if (!SB || !SRV) return json({ error: 'not configured' }, 503)

  let caller
  try {
    caller = await verifyCaller(req)
  } catch (e) {
    return authzResponse(e, {}) ?? json({ error: 'authentication failed' }, 401)
  }

  const body: { org_id?: string; query?: string; limit?: number } = await req.json().catch(() => ({}))
  const orgId = String(body.org_id ?? '').trim()
  const query = String(body.query ?? '').trim().slice(0, 4000)
  const limit = Math.min(Math.max(Number(body.limit ?? 12) || 12, 1), 32)
  if (!UUID.test(orgId)) return json({ error: 'valid org_id required' }, 400)
  if (!query) return json({ error: 'query required' }, 400)

  try {
    const membership = await serviceGet(
      `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(caller.id)}&select=role&limit=1`,
    )
    if (!membership?.length) return json({ error: 'not authorized for requested organization' }, 403)

    // ai_retrieve is deliberately service-role-only. This authenticated gateway
    // enforces tenant membership before invoking it, keeping ai_context private.
    const result = await serviceRpc('ai_retrieve', {
      p_org: orgId,
      p_query: query,
      p_limit: limit,
    })

    return json({ query, ...result })
  } catch (error) {
    console.error(error)
    return json({ error: 'context query failed', detail: error instanceof Error ? error.message : String(error) }, 500)
  }
})
