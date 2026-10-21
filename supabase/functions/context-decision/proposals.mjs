// Idempotent proposal persistence on the existing private decision table.
// The caller must authenticate and verify owner/admin membership first.
export async function persistProposal(sql, orgId, userId, body) {
  const key = body.idempotency_key == null ? null : String(body.idempotency_key).trim();
  if (key !== null && !/^[A-Za-z0-9._:-]{1,200}$/.test(key)) {
    throw Object.assign(new Error('invalid idempotency_key'), { status: 400 });
  }
  const intel = body.metadata?.source === 'mccluster-intel' || Boolean(body.metadata?.intel_briefing_id);
  if (intel && (!key || body.status !== 'proposed')) {
    throw Object.assign(new Error('Intel decisions require an idempotency key and proposed status'), { status: 400 });
  }
  const metadata = { ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}), ingress: 'context-decision' };
  // Authority and receipt state are server-owned, never accepted from input.
  for (const name of ['idempotency_key', 'proposal_input', 'intel_approved_basis', 'intel_receipt']) delete metadata[name];
  const input = {
    title: String(body.title).trim(), decision: String(body.decision ?? body.rationale).trim(),
    rationale_summary: body.rationale_summary ?? body.rationale ?? null,
    risk_class: body.risk_class || 'low', status: body.status || 'proposed',
    source_conversation_id: body.source_conversation_id ?? null,
    source_message_ids: Array.isArray(body.source_message_ids) ? body.source_message_ids : [],
    supersedes_id: body.supersedes_id ?? null, metadata
  };
  return sql.begin(async (tx) => {
    if (key) {
      // Serialize only retries by this actor within this organization. This
      // transaction is local; it does not claim atomicity with the basis RPC.
      await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([orgId, userId, key])}, 0))`;
      const [existing] = await tx`
        select *, metadata->'proposal_input' = ${tx.json(input)}::jsonb as same_input
        from ai_context.decisions
        where org_id = ${orgId}::uuid and proposed_by = ${userId}
          and metadata->>'idempotency_key' = ${key}
        limit 1
      `;
      if (existing) {
        if (!existing.same_input) throw Object.assign(new Error('idempotency key reused for a different proposal'), { status: 409 });
        delete existing.same_input;
        return { decision: existing, created: false };
      }
    }
    // Keep a normalized immutable input so reusing a key cannot silently
    // change the decision, actor, briefing or approval on retry.
    const storedMetadata = { ...metadata, ...(key ? { idempotency_key: key, proposal_input: input } : {}),
      ...(intel ? { intel_receipt: { state: 'pending', actor_user_id: userId } } : {}) };
    const [row] = await tx`
      insert into ai_context.decisions (
        org_id, title, decision, rationale_summary, risk_class, status,
        proposed_by, source_conversation_id, source_message_ids, supersedes_id, metadata
      ) values (
        ${orgId}::uuid, ${input.title}, ${input.decision}, ${input.rationale_summary},
        ${input.risk_class}, ${input.status}, ${userId},
        ${input.source_conversation_id}::uuid, ${input.source_message_ids}::uuid[],
        ${input.supersedes_id}::uuid, ${tx.json(storedMetadata)}
      )
      returning id, org_id, title, decision, rationale_summary, risk_class, status,
                proposed_by, metadata, created_at
    `;
    return { decision: row, created: true };
  });
}
