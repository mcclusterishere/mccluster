# World composer checkpoint

This draft is based on first-offer PR #638 at `38a8058e0a0833f9de3a2caadc8d26f658c129e0`. It is a separate implementation checkpoint, not a production activation or completed external publishing rollout.

The existing World plus button and text field open the same composer DOM in a native dialog. Escape, Back and Close return it to its original position; focus returns to the plus button. The dialog uses the existing posting and delivery code. Advanced capture / trim remains an explicitly named link to `create.html`; its recording and editing workflow has not been ported into the overlay.

Advanced Create drafts are now scoped to the verified account and expire after seven days. Unowned legacy drafts are ignored. Storage failures do not claim that a draft was saved. Files, credentials and signed media URLs are not stored. Account changes clear visible private state immediately and fence pending upload grants, writes, finalization and posting continuations. Cleanup from the previous account cannot run using the new session. The account chip previously obscured the Next button at phone width; the Create header now reserves space for it.

## Validation

The fixture loads the real World and Create HTML and scripts, with intercepted auth and API responses. It checks one composer instance, Escape/Back/repeated close, focus containment and return, width at 390 and 1440, account-change history cleanup, advanced draft reload and A/B isolation, and an account switch while a post awaits its upload grant. These are fixture checks, not live posts or provider verification. The fixture is included in the customer browser workflow. Local browser results use Chromium 154; CI results must be reported separately.

## Remaining implementation in this draft

- Persist and recover the ordinary World composition for its verified owner, with explicit local-storage failure status.
- Verify ownership before restoring any server media references; public media readability is insufficient.
- Preserve/reconcile an ambiguous external delivery operation across reload with the existing durable outbox. Do not claim exactly-once native posting: ordinary native posts currently have no equivalent operation-key contract.
- Return creator/business external capability from existing owned active creator-workspace entitlement and owned connection authority. Do not infer eligibility from admin status or client metadata.
- Add explicit destination selection, supported-format previews, upload progress/cancellation, and external failure/retry browser cases without duplicating the World post.

The only existing adapter in scope is Instagram Professional Reels. No other network, OAuth grant, credential, real publication or second queue is introduced. Official Meta documentation describes publishing for professional accounts: [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) and [platform overview](https://developers.facebook.com/documentation/instagram-platform/overview). This checkpoint does not change the existing provider adapter.

No analytics event schema, music playback ledger, Stories, streaming service, or browser music studio is part of this checkpoint. Existing tracking calls are retained. No production schema, deployment or account mutation is authorized by this draft.
