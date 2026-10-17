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

Attachment and readiness exchange the parent's current visibility, including
when World was closed before it finished loading. The child stores the validated
state in `body.dataset.worldAudioVisible`; Travel reads that state when it
initializes, so a lifecycle event delivered before its listener cannot restart
location work in a hidden frame.

A full browser refresh, a deliberate navigation to another document, closing
the tab or an operating-system eviction still ends the old document. The
retention guarantee covers the Music ↔ World surface switch. It does not claim
uninterrupted audio after the browser destroys the player. The older pocket
widget remains timestamp recovery for other pages; it defers on discovery pages
that already own `MCC_MUSIC` to prevent a second player.

## Theme, gesture and preferences

The theme uses the existing public catalog source
`assets/audio/heal-the-3rd-world.m4a` from `data/albums.json`. Its URL and metadata
are prepared before the gesture, and it is not an entitled or signed master.
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

These browser checks run in Chromium. The owning-document design avoids the
known iOS gesture-transfer mistake, but these results do not claim a physical
iPhone/Safari or background operating-system endurance test.
