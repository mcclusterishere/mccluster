# McCluster resident learning — reviewed memory pilot

Research and implementation date: 2026-10-16. CPU-only; no new paid service.
Status: implementation proposed for review, NOT deployed. No weights trained.

## The distinction that matters

McCluster owns its durable context, tools, evaluation, provenance and permissions;
the inference model remains replaceable. Updating a database is not changing the
model's weights. Three distinct improvement lanes belong in this architecture:

1. Fresh world knowledge: retrieve current, licensed, time-stamped observations.
   Population estimates, prices and news stay in their respective data stores;
   do not repeatedly fine-tune a model to memorize changing observations.
2. Reviewed external memory and procedures: retain explicit user corrections,
   preferences and bounded hypotheses from recorded outcomes. Retrieve relevant
   accepted lessons on later turns. This pilot implements the first small loop.
3. Model-weight training: later curate separately consented/rights-cleared examples,
   train a candidate adapter/model, test on held-out tasks and previous abilities,
   approve deployment, and retain the prior version for rollback. Not implemented.

Memory retrieval is not guaranteed intelligence improvement. The tests here show
protocol behavior, not a replicated research benchmark or measured Qwen gains.

## Existing architecture reused

- `core/src/executors/resident-ai-turn.mjs` already runs accepted messages as
  durable `ops_agent_jobs`, calls the local model adapter and records replies.
- New `core/src/learning.mjs` executes before that inference, using the same
  stored user message and thread. Learning commands have deterministic replies;
  the model does not decide whether approval succeeded.
- Existing `ai_context.memory_items` stores lessons. No parallel memory, vector,
  transcript, approval or job database was added. Existing full-text search is
  sufficient for this bounded pilot; no embedding dependency was introduced.
- Existing `control_audit` records transitions atomically with memory writes,
  without copying lesson text into audit events.
- `MCCLUSTER_LEARNING_ENABLED` defaults off. Ordinary chat uses the old behavior
  when off. `/learn` says that it is disabled rather than pretending to learn.

## Commands in the existing McCluster chat

After deployment and explicit activation:

```
/learn propose preference
Keep the analytical Earth black; Travel should prioritize getting the traveler there.

/learn list
/learn approve <lesson-id>
/learn revoke <lesson-id>
/learn reflect <completed-repo-health-job-id>
```

Only the first line's literal `/learn` command is interpreted, from an already
stored user-role message in an active, enabled McCluster house-owner thread with
a matching durable resident job. A document, tool result, model reply or text that
merely quotes a command is not an approval channel. This chat interface is not
automatically imported from external ChatGPT or Claude sessions.

Proposal -> explicit human review -> approved retrieval -> expiry/revocation.
A correction is the owner's statement, not independently established world truth.
New factual corrections still need source checks. New preferences do not override
higher-priority system instructions or a different current user request.

Preferences expire after 90 days; corrections/procedures after 30. A later proposal
does not silently override an older one: revoke the old lesson and approve its
replacement. This pilot does not infer consent, merge contradictions or increase
permissions. The list shows up to 20 recent records, including expiry timestamps;
ordinary inference retrieves up to eight records in a bounded context package.

## Source and privacy boundaries

The pending SQL was written against inspected live schema metadata, not private
transcript contents. The RPCs are service-role-only. They derive the owner from
the canonical thread and check current `org_members` ownership, enabled house
organization and linked user-message job. They never trust a request's claimed
owner identity. Generic admin/member accounts cannot use this path.

Approved pilot records use `status=learning_approved`, not the generic `active`.
This is deliberate: the existing `context-query` Edge Function selects active
memories with organization-level membership, not per-owner filtering. Pilot records
must not enter that path. The owner-scoped RPC normalizes approved rows to `active`
only in its private response to the trusted resident executor. Tests verify the
legacy active-memory query cannot see the pilot's approved records. Private-schema
raw service access remains privileged; do not expose it to clients or model tools.

Source and approval messages are hash-checked on retrieval. Deleting or editing
those records makes the memory ineligible. Current owner membership and validity
windows are rechecked. Old queued turns cannot retrieve lessons approved after
their user message. Revocation stops future retrieval, not in-flight prompts or
copies in existing answers/backups. It is not full data erasure or model unlearning.
Source IDs are stored under metadata with `source_table=ops_ai_messages`; they are
not placed in `source_message_ids`, whose namespace is the private ai_context corpus.

Credential-pattern checks are defense in depth, not complete sensitive-data or
prompt-injection detection. All memory is quoted reference data, never a new system
policy. Every record defaults `training_allowed=false`. No bank data, precise
location histories, provider keys or imported article bodies are exported for
training. Content-display permission and training permission are separate reviews.

## Learning from execution without rewarding hallucinations

`/learn reflect <job>` currently supports ONLY completed `repo_health` jobs with
actual test execution and the existing completion-evidence envelope. Core verifies
its digest and expected evidence records using `assertCompletionEvidence`. A job
marked done with no tests is insufficient. Hash integrity establishes linkage to
recorded output; it is not cryptographic proof that the world matches every claim.

