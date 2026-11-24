# Music continues into World

Owner correction, October 17, 2026: a listener starts a track in Music, taps the
shared Globe button, and keeps hearing that same track while using World. An
explicit pause or mute remains in force. With no selected track, the World
gesture starts the existing **Heal the 3rd World** theme.

## The live document stays alive

`js/world-audio-continuity.js`, loaded by the existing `js/tabbar.js`, retains the
Music document and its actual `HTMLAudioElement`. It opens the real World
document from `https://mccluster.org/` in a frame. The World host keeps its own
origin, canonical metadata and M Account session. It is not copied into the
personal property's DOM, and no product identity or host routing changes.

On the platform the frame is same-origin: the platform serves Music too (stage P1
of the one-platform plan, `docs/control-plane/DOMAINS-AND-ENTITIES.md`), and a link
inside the World frame to a page served at another address of the same origin opens at
the top (`leavesWorld`), the way a cross-origin link always did. On Matthew's host the
frame is cross-origin, as it was everywhere before P1. The World's origin comes from
`window.MCC_SITE`, the generated block at the top of `js/shell-boot.js` (this file left
`scripts/test/site-hosts-pending/engine.json` with P1); the bridge keeps its exact
origin, window and nonce checks either way. The transport's title, tapped with the World
closed, goes to Music on the host it stands on: on Matthew's host his own Listen until P3
(`musicHome`), as the bar's Music tab does, since the platform's would be a page load that
ends the song (the P1 amendment of 2026-11-24).

The parent's address adds `world=1` to the existing Music URL and its history
state records the clean World destination. Browser Back/Forward changes the
visible surface without replacing the Music document. The source, buffered
audio, position, media session and existing playback restrictions stay with the
original engine or album deck.

The listening document owns one bottom bar and a compact title, Play/Pause and
Mute control. World retains its native top-right account controls. Its duplicate
bar is hidden and made inert only after a validated parent handshake. The deeper
Cesium frame keeps its existing embedded navigation opt-out.

The parent measures its actual bar and music controls. The frame receives a
bounded clearance, stores it in `--mcc-world-audio-clear` and `--mn-bar-clear`,
and emits `resize` and `mcc:world-audio-layout`. The small integration in
`js/mnet.js`'s `barClearance()` preserves this parent measurement when the local
World bar is hidden. Travel uses that space for scrolling and expanded-map
controls.

## Navigation and lifecycle

| Action | Result |
| --- | --- |
| Music or album → Globe | Open the canonical World in the retained listening document; leave the selected audio unchanged. |
| Globe with a selected paused or muted track | Keep that selection and its pause/mute state; do not substitute the theme. |
| Globe with no selection | Play the prepared public theme from the owning document's gesture. |
| Global Music home while World is retained | Reveal the original listening surface and preserve its audio. |
| Browser Back/Forward | Reveal Music or the retained World frame without reconstructing the player. |
| Explicit album, artist or Control link in World | Preserve the exact destination and existing sign-in handoff; navigate the top document rather than starting a second player inside the frame. |
| Music selected while the theme is playing | Pause the theme before the selected source starts. |
| Audible video/audio started in World | Pause the retained parent music. Returning to Music does not silently restart it. |
| World hidden on return to Music | Pause child media and dispatch `mcc:world-audio-visibility` with `visible:false`. Travel stops foreground GPS/request work and keeps its route/draft; Go is required to resume navigation. |
| World reopened | Dispatch `visible:true`; preserve the draft and chosen music without automatically restarting GPS. |
| World fails to load or complete its handshake | Keep Music available and show Back to Music / Open World directly recovery controls. |

The shared bar also preserves Music when Globe is tapped before the continuity
script finishes loading. It queues that World destination and shows a small
Opening World status. Choosing another destination or Stay in Music cancels the
queued opening. If the script fails, Retry loads it again while the original
player remains available. Once the helper is ready, ordinary Globe taps keep
the synchronous gesture path described below.

Attachment and readiness exchange the parent's current visibility, including
when World was closed before it finished loading. The child stores the validated
state in `body.dataset.worldAudioVisible`; Travel reads that state when it
initializes, so a lifecycle event delivered before its listener cannot restart
location work in a hidden frame.

A full browser refresh, a deliberate navigation to another document, closing
the tab or an operating-system eviction still ends the old document. The
retention guarantee covers the Music ↔ World surface switch and, since music
slice M5, the switches between the supported music pages (next section). It does
not claim uninterrupted audio after the browser destroys the player. The older
pocket widget remains timestamp recovery for other pages; it defers on discovery
pages that already own `MCC_MUSIC`, and never mounts in a music view, to prevent
a second player.

## One player across music pages (music slice M5)

