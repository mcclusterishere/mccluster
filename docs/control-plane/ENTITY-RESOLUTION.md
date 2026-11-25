# Entity resolution (automated duplicate-record matching)

Status: **pending owner approval.** The SQL is in `supabase/pending/` and has not been applied to production.
Until it is applied, the `core.entity.match.*` tools fail at the database. Nothing else changes.

## What it builds on

Manual entity resolution already exists (`universal_ingestion_entity_resolution_v1`):
`public.ops_entity_aliases`, `public.ops_entity_resolution_events` and `ops_entity_resolve_service`, which the owner calls
through `core.entity.resolve` one alias at a time. This layer automates finding duplicates. It writes into the same
resolution event log (namespace `ontology.same_as`), so manual and automatic decisions sit in one history.

## How a scan works

1. **Settle first.** Approvals the owner already approved or denied in Control are applied, so a scan never asks twice.
2. **Read objects.** It pages `public.ops_ontology_objects` in the person family (person, contact, client, lead,
   customer, prospect, artist, creator, member, attendee and similar) and the company family (company, business, venue,
   vendor, partner, sponsor, brand, school, church and similar). `organization` is excluded because that type is a
   McCluster tenant. Objects are compared only within one family, so a lead can match a client but never a venue.
   Type keys that do not exist yet are simply empty. As the ontology gains these types, the scan covers them with no change.
3. **Deterministic match keys.** These are built from the object's properties (common spellings and nested `contact` blocks):
   - **email**: lowercased, `+tag` removed, Gmail dots removed, googlemail folded to gmail. Shared inboxes
     (`info@`, `booking@` and so on) are a weaker `role_email` key.
   - **phone**: digits only, 10-digit North American numbers get `+1`, extensions dropped, junk like 555-555-5555 ignored.
   - **domain**: from website, domain or URL, and for companies also from email. Free-mail domains are never keys.
   - **name + organization**: accents folded, honorifics, suffixes and legal forms (Inc, LLC, The) removed.
   - **block keys**: surname plus first initial, or a company-name prefix. These only decide which pairs get a fuzzy comparison.
   A key shared by more than 50 records is treated as a placeholder. It is skipped and reported, and it is not used as evidence.
4. **Fuzzy score.** Evidence weights combine as a noisy-OR, then penalties are applied:

   | Evidence (person) | Weight | Evidence (company) | Weight |
   |---|---|---|---|
   | same email | 0.97 | same domain | 0.90 |
   | same phone | 0.92 | same phone | 0.85 |
   | same name and organization | 0.85 | same email | 0.80 |
   | same name | 0.50 | same name | 0.80 |
   | Jaro-Winkler name >= 0.92 | 0.40 | Jaro-Winkler name >= 0.92 | 0.50 |
   | same role inbox | 0.50 | | |

   The penalties are:
   - **Name conflict, x0.85.** The names share a surname but have incompatible first names ("Jordan Lee" and "Morgan Lee").
   - **Email conflict, x0.90.** Both records have personal emails and none match.
   - **Domain conflict, x0.85.** Both companies have domains and none match.
5. **Bands.** The database applies these again and does not trust the caller:

   | Score | Strong exact key (email, phone or domain) | Outcome |
   |---|---|---|
   | >= 0.950 | yes | **Linked automatically.** The decision is recorded as `executed`, method `rule` |
   | >= 0.950 | no | Owner review |
   | 0.750 to 0.949 | any | **Owner review.** A pending `control_approvals` row (capability `entity.resolve`, resource `entity_match`) is created and expires in 14 days |
   | < 0.750 | any | Not recorded |

   A caller may raise these thresholds for a cautious run but can never lower them.

## Never destructive

- A link is a row in `ai_context.entity_matches` with status `linked`. No ontology object, alias or source record is
  updated, merged or deleted.
- `core.entity.match.unlink` (owner only, reason required) turns `linked` into `unlinked`, or turns `pending_review` into
  `rejected` and denies its approval. History is kept, and a scan never proposes a rejected or unlinked pair again.
- Every state change writes three rows in one transaction:
  - an `ai_context.decisions` row, with metadata `ingress: entity_resolution`, the match id, from/to status, score and request hash;
  - an `ops_entity_resolution_events` row;
  - an `ai_context.entity_match_events` row.
- Evidence stores key kinds, weights and a 16-character hash of the matched value. It never stores the raw email or phone number.
- An approval links only when its `request_hash` equals the match's hash (the same pair, score, evidence kinds and matcher version).

## Tools (Core, `core/src/tools/entity-match.mjs`)

| Tool | Who | What |
|---|---|---|
| `core.entity.match.scan` | owner | Runs a scan. `dry_run: true` previews and writes nothing. `queue: true` queues the `entity_match_scan` Core job (`core/src/executors/entity-match-scan.mjs`) |
| `core.entity.match.list` | house | Lists matches by status |
| `core.entity.match.cluster` | house | Returns everything transitively linked to one object |
| `core.entity.match.settle` | owner | Applies Control decisions now |
| `core.entity.match.unlink` | owner | The reverse switch |

These tools are not on the remote MCP allowlist (`workers/mccluster-mcp/src/mcp.js`). Adding them there is a separate
Worker change that would need its own review and deploy.

## Database (`supabase/pending/20261125001000_ai_context_entity_resolution_v1.sql`)

- Tables: `ai_context.entity_match_runs`, `ai_context.entity_matches` and `ai_context.entity_match_events`. RLS is on, there are no policies, and there are no grants.
- Functions: `public.ops_entity_match_objects`, `_record`, `_settle`, `_unlink`, `_list` and `_cluster`. They are SECURITY DEFINER with search_path pinned, and only service_role can execute them.
- The file runs as one transaction and is safe to run twice. Rollback is `20261125001000_ai_context_entity_resolution_v1.rollback.sql`.
  It drops only the new objects, expires pending match approvals, and keeps all decisions, resolution events and approvals.

## Tests

- `core/test/entity-resolution.test.mjs` uses fixtures (`core/test/fixtures/entity-resolution/objects.json`) to cover
  normalization, keys, scores, bands, the threshold floor, oversized blocks, the scan flow, the tools, the executor and the catalog.
- `core/test/entity-resolution-db.test.mjs` runs the Core scan end to end against the real pending SQL in PGlite
  (set `PGLITE_MODULE`; it is skipped otherwise).
- `supabase/tests/ai_context_entity_resolution.behaviour.sql` holds the database guarantees. CI runs it
  (`.github/workflows/ai-context-entity-resolution-db.yml`) on PostgreSQL 16 with stub, apply twice, behaviour and rollback.

## To go live (owner)

1. Approve and apply the pending SQL.
2. Merge the pull request. Merging deploys Core on OVH.
3. Run `core.entity.match.scan` with `dry_run: true` and look at the preview.
4. Run it for real. Afterwards, review the pending matches in Control.
