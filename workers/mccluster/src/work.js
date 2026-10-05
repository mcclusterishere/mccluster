/* CONTROL · WORK — the canonical write routes behind the operator console.

   Before this module Control could not create anything: tasks were derived
   from open leads, orders and bookings were lead lanes, companies were a
   free-text guess, and "+ New" pointed at the legacy CRM. This is the one
   place those records are written (docs/control-plane/CONTROL-ROOM-BACKEND-GAPS.md
   items 1, 2, 3 and 6), against the tables in
   supabase/migrations/20261005044012_control_work_records_v1.sql.
   Companies are the existing public.out_companies. The Work migration is
   applied in production; a missing table now means deployment/schema drift.

   Rules every route here keeps:
   - The caller's role comes from org membership (requireMembership), never
     from an email literal; every record carries that org_id and every read
     and update is filtered by it.
   - Each kind declares its own fields. Anything not declared is ignored, so
     a request cannot set org_id, created_by or timestamps.
   - Every write lands in control_audit with what it was before.
   - If the applied schema is missing, the routes answer 503 work_not_provisioned
     so Control reports deployment drift instead of failing vaguely.

   Routes:
     GET   /v1/work/{kind}?org_id&state&limit          list
     POST  /v1/work/{kind}        { org_id, ...fields } create
     PATCH /v1/work/{kind}/{id}   { org_id, ...fields } update
     POST  /v1/work/leads         { org_id, name, email, want, note, campaign, company_id }
     PATCH /v1/work/leads/{id}    { org_id, company_id } link a lead to a company
     GET   /v1/work/contacts?org_id                   people at companies (out_contacts), read only
     GET   /v1/work/history?org_id&company_id|relationship_id|lead_id|project_id
                                                      one client's linked records and audit trail
   where kind is companies | tasks | orders | bookings | relationships |
   projects | deliverables | renewals | payments. The post-sale kinds come from
   supabase/migrations/20261005075808_control_post_sale_work_v1.sql (+ rls, grants, indexes). */

import { recordAudit } from './lib/audit.js';
import { requireMembership } from './workspaces.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OWNER = ['owner'];
const OPERATORS = ['owner', 'staff'];

const text = (max) => (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s.length > max) throw bad(`must be at most ${max} characters`);
  return s || null;
};
const required = (inner, name = 'value') => (v) => {
  const out = inner(v);
  if (out === null || out === undefined) throw bad(`${name} is required`);
  return out;
};
const oneOf = (values) => (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (!values.includes(v)) throw bad(`must be one of ${values.join(', ')}`);
  return v;
};
const uuid = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (!UUID.test(String(v))) throw bad('must be a uuid');
  return String(v);
};
const when = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw bad('must be a date');
  return new Date(t).toISOString();
};
const cents = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw bad('must be a whole number of cents, 0 or more');
  return n;
};
const domain = (v) => {
  const s = text(253)(v);
  if (s === null) return null;
  const d = s.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw bad('must be a domain like example.com');
  return d;
};
const currency = (v) => {
  const s = text(3)(v);
  if (s === null) return null;
  if (!/^[a-z]{3}$/i.test(s)) throw bad('must be a three-letter currency code');
  return s.toLowerCase();
};
const httpsUrl = (v) => {
  const s = text(2000)(v);
  if (s === null) return null;
  let u;
  try { u = new URL(s); } catch { throw bad('must be a URL'); }
  if (u.protocol !== 'https:') throw bad('must be an https URL');
  return u.toString();
};
const items = (v) => {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length > 100) throw bad('must be a list of at most 100 items');
  return v;
};

/* On create, an empty field is left out rather than sent as null, so the
   column's own default applies (out_companies.kind, leads.want and note)
   and a column a pending migration adds is not named until it is used. */
