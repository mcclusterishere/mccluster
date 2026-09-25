/* WORKING THE PIPELINE — lead status changes, through the Worker.

   admin.html used to PATCH public.leads straight from the browser with
   the publishable key, relying on an RLS policy that reads:

       using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')

   That works exactly once, for exactly one person. It is the same
   owner-by-email-string gate that sits in crm.html, and it is a hard
   blocker on the clone contract: a second tenant's owner cannot be
   granted it without editing a policy literal, and the check cannot
   express "owner of THIS workspace" at all.

   So the mutation moves here, where the caller's role is resolved from
   org membership instead of a string comparison, the transition is
   validated against the column's own vocabulary, and the change lands in
   the ledger with what it was before.

   WHAT THIS DOES NOT YET FIX, stated plainly because the next person
   will look for it: public.leads carries no org_id. It predates tenancy
   (0001 against 0026) and is still a single-tenant table. The membership
   check below therefore authorizes the CALLER — it establishes, in a way
   the server can verify, that whoever is moving this lead owns a
   workspace — but it cannot yet scope the LEAD, because there is nothing
   on the row to scope it by. Making leads genuinely multi-tenant needs a
   column, a backfill and a policy rewrite; that is a schema decision, not
   something to slip into a route. Until it happens, this surface is
   honest about being the house's pipeline. */

import { recordAudit } from './lib/audit.js';
import { requireMembership } from './workspaces.js';

/* The vocabulary is the column's own check constraint from 0001. Kept in
   step deliberately: a status this accepts and Postgres rejects would
   surface as a 500 on a valid-looking request. */
const STATUSES = ['new', 'replied', 'booked', 'closed'];

/* Moving a lead is owner work. Staff read and reply; they do not decide
   that a deal closed. */
const MAY_WORK_PIPELINE = ['owner'];

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw Object.assign(new Error('Lead request failed'), { status: res.status, detail: data });
  }
  return data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setLeadStatus(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const leadId = String(body?.lead_id || '').trim();
  const status = String(body?.status || '').trim();

  /* Shape first, so a malformed id never reaches the database as a
     PostgREST filter fragment. */
  if (!UUID.test(leadId)) {
    throw Object.assign(new Error('lead_id must be a uuid'), { status: 400 });
  }
  if (!STATUSES.includes(status)) {
    throw Object.assign(new Error('Unknown lead status'), {
      status: 400,
      detail: { allowed: STATUSES, received: status }
    });
  }

  const membership = await requireMembership(env, user, body?.org_id);
  if (!MAY_WORK_PIPELINE.includes(membership.role)) {
    throw Object.assign(new Error('Only an owner can move a lead'), {
      status: 403,
      detail: { role: membership.role, required: MAY_WORK_PIPELINE }
    });
  }

  /* Read before write: an audit row that cannot say what changed is a
     timestamp, not a record. */
  const before = (await db(env, `leads?id=eq.${encodeURIComponent(leadId)}&select=id,status,email,name`))?.[0];
  if (!before) throw Object.assign(new Error('No such lead'), { status: 404 });

  if (before.status === status) {
    return { lead: before, changed: false, audit: { recorded: false, reason: 'no_change' } };
  }

  const updated = (await db(env, `leads?id=eq.${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ status })
  }))?.[0];

  const audit = await recordAudit(env, {
    orgId: membership.org_id,
    actorUserId: user?.id,
    actorKind: 'user',
    event: 'lead.status_changed',
    capability: 'crm.write',
    resourceType: 'lead',
    resourceId: leadId,
    detail: { from: before.status, to: status, lead_email: before.email }
  });

  return { lead: updated || { ...before, status }, changed: true, audit };
}
