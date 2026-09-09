// CONTEXT-INGEST — canonical Supabase-side ingress to the shared AI context plane.
// Reconciled from Grok's ai_ingest envelope/RPC architecture and Claude's
// verified-caller audit hardening. The Edge Function self-authenticates because
// service-role ingestion is also supported; ai_ingest itself is service-only.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { authzResponse, verifyCaller } from '../_shared/authz.ts'

const SB = Deno.env.get('SUPABASE_URL') ?? ''
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PROVIDERS = new Set(['chatgpt', 'claude', 'grok', 'gemini', 'copilot', 'local', 'other'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  })
}

async function serviceRpc(name: string, body: unknown) {
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
  if (!r.ok) throw Object.assign(new Error(data?.message || `${name} failed`), { status: r.status, detail: data })
  return data
}

async function houseOrg() {
  const r = await fetch(`${SB}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: { apikey: SRV, authorization: `Bearer ${SRV}` },
  })
  const rows = await r.json().catch(() => [])
  return rows?.[0]?.id ? String(rows[0].id) : ''
}

async function authorize(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : ''
  if (SRV && token === SRV) return { kind: 'service' as const, userId: null, orgId: null }

  let caller
  try {
    caller = await verifyCaller(req)
  } catch (e) {
    const response = authzResponse(e, cors)
    if (response) throw Object.assign(new Error('authentication failed'), { response })
    throw e
  }

  const orgId = await houseOrg()
  if (!orgId) throw Object.assign(new Error('house organization not configured'), { status: 503 })
  const r = await fetch(
    `${SB}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(caller.id)}&select=role&limit=1`,
    { headers: { apikey: SRV, authorization: `Bearer ${SRV}` } },
  )
  const memberships = await r.json().catch(() => [])
  const role = String(memberships?.[0]?.role ?? '')
  if (!['owner', 'admin'].includes(role)) throw Object.assign(new Error('owner/admin required'), { status: 403 })
  return { kind: 'operator' as const, userId: caller.id, orgId }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  if (!SB || !SRV) return json({ error: 'not configured' }, 503)

  let who
  try {
    who = await authorize(req)
  } catch (e) {
    const response = (e as any)?.response
    if (response instanceof Response) return response
    return json({ error: e instanceof Error ? e.message : 'authentication failed' }, Number((e as any)?.status) || 401)
  }

  const body: any = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'envelope required' }, 400)
  if (!body.org_id && who.kind === 'operator') body.org_id = who.orgId
  if (!UUID.test(String(body.org_id || ''))) return json({ error: 'valid org_id required' }, 400)
  if (who.kind === 'operator' && body.org_id !== who.orgId) return json({ error: 'cross-org ingestion denied' }, 403)

  const provider = String(body.provider || '').toLowerCase()
  if (!PROVIDERS.has(provider)) return json({ error: 'unsupported provider' }, 400)
  body.provider = provider
  if (!body.external_conversation_id) return json({ error: 'external_conversation_id required' }, 400)
  if (!body.idempotency_key) return json({ error: 'idempotency_key required' }, 400)
  if (body.messages !== undefined && !Array.isArray(body.messages)) return json({ error: 'messages must be an array' }, 400)
  if (Array.isArray(body.messages) && body.messages.length > 5000) return json({ error: 'message batch too large' }, 413)
  for (const message of body.messages ?? []) {
    if (!message || typeof message !== 'object' || typeof message.content !== 'string') {
      return json({ error: 'every message requires string content' }, 400)
    }
  }

  body.metadata = {
    ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
    ingress: 'supabase-context-ingest',
    ingested_by: who.userId,
  }

  try {
    const data = await serviceRpc('ai_ingest', { envelope: body })
    return json(data, data?.duplicate ? 200 : 202)
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : 'ingestion failed' }, Number((e as any)?.status) || 500)
  }
})
