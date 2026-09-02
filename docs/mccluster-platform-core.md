# McCluster Platform Core

McCluster is the canonical backend, identity provider, payment control plane, and application registry for every first-party McCluster product.

This is a platform rule, not a Whip Equipped-specific implementation detail.

## Platform rule

Every app built by McCluster — mobility, games, media, civic products, client tools, future App Store products, and web applications — should authenticate against the **same McCluster account system** and treat the McCluster Supabase project as the identity source of truth.

Current canonical Supabase project:

- project ref: `zmnhbrjyhxzhkxmhkexs`
- existing account implementation: `account.html` + `js/backend.js`
- organization/tenant model: `public.orgs` + `public.org_members`

Whip Equipped should therefore become an application family inside this platform rather than owning a parallel identity/database root.

## Product topology

```text
                         MCCLUSTER
                 auth + data + payments
                         │
            ┌────────────┼─────────────┐
            │            │             │
      McCluster Web   Whip Equipped   Future Apps
                        │
                ┌───────┼────────┐
                │       │        │
              Rider   Driver   Rentals
```

Frontends may remain in separate repositories and ship as separate App Store binaries. The backend identity, account, billing, organization, permissions, ledger, and application registry are shared.

## Sign in with McCluster

Supabase Auth now supports acting as an OAuth 2.1 / OpenID Connect identity provider. The McCluster Supabase project should be configured as the issuer for all first-party applications.

Target user experience:

1. An app shows **Continue with McCluster**.
2. The app starts an OAuth 2.1 Authorization Code + PKCE request against the McCluster Supabase project.
3. McCluster shows its own account / consent screen.
4. The user signs in once with their McCluster identity.
5. Supabase issues app-specific OAuth/OIDC tokens containing the same McCluster user id plus the requesting `client_id`.
6. The app uses those tokens against `api.mccluster.org` and Supabase RLS.

The same identity can then move between Rider, Driver, Rentals, a future game, a music app, or any other first-party product without creating another account database.

### OAuth clients

Register a separate OAuth client for every production app and every environment. Native apps are public clients and must use PKCE.

Initial registry:

| app key | product | client type |
|---|---|---|
| `mccluster-web` | McCluster website/account | public web |
| `whip-rider-ios` | Whip Equipped Rider iOS | public native |
| `whip-driver-ios` | Whip Equipped Driver iOS | public native |
| `whip-rentals-ios` | Whip Equipped Rentals iOS | public native |
| `whip-rider-web` | Rider PWA/web | public web |
| `whip-driver-web` | Driver PWA/web | public web |
| `whip-rentals-web` | Rentals PWA/web | public web |

Future applications are registered the same way.

## Domains

Recommended public platform surface:

- `matthew.mccluster.org` — public website / account UI
- `auth.mccluster.org` — Supabase Auth custom domain when enabled
- `api.mccluster.org` — Cloudflare Worker API gateway
- app-specific domains — product frontends only

The browser or native app must never receive a Supabase service-role key or Stripe secret.

## One Supabase project, many domains

Domain tables should be grouped by ownership rather than scattered across product repos:

- `auth.users` — canonical McCluster identities
- `platform_apps` — application registry
- `platform_user_apps` — user/app relationship and app role
- `orgs` / `org_members` — companies and tenant membership
- `platform_fee_policies` — monetization policy per app / organization
- `platform_ledger` — normalized McCluster-side transaction ledger
- mobility tables — rides, drivers, rentals, vehicles, mobility tenants
- other product tables — game saves, media entitlements, civic records, etc.

An app may own its UI repository without owning its own identity universe.

## McCluster payment model

Every payment is priced as a transaction with an explicit **payer side** and **receiver side**.

For Whip Equipped network transactions, the default policy is:

- payer/renter/rider service fee: **3%**
- receiver/operator platform fee: **3%**
- Stripe processing: separate

Example on a $100 operator base price:

```text
Operator base price                 $100.00
Customer McCluster/WE service fee     $3.00
Customer charge before tax/etc      $103.00

Operator-side WE platform fee         $3.00
Operator economic basis after WE     $97.00
Stripe processing                    separate

McCluster/WE platform revenue          $6.00
```

Taxes, refundable deposits, tolls, insurance premiums, government fees, and other pass-through amounts should not automatically be included in the percentage basis unless a product policy explicitly opts them in.

### White Label

White Label changes the **receiver-side** fee, not the existence of the McCluster payment rail:

- subscription: **$33/month**
- payer service fee: **3%** by default
- receiver/operator platform fee: **0%**
- Stripe processing: separate

Using the same $100 base example:

```text
Customer charge before tax/etc      $103.00
Operator-side WE fee                   $0.00
McCluster payer-side service fee       $3.00
White-label subscription              $33/mo
```

This preserves the promise that the operator keeps 100% of its stated base cut after processor / operating costs while McCluster still monetizes the transaction from the payer side.

The percentages are data, not hard-coded UI constants. `platform_fee_policies` is authoritative.

## Stripe Connect

Whip Equipped operators remain Stripe connected accounts. For transactions where the connected account should bear its own processing economics, direct charges are the default direction. The amount presented to the customer includes the transparent payer-side service fee. The Stripe application fee can represent the combined McCluster revenue components for that transaction:

```text
application fee = payer service fee + receiver platform fee
```

The ledger must separately record those components even if Stripe settles them as one application fee.

## Cloudflare

The long-term Worker should be **McCluster Core**, not `whip-equipped-core`.

Recommended API namespace:

```text
api.mccluster.org/v1/auth/*
api.mccluster.org/v1/apps/*
api.mccluster.org/v1/payments/*
api.mccluster.org/v1/mobility/rides/*
api.mccluster.org/v1/mobility/drivers/*
api.mccluster.org/v1/mobility/rentals/*
api.mccluster.org/v1/mobility/operators/*
```

Whip Equipped repositories become clients of this API. During migration, the existing WE Worker can act as a compatibility layer, but new platform primitives belong in `mccluster`.

## Migration order

1. Apply `0034_mccluster_platform_core.sql` to the existing McCluster Supabase project.
2. Enable Supabase OAuth 2.1 Server.
3. Use the McCluster site as the authorization/consent UI.
4. Register first-party Whip OAuth clients.
5. Switch Rider / Driver / Rentals login buttons to **Continue with McCluster**.
6. Move WE database migrations into the McCluster migration chain with collision-safe `mobility_*` names or `org_id` ownership.
7. Move WE payment / Stripe Connect modules behind `api.mccluster.org`.
8. Point all Whip frontends at McCluster Core.
9. Retire the separate Whip Supabase identity assumptions.
10. Reuse the same OAuth pattern for every future McCluster app.

## Non-negotiable security rules

- one human = one canonical McCluster auth user id
- public/native OAuth clients never receive a client secret
- native clients use Authorization Code + PKCE
- exact redirect URIs only
- asymmetric JWT signing keys for OIDC
- application authorization uses `client_id` + RLS, not only "is this user signed in"
- service-role and Stripe keys stay server-side
- app-specific roles and tenant membership are checked at the API/database boundary
- money is reconciled through a central ledger, never inferred solely from UI state
