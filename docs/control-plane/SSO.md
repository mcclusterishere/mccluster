# One McCluster account, every McCluster-powered site

## How it works

**The identity is the Supabase project, not the page.** Every property —
matthew.mccluster.org and every client satellite — authenticates against
project `zmnhbrjyhxzhkxmhkexs`. Someone who signs in here and later on a
client's site is the *same* `auth.users` row, same id, on both.

That is what makes one account work everywhere. It is **not** a shared
cookie: a session is per-origin, and no current browser will carry one
across domains — third-party cookies are dead and silent cross-site auth
died with them. Signing in on a client's site is one tap, because Google
already knows them. It is not a second account.

`js/mcc-auth.js` is the canonical client. Satellites **vendor** it rather
than fetch it from another origin, so an artist's login is not on someone
else's uptime and not on their critical path. Fix it here, copy it out.

It writes the same `mccdb_session` key `js/backend.js` uses, so on this site
both read one session. Diverging would sign a person in twice and out once.

## Two layers

| | What the visitor sees | Needs |
| --- | --- | --- |
| **1. Shared identity** | "Continue with Google" on each site | Google enabled (below) |
| **2. Branded SSO** | "Continue with McCluster" | Layer 1, plus registered OAuth clients |

Layer 1 is the foundation and delivers the actual goal — one account
everywhere. Layer 2 is the branding on top and can wait.

This project already answers OIDC discovery at
`/auth/v1/.well-known/openid-configuration`, so McCluster **is** a real
identity provider and `oauth/consent/` is its consent screen.

## What is blocking it right now

Both are dashboard steps. Neither can be done from SQL or from the Worker.

### 1. Google is disabled

`/auth/v1/settings` currently reports `"google": false` — only `email` is on.
Until this changes the Google buttons stay hidden by design; they check the
provider before rendering, so nobody is shown a button that 400s.

1. **Google Cloud Console** → APIs & Services → Credentials → Create OAuth
   client ID → *Web application*. Authorized redirect URI, exactly:
   ```
   https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/callback
   ```
2. **Supabase** → Authentication → Providers → Google → paste the client ID
   and secret, enable, save.
3. **Supabase** → Authentication → URL Configuration → add to *Redirect
   URLs*:
   ```
   https://matthew.mccluster.org/auth/**
   https://mccluster.org/auth/**
   https://www.esmermusic.com/auth/**
   https://esmermusic.com/auth/**
   ```
   This allowlist is what stops the sign-in flow becoming an open redirect
   that arrives carrying a fresh session. Add a satellite here when it
   launches; leaving it out breaks its login, and a wildcard host would
   defeat the point.

Nothing needs redeploying afterwards. The buttons appear on their own.

### 2. No OAuth client is registered (Layer 2 only)

Every row in `platform_oauth_clients` has `client_id` null, so
`/auth/v1/oauth/authorize` answers **404** for all of them and the consent
screen cannot be reached. Migration 0041 records the intended apps and their
redirect URIs; issuing the client is a **Supabase → Authentication → OAuth
Apps** step. Put the issued id back into the mirror:

```sql
update public.platform_oauth_clients c
   set client_id = '<issued>', registered_at = now()
  from public.platform_apps a
 where a.id = c.app_id and a.app_key = 'esmer-web';
```

`platform_oauth_clients` is a mirror for policy and audit. Supabase Auth is
the protocol source of truth — 0034 says so, and a made-up `client_id` here
would make the registry lie about what exists.

## Adding a satellite to the account system

1. Copy `js/mcc-auth.js` into the satellite. Do not edit the copy.
2. Add a callback page at `/auth/` that calls `MCC.complete()` and then
   returns the visitor to a **same-origin** path. Both existing callbacks
   reject an absolute `next`; keep that.
3. Add the satellite's `/auth/**` to the Supabase redirect allowlist.
4. Add its `oauth_redirect_uris` to `platform_apps`.

Do not add a Supabase project, an auth table, or a session store. A
satellite that mints its own identity is the one thing this design exists to
prevent.
