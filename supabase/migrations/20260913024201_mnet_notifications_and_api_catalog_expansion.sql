insert into public.api_products(product_key,name,description,unit_name,default_unit_cost,metadata) values
 ('platform.apps','Platform Apps API','Registered McCluster applications and product families','credit',1,'{"category":"platform"}'::jsonb),
 ('platform.fees','Platform Fee Quote API','Server-authoritative fee and economic quote calculations','credit',1,'{"category":"platform"}'::jsonb),
 ('ai.harness','AI Harness API','McCluster AI model routing and agent harness operations','credit',5,'{"category":"ai","provider_backed":true}'::jsonb),
 ('media.generate','Media Generation API','Image/video/media generation and orchestration','credit',25,'{"category":"media","provider_backed":true}'::jsonb),
 ('social.publish','External Social Publishing API','Publishing and analytics operations for connected external social accounts','credit',5,'{"category":"social"}'::jsonb),
 ('seekfirst.data','Seek First Data API','Spatial/public-data intelligence queries','credit',3,'{"category":"data"}'::jsonb),
 ('whip.platform','Whip Platform API','Whip rider, driver, rental and mobility application services','credit',2,'{"category":"mobility"}'::jsonb)
on conflict (product_key) do update set name=excluded.name,description=excluded.description,unit_name=excluded.unit_name,default_unit_cost=excluded.default_unit_cost,metadata=excluded.metadata,updated_at=now();

create or replace function public.mnet_notify_follow() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='following' and new.follower_m_uid <> new.followed_m_uid then
    insert into public.network_notifications(recipient_m_uid,actor_m_uid,type,object_type,object_id,body,metadata)
    values(new.followed_m_uid,new.follower_m_uid,'follow','person',new.follower_m_uid::text,'started following you','{}'::jsonb);
  end if; return new;
end $$;
revoke all on function public.mnet_notify_follow() from public,anon,authenticated;
drop trigger if exists mnet_notify_follow_trg on public.network_follows;
create trigger mnet_notify_follow_trg after insert or update of status on public.network_follows for each row execute function public.mnet_notify_follow();

create or replace function public.mnet_notify_reaction() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid;
begin
  select author_m_uid into recipient from public.network_posts where id=new.post_id;
  if recipient is not null and recipient <> new.actor_m_uid then
    insert into public.network_notifications(recipient_m_uid,actor_m_uid,type,object_type,object_id,body,metadata)
    values(recipient,new.actor_m_uid,'reaction','post',new.post_id::text,'reacted to your post',jsonb_build_object('reaction',new.reaction));
  end if; return new;
end $$;
revoke all on function public.mnet_notify_reaction() from public,anon,authenticated;
drop trigger if exists mnet_notify_reaction_trg on public.network_reactions;
create trigger mnet_notify_reaction_trg after insert on public.network_reactions for each row execute function public.mnet_notify_reaction();

create or replace function public.mnet_notify_reply() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid;
begin
  if new.reply_to_id is not null then
    select author_m_uid into recipient from public.network_posts where id=new.reply_to_id;
    if recipient is not null and recipient <> new.author_m_uid then
      insert into public.network_notifications(recipient_m_uid,actor_m_uid,type,object_type,object_id,source_app_id,body,metadata)
      values(recipient,new.author_m_uid,'reply','post',new.id::text,new.source_app_id,'replied to your post',jsonb_build_object('parent_post_id',new.reply_to_id));
    end if;
  end if; return new;
end $$;
revoke all on function public.mnet_notify_reply() from public,anon,authenticated;
drop trigger if exists mnet_notify_reply_trg on public.network_posts;
create trigger mnet_notify_reply_trg after insert on public.network_posts for each row execute function public.mnet_notify_reply();
