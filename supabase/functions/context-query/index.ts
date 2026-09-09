// CONTEXT-QUERY — search the private cross-model context plane.
//
// `ai_context` holds transcripts and memory items pulled in from Claude,
// ChatGPT, Grok and the rest (CLAUDE.md rule 6: these never go into
// public Git). Everything this function returns is private by default,
// so who is asking has to be established before anything is read.
//
// IDENTITY — CHANGED 2026-09-07
// ----------------------------
// This function used to derive the caller from a local helper that
// base64-decoded the JWT payload and trusted `sub`. A payload is not a
// signature. It was not exploitable as deployed — the gateway's
// verify_jwt was doing the real verification, and a forged token was
// rejected before reaching this code (confirmed by direct request) —
// but the safety of the private context store rested entirely on a
// project setting this file does not control. One toggle, or one
// deploy with verify_jwt false, and `sub` becomes attacker-chosen: full
// impersonation of any org member over every stored transcript.
//
// It now asks the issuer, through the same `verifyCaller` the rest of
// the control plane uses. The org membership check below is unchanged
// and is still what bounds the read to one tenant.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'
import { authzResponse, verifyCaller } from '../_shared/authz.ts'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  let subject: string
  try {
    subject = (await verifyCaller(req)).id
  } catch (e) {
    return authzResponse(e, {}) ?? json({ error: 'authentication failed' }, 401)
  }

  let body: { org_id?: string; query?: string; limit?: number; include_messages?: boolean; include_memories?: boolean }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const orgId = body.org_id
  const query = body.query?.trim()
  const limit = Math.min(Math.max(body.limit ?? 12, 1), 50)
  if (!orgId || !query) return json({ error: 'org_id and query are required' }, 400)

  try {
    const member = await sql`
      select 1 from public.org_members
      where org_id = ${orgId}::uuid and profile_id = ${subject}::uuid
      limit 1
    `
    if (!member.length) return json({ error: 'not authorized for requested organization' }, 403)

    const includeMessages = body.include_messages !== false
    const includeMemories = body.include_memories !== false
    const [messages, memories] = await Promise.all([
      includeMessages ? sql`
        select
          m.id,
          m.conversation_id,
          m.role,
          m.model,
          m.content,
          m.occurred_at,
          c.title as conversation_title,
          s.provider,
          ts_rank_cd(m.fts, websearch_to_tsquery('english', ${query})) as rank
        from ai_context.messages m
        join ai_context.conversations c on c.id = m.conversation_id
        join ai_context.sources s on s.id = c.source_id
        where m.org_id = ${orgId}::uuid
          and m.fts @@ websearch_to_tsquery('english', ${query})
        order by rank desc, coalesce(m.occurred_at, m.created_at) desc
        limit ${limit}
      ` : Promise.resolve([]),
      includeMemories ? sql`
        select
          id,
          memory_type,
          subject,
          content,
          confidence,
          status,
          sensitivity,
          last_confirmed_at,
          ts_rank_cd(fts, websearch_to_tsquery('english', ${query})) as rank
        from ai_context.memory_items
        where org_id = ${orgId}::uuid
          and status = 'active'
          and fts @@ websearch_to_tsquery('english', ${query})
        order by rank desc, confidence desc, coalesce(last_confirmed_at, updated_at) desc
        limit ${limit}
      ` : Promise.resolve([]),
    ])

    return json({ query, messages, memories })
  } catch (error) {
    console.error(error)
    return json({ error: 'context query failed', detail: error instanceof Error ? error.message : String(error) }, 500)
  }
})
