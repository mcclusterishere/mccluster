# Mnet Action Network v2

## Product rule

**Mnet is the Action Network.** There is one McCluster identity, one network, one social graph, one group system, one feed, and one messaging system.

Heal the 3rd World and future campaign gateways acquire and orient people. They do not send people into a second campaign social product. After joining, a participant enters the same Mnet used everywhere else in McCluster.

## Existing primitives we keep

- `m_people.id` / `m_uid`: durable person identity.
- `platform_profiles.mccluster_id`: public handle.
- `network_profiles`: member profile.
- `network_groups` + `network_group_members`: communities and roles.
- `network_posts`, reactions and activity: community conversation/activity.
- network conversations/messages: direct and group communication.
- `action_campaigns`: campaign program/content/funnel state.
- `action_participants`: campaign enrollment and acquisition attribution.

No Action-Network-specific profile, follow graph, feed, group-membership system or messaging namespace may be introduced.

## Experience

Acquisition:

`Instagram/Reel -> Heal the 3rd World -> campaign join -> McCluster identity -> Mnet`

Operation:

`Mnet community -> mission -> accept/assignment -> work -> evidence -> verification -> contribution history -> next mission`

Campaign source/Reel/referral attribution survives the transition so Control can distinguish attention from useful participation.

## Communities

Existing Mnet groups become Action Network communities. Campaigns may attach to one or more groups through `action_campaign_groups`; one can be primary.

Groups should grow toward announcements, pinned posts, events, missions, resources, member roles, moderation and live broadcasts. Those are extensions of Mnet, not a second application.

## Missions

`action_missions` is work attached to a campaign and optionally an Mnet group.

Assignment states:

`accepted -> in_progress -> submitted -> verified`

Exception states:

`declined`, `cancelled`, `needs_revision`

Verification is explicit. A click cannot manufacture a verified contribution.

## Contribution reputation

`action_contributions` is the auditable input for contribution/reputation views. Verified missions, research, organizing, recruiting, events, resources and field work may create contribution records. Posting volume, likes and screen time are not substitutes for verified work.

## Funding

Campaign 001's readiness target is $50,000. `money_enabled` remains false. Public donation UI/payment execution stays unavailable until the owner deliberately activates a lawful, working giving path.

## Control

Control should evolve from campaign editing into an operations desk covering:

- campaign funnel/source attribution;
- communities and membership;
- missions and staffing;
- submissions awaiting verification;
- verified impact/contributions;
- events/live operations;
- funding/ledger only when enabled.

## Mobile product direction

Mnet remains mobile-first. Campaign arrivals should be able to join, enter their community, find a mission, accept it, submit evidence and see status without desktop navigation.

The existing Feed / Discover / Groups / Messages / Alerts / Me information architecture can evolve, but organizing actions must become first-class rather than buried behind a separate Action Network surface.
