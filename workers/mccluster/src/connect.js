/* CLIENT CONNECT — how a McCluster client gets paid on their own site.

   The mechanics were already proved once, inside Whip Equipped: Express
   accounts, direct charges with an application fee, account links, and
   signature-verified webhooks. What was missing is that the whole rail is
   bound to whip `tenants` and reachable only at
   /api/operators/{tenantId}/stripe/*, so no other client can use it. Esmer
   would have needed a whip tenant row to take a booking deposit, which is
   absurd.

   This is the same rail on `orgs`, which is where client tenancy actually
   lives. It deliberately does NOT re-implement Stripe: the request helper,
   the account-link call and the webhook verifier are imported from the whip
   module rather than copied, so there is one signature verifier in this
   Worker and not two that can drift apart.

   Charge model is DIRECT: the charge is created on the client's connected
   account (Stripe-Account header), the client is merchant of record, the
   client's name is on the cardholder's statement, and the client carries
   the dispute. McCluster takes application_fee_amount. That is the correct
   liability split for an agency that builds sites for other people's
   businesses — McCluster should not be merchant of record for a musician's
   booking deposit. */

import { upsertConversation, notifyOwners } from './inquiries.js';
import {
  stripeConfigured,
  stripeRequest,
  createAccountLink,
  retrieveConnectedAccount,
  connectedAccountReady,
  verifyStripeWebhook
} from './whip/stripe.js';

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

/* Which Stripe world this Worker is talking to. The mode is read off the key
   rather than configured separately, because a mismatch between a
   `livemode` column and the key that wrote the row is the kind of bug that
   is only discovered by a real customer's card. */
function livemode(env) {
  return String(env.STRIPE_SECRET_KEY || '').startsWith('sk_live');
}

async function currentUser(req, env) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  return res.ok ? res.json() : null;
}

async function orgBySlug(env, slug) {
  if (!slug) return null;
  const rows = await sb(env, `orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name,kind`);
  return rows?.[0] || null;
}

/* Connect mutations are an owner power, not a member power. Reading the rail
   is enough to render a status badge; creating the account that money lands
   in is not something a `viewer` on the org should be able to do. */
async function requireOrgRole(req, env, slug, roles = ['owner']) {
  const user = await currentUser(req, env);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const org = await orgBySlug(env, slug);
  if (!org) throw Object.assign(new Error('Unknown client org'), { status: 404 });
  const rows = await sb(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user.id)}&select=role`
  );
  const role = rows?.[0]?.role;
  if (!role || !roles.includes(role)) {
    throw Object.assign(new Error('You do not have that permission on this client'), { status: 403 });
  }
  return { user, org, role };
}

async function railFor(env, orgId) {
  const rows = await sb(
    env,
    `org_stripe_accounts?org_id=eq.${encodeURIComponent(orgId)}&livemode=is.${livemode(env)}&select=*`
  );
  return rows?.[0] || null;
}

async function patchRail(env, orgId, patch) {
  const rows = await sb(
    env,
    `org_stripe_accounts?org_id=eq.${encodeURIComponent(orgId)}&livemode=is.${livemode(env)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    }
  );
  return rows?.[0] || null;
}

/* Stripe's account object says four separate things about readiness. Collapse
   them into one word for the UI, but never collapse them in a way that calls
   an account ready when it cannot actually charge. */
function statusFor(account) {
  if (!account) return 'not_started';
  if (connectedAccountReady(account)) return 'ready';
  if (account.requirements?.disabled_reason) return 'restricted';
  return account.details_submitted ? 'restricted' : 'onboarding';
}

function railPatchFromAccount(account) {
  return {
    stripe_account_id: account.id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    onboarding_status: statusFor(account),
    requirements: account.requirements || {},
    last_synced_at: new Date().toISOString()
  };
}

function publicRail(rail) {
  if (!rail) return { connected: false, ready: false, onboarding_status: 'not_started' };
  return {
    connected: Boolean(rail.stripe_account_id),
    ready: rail.onboarding_status === 'ready',
    onboarding_status: rail.onboarding_status,
    account_id: rail.stripe_account_id,
    charges_enabled: rail.charges_enabled,
    payouts_enabled: rail.payouts_enabled,
    details_submitted: rail.details_submitted,
    /* Stripe's own words for what is still outstanding. Paraphrasing this
       is how a client ends up staring at "pending" for a week. */
    requirements: {
      currently_due: rail.requirements?.currently_due || [],
      past_due: rail.requirements?.past_due || [],
      disabled_reason: rail.requirements?.disabled_reason || null
    },
    livemode: rail.livemode,
    last_synced_at: rail.last_synced_at
  };
}

