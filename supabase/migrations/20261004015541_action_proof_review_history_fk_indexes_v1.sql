-- Cover audit-table foreign keys used by deletes and reviewer lookups.
create index action_proof_review_history_proof_idx
  on public.action_proof_review_history(proof_id);
create index action_proof_review_history_reviewer_idx
  on public.action_proof_review_history(reviewer_uid)
  where reviewer_uid is not null;
