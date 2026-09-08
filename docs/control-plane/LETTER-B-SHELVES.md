# Letter B — add the missing shelves

The Worker is live. Supabase already exists (`zmnhbrjyhxzhkxmhkexs`).
`GET /v1/apps` already returns the house apps, so the 0034 shelf is in.
If that route ever 500s again, paste 0034 (and 0026 first if it yells
about `orgs` / `is_org_member`).

Do not create a second Supabase project.
Do not put this SQL in Cloudflare.
The Worker already knows how to read these tables once they exist.


## Next shelf — AI harness (2026-09-08)

The Worker routes and Edge Function are in git. The private schema is not
in the live database until you paste it.

1. Open https://supabase.com/dashboard/project/zmnhbrjyhxzhkxmhkexs/sql/new
2. Paste and run these four files, in order:
   - `supabase/migrations/20260908221900_ai_harness.sql`
   - `supabase/migrations/20260908221901_ai_harness_ops.sql`
   - `supabase/migrations/20260908221902_ai_harness_ingest.sql`
   - `supabase/migrations/20260908221903_ai_harness_rpc.sql`
3. Open https://api.mccluster.org/v1 — you want a JSON catalog, not 404.
4. Signed in as house owner, `GET /v1/ai/status` should return `{ ok: true, schema: "ai_context" }`.

Do not create a second Supabase project.
Do not put raw conversations in git.
