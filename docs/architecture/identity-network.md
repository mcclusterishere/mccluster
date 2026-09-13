# McCluster Identity + Network Architecture

This document defines the canonical human identity and social/network layer for the McCluster ecosystem. It is architecture law beneath `AGENTS.md` and `docs/control-plane/ECOSYSTEM.md`.

## Core rule

A person creates **one McCluster account** and receives **one ecosystem identity** that follows them across McCluster itself, every product satellite, and every client/customer ecosystem that participates in the McCluster platform.

A satellite may grant a person local permissions, roles, subscriptions, storefront access, ownership, staff access, or customer status. A satellite does **not** create a competing identity namespace.

Think of the model like a platform login such as Facebook: the same identity can enter many properties, while each property decides what that identity is allowed to do there.

## Identity layers

There are three deliberately separate concepts:

1. **`m_uid` — immutable person key.** Stored in `m_people.id`. This is the durable internal identity. It never needs to be shown to a user and should never be reused for another person.
2. **McCluster ID — user-chosen public login/handle.** Stored in `platform_profiles.mccluster_id`. It is globally unique case-insensitively across the McCluster ecosystem. A user chooses it; McCluster may provision a temporary fallback only when a surface cannot ask for one during initial authentication.
3. **Membership / authorization — local role.** Stored through `platform_user_apps`, `org_members`, and product-specific authorization tables. Identity answers “who is this?” Membership answers “what can this person do here?”

The McCluster ID is not a Level 3 ID, Whip ID, church ID, client ID, or HERE ID. It is the same ecosystem identity everywhere.

## Signup law

Any first-party McCluster login or participating satellite signup must converge on the same flow:

```
email / phone / federated auth
          │
          ▼
      auth.users
          │
          ├──► m_people + m_auth_user_links     immutable identity
          │
          ├──► platform_profiles                public McCluster profile
          │        └── mccluster_id             user-chosen global handle
          │
          └──► network_profiles                 social/network profile
```

Creating an account on a satellite creates a McCluster ecosystem account. The satellite then records its own app/org membership for that already-canonical person.

Existing McCluster users never create a second account for a satellite. They authenticate with their existing McCluster ID/password or another linked McCluster authentication method, then receive the applicable satellite role.

## McCluster ID rules

- User-selectable.
- Globally unique, case-insensitive.
- Current canonical shape: 3–32 characters, beginning with an alphanumeric character; letters, numbers, `.`, `_`, and `-` are allowed.
- Stored normalized to lowercase for uniqueness and authentication.
- It is a public identifier, not the immutable database identity.
- Renaming a McCluster ID must not break orders, permissions, follows, posts, customer records, or historical activity because those attach to UUID identity, not the handle string.
- Never use email as the public network identity.

`set_mccluster_id()` is the canonical authenticated mutation for the handle. Product UIs should call that contract rather than implementing their own username tables.

## Universal profile

Every authenticated person receives a network profile associated with their `m_uid`. The profile is ecosystem-wide and can later be rendered by McCluster itself or any authorized satellite.

Current foundation table: `network_profiles`.

Profile fields include display name, bio, avatar, banner, website, visibility, discoverability, and whether cross-ecosystem activity sharing is enabled.

A client ecosystem may add client-local fields or presentation, but it does not fork the person's canonical identity.

## Network layer

The McCluster platform includes a first-party social graph and activity layer. This is not the existing social-media publishing scheduler (`social_accounts`, `social_posts`, etc.). Those tables connect businesses to external networks. The McCluster Network is the network **inside our ecosystem**.

Foundation tables:

- `network_profiles` — canonical public/social profile per person.
- `network_follows` — follow/mute/block graph.
- `network_posts` — native posts, updates, shares, announcements, and replies.
- `network_reactions` — reactions to native posts.
- `network_activity` — normalized cross-satellite activity events.

## Cross-satellite activity

Participating products should be able to publish meaningful events into the network activity stream, with explicit privacy controls. Examples:

- “Level 3 Media published a new LUT pack.”
- “A creator released a track.”
- “A Whip Equipped driver hit a milestone.”
- “A student completed a PRIM3 learning module.”
- “A nonprofit launched an initiative.”
- “A user joined an event.”

The activity event is not permission to leak private application data. Producers must publish an intentional summary/payload suitable for the selected audience.

Each event can identify:

- `actor_m_uid`
- `source_app_id`
- `source_org_id`
- `verb`
- `object_type`
- `object_id`
- `summary`
- audience/visibility
- structured payload
- occurrence time

## Audience model

Initial visibility values:

- `public` — visible outside the authenticated network where a product chooses to expose it.
- `network` — visible according to follow/network rules.
- `org` — visible to members of the originating client organization.
- `private` — visible only to the actor unless a future explicit share grants access.

Privacy is enforced at the data plane with RLS/API authorization, not just hidden in UI.

## Client/customer ecosystems

A customer application built on McCluster can feel like its own ecosystem without creating duplicate people.

```
                           McCluster person
                                m_uid
                                  │
                    public McCluster ID/profile
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
           Level 3 Media      Whip Equipped     Client X
           owner/customer     rider/driver      member/staff
                │                 │                 │
                └──── local roles/data/branding ───┘
                                  │
                                  ▼
                         McCluster Network
                    follows • posts • activity
```

Client-specific boundaries still matter. A Level 3 owner does not gain access to Whip data. A rider does not gain client-admin access. Identity is shared; authorization remains scoped.

## Relationship to authentication

Supabase Auth is currently the authentication credential/session provider. It is not the conceptual identity model. `m_people` + `m_auth_user_links` allow McCluster to retain one durable person even if authentication methods expand later.

That permits future linked login methods such as:

- email/password
- phone
- passkeys
- Sign in with Apple/Google
- organization SSO
- multiple verified credentials attached to the same `m_uid`

The public McCluster ID remains stable at the product layer unless the user intentionally renames it.

## Source of truth

Authority order:

1. `mcclusterishere/mccluster` architecture/contracts.
2. Canonical McCluster Supabase identity/network tables and APIs.
3. Satellite integrations consuming those contracts.
4. Satellite-local UI/preferences.

`mcclusterishere/Here` has no authority in this model.

## Build stages

### Foundation — now

- canonical `mccluster_id` on `platform_profiles`;
- one immutable `m_uid` per person via `m_people`/`m_auth_user_links`;
- one network profile per `m_uid`;
- follows, posts, reactions, and activity tables with RLS;
- satellites authenticate through McCluster identity rather than inventing usernames.

### Network service

- feed-query API;
- public profile route by McCluster ID;
- follow/block APIs;
- post composer and media attachments;
- event-ingestion contract for satellites;
- per-app/org privacy preferences;
- notification fan-out.

### Product UI

- McCluster home/feed;
- profile pages;
- app/activity badges;
- people search;
- org/community pages;
- satellite mini-feeds that filter the same network rather than forking it.

### Later scale

- ranking/recommendation layer;
- federation/export APIs where appropriate;
- richer media pipelines;
- moderation queues and trust/safety controls;
- network analytics;
- optional creator/business pages linked to human identities.

## Agent rule

Never create a satellite-specific user identity when the requirement can be represented as McCluster identity + satellite authorization. Never create a second social graph for a satellite. Add new network primitives to the canonical McCluster layer and let satellites consume them.
