-- GATED AUDIO — the masters that an M Account unlocks.
--
-- The site is a static host. Anything committed under assets/ is public the
-- moment it deploys, so a gated master cannot live in the repository at all;
-- only the short preview cut does. The master lives here, in a private
-- bucket, and the browser never gets a URL for it without a session:
-- storage.objects RLS is what actually enforces the gate, not the player.
--
-- The listener's own access token signs the URL. The service key is never
-- shipped to a browser and is only used by the owner's upload script.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mcc-gated-audio',
  'mcc-gated-audio',
  false,
  524288000,                                  -- 500 MB: masters, not previews
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/flac']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- READ: any signed-in listener. Making the account IS the gate — there is no
-- second entitlement to buy, and nothing here charges anyone. A free account
-- is the whole price, so the policy checks authentication and stops.
--
-- to authenticated is doing the work. anon holds the publishable key too, and
-- leaving this to `using (true)` for public would hand the master to every
-- visitor and quietly make the gate decorative.
drop policy if exists "gated audio is readable by signed-in listeners" on storage.objects;
create policy "gated audio is readable by signed-in listeners"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'mcc-gated-audio');

-- WRITE: nobody, from a browser. No insert/update/delete policy is created,
-- so the only writer is the service role, which bypasses RLS and lives on the
-- owner's machine in scripts/publish-gated-track.mjs. A listener who can read
-- a master must never be able to replace one.
