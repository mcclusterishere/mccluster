# Artist pages on McCluster Music

Any artist with an M Account gets a front page like the house album's: their
name across the top over their own photo, the featured record with Play and its
tracklist, the rest of their albums on a shelf, and their singles.

- **Public page:** `music-creator.html?handle=<handle>`
  (`js/music-creator-profile.js`, `css/music-artist.css`).
- **Where the artist builds it:** Creator Studio, `creator.html`
  (`js/music-creator-studio.js`).
- **Album rules shared by both:** `js/music-creator-albums.js`.

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
4. **The artist arranges albums** under *Your albums*: title, type, release
   date, cover, description, tracklist order, and which album to feature.
5. **The owner reviews each track** in `music-admin.html` and publishes it.
   Until then it stays off the public page. An album appears on the page once
   at least one of its tracks is published, and shows only its published tracks.

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

Strangers read what the artist writes, so `js/music-creator-albums.js` bounds
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

- `node --test scripts/test/music-creator-albums.test.mjs` covers the album
  rules, safe images and links, published-only rendering, the page contracts
  and the studio's save path.
- `node --test scripts/test/music-platform.test.mjs` covers the creator
  platform it builds on.
- Render `music-creator.html?handle=<handle>` at 390px and check that
  `scrollWidth === clientWidth`. An artist with nothing published sees their
  name and "No published releases yet."
