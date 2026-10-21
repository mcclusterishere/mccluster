-- Replay-safe backfill of the existing coarse region fields projected by v3.
-- Production was already backfilled after v3, outside its schema-lock transaction.
-- This version ensures other databases replay the same historical coverage.
update public.events_lean l
set region=nullif(btrim(e.region),''),
    region_code=nullif(upper(e.edge->>'cf-region-code'),'')
from public.events e
where l.id=e.id and l.region is null and l.region_code is null
  and (nullif(btrim(e.region),'') is not null or nullif(upper(e.edge->>'cf-region-code'),'') is not null);
