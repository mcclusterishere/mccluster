# Client payments — how a McCluster client takes money on their own site

One rail, on the control plane, for every client site McCluster builds. A
satellite repo never grows a payment backend; it calls this.

## The charge model

**Direct charges on the client's own connected account.**

- The charge is created on the client's Stripe account (`Stripe-Account` header).
- The **client** is merchant of record. Their name is on the cardholder's statement.
- The **client** carries refunds and disputes.
- McCluster takes `application_fee_amount`, set by `platform_fee_policies`.

This is deliberate. McCluster should not be merchant of record for a
musician's booking deposit — that would put a stranger's chargeback on
McCluster Corp's balance and McCluster's name on their statement.

Accounts are **Express**: Stripe hosts onboarding and the client gets a
Stripe-run dashboard, so McCluster never handles anyone's SSN or bank
details.

## Where the money lives in the schema

| Thing | Table |
| --- | --- |
| Client tenancy | `orgs` (`kind = 'client'`) |
| Who may act for a client | `org_members` (`owner` / `staff` / `viewer`) |
| The client's Stripe rail | `org_stripe_accounts` (per org, **per mode**) |
| What may be sold and for how much | `offerings` |
| Which account takes the money | `offerings.payment_account_reference` → `org_stripe_accounts.account_reference` |
| The fee McCluster takes | `platform_fee_policies` (basis points) |
| What actually happened | `platform_ledger` |
| Inquiries / booking requests | `leads` (`org_id`) |

`offerings.payment_account_reference` already existed and already said
`mccluster-primary` on every row. Pointing a client's offerings at the
client's own Stripe account is therefore a **data** change, not a code
change.

`org_stripe_accounts` is keyed on `(org_id, livemode)` so a client's test
account and live account coexist. Every flow is proved in test mode before a
real card is charged.

## API

Base: `https://api.mccluster.org`

### `POST /v1/inquiries` — public

The Book-tab path. A booking request is a **lead, not a charge**. No auth: the
person filling in the form has no account.

```jsonc
// request
{ "org": "esmer", "name": "…", "email": "…",
  "want": "studio session", "note": "…", "page": "/book", "source": "esmer-book" }

// 201
{ "received": true, "at": "2026-09-04T…Z" }
```

No lead id is returned. The form needs to know it arrived and nothing more.

### `GET /v1/connect/status?org=<slug>` — org member

Refreshes from Stripe, persists, returns the rail. `requirements` is Stripe's
own blob, passed through unparaphrased.

```jsonc
{ "org": { "slug": "esmer", "name": "Esmer — Justin Esmer" },
  "stripe": { "connected": false, "ready": false, "onboarding_status": "not_started",
              "charges_enabled": false, "payouts_enabled": false,
              "requirements": { "currently_due": [], "past_due": [], "disabled_reason": null },
              "livemode": false } }
```

`onboarding_status` is one of `not_started` → `onboarding` → `ready`, with
`restricted` / `disabled` mirroring a Stripe account that cannot charge.

### `POST /v1/connect/accounts` — org **owner**

Creates the Express account. Idempotent: returns the existing rail if one is
already connected. Optional `product_description` and `url` are passed to
Stripe — Stripe reads them during review, so describe the real business.

### `POST /v1/connect/onboarding-link` — org **owner**

Returns a short-lived Stripe-hosted onboarding URL. `return_url` and
`refresh_url` are **validated against `ALLOWED_ORIGINS`**; an unrecognised
origin is replaced with the default rather than honoured, because a client
bounced to an attacker-supplied URL after onboarding is a phishing surface.

### `POST /v1/stripe/webhook` — Stripe only

Signature is the authentication. Verified against the raw body before
anything is read out of it. Deduplicated through `stripe_events`, so a
replayed delivery is a no-op. Handles `account.updated` today.

**The webhook is the only proof of payment.** A browser saying "payment
succeeded" is never proof.

## Onboarding a new client

1. Row in `orgs` (`kind = 'client'`).
2. Row in `org_members` making the client `owner`.
3. Row in `platform_apps` for their site.
4. Row in `platform_fee_policies` — **set the fee deliberately.** A fee the
   owner has not stated is never invented in a migration.
5. Rows in `org_stripe_accounts` (test and live) with an `account_reference`.
6. Client hits `/v1/connect/accounts`, then `/v1/connect/onboarding-link`.
7. `account.updated` flips them to `ready`.

## Operational state — read this before promising a client card payments

- **The McCluster platform Stripe account cannot currently charge.**
  `acct_1TrMuQLHDCoUz9Q4` (dashboard "Street Credit Bureau", entity McCluster
  Corp) reports `charges_enabled: false`, `payouts_enabled: false`,
  `card_payments: inactive`, `disabled_reason: requirements.past_due`, with
  `business_profile.url` past due and error `invalid_url_website_inaccessible`,
  plus an open URL inquiry form. The site returns HTTP 200, so this is a stale
  verification that must be resubmitted in the dashboard. Until it clears, no
  client takes a card.
- **The Worker has no Stripe keys.** `STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` and
  `STRIPE_CONNECT_WEBHOOK_SECRET` are unset, so every money route answers 503.
  Set them as Worker secrets, test keys first.
- **Connect has never been used.** Zero connected accounts; `payments`,
  `stripe_events` and `platform_ledger` are all empty. Nothing has run
  end to end yet.

## Not built yet

`/v1/checkout` — turning an `offering` into a Checkout Session on the client's
account with the application fee applied, and writing the `platform_ledger`
row from the webhook. Esmer is inquiry-first and does not need it to ship.
Build it when a client has a settled price list.
