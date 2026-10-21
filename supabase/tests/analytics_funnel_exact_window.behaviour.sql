-- Regression for issue #264. Run only against an isolated local Supabase stack.
-- Proves same-day rows before p_since and rows at/after p_until are excluded.

begin;

delete from auth.users
where id in (
  '26400000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000002',
  '26400000-0000-4000-8000-000000000003',
  '26400000-0000-4000-8000-000000000004',
  '26400000-0000-4000-8000-000000000005',
  '26400000-0000-4000-8000-000000000006'
);

insert into auth.users (id, email, created_at, updated_at, email_confirmed_at) values
  ('26400000-0000-4000-8000-000000000001','before-start@example.test','2099-01-01 22:00:00+00','2099-01-01 22:00:00+00','2099-01-01 22:30:00+00'),
  ('26400000-0000-4000-8000-000000000002','at-start@example.test','2099-01-01 23:20:00+00','2099-01-01 23:20:00+00','2099-01-01 23:20:00+00'),
  ('26400000-0000-4000-8000-000000000003','middle@example.test','2099-01-02 12:00:00+00','2099-01-02 12:00:00+00','2099-01-02 13:00:00+00'),
  ('26400000-0000-4000-8000-000000000004','before-end@example.test','2099-01-03 23:19:59+00','2099-01-03 23:19:59+00',null),
  ('26400000-0000-4000-8000-000000000005','at-end@example.test','2099-01-03 23:20:00+00','2099-01-03 23:20:00+00','2099-01-03 23:20:00+00'),
  ('26400000-0000-4000-8000-000000000006','after-end@example.test','2099-01-04 00:00:00+00','2099-01-04 00:00:00+00','2099-01-04 00:00:00+00');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"26400000-0000-4000-8000-000000000099","email":"matthew@mccluster.org","role":"authenticated"}',
  true
);

do $test$
declare
  helper_accounts bigint;
  helper_confirmed bigint;
  funnel_accounts bigint;
  funnel_confirmed bigint;
begin
  select coalesce(sum(made_an_account),0), coalesce(sum(confirmed_the_email),0)
    into helper_accounts, helper_confirmed
    from public.analytics_signups_window(
      timestamptz '2099-01-01 23:20:00+00',
      timestamptz '2099-01-03 23:20:00+00');

  if helper_accounts <> 3 or helper_confirmed <> 2 then
    raise exception 'exact-window helper regression: accounts %, confirmed %; expected 3/2',
      helper_accounts, helper_confirmed;
  end if;

  select coalesce(sum(made_an_account),0), coalesce(sum(confirmed_the_email),0)
    into funnel_accounts, funnel_confirmed
    from public.analytics_funnel(
      timestamptz '2099-01-01 23:20:00+00',
      timestamptz '2099-01-03 23:20:00+00');

  if funnel_accounts <> 3 or funnel_confirmed <> 2 then
    raise exception 'analytics_funnel exact-window regression: accounts %, confirmed %; expected 3/2',
      funnel_accounts, funnel_confirmed;
  end if;
end
$test$;

rollback;
