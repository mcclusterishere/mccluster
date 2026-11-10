# Hosted browser compatibility follow-up

The initial PR #796 head `91bb954d7ae08ac7fabcddd47f87f03bbf8aedce` reached
Chromium in GitHub Actions. Its first two browser journeys passed. Job
`130168494159` then failed in `first-offer-acceptance.e2e.mjs` before the new
commerce suites: the legacy fixture waited for a raw placeholder error and
expected Continue to checkout to become available after an unknown outcome.

COM-3 intentionally keeps that control disabled and recovers the server-held
attempt through Resume. The follow-up changes only the legacy fixture. It
persists a synthetic pending attempt, answers structured pending errors, and
checks one initial checkout followed by repeated and reloaded resume requests
with an empty body and the same server-held provider identity. It retains the
landing, sign-in, profile interruption, quota, module persistence, account
switch and no-admin checks. It strengthens duplicate-click suppression,
competing-checkout blocking, no false paid state, and exact 390px width equality.
No runtime code, provider/card guard, assertion skip or timeout increase changed.

Other browser references were inspected: customer-commerce-browser covers auth
isolation and capability-token URL safety; creator-domain-purchases-ui covers
separate registrar/contact operations; remaining references concern links or
unchanged entitlement routes. No other legacy retry assumption was found.

Apply this follow-up patch after the published initial package/head. It is
separate from the original two source patches and does not alter their proof.
Independent git am produced tree `366e312917b3a45a2e6b21fd12935350d7a8522e`,
matching local commit `4cf9f037895c91cdce55836878047d0afd624101`.
Syntax/diff checks, 28 focused checks, and root 2068 pass / 3 existing skips
passed. The repair was independently reviewed. Full browser execution of this
follow-up awaits the new hosted head; this document does not claim it passed.
