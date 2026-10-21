# Coatue-inspired Decision Intelligence: research and execution notes (2026-10-11)

## Primary evidence and interpretation

1. Coatue 2026 prospectus: https://www.coatue.com/ctek/documents/Coatue_-_CTEK_Prospectus__May_1__2026_.pdf
   - Mosaic is a centralized research and financial modeling platform integrated with operational systems.
   - Coatue Brain integrates generative AI with research, internal analysis and data science.
   - Investment decisions remain with investment personnel.
   - **Inference for McCluster:** separate AI analysis from approved action; attach decisions to reproducible evidence and observed outcomes.

2. Coatue Q2 2026 presentation: https://www.coatue.com/ctek/documents/Coatue_CTEK_Main_Q2-2026.pdf
   - Describes processing internal/external data and AI agents assisting investment analysts.
   - **Inference:** agent outputs should augment analyst decisions, not become unsupervised business actions.

3. Domino case study: https://domino.ai/customers/coatue
   - Describes reproducible model experiments, scheduled analyses and model custody history. Vendor case study, not independent audit.
   - **Inference:** model versions, runs, inputs and decisions need immutable traceability.

4. NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
   - Voluntary trustworthiness and governance framework; generative AI profile emphasizes governance, provenance and pre-deployment testing.
   - **Inference:** adopt risk-based evaluation and human approval boundaries.

5. NIST agentic AI evaluation: https://www.nist.gov/programs-projects/building-evaluation-probes-agentic-ai
   - Evaluates factual grounding with citation-linked audit trails.
   - **Inference:** a claim with a citation is not automatically verified; retain contradictions and audit evidence.

## Repository-specific architecture decision

Canonical source systems: `workers/mccluster/src/analytics/router.js`, `workers/mccluster/src/commerce/summary.js`, `workers/mccluster/src/lib/observability.js`, `core/src/tools/research.mjs`, `ai_context.decisions`, `workers/mccluster/src/seek-first/index.js`.

Do not duplicate the finance ledger, observability pipeline, identity system or spatial provider gateway.

### What has been implemented on PR #407
- Pure integer-minor-unit campaign economics and unit tests.
- Private `decision_intelligence` schema with source, claim, evidence-link and decision-evidence tables.
- Compound (org_id, id) foreign keys for evidence relationships to prevent cross-tenant joins.
- RLS enabled and forced; no direct Data API privileges to application roles.
- Pure claim assessment with contradiction, source expiry, future timestamp and tenant-boundary handling; unit tests.

### Critical deployment limitation
The evidence migration intentionally grants **no** access to `service_role` or user roles and forces RLS. This means the schema is inert until a separately reviewed server-side access strategy is implemented (for example, tightly scoped SECURITY DEFINER functions with a locked search_path and verified org authorization, plus explicit schema grants). Do not claim an evidence API is live. Verify role ownership, Supabase API exposure, and production migration ordering before applying.

### Research provenance policy
- Source retrieval timestamp and published timestamp are distinct.
- Retain original source URI, content hash, license/usage lane and expiry.
- Citation presence is not proof; contradictory evidence must remain visible.
- Summaries and model outputs cannot be used as primary sources without underlying material.
- All claims and links are scoped to the authenticated organization.
- Retention expiry must block reuse; source removal requires explicit handling of dependent evidence.

### Finance policy
- Only reconciled verified receipts enter `verifiedRevenueMinor`.
- Pending payments, transfers and gross platform volume are not equivalent to recognized revenue.
- Refunds, payment fees, creator liabilities, incentives and infrastructure must be separately accounted.
- No causal attribution without a defensible experiment or attribution method.
- Current engine assumes a single minor-unit currency; multi-currency requires normalization and rate provenance before mixing totals.

### Release criteria
1. Review and validate migration against production schema and role behavior in a disposable Supabase environment.
2. Implement authenticated server adapter; test unauthorized, cross-org and missing-claim access.
3. Add read-only financial adapters and reconciliation fixture tests.
4. Add owner-facing scenario comparison and evidence display.
5. Add bounded agent orchestration only after citation and finance contracts are tested.
6. Add monitoring and spatial visualization after an end-to-end decision pilot.

### Initial business pilot
Influencer program cohort economics: recorded stipend/incentive commitments, verified creator referrals, paid conversions, refunds and cohort contribution margin. Explicitly show missing attribution and incomplete data rather than fabricating ROI.
