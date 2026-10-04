-- The Action campaign renderer is action-first. Cobalt already had two
-- reviewed missions in draft; open them so the live campaign never renders
-- as a copy-only dead end.
update public.action_missions
set status='open', updated_at=now()
where campaign_id='critical-minerals-drc-001'
  and status='draft'
  and title in (
    'Recycle one dead device the right way',
    'Trace the minerals in your phone'
  );
