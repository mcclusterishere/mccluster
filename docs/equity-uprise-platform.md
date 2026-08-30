# The Equity Uprise platform

A fellowship of fellowships. People arrive with something they care about,
say it on the record, and leave with a real next step — a program, an
organization, a deadline they can actually hit.

The program page (`equity-uprise.html`) is the finished record: documents,
a docket, nine fellows, a proclamation. This is the living half.

---

## 1. Where it lives, and why it isn't a new server

The plan this was built from called for a separate TypeScript service with
its own ORM, deployed alongside the site. **It was built on Supabase
instead**, and that is the one architectural decision worth arguing about,
so here is the argument.

The house already has a backend: Postgres with Row Level Security, reached
straight over PostgREST from `js/backend.js`, plus Deno edge functions for
the handful of jobs that need a secret (`supabase/functions/checkout`). A
second backend would have meant a second auth system, a second deploy, a
second set of environment variables, and a second place for a permission
bug to hide. The site is static on GitHub Pages; there is no server to add
routes to.

So: **the database is the API, and the wall is RLS.** Not a middleware
somebody forgets to mount, not a check inside a controller — a policy the
database itself enforces on every query, including the ones written by a
page that hasn't been reviewed yet.

| Layer | What it is | Where |
|---|---|---|
| Data + rules | Postgres, 14 tables, all RLS | `supabase/migrations/0017`, `0018` |
| Proof | 33 assertions against a throwaway Postgres | `supabase/tests/` |
| The one secret-holding service | Deno edge function, the conversation agent | `supabase/functions/eu-converse/` |
| Data access | One interface, database-first with a static fallback | `js/eu-api.js` |
| Rooms | Five pages in the flat house system | `topics/fellowships/profile/dashboard/uprise-admin.html` |
| Static mirror | Exported from the seed, never hand-edited | `data/eu-topics.json`, `data/eu-fellowships.json` |

---

## 2. The five kinds of people

`eu_profiles.role`, and the whole permission model:

| Role | Who | Can | Cannot |
|---|---|---|---|
| `admin` | Matthew | Everything, including the parts that can't be undone | — |
| `editor` | A fellow with duties | Moderate perspectives, edit and publish listings, fix topic copy, read conversations, draft a campaign | Change anyone's role, send anything outbound, touch the suppression list, delete anything, read contact details, edit the agent's instructions |
| `member` | Anyone who joins | Their own profile, perspectives, saves, application tracker | Anything of anyone else's |
| `host` | Runs a program | All of `member`, plus list their own fellowships | Publish their own listing, mark it verified |
| `client` | An agency client | All of `member`; the same account works across the HERE properties | — |

Self-claimable: `member`, `host`. A host's claim buys no trust it hasn't
earned, because a host's listings are moderated before publication anyway.
`editor`, `admin` and `client` are assigned by the owner.

### The four things an editor deliberately does not get

These are the four ways a platform like this hurts people, so they are the
four the degraded role doesn't have:

1. **Roles.** An editor cannot make another editor, or make themselves the owner.
2. **Sending.** An editor can draft a campaign. Moving it out of `draft` raises an exception, by trigger, for anyone but the owner.
3. **The list.** `eu_profile_contact` — emails, phones, consent flags — returns zero rows to an editor. Reachability is list management; list management is not an editor power.
4. **Deletion.** No delete policy exists for `editor` on any table.

The audit log has **no update policy and no delete policy for anyone,
including the owner.** A log its most powerful user can quietly edit proves
nothing.

### How these are enforced

RLS gates **rows**; it cannot gate a **column**. So the column rules are
triggers, and both layers are tested:

- `eu_profiles_guard` — a member who writes `role: "admin"` stays a member, and the rest of their edit still lands.
- `eu_fellowships_guard` — a host listing is coerced to `pending` / `unverified` / attributed, whatever the client sent.
- `eu_campaigns_guard` — a non-owner moving a campaign out of `draft` raises.

All three step aside when there is **no JWT at all** (the SQL editor, the
service role). That is deliberate: without it, seeding the first editor
from the Supabase SQL editor silently does nothing, which is a very
expensive afternoon. This was found by the test suite, not by reasoning.

