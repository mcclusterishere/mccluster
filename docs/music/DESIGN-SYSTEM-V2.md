# McCluster Music — Design System V2

## Product rule

**The canonical design is mobile portrait, dark themed, and patterned after Apple Music iOS interaction hierarchy.**
Tablet and desktop are progressive enhancements of that mobile product — never a separate layout.

Music is one product, not a collection of pages.

A listener should be able to discover a song, start it in-place, expand the same transport into Now Playing, inspect the album or creator only when they want context, and return without learning another visual grammar.

Creators and operators use the same product language. Creator Studio is the supply side of the listening ecosystem, not a separate admin application.

## Reference set

The implementation borrows interaction patterns, not branding or copied layouts.

- Apple Music mobile Home / Listen Now hierarchy:
  - https://mobbin.com/screens/7ccff33b-4781-4c1e-b59c-1203a375fa53
  - https://mobbin.com/screens/3d34a415-571a-48ec-a251-794b75407811
- Apple Music mobile album detail:
  - https://mobbin.com/screens/ada55025-0884-4299-a437-35b6bd0c88ee
  - https://mobbin.com/screens/3a938b4d-3b4e-43b7-8de3-cb039a924e31
- Apple Music mobile Library:
  - https://mobbin.com/screens/672b3bbf-3cb5-4d8e-abd2-b93b32e86644
  - https://mobbin.com/screens/4c0a18e6-4107-42a6-94fd-4e957568bb69
- Apple Music Now Playing:
  - https://mobbin.com/screens/d06ea6fd-89e9-429f-9b76-322ad2b1c7fc
  - https://mobbin.com/screens/88e450cf-e1b1-4d62-a4ce-af2988757434
- Apple Music mobile artist-profile hierarchy:
  - https://mobbin.com/screens/9641ddc6-837c-44f6-a238-e68c527fc100
  - https://mobbin.com/screens/282b1a86-c724-4251-88fc-6b2504a565b1
- Creator/dashboard references:
  - https://mobbin.com/screens/76450d57-82ae-44a3-8d4c-bcc36bcd74fc
  - https://mobbin.com/screens/3e10a84e-3aeb-4127-9194-30f5b0b20534

## Design decisions

### 1. Content first
Album art and track names carry the hierarchy. Decorative chrome is quiet. Rails use square cover art with metadata beneath it instead of text laid over blurred photography.

### 2. One transport
`js/music-engine.js` owns the discovery transport:
- inline play from cards and rows;
- compact persistent player;
- expandable full-screen Now Playing;
- previous / next;
- seek;
- Media Session controls;
- account-aware preview/full access;
- creator tracks and McCluster catalogue tracks in the same queue.

Album detail may retain richer film/lyrics behavior, but it is a detail experience rather than the only place playback can happen.

### 3. Progressive disclosure
Discovery answers “what should I hear?”
Now Playing answers “what is playing?”
Album / creator pages answer “what is this?”
Creator Studio answers “how do I publish?”
Review Desk answers “may this go live?”

Those jobs are not mixed into one screen.

### 4. One shell
All music surfaces use:
- `music-v2` body class;
- `css/music-system-v2.css`;
- `.music-contextbar` navigation;
- shared color, spacing, radius, typography, button and surface rules.

### 5. McCluster identity, not an Apple/Spotify clone
The interaction model is familiar, while the visual identity stays McCluster:
- near-black ink field;
- ruby accent;
- M mark;
- existing app-wide bottom navigation;
- creator commerce and M Account access rules.

## Surfaces

- `listen.html` — primary discovery/home surface.
- `album.html` — album detail / richer record world.
- `catalogue.html` — registered library/reference.
- `music-creator.html` — public artist/creator profile.
- `creator.html` — Creator Studio.
- `music-creator-terms.html` — licensing/hosting terms.
- `music-admin.html` — operator review desk.

## Non-negotiable behavior

- Play never requires navigation from discovery.
- Signed-in account-gated listeners never fall back to the public preview.
- Public preview and private master remain one logical track.
- Private masters remain private storage objects.
- Creator publication and licensing remain governed by the existing rights/review path.
- No second auth system, second music backend, or second player engine.


## Mobile-first implementation law

The base CSS in `css/music-system-v2.css` targets phone portrait first.

- Default shell: `calc(100vw - 24px)`.
- Default creator layout: one column.
- Default discovery rails: horizontal touch shelves sized from viewport width.
- Default mini player: fixed immediately above the existing app tab bar.
- Default Now Playing: full-screen.
- Default music palette: dark, regardless of the wider site's light/dark preference.
- Larger layouts are introduced only with `@media(min-width: ...)`.

A future change that defines a desktop grid as the default and then collapses it with `max-width` media queries violates this design contract.
