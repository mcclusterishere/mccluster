# Helix — procedural DNA music interface (prototype)

## Scope
A deliberately isolated, iPhone-first WebGL prototype at `helix.html`, linked from `listen.html`. It does **not** replace the production discovery room, creator studio, native app, rights controls, or the persistent music transport.

## Data / UI contract
- One published album in `data/albums.json` → one vial and one mathematical double helix.
- One actual published album track → one selectable crossbar (rung) with a deterministic visual signature.
- Swipe horizontally → change vials/albums; tap the selected vial → zoom into the strand.
- Swipe vertically → select the next/previous track; tap the crossbar → enter the song and play via `MCC_MUSIC.play(albumSlug, trackTitle)`.
- In song view, tap the active crossbar to pause/resume. Horizontal dragging on that crossbar seeks unrestricted audio. The existing gated stream policy controls access and gated tracks are deliberately non-seekable in this view.
- `Escape` goes back; keyboard on the canvas uses arrows and Enter. An HTML album/track control list remains available to screen readers.
- Lyrics are loaded only from the track's existing `data/lyrics/*.json` reference. Untimed `plain` lyrics are displayed as untimed text; no fake karaoke synchronization is inferred.
- Album cover art and existing track metadata remain the authority. This view does not invent unpublished album releases or rename tracks.

## Rendering
- `js/helix/math.mjs`: pure parametric opposing helices with clean spacing, a stable track-to-rung map and gesture logic.
- `js/helix/scene.mjs`: local vendored Three.js + TubeGeometry, CylinderGeometry, basic materials and raycast hit targets. Procedural cap, glass vial and inner strand generated in the browser. No static 3D asset required.
- `js/helix/main.mjs`: fetch canonical catalog, navigate camera modes, trigger canonical transport, load real lyrics, handle iOS gestures and fallback.
- `css/helix.css`: independent full-screen dark canvas, safe-area aware, readable native DOM typography.
- Draw capped at roughly 45 frames/s and device pixel ratio capped at 1.5; reduced-motion preference disables flourish. The scene is paused when hidden.

## Waveform honesty
V1 crossbar micro-waveforms come from a deterministic procedural visual pattern tied to the track's identity. They are **not** claimed to be sampled audio peaks. The live seek/progress bead is driven by the actual `MCC_MUSIC.audio.currentTime`. We intentionally do **not** reroute the shared player through Web Audio: cross-origin entitlement-gated audio can be silenced by a new MediaElementAudioSourceNode without correct CORS. A future publish-time audio-peak manifest can replace the visual patterns with real measured waveforms, without changing the 3D structure. True synchronized lyrics require timestamp data.

## Security and compatibility
The existing `js/music-engine.js` owns playback state, previews, signed URLs, media session and audit/telemetry. Helix neither signs nor caches private masters. Renderer failure offers a link back to Music; loading problems do not grant extra access.

## Pre-release checks
1. `node --test scripts/test/helix-interface.test.mjs`.
2. Load `helix.html` in desktop Chrome, Firefox, Safari and iPhone Safari; confirm no console errors, Three.js module resolves and catalog fetch succeeds.
3. Test tap, horizontal swipes, vertical swipes, raycast on every rung and switch from vial to album/song and back.
4. Test public playback, previews, gated/entitled playback, no unintended seek bypass and lock-screen media session.
5. Inspect WebGL frame rate, memory and touch hit areas on a physical iPhone; ensure fallback when GPU is disabled.
6. Confirm lyrics match the selected song and no fictitious synchronized timestamps are shown.
7. Review before enabling this as the default Music surface. No auto merge or automatic migration.

## Non-goals in this first PR
No unannounced production replacement, no fabricated waveforms or lyrics, no procedural album artwork, no camera/microphone permissions, no on-chain genome or biometric DNA reading.
