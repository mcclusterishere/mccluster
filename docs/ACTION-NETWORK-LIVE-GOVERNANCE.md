# Action Network Live Governance

Status: canonical v1  
Applies to: Uprise Action Network live discovery, persistent rooms, host access and live mission attribution.

## Product purpose

Live exists to let people see useful work, creative work and organized action while it is happening, participate in it, and support approved hosts doing it. It is not a generic entitlement attached to follower count, fellowship status, attractiveness, outrage, time spent online or money raised.

Posting remains available, but Live is the primary discovery surface. Posts, clips and verified-action receipts are downstream records of work; they do not define who may broadcast.

## Host access is a capability, not a public role

There are no public tiers such as "expert", "artist", "VIP", "challenger" or "mission participant".

A person may host only when the owner desk has issued an active `network_live_host_grants` capability with one of three bases:

- `cohort`: the person actually holds a seat in an active Action Network cohort.
- `client_project`: the person's M identity resolves to a member of the specified McCluster client organization/project.
- `staff`: explicit staff/operator authorization.

The McCluster owner desk may host by administrative authority. Accepted fellowship alone is not live-host authorization.

A grant names its allowed categories, maximum modeled stage seats, start/end window and whether creator support is allowed. v1 creator support remains off.

The desk can revoke a grant. A revoked or expired grant no longer authorizes a new broadcast.

## Room types

There are exactly two room types in v1:

### Home room

A persistent creator/program room for recurring work: making music, building, teaching, research, interviews or other approved work.

### Mission room

A persistent room attached to one open Action Network mission. A Mission room cannot start a broadcast if its mission is closed, expired or not yet open.

Every broadcast snapshots its room type, category, mission, song, cohort and seat limit so historical attribution does not change if the persistent room is edited later.

## Discovery categories

The v1 taxonomy is intentionally small:

1. **Music** — perform, write, produce, rehearse or listen together.
2. **Build** — make, design, code, repair or prototype.
3. **Learn** — teach, study, research or explain useful material.
4. **Field** — do verifiable community or mission work in the real world.
5. **Forum** — interview, brief, discuss or debate around a defined subject.

A host can broadcast only in categories included in their active grant.

## Stage roles

The stage vocabulary is deliberately limited:

- **Host** — implicit in the live session; exactly one primary host.
- **Cohost** — an approved additional stage participant.
- **Guest** — an approved temporary stage participant.
- **Audience** — not a role and receives no elevated capability.

The database models cohost/guest stage membership now. Current v1 video transport remains single-host Cloudflare Stream WHIP/WHEP. Multi-seat video is not presented as active until a real multi-party transport is connected and tested.

## First-class music

A song is a canonical discovery object, not caption text. `music_catalog_objects` gives the current catalogue stable IDs and links each song to album, artist, artwork, audio/catalogue path and canonical listening URL.

A live session may attach one song. Discovery and the live viewer can therefore show “Now playing,” open the actual song, and later connect artist/song/live-room behavior without inventing a second rights catalogue.

`music_catalog_objects` is a discovery projection. It does not replace `creator_tracks`, album metadata, credits or rights authority.

## Mission attribution

A viewer who takes the mission directly from a live Mission room joins through `join_action_mission_live()`.

The assignment records `source_live_session_id` on first eligible touch. A later rejoin cannot steal the original source. When the proof is verified, the canonical server-minted action event preserves the live-session source alongside existing creator-content attribution.

The closed loop is:

`live room → mission join → proof → review → verified action`

## Discovery score

Money, Credits, gifts, tips, follower count and ideological viewpoint are not discovery inputs.

The v1 score uses a 95% Wilson lower confidence bound so tiny samples do not outrank rooms with stronger evidence merely because their raw percentage is 100%.

For a **Mission room**:

`score = WilsonLower95(verified actions, unique live viewers)`

For a **Home room**:

`score = WilsonLower95(viewers present for at least 60 seconds, unique live viewers)`

The UI may show understandable outcome counts such as viewers, 60-second viewers, joins and verified actions. It should not advertise a naked rank number that invites gaming.

Room-type-specific ranking is preferred. Do not compare Home retention and Mission verified-action conversion as though they were the same outcome.

## Audience privacy

`network_live_audience` is private operational presence data. The browser writes viewer heartbeat through the authenticated Worker; it never reads the table directly.

Public/live directory responses may expose aggregate counts only. Viewer identity lists are not a discovery feature.

## Creator support / Credits

Creator support is a separate economic system from:

- Action Network points,
- McCluster API credits,
- campaign/charitable money,
- client billing.

Do not reuse `api_credit_ledger` for creator support.

v1 stores the governance flags and room support purpose but leaves real-money purchase, transfer and cash-out disabled. Before activation, the product must define Stripe Connect account model, charge type, payout/liability ownership, KYC/tax handling, refunds/chargebacks, platform fees and state/country availability.

Support must fund the host/project purpose declared for the room. Support volume must not buy discovery rank.

## Adversarial defaults

- Client-supplied metadata cannot manufacture an official mission card or verified action.
- Host permission is checked server-side at broadcast start.
- Persistent room ownership is enforced even for the owner desk; moderation authority is not impersonation authority.
- WHIP publish URLs live only in host memory and are never persisted.
- Stale broadcasts disappear after heartbeat expiry and their Cloudflare input is deleted.
- The desk can end a live session independently of host access.
- Support stays off unless separately authorized.
- Keep categories, room types and stage roles small unless a concrete workflow proves another one is necessary.
