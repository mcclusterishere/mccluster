-- Covering indexes for foreign keys the performance advisor flagged after
-- the Mission Engine and scheduled-posts tables went live. All four tables
-- are new and small, so these build instantly.
create index if not exists action_missions_campaign_id_idx on public.action_missions(campaign_id) where campaign_id is not null;
create index if not exists action_cohorts_campaign_id_idx on public.action_cohorts(campaign_id) where campaign_id is not null;
create index if not exists action_proofs_user_id_idx on public.action_proofs(user_id);
create index if not exists network_scheduled_posts_post_id_idx on public.network_scheduled_posts(post_id) where post_id is not null;
