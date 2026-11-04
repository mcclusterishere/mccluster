# Email-link sign-in review

An optional `/auth/email.html?next=%2Fgame-hub.html%23m%3Dchem108%26play%3Dmolecule-rush` entry requests a one-time link for an existing M Account. This is a draft for review, not a deployed or verified delivery path. The password sign-in door remains `/account.html`. No account navigation is changed yet.

## Scope and coordination

Uses the canonical Supabase project's public Auth API, S256 PKCE, and existing `mccdb_session` / `mcc_sess_keep` storage contract. No backend, credentials, account, role, schema, provider settings, email delivery or paid service was created/changed. No owner check changes: `/v1/status` still enforces the McCluster house owner membership. An email login does not grant admin or owner access.

PR #752 owns the stalled-request and refresh repair in `js/mcc-auth.js`; coordination was posted there before editing. This change adds separate files and does not modify that module, `account.html`, `auth/index.html`, `backend.js`, or `owner-only.mjs`.

## Security and failure behavior

- `create_user: false`; no account creation. Public provider key only. Provider response bodies never appear in UI errors.
- One local pending request, replaced only by a deliberate new request after a 60-second cooldown. Provider rate limits remain authoritative; local throttling is UX, not an abuse boundary. Same generic UI outcome for accepted and account-specific rejected requests. **The public provider API's enumeration behavior is not hidden by client code.** Review provider abuse controls before enabling this door.
- Random 256-bit state and PKCE verifier; only the S256 challenge reaches the request API. The verifier is stored in localStorage for same-browser, new-tab email handoff, consistent with the existing browser session threat model. Use the same browser/profile; email in-app browsers cannot share it. A new request supersedes older links. Pending verifier is never logged or put in a URL.
- Pending requests are accepted for at most ten minutes, then unusable locally. The record is removed before exchange; Supabase separately enforces one-time codes and its configured email expiration. An interrupted exchange requires a new link. No silent retry and no claim that abort reverses a server operation.
- Callback codes are removed from the address bar before interaction. Explicit Finish sign-in prevents automatic account replacement merely by opening an email. No implicit bearer fragments, analytics, shared shell or third-party scripts on callback. Referrer policy and CSP constrain disclosure.
- Return path is stored when the request starts, validated again on completion, and cannot come from the callback URL. Same-origin paths only, including course/game hash; callback loops are rejected.
- Fetch and body reads have a 12-second deadline per request; late replies cannot save a session. Provider `/user` validation precedes persistence. An account/sign-out change during exchange prevents replacement. Both canonical session slots are restored on partial storage failure where browser storage permits.
- The isolated client writes only sessions issued and validated by Supabase. Authorization still requires the server on each private resource. No role claims are synthesized.

## Release gates (unverified; do not advertise as working yet)

1. Independently review code and green CI. Preserve #752's fix and regression checks.
2. Read-only verify project email sign-in is enabled, outbound mail delivery/quota is suitable, and the email template uses the provider confirmation URL compatible with PKCE. This draft does not alter settings. An OTP-only/custom token-hash template is not supported by this code.
3. Verify the provider accepts the exact first-party callback `https://matthew.mccluster.org/auth/email.html?state=<random-state>` through its redirect allowlist. Do not add broad origin wildcards. If a setting/template change is required, obtain separate approval; never route around the allowlist.
4. Review production CAPTCHA/abuse requirements. No CAPTCHA widget is implemented here; a provider requiring CAPTCHA will reject this request. That is a release blocker, not a reason to disable protection.
5. Separately authorize deployment, then have the confirmed existing owner personally request and consume a link. Verify new-tab and actual phone email-browser behavior, expired/replayed links, current owner membership, and return to Molecule Rush. Do not email an ambiguous address or expand roles to fix login.

No legal barrier identified in this bounded implementation; identity verification and production configuration remain operational gates. No delivery, provider expiration setting, live allowlist or physical-phone success is claimed.

## Evidence

- `node --test scripts/test/email-signin.test.mjs`: behavioral fixtures for PKCE/return paths, missing accounts, cooldown/429, hung fetch/body, successful canonical persistence, provider rejection, wrong browser/state, expiration/replay, sign-out races, late responses and denied storage.
- `node scripts/e2e/email-signin.e2e.mjs`: Chromium at 390/1280px, actual page/CSP, new-tab completion, one-time local replay rejection, course hash return, no horizontal overflow and >=16px input. All provider responses synthetic; destination is an explicit fixture, not a live owner-access claim.
- Dedicated PR workflow runs both suites with pinned Playwright. No feature-branch push jobs.

Protocol references checked 2026-11-04: https://supabase.com/docs/guides/auth/auth-email-passwordless and https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts (`signInWithOtp`: `create_user`, challenge fields and `redirect_to`; `token?grant_type=pkce`). Changelog markdown fetch was blocked by the environment proxy; no claim of complete changelog verification.
