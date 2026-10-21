# Artist pages on McCluster Music

Any artist with an M Account gets a front page like the house album's: their
name across the top over their own photo, their rate sheet with Book buttons,
the featured record with Play and its tracklist, the rest of their albums on a
shelf, and their singles.

- **Public page:** `music-creator.html?handle=<handle>`
  (`js/music-creator-profile.js`, `css/music-artist.css`).
- **Where the artist builds it:** Creator Studio, `creator.html`
  (`js/music-creator-studio.js`).
- **Rules shared by both (albums and rate sheet):** `js/music-creator-page.js`.

These pages belong to McCluster Music, McCluster Corp's product, hosted on
`matthew.mccluster.org` for compatibility (`data/seo/domain-architecture.json`).
The page carries the artist's identity, never Matthew's. The house M appears
only in the McCluster Music header, never as an artist's photo or artwork.

## Onboarding an artist

1. **The artist signs in** at `account.html`. A new account already has an M
   identity (`m_auth_user_links`).
2. **The artist saves their creator profile** in Creator Studio: handle, artist
   name, bio, website, colours, profile photo and front-page photo. They accept
   the Creator Terms themselves, because the acceptance and the rights warranty
   are theirs to give, so nobody creates a profile on an artist's behalf.
   Uploads need a saved profile.
3. **The artist uploads tracks.** Each track needs a master, a preview when it
   isn't public, artwork and the rights declaration. A track can go straight
   into an album.
4. **The artist sets a rate sheet** under *Your rate sheet*: what they sell,
   the price, whether it is charged per song, per hour or as a flat fee, and
   an optional royalty share. An example rate sheet:
   - Feature on a song: $50 per song.
   - Performance: $200 per hour.
   - Writing a song: $150 + 15% royalty.
5. **The artist arranges albums** under *Your albums*: title, type, release
   date, cover, description, tracklist order, and which album to feature.
6. **The owner reviews each track** in `music-admin.html` and publishes it.
   Until then it stays off the public page. An album appears on the page once
   at least one of its tracks is published, and shows only its published tracks.

## Booking requests: a request first, never a charge

Each rate has a **Book** button. The buyer gives a name, an email, the number
of songs or hours, an optional date and a message, and sees an estimate. The
request is sent through `js/crm.js` to `public.leads`, the same bounded
anonymous door every site form uses. It is filed under the campaign
`artist-booking:<handle>`, so it appears in **Control → Operations →
Bookings**. Its note names the artist, the service, the rate, the estimate,
the date and the message.

The page takes **no payment**. The desk confirms with the artist and then
sends the buyer a payment link. Once the artist has a payout route (their own
Stripe through Connect, or McCluster Music collecting and paying out), the
Book button can become a checkout. That decision and its deploy come first.

## How the rate sheet is stored

The rate sheet is `music_creator_profiles.settings.services`, written by the
artist in Creator Studio. Each rate has:

- an id (`svc_…`)
- a title
- a price in whole cents, from $1 to $100,000
- a unit: song, hour or flat
- a royalty share from 0 to 100% in steps of 0.5
- a description

A sheet holds at most 12 rates. Text is bounded and escaped.

## How albums are stored

Albums live in `music_creator_profiles.settings.albums`. The artist's own RLS
policy lets them write it, and the public can read it for an active profile, so
albums need no migration. Each album has:

- an id (`alb_…`)
- a title
- a kind: album, EP, mixtape or single
- a release date
- a description
- a cover image
- an ordered list of track ids

`settings.featured_album` names the album shown first.

Strangers read what the artist writes, so `js/music-creator-page.js` bounds
every field:

- 24 albums and 60 tracks per album at most.
- Images are accepted only from this project's public `creator-artwork` bucket.
- Website links must be https, with no credentials.
- Colours must be hex.
- Text is escaped when rendered.

Creator Studio reads the current settings before every album write, so two open
tabs don't undo each other.

Tracks stay ordinary `creator_tracks` rows, and publishing them is still the
operator's review. If albums ever need their own rights, sales or analytics, they
should become a table; until then this keeps the artist's work in one place
with no new infrastructure.

## Checking it

- `node --test scripts/test/music-creator-page.test.mjs` covers the album
  and rate-sheet rules, safe images and links, published-only rendering, the
  booking note, the page contracts and the studio's save path.
- `node --test scripts/test/music-platform.test.mjs` covers the creator
  platform it builds on.
- Render `music-creator.html?handle=<handle>` at 390px and check that
  `scrollWidth === clientWidth`. An artist with nothing published sees their
  name and "No published releases yet."
