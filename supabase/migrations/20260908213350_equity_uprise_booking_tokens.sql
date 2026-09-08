-- Anonymous applicants need a capability token to request an interview without
-- exposing or trusting an application UUID. Only the SHA-256 hash is stored.
alter table public.eu_fellowship_applications
  add column if not exists booking_token_hash text;
create unique index if not exists eu_fellowship_booking_token_idx
  on public.eu_fellowship_applications(booking_token_hash) where booking_token_hash is not null;
