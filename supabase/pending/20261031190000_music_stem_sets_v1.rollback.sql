-- Rollback for 20261031190000_music_stem_sets_v1.sql.
-- Drops the manifest table. The stem audio stays in mcc-gated-audio/stems/ (private);
-- remove it from Storage separately if the owner wants it gone.
update public.ops_agent_jobs set status = 'failed', last_error = 'stems rolled back'
 where job_type = 'stems_separate' and status = 'queued';
drop table if exists public.music_stem_sets;
