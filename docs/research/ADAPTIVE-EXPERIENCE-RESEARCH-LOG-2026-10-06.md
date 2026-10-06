# McCluster Adaptive Experience Research Log — 2026-10-06

Status: living research record  
Program: McCluster Research Lab  
Lead: Matthew McCluster  
Canonical bibliography: `data/research/references.json`  
Architecture contract: `docs/control-plane/ADAPTIVE-EXPERIENCE-RESEARCH.md`

## Purpose

This file records what was actually researched, what the engineering team learned from it, what is already implemented, what remains a hypothesis, and what evidence would be needed before a research result is promoted into product behavior.

The working rule is:

**literature → research question → instrumented implementation → logged exposure/opportunity → outcome → analysis → review → publication and/or production promotion**

Product analytics, product experimentation, and research intended to contribute to generalizable knowledge remain separate activities.

## 1. Adaptive-interface foundations reviewed

### Adaptive hypermedia — Brusilovsky (1996)
Research question informed: how can navigation/content change from a user model without turning the interface into an opaque black box?

Product consequence:
- maintain a user/context representation;
- adapt bounded navigation/content surfaces;
- preserve a stable component vocabulary;
- keep the basis for adaptation inspectable.

### Item-to-item collaborative filtering — Amazon (2003)
Research question informed: can recommendation remain useful and scalable when the catalog grows?

Product consequence:
- item relationships can generate candidates without requiring a giant end-to-end model;
- candidate generation and policy ranking should remain separable.

### Matrix factorization / implicit feedback — Koren, Bell & Volinsky (2009)
Research question informed: how should implicit behavioral signals be treated?

Product consequence:
- clicks/plays are evidence with varying confidence, not declarations of motive;
- temporal effects and confidence matter;
- latent representations are future research candidates, not current user truth.

### Contextual bandits / LinUCB — Li, Chu, Langford & Schapire (2010)
Research question informed: how can the system explore alternatives while still exploiting what appears useful?

Product consequence:
- randomized policies require logged action probabilities/propensities;
- bandits do not belong in production until offline/shadow/live evidence exists;
- a true control/holdout must remain available.

### Candidate generation + ranking — YouTube (2016)
Research question informed: should one model own the whole recommendation problem?

Product consequence:
- no;
- eligibility/candidate generation is a separate stage from ranking;
- surface-specific constraints remain outside the ranker.

### Unbiased learning from biased feedback — Joachims, Swaminathan & Schnabel (2016)
Research question informed: how do we avoid learning that a top-ranked item is preferred simply because it was shown first?

Product consequence:
- log the opportunity set;
- log position/order;
- log propensities when randomized;
- never train/evaluate only from clicks without exposure context.

### Sequential recommendation / SASRec (2018)
Research question informed: does recent action order matter beyond aggregate taste?

Product consequence:
- future models may use ordered histories;
- current Audience Science aggregates are useful but insufficient for sequence-aware models.

### Hidden-state relationship models / HMM work
Research question informed: can recurring engagement be represented as changing latent states?

Product consequence:
- possible research-only model family;
- latent states must be validated out-of-sample and never presented as psychological fact.

### SlateQ + RecSim
Research question informed: should optimization target one click or the longer sequence of outcomes from a page/slate?

Product consequence:
- future work should evaluate whole-page and longer-horizon outcomes;
- simulator/offline replay can precede live experimentation.

## 2. Music-behavior research reviewed

### Listening diversity / concentration
Research question informed: does an intervention broaden real catalog exploration or merely move clicks around?

Current metrics influenced:
- Herfindahl concentration;
- Shannon entropy;
- normalized entropy;
- effective catalog size;
- dominant-track share.

### Relistening / recency / familiarity
Research question informed: how should repeat listening differ from first-time exploration?

Product consequence:
- recent listening state and frequency can be useful features;
- repeat behavior should not be treated automatically as stronger long-term preference.

### Conversational music recommendation
Research question informed: can explicit preference elicitation improve discovery compared with passive inference alone?

Product consequence:
- declared preferences must remain a separate evidence type from inferred behavior;
- future conversational recommendation can use the same decision/exposure plane.