---

## 3. The data model

Fourteen tables, all prefixed `eu_` because the house already owns
`campaigns`, `leads` and `engagements`.

**People**
- `eu_profiles` — public by default, controlled by its owner. Handle, name, bio, interests, goals, region, links, visibility.
- `eu_profile_contact` — email, phone, consent flags. **A separate table because RLS hides rows, not columns.** Self + owner only.

**Listening**
- `eu_topics` — slug, neutral framing, documented context, `dimensions` (the structured questions), `prompts` (the open ones), matching tags. Data-driven: a fourth topic is a row, not a deploy.
- `eu_perspectives` — what people said. Anyone may insert; nobody reads the pile back; nothing is public until a human approves it.
- `eu_conversations`, `eu_messages` — the agent threads, plus the human-escalation state.

**The directory**
- `eu_fellowship_sources` — where listings come from (ProFellow and the rest).
- `eu_fellowships` — the listings, with `verification` and `status`.
- `eu_saves`, `eu_applications` — saves and the private application tracker.

**Outreach — built, deliberately not armed**
- `eu_campaigns`, `eu_campaign_recipients`, `eu_suppressions`.

**The record**
- `eu_audit` — append-only.

### Views, and why they exist

RLS can't hide a column, so anything a stranger reads goes through a view
whose `WHERE` clause is the wall:

- `eu_profiles_public` — no contact details ever; location withheld unless the person turned it on.
- `eu_perspectives_public` — approved and consented only, with the identity dropped **at the source** when the person asked for anonymity, rather than trusting a flag some future page remembers to check.
- `eu_counts` — the numbers the public pages print, so a page can never show a figure the database doesn't stand behind.

### The match

`eu_match_fellowships(profile, limit, extra_tags)` — scored in SQL, on
purpose. Matching is a join over tags the database already holds; sending
it to a model would be slower, dearer, and unable to explain itself.

Signal, stacked: what you said you care about (`interests`) + what you
actually spoke on (the tags of topics you filed under) + where you are
(soft). It returns a score **and `reasons`**, so the page says *why* a
program was suggested instead of asking anyone to trust a number.
`extra_tags` lets a signed-out visitor be matched from boxes they ticked
on the page, with no account.

---

## 4. The three topics

Neutrality here is a schema requirement, not a style note. The test each
dimension had to pass: **could a thoughtful person on either side find
their actual view in the options, without picking the one that insults
them?** Where the honest answer was "people disagree about the facts too,"
`context` states what is documented and stops.

| Slug | Name | Matching tags |
|---|---|---|
| `us-israel` | The United States and Israel | foreign-policy, human-rights, diplomacy, middle-east, peacebuilding, national-security, journalism, advocacy |
| `data-centers` | Data centers | energy, land-use, water, utilities, zoning, local-government, climate, labor, ai-policy, infrastructure |
| `surveillance-and-tracking` | Cameras, plate readers, and tracking | civil-liberties, surveillance, privacy, policing, technology, local-government, data-rights, journalism, civic-tech, criminal-justice |

Each carries a tagline, a neutral description, a documented-context block,
two or three dimensions with plainly-worded options, five open prompts,
and the tags above. Full text: `supabase/migrations/0018`.

Editors can fix wording. **Adding, retiring, or re-scoping a topic is the
movement's posture, so it is the owner's call** — and the database refuses
anyone else.

---

## 5. The conversation agent

`supabase/functions/eu-converse/index.ts`. Claude, four real tools, and one
rule set that lives in the function rather than a table — because a
neutrality policy an editor can edit is a neutrality policy that drifts.

**The posture, exactly:** the agent does not hold positions on the topics.
Not "balances" them — doesn't have them. It listens, it states what is
documented and stops, it steelmans any side on request (equally, or not at
all), and it says plainly that it doesn't take sides. It never grades
somebody's politics, with words or with a warmer follow-up to one view
than another.

**Tools:** `find_fellowships` (the same scored match the site uses — so it
can only recommend what exists), `record_signals`, `file_perspective`
(consent required, moderation queue always), `reach_a_human`.

**Hands over to a person** on request, on distress, on anything about
safety, money, or legal exposure, on anything spoken for the movement, and
automatically at 60 messages.

