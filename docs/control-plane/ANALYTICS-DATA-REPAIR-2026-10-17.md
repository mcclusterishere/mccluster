# Analytics data repair — 2026-10-17

The production visit at 03:01 UTC returned 404 for `analytics_country_totals`
and `intel_geo_projection`. The shipping Analytics loader treats either failed
read as partial data. Both dependencies existed only as pending SQL.

Applied the existing migrations, without changing their SQL:

| Version | Migration | Restores |
| --- | --- | --- |
| 20261017030551 | analytics_country_v1 | Country totals and country trend |
| 20261017030554 | analytics_region_v1 | State/province counts after country selection |
| 20261017030617 | intel_mission_canon_v1 | Intelligence projection and its canonical backing schema |

The ledger now matches all 314 production migrations. Applied files retain their
original comments to match production statements byte for byte. MD5 comparison
against the stored statements passed for all three.

## Verification

- Country and region behavior suites passed in isolated PGlite PostgreSQL,
  including bot exclusion, date/site scoping, RLS and anonymous denial.
- Intelligence behavior suite passed, including rollback and reapply. PGlite
  omits the unused `CREATE EXTENSION pgcrypto` declaration; production applied
  the original SQL unchanged. UUID and hash operations use PostgreSQL built-ins.
- Production reads returned 7 countries and 208 located page views over the
  checked 24-hour window, 24 US trend buckets totaling 185 page views, and
  4 region rows totaling the same 185 views. Counts are time-dependent.
- Production owner intelligence projection executed successfully. The evidence
  store has zero records; this is an empty dataset, not a failed read.
- Live `/v1/intel/geo?cell=10&bucket=day` returned HTTP 200 and `ok: true`.
- Security advisor review: `intel_is_org_admin` is intentionally executable by
  authenticated users as the boolean RLS helper. It checks `auth.uid()` against
  org membership; server mutation functions remain service-role-only.

No analytics events were rewritten. No collector was enabled and no missions
were published. No browser credential was used; full signed-in visual confirmation
is separate from the production query and endpoint checks above.

Rollback instructions remain in the SQL headers and the existing intelligence
rollback file. Do not run the intelligence rollback after records are created
without reviewing and exporting the affected data first.
