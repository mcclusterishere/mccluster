// CONTEXT-INGEST — write a conversation into the private context plane.
// Lands provider messages in ai_context idempotently and queues enrichment.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'
import { authzResponse, verifyCaller } from '../_shared/authz.ts'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })

type Message = {
  id?: string
  role: string
  model?: string
  content: string
  occurred_at?: string
  ordinal?: number
  metadata?: Record<string, unknown>
}

type Payload = {
  org_id: string
  provider: string
  account_label?: string
  adapter_version?: string
  external_conversation_id: string
  title?: string
  source_url?: string
  model_family?: string
  started_at?: string
  last_message_at?: string
  metadata?: Record<string, unknown>
  idempotency_key: string
  messages: Message[]
}

const encoder = new TextEncoder()
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

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

  let body: Payload
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  if (!body.org_id || !body.provider || !body.external_conversation_id || !body.idempotency_key || !Array.isArray(body.messages)) {
    return json({ error: 'org_id, provider, external_conversation_id, idempotency_key, and messages are required' }, 400)
  }
  if (body.messages.length > 5000) return json({ error: 'message batch too large' }, 413)
  for (const message of body.messages) {
    if (!message?.role || typeof message.content !== 'string') return json({ error: 'every message requires role and content' }, 400)
  }

  try {
    const member = await sql`
      select 1 from public.org_members
      where org_id = ${body.org_id}::uuid and profile_id = ${subject}::uuid
      limit 1
    `
    if (!member.length) return json({ error: 'not authorized for requested organization' }, 403)
  } catch {
    return json({ error: 'organization authorization failed' }, 403)
  }

  const payloadHash = await sha256(JSON.stringify(body))
  try {
    const result = await sql.begin(async (tx) => {
      const prior = await tx`
        select id, conversation_id, message_count, payload_hash
        from ai_context.ingestion_receipts
        where org_id = ${body.org_id}::uuid
          and provider = ${body.provider}
          and idempotency_key = ${body.idempotency_key}
        limit 1
      `
      if (prior.length) return { duplicate: true, receipt: prior[0] }

      const accountLabel = body.account_label?.trim() || 'default'
      const [source] = await tx`
        insert into ai_context.sources (org_id, provider, account_label, adapter_version, metadata)
        values (${body.org_id}::uuid, ${body.provider}, ${accountLabel}, ${body.adapter_version ?? null}, ${tx.json(body.metadata ?? {})})
        on conflict (org_id, provider, account_label)
        do update set adapter_version = coalesce(excluded.adapter_version, ai_context.sources.adapter_version), metadata = ai_context.sources.metadata || excluded.metadata, updated_at = now()
        returning id
      `

      const conversationHash = await sha256(body.messages.map((m) => `${m.role}\n${m.content}`).join('\n---\n'))
      const [conversation] = await tx`
        insert into ai_context.conversations (
          org_id, source_id, external_conversation_id, title, source_url, model_family,
          started_at, last_message_at, metadata, content_hash
        ) values (
          ${body.org_id}::uuid, ${source.id}::uuid, ${body.external_conversation_id},
          ${body.title ?? null}, ${body.source_url ?? null}, ${body.model_family ?? null},
          ${body.started_at ?? null}::timestamptz, ${body.last_message_at ?? null}::timestamptz,
          ${tx.json(body.metadata ?? {})}, ${conversationHash}
        )
        on conflict (source_id, external_conversation_id)
        do update set
          title = coalesce(excluded.title, ai_context.conversations.title),
          source_url = coalesce(excluded.source_url, ai_context.conversations.source_url),
          model_family = coalesce(excluded.model_family, ai_context.conversations.model_family),
          started_at = coalesce(ai_context.conversations.started_at, excluded.started_at),
          last_message_at = greatest(ai_context.conversations.last_message_at, excluded.last_message_at),
          metadata = ai_context.conversations.metadata || excluded.metadata,
          content_hash = excluded.content_hash,
          ingested_at = now(), updated_at = now()
        returning id
      `

      let inserted = 0
      for (let i = 0; i < body.messages.length; i += 1) {
        const message = body.messages[i]
        const contentHash = await sha256(`${message.role}\n${message.content}`)
        const rows = await tx`
          insert into ai_context.messages (
            org_id, conversation_id, external_message_id, ordinal, role, model,
            content, content_hash, occurred_at, metadata
          ) values (
            ${body.org_id}::uuid, ${conversation.id}::uuid, ${message.id ?? null},
            ${message.ordinal ?? i}, ${message.role}, ${message.model ?? null},
            ${message.content}, ${contentHash}, ${message.occurred_at ?? null}::timestamptz,
            ${tx.json(message.metadata ?? {})}
          )
          on conflict (conversation_id, content_hash, role) do nothing
          returning id
        `
        inserted += rows.length
      }

      const [receipt] = await tx`
        insert into ai_context.ingestion_receipts (
          org_id, provider, idempotency_key, payload_hash, conversation_id, message_count, status, detail
        ) values (
          ${body.org_id}::uuid, ${body.provider}, ${body.idempotency_key}, ${payloadHash},
          ${conversation.id}::uuid, ${body.messages.length}, 'accepted',
          ${tx.json({ inserted_messages: inserted, ingested_by: subject })}
        ) returning id, conversation_id, message_count, payload_hash
      `

      await tx`select pgmq.send('ai-context-enrich', ${tx.json({ org_id: body.org_id, conversation_id: conversation.id, reason: 'ingest' })})`
      return { duplicate: false, receipt, inserted_messages: inserted }
    })

    return json(result, result.duplicate ? 200 : 201)
  } catch (error) {
    console.error(error)
    return json({ error: 'ingestion failed', detail: error instanceof Error ? error.message : String(error) }, 500)
  }
})
