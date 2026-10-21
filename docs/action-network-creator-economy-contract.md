# Action Network creator economy — implementation contract (October 2026)

## Pilot budget (per hand-selected Super Creator)
- $100 monthly creator allocation; contractual treatment must explicitly state whether this is creator compensation or a shared campaign budget.
- $50 one-time recruitment incentive upon 50 **verified, distinct, qualifying active Superusers** within 30 days.
- Separate $50 fan incentive pool: at most 50 verified fans x $1 each. This is **not** the same $50 paid to the Super Creator.
- No payout before sponsor funding, payment verification, fraud review and payment eligibility.
- Keep clipping bounties, fan rewards, creator compensation and digital gift proceeds in separate ledgers. No cross-subsidy assumptions.

## Qualification policy v1 (proposed; not yet live)
A Superuser is a real, signed-in member who has a verified, settled, non-refunded, non-disputed eligible purchase on the platform (including an eligible creator gift), and whose account is in good standing. The qualification event is server-derived from verified payment-provider events, never a browser event. The member qualifies at most once for the sponsor's 30-day campaign, even after multiple purchases. A purchase by the sponsor or related accounts does not qualify. Risky/refunded/disputed payments are held/revoked. Mere signup, page views, free points and unpaid orders do not qualify. Add clear age, identity, privacy and payout requirements before money movement. Avoid incentivizing self-purchases or cycling gifts to farm rewards.

## Roles
- Fan: free discovery, optionally pays for creator membership or sends gifts.
- Clipper: accepts eligible funded missions; may participate without purchasing.
- Cohort Creator: approved badge, submits portfolio, participates in peer preferences and assigned productions.
- Verified Super Creator: hand-selected by administrator, manages an approved cohort and issues funded clipping campaigns, rates submitted portfolio media and records team decisions.
- Platform Admin: appoints/revokes Super Creators, controls funding/financial approval, views audit trail.
- Buying creator services, subscriptions or managed program access **never** grants verification.

## Team decision matrix
Record creator evidence and role-specific peer preferences independently. Super Creator sees aggregated peer preferences, portfolio evidence, media ratings, and an auditable explanation for each selected/waitlisted/declined team member. If overriding the peer signal, require an explicit reason; don't expose individual voters or sensitive applicant details to other candidates. Store score model version and evidence provenance. A rating is a subjective signal, not an objective talent truth. Three-day baseline and 30-day Super Creator goals must be normalized for time, resources and audience size; use 10x as a target multiplier only after validating comparable metrics.

## LIVE and gifting research
BIGO's published help describes viewer-purchased Diamonds, animated gifts and creator Beans; TikTok's 2026 US virtual items policy distinguishes purchased Coins, Gifts and creator popularity Diamonds. These are **product patterns, not authorization to issue a redeemable currency**.
Sources:
- https://www.bigo.tv/blog/bigo-live-virtual-gifts
- https://www.bigo.tv/blog/earn-money-from-bigo
- https://t.tiktok.com/legal/page/us/virtual-items/en

### Product sequencing
1. Discovery feed: following, music, posts, LIVE status and recommendations.
2. LIVE room: creator, panel participants, audio/video moderation, creator-defined clipping permissions, chat and fan membership entitlements.
3. Gift catalog: initially use direct fiat-priced gifts processed through Stripe, with transparent settlement to creators. Do not implement tradable tokens or withdrawable user balances without legal/payment review.
4. Qualified Superuser derived from settled verified purchases; rewards use capped, idempotent, fraud-reviewed ledger.
5. Campaign attribution: unique clipper assignment links, submission IDs, server-side conversion events, bounded retention and privacy-safe aggregate reporting.
6. Only then consider an internal nontransferable virtual gift currency, after refund, chargeback, escheatment, age, money-transmission and payment-processor reviews.

## Implementation status / gates
- Staged: creator_team_decision_matrix migration and creator_super_verification_rewards migration.
- UI scaffold: creator-selection-desk.html (requires real authenticated API).
- NOT IMPLEMENTED: authenticated API handlers, admin appointment workflow, payment webhook qualifications, gift checkout, streaming infrastructure, live discovery, reward settlement, production migration and rollout.
- Campaign authorization refactor required: existing clip_campaign_create requires org ownership, while staged trigger requires verified Super Creator. Must support explicit platform-admin authorization and properly scoped delegated creators; do not deploy until all paths are tested.
- Before deployment test: ordinary creator denied create; purchaser denied create; admin allowed; approved Super Creator allowed only scoped campaigns; revoked denied; forged reviewer denied; cross-cohort peer votes denied; refunded gift denied qualification; 51st reward denied; concurrent rewards capped; replay events idempotent; self-referrals denied; anonymous reads private by default.