**Model configuration.** `claude-opus-5`, adaptive thinking left on at
`effort: "low"`, with server-side refusal fallbacks enabled. Thinking is
deliberately *not* disabled: on this model, disabling it is the documented
way to get tool calls emitted as plain text, where the call silently never
runs — which here would be an agent that says it filed your perspective
and didn't. Override the model with `EU_AGENT_MODEL`.

---

## 6. Rooms

| Page | Who | What |
|---|---|---|
| `topics.html` | Anyone | Topic hubs. Framing, documented context, structured questions, the open box, the conversation, the record, related programs. |
| `fellowships.html` | Anyone | The explorer, "get matched" with reasons, the sources, and the host listing form. |
| `profile.html` | Anyone / self | Public profile, the people directory, and your own editor + the private contact card. |
| `dashboard.html` | Signed in | Matches, the application tracker, saves, what you've said, your threads, and how to actually get one. |
| `uprise-admin.html` | Editor / owner | Moderation, listings, conversations, topic copy, roles (owner), the log. |

Two shipping facts that shaped all of them:

- **Static fallback is the point.** matthew.mccluster.org is static. Topic hubs and the directory paint from `data/eu-*.json` on the first frame, before any network call, and on the day the site deploys before the migration runs. The database is preferred whenever it answers — the desk edits the database, never the JSON. Regenerate the mirror with `bash tools/eu-export-seed.sh`; it exports through a real Postgres so the two can't drift.
- **No second auth system.** `js/eu-api.js` borrows the session from `js/backend.js` via `window.MCC_SUPA`. Load `backend.js` first.

The desk page draws only the doors that would open. That is a courtesy,
not the wall — every one of them is refused server-side for anyone else.

---

## 7. Owner setup

Roughly twenty minutes, once.

**1. Apply the schema.** Supabase → SQL Editor → run
`supabase/migrations/0017_equity_uprise_platform.sql`, then
`0018_equity_uprise_seed.sql`. Both are idempotent; re-running is safe.
Expect `rls_on = 14, tables = 14` and `topics = 3`.

**2. Make yourself a profile.** Sign in on the site, go to
`profile.html?edit=1`, pick a handle, save. Your account is admin on the
email allowlist regardless — the platform can never lock its owner out.

**3. Make an editor.** `uprise-admin.html` → People & roles → set someone
to `editor`. (From the SQL editor also works — the guards step aside for a
caller with no token.)

**4. Arm the conversation** (optional; everything else works without it):

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy eu-converse --no-verify-jwt
```

`--no-verify-jwt` is required: a signed-out visitor has to be able to
talk. Identity is resolved *inside* the function and thread ownership is
checked on every turn.

**5. Work the directory.** The fourteen seeded programs are real and all
marked **unverified with no deadlines** — nothing was checked against the
source at seed time, and a directory that invents a deadline makes people
miss the real one. Desk work: open the link, confirm it's still running,
set the deadline, mark it verified.

Sweeping a source means working it **by hand or with permission**.
ProFellow and the rest are somebody else's work product; their terms
govern, and "we wrote a scraper" is not a license.

**Run the tests any time:** `bash supabase/tests/run-eu-tests.sh` (needs
postgresql-16 locally; touches nothing remote).

---

## 8. What is deliberately not built

- **Texting.** No provider is chosen, so nothing sends. The tables exist and the approval gate is enforced in the database, so that the day a provider is picked, sending is already safe. Wiring one is: a function that reads `eu_campaign_recipients`, checks `eu_suppressions`, and writes back a status.
- **Automated directory harvesting.** Manual by design — see above.
- **Deadline dates on seeded listings.** Blank until a human confirms them.
- **Editor-editable agent instructions.** The rules live in the function.

## 9. If you change something

- **The seed** → re-run `bash tools/eu-export-seed.sh` so the static mirror matches.
- **Any policy or trigger** → add an assertion to `supabase/tests/eu_platform_test.sql`. The wall is only as good as its proof.
- **A new table** → give it RLS in the same migration. The self-check at the bottom of 0017 counts tables against tables-with-RLS; a gap between the two columns is a table somebody added without a wall behind it.
