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

  let body: { org_id?: string; conversation_id?: string; max_messages?: number; max_chars?: number }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const orgId = String(body.org_id || '').trim()
  const conversationId = String(body.conversation_id || '').trim()
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
