# COM-3 source series

Apply the two numbered `.patch` files in order on PR #782's exact head
`53dcd55243e6d847b4ced44817bb22d11bdcce18`. They produce source head
`42479d958e587043312701dc666c446e5ba6bc30`, tree
`0c4e32c8a2b5d2b6214d7fd88a7e4076b91d4d3c`.

The separate evidence commit is not part of the source patch series. Independent
`git am` and native PostgreSQL 16/17 runs verified the source tree. The manifest
records passed, failed-before and unrun stages without treating skips as passes.

`AUDIT-STATUS-UPDATE.diff` updates the five audit tracking documents against their
`9d296160` snapshot. It is a coordination artifact for the #793 owner, not a third
source patch and not already applied to #793. Apply/reconcile it there only after
checking newer documentation. The corresponding code belongs on #782, not #793.

Recommended integration: a stacked review PR from `recovery/com3-20261110` into
`codex/customer-current-release-20261107` (the #782 head branch). Do not force-push
or replace that branch. Its `Customer self-service` pull-request workflow has no
base-branch restriction and now runs both commerce browser fixture files. Wait
for hosted exact-head checks and review before integrating. #782's own release
base/dependencies must then be reconciled independently.

This package does not apply pending SQL, deploy the Worker/site, enable paid
activation or make a real provider call. The rollback suspends operations while
preserving receipts. Browser validation is not implied by local syntax checks.
