/* Tenant-bound lead status changes, using the canonical Worker.
   Owning a workspace never implies ownership of an arbitrary lead UUID.
   Historical unassigned leads remain read-only until explicitly reconciled
   under reviewed migration/ownership authority, not silently inherited. */

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
  const before = (await db(env, `leads?id=eq.${encodeURIComponent(leadId)}&org_id=eq.${encodeURIComponent(membership.org_id)}&select=id,org_id,status,email,name`))?.[0];
  if (!before) throw Object.assign(new Error('No such lead'), { status: 404 });

  if (before.status === status) {
    return { lead: before, changed: false, audit: { recorded: false, reason: 'no_change' } };
  }

  const updated = (await db(env, `leads?id=eq.${encodeURIComponent(leadId)}&org_id=eq.${encodeURIComponent(membership.org_id)}&status=eq.${encodeURIComponent(before.status)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ status })
  }))?.[0];

  if (!updated) throw Object.assign(new Error('Lead moved or changed during update'), { status: 409 });

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

  return { lead: updated, changed: true, audit };
}
