# Letter B — add the missing shelves

The Worker is live. Supabase already exists (`zmnhbrjyhxzhkxmhkexs`).
`/v1/apps` fails because table `platform_apps` is not in that project yet.
The SQL is already written. It was never pasted into the live database.

## You do this once. About two minutes.

1. Open https://supabase.com/dashboard/project/zmnhbrjyhxzhkxmhkexs/sql/new
2. Open this file in GitHub:
   https://github.com/mcclusterishere/mccluster/blob/main/supabase/migrations/0034_mccluster_platform_core.sql
3. Copy the whole file.
4. Paste into the SQL editor. Click Run.
5. If it yells that `orgs` or `is_org_member` does not exist, run this first, then run 0034 again:
   https://github.com/mcclusterishere/mccluster/blob/main/supabase/migrations/0026_tenancy.sql
6. Open https://api.mccluster.org/v1/apps
   You want a JSON list of apps, not a 500.

Do not create a second Supabase project.
Do not put this SQL in Cloudflare.
The Worker already knows how to read these tables once they exist.
