# Equity Uprise clipping product contract

This document is the product layer on top of `CLIPPING-MARKETPLACE.md`.
The v1 settlement engine remains canonical.

## Roles

- **Equity Uprise** is the operator/distribution brand for clipping campaigns.
- **Action Network** owns member/clipper identity, claims, verified social
  accounts, work history, reputation and the distribution graph.
- **McCluster Corp** can be a campaign owner/funder/client without becoming the
  network identity.
- **Matthew McCluster** is a creator/rights holder and launch influencer whose
  music and content can seed campaigns.
- Other artists, organizations and clients use the same org boundary later.

## Source model

Music is a first-class source, not the boundary of clipping. A campaign source
may be music, an approved Action Network post/action, or campaign media.
`supabase/pending/equity_uprise_clipping_sources.sql` (not yet applied in production) adds `source_kind`,
`source_content_id`, `destination_url`, operator branding and attribution /
collaboration fields without replacing the proven claims, metrics, earnings or
payout ledgers.

For Action Network content, `clip_campaign_create_from_action` creates a clip
mission from a source content item owned by the campaign org. The clipper's
unique tracking code is attached to the campaign destination.

## Distribution loop

Do → document → approve source → fund clipping campaign → clippers claim →
publish externally → server verifies post/metrics → traffic returns through
the clipper link → conversions/actions are attributed → earnings settle.

Successful action footage can become source material for another campaign. That
makes the social network an insiders' distribution club: people doing the work
generate authentic content, and people specializing in distribution amplify it.

## Attribution and collaborations

Campaigns distinguish:
- `required_tags`: caption tokens that the current platform verifier can check;
- `attribution_handles`: accounts that should receive visible credit;
- `collaborator_handles`: accounts the clipper is instructed to invite;
- `collaboration_mode`: none, request, or required review.

The current Instagram Graph read path does not prove that a Collab invite was
accepted. The product must not label collaboration as platform-verified until
the provider integration exposes that proof. `required_review` means creator
review is responsible for confirming that requirement.

## Launch gate

The economic core is suitable for a controlled pilot, but broad recruitment is
still gated on self-serve social connection. Instagram currently needs the desk
to attach a credential; TikTok/YouTube verification, card-funded escrow and
automatic payouts remain staged. Do not market those capabilities as live.
