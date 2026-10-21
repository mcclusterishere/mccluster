# W08 proposed release boundary — no license change

Current repository `LICENSE` is proprietary. This document proposes a bounded release for the owner's review; it grants no permission and does not change that license. W08 remains incomplete until rights review, owner approval and an actual release exist.

## Concrete first package

Proposed component: the offline evidence-evaluation toolkit. It can run with Node built-ins, no McCluster credentials, no live Supabase connection, no model weights and no external dataset. It accepts explicit manifests and produces reports for later review through the existing research-artifact contract. It must retain its statements that symbolic fixtures are not scientific results and that citation membership is not semantic support.

Proposed **exact source boundary** (retain these relative paths for the existing test imports):

| File | Package role | Rights review status |
| --- | --- | --- |
| `scripts/research/evaluate-evidence.mjs` | Bounded scorer and report CLI | Newly implemented here; contributor/ownership review pending |
| `scripts/research/fixtures/manifest.json` | Explicit synthetic fixture manifest | Owner approval pending; adjust its rights statement only after release approval |
| `scripts/research/fixtures/dataset.json` | Symbolic test cases | No participant/third-party corpus; provenance review pending |
| `scripts/research/fixtures/predictions.json` | Recorded fixture decisions | Synthetic examples, not measured model results |
| `scripts/test/evidence-evaluation.test.mjs` | Meaningful failure/arithmetic tests | Contributor/ownership review pending |

Everything else stays outside this proposal: production source/credentials, private conversations, website/UI, trademarks and logos, music/media, source-provider bytes, grant-source material, production telemetry, geography/partner data, actual scientific datasets, model weights, and operational deployment tools. The worker-protocol files can be considered later under a separate inventoried boundary; this approval does not implicitly release them.

## Proposed license and notices

Proposed license identifier: **MIT**, using the [Open Source Initiative's canonical MIT license text](https://opensource.org/license/mit). The full license text must be included in a release package only after approval. Proposed copyright notice for owner review:

> Copyright (c) 2026 Matthew McCluster and McCluster Corp.

Proposed accompanying notice:

> This release covers only the files listed in its release manifest. McCluster names and marks are not licensed. No private data, third-party source corpus, model weights or provider entitlement is included. Synthetic fixtures demonstrate software behavior and are not scientific benchmark results.

The owner must confirm the copyright holder(s), contributor permissions and any notices before these statements become release metadata. The repository's current proprietary license continues to govern all files today. No license file or SPDX header was applied in this increment.

## Independent use and reproduction

Keep the selected tree together and run:

```
node --test scripts/test/evidence-evaluation.test.mjs
node scripts/research/evaluate-evidence.mjs scripts/research/fixtures/manifest.json scripts/research/fixtures/dataset.json scripts/research/fixtures/predictions.json /tmp/evidence-report-new.json
```

The report path must not exist already. Pin the integrated source commit and exact file hashes in the release manifest before tagging; baseline commit fields in illustrative fixture manifests are not evidence that newly added code existed on that baseline. Record Node version and the scorer's actual file hash. Independent packaging validation is recorded in `licensing-boundary-check.json`: all 12 tests and the fixture CLI passed after copying exactly these five files into a separate directory. The scorer bounds methods to 16 and method/sample pairs to one million, and rejects nonfinite aggregate costs. This is a local second-directory replay, not third-party adoption or independent scientific validation.

## Stewardship required before an actual release

Identify real maintainers and a security contact; document supported versions and response ownership; add contribution/governance rules and original-author provenance; publish reproducible build/test/release instructions and a signed or otherwise verified release manifest; provide an accessible tutorial and citation metadata; budget maintenance. Evaluate real outside installations, contributions and issue resolution after release. These remain gaps, not assumed adoption evidence for PESOSE, GitHub or Sloan.

The specific owner decision to prepare for is permission to release **these five files only** under MIT after contributor/notice verification. No whole-repository conversion is proposed. A license decision alone does not supply funder eligibility, an applicant, a scientific community or an award.