/* An Express account for a client business. Unlike the whip version this
   takes the product description from the caller instead of asserting the
   client sells rideshare — Stripe reads that field during review, and a
   musician described as a rental operator gets held up for it. */
async function createClientAccount(env, { org, email, productDescription, url }) {
  return stripeRequest(env, 'accounts', {
    type: 'express',
    country: 'US',
    email: email || undefined,
    business_profile: {
      name: org.name || undefined,
      product_description: productDescription || undefined,
      url: url || undefined
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      mccluster_org_id: org.id,
      mccluster_org_slug: org.slug
    }
  });
}

/* Webhook events are processed at most once. `stripe_events` has event_id as
   its key, so a duplicate delivery — which Stripe will absolutely send —
   loses the insert race and returns early rather than applying twice. */
async function alreadyProcessed(env, event) {
  /* The claim is the INSERT, not a preceding SELECT. Stripe retries, and two
     deliveries of the same event can both pass a read before either writes;
     only the primary key can arbitrate that race. A duplicate-key rejection
     means some other invocation owns this event, so this one stops. */
  try {
    await sb(env, 'stripe_events', {
      method: 'POST',
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        stripe_account_id: event.account || null
      })
    });
    return false;
  } catch (error) {
    if (error.status === 409) return true;
    throw error;
  }
}

