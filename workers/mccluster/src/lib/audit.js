/* THE LEDGER — who changed what, on whose behalf, and when.

   public.control_audit has existed since 0047 and, until now, nothing
   ever wrote to it. An empty audit table is worse than no audit table:
   it reads as "nothing privileged has happened here" when what it
   actually means is "nobody was recording". Every privileged mutation
   the Worker performs goes through here.

   A SECOND LEDGER WAS NOT CREATED FOR THIS. The shape 0047 already
   defines — org, actor, event, capability, resource, detail — is the
   shape these writes need, and a parallel ops_audit_events table would
   mean two places to look when answering one question.

   WHAT HAPPENS WHEN THE LEDGER ITSELF IS DOWN. Two bad options: fail the
   operation somebody asked for because the record of it could not be
   written, or complete it silently and lose the record. This takes
   neither. The write is attempted, the operation completes either way,
   and the outcome is REPORTED BACK on the response as audit.recorded.
   A caller that gets recorded:false knows the ledger has a hole in it at
   a known moment, and Control Room diagnostics can surface that rather
   than everyone discovering it during an incident.

   This is a deliberate trade and it is the reason recordAudit never
   throws. If a future action is severe enough that it must not proceed
   unrecorded, that action should write the row first and refuse on
   failure — not change this helper's contract underneath everything
   already relying on it. */

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    prefer: 'return=representation'
  };
}

function trim(value, max = 200) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

/* Detail is whatever the caller thought was worth keeping, but a ledger
   row is evidence, not storage. Anything large is kept by shape. */
function boundDetail(detail, max = 8000) {
  if (detail === null || detail === undefined) return {};
  let json;
  try { json = JSON.stringify(detail); } catch { return { unserializable: true }; }
  if (json === undefined) return {};
  if (json.length <= max) return detail;
  return { truncated: true, bytes: json.length, preview: json.slice(0, max) };
}

export async function recordAudit(env, entry = {}) {
  const event = trim(entry.event, 120);
  if (!event) return { recorded: false, reason: 'event_required' };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    return { recorded: false, reason: 'supabase_not_configured' };
  }

  const row = {
    org_id: trim(entry.orgId, 64),
    actor_user_id: trim(entry.actorUserId, 64),
    actor_kind: trim(entry.actorKind, 32) || 'user',
    event,
    capability: trim(entry.capability, 64),
    resource_type: trim(entry.resourceType, 64),
    resource_id: trim(entry.resourceId, 200),
    detail: boundDetail(entry.detail)
  };

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_audit`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { recorded: false, reason: 'ledger_rejected', status: res.status, detail: text.slice(0, 500) };
    }
    const body = await res.json().catch(() => null);
    const written = Array.isArray(body) ? body[0] : body;
    return { recorded: true, id: written?.id ?? null, at: written?.at ?? null };
  } catch (error) {
    return {
      recorded: false,
      reason: 'ledger_unreachable',
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/* The ledger read behind Control Room diagnostics: most recent first,
   scoped to one org so a tenant never sees another tenant's history. */
export async function recentAudit(env, orgId, limit = 20) {
  const org = trim(orgId, 64);
  if (!org) throw Object.assign(new Error('org_id is required'), { status: 400 });
  const capped = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 20));

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/control_audit` +
      `?org_id=eq.${encodeURIComponent(org)}` +
      '&select=id,event,capability,actor_user_id,actor_kind,resource_type,resource_id,detail,at' +
      `&order=at.desc&limit=${capped}`,
    { headers: headers(env) }
  );
  if (!res.ok) {
    throw Object.assign(new Error('Audit read failed'), { status: res.status });
  }
  return res.json();
}