Only repository identifier, commit, actual test outcome, checkout cleanliness,
observation time and evidence digest reach the local proposer. Logs, private paths,
source text, credentials and tool instructions are excluded. One JSON proposal is
requested from the existing loopback model adapter, with bounded output, 2,048-token
context, 60-second timeout and lower queue priority. Low priority does not guarantee
nonblocking behavior when the runner itself is single-job: benchmark scheduling
before adding automatic background reflection. No model is downloaded by this PR.

The model's procedural hypothesis remains proposed. Another literal owner command
must approve it. SQL rechecks the source job at save and on later retrieval. Automatic
approval, automatic code edits, uncontrolled nightly retraining and automatic
production promotion are explicitly absent.

## Evaluation plan before expanding autonomy

Use three separate datasets: development traces, validation examples for candidate
selection, and a blind holdout used only at a planned release gate. Keep examples
from one conversation/project incident in the same split; use chronological splits
for world forecasting, including true release dates to avoid future-data leakage.
Compare no-memory baseline, reviewed-memory system and any fine-tuned candidate.
Score grounded accuracy/citations, task success from actual tool results, corrected
mistake recurrence, appropriate uncertainty, cross-owner leakage, unauthorized
actions, latency, CPU/RAM and catastrophic regressions. A friendly user rating or
the agent praising itself is not sufficient evidence of success.

A first benchmark set should include: black-globe preference, travel vs research
scope, stale GDP year vs retrieval time, missing-provider disclosure, false-success
claims, contradictory old preferences, revoked source, malicious retrieved text,
and refusing unauthorized financial/deployment actions. Fixed safety cases are
necessary but must be supplemented with unseen examples, not repeatedly optimized
against until they stop measuring generalization.

Model training later: start with supervised fine-tuning/LoRA on permissioned good
examples and corrections; preference training only with meaningful independent
comparisons. Keep real evidence and failure cases, not only recursive model prose.
Do not train a general 8B model continuously on the production CPU host. CPU-only
small-model experiments may be benchmarked separately; substantial adapter training
needs a separately approved compute budget/job. Deployment remains candidate ->
held-out evaluation -> approval -> canary -> rollback. The inference model may
remain unchanged indefinitely if external memory performs better for the budget.

## Deployment / rollback gates

1. Review this isolated PR and run Node plus disposable PostgreSQL tests.
2. Review/apply the pending SQL through the established migration/ledger process;
   do not relabel it a production migration or edit the ledger before application.
3. Promote the exact reviewed Core commit through `deploy/ovh-production`, inspect
   free RAM/disk/CPU and existing services; this PR does not enable/deploy them.
4. Set `MCCLUSTER_LEARNING_ENABLED=true` only after the RPCs exist and the correct
   executor is running. Test propose -> approve -> new thread -> revoke, and source
   deletion/role revocation. No external provider account or GPU is required.
5. If anything fails, disable that flag. Ordinary conversations must continue;
   teaching commands explicitly report unavailability rather than unverifiable success.

No production SQL, systemd timer, model training or server environment change is
performed just by committing these files. SQL tests use a named disposable local
PostgreSQL database in GitHub Actions and no production credentials. The historical
memory subsystem and source datasets still require their own health checks.

## Research consulted (primary sources, accessed 2026-10-16)

These inspired bounded design choices; the PR is NOT a reproduction of the papers.
October preprints are recent proposals/results, not independently validated guarantees.

- **Self-Evolving Agent Harness**, 2026-10-13: fixed model weights; separate proposal
  and admission; independent validation, retention budgets, privileges/actions.
  https://arxiv.org/abs/2610.18813
- **MemScope**, 2026-10-15: trace-grounded localized memory-architecture repair;
  useful future PR/test loop, not autonomous production rewrite here.
  https://arxiv.org/abs/2610.21170
- **STRATA**, 2026-10-14: typed skill/workflow/meta memory, deduplication, forgetting
  and contrast between deceptively similar experiences. Future memory scaling.
  https://arxiv.org/abs/2610.19386
- **ACE**, ICLR 2026, revised 2026-03-29: evolving contextual playbooks through
  generation/reflection/curation, preserving detail rather than rewriting one summary.
  https://arxiv.org/abs/2510.04618
- **SEER**, 2026-10-02: prediction-error feedback for event retrieval and domain
  dynamics; relevant future globe time-series work, not a market-return guarantee.
  https://arxiv.org/abs/2610.04109
- **eTAMP**, 2026-04-03: persistent memory poisoning from untrusted tool observations.
  https://arxiv.org/abs/2604.02623
- **Model collapse**, Nature 2024: risks of indiscriminate recursive generated-data
  training, not an assertion that all synthetic data is harmful.
  https://www.nature.com/articles/s41586-024-07566-y
- **Titans / MIRAS**, Google Research 2025-12-04: neural test-time memory research;
  specific model architectures, not a switch in the existing Ollama model.
  https://research.google/blog/titans-miras-helping-ai-have-long-term-memory/
- **PEFT**, Hugging Face official documentation: adapter/LoRA training guidance.
  https://huggingface.co/docs/transformers/peft
