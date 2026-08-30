# SHARED ACCOUNTS: one customer, every McCluster property

## The problem, stated honestly

Today auth lives in `js/backend.js`: Supabase GoTrue sessions kept in
**browser localStorage**, mirrored to a keep-shelf, refreshed client
side. That works on one hostname and cannot follow a customer from
matthew.mccluster.org to matthew.mccluster.org or any future album
property. localStorage does not cross origins. Left alone, every
subdomain would mint disconnected accounts.

## The direction

One customer ID, one session, every property inside a defined boundary.

1. **account.mccluster.org** becomes the auth home: sign-up, sign-in,
   password reset, profile. Every property links to it and returns via
   a **centralized callback** with an explicit, server-checked
   `redirect_to` allowlist (only registered properties from
   data/domains.json, never a wildcard).
2. **Server-managed sessions.** The callback exchanges the GoTrue
   session for a **secure, HTTP-only, SameSite=Lax cookie** set on the
   narrowest scope that works. Property-local cookies by default; the
   shared `.mccluster.org` scope only for the properties explicitly in
   the boundary. An experimental subdomain must never be able to read
   the session cookie just because it exists.
3. **CSRF protection** on every state-changing request (double-submit
   token or Origin checks at the edge function).
4. **Rotating sessions**: short-lived access tokens, refresh rotation
   with reuse detection (GoTrue already rotates refresh tokens;
   keep them server-side once cookies land, not in localStorage).
5. **RLS stays the wall.** Every table keyed on `auth.uid()`; the
   single customer ID is the GoTrue user id, shared across properties
   because they share the one Supabase project.
6. **No service-role keys in any browser, ever.** Publishable key only;
   privileged reads live in edge functions.

## The boundary

| Property | In the cookie boundary? |
|---|---|
| matthew.mccluster.org | yes |
| matthew.mccluster.org | yes, when it launches |
| account.mccluster.org | yes, it issues the session |
| future album properties | only when added to data/domains.json AND the redirect allowlist |
| experiments / previews | no, never |

## Migration path (no big bang)

1. Keep localStorage sessions working on HERE (they do today).
2. Stand up the callback + cookie exchange as an edge function; the
   account page adopts it first.
3. Properties adopt cookie-session reads one at a time; localStorage
   becomes the fallback, then retires.
4. The moment two properties are live, test: sign up on HERE, buy on
   matthew: one customer row, one record, zero duplicate accounts.