## 3. 2024–2026 recommender/frontier research reviewed

### HSTU / generative sequential recommenders
Potential future use:
- long sequence modeling across heterogeneous actions.

Current decision:
- research-only;
- scale/complexity is unjustified before the evidence plane has enough clean sequential data.

### GenPage / structured generative homepage construction
Key lesson:
- richer context and structured composition may matter more than simply scaling model size.

Current decision:
- future generative UI may return a constrained ExperienceSpec;
- it may not return arbitrary HTML/JavaScript.

### UniPinRec
Key lesson:
- shared user representation can serve both retrieval and ranking.

Current decision:
- useful future architecture direction after identity/feature contracts stabilize.

### Epistemic recommendation / EGRec
Key lesson:
- sometimes the highest-value recommendation is the one that reduces uncertainty, not the one predicted to maximize immediate engagement.

Current decision:
- shadow/offline first;
- any live epistemic exploration must remain low-risk and bounded.

### ConAlign / unbiased traffic
Key lesson:
- a small unbiased/random traffic stream can help fight observational bias and interest collapse.

Current decision:
- preserve a true exploration/control bucket before adaptive policies become dominant.

### Self-evolving recommendation systems
Key lesson:
- agents can propose model changes offline, but production promotion still needs a slower evidence/review loop.

Current decision:
- no autonomous production self-modification;
- candidate changes may be generated offline and tested through the normal promotion process.

### Network-interference-aware experimentation
Key lesson:
- social/action treatments can spill from one person to another, violating ordinary independent-user experiment assumptions.

Current decision:
- future Action Network experiments may require cluster-level assignment and spillover-aware analysis.

### Personalized generative UI
Key lesson:
- presentation preference can be learned, but generative UI must be constrained and user-governable.

Current decision:
- no free-form generative UI in PR B or PR C.

## 4. Engineering research findings from the existing McCluster system

### Finding: the old MCC_MODEL is useful as a compatibility surface, not scientific truth

Observed implementation:
- six hand-authored interest domains;
- arbitrary 1/2/3 event weights;
- 14-day decay;
- local fatigue counts;
- a next-page suggestion;
- persuasion labels.

Conclusion:
- preserve the public API temporarily so existing surfaces do not break;
- remove it as decision authority over time;
- keep its inferred weights on-device during the compatibility phase.

### Finding: opportunity/exposure was the critical missing data

Before the Experience Evidence Plane, a click could not distinguish:
- only option shown;
- first option among many;
- item deliberately searched for;
- item repeatedly exposed by an old policy.

Conclusion:
every adaptive decision must record the candidate/opportunity set before render.

### Finding: research and production policies need separate namespaces

Conclusion:
- production uses only promoted/versioned policies;
- research supports offline, shadow, ghost, canary, opt-in and promoted states;
- research-intent experiments cannot silently become production behavior.

### Finding: explicit preferences and observed behavior are different evidence

Conclusion:
- declared preference memory is inspectable/revocable;
- observed behavior remains Audience Science;
- do not collapse them into one opaque score.

### Finding: generated presentation needs a hard capability boundary

Conclusion:
the server/model may return allowed candidate IDs/order/layout/copy variants from an allowlist, but never arbitrary executable UI.

## 5. Implemented research infrastructure

### PR A — Experience Evidence Plane
Implemented:
- `experience_surfaces`;
- `experience_policies`;
- `experience_experiments`;
- experiment arms and stable assignments;
- feature snapshots;
- canonical decision ledger;
- eligible candidates;
- selected candidates;
- propensities;
- reason codes;
- downstream decision-linked events;
- research project/source/artifact registries;
- production/research governance fields.

Initial registered surfaces:
- `global.for_you`;
- `music.next_step`;
- `action.next_step`.

Initial production policy:
- `control-order@v1`;
- identity/caller order only;
- evidence collection without adaptive ranking.

