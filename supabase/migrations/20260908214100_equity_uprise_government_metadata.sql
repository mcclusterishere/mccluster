alter table public.eu_government_submissions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.eu_government_submissions.metadata is
  'Provider-specific but non-secret filing fields, e.g. Regulations.gov submitter type, organization type, comment-on document id or category. Never store API credentials here.';
