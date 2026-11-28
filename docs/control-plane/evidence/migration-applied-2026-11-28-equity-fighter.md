# Production apply receipt: 2026-11-28, Equity Fighter storage and Core job indexes

Approved by the owner in the project thread on 2026-11-28 ("Apply all three" on the decision card asking to apply
the three staged database changes). Applied to Supabase `zmnhbrjyhxzhkxmhkexs` through the Supabase MCP.

| Ledger version | Name | Was | Now |
| --- | --- | --- | --- |
| `20261128094143` | `ai_context_dispatch_v1` | `supabase/pending/20261124235900_ai_context_dispatch_v1.sql` | `supabase/migrations/20261128094143_ai_context_dispatch_v1.sql` |
| `20261128094204` | `equity_fighter_chat_v1` | `supabase/pending/20261125003000_equity_fighter_chat_v1.sql` | `supabase/migrations/20261128094204_equity_fighter_chat_v1.sql` |
| (outside the ledger) | `ops_agent_jobs_recency_indexes_v1` | `supabase/pending/ops_agent_jobs_recency_indexes_v1.sql` | stays there: `CREATE INDEX CONCURRENTLY`, run statement by statement |

Rollbacks stay in `supabase/pending/` under their original names.

## Checks after apply

* `supabase_migrations.schema_migrations`: 391 rows; the two new rows are the only ones after `20261124164904`.
* Stored statement equals the committed file byte for byte except the file's final newline
  (md5 `46e72cf965b7594e4ef8479dc1e5159d` and `0aaa3c75a7355ca0bb753e3baa904371`).
* `ai_context.dispatch_turns`, `public.ef_identities`, `ef_messages`, `ef_runs`, `ef_steps` exist with RLS on;
  `anon` and `authenticated` have no select on `ef_*`; `anon` cannot execute `public.ops_ai_dispatch_record`;
  `control_capabilities` has `dispatch.execute`.
* `ops_agent_jobs_org_recent_idx` and `ops_agent_jobs_org_type_recent_idx` are valid; the reflection health read
  (`job_type = 'host_health' and status = 'done' order by updated_at desc limit 1`) is an index scan, 1.4 ms.
* `node scripts/control-plane-drift-contract-check.mjs`: ok, with `supabase/production-ledger.json` and
  `core/drift-contract.json` at 391 / `20261128094204` / `3638928f45e4d4f4553134e4560484d5267e1fb904d05836ea3d412e49bd1370`.

Nothing else changed: no data rows, no existing object, no Worker or Core deploy.