function withoutNulls(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const WORK_MIGRATION = 'supabase/migrations/20261005044012_control_work_records_v1.sql';
const POST_SALE_MIGRATION = 'supabase/migrations/20261005075808_control_post_sale_work_v1.sql';

/* What each kind is, who may write it, and which fields a request may set.
   `create` lists the fields required on create; `states` drives the state
   field and the done-at bookkeeping for tasks. */
export const KINDS = {
  /* Companies are public.out_companies — the one company table the intake
     and outreach functions already write. Its own vocabulary is kept: kind,
     status and source are its check constraints, and it has no created_by
     column, so a hand-made company is stamped source 'manual' instead. */
  companies: {
    table: 'out_companies',
    resource: 'company',
    writers: OWNER,
    fields: {
      name: text(200),
      domain,
      kind: oneOf(['nonprofit', 'brand', 'agency', 'government', 'media', 'other']),
      status: oneOf(['new', 'contacted', 'replied', 'partner', 'declined']),
      city: text(120),
      region: text(120),
      notes: text(4000)
    },
    create: ['name'],
    stamp: () => ({ source: 'manual' }),
    order: 'name.asc'
  },
  tasks: {
    table: 'work_tasks',
    resource: 'task',
    writers: OPERATORS,
    fields: {
      title: text(300),
      detail: text(4000),
      state: oneOf(['open', 'doing', 'done']),
      assignee: uuid,
      due_at: when,
      related_type: oneOf(['lead', 'company', 'order', 'booking', 'relationship', 'project', 'deliverable', 'renewal', 'payment']),
      related_id: uuid
    },
    create: ['title'],
    order: 'due_at.asc.nullslast,created_at.desc'
  },
  orders: {
    table: 'work_orders',
    resource: 'order',
    writers: OWNER,
    fields: {
      title: text(300),
      state: oneOf(['open', 'paid', 'in_production', 'fulfilled', 'cancelled']),
      lead_id: uuid,
      company_id: uuid,
      amount_cents: cents,
      currency,
      items,
      placed_at: when
    },
    create: ['title'],
    order: 'placed_at.desc'
  },
  bookings: {
    table: 'work_bookings',
    resource: 'booking',
    writers: OWNER,
    fields: {
      title: text(300),
      state: oneOf(['proposed', 'confirmed', 'completed', 'cancelled']),
      lead_id: uuid,
      company_id: uuid,
      starts_at: when,
      ends_at: when,
      location: text(300),
      note: text(4000)
    },
    create: ['title'],
    order: 'starts_at.asc.nullslast,created_at.desc'
  },
  /* The post-sale graph. Each links back to the canonical company, person
     (lead or out_contacts row) and order rather than copying them. */
  relationships: {
    table: 'work_relationships',
    resource: 'relationship',
    writers: OWNER,
    migration: POST_SALE_MIGRATION,
    fields: {
      title: text(300),
      relationship_type: oneOf(['client', 'prospect', 'partner', 'sponsor', 'vendor', 'collaborator', 'other']),
      state: oneOf(['active', 'paused', 'ended']),
      company_id: uuid,
      contact_id: uuid,
      lead_id: uuid,
      owner_id: uuid,
      started_at: when,
      ended_at: when,
      notes: text(4000)
    },
    create: ['title'],
    prepare(fields, before) {
      const party = ['company_id', 'contact_id', 'lead_id'].some((k) => (k in fields ? fields[k] : before?.[k]));
      if (!party) throw bad('a relationship needs a company, contact or lead');
    },
    order: 'created_at.desc'
  },
  projects: {
    table: 'work_projects',
    resource: 'project',
    writers: OWNER,
    migration: POST_SALE_MIGRATION,
    fields: {
      title: text(300),
      state: oneOf(['planned', 'active', 'on_hold', 'delivered', 'closed', 'cancelled']),
      summary: text(4000),
      company_id: uuid,
      relationship_id: uuid,
      lead_id: uuid,
      order_id: uuid,
      owner_id: uuid,
      starts_at: when,
      due_at: when,
      budget_cents: cents,
      currency
    },
    create: ['title'],
    order: 'due_at.asc.nullslast,created_at.desc'
  },
  deliverables: {
    table: 'work_deliverables',
    resource: 'deliverable',
    writers: OWNER,
    migration: POST_SALE_MIGRATION,
    fields: {
      project_id: uuid,
      title: text(300),
      kind: oneOf(['file', 'site', 'media', 'report', 'campaign', 'other']),
      state: oneOf(['planned', 'in_progress', 'delivered', 'accepted', 'rejected']),
      approval_state: oneOf(['not_requested', 'pending', 'approved', 'changes_requested']),
      artifact_url: httpsUrl,
      media_asset_id: uuid,
      due_at: when,
      note: text(4000)
    },
    create: ['project_id', 'title'],
    /* Approval is stamped with who and when; it is never a free field. */
    prepare(fields, before, user) {
      if ('approval_state' in fields) {
        if (fields.approval_state === null) throw bad('approval_state cannot be empty');
        const approved = fields.approval_state === 'approved';
        fields.approved_at = approved ? (before?.approved_at || new Date().toISOString()) : null;
        fields.approved_by = approved ? (before?.approved_by || user?.id || null) : null;
      }
      if (['delivered', 'accepted'].includes(fields.state) && !before?.delivered_at) fields.delivered_at = new Date().toISOString();
    },
    order: 'due_at.asc.nullslast,created_at.desc'
  },
  renewals: {
    table: 'work_renewals',
    resource: 'renewal',
    writers: OWNER,
    migration: POST_SALE_MIGRATION,
    fields: {
      title: text(300),
      state: oneOf(['upcoming', 'renewed', 'lapsed', 'cancelled']),
      cadence: oneOf(['monthly', 'quarterly', 'annual', 'one_time', 'custom']),
      company_id: uuid,
      relationship_id: uuid,
      project_id: uuid,
      order_id: uuid,
      amount_cents: cents,
      currency,
      renews_at: when,
      last_renewed_at: when,
      source_table: oneOf(['site_accounts', 'api_subscriptions', 'offerings']),
      source_id: text(200),
      note: text(4000)
    },
    create: ['title'],
    prepare(fields, before) {
      const table = 'source_table' in fields ? fields.source_table : before?.source_table;
      const id = 'source_id' in fields ? fields.source_id : before?.source_id;
      if ((table == null) !== (id == null)) throw bad('source_table and source_id go together');
      if (fields.state === 'renewed' && !('last_renewed_at' in fields)) fields.last_renewed_at = new Date().toISOString();
    },
    order: 'renews_at.asc.nullslast,created_at.desc'
  },
  /* McCluster's service-payment ledger. The owner records what was billed
     and received; `verification` is not a request field, so a browser can
     never claim a provider confirmed a payment. */
  payments: {
    table: 'work_payments',
    resource: 'payment',
    writers: OWNER,
    readers: OWNER,
    migration: POST_SALE_MIGRATION,
    fields: {
      title: text(300),
      state: oneOf(['due', 'pending', 'paid', 'failed', 'refunded', 'cancelled']),
      amount_cents: cents,
      currency,
      provider: oneOf(['stripe', 'square', 'manual', 'other']),
      provider_reference: text(200),
      company_id: uuid,
      lead_id: uuid,
      order_id: uuid,
      project_id: uuid,
      renewal_id: uuid,
      due_at: when,
      paid_at: when,
      note: text(4000)
    },
    create: ['title', 'amount_cents'],
    prepare(fields, before) {
      if (fields.state === 'paid' && !fields.paid_at && !before?.paid_at) fields.paid_at = new Date().toISOString();
    },
    order: 'due_at.asc.nullslast,created_at.desc'
  }
};

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

/* A missing table is the migration not yet applied, not a server bug. */
function notProvisioned(status, data) {
  const code = data && typeof data === 'object' ? data.code : '';
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703';
}

async function db(env, path, options = {}, migration = WORK_MIGRATION) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const body = await res.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!res.ok) {
    if (notProvisioned(res.status, data)) {
      throw Object.assign(new Error('Work records are not set up yet'), {
        status: 503,
        detail: { code: 'work_not_provisioned', migration }
      });
    }
    /* A check or foreign-key violation is the caller's input, not a 500. */
    if (data && (data.code === '23514' || data.code === '23503' || data.code === '23505')) {
      throw Object.assign(new Error(data.code === '23505' ? 'That already exists' : 'That record was refused'), {
        status: data.code === '23505' ? 409 : 400,
        detail: { code: data.code, message: data.message }
      });
    }
    throw Object.assign(new Error('Work request failed'), { status: res.status >= 500 ? 502 : res.status, detail: data });
  }
  return data;
}

