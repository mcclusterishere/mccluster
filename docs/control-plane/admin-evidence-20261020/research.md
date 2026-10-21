# W07/W09 offline evaluation and remaining scientific work

`scripts/research/evaluate-evidence.mjs` is a working, dependency-free offline
scorer. It emits a review draft compatible with `research_artifacts.kind=report`
and `research_artifacts.metadata`; an authorized importer must resolve the existing
`research_projects.key` to its ID. It creates no new table, experiment, participant,
model invocation or publication. A reference string does not verify institutional approval.

## Reproduce the public engineering fixture

```bash
node --test scripts/test/evidence-evaluation.test.mjs
node scripts/research/evaluate-evidence.mjs \
  scripts/research/fixtures/manifest.json \
  scripts/research/fixtures/dataset.json \
  scripts/research/fixtures/predictions.json \
  /tmp/mccluster-evaluation-report.json
```

Output creation is exclusive: choose a fresh destination when rerunning. The
synthetic fixture is four symbolic cases, with hand-authored recorded predictions,
not an executed model or measured scientific result. It has one true positive,
one false positive, two supported reference cases, two abstentions and one unknown
reference label. Both known-label precision and reference-corpus recall are 1/2.
Latency and monetary cost remain unknown. The fixture's code SHA identifies its
source baseline; the CLI records the exact evaluator file hash separately.

The first local scoring run used Node 24.19.0, Linux x64; elapsed scorer time was
5.159 ms. That is a tiny local fixture timing, **not** an OVH inference benchmark,
performance budget, energy measurement, or evidence of scientific improvement.
Run the actual workload on the named target hardware before selecting budgets.

## Input and output contract

- Freeze manifest, corpus and recorded predictions. SHA-256 digests use compact
  JSON serialization with preserved key order; editing any field changes the hash.
- Manifest records exact code SHA, retrieval cutoff with timezone, dataset
  provenance/rights/version, access scope, hypothesis, endpoint, sampling unit,
  outcome window, sample-size rationale, analysis plan and failure criteria.
- Declare each method as rules, single model or bounded orchestration. Model
  methods require weight revision/license, quantization, runtime/version and
  prompt/configuration hashes. Do not invent a pin for a mutable model tag.
- Every corpus row has an event group, split, availability time, source IDs,
  reference label and, for known labels, an attributable adjudication reference.
  Related events and shared source copies cannot cross splits. Future information
  after the retrieval cutoff is rejected. Only held-out test predictions score.
- Predictions carry execution status, decision/abstention, allowlisted citations,
  measured latency or null, and measured/estimated cost receipts or null. Matching
  a source ID is **not** semantic citation support; that needs separate adjudication.
- Reports distinguish missing outputs, failed executions, abstentions and unknown
  labels. Precision/recall expose denominators; no-run recall is null. Incomplete
  recall is an explicit lower bound. Currency and estimated/measured costs remain
  separate. Wilson intervals declare their independence assumption; correlated
  event groups need a reviewed grouped analysis rather than interpreting them as
  valid significance estimates.
- Artifact drafts remain unreviewed and publication-ineligible. Human-subject,
  consent, rights and release controls in existing research/experience records
  remain authoritative. Private corpora stay in the authorized environment.
- Inputs are capped at 32 MiB each, 100,000 rows, 16 methods and one million
  method/sample pairs. Nonfinite aggregate costs are rejected even when every
  individual receipt is finite. Twelve local integrity/arithmetic tests pass.

## Candidate study, not an approved protocol

Question: does source-aware corroboration with abstention reduce unsupported
claims at a comparable review workload, against deterministic rules and one local
model? Use a qualified research lead to define the scientific contribution,
related work, independent sampling unit, temporal/geographic/language holdouts,
primary endpoint, powered sample size, reviewer workload measure and analysis.
Pre-register before accessing the held-out labels. Include failure cases, missing
labels, coverage, ablations, latency percentiles and cost per validated task.

A concrete existing scientific-data candidate is the USGS earthquake catalog
already consumed by Intel. Its source-published time, update time, coordinates,
depth and magnitude semantics can support a bounded provenance/verification task.
The candidate alone is not a curated dataset release or evidence of NSF AI Datasets
fit. Domain users, scientific value, rights per contributing source, independent
adjudication and a maintenance/access plan are not established here. Keep dataset
enhancement separate from new data collection. Do not use a news dump as substitute.

Primary references inspected 2026-10-20:

- https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

USGS-produced information is generally US public-domain material, but third-party
content and trademarks have separate rights. The above does not authorize all
bundled images, provider data, or model weights.

## Explicit unfinished evidence

No rules-versus-model-versus-orchestration benchmark, human-subject study,
scientific dataset enhancement, independently rerun held-out study, partner
outcome, adoption count or measured energy result was fabricated. These need
actual approved inputs and execution receipts; the engineering tests validate
the evaluator's integrity and arithmetic only.
