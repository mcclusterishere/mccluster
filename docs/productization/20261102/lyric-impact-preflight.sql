-- Aggregate-only SELECT. No writes, function creation, customer identifiers or lyrics returned.
-- Mirrors music_lyric_public_payload at 9d7a7eed (blob 4d477401...).
with documents as (
 select id, 'lyrics' as location, lyrics as payload from public.creator_tracks
 union all
 select id, 'snapshot', reviewed_snapshot->'lyrics' from public.creator_tracks where reviewed_snapshot ? 'lyrics'
), normalized as (
 select d.id,d.location,d.payload,
 case when jsonb_typeof(d.payload) is distinct from 'object' then null else
   coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(d.payload) e
     where (e.key in ('title','artist','language','plain') and jsonb_typeof(e.value)='string')
        or (e.key='duration_seconds' and jsonb_typeof(e.value)='number')),'{}'::jsonb)
   || case when jsonb_typeof(d.payload#>'{timed,line}')='array' then
     jsonb_build_object('timed',jsonb_build_object('line',t.lines),'plain',t.plain) else '{}'::jsonb end
 end as clean
 from documents d
 cross join lateral (
   select coalesce(jsonb_agg(q.line order by q.n),'[]'::jsonb) as lines,
          coalesce(string_agg(q.line->>'content',E'\n' order by q.n),'') as plain
   from (
     select l.n,
       jsonb_build_object('content',l.value->'content','begin',l.value->'begin')
       || case when jsonb_typeof(l.value->'end')='number' then jsonb_build_object('end',l.value->'end') else '{}'::jsonb end
       || case when jsonb_typeof(l.value->'words')='array' then jsonb_build_object('words',
         coalesce((select jsonb_agg(jsonb_build_object('content',w.value->'content','begin',w.value->'begin','end',w.value->'end') order by w.n)
           from jsonb_array_elements(l.value->'words') with ordinality w(value,n)
           where jsonb_typeof(w.value->'content')='string' and jsonb_typeof(w.value->'begin')='number' and jsonb_typeof(w.value->'end')='number'),'[]'::jsonb)) else '{}'::jsonb end as line
     from jsonb_array_elements(case when jsonb_typeof(d.payload#>'{timed,line}')='array' then d.payload#>'{timed,line}' else '[]'::jsonb end) with ordinality l(value,n)
     where jsonb_typeof(l.value->'content')='string' and jsonb_typeof(l.value->'begin')='number'
   ) q
 ) t
), affected as (
 select distinct id from normalized
 where (location='lyrics' and payload is distinct from clean)
    or (location='snapshot' and payload is distinct from coalesce(clean,'null'::jsonb))
)
select count(*) as total_tracks,
 count(*) filter(where a.id is not null) as affected_tracks,
 count(*) filter(where a.id is not null and t.status in ('approved','published')) as releases_returning_to_review,
 count(*) filter(where a.id is not null and t.rights_status='cleared') as rights_returning_to_review,
 count(*) filter(where a.id is not null and t.published_at is not null) as publication_timestamps_cleared
from public.creator_tracks t left join affected a on a.id=t.id;
