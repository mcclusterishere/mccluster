# HERE — the app

A real React Native app. Not a webview, not Capacitor, not a responsive
stylesheet: `expo export --platform android` produces a Hermes bytecode
bundle, and `expo prebuild` produces a Gradle project that builds an APK.

```
npm install
npm run typecheck                  # tsc --noEmit
npx expo start                     # dev, on device via Expo Go or a dev build
npx expo prebuild --platform android
npx expo run:android               # needs the Android SDK
```

## Why this is an app and not a page

The Music surface needs three things a browser tab cannot do, and all three
are wired:

| Capability | Where | Proof in the generated project |
| --- | --- | --- |
| Playback survives the lock screen | `src/player.tsx` → `setAudioModeAsync({ shouldPlayInBackground: true })` | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` in `AndroidManifest.xml`; `UIBackgroundModes: ["audio"]` on iOS |
| Artwork and title on the lock screen and in the notification shade | `player.setActiveForLockScreen(true, { title, artist, albumTitle, artworkUrl })` | `expo.modules.audio.service.AudioControlsService` with `android:foregroundServiceType="mediaPlayback"` |
| Hardware and notification transport controls | the same service | as above |

`setActiveForLockScreen` is also what keeps Android playing past roughly
three minutes in the background, which is why it is called on every load
rather than only when the lock screen is visible.

The app asks for **no microphone permission** — `recordAudioAndroid: false`
on the expo-audio plugin, because HERE plays audio and never records it.

## Shape

```
app/
  _layout.tsx            root stack; one TransportProvider wraps everything
  (tabs)/
    _layout.tsx          the one bar — five labelled tabs, edge to edge
    index.tsx            Album — the media library, opening on the Living Cover
    films.tsx            full-screen vertical viewer, one film per page
    catalogue.tsx        the touch shelf + registration data
    license.tsx          the numbered brief, ending in a receipt
    desk.tsx             what is installed, and what is still web-only
  track/[slug].tsx       Now Playing — 70% shared transport, 30% song stage
src/
  theme.ts               the HERE Brand Library tokens, nothing invented
  content.ts             the record; mirrors data/albums.json at the repo root
  player.tsx             one AudioPlayer for the life of the app
  MiniTransport.tsx      the compact rail, above the bar
  Glyphs.tsx             the icon set, drawn from views — no icon font
```

One player instance lives for the life of the app and is handed each next
source with `replace()`, rather than a player per screen. That is what makes
the transport persistent: leaving a track room does not stop the song.

## The design is not new here

`src/theme.ts` is a port, not a proposal. Every value comes from
`docs/design/HERE-BRAND-LIBRARY.md`, and the screens follow its rules and the
Native mobile law that sits under them:

- one dominant job per screen, one primary action
- the five-tab bar is edge to edge and always labelled — a floating capsule is
  a desktop flourish, not mobile navigation
- ruby marks action, live state, or registered emphasis, never decoration
- rounded glass is reserved for persistent chrome; editorial content uses
  rules, fields and frames
- 44pt minimum touch target, persistent controls clear the bottom safe area
- native controls must be functional — the scrubber really seeks, previous
  really restarts before it steps back, License really inherits the track

## Media

Audio streams from `https://matthew.mccluster.org` rather than shipping in the
download: the six masters are 3.7–5 MB each and the full audio directory is
64 MB. `src/content.ts` holds the origin in one constant.

## `android/` is not committed

Expo generates it from `app.json` (continuous native generation), so it stays
in `.gitignore` and is rebuilt with `expo prebuild`. Editing `android/` by
hand is how that config silently stops being the source of truth.

## Not in this build

The sales lane, the client console and the civic rooms are still web-only.
`desk.tsx` says so on screen and links out rather than pretending otherwise.