async function handleEvent(env, event) {
  if (await alreadyProcessed(env, event)) return { handled: false, reason: 'duplicate' };

  if (event.type === 'account.updated') {
    const account = event.data?.object;
    if (!account?.id) return { handled: false, reason: 'no account' };
    /* Addressed by the account's own unique id rather than by org + this
       Worker's livemode: the event carries its own mode, and matching on
       ours would write the wrong row if they ever disagreed. */
    const rows = await sb(
      env,
      `org_stripe_accounts?stripe_account_id=eq.${encodeURIComponent(account.id)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...railPatchFromAccount(account), updated_at: new Date().toISOString() })
      }
    );
    if (!rows?.length) return { handled: false, reason: 'account not registered to a client' };
    return { handled: true, type: event.type, org_id: rows[0].org_id };
  }

  return { handled: false, reason: 'unhandled event type' };
}

export default {
  async fetch(request, env, url, reply, fail, logEvent) {
    const path = url.pathname.replace(/\/+$/, '') || '/';

    /* THE WEBHOOK IS THE ONLY PROOF OF PAYMENT.

       Verified before anything is read out of it, and read from the raw body
       — re-serializing JSON before checking the signature would break the
       HMAC. This route is intentionally above the auth check: Stripe does not
       carry a Supabase session, the signature is the authentication. */
    if (path === '/v1/stripe/webhook' && request.method === 'POST') {
      const raw = await request.text();
      let event;
      try {
        event = await verifyStripeWebhook(
          raw,
          request.headers.get('stripe-signature'),
          env.STRIPE_CONNECT_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        return fail(request, env, error.message || 'Invalid Stripe signature', 400);
      }
      const result = await handleEvent(env, event);
      return reply(request, env, { received: true, ...result });
    }

    /* THE BOOK TAB.

       Inquiry-first: a booking request is a lead, not a charge. It lands in
       the CRM the house already runs, tagged with the client org, so Esmer's
       Book tab does not grow a second bookings table in a satellite repo.
       Public on purpose — a fan filling in a booking form has no account. */
    if (path === '/v1/inquiries' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const org = await orgBySlug(env, body.org);
      if (!org) return fail(request, env, 'Unknown client org', 404);

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      if (!name || !email) return fail(request, env, 'name and email are required');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(request, env, 'A valid email is required');
      if (name.length > 200 || email.length > 320) return fail(request, env, 'name or email is too long');

      const want = String(body.want || '').slice(0, 200);
      const note = String(body.note || '').slice(0, 4000);
      const page = String(body.page || '').slice(0, 500);

      const rows = await sb(env, 'leads?select=id,at', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          org_id: org.id,
          name,
          email,
          /* `want` is the service asked for. It is stored as free text on
             purpose: Esmer's service list is not settled, and a check
             constraint on a list nobody has approved would reject real
             inquiries. */
          want,
          note,
          page,
          source: String(body.source || 'esmer-book').slice(0, 100),
          medium: body.medium ? String(body.medium).slice(0, 100) : null,
          campaign: body.campaign ? String(body.campaign).slice(0, 100) : null
        })
      });

      /* The lead is the record. Everything after it is delivery, and a
         delivery failure must not lose a message that is already saved —
         so the conversation and the notification are best-effort and their
         outcome is reported rather than thrown. */
      const lead = { leadId: rows?.[0]?.id, name, email, want, note, page };
      let thread = null;
      let notice = { notified: 0, reason: 'not attempted' };
      try {
        thread = await upsertConversation(env, org, lead);
        notice = await notifyOwners(env, org, lead, thread?.convId);
      } catch (error) {
        logEvent('error', { at: 'inquiry-delivery', org: org.slug, message: error.message });
      }

      /* No lead id, no thread id and no recipient address goes back to the
         browser. The form needs to know it was received; who was emailed is
         the client's business, not the visitor's. `notified` is a count so
         the Book page can stay honest without naming anyone. */
      return reply(request, env, {
        received: true,
        at: rows?.[0]?.at || new Date().toISOString(),
        notified: notice.notified > 0
      }, 201);
    }

    /* ACCOUNT — passwordless sign-in for someone who just made an inquiry.

       Supabase Auth is the plane's auth and this is a thin front door onto
       it: no password is accepted here, no user record is written here, and
       no session is minted here. Supabase emails the link and owns the
       session.

       The response is deliberately identical whether the address is already
       registered or not. Anything else turns this into an oracle for
       checking whether a given person has an account with a McCluster
       client, which is not a question a public endpoint should answer. */
    if (path === '/v1/account/start' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const org = await orgBySlug(env, body.org);
      if (!org) return fail(request, env, 'Unknown client org', 404);

      const email = String(body.email || '').trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
        return fail(request, env, 'A valid email is required');
      }

      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          create_user: true,
          data: { source: 'inquiry', org_slug: org.slug }
        })
      });

      if (!res.ok) {
        /* Rate limiting is the common case here and it is not the visitor's
           fault. Log the detail, tell them plainly, do not leak the body. */
        logEvent('error', { at: 'account-start', org: org.slug, status: res.status });
        return fail(request, env, 'Could not send a sign-in link just now', 503);
      }

      return reply(request, env, { sent: true });
    }

    // ---- Connect onboarding, owner-only ------------------------------------

    if (path === '/v1/connect/status' && request.method === 'GET') {
      const { org } = await requireOrgRole(request, env, url.searchParams.get('org'), ['owner', 'staff', 'viewer']);
      let rail = await railFor(env, org.id);
      if (rail?.stripe_account_id && stripeConfigured(env)) {
        const account = await retrieveConnectedAccount(env, rail.stripe_account_id);
        rail = (await patchRail(env, org.id, railPatchFromAccount(account))) || rail;
      }
      return reply(request, env, { org: { slug: org.slug, name: org.name }, stripe: publicRail(rail) });
    }

    if (path === '/v1/connect/accounts' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { org, user } = await requireOrgRole(request, env, body.org);
      if (!stripeConfigured(env)) return fail(request, env, 'Stripe is not configured on this Worker', 503);

      let rail = await railFor(env, org.id);
      if (!rail) return fail(request, env, 'This client has no Connect rail provisioned', 409);
      if (rail.stripe_account_id) {
        return reply(request, env, { org: { slug: org.slug }, stripe: publicRail(rail) });
      }

      const account = await createClientAccount(env, {
        org,
        email: body.email || user.email,
        productDescription: body.product_description,
        url: body.url
      });
      rail = await patchRail(env, org.id, railPatchFromAccount(account));
      return reply(request, env, { org: { slug: org.slug }, stripe: publicRail(rail) }, 201);
    }

    if (path === '/v1/connect/onboarding-link' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { org } = await requireOrgRole(request, env, body.org);
      if (!stripeConfigured(env)) return fail(request, env, 'Stripe is not configured on this Worker', 503);

      const rail = await railFor(env, org.id);
      if (!rail?.stripe_account_id) return fail(request, env, 'Create the connected account first', 409);

      /* Stripe rejects an account link whose URLs are not https, and a
         client bounced to an attacker-supplied return_url after onboarding
         is a phishing surface. Only origins this Worker already trusts. */
      const trusted = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
      const fallback = env.PUBLIC_APP_URL || 'https://matthew.mccluster.org';
      const safeUrl = (candidate) => {
        if (!candidate) return null;
        try {
          const parsed = new URL(candidate);
          return trusted.includes(parsed.origin) ? parsed.toString() : null;
        } catch { return null; }
      };

      const link = await createAccountLink(env, rail.stripe_account_id, {
        returnUrl: safeUrl(body.return_url) || `${fallback}/control.html?connect=return&org=${encodeURIComponent(org.slug)}`,
        refreshUrl: safeUrl(body.refresh_url) || `${fallback}/control.html?connect=refresh&org=${encodeURIComponent(org.slug)}`
      });

      if (rail.onboarding_status === 'not_started') {
        await patchRail(env, org.id, { onboarding_status: 'onboarding' });
      }
      return reply(request, env, { url: link.url, expires_at: link.expires_at });
    }

    return null; // not a connect route; let the caller fall through
  }
};
