# HERE on the App Store and Google Play

Where the app stands, what each store will check, and what is left. Written
2026-10-02. "Verified" means checked in this repo or in production that day.

## The app is `native/`, not Capacitor

`native/` is the real app: React Native on Expo 57, bundle id
`org.mccluster.here` on both stores, with background audio and lock-screen
controls already working (see `README.md`). The root `capacitor.config.json`
and the `@capacitor/*` entries in the root `package.json` are an older web
wrapper. Apple rejects plain website wrappers (guideline 4.2), so the stores
get `native/`. The Capacitor files can be removed once nothing depends on them.

Today the native app plays the music natively. Profile, the Action Network,
Create and the other rooms open the website in the browser (`RoomScreen`
"Open on the web"). That is the gap this plan closes.

## Store requirements

| Requirement | Apple | Google | Status |
| --- | --- | --- | --- |
| Real app, not a website in a frame | 4.2 | — | **Met for music.** The Action Network must be native before submission (phase 1 below). |
| Start account deletion inside the app | 5.1.1(v) | Account deletion policy | **Met on the web** (Me → Delete my account, `request_account_deletion`, applied 2026-10-02). The native app calls the same RPC in phase 1. Google also needs a public web URL for it: `https://matthew.mccluster.org/mnet.html` (Me tab). |
| Report content, block people | 1.2 | UGC policy | **Met.** Reports and blocks exist on posts, profiles and live broadcasts (verified). |
| Terms members agree to, zero tolerance for abuse | 1.2 | UGC policy | **Missing.** No Terms of Use or community guidelines page exists. Owner to approve the text; members accept it at sign-up. |
| Moderation that acts within 24 hours | 1.2 | UGC policy | **Partly.** The desk can remove posts and end live broadcasts. Needs a named person and a daily check. |
| Privacy policy URL | 5.1.1 | Required | **Met.** `privacy.html`. |
| Privacy labels / Data safety form | App Store Connect | Play Console | **To fill.** The answers follow `privacy.html`: account, email, posts, photos/video you upload, approximate location from IP, no sale, no ads. |
| Sign in with Apple | 4.8 | — | **Required if** the app offers Google, Facebook or X sign-in. The web shows whichever providers Supabase has switched on; the app must add Apple whenever it adds any of them. |
| Camera and microphone purpose strings | 5.1.1 | Runtime permissions | **To add** when proof upload and live land in the app (phase 2). `app.json` today asks for no microphone, on purpose. |
| Payments for digital goods | 3.1.1 | Play billing | **Watch.** Music sales and paid tiers inside the iOS app must use in-app purchase, or be left out of the app. Physical merch can keep Stripe. No recurring billing is planned. |
| Live video | 1.2 | UGC | **Met in the design.** Only the owner and accepted fellows broadcast, the desk can end any broadcast, viewers can report. |

## The build, in phases

**Phase 1: sign-in and the Action Network, native.** This is what makes it
an app worth installing for fans.
- Sign in with the same Supabase account (email, plus Apple when any social
  provider is on). Session in secure storage.
- Feed, missions and the Action Record, reading the same endpoints the web
  uses (`/v1/mnet/feed`, `action_missions`, `action_record`,
  `action_feed_cards`), so the two never disagree.
- The first-run walkthrough, remembered on the account (`mnet_mark_tour_seen`),
  so web and app agree on whether someone has seen it.
- Me, with Delete my account (`request_account_deletion`).
- Deep links: `here://mission/<id>` and `https://matthew.mccluster.org/mnet.html?mission=<id>`,
  so a shared receipt opens the mission in the app.

**Phase 2: proof and the fellowship.**
- Proof from the camera through the existing signed upload
  (`/v1/mnet/media/upload-url`, `finalize`), with
  `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
- Share to feed, the receipt, and the fellowship application at three
  verified actions.

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
