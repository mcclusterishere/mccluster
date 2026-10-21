# Mission reset and the Docket 516R cohort

The owner directed a smaller mission catalog on 2026-10-17: give someone a free
ride, write a policy memo, and record a song about an issue in the community
(Write the Change). The World Missions tab presents one explanatory card at a
time. Left passes; right accepts through the existing mission-join RPC. Create,
Help, Explore and Earn are discovery categories, independent of stored domains.
Travel remains the default World mode.

## Historical work and people

`data/action/docket-516r-archive.json` is the reviewed public source. It contains
nine completed songs, ten recordings, ten cohort contributors, media assets and
the Equity Rise Graduation & Showcase on October 5, 2025 at Shiloh Baptist
Church, 477 Broad Street, Bridgeport. The capstone uses an address-interpolated
location; it is not a surveyed entrance. The archived livestream is an external
Drive link. Public Drive sharing was checked and left unchanged.

Brave is an alternate recording of Environmental Injustice, not another
completed mission. Draft videos retain their draft labels. A song credit links
to a cohort participant only where that identity is supported. Unresolved
aliases remain unlinked; engineering and production contributions are recorded
at the project level where individual track credits are not confirmed.

The historical archive is separate from joinable `action_missions`. Importing
past work does not create new assignments, award points or authorize payments.
The public song page and each participant webpage are at
`docket-516r-cohort.html`; a participant's `person` query selects their webpage.
`cohort-profile.html` is a separate cohort profile and links to an existing
M Account profile after the participant claims it.

## Identity and webpage ownership

The archive stores projects, participants, provider pages, works, events and
private invitations in `action_archive_*` tables. The organizer's existing
M Account is reused. Other participants begin unclaimed. No auth users,
duplicate global profiles or identity-verification states are manufactured.
The cohort badge confirms organizer-attested participation only.

The existing Worker serves `/v1/action-archive`. A claim validates the bearer
against Supabase Auth, then links an active primary M Account. Clients cannot
select the actor ID. A participant may edit only their own webpage headline,
biography and HTTPS website link. Profile identity, contributor credits and
cohort attestation are outside that editor.

Invitations are random 256-bit secrets. The database stores only their SHA-256
hashes. Issuance revokes earlier unused invitations for the participant; claiming
uses row locks and a unique account-per-project constraint. The claim page
reads a URL fragment, removes it before loading account scripts, preserves it
for the sign-in flow in sessionStorage, and requires an explicit connection.
Raw invitations, private contracts, contact details and internal research do
not belong in this repository. New invitation issuance is house-owner-only;
private responses are uncacheable and request bodies are bounded to 16 KiB.

Reseeding preserves claimed ownership and owner-written webpage content. Omitted
works and events are retired from public reads. Explicit API 403/404 responses
do not fall back to the static snapshot. A null provider-page result means the
webpage is unpublished and cannot be reconstructed from its public profile.

## Catalog and private development

The reset reuses the reviewed existing mission IDs and pauses other open civic
missions. Existing assignments, proofs, balances and history remain intact;
participants can still submit work for paused missions. Accepting a card joins
once and awards no points. Pass is local browsing state and is reversible.

Nine development ideas remain in the existing private mission arsenal. Faith
CDC is recorded as an existing relationship; individual proposed projects still
need authorization. The used-tech donation idea remains a draft pending CfAL's
intake process. No partner funding, payout, public signup or speculative event
is activated by these draft records.

## Recorded database application

- `20261017164335_action_archive_cohort_v1`
- `20261017164416_action_mission_reset_v1`

Both migration files match the actual stored SQL. The production ledger and
drift contract include their recorded versions. The seed uses the public JSON
plus an organizer identity link passed privately. Production verification found
10 participants, 10 provider pages, 9 works, 1 event, 1 existing claimed identity,
and 9 unclaimed invitations. No recipient invitation was sent by this work.

Frontend/Worker publication follows the repository's reviewed promotion gate;
database application alone does not deploy the webpage or claiming routes.

## Verification

`scripts/test-action-archive-db.sh` runs the same SQL behavior suites against
two disposable local PostgreSQL databases. It refuses nonlocal hosts. The
optional `scripts/test/action-archive-db.mjs` runner uses an externally installed
PGlite test runtime (`PGLITE_DIR`), with no production dependency. The API
Economic Core workflow runs the PostgreSQL gate and the Worker/card/map tests.

The SQL suites exercise real API roles, claim/replay/expiry, wrong-owner edits,
reseed preservation, public-data boundaries, paused-proof submission,
idempotent acceptance and private drafts. Worker tests cover validated actor
binding, origin handling, secret redaction and the streamed request-body limit.

The three fixture-only Playwright suites in `scripts/e2e/` are
`mission-swipe.e2e.mjs`, `docket-cohort-showcase.e2e.mjs`, and
`cohort-claim.e2e.mjs`. They intercept external requests and never consume real
invitations. They cover actual MCC authentication, native touch gestures,
keyboard controls, owner editing, media routing, authoritative publication
states, globe readiness ordering, and mobile overflow/action-button clearance.
Run with `CHROMIUM_EXECUTABLE` when the browser executable is supplied locally.