function pick(kind, body, { creating }) {
  const out = {};
  for (const [name, parse] of Object.entries(kind.fields)) {
    if (!Object.prototype.hasOwnProperty.call(body, name)) continue;
    try {
      out[name] = parse(body[name]);
    } catch (error) {
      throw Object.assign(new Error(`${name} ${error.message}`), { status: 400 });
    }
  }
  if (creating) {
    for (const name of kind.create) {
      if (out[name] === null || out[name] === undefined) throw bad(`${name} is required`);
    }
  } else if (!Object.keys(out).length) {
    throw bad('Nothing to change');
  }
  return out;
}

async function gate(env, user, orgId, writers, verb = 'change') {
  const membership = await requireMembership(env, user, orgId);
  if (writers && !writers.includes(membership.role)) {
    throw Object.assign(new Error(`Your role cannot ${verb} this`), {
      status: 403,
      detail: { role: membership.role, required: writers }
    });
  }
  return membership;
}

/* Linked ids must belong to the same org; a foreign key alone would accept
   another tenant's company. */
/* Leads with no org_id predate tenancy and are McCluster's own house
   pipeline (src/leads.js), not unowned rows. Only the house workspace may
   touch them; any other tenant gets the same answer as a foreign row. */
const HOUSE = { slug: 'mccluster', kind: 'studio' };
const isHouse = (membership) => membership?.slug === HOUSE.slug && membership?.kind === HOUSE.kind;
const leadVisible = (row, membership) => Boolean(row) && (row.org_id === membership.org_id || (row.org_id === null && isHouse(membership)));

