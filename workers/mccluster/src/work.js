/* CONTROL · WORK — the canonical write routes behind the operator console.

   Before this module Control could not create anything: tasks were derived
   from open leads, orders and bookings were lead lanes, companies were a
   free-text guess, and "+ New" pointed at the legacy CRM. This is the one
   place those records are written (docs/control-plane/CONTROL-ROOM-BACKEND-GAPS.md
   items 1, 2, 3 and 6), against the tables in
   supabase/pending_migrations/20261005150000_control_work_records_v1.sql.
   Companies are the existing public.out_companies, so they work before that
   migration; tasks, orders, bookings and lead-to-company links need it.

   Rules every route here keeps:
   - The caller's role comes from org membership (requireMembership), never
     from an email literal; every record carries that org_id and every read
     and update is filtered by it.
   - Each kind declares its own fields. Anything not declared is ignored, so
     a request cannot set org_id, created_by or timestamps.
   - Every write lands in control_audit with what it was before.
   - Until the migration is applied the routes answer 503 work_not_provisioned,
     so the console can say "not set up yet" instead of failing vaguely.

   Routes:
     GET   /v1/work/{kind}?org_id&state&limit          list
     POST  /v1/work/{kind}        { org_id, ...fields } create
     PATCH /v1/work/{kind}/{id}   { org_id, ...fields } update
     POST  /v1/work/leads         { org_id, name, email, want, note, campaign, company_id }
     PATCH /v1/work/leads/{id}    { org_id, company_id } link a lead to a company
   where kind is companies | tasks | orders | bookings. */

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
      related_type: oneOf(['lead', 'company', 'order', 'booking']),
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
      currency: (v) => {
        const s = text(3)(v);
        if (s === null) return null;
        if (!/^[a-z]{3}$/i.test(s)) throw bad('must be a three-letter currency code');
        return s.toLowerCase();
      },
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

async function db(env, path, options = {}) {
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
        detail: { code: 'work_not_provisioned', migration: 'supabase/pending_migrations/20261005150000_control_work_records_v1.sql' }
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

async function gate(env, user, orgId, writers) {
  const membership = await requireMembership(env, user, orgId);
  if (writers && !writers.includes(membership.role)) {
    throw Object.assign(new Error('Your role cannot change this'), {
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
    ['lead_id', 'leads']
  ];
  if (fields.related_type && fields.related_id) {
    const table = { lead: 'leads', company: 'out_companies', order: 'work_orders', booking: 'work_bookings' }[fields.related_type];
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
  const membership = await gate(env, user, params.get('org_id'));
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 500);
  const state = params.get('state');
  if (state && kind.fields.state) kind.fields.state(state);
  const filter = state ? `&state=eq.${encodeURIComponent(state)}` : '';
  const rows = await db(env, `${kind.table}?org_id=eq.${membership.org_id}${filter}&select=*&order=${kind.order}&limit=${limit}`);
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
  await assertSameOrg(env, membership, fields);
  const row = (await db(env, kind.table, {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...withoutNulls(fields), org_id: membership.org_id, ...(kind.stamp ? kind.stamp(user) : { created_by: user?.id || null }) })
  }))?.[0];
  const ledger = await audit(env, membership, user, `${kind.resource}.created`, kind.resource, row?.id, { fields });
  return { [kind.resource]: row, audit: ledger };
}

export async function updateWork(request, env, user, kindName, id) {
  const kind = KINDS[kindName];
  if (!UUID.test(id)) throw bad('id must be a uuid');
  const body = await request.json().catch(() => ({}));
  const membership = await gate(env, user, body?.org_id, kind.writers);
  const fields = pick(kind, body || {}, { creating: false });

  const before = (await db(env, `${kind.table}?id=eq.${id}&org_id=eq.${membership.org_id}&select=*`))?.[0];
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
  await assertSameOrg(env, membership, fields);

  const changed = Object.keys(fields).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(fields[k]));
  if (!changed.length) return { [kind.resource]: before, changed: false, audit: { recorded: false, reason: 'no_change' } };

  const row = (await db(env, `${kind.table}?id=eq.${id}&org_id=eq.${membership.org_id}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(fields)
  }))?.[0];
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
  if (!leadVisible(before, membership)) {
    throw Object.assign(new Error('No such lead'), { status: 404 });
  }
  await assertSameOrg(env, membership, { company_id: companyId });
  if (before.company_id === companyId) return { lead: before, changed: false, audit: { recorded: false, reason: 'no_change' } };
  const row = (await db(env, `leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ company_id: companyId })
  }))?.[0];
  const ledger = await audit(env, membership, user, 'lead.company_linked', 'lead', leadId, { from: before.company_id, to: companyId });
  return { lead: row || { ...before, company_id: companyId }, changed: true, audit: ledger };
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
  if (!KINDS[kindName]) return null;
  if (!id && method === 'GET') return listWork(env, user, kindName, url.searchParams);
  if (!id && method === 'POST') return createWork(request, env, user, kindName);
  if (id && method === 'PATCH') return updateWork(request, env, user, kindName, id);
  return null;
}
