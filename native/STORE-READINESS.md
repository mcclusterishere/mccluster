# HERE on the App Store and Google Play

Where the app stands, what each store will check, and what is left. Written
2026-10-02; updated 2026-10-05. "Verified" means checked in this repo or in
production on the stated date.

## The app is `native/`, not Capacitor

`native/` is the real app: React Native on Expo 57, bundle id
`org.mccluster.here` on both stores, with background audio and lock-screen
controls already working (see `README.md`). The root `capacitor.config.json`
and the `@capacitor/*` entries in the root `package.json` are an older web
wrapper. Apple rejects plain website wrappers (guideline 4.2), so the stores
get `native/`. The Capacitor files can be removed once nothing depends on them.

The native app now plays music and runs Action Network Phase 1 natively:
M Account session/auth, onboarding and the account-synced walkthrough, feed,
groups, missions, proof capture/upload, Action Record, account deletion and
mission deep-link routing. Create and several secondary rooms still hand off
to the website; those are later shipping slices, not Action Network Phase 1.

## Store requirements

| Requirement | Apple | Google | Status |
| --- | --- | --- | --- |
| Real app, not a website in a frame | 4.2 | — | **Met for music + Action Network Phase 1 in source.** Create/secondary rooms that still hand off to web are later store-readiness work. |
| Start account deletion inside the app | 5.1.1(v) | Account deletion policy | **Met in native source + web.** Native Account calls `request_account_deletion` and can cancel a pending request; Google’s public web URL remains `https://matthew.mccluster.org/mnet.html` (Me tab). |
| Report content, block people | 1.2 | UGC policy | **Met.** Reports and blocks exist on posts, profiles and live broadcasts (verified). |
| Terms members agree to, zero tolerance for abuse | 1.2 | UGC policy | **Missing.** No Terms of Use or community guidelines page exists. Owner to approve the text; members accept it at sign-up. |
| Moderation that acts within 24 hours | 1.2 | UGC policy | **Partly.** The desk can remove posts and end live broadcasts. Needs a named person and a daily check. |
| Privacy policy URL | 5.1.1 | Required | **Met.** `privacy.html`. |
| Privacy labels / Data safety form | App Store Connect | Play Console | **To fill.** The answers follow `privacy.html`: account, email, posts, photos/video you upload, approximate location from IP, no sale, no ads. |
| Sign in with Apple | 4.8 | — | **Required if** the app offers Google, Facebook or X sign-in. The web shows whichever providers Supabase has switched on; the app must add Apple whenever it adds any of them. |
| Camera and microphone purpose strings | 5.1.1 | Runtime permissions | **Camera/photos configured.** Native proof capture has explicit camera/photo purpose strings. ImagePicker keeps `microphonePermission: false`; microphone/record-audio permissions wait for live video. |
| Payments for digital goods | 3.1.1 | Play billing | **Watch.** Music sales and paid tiers inside the iOS app must use in-app purchase, or be left out of the app. Physical merch can keep Stripe. No recurring billing is planned. |
| Live video | 1.2 | UGC | **Met in the design.** Only the owner and accepted fellows broadcast, the desk can end any broadcast, viewers can report. |

## The build, in phases

**Phase 1: sign-in and the Action Network, native — COMPLETE in #373 (source/CI).**
This is what makes it an app worth installing for fans.
- Sign in with the same Supabase account (email, plus Apple when any social
  provider is on). Session in secure storage.
- Feed, missions and the Action Record, reading the same endpoints the web
  uses (`/v1/mnet/feed`, `action_missions`, `action_record`,
  `action_feed_cards`), so the two never disagree.
- The first-run walkthrough, remembered on the account (`mnet_mark_tour_seen`),
  so web and app agree on whether someone has seen it.
- Me, with Delete my account (`request_account_deletion`).
- Deep links: `here://mission/<id>` routes directly; the app also declares
  iOS/Android association for `https://matthew.mccluster.org/mnet.html?mission=<id>`
  and rewrites that incoming URL to the native mission route. The final OS
  verification files still require the owner’s Apple Team ID / Play signing
  certificate (owner step 5 below).

**Phase 2: receipts and the fellowship.**
- **Landed early in #373:** camera/library proof through the existing signed
  private upload (`/v1/mnet/media/upload-url`, `finalize`), proof retry,
  post-verification share intent, HEIC→JPEG normalization, and camera/photo
  permission strings.
- Remaining: a native shareable receipt surface and the fellowship
  application at three verified actions.

**Phase 3: live and notifications.**
- Watch live in the app (WHEP over `react-native-webrtc`).
- Go live for the owner and fellows (WHIP), with
  `NSMicrophoneUsageDescription`, `RECORD_AUDIO` and `CAMERA`.
- Push notifications: someone you follow is live, your proof was verified,
  a reply. Needs APNs and FCM keys.

## What only the owner can do

1. **Developer accounts.** Apple Developer Program ($99 a year) and Google
   Play Console ($25 once). Building and uploading for iOS needs a Mac with
   Xcode, or Expo's hosted builds (EAS).
2. **Terms of Use and community guidelines.** Approve the text. The app
   cannot ship with user posts without it.
3. **Turn on live video.** In the Cloudflare dashboard, enable Stream, create
   an API token with *Stream: Edit*, and add two settings to the `mccluster`
   Worker (Settings → Variables and Secrets): `CF_ACCOUNT_ID` (plain text) and
   `CF_STREAM_TOKEN` (secret). Until then, Go live says it is being switched on.
   WebRTC delivery is $1 per 1,000 minutes watched; billing starts 2026-10-15.
4. **Name a moderator** and a daily time to check reports and deletion
   requests (`desk_account_deletions`).
5. **Universal links** need the Apple Team ID (for
   `.well-known/apple-app-site-association`) and the Play signing
   certificate's SHA-256 (for `.well-known/assetlinks.json`). Both come from
   the developer accounts in step 1.
