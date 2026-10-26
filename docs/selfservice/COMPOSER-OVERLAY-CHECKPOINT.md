# World composer activation handoff

This separate draft is based on first-offer PR #638 at `38a8058e0a0833f9de3a2caadc8d26f658c129e0`. No production activation, schema application, provider authorization or real post is included.

The World plus button and text field open the same composer DOM in a native dialog. Escape, Back and Close return it to its original position, with focus on the plus button. Posting uses the existing World route and external delivery outbox. Advanced capture / trim remains an explicit link to `create.html`; its recording, editing and native scheduling workflow has not been ported into the overlay.

## Drafts and account isolation

World and Advanced Create drafts are scoped separately to the verified account. Ordinary drafts expire after seven days; unresolved post requests do not expire into permission to create a new operation. Unowned legacy Create drafts are ignored. Files, credentials and signed media URLs are never written to these draft records. Storage failures are explicit; World posting waits until its recovery checkpoint can be saved. Closing still preserves text in the current tab.

Restored media IDs are checked by the Worker against the authenticated account's canonical M UID. Only owned, ready, unattached assets return; foreign, staged, deleted and attached assets do not. Public readability is insufficient. Restored references can be used for World posts, but this checkpoint does not restore local file bytes or rich media previews: a fresh Instagram selection still requires choosing its supported original video file. An already submitted combined request can be recovered without that file because the existing server delivery owns its canonical media reference.

Account changes immediately clear composer state, abort active World XHR uploads, and fence upload/poster/finalize/post/recovery continuations. Advanced Create receives the same owner fencing. `MCC.api` has an optional expected-subject and before-fetch guard after session refresh; only scoped callers use it. The shared refresh function also refuses to overwrite or clear a newer session when an old refresh resolves. These are client race guards; server authentication, ownership and RLS remain authoritative.

## Publishing and recovery

The unified composer publishes now. World is the default destination for regular members. Instagram Professional Reels appears only as an explicit opt-in when the server verifies the owned active creator-workspace entitlement and ready owned connection. Eligible owners without a ready connection see the existing setup path; no synthetic account-type silo or admin/client metadata grant is introduced.

Before posting, World saves one unresolved request checkpoint. A lost combined response, reload or partial successful response retains the exact original payload and operation key. Recovery replays it through the existing World/delivery authority, whose owner/key lookup precedes media validation. It does not create another queue, infer absence from the last 50 deliveries, or silently change keys when text changes. Instagram failure/retry operates on the existing delivery and never republishes the World post.

Ordinary native posts have no server operation-key contract. An unknown outcome therefore blocks automatic retry. The user can review their profile, explicitly acknowledge that the earlier post may already exist, and start a separate draft. The latest manually reviewed unconfirmed request remains visible; this is not a claim of exactly-once native delivery. Known pre-acceptance validation errors allow correction.

The World uploader shows XHR progress and supports cancellation while retaining text and already ready attachments. Late results cannot enter another account's composition or run cleanup under its credentials. The Advanced Create header reserves space for the existing Profile chip, which otherwise obscured its Next button at phone width.

## Validation and limits

Local checks: 1,177 source tests passed; Worker suite 1,315 total, 1,311 passed and four optional SQL checks skipped; 52 real-document composer fixture assertions passed on Chromium 154 at 390/1440 plus focused account/upload/refresh/recovery cases. The existing external composer browser fixture and all 47 managed-project browser assertions also passed. API responses and provider failures are intercepted fixtures; these are not live publication or provider attestations.

The initial PR #639 CI found a source assertion still expecting two advanced-route links. It now requires the real dialog button and the retained named advanced link. That run also timed out reloading the offers editor on Chromium 156. It did not reproduce locally on 154; navigation/request-failure diagnostics preserve the same 30-second assertion. The official Chromium 156 download is blocked in this workspace by HTTP 403 `Domain forbidden`, so final CI on 156 remains decisive. Report the final remote head and terminal checks separately.

No additional database migration is introduced. Existing pending World delivery, creator billing/customer-social, and native media authority from the underlying stack remain prerequisites. Provider flags, credentials and OAuth are not activated. The only adapter in scope is Instagram Professional Reels; unified scheduled multi-network delivery is not implemented. Existing advanced native scheduling and customer-social tools retain their separate entry points.

Official Meta references: [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) and [platform overview](https://developers.facebook.com/documentation/instagram-platform/overview). No provider adapter change, other network, analytics event schema, music playback ledger, Stories, streaming service, or browser music studio is included. Existing tracking calls are retained.
