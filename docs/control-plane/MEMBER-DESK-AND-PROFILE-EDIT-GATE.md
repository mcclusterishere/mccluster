# Member desk over the globe, and the profile edit gate

**Owner direction, 2026-10-15 (Matthew).** "The policy link that separates
everything, that's not even an experience. I wanted it layered on top of this
(the globe experience), allowing the user to have a DESK, which would be kind
of like their analytics. A user, business user, creator user." And: "Editing
your profile after onboarding should require a video recording literally
asking to edit, then identity verification through Persona."

Status: built on branch `feat/member-desk-profile-edit-gate`, stacked on the
identity verification levels (`docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md`,
PR #443) and the Policy Fellowship ladder (PR #440). The schema is a
**pending** file; nothing here is applied in production.

## 1. The desk

**Owner correction, October 17, 2026:** the signed-out World must contain no
"Your desk", "Get Your Hu Up!" or policy workspace. Guest desk controls and
panels are not mounted. Old `?desk=` links land on the same World without
opening the desk; other query parameters remain intact. Signing out removes
the panel and invalidates pending capability loads. Members retain their
existing workspace, permissions and profile-edit flow.

A **Desk** tab joins the bottom app bar on the World (`mnet.html`). The bar
never leaves: the desk opens above it, a bottom sheet at phone width and a side
panel from 64rem, over the globe. It is not a page; `?desk=1` or
`?desk=<section>` opens it and closing it takes the parameter off the address.

| Who | Sections (in order; the phone sees all of them) | Source, under its existing permissions |
| --- | --- | --- |
| Guest | None; remain in World | No desk capability or policy reads |
| Signed in | Profile (and locked details), Missions, Alerts, Policy (the ladder) | `MCC_MNET.profile()`, `action_record()`, `GET /v1/mnet/notifications`, `policy_ladder_status()` |
| Creator | + Audience | `GET /v1/analytics/my-creator`: the same numbers as the creator analytics, aggregate, countries with fewer than 5 views folded away, no listener identities, no IPs; creator state from `music_creator_state()` (#447) or the member's own `music_creator_profiles` row |
| Business | + Business | `GET /v1/creator-billing/entitlement` (workspace) and the analytics sites the member owns (RLS) |
| Fellow | Policy memos moves right after Profile | `js/policy-fellowship-desk.js`, unchanged, now mounted inside the desk |

Rules: `js/member-desk-core.js` (`capabilities`, `sections`, `policyMode`).
Nothing is computed or invented in the desk. **Not built:** a business listing
on the map ("Put your Black business on the map") has no table yet, so the
business section shows only the workspace and sites.

**Policy is not a destination any more.** The World's Policy chip opens the
desk on Policy. `action-policy.html` keeps answering for every inbound link and
QR code: it redirects (script plus meta refresh, `noindex`) to
`mnet.html?view=feed&desk=policy`, carrying its `region` and `status` filters.
`action-globe.html` (Full world) and `equity-uprise.html` link to the same
place. Matthew's own published writing, `policy.html`, is untouched.

## 2. The profile edit gate

### What locks (data, owner-changeable)

`profile_protected_fields` lists table, column, owner key, label and format.
A field **locks once it has a value**; an empty one may still be filled
(onboarding). Default list (conservative):

| Key | Where | Requestable |
| --- | --- | --- |
| `legal_name` | `fan_profiles.legal_name` | yes |
| `handle` | `platform_profiles.mccluster_id` | yes |
| `artist_name` | `music_creator_profiles.artist_name` | yes |
| `creator_handle` | `music_creator_profiles.handle` | yes |
| `region`, `country` | `fan_profiles` | yes |
| `globe_region` | `action_globe_member_regions.region_key` | yes |
| `payout_account` | `action_creator_connect_accounts.stripe_account_id` | **no**: payouts change only through payout setup (already server-only) |
| `display_name` | `network_profiles.display_name` | listed **off** (`enabled = false`) |

Never locked: avatar, bio, headline, website, phone, street address,
notification and privacy preferences, password. To change the list:
`update public.profile_protected_fields set enabled = … where field_key = …`,
or insert a row; a statement trigger re-attaches the guard to any new table.

### Enforcement

`profile_edit_guard()` is a `BEFORE UPDATE OR DELETE` trigger on every listed
table. It runs as the writer (security invoker). If the writer is a member
(role `authenticated`, directly or through any security-definer RPC called with
a member's token, such as `set_mccluster_id` or `mnet_complete_surface_profile`)
and a set protected column would change, it raises `profile_field_locked`. The
service role, the SQL editor and the approved-edit path are not members. The
World's profile form marks locked inputs read-only and links to the desk; that
is a courtesy, the database is the wall.

**Integration note (owner/agent):** creator onboarding (#447) only inserts
`music_creator_profiles` and overwrites nothing, so it is unaffected. Creator
Studio's own profile editor (`creator.html?edit=profile`) will get
`profile_field_locked` if it tries to change the artist name or creator handle;
it should send those changes to the desk (`mnet.html?view=feed&desk=profile`).

### The request

1. In the desk (Profile → Locked details) the member types the new value(s)
   and why, reads the consent, ticks agree, types their name.
2. "Turn on camera and get my code": `getUserMedia`, a live track check
   (`js/identity-capture-core.js`), then `profile_edit_start()` issues the
   challenge phrase, the private object path and a ten-minute expiry, and
   records the consent acceptance. It refuses unknown, unlocked or
   non-requestable fields, the same value, a bad format, a second open request
   and more than six attempts a day.
3. The member records (3 to 120 s) saying their name, the code, what they want
   changed and why; plays it back; sends. The bytes go to the private bucket
   through a signed upload; `identity_finish_submission()` checks them exactly
   as for V1/V2. No file input exists.
4. The Persona ID check through `POST /v1/identity/persona/inquiry` (now
   accepts a `profile_edit` submission). `PERSONA_ENABLED` stays `"false"`, so
   today the member is told the check is not switched on and the request waits.
5. The owner reviews it in the control room → Human Uprise → **Identity**: the
   same queue, a **Profile edit** type showing each change beside the current
   value and the reason, decided by `profile_edit_review_decide()`. Approve
   needs Persona `approved` (`profile_edit_settings.require_persona`, default
   true). Approve applies the values, **once**, writing one
   `profile_edit_audit` row per field (old, new, who, when; append-only).
   Reject or retake needs a note and changes nothing. The member is notified.

`identity_review_decide()` can never decide a profile edit (a trigger refuses
it), so an edit can never write a V1/V2 verification row.

### Consent

A new draft version `profile-edit-2026-10-draft1` in the identity levels'
versioned consent table: what is recorded, the Persona check, who sees it,
"we review your submissions together, including comparing them…", no software
face matching, not used for AI, deletion `[N]` days after the decision, how to
ask for deletion. It cannot be used until the owner approves it with `N` and a
counsel review date (the table's own rule).

## 3. Files

| File | What |
| --- | --- |
| `js/member-desk-core.js`, `js/member-desk.js`, `css/member-desk.css` | The desk |
| `js/profile-edit-gate.js` | Member side of the gate (desk + profile form lock) |
| `js/control-room/profile-edit-review.js` (+ hook in `identity-review.js`, `control.html`) | Owner side |
| `supabase/pending/20261016010000_profile_edit_gate_v1.sql`, `….rollback.sql` | Schema |
| `supabase/tests/profile_edit_gate.behaviour.sql`, `scripts/test-profile-edit-gate-db.sh` | DB behaviour, rollback round trip, identity and ladder tests on top |
| `scripts/test/member-desk.test.mjs`, `workers/mccluster/test/profile-edit-gate.test.mjs` | node --test |
| `scripts/e2e/member-desk.e2e.mjs` | Playwright, 390 and 1280, mocked backends, fake camera |

## 4. Apply checklist (owner approval required)

1. Apply the ladder, then the identity levels (their own checklists).
2. Apply this file as `profile_edit_gate_v1`; check `get_advisors`.
3. Confirm the guard is on the real tables:
   `select tgrelid::regclass from pg_trigger where tgname = 'zz_profile_edit_guard'`.
4. Owner + counsel approve the consent text (new active version with N).
5. Enable Persona per the identity levels' checklist; until then approvals wait.
6. Point Creator Studio's profile editor at the desk for locked fields.

Rollback: export `profile_edit_audit`, delete the profile-edit videos through
the Storage API, then run the rollback file. Approved changes are not undone.

## 5. Open questions for Matthew

1. Is the default list right? Should display name lock too (one UPDATE)?
2. Persona required for every edit (built), or only for some fields?
3. Should a profile edit also require an approved V1 introduction to compare with?
4. Retention N for edit videos.
