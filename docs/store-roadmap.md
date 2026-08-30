# THE STORE CAMPAIGN: every shelf, cleanly

The law of this campaign: the site stays the product. One codebase,
every store gets a shell around it. Nothing forks, nothing gets
rebuilt twice, features keep shipping the whole time.

## What's already true (as of this commit)

- Installable web app: manifest + icons + THE KEEPER (sw.js offline
  layer) on all pages. "Add to Home Screen" works on iPhone and
  Android today, full-screen, no browser chrome.
- Native Android shell: Capacitor (`org.mccluster.here`), site
  bundled INSIDE the app (stores reject remote-URL boxes), data live
  from Supabase. `build-android.yml` produces an installable APK
  from CI. No Mac, no local SDK, the repo builds the app itself.

## The shelves, ranked by certainty

| Store | Odds | What it takes |
|---|---|---|
| Google Play | Near-certain | $25 once · release keystore in Actions secrets · Play listing |
| Amazon Appstore (+ Fire tablets) | Near-certain | Free account · same APK |
| Samsung Galaxy Store | Near-certain | Free-tier account · same APK |
| Microsoft Store (Windows) | Near-certain | PWA submitted as-is (PWABuilder); it already qualifies |
| Samsung TV (Tizen) | Strong | Packaged web app, and our PWA is most of the work; TV remote nav needed |
| LG TV (webOS) | Strong | Same as Tizen: packaged web app + remote nav |
| Fire TV | Strong | Android TV build of the same shell + leanback flags + D-pad nav |
| Android TV / Google TV | Strong | Same as Fire TV |
| Apple App Store (iPhone/iPad) | Good, not guaranteed | $99/yr · Capacitor iOS target (CI on macOS runners) · review risk = guideline 4.2 "web wrapper"; our native dock/tour/player is the counter-argument. NOBODY can guarantee Apple review. That's the one honest asterisk on the campaign. |
| Apple TV (tvOS) | Hardest, last | No web wrapper allowed in practice; it needs a real native tvOS app (a focused music/reel player, not the whole site). Separate build, do it when the iPhone app is approved and earning. |

## The payments law (decide at Apple filing time, not before)

Apple guideline 3.1.1: DIGITAL goods sold inside an iOS app (music
unlocks, premium subscriptions, creator cuts) must use Apple In-App
Purchase, and Apple takes 15 to 30%. REAL-WORLD services (booking a shoot,
event photo packs delivered by email) may keep Stripe/Square.

Options when we file:
1. Reader-style: digital purchases hidden in the iOS app (like
   Spotify): buyers use the website; bookings stay Stripe in-app.
2. IAP for digital goods, Stripe for services: Apple's cut on
   music, full margin on the real business.
Google Play has a similar rule but user-choice billing options.

## TV navigation (one build, shared by all TV shelves)

A `tv.html` mode: the album + films + portfolio as a focus-driven,
remote-navigable rail UI (arrow keys / D-pad, big type at 3 meters).
Same data files, same players. Ships to Tizen + webOS + Android TV.

## The owner's two errands (nothing moves without them)

1. Google Play developer account: play.google.com/console, $25 once.
2. Apple Developer Program: developer.apple.com, $99/yr (when ready
   for the Apple leg).
Both need your identity/bank details. Never share credentials in
chat; CI gets signing keys as GitHub Actions secrets only.

## Known refinement for the store build

First CI build (169e023) produced a working 317MB debug APK where every
video rode inside the bundle. Play's ceiling is 200MB, so the release
build excludes `assets/video` + `assets/audio` from the shell and a
small in-app shim points media at the live site instead (posters and
frames stay bundled; the app still opens offline, media streams).

## Build order

1. ✅ Offline keeper + Android APK rail (this commit)
2. Release signing + Play listing (needs errand #1)
3. iOS target + macOS CI build (needs errand #2)
4. tv.html remote-nav mode → Tizen/webOS/Android TV packages
5. Amazon + Samsung + Microsoft submissions (same artifacts)
6. tvOS native player (last, once Apple relationship exists)