Since music slice M5 (`docs/music/MUSIC-RELEASE-20261119.md`, "M5: one player
across music pages"; on the branch only, because D-5 is Matthew's decision) the
same pattern holds between music pages. `js/music-shell.js`, loaded by
`js/tabbar.js` beside this module, keeps the first music page a tab opens
(Listen, an artist page) as the retained document and opens the other music
pages over it as views, each in a fresh same-origin frame, one at a time. Release
2 ships M5 with the album contained (`docs/control-plane/handoff-20261123/specs/SPEC-ENGINE.md`,
4.10; the record's "Engine stage 0"): the album is never retained and never a
view, so it is a page of its own with its deck as its one player, and the World
opens over it as over any other page. How the World relates to that:

| Action | Result |
| --- | --- |
| Globe in a music view | The World opens from the retained document, over the view; the same element keeps playing. The address is the view's with `world=1`, the title the World's. |
| Back from that World | The World closes onto the view, at the view's address and with the view's title (this module restores the title shown when the World opened, not the page's first title). |
| Back again | The view closes onto the retained page, whose own title, description, canonical, JSON-LD and `og:` tags come back byte for byte. |
| This module inside a view | Does nothing: no theme, no watchers, no greeting (a view is not the World frame). The World always opens from the retained document. |
| A link to the World inside a view | Takes the same path as the bar's Globe. |
| The album (contained in Release 2) | Never retained, so no view opens over it and no engine is loaded beside its deck: the deck is the one player on the album, and the World's transport acts on it. Stage 1 of the engine makes the album a page of the one engine. |

Links from the World to an artist page or the album still navigate the top
document, as in the table above: a page load, as before.

## Theme, gesture and preferences

The theme uses the existing public catalog source
`assets/audio/heal-the-3rd-world.m4a` from `data/albums.json`. Its URL is prepared
before the gesture, and it is not an entitled or signed master. Since music slice M3
nothing of it is read before it is needed: on a Music page the theme fetches no audio
until the Globe tap, and the standalone World reads only the song it drew.
The theme loops until the listener pauses it or chooses another track.

The parent's Globe click calls `play()` directly in that document. Standalone
World calls its own prepared audio from its first trusted pointer or keyboard
gesture. A touch in the same-origin Cesium frame reaches that World function
synchronously. The cross-origin message bridge never tries to transfer media
activation or start audio. If the browser refuses playback, the visible control
holds the track for an explicit Play.

Theme pause and mute choices are local preferences. Changing the selected track
does not defeat an explicit mute. A paused selection or exhausted guest preview
does not trigger theme playback behind the listener's decision.

This follows the browser constraint that autoplay is decided for the actual
media element and owning document. WebKit's policy guidance is documented in
[Auto-Play Policy Changes](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)
and [New Video Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/).
The frame delegates geolocation, autoplay, fullscreen, camera and microphone
capabilities; the browser still controls the actual permission grants. See
[Permissions Policy](https://www.w3.org/TR/permissions-policy/).

## Existing access gates stay authoritative

The original engine and album deck enforce their existing preview and earned
play rules. World changes their presentation, not their source authorization.
In particular, the gated guest preview remains four seconds.

The shared engine's `resumeCurrent()` reuses its existing house/creator access
resolver when a grant is spent or a source is unavailable. During `loading`,
Play cannot run an old source that remains in the audio element. The new World
control shows Opening music and disables repeated Play while access resolves.
Request generations prevent a late result for a previous selection from
replacing the current selection's source. The existing engine mini player and
media-session Play handler use the same guarded resume operation.

## Bridge and account boundaries

The `mcc-world-audio-v1` bridge checks the exact frame/parent window, the expected
canonical origin and a per-frame nonce. Its messages carry readiness, bounded
layout, visibility and pause/return instructions. They carry no access token,
refresh token, signed media URL, GPS coordinate or account record.

Opening World reuses `tabbar.js`'s `handoffHref()` and the existing
`POST /v1/auth/handoff` exchange. World earns its own origin-bound session and
scrubs the fragment. Its reload never reloads the retained parent audio. Other
exact-destination links use that same handoff and normal top-level navigation;
their credentials are not routed through the generic message bridge.

Current World responses permit the canonical embedding. A future framing-policy
change needs to preserve this relationship or use the visible direct-open
recovery path. The restrictive policy on the separate `/company` document does
not control the World root.

## Verification and limits

Run `scripts/e2e/music-world-continuity.e2e.mjs` with the repository's existing
Playwright/Chromium runtime variables. It uses actual Music, album and World
documents, real `HTMLAudioElement` playback of synthetic WAV bytes, and fully
intercepted network responses. No production account, API or audio is contacted.

The suite checks element identity, advancing time, absence of pause/seek/source
reset, single playback ownership, phone/desktop fit, measured parent clearance,
pause/mute, Back/Forward, separate-session handoff, preview limits, spent-grant
reacquisition, repeated Play during loading, unavailable-source recovery,
first-gesture theme playback and exact artist destinations. The actual globe
script's graceful renderer-unavailable path is used here; renderer fidelity,
GPS permissions and route geometry have separate World/Travel suites.

Since music slice M1 (`docs/music/MUSIC-RELEASE-20261119.md`) the suite also
plays the listen page and the album with default motion, where the album room's
light is on, and after the Globe tap suspends every `AudioContext` the page made,
as iOS does in the background: the same element must keep advancing. The earlier
runs used reduced motion only, where the room never wired its light, so they could
not see the album go quiet.

The delayed-script regression holds the parent helper request while actual
audio plays, taps Globe, and checks that the same element keeps advancing before
and after the helper arrives. It also covers load failure, visible phone-sized
retry controls, successful retry and cancellation before late readiness.

These browser checks run in Chromium. The owning-document design avoids the
known iOS gesture-transfer mistake, but these results do not claim a physical
iPhone/Safari or background operating-system endurance test.
