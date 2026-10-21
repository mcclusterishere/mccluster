-- INSTAGRAM OUTBOX: videos waiting to be posted, kept private.
--
-- Posting to Instagram goes through Meta's official API (the publisher in
-- workers/mccluster/src/social/meta.js), not through a phone tapping the
-- app: Instagram's terms forbid automated use of the app, the API is the
-- sanctioned route, and it allows 100 posts a day.
--
-- A video for a post is uploaded here before it goes out. The bucket is
-- private: a draft is not public until it is approved and posted. When the
-- publisher sends it, it signs a short-lived link for Meta to fetch. The
-- Worker writes and signs with the service role, so no member policy is
-- needed and none is granted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-outbox', 'social-outbox', false, 524288000,
        array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A publish job can now wait as a draft until the owner approves it, or be
-- cancelled. The claim function only ever picks up queued and processing
-- jobs, so a draft can never be sent by the cron.
alter table public.social_publish_jobs drop constraint if exists social_publish_jobs_state_check;
alter table public.social_publish_jobs add constraint social_publish_jobs_state_check
  check (state in ('draft', 'queued', 'processing', 'published', 'failed', 'cancelled'));
