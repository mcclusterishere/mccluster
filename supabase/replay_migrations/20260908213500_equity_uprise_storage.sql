-- Service-written storage. Public final publication assets are intentionally
-- world-readable; source snapshots and internal research remain private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('equity-uprise-public','equity-uprise-public',true,52428800,array['text/html','application/pdf','application/xml','application/vnd.jats+xml','application/x-bibtex','application/x-research-info-systems','application/json','text/plain','text/markdown','image/png','image/jpeg','image/webp']),
  ('equity-uprise-private','equity-uprise-private',false,104857600,null)
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- No browser-side write policy is created. Service-role functions own all
-- canonical publication/snapshot writes. Public reads use the public bucket URL.