### PR B — MCC_MODEL compatibility adapter + first three surfaces
Current implementation:
- keeps `MCC_MODEL.profile()`, `suggest()`, and `shown()`;
- adds `MCC_MODEL.decide()` and `suggestAsync()`;
- uses server decisions when valid;
- preserves local fallback;
- keeps legacy inferred domain scores on-device;
- session-caches decision metadata;
- keeps decisions behind the existing privacy acknowledgement gate;
- constrains the server to selecting/ordering caller-provided candidate IDs.

First three instrumented surfaces:
1. global For You;
2. Music next step;
3. Action campaign next step.

Evidence emitted:
- decision;
- impression;
- visible;
- interaction;
- later outcome attribution.

## 6. Active research hypotheses

These are hypotheses, not findings.

### H1 — Opportunity-aware measurement
Recording the actual candidate set and position will materially change our estimate of content preference compared with click/play counts alone.

### H2 — Music next-step
A bounded next-step surface can increase deeper catalog exploration and return behavior without reducing listening diversity.

Primary candidate outcomes:
- additional track starts;
- completed listens;
- catalog coverage;
- return sessions.

Guardrails:
- play failures;
- bounce/exit;
- concentration collapse;
- latency.

### H3 — Action next-step
Decision-aware campaign discovery can increase meaningful mission/action entry without increasing dead clicks or low-intent joins.

Potential outcomes:
- campaign open;
- mission selected;
- mission created/taken;
- proof/completion later.

Guardrails:
- rage/dead clicks;
- abandonment;
- duplicate/invalid mission state;
- sensitive targeting prohibition.

### H4 — Global For You
A small next-step surface can improve navigation into the most useful next product area without replacing the visitor's ability to navigate normally.

Guardrails:
- ordinary navigation remains intact;
- no protected/sensitive targeting;
- no forced path;
- no arbitrary generated CTA.

### H5 — Song distribution / hit detection
Different songs will be exposed across adaptive and social-distribution surfaces to learn which records create durable attention and direct economic response.

The unit of evidence is not raw play count. Every comparison should retain:
- eligible songs / opportunity set;
- which song was actually shown;
- position and source;
- preview start;
- meaningful listen / completion;
- repeat listen and later catalog breadth;
- direct return;
- paid conversion where an offer exists;
- downstream Action or creator participation where relevant.

For the End Racism single, the initial commercial outcome is the fixed **$1 full-MP3 purchase**. The purchase supports the End Racism campaign but is not represented as a tax-deductible charitable contribution.

Evaluation rule:
- preserve an unbiased/random exploration bucket where practical;
- compare rates conditional on exposure, not totals alone;
- report uncertainty and minimum support;
- do not infer a visitor's race, racist/non-racist identity, ideology, or psychology from which song they play or buy.

## 7. Things we have explicitly NOT proven

Do not write these as conclusions yet:

- that the system understands a person's psychology;
- that a click proves preference;
- that higher CTR means a better long-term experience;
- that adaptive ranking increases revenue;
- that any latent class/state is a real identity category;
- that a bandit beats deterministic policy;
- that generated UI beats the existing design;
- that Action Network users can be treated as independent experimental units;
- that historical production telemetry is automatically eligible for research publication.

## 8. Research-governance work reviewed

### Human-subjects governance
Reviewed:
- U.S. Common Rule materials;
- HHS definition of human-subjects research;
- Southern Connecticut State University IRB process.

Current status:
- research program exists;
- no blanket claim of IRB approval/exemption is made;
- research-intent live experiments require the applicable institutional determination.

### Reproducible publication
Reviewed:
- Git/GitHub provenance;
- CITATION.cff;
- Zenodo GitHub archiving and DOI versioning;
- ORCID work registration.

Target publication artifact:
- protocol;
- code commit;
- candidate/opportunity data;
- assignment;
- propensity;
- policy/model version;
- de-identified outcomes;
- analysis code;
- data dictionary.

### Funding
Reviewed:
- NSF SBIR/STTR as a possible commercial R&D path.

Research framing:
not "a personalized music site," but a reusable adaptive-experience and experimentation engine with low-traffic causal measurement, first-party opportunity logging, explicit preference memory, constrained adaptive UI, and production/research policy separation.

