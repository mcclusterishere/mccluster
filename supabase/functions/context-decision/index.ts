// CONTEXT-DECISION — record and read owner/admin decisions in the private AI
// context plane. The function verifies the human with Supabase Auth, checks org
// membership, and reads/writes the canonical ai_context.decisions table directly.
// It does not create a second memory or job store and never treats the service
// key as a human identity.
//
// The read side exists because ai_context is a private schema that PostgREST does
// not expose, so neither a browser nor the Worker's REST helper can see a
// decision. Without it, decisions can be recorded and never read back — including
// the ones that are waiting on the owner.

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

const RISK_CLASSES = ['low', 'medium', 'high', 'critical']
const STATUSES = ['proposed', 'approved', 'rejected', 'executed', 'rolled_back', 'superseded']

/* Shared by both methods: membership is the gate, and the service key is never
   accepted as a human. */
async function requireOwnerAdmin(orgId: string, userId: string) {
  const membership = await sql`
    select role from public.org_members
    where org_id = ${orgId}::uuid and profile_id = ${userId}::uuid
    limit 1
  `
  if (!membership.length || !['owner', 'admin'].includes(String(membership[0].role))) {
    throw Object.assign(new Error('owner/admin required'), { status: 403 })
  }
}

/* Bounded, keyset-paged read. Ordered newest first because the reason to open
   this list is "what has been decided lately, and what is still waiting". */
async function listDecisions(url: URL, userId: string) {
  const orgId = String(url.searchParams.get('org_id') ?? '').trim()
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 })

  const csv = (name: string, allowed: string[]) => {
    const raw = String(url.searchParams.get(name) ?? '').trim()
    if (!raw) return [] as string[]
    const values = raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
    const bad = values.find((v) => !allowed.includes(v))
    if (bad) throw Object.assign(new Error(`invalid ${name}: ${bad}`), { status: 400 })
    return values
  }
  const statuses = csv('status', STATUSES)
  const risks = csv('risk_class', RISK_CLASSES)

  const requested = Number(url.searchParams.get('limit') ?? 25)
  const limit = Math.min(100, Math.max(1, Number.isFinite(requested) ? requested : 25))
  const before = url.searchParams.get('before')
  const beforeId = url.searchParams.get('before_id')

  await requireOwnerAdmin(orgId, userId)

  /* Every filter is a bound parameter — no fragment is built from input. The
     cursor is (created_at, id) so decisions sharing a timestamp still page. */
  const rows = await sql`
    select id, org_id, title, decision, rationale_summary, risk_class, status,
           proposed_by, source_conversation_id, supersedes_id, metadata, created_at
    from ai_context.decisions
    where org_id = ${orgId}::uuid
      and (cardinality(${statuses}::text[]) = 0 or status = any(${statuses}::text[]))
      and (cardinality(${risks}::text[]) = 0 or risk_class = any(${risks}::text[]))
      and (
        ${before ?? null}::timestamptz is null
        or created_at < ${before ?? null}::timestamptz
        or (created_at = ${before ?? null}::timestamptz and id < ${beforeId ?? null}::uuid)
      )
    order by created_at desc, id desc
    limit ${limit + 1}
  `
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const oldest = page[page.length - 1]
  return {
    decisions: page,
    has_more: hasMore,
    next_before: oldest ? oldest.created_at : null,
    next_before_id: oldest ? oldest.id : null,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'GET or POST required' }, 405)
  if (!SB || !SRV || !DB) return json({ error: 'not configured' }, 503)

  let user
  try { user = await caller(req) }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'authentication failed' }, Number((error as any)?.status) || 401) }

  if (req.method === 'GET') {
    try {
      return json(await listDecisions(new URL(req.url), String(user.id)))
    } catch (error) {
      const status = Number((error as any)?.status) || 500
      if (status === 500) console.error(error)
      return json({ error: error instanceof Error ? error.message : 'decision read failed' }, status)
    }
  }

  const body: any = await req.json().catch(() => null)
  const orgId = String(body?.org_id ?? '').trim()
  const title = String(body?.title ?? '').trim()
  const decision = String(body?.decision ?? body?.rationale ?? '').trim()
  const riskClass = String(body?.risk_class ?? 'low').trim().toLowerCase()
  const status = String(body?.status ?? 'proposed').trim().toLowerCase()

  if (!orgId || !title || !decision) return json({ error: 'org_id, title, and decision are required' }, 400)
  if (!RISK_CLASSES.includes(riskClass)) return json({ error: 'invalid risk_class' }, 400)
  if (!STATUSES.includes(status)) return json({ error: 'invalid status' }, 400)

  try {
    try { await requireOwnerAdmin(orgId, String(user.id)) }
    catch { return json({ error: 'owner/admin required' }, 403) }

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
