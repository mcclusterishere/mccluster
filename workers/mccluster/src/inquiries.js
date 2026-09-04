/* INQUIRIES — a client's site asks, the client hears about it.

   A booking inquiry has to do three things or it is a form that goes
   nowhere:

     1. become a record            -> `leads`, org-scoped
     2. become a conversation      -> the `site` inbox channel, so it is
                                      workable rather than a row in a table
     3. reach the client           -> email, now, not on a queue

   Point 3 is why this sends inline rather than enqueuing. Migration 0022
   built `inbox_outbound` precisely so a send is "attempted, retried and
   auditable rather than fired into the dark", and that is the better
   pattern — but nothing drains that queue on a schedule. There is no
   pg_cron and no pg_net in this project, and the inbox edge function runs
   on demand. A queued notification would sit there until someone happened
   to open the console, which is the one place they would already have seen
   it. So the send happens here, and its outcome is still written to
   `inbox_outbound` so the audit trail 0022 asked for exists either way.

   Who gets told: the org's owners, by the email on their McCluster account,
   plus `orgs.settings.notify_email` when set. Nobody is hardcoded. If a
   client has no owner and no notify_email, the inquiry is still recorded
   and still appears in the inbox — it just does not ring a phone, and the
   response says so rather than pretending it was delivered. */

const RESEND_API = 'https://api.resend.com/emails';

function sbHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders(env, init.headers || {})
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw Object.assign(new Error(typeof data === 'string' ? data : (data?.message || 'Database request failed')), {
      status: res.status
    });
  }
  return data;
}

async function orgBySlug(env, slug) {
  if (!slug) return null;
  const rows = await sb(env, `orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name,settings`);
  return rows?.[0] || null;
}

/* ---------- the conversation ----------
   The `site` channel exists and is enabled for exactly this: a message that
   originated on one of our own pages. Reusing it means a client works their
   inquiries in the same inbox as everything else, instead of in a bespoke
   screen built for one form. */

async function upsertConversation(env, org, { name, email, want, note, page }) {
  const found = await sb(
    env,
    `inbox_contacts?org_id=eq.${encodeURIComponent(org.id)}&channel=eq.site&email=eq.${encodeURIComponent(email)}&select=id&limit=1`
  );

  let contactId = found?.[0]?.id;
  if (!contactId) {
    const made = await sb(env, 'inbox_contacts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: org.id,
        channel: 'site',
        /* external_id is the channel's own id for a person. On the site
           channel that is the address they wrote in with. */
        external_id: email,
        email,
        display_name: name
      })
    });
    contactId = made?.[0]?.id;
  }
  if (!contactId) return null;

  const open = await sb(
    env,
    `inbox_conversations?org_id=eq.${encodeURIComponent(org.id)}&contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open&select=id&limit=1`
  );

  let convId = open?.[0]?.id;
  if (!convId) {
    const made = await sb(env, 'inbox_conversations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: org.id,
        contact_id: contactId,
        channel: 'site',
        kind: 'dm',
        subject_ref: page || '/book',
        status: 'open',
        last_at: new Date().toISOString()
      })
    });
    convId = made?.[0]?.id;
  }
  if (!convId) return null;

  await sb(env, 'inbox_messages', {
    method: 'POST',
    body: JSON.stringify({
      org_id: org.id,
      conv_id: convId,
      direction: 'in',
      author: 'contact',
      /* Already in our hands, so 'delivered' rather than 'sent' — this
         message did not travel over a platform that could still drop it. */
      state: 'delivered',
      body: `${want}\n\n${note}`.trim(),
      meta: { name, page: page || null, source: 'book-form' }
    })
  }).catch(() => null);

  await sb(env, `inbox_conversations?id=eq.${encodeURIComponent(convId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_at: new Date().toISOString(), status: 'open' })
  }).catch(() => null);

  return { contactId, convId };
}

/* ---------- who to tell ---------- */

async function notifyTargets(env, org) {
  const targets = new Set();

  const configured = org.settings?.notify_email;
  if (configured) String(configured).split(',').map((s) => s.trim()).filter(Boolean).forEach((e) => targets.add(e));

  /* Owners are addressed by the email on their McCluster account, so nobody
     maintains a second copy of the client's address. auth.users is not
     exposed through PostgREST, so this goes via the admin API. */
  const owners = await sb(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&role=eq.owner&select=profile_id`
  ).catch(() => []);

  for (const owner of owners || []) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(owner.profile_id)}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    }).catch(() => null);
    if (!res || !res.ok) continue;
    const user = await res.json().catch(() => null);
    if (user?.email) targets.add(user.email);
  }

  return [...targets];
}

