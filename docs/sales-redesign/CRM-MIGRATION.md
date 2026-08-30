# CRM migration — from the three-lane selector to the seven configurations

Internal. This is the record of how the old plan selector fed the CRM, what
was moved, and how the new path stays compatible with everything already in
the database.

---

## 1. What the old selector actually did

The selector lived on `sites.html` as a three-position switch (`#swWrap`),
painted from `data/sites.json` → `plans[]`:

| slug | name | price |
|---|---|---|
| `hosting` | Hosting | $87/mo |
| `management` | Web Management | $309/mo |
| `social` | Management + Social | $875/mo |

Its **entire** CRM contribution was one query parameter. `go(i)` set:

```js
goBtn.href = "onboard.html?plan=" + p.slug;
document.getElementById("closeGo").href = "onboard.html?plan=" + p.slug;
```

`onboard.html` then read it (`?plan=` → `S.plan`, persisted in `localStorage`
under `mcc_onboard`), and on submit encoded it as **the first line of a
plain-text body**:

```js
"NEW CLIENT ONBOARDING · " + (p ? p.name + " (" + money(p.price) + "/mo)" : …)
```

posted to Supabase as:

```js
POST /rest/v1/site_requests
{ kind: "onboarding", body: <the plain-text summary> }
```

### The constraint that shaped everything

`supabase/migrations/0008_site_requests.sql` gives `site_requests` a fixed
column set — `id, user_id, kind, body, status, reply, created_at, updated_at`
— and the client RLS policy only permits `insert … with check (user_id =
auth.uid())`. **There was no column for the plan.** The plan reached the desk
only as prose inside `body`, and a human read it off and set
`site_accounts.plan` by hand.

So "the selector's CRM behaviour" is precisely three things:

1. the slug carried on the URL,
2. the first line of `body`,
3. the `{kind, body}` insert shape.

Anything that preserves those three is at parity.

---

## 2. What was moved, and where it lives now

| Old | New | File |
|---|---|---|
| `?plan=<slug>` link | `?offer=<id>` link, **and `?plan=` still resolves** | `js/onboard.js` (boot) |
| `S.plan` in `localStorage` | `S.offer` + `S.mode` under `mcc_onboard_v2` | `js/onboard.js` |
| headline built inline | `legacyHeadline()` | `js/offer-crm.js` |
| `{kind, body}` insert | `post()` with canonical columns + fallback | `js/offer-crm.js` |
| plan identity in prose only | prose **plus** `offer`/`mode`/`config`/`legacy_plan` | `js/offer-crm.js`, migration `0009` |

### The seven configurations and their legacy mapping

Declared once, in `data/offers.json` → `crm.configurations`:

| config | offer | mode | legacy_plan |
|---|---|---|---|
| `runway` | `runway` | *(null)* | `hosting` |
| `anti-social.m` | `anti-social` | `m` | `social` |
| `anti-social.equity` | `anti-social` | `equity` | `social` |
| `who-did-the-shoot.m` | `who-did-the-shoot` | `m` | — |
| `who-did-the-shoot.equity` | `who-did-the-shoot` | `equity` | — |
| `write-a-song.m` | `write-a-song` | `m` | — |
| `write-a-song.equity` | `write-a-song` | `equity` | — |

**Why those legacy mappings.** Runway replaces the $87 Hosting plan for new
customers, so it inherits `hosting`. Anti-Social is the merged service and its
approved standard price ($875) is the same figure the `social` plan carried, so
both its modes map to `social`; `management` ($309) priced website management
alone and therefore maps to nothing new — it survives only as a grandfathered
record. Production and campaign work never had a lane, so they carry `null`
rather than being forced into a slug that would corrupt reporting.

Runway carries `mode: null`, not `mode: "m"` — it has no Equity version, so it
has no mode to choose. Migration `0009` enforces this at the table with
`check (not (offer = 'runway' and mode = 'equity'))`.

---

## 3. The submission, and its two fallbacks

`js/offer-crm.js` builds:

```
NEW CLIENT ONBOARDING · Anti-Social — Equity Uprise ($437.50/month)   ← legacy first line, unchanged in shape
CONFIG: anti-social.equity                                            ← identity, readable even without 0009
OFFER: anti-social
MODE: equity
LEGACY-PLAN: social

<every answer, one per line>
```

and posts `{kind, body, offer, mode, config, legacy_plan}`.

Degradation, in order:

1. **Canonical insert.** Succeeds where migration `0009` has been applied.
2. **Legacy insert.** If PostgREST answers `400/404/422` with a schema
   complaint (`PGRST204`, "Could not find the 'config' column … in the schema
   cache"), it retries with exactly `{kind, body}` — the pre-existing shape,
   which works against the database as it stands today. The identity is not
   lost, because it is also inside the body header.
3. **Email.** If the wire is down entirely, the UI hands back a `mailto:` with
   the identical body.

A genuine failure — a `403`, an RLS rejection — is **not** swallowed by the
fallback. `isSchemaError()` only matches schema complaints; everything else
rejects and surfaces to the user. This is covered by a test.

**This means migration `0009` is not a deploy blocker.** Ship the pages, apply
the migration whenever convenient; submissions work either way, and start
populating the new columns the moment it lands.

---

## 4. What was deliberately not changed

- **`site_requests.kind` stays `"onboarding"`.** `console.html` reads
  `select=kind,body,status,reply,created_at` and prints `kind` directly. A new
  value would have shown up as a stray word in the client's own console.
- **`body` stays plain text, first line unchanged in shape.** Every existing
  row is prose; anything that parsed the old headline still parses this one.
- **`site_accounts.plan` keeps its legacy slug and its meaning.** It is what a
  client is *billed* under. Grandfathered $87 and $309 agreements keep their
  slug and their price. `0009` adds `config` beside it for what a client
  *bought* — the two coexist, and nothing reprices an existing agreement.
- **`data/sites.json` still ships**, and `plans[]` still holds all three legacy
  plans. It feeds the founding seats, the showcase and the terms on
  `sites.html`, and it remains the historical price record. It no longer drives
  any public price control.
- **`js/crm.js`** (the anonymous `leads` table used by the Lock-in sheet on
  other pages) is untouched. It was never part of the plan path.

---

## 5. Parity evidence

From `t-crm.mjs`, all passing:

- all seven configurations produce the right `config`/`offer`/`mode`/`legacy_plan`
- `kind` is `"onboarding"` in every case
- the legacy `NEW CLIENT ONBOARDING · …` first line is present in every case
- the identity survives inside `body` in every case
- `body` stays inside the table's `char_length between 3 and 4000` check
- unapproved Equity terms produce **no** number in the headline
- a schema error retries once, with exactly `{kind, body}`
- a `403` rejects rather than reporting success
- `?plan=hosting|management|social` still land on the right offer
- `?offer=runway&mode=equity` is ignored; Runway files with `mode: null`

From `t-e2e-shots.mjs`: the complete Runway path was driven through the real UI
and filed one submission with `config: "runway"`, `legacy_plan: "hosting"`,
`mode: null`, and the legacy headline intact.

---

## 6. Order of operations, for the record

The old selector was removed **after** the above passed, not before. The
sequence was: build the ledger → build `offer-crm.js` → wire the new
onboarding → prove all seven paths → then delete `#swWrap` and its painter
from `sites.html`. `sites.html` and `hire.html` now carry one pricing system
between them.
