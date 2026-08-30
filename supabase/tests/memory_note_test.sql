-- Run against a Postgres with 0022-0024 applied:
--     psql -d <db> -f supabase/tests/memory_note_test.sql
-- Everything happens inside a transaction that rolls back, so it is safe
-- to point at any database that has the schema.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;
insert into public.inbox_contacts (channel, external_id, display_name)
  values ('site','memtest','Mem Test') returning id \gset c_
\set C :c_id

create temp table t(step text, ok boolean);

select public.memory_note(:'C','city','Boston',0.8) \gset n1_
insert into t values ('A first fact written        ', :'n1_memory_note' is not null);
insert into t select 'B one live row              ', count(*)=1 from memory_facts where contact_id=:'C' and key='city';

-- said again, with trailing punctuation and a HIGHER confidence
select public.memory_note(:'C','city','Boston.',0.95) \gset n2_
insert into t values ('C repeat is the same row    ', :'n2_memory_note' = :'n1_memory_note');
insert into t select 'D repeat raised confidence  ', abs(confidence - 0.95) < 1e-6 from memory_facts where id = :'n1_memory_note';
insert into t select 'E still one row for the key ', count(*)=1 from memory_facts where contact_id=:'C' and key='city';

-- a weaker contradiction must not win
select public.memory_note(:'C','city','Denver',0.3) \gset n3_
insert into t select 'F weak claim did not win    ', value='Boston' and ended_at is null
  from memory_facts where id = :'n1_memory_note';
insert into t values ('G weak claim made no row    ', :'n3_memory_note' = :'n1_memory_note');

-- an equal-or-stronger one must
select public.memory_note(:'C','city','Denver',0.95) \gset n4_
insert into t values ('H strong claim made a row   ', :'n4_memory_note' <> :'n1_memory_note');
insert into t select 'I new value is live         ', value='Denver' and ended_at is null
  from memory_facts where id = :'n4_memory_note';
insert into t select 'J old value is ended        ', ended_at is not null and superseded_by = :'n4_memory_note'
  from memory_facts where id = :'n1_memory_note';
insert into t select 'K history kept              ', count(*)=2 from memory_facts where contact_id=:'C' and key='city';
insert into t select 'L exactly one live          ', count(*)=1 from memory_facts where contact_id=:'C' and key='city' and ended_at is null;

-- key normalisation
select public.memory_note(:'C','  Budget_Range ','under 5k',0.7) \gset n5_
insert into t select 'M key trimmed and lowered   ', count(*)=1 from memory_facts where contact_id=:'C' and key='budget_range';

-- refusals and clamping
select coalesce(public.memory_note(:'C','nothing','   ',0.9)::text,'null') as v \gset n6_
insert into t values ('N empty value refused       ', :'n6_v' = 'null');
select public.memory_note(:'C','wild','yes',9.0) \gset n7_
insert into t select 'O confidence clamped to 1   ', abs(confidence - 1.0) < 1e-6 from memory_facts where id = :'n7_memory_note';

-- the invariant the partial index exists to hold
insert into t select 'P no key has two live rows  ', count(*)=0 from (
  select contact_id, key from memory_facts where ended_at is null
  group by contact_id, key having count(*) > 1) x;

select case when ok then '  ok    ' else '  FAIL  ' end || step from t order by step;
select case when bool_and(coalesce(ok,false)) then E'\n  all memory_note checks passed'
            else E'\n  SOME CHECKS FAILED' end from t;
rollback;
