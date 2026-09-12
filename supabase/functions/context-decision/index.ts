// CONTEXT-DECISION — record an owner/admin decision in the private AI context plane.
// The function verifies the human with Supabase Auth, checks org membership, and
// writes directly to the canonical ai_context.decisions table. It does not create
// a second memory or job store and never treats the service key as a human identity.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'

const SB = Deno.env.get('SUPABASE_URL') ?? ''
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DB = Deno.env.get('SUPABASE_DB_URL') ?? ''
const sql = postgres(DB, { prepare: false, max: 1 })

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function caller(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  if (!/^bearer\s+/i.test(header)) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const token = header.replace(/^bearer\s+/i, '').trim()
  if (!token || token === SRV) throw Object.assign(new Error('Service credentials are not a human identity'), { status: 403 })
  const response = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const user = await response.json().catch(() => null)
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return user
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  if (!SB || !SRV || !DB) return json({ error: 'not configured' }, 503)

  let user
  try { user = await caller(req) }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'authentication failed' }, Number((error as any)?.status) || 401) }

  const body: any = await req.json().catch(() => null)
  const orgId = String(body?.org_id ?? '').trim()
  const title = String(body?.title ?? '').trim()
  const decision = String(body?.decision ?? body?.rationale ?? '').trim()
  const riskClass = String(body?.risk_class ?? 'low').trim().toLowerCase()
  const status = String(body?.status ?? 'proposed').trim().toLowerCase()

  if (!orgId || !title || !decision) return json({ error: 'org_id, title, and decision are required' }, 400)
  if (!['low', 'medium', 'high', 'critical'].includes(riskClass)) return json({ error: 'invalid risk_class' }, 400)
  if (!['proposed', 'approved', 'rejected', 'executed', 'rolled_back', 'superseded'].includes(status)) return json({ error: 'invalid status' }, 400)

  try {
    const membership = await sql`
      select role from public.org_members
      where org_id = ${orgId}::uuid and profile_id = ${user.id}::uuid
      limit 1
    `
    if (!membership.length || !['owner', 'admin'].includes(String(membership[0].role))) {
      return json({ error: 'owner/admin required' }, 403)
    }

    const [row] = await sql`
      insert into ai_context.decisions (
        org_id, title, decision, rationale_summary, risk_class, status,
        proposed_by, source_conversation_id, source_message_ids, supersedes_id, metadata
      ) values (
        ${orgId}::uuid,
        ${title},
        ${decision},
        ${body.rationale_summary ?? body.rationale ?? null},
        ${riskClass},
        ${status},
        ${String(user.id)},
        ${body.source_conversation_id ?? null}::uuid,
        ${Array.isArray(body.source_message_ids) ? body.source_message_ids : []}::uuid[],
        ${body.supersedes_id ?? null}::uuid,
        ${sql.json({ ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}), ingress: 'context-decision' })}
      )
      returning id, org_id, title, decision, rationale_summary, risk_class, status, proposed_by, created_at
    `

    return json({ decision: row }, 201)
  } catch (error) {
    console.error(error)
    return json({ error: 'decision write failed', detail: error instanceof Error ? error.message : String(error) }, 500)
  }
})
