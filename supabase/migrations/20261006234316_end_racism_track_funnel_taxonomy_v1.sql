-- Analytics taxonomy for the compact End Racism track/action funnel.
-- APPLIED TO PRODUCTION 2026-10-06 as 20261006234316_end_racism_track_funnel_taxonomy_v1.

insert into public.event_taxonomy(event_name,stage,note) values
  ('end_racism_track_preview','content','The public preview of the End Racism paid track started.'),
  ('end_racism_track_checkout_open','checkout','A visitor opened the fixed-price $1 full-MP3 checkout.'),
  ('end_racism_track_purchase_complete','purchase','Stripe verified a paid $1 full-MP3 purchase on the return flow.'),
  ('end_racism_track_download','engage','A paid buyer used the signed full-MP3 download link.'),
  ('end_racism_action_open','lead','A visitor left the compact End Racism gateway for the canonical Action campaign.')
on conflict(event_name) do update set stage=excluded.stage,note=excluded.note;