async function assertSameOrg(env, membership, fields) {
  const orgId = membership.org_id;
  const links = [
    ['company_id', 'out_companies'],
    ['lead_id', 'leads'],
    ['contact_id', 'out_contacts'],
    ['relationship_id', 'work_relationships'],
    ['project_id', 'work_projects'],
    ['order_id', 'work_orders'],
    ['renewal_id', 'work_renewals']
  ];
  if (fields.related_type && fields.related_id) {
    const table = {
      lead: 'leads', company: 'out_companies', order: 'work_orders', booking: 'work_bookings',
      relationship: 'work_relationships', project: 'work_projects', deliverable: 'work_deliverables',
      renewal: 'work_renewals', payment: 'work_payments'
    }[fields.related_type];
    links.push(['related_id', table]);
  }
  for (const [field, table] of links) {
    const id = fields[field];
    if (!id) continue;
    const row = (await db(env, `${table}?id=eq.${id}&select=id,org_id`))?.[0];
    const ok = table === 'leads' ? leadVisible(row, membership) : Boolean(row) && row.org_id === orgId;
    if (!ok) {
      throw Object.assign(new Error(`${field} does not belong to this organization`), { status: 400 });
    }
  }

  for (const field of ['assignee', 'owner_id']) {
    if (!fields[field]) continue;
    const member = (await db(
      env,
      `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(fields[field])}&select=profile_id`
    ))?.[0];
    if (!member) {
      throw Object.assign(new Error(`${field} does not belong to this organization`), { status: 400 });
    }
  }
}

function audit(env, membership, user, event, resourceType, resourceId, detail) {
  return recordAudit(env, {
    orgId: membership.org_id,
    actorUserId: user?.id,
    actorKind: 'user',
    event,
    capability: 'crm.write',
    resourceType,
    resourceId,
    detail
  });
}

export async function listWork(env, user, kindName, params) {
  const kind = KINDS[kindName];
  const membership = await gate(env, user, params.get('org_id'), kind.readers, 'see');
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 500);
  const state = params.get('state');
  if (state && kind.fields.state) kind.fields.state(state);
  const filter = state ? `&state=eq.${encodeURIComponent(state)}` : '';
  const rows = await db(env, `${kind.table}?org_id=eq.${membership.org_id}${filter}&select=*&order=${kind.order}&limit=${limit}`, {}, kind.migration);
  return { [kindName]: rows || [], org_id: membership.org_id };
}

