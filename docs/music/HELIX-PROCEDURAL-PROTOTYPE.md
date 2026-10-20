# Helix — procedural DNA music interface (prototype)

## Scope
A deliberately isolated iPhone-first WebGL lab at `_unfinished/helix/index.html`. There is NO public URL or listener entry point. It does **not** replace the production discovery room, creator studio, native app, rights controls, or the persistent music transport.

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
- `_unfinished/helix/math.mjs`: pure parametric opposing helices with clean spacing, a stable track-to-rung map and gesture logic.
- `_unfinished/helix/scene.mjs`: local vendored Three.js + TubeGeometry, CylinderGeometry, basic materials and raycast hit targets. Procedural cap, glass vial and inner strand generated in the browser. No static 3D asset required.
- `_unfinished/helix/main.mjs`: fetch canonical catalog, navigate camera modes, trigger canonical transport, load real lyrics, handle iOS gestures and fallback.
- `_unfinished/helix/helix.css`: independent full-screen dark canvas, safe-area aware, readable native DOM typography.
- Draw capped at roughly 45 frames/s and device pixel ratio capped at 1.5; reduced-motion preference disables flourish. The scene is paused when hidden.

## Waveform honesty
V1 crossbar micro-waveforms come from a deterministic procedural visual pattern tied to the track's identity. They are **not** claimed to be sampled audio peaks. The live seek/progress bead is driven by the actual `MCC_MUSIC.audio.currentTime`. We intentionally do **not** reroute the shared player through Web Audio: cross-origin entitlement-gated audio can be silenced by a new MediaElementAudioSourceNode without correct CORS. A future publish-time audio-peak manifest can replace the visual patterns with real measured waveforms, without changing the 3D structure. True synchronized lyrics require timestamp data.

## Security and compatibility
The existing `js/music-engine.js` owns playback state, previews, signed URLs, media session and audit/telemetry. Helix neither signs nor caches private masters. Renderer failure offers a link back to Music; loading problems do not grant extra access.

## Pre-release checks
1. `node --test scripts/test/helix-interface.test.mjs`.
2. Load the development-only `_unfinished/helix/index.html` in desktop Chrome, Firefox, Safari and iPhone Safari; confirm no console errors, Three.js module resolves and catalog fetch succeeds.
3. Test tap, horizontal swipes, vertical swipes, raycast on every rung and switch from vial to album/song and back.
4. Test public playback, previews, gated/entitled playback, no unintended seek bypass and lock-screen media session.
5. Inspect WebGL frame rate, memory and touch hit areas on a physical iPhone; ensure fallback when GPU is disabled.
6. Confirm lyrics match the selected song and no fictitious synchronized timestamps are shown.
7. Review before enabling this as the default Music surface. No auto merge or automatic migration.

## Non-goals in this first PR
No unannounced production replacement, no fabricated waveforms or lyrics, no procedural album artwork, no camera/microphone permissions, no on-chain genome or biometric DNA reading.

## Private lab hold: owner directive, October 19, 2026
Helix is kept entirely inside `_unfinished/helix/`, which `.github/workflows/deploy-pages.yml` strips from the live artifact. The Cloudflare Pages export stages from already published gh-pages, so it inherits that exclusion. NO customer-facing entry link, public route, asset path or feature flag is allowed. Use a developer-local loopback server to inspect the prototype; this is *not* a remote Control owner-authenticated preview. A future remote Control preview must authorize the owner on the server before serving HTML or JavaScript; a client-side role check does not suffice.

## Side-effect safety
The private lab deliberately omits `js/analytics.js`, `js/listen-ledger.js`, `js/mcc-auth.js`, and `js/gated-audio.js`. Only public audio and configured previews are permitted. The canonical music engine still powers playback, but there are no live analytic counts or signed-master entitlements spent during local design review. The progress marker must not show another track's current position when browsing an unplayed crossbar.

## Local-only preview runner
Run `node tools/helix-local-preview.mjs` from a checkout to serve `http://127.0.0.1:8765/_unfinished/helix/index.html` on the same computer. This custom server binds to `127.0.0.1`, denies public routes and private scripts, whitelists the lab plus its required public media, sends `no-store` and `noindex` headers, and is intentionally unavailable from an external browser. Do not tunnel/forward this port. A private iPhone-accessible Control preview requires a separately implemented server-authenticated owner-only endpoint.


## October 19 owner design revision — Brain / DNA / player (PRIVATE ONLY)
The owner-supplied reference is a **compositional diagram**, not a request to paste the two-dimensional screenshot into the product. The single procedural DNA helix stays full-screen, behind every layer. It remains the primary selector. No separate tabs, lists, cards, or labels may float over the **middle 30%** and prevent the user from seeing and touching it.

- **Top 30% — BRAIN.** A stylized *procedural 3D brain* shares the same WebGL scene and occupies the top third. Translucent HTML metrics expose verified BPM, tonal key and approved spectral signature only when a published per-track analysis object has `provenance: "measured"` or `"verified"`. Missing measurements display an em dash and an explicit pending statement. This is audio metadata — never EEG, a brain scan, biological DNA inference, or a claimed psychological effect.
- **Middle 30% — DNA.** The center stays completely unobstructed, including a 20%-of-screen visual corridor within this zone. Actual song names are rendered as transparent textures **on the rotating 3D crossbars**, not as DOM pills or unrelated menu tabs. The focused crossbar rotates toward the user; other rungs show their actual 3D angle. Swiping the helix keeps the prior album/track navigation.
- **Bottom 40% — PLAYER.** A frosted translucent console lets the helix show through and exposes album art, selected track title, play/pause, previous/next, elapsed/duration, permitted seeking, real lyrics, and details. This controls `window.MCC_MUSIC`; it does not instantiate or replace the canonical audio engine. The console can scroll internally when height is limited.
- **Continuous background.** `#helixCanvas` is full-viewport at every breakpoint. Its idle movement is decorative, bounded, reduced-motion aware and capped to the same low-power renderer constraints as v1. Neither 3D brain pulsation nor illustrative strand waveform indicates a physiological measurement.
- **Visibility.** All additions are still inside `_unfinished/helix/`. The release exclusion, no public launcher, developer-local whitelist server, and explicit owner approval gate remain mandatory.

### Verification still required before owner review
Run `node --test scripts/test/helix-interface.test.mjs scripts/test/helix-local-preview.test.mjs` on the actual branch; then inspect the 30/30/40 layout at iPhone viewport sizes and safe-area variations, test canvas picking where the labels cross, and verify controls do not consume a player entitlement twice. Confirm Three.js renders the camera-anchored illustrative brain on iPhone Safari without severe GPU or memory regression. Do not claim completed physical-device or production QA from static CI alone.