## 9. Local/remote AI compute research — 2026-10-06

### MINISFORUM AI X1 Pro-470
Official configuration reviewed:
- AMD Ryzen AI 9 HX 470;
- Radeon 890M integrated GPU;
- up to 128 GB DDR5;
- OCuLink external-GPU expansion;
- multiple NVMe slots;
- official 32 GB RAM + 1 TB SSD configuration listed at $1,327 when checked.

Engineering conclusion:
- useful candidate for an always-on local node;
- do not make PRBMCC depend on this specific machine;
- benchmark workload before spending;
- the compatibility/routing layer should treat VPS, local AMD node, and external research GPU as interchangeable execution targets.

### ACCESS cyberinfrastructure
Reviewed:
- ACCESS allocations cost the researcher nothing;
- an existing NSF award is not required to request an allocation;
- Explore is explicitly intended for benchmarking, graduate-student projects, code development/porting and small-scale evaluation;
- graduate students can use entry-level allocation paths subject to eligibility/document requirements.

### Jetstream2
Reviewed:
- interactive research cloud / science-gateway backend;
- available primarily through ACCESS allocations;
- GPU resource includes A100, L40S and H100 classes;
- explicit Jetstream2-GPU access is required.

Compute research plan:
1. keep the public PRBMCC/model interface provider-neutral;
2. establish a benchmark suite for latency, tokens/sec, memory, concurrency, tool execution, uptime and cost;
3. run the same suite on the existing VPS;
4. request an ACCESS allocation and benchmark suitable GPU resources;
5. benchmark any local machine only against the same workload;
6. buy local hardware only if ownership materially improves economics, privacy, uptime or control.

## 10. Research method for future changes

For every adaptive feature, record:

1. research question;
2. hypothesis;
3. surface/risk tier;
4. candidate set definition;
5. policy + version;
6. assignment unit;
7. primary metric;
8. guardrails;
9. power/minimum-support rule;
10. data window;
11. source commit;
12. privacy/research review state;
13. analysis code;
14. result with uncertainty;
15. production decision;
16. publication/artifact decision.

## 11. Next research sequence

After PR B:
- PR C: deterministic production policy v1 using mature features + explicit preferences + diversity/fatigue constraints;
- PR D: Research Lab v1 with shadow/replay/A-B/promotion workflow;
- PR E: first live research policies, beginning with bounded contextual-bandit treatment and an unbiased exploration bucket.

Later only after evidence quality is sufficient:
- latent classes / HMM states;
- semantic IDs;
- sequential user encoder;
- constrained generative page composition;
- self-evolving offline policy search.

## Canonical source keys

The detailed bibliography and URLs live in `data/research/references.json`. Major source families include:

- `brusilovsky_1996_adaptive_hypermedia`
- `linden_smith_york_2003_amazon`
- `koren_bell_volinsky_2009_matrix_factorization`
- `li_chu_langford_schapire_2010_linucb`
- `covington_adams_sargin_2016_youtube`
- `joachims_swaminathan_schnabel_2016_unbiased_ltr`
- `kang_mcauley_2018_sasrec`
- `netzer_lattin_srinivasan_2008_hmm`
- `ie_et_al_slateq`
- `google_recsim_2019`
- `poulain_tarissan_music_diversity`
- `actr_music_relistening_2021`
- `hst_u_2024`
- `recsys_2026_genpage`
- `recsys_2026_unipinrec`
- `recsys_2026_egrec`
- `recsys_2026_conalign`
- `recsys_2026_self_evolving`
- `recsys_2026_network_experiments`
- `recsys_2026_music_crs`
- `peng_2026_personalized_generative_ui`
- `hhs_common_rule`
- `hhs_human_subjects_definition`
- `scsu_irb`
- `orcid_add_works`
- `zenodo_github_software`
- `zenodo_doi_versioning`
- `nsf_26_510_sbir_sttr`
- `minisforum_ai_x1_pro_470_official`
- `access_allocations_no_cost`
- `access_project_types`
- `jetstream2_overview`
- `jetstream2_gpu_faq`