export async function createWork(request, env, user, kindName) {
  const kind = KINDS[kindName];
  const body = await request.json().catch(() => ({}));
  const membership = await gate(env, user, body?.org_id, kind.writers);
  const fields = pick(kind, body || {}, { creating: true });
  if (kindName === 'tasks') {
    if ((fields.related_type == null) !== (fields.related_id == null)) throw bad('related_type and related_id go together');
    if (fields.state === 'done') fields.completed_at = new Date().toISOString();
  }
  if (kind.prepare) kind.prepare(fields, null, user);
  await assertSameOrg(env, membership, fields);
  const row = (await db(env, kind.table, {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...withoutNulls(fields), org_id: membership.org_id, ...(kind.stamp ? kind.stamp(user) : { created_by: user?.id || null }) })
  }, kind.migration))?.[0];
  const ledger = await audit(env, membership, user, `${kind.resource}.created`, kind.resource, row?.id, { fields });
  return { [kind.resource]: row, audit: ledger };
}

export async function updateWork(request, env, user, kindName, id) {
  const kind = KINDS[kindName];
  if (!UUID.test(id)) throw bad('id must be a uuid');
  const body = await request.json().catch(() => ({}));
  const membership = await gate(env, user, body?.org_id, kind.writers);
  const fields = pick(kind, body || {}, { creating: false });

  const before = (await db(env, `${kind.table}?id=eq.${id}&org_id=eq.${membership.org_id}&select=*`, {}, kind.migration))?.[0];
  if (!before) throw Object.assign(new Error(`No such ${kind.resource}`), { status: 404 });

  if (kindName === 'tasks') {
    const relatedType = 'related_type' in fields ? fields.related_type : before.related_type;
    const relatedId = 'related_id' in fields ? fields.related_id : before.related_id;
    if ((relatedType == null) !== (relatedId == null)) throw bad('related_type and related_id go together');
    if ('state' in fields) {
      if (fields.state === null) throw bad('state cannot be empty');
      fields.completed_at = fields.state === 'done' ? (before.completed_at || new Date().toISOString()) : null;
    }
    if (relatedType && relatedId) Object.assign(fields, { related_type: relatedType, related_id: relatedId });
  }
  for (const name of kind.create) {
    if (name in fields && fields[name] === null) throw bad(`${name} cannot be empty`);
  }
  if (kind.prepare) kind.prepare(fields, before, user);
  await assertSameOrg(env, membership, fields);

  const changed = Object.keys(fields).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(fields[k]));
  if (!changed.length) return { [kind.resource]: before, changed: false, audit: { recorded: false, reason: 'no_change' } };

  const row = (await db(env, `${kind.table}?id=eq.${id}&org_id=eq.${membership.org_id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(fields)
  }, kind.migration))?.[0];
  const from = Object.fromEntries(changed.map((k) => [k, before[k]]));
  const to = Object.fromEntries(changed.map((k) => [k, fields[k]]));
  const ledger = await audit(env, membership, user, `${kind.resource}.updated`, kind.resource, id, { from, to });
  return { [kind.resource]: row || { ...before, ...fields }, changed: true, audit: ledger };
}

/* A lead created by hand from Control. It carries the same provenance
   columns the capture forms write, with source "control" so attribution
   never mistakes it for an inbound conversion. */
export async function createLead(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const membership = await gate(env, user, body?.org_id, OWNER);
  const name = required(text(200), 'name')(body?.name);
  /* leads.email is NOT NULL with no default, and every lead surface keys on
     it, so a hand-made lead needs one the same way a capture form does. */
  const email = required(text(320), 'email')(body?.email);
  if (!EMAIL.test(email)) throw bad('email must be an email address');
  const fields = {
    name,
    email: email.toLowerCase(),
    want: text(200)(body?.want),
    note: text(4000)(body?.note),
    campaign: text(120)(body?.campaign),
    company_id: uuid(body?.company_id)
  };
  await assertSameOrg(env, membership, fields);
  const row = (await db(env, 'leads', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      ...withoutNulls(fields),
      org_id: membership.org_id,
      status: 'new',
      source: 'control',
      medium: 'manual',
      page: 'control.html'
    })
  }))?.[0];
  const ledger = await audit(env, membership, user, 'lead.created', 'lead', row?.id, {
    source: 'control', want: fields.want, campaign: fields.campaign, company_id: fields.company_id
  });
  return { lead: row, audit: ledger };
}

export async function linkLeadCompany(request, env, user, leadId) {
  if (!UUID.test(leadId)) throw bad('id must be a uuid');
  const body = await request.json().catch(() => ({}));
  const membership = await gate(env, user, body?.org_id, OWNER);
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'company_id')) throw bad('company_id is required (null to unlink)');
  const companyId = uuid(body.company_id);
  const before = (await db(env, `leads?id=eq.${leadId}&select=id,org_id,company_id,email`))?.[0];
  const legacyHouseLead = Boolean(before) && before.org_id === null && isHouse(membership);
  if (!leadVisible(before, membership)) {
    throw Object.assign(new Error('No such lead'), { status: 404 });
  }
  await assertSameOrg(env, membership, { company_id: companyId });
  /* Touching a legacy house lead also adopts it into the house org, so the
     row stops depending on the NULL exception. */
  const patch = {
    company_id: companyId,
    ...(legacyHouseLead ? { org_id: membership.org_id } : {})
  };
  if (before.company_id === companyId && !legacyHouseLead) return { lead: before, changed: false, audit: { recorded: false, reason: 'no_change' } };
  const row = (await db(env, `leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(patch)
  }))?.[0];
  const ledger = await audit(env, membership, user, 'lead.company_linked', 'lead', leadId, {
    from: before.company_id,
    to: companyId,
    legacy_org_adopted: legacyHouseLead
  });
  return { lead: row || { ...before, ...patch }, changed: true, audit: ledger };
}

