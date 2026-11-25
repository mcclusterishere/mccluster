-- Behaviour of supabase/pending/mnet_character_cast_v1.sql (run by scripts/test-mnet-character-cast-db.sh).
\set ON_ERROR_STOP on
insert into public.orgs(id, slug) values ('00000000-0000-4000-8000-000000000001', 'mccluster');
insert into public.platform_profiles(mccluster_id) values ('chr.lin-qiao');

-- 1. Browser roles cannot provision, publish or read receipts.
do $$ begin
  set local role anon;
  begin perform public.ops_character_provision('00000000-0000-4000-8000-000000000001','mara-costa','Mara Costa','h','b',2,'{}'); raise exception 'anon provisioned';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.ops_character_publications; raise exception 'anon read receipts';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  set local role authenticated;
  begin perform public.ops_character_publish_post('00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'chr.mara-costa', 'doing', 'Hello from the tea counter today.', null, null, 'm'); raise exception 'authenticated published';
  exception when insufficient_privilege then null; end;
end $$;

set role service_role;
-- 2. Provisioning: a person, a public profile, a DISABLED actor; repeat updates in place; occupied handles refuse.
do $$ declare r jsonb; begin
  r := public.ops_character_provision('00000000-0000-4000-8000-000000000001','mara-costa','Mara Costa','Owner · tea','Blunt and hospitable.',2,'{"name":"Mara Costa"}');
  assert r->>'provisioned' = 'true' and r->>'enabled' = 'false', r::text;
  r := public.ops_character_provision('00000000-0000-4000-8000-000000000001','mara-costa','Mara Costa','Owner · the tea counter','Blunt.',3,'{"name":"Mara Costa"}');
  assert r->>'updated' = 'true', r::text;
  assert (select headline from public.network_profiles p join public.ops_platform_actors a using (m_uid) where a.actor_key = 'chr.mara-costa') = 'Owner · the tea counter';
  assert (select persona->>'actor_kind' = 'character' and persona->>'character_id' = 'mara-costa' and daily_limit = 3 and not enabled from public.ops_platform_actors where actor_key = 'chr.mara-costa');
  assert (select visibility = 'public' and allow_messages_from = 'none' and categories = array['character'] from public.network_profiles p join public.ops_platform_actors a using (m_uid) where a.actor_key = 'chr.mara-costa');
  perform public.ops_character_provision('00000000-0000-4000-8000-000000000001','eli-mensah','Eli Mensah','Stock','Exact.',2,'{}');
  begin perform public.ops_character_provision('00000000-0000-4000-8000-000000000001','lin-qiao','Lin Qiao','h','b',2,'{}'); raise exception 'occupied handle provisioned';
  exception when raise_exception then assert sqlerrm like '%already occupied%', sqlerrm; end;
  begin perform public.ops_character_provision('00000000-0000-4000-8000-000000000001','Bad Id','x','h','b',2,'{}'); raise exception 'bad id provisioned';
  exception when raise_exception then null; end;
end $$;
reset role;
-- A member, a member post, a news article, and Royce-style actor that is not a character.
insert into public.m_people(id) values ('00000000-0000-4000-8000-00000000aaaa');
insert into public.network_posts(id, author_m_uid, body) values ('00000000-0000-4000-8000-00000000bbbb', '00000000-0000-4000-8000-00000000aaaa', 'A member post');
insert into public.media_news_articles(id, title, published_at) values ('00000000-0000-4000-8000-00000000cccc', 'City adds new bus routes downtown', now() - interval '2 hours');
insert into public.media_news_articles(id, title, published_at) values ('00000000-0000-4000-8000-00000000dddd', 'Old story', now() - interval '5 days');
insert into public.ops_agent_jobs(id, org_id, job_type, target_id, status, input) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'character_post', 'mnet-cast', 'running', '{"characters":["mara-costa","eli-mensah"]}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'character_post', 'mnet-cast', 'running', '{"characters":["mara-costa","eli-mensah"]}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'character_post', 'mnet-cast', 'running', '{"characters":["eli-mensah"]}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'character_post', 'mnet-cast', 'running', '{"characters":["mara-costa"]}');

set role service_role;
do $$ declare r jsonb; mara_post uuid; begin
  -- 3. Disabled actors do not post.
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','chr.mara-costa','doing','Made a new blend today. If you hate it, I make you another.',null,null,'desk');
  assert r->>'reason' = 'actor_paused', r::text;
  update public.ops_platform_actors set enabled = true where persona->>'actor_kind' = 'character';
  -- 4. A doing post: public, typed, receipt; the same job replays.
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','chr.mara-costa','doing','Made a new blend today. If you hate it, I make you another.',null,null,'desk');
  assert r->>'published' = 'true' and r->>'replayed' = 'false', r::text;
  mara_post := (r->>'post_id')::uuid;
  assert (select metadata->>'actor_kind' = 'character' and metadata->>'character_id' = 'mara-costa' and visibility = 'public' and post_type = 'update' from public.network_posts where id = mara_post);
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','chr.mara-costa','doing','Different text, same job.',null,null,'desk');
  assert r->>'replayed' = 'true' and (r->>'post_id')::uuid = mara_post, r::text;
  -- 5. Replies: another character's post yes (as a comment); a member's post or its own post no.
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','chr.eli-mensah','reply','Mara, I counted the tins. We have enough for the blend.',null,mara_post,'desk');
  assert r->>'published' = 'true' and r->>'comment_id' is not null, r::text;
  assert (select count(*) from public.network_post_comments where post_id = mara_post) = 1;
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','chr.eli-mensah','reply','Replying to a member is not allowed here.',null,'00000000-0000-4000-8000-00000000bbbb','desk');
  assert r->>'reason' = 'reply_target_unavailable', r::text;
  -- 6. News: a retained recent headline once per character; stale headlines refuse.
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','chr.mara-costa','news','New bus routes downtown. Customers can finally reach the counter.','00000000-0000-4000-8000-00000000cccc',null,'desk');
  assert r->>'published' = 'true', r::text;
  begin
    r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','chr.eli-mensah','news','Old news reaction that should fail now.','00000000-0000-4000-8000-00000000dddd',null,'desk');
    raise exception 'stale article accepted';
  exception when raise_exception then
    if sqlerrm not like '%recent retained article%' then raise; end if;
  end;
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000104','chr.mara-costa','news','Same headline again, new job.','00000000-0000-4000-8000-00000000cccc',null,'desk');
  assert r->>'reason' = 'already_reacted', r::text;
end $$;
do $$ declare r jsonb; begin
  -- 7. The job must name the character; daily limit holds.
  begin
    r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','chr.mara-costa','doing','Mara is not in this job at all.',null,null,'desk');
    raise exception 'unlisted character published';
  exception when insufficient_privilege then null; end;
  update public.ops_platform_actors set daily_limit = 1 where actor_key = 'chr.eli-mensah';
  r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','chr.eli-mensah','doing','Counted 212 tins today. There is no launch.',null,null,'desk');
  assert r->>'reason' = 'daily_limit', r::text;
  -- 8. Only story characters use this path.
  begin
    r := public.ops_character_publish_post('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','royce.r01','doing','Not a character.',null,null,'desk');
    raise exception 'non-character published';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'mnet_character_cast behaviour: ok' as result;
