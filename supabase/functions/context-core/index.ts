// CONTEXT-CORE — token-gated server-to-server reader for McCluster Core.
// Raw transcripts stay in ai_context; public ops jobs carry references only.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
const encoder = new TextEncoder()

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function tokenMatches(provided: string, expected: string) {
  if (!provided || !expected) return false
  const [a, b] = await Promise.all([digest(provided), digest(expected)])
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i]
  return difference === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  const expected = Deno.env.get('MCCLUSTER_CONTEXT_TOKEN') || ''
  if (!expected) return json({ error: 'context core access is not configured' }, 503)
  const provided = req.headers.get('x-mccluster-context-token') || ''
  if (!(await tokenMatches(provided, expected))) return json({ error: 'unauthorized' }, 401)

  let body: { action?: string; query?: string; limit?: number; before?: string; org_id?: string; conversation_id?: string; max_messages?: number; max_chars?: number }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const orgId = String(body.org_id || '').trim()
  const conversationId = String(body.conversation_id || '').trim()
  if (body.action === 'search') {
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: 'valid org_id required' }, 400)
    const query = String(body.query || '').trim().slice(0, 500)
    if (!query) return json({ error: 'query required' }, 400)
    const limit = Math.min(12, Math.max(1, Math.trunc(Number(body.limit) || 8)))
    const before = body.before ? new Date(body.before) : new Date()
    if (!Number.isFinite(before.getTime())) return json({ error: 'invalid before timestamp' }, 400)
    try {
      // This privileged reader is an adapter to the existing private corpus.
      // It grants no new browser access and returns provenance with each excerpt.
      const house = await sql`select id from public.orgs where id = ${orgId}::uuid and slug = 'mccluster' and enabled = true`
      if (!house.length) return json({ error: 'organization is outside Core authority' }, 403)
      const [memories, messages, residentMessages] = await Promise.all([
        sql`select id, memory_type, subject, left(content, 1800) as content, confidence, status, sensitivity, last_confirmed_at, updated_at
            from ai_context.memory_items where org_id = ${orgId}::uuid and status = 'active'
            and fts @@ websearch_to_tsquery('english', ${query})
            order by ts_rank_cd(fts, websearch_to_tsquery('english', ${query})) desc, updated_at desc limit ${limit}`,
        sql`select m.id, m.conversation_id, m.role, left(m.content, 1800) as content, coalesce(m.occurred_at, m.created_at) as occurred_at, c.title, s.provider
            from ai_context.messages m join ai_context.conversations c on c.id = m.conversation_id and c.org_id = m.org_id
            join ai_context.sources s on s.id = c.source_id
            where m.org_id = ${orgId}::uuid and coalesce(m.occurred_at, m.created_at) <= ${before.toISOString()}::timestamptz
            and m.fts @@ websearch_to_tsquery('english', ${query})
            order by ts_rank_cd(m.fts, websearch_to_tsquery('english', ${query})) desc, m.created_at desc limit ${limit}`,
        sql`select id, thread_id, role, left(content, 1800) as content, created_at
            from public.ops_ai_messages where org_id = ${orgId}::uuid and created_at <= ${before.toISOString()}::timestamptz
            and to_tsvector('english', content) @@ websearch_to_tsquery('english', ${query})
            order by ts_rank_cd(to_tsvector('english', content), websearch_to_tsquery('english', ${query})) desc, created_at desc limit ${limit}`,
      ])
      return json({ query, memories, messages, resident_messages: residentMessages, observed_at: new Date().toISOString() })
    } catch (error) {
      console.error(error)
      return json({ error: 'private context search failed' }, 500)
    }
  }
  if (!orgId || !conversationId) return json({ error: 'org_id and conversation_id are required' }, 400)

  const maxMessages = Math.min(Math.max(Number(body.max_messages) || 40, 1), 80)
  const maxChars = Math.min(Math.max(Number(body.max_chars) || 96_000, 1_000), 160_000)

  try {
    const conversations = await sql`
      select c.id, c.title, c.source_url, c.model_family, c.started_at, c.last_message_at,
             s.provider, s.account_label
      from ai_context.conversations c
      join ai_context.sources s on s.id = c.source_id
      where c.org_id = ${orgId}::uuid and c.id = ${conversationId}::uuid
      limit 1
    `
    if (!conversations.length) return json({ error: 'conversation not found' }, 404)

    const rows = await sql`
      select id, role, model, content, occurred_at, created_at
      from ai_context.messages
      where org_id = ${orgId}::uuid and conversation_id = ${conversationId}::uuid
      order by coalesce(occurred_at, created_at) desc, created_at desc
      limit ${maxMessages}
    `

    const messages: Array<Record<string, unknown>> = []
    let remaining = maxChars
    for (const row of [...rows].reverse()) {
      if (remaining <= 0) break
      const raw = String(row.content || '')
      if (!raw.trim()) continue
      const content = raw.slice(0, Math.min(24_000, remaining))
      remaining -= content.length
      messages.push({
        id: row.id,
        role: row.role,
        model: row.model,
        content,
        occurred_at: row.occurred_at ?? row.created_at,
      })
    }

    return json({
      conversation: conversations[0],
      messages,
      limits: { max_messages: maxMessages, max_chars: maxChars, returned_chars: maxChars - remaining },
    })
  } catch (error) {
    console.error(error)
    return json({ error: 'context core read failed', detail: error instanceof Error ? error.message : String(error) }, 500)
  }
})