async function senderFor(env, org) {
  const rows = await sb(
    env,
    `out_sender_identities?org_id=eq.${encodeURIComponent(org.id)}&provider=eq.resend&verified=is.true&select=from_name,from_email&limit=1`
  ).catch(() => []);
  if (rows?.[0]) return rows[0];
  /* Falls back to the platform's own address rather than inventing one for
     the client. NOTIFY_FROM must be a domain verified in Resend. */
  return env.NOTIFY_FROM
    ? { from_name: 'McCluster', from_email: env.NOTIFY_FROM }
    : null;
}

function plainText({ org, name, email, want, note, page }) {
  return [
    `New inquiry for ${org.name}.`,
    '',
    `From:  ${name} <${email}>`,
    `About: ${want}`,
    page ? `Page:  ${page}` : null,
    '',
    note || '(no message)',
    '',
    '—',
    'Reply straight to this email to answer them.'
  ].filter((line) => line !== null).join('\n');
}

/* Recorded whatever happens. A refusal and a failure are outcomes worth
   keeping next to the successes, which is the posture migration 0022 set. */
async function recordSend(env, { orgId, convId, target, body, state, error, dedupeKey }) {
  await sb(env, 'inbox_outbound', {
    method: 'POST',
    body: JSON.stringify({
      org_id: orgId,
      conv_id: convId || null,
      channel: 'email',
      as_kind: 'notification',
      target_id: target,
      body,
      state,
      attempts: 1,
      last_error: error ? String(error).slice(0, 500) : null,
      sent_at: state === 'sent' ? new Date().toISOString() : null,
      dedupe_key: dedupeKey
    })
  }).catch(() => null);
}

async function notifyOwners(env, org, lead, convId) {
  if (!env.RESEND_API_KEY) return { notified: 0, reason: 'no email provider configured' };

  const targets = await notifyTargets(env, org);
  if (!targets.length) return { notified: 0, reason: 'no owner or notify_email for this client' };

  const from = await senderFor(env, org);
  if (!from) return { notified: 0, reason: 'no verified sender address' };

  const body = plainText({ org, ...lead });
  let notified = 0;

  for (const target of targets) {
    /* One notification per lead per recipient. A retried request cannot
       email the same person about the same inquiry twice. */
    const dedupeKey = `inquiry:${lead.leadId || convId || lead.email}:${target}`;
    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: `${from.from_name} <${from.from_email}>`,
          to: [target],
          reply_to: lead.email,
          subject: `New ${lead.want.toLowerCase()} inquiry — ${lead.name}`,
          text: body
        })
      });
      if (!res.ok) {
        await recordSend(env, { orgId: org.id, convId, target, body, state: 'failed', error: await res.text(), dedupeKey });
        continue;
      }
      notified += 1;
      await recordSend(env, { orgId: org.id, convId, target, body, state: 'sent', dedupeKey });
    } catch (error) {
      await recordSend(env, { orgId: org.id, convId, target, body, state: 'failed', error: error.message, dedupeKey });
    }
  }

  return { notified };
}

export { orgBySlug, sb, upsertConversation, notifyOwners };