/* People at companies, as outreach already records them (out_contacts).
   Read only here: their consent fields belong to the outreach engine. */
export async function listContacts(env, user, params) {
  const membership = await gate(env, user, params.get('org_id'), OWNER, 'see');
  const limit = Math.min(Math.max(Number(params.get('limit')) || 200, 1), 500);
  const company = params.get('company_id');
  if (company) uuid(company);
  const filter = company ? `&company_id=eq.${company}` : '';
  const rows = await db(env, `out_contacts?org_id=eq.${membership.org_id}${filter}&select=id,company_id,name,email,title,consent,created_at&order=created_at.desc&limit=${limit}`);
  return { contacts: rows || [], org_id: membership.org_id };
}

/* CLIENT HISTORY: everything one company, relationship, lead or project is
   linked to, plus the audit trail of those records, as one timeline. It only
   reads the canonical tables; nothing is copied into a history store. */
const HISTORY_SUBJECTS = {
  company_id: 'company',
  relationship_id: 'relationship',
  lead_id: 'lead',
  project_id: 'project'
};

function timelineEntry(kind, row, at, title) {
  return { kind, id: row.id, at: at || row.updated_at || row.created_at || null, title: title || row.title || row.name || row.email || kind, state: row.state || row.status || null };
}

export async function workHistory(env, user, params) {
  const membership = await gate(env, user, params.get('org_id'), OWNER, 'see');
  const org = membership.org_id;
  const subjectKey = Object.keys(HISTORY_SUBJECTS).find((k) => params.get(k));
  if (!subjectKey) throw bad('company_id, relationship_id, lead_id or project_id is required');
  const subjectId = uuid(params.get(subjectKey));
  const read = (path, migration) => db(env, path, {}, migration).then((rows) => rows || []);
  const cap = 100;

  /* Resolve the subject to the company and relationship it belongs to, so a
     relationship's history includes its company's orders and vice versa. */
  let companyIds = [];
  let relationshipIds = [];
  let leadIds = [];
  let projectIds = [];
  if (subjectKey === 'company_id') companyIds = [subjectId];
  if (subjectKey === 'relationship_id') {
    const rel = (await read(`work_relationships?id=eq.${subjectId}&org_id=eq.${org}&select=*`, POST_SALE_MIGRATION))[0];
    if (!rel) throw Object.assign(new Error('No such relationship'), { status: 404 });
    relationshipIds = [rel.id];
    if (rel.company_id) companyIds = [rel.company_id];
    if (rel.lead_id) leadIds = [rel.lead_id];
  }
  if (subjectKey === 'lead_id') leadIds = [subjectId];
  if (subjectKey === 'project_id') projectIds = [subjectId];

  const inList = (ids) => `in.(${ids.join(',')})`;
  const any = (pairs) => {
    const clauses = pairs.filter(([, ids]) => ids.length).map(([col, ids]) => `${col}.${inList(ids)}`);
    return clauses.length ? `or=(${clauses.join(',')})` : null;
  };

  const company = companyIds.length
    ? (await read(`out_companies?id=eq.${companyIds[0]}&org_id=eq.${org}&select=id,name,domain,kind,status,created_at`))[0] || null
    : null;
  if (subjectKey === 'company_id' && !company) throw Object.assign(new Error('No such company'), { status: 404 });

  const companyOrLead = any([['company_id', companyIds], ['lead_id', leadIds]]);
  const relationships = relationshipIds.length || companyOrLead
    ? await read(`work_relationships?org_id=eq.${org}&${any([['id', relationshipIds], ['company_id', companyIds], ['lead_id', leadIds]])}&select=*&order=created_at.desc&limit=${cap}`, POST_SALE_MIGRATION)
    : [];
  relationshipIds = [...new Set([...relationshipIds, ...relationships.map((r) => r.id)])];

  const leads = companyOrLead
    ? await read(`leads?org_id=eq.${org}&${any([['id', leadIds], ['company_id', companyIds]])}&select=id,name,email,status,want,created_at&order=created_at.desc&limit=${cap}`)
    : [];
  leadIds = [...new Set([...leadIds, ...leads.map((l) => l.id)])];

  const byParty = any([['company_id', companyIds], ['lead_id', leadIds]]);
  const orders = byParty ? await read(`work_orders?org_id=eq.${org}&${byParty}&select=*&order=placed_at.desc&limit=${cap}`) : [];
  const bookings = byParty ? await read(`work_bookings?org_id=eq.${org}&${byParty}&select=*&order=starts_at.desc.nullslast&limit=${cap}`) : [];
  const orderIds = orders.map((o) => o.id);

  const projectFilter = any([['id', projectIds], ['company_id', companyIds], ['relationship_id', relationshipIds], ['lead_id', leadIds], ['order_id', orderIds]]);
  const projects = projectFilter ? await read(`work_projects?org_id=eq.${org}&${projectFilter}&select=*&order=created_at.desc&limit=${cap}`, POST_SALE_MIGRATION) : [];
  if (subjectKey === 'project_id' && !projects.some((p) => p.id === subjectId)) throw Object.assign(new Error('No such project'), { status: 404 });
  projectIds = [...new Set([...projectIds, ...projects.map((p) => p.id)])];

  const deliverables = projectIds.length
    ? await read(`work_deliverables?org_id=eq.${org}&project_id=${inList(projectIds)}&select=*&order=created_at.desc&limit=${cap}`, POST_SALE_MIGRATION)
    : [];
  const renewalFilter = any([['company_id', companyIds], ['relationship_id', relationshipIds], ['project_id', projectIds], ['order_id', orderIds]]);
  const renewals = renewalFilter ? await read(`work_renewals?org_id=eq.${org}&${renewalFilter}&select=*&order=renews_at.asc.nullslast&limit=${cap}`, POST_SALE_MIGRATION) : [];
  const paymentFilter = any([['company_id', companyIds], ['lead_id', leadIds], ['order_id', orderIds], ['project_id', projectIds], ['renewal_id', renewals.map((r) => r.id)]]);
  const payments = paymentFilter ? await read(`work_payments?org_id=eq.${org}&${paymentFilter}&select=*&order=created_at.desc&limit=${cap}`, POST_SALE_MIGRATION) : [];

  const ids = [
    ...companyIds, ...relationshipIds, ...leadIds, ...orderIds, ...bookings.map((b) => b.id), ...projectIds,
    ...deliverables.map((d) => d.id), ...renewals.map((r) => r.id), ...payments.map((p) => p.id)
  ];
  const tasks = ids.length
    ? await read(`work_tasks?org_id=eq.${org}&related_id=${inList(ids.slice(0, 200))}&select=*&order=created_at.desc&limit=${cap}`)
    : [];
  const audit = ids.length
    ? await read(`control_audit?org_id=eq.${org}&resource_id=${inList(ids.slice(0, 200))}&select=id,event,resource_type,resource_id,actor_user_id,detail,at&order=at.desc&limit=${cap}`)
    : [];

  const paid = payments.filter((p) => p.state === 'paid');
  const totals = {
    billed_cents: payments.filter((p) => !['cancelled'].includes(p.state)).reduce((sum, p) => sum + (p.amount_cents || 0), 0),
    paid_cents: paid.reduce((sum, p) => sum + (p.amount_cents || 0), 0),
    provider_verified_cents: paid.filter((p) => p.verification === 'provider_verified').reduce((sum, p) => sum + (p.amount_cents || 0), 0),
    open_deliverables: deliverables.filter((d) => !['accepted', 'rejected'].includes(d.state)).length,
    next_renewal_at: renewals.filter((r) => r.state === 'upcoming' && r.renews_at).map((r) => r.renews_at).sort()[0] || null
  };

  const timeline = [
    ...leads.map((r) => timelineEntry('lead', r, r.created_at)),
    ...relationships.map((r) => timelineEntry('relationship', r, r.started_at || r.created_at)),
    ...orders.map((r) => timelineEntry('order', r, r.placed_at)),
    ...bookings.map((r) => timelineEntry('booking', r, r.starts_at || r.created_at)),
    ...projects.map((r) => timelineEntry('project', r, r.starts_at || r.created_at)),
    ...deliverables.map((r) => timelineEntry('deliverable', r, r.delivered_at || r.created_at)),
    ...renewals.map((r) => timelineEntry('renewal', r, r.renews_at || r.created_at)),
    ...payments.map((r) => timelineEntry('payment', r, r.paid_at || r.due_at || r.created_at)),
    ...tasks.map((r) => timelineEntry('task', r, r.completed_at || r.due_at || r.created_at)),
    ...audit.map((a) => ({ kind: 'audit', id: String(a.id), at: a.at, title: a.event, state: a.resource_type, resource_id: a.resource_id }))
  ].filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    org_id: org,
    subject: { type: HISTORY_SUBJECTS[subjectKey], id: subjectId },
    company,
    records: { leads, relationships, orders, bookings, projects, deliverables, renewals, payments, tasks },
    audit,
    totals,
    timeline
  };
}

/* One dispatcher so entry.js wires a single prefix. Returns null when the
   path is not a Work route. */
export async function handleWorkRequest(request, env, user, url) {
  const parts = url.pathname.replace(/^\/v1\/work\/?/, '').split('/').filter(Boolean);
  const [kindName, id, extra] = parts;
  if (!kindName || extra) return null;
  const method = request.method;

  if (kindName === 'leads') {
    if (!id && method === 'POST') return createLead(request, env, user);
    if (id && method === 'PATCH') return linkLeadCompany(request, env, user, id);
    return null;
  }
  if (kindName === 'contacts') return !id && method === 'GET' ? listContacts(env, user, url.searchParams) : null;
  if (kindName === 'history') return !id && method === 'GET' ? workHistory(env, user, url.searchParams) : null;
  if (!KINDS[kindName]) return null;
  if (!id && method === 'GET') return listWork(env, user, kindName, url.searchParams);
  if (!id && method === 'POST') return createWork(request, env, user, kindName);
  if (id && method === 'PATCH') return updateWork(request, env, user, kindName, id);
  return null;
}
