-- Before rollback: switch COURSE_STUDIO_ENABLED off and drain the isolated job type.
-- Deliberately refuses to destroy any course record. Archive separately with owner's approval.
begin;
lock table public.learning_studio_courses in access exclusive mode;
do $$ begin if exists(select 1 from public.learning_studio_courses) then raise exception 'Course records exist; refusing destructive rollback'; end if; end $$;
drop function public.learning_studio_submit(uuid,uuid,text,text,text,text,jsonb),public.learning_studio_finish(uuid,uuid,text,integer,jsonb),public.learning_studio_answer(uuid,uuid,integer,integer),public.learning_studio_retry(uuid,uuid);
drop view public.learning_studio_summary;
drop table public.learning_studio_courses;
commit;
