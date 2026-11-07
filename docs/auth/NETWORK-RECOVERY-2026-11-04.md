# Account request recovery

The reported phone symptom is “Signing in…” indefinitely, sometimes preceded by the Game Hub owner gate. This branch confirms and repairs two shipping-client failure paths; it does not establish the current phone's underlying network/provider failure.

Evidence:

- `gh-pages/js/mcc-auth.js`, blob `690996cc93a9fd31bea04d8b18787f7965945fa6`, has an unbounded `authApi` fetch and refresh `.catch(() => writeSession(null))` behavior. Current main `785ff23582979acc222e153b4215cfd188dd5579` has the same code. Chemistry/capsule/PRIM3 merges did not change these auth files.
- Pre-fix synthetic tests reproduced a refresh network error discarding stored credentials and a pending password request never settling. No actual user token or password was used.
- Direct read-only requests to the live Game Hub, account page, canonical status API and Supabase auth health endpoint were blocked by this environment's proxy with CONNECT 403. This is not evidence those services are down. A web index could retrieve account markup, but that is not a live authenticated browser test.
- Phone-width Chromium follows the actual owner-gate Sign in link into account.html. The existing privacy notice's Not now choice permits sign-in without analytics consent. A stalled password request now restores the Sign in button with a connection error at 12 seconds; a deliberate retry with a synthetic successful response opens Molecule Rush after a fresh synthetic server owner check. No console page errors.

Fix:

- Deadline and abort for account auth/RPC requests, including response-body reads. Late responses cannot commit a session after the deadline. No automatic retry of password or state-changing requests.
- Network errors, timeouts, rate limits, server failures and malformed refresh responses retain both existing stored copies while rejecting the operation. They do not return an expired session or grant access.
- Explicit server refresh/session rejection codes still clear the rejected session. A stale response cannot clear or replace a newer account/session or resurrect an explicitly signed-out session.
- Concurrent canonical refresh calls in the same document share one request. This is not a new cross-tab lock; the legacy backend client remains separate.

The owner gate, server permissions, auth settings, callback allowlist, PKCE verifier checks, cookie/session domains, billing and database schema are unchanged. No production storage was read or cleared.

Immediate guidance: the same-origin `/account.html?stay=1` route is locally verified to expose the password form and retain the resulting account view. It uses the same auth service, so it is **not a verified bypass for a currently stalled live auth request**. No live workaround has been verified. Returning to `/game-hub.html#m=chem108&play=molecule-rush` still requires a fresh server owner decision. Do not clear browser storage, reset passwords, or alter provider settings based only on this diagnosis.

Validation: 15 focused behavioral tests; root suite 1,729 Node passes, three existing skips, seven Python passes; actual account-page browser timeout/retry/owner-return test. Responses are fixtures; production session and physical-phone acceptance remain outstanding.

Sources: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions) explains rotating refresh tokens; [Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes) distinguishes explicit revoked/missing sessions from transient failures. Changelog markdown could not be fetched by the web tool (unsupported content type); no SDK/provider configuration change is made here.

Commands:

```sh
node --test scripts/test/auth-network-recovery.test.mjs scripts/test/owner-only.test.mjs scripts/test/one-signup-flow.test.mjs scripts/test/signup-verification-retry.test.mjs
node scripts/e2e/auth-network-recovery.e2e.mjs
npm test
```
