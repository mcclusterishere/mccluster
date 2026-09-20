-- Exact production migration 20260920035720.
-- Private owner catalogue bucket used by account-gated playback and ringtone delivery.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mcc-gated-audio',
  'mcc-gated-audio',
  false,
  524288000,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/flac']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "gated audio is readable by signed-in listeners" on storage.objects;
create policy "gated audio is readable by signed-in listeners"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'mcc-gated-audio');
