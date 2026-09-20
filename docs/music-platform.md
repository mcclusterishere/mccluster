# McCluster Music platform

McCluster Music is part of the existing McCluster platform. It does not create a second identity system, social graph, analytics stack, or commerce database.

## Listener model

The listening room is the discovery surface. Play controls on discovery cards and rows start audio in place through `js/music-engine.js`; opening an album or creator profile is optional.

The persistent mini transport owns page playback and Media Session metadata.

A track has an access mode:

- `public` — the public audio can play in full without an account.
- `account` — signed-out listeners receive the configured preview; a signed-in M Account receives a temporary URL to the private master.
- `purchase` — signed-out and unentitled listeners receive the preview; a user with a live music entitlement receives a temporary URL to the private master.

The owned gated single in `data/albums.json` uses the same rule. Its public preview is only a signed-out representation of the same logical track. The private MP3 and ringtone live in `mcc-gated-audio`.

## Creator identity

A creator signs in with an ordinary M Account. `music_creator_profiles.m_uid` ties the creator extension to the existing M identity and Mnet graph. There is no creator-specific password database.

`creator.html` is the creator studio. It creates the creator profile, requests signed upload grants, uploads public preview/artwork and a private master, records a rights attestation, and submits the release for review.

Creators cannot self-publish or self-clear rights. Creator writes can move a release only into draft/review states. The operator review surface uses the existing McCluster `ops.use` authority.

## Assets

- `creator-previews`: public
- `creator-artwork`: public
- `creator-masters`: private
- `mcc-gated-audio`: private owner catalogue assets

Private masters are streamed through one-hour signed URLs created by the authenticated `music-access` function.

## Rights and derivative works

Each creator release records master, composition, sample and collaborator attestations. Parody, remix, cover, sample and other derivative flags are explicit fields and do not self-clear a release.

`music-creator-terms.html` supplies the V1 hosting/licensing grant. It keeps creator ownership with the creator while granting McCluster the limited rights required to host, stream, promote, transact and deliver authorized licenses. Broad commercial use should receive legal review.

## Commerce

`music_license_offers` defines the creator's offer. V1 checkout is non-exclusive and only activates after the track is published and rights-cleared.

`music-checkout` creates Stripe Checkout and writes a `music_orders` record. Price, platform fee and creator net are recorded separately. The Stripe webhook creates a `music_entitlements` row after confirmed payment and revokes that entitlement after a refund.

Exclusive rights remain outside click-through checkout and require a separately executed agreement.

## Analytics

The existing operator analytics API now covers:

- user growth and active users;
- first-party platform events, page views, clicks and acquisitions;
- Mnet profiles, posts, follows and reactions;
- historical album plays plus unified player plays;
- preview plays, full plays and completions;
- creator profiles and creator releases;
- active license offers, paid orders and entitlements;
- gross music revenue, platform fee and creator net.

The natural-language operator route remains bounded to this fixed metric catalog; it does not generate arbitrary SQL.
