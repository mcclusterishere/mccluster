# McCluster Research Lab — Governance, Publishing and Funding Path

Checked: 2026-10-06

Lead researcher: **Matthew McCluster**
ORCID: **0009-0000-8988-8955**
Canonical public page: https://matthew.mccluster.org/research.html
Source repository: https://github.com/mcclusterishere/mccluster

## What this makes official

The website can be a genuine research instrument, but three different activities must stay distinct:

1. **Product analytics / quality improvement** — telemetry used to operate and improve the product.
2. **Product experimentation** — controlled tests used for commercial/product decisions.
3. **Research intended to contribute to generalizable knowledge** — a research activity that may require an institutional human-subjects determination, consent changes, preregistration and additional data-governance steps before it is represented or published as research.

The code enforces this distinction in the experiment registry. A research-intent experiment cannot enter a live canary/running state unless its recorded review state is exempt or approved.

This database field is a guardrail, **not an IRB decision**.

## SCSU human-subjects path

Southern Connecticut State University's IRB states that its purview includes human research conducted by SCSU students, faculty, staff and others conducting research under SCSU auspices, whether or not externally funded.

Current SCSU process:

- New applications are submitted through **Kuali Protocols**.
- Researchers should review the IRB instructions/forms before submission.
- SCSU requires current Human Subjects Training for protocol submission.
- The **Social & Behavioral Research — Basic** CITI course is identified by SCSU as required for protocol submission.
- SCSU advises submitting protocols at least six weeks before the anticipated project start date.
- SCSU states that the IRB itself determines exemption/review level; an investigator should not self-certify a study as exempt.

Canonical source:
https://inside.southernct.edu/rpp/irb

### Immediate protocol package to prepare

For the Adaptive Experience Research Lab, maintain a version-controlled package:

- study title and version;
- principal/student investigator and faculty sponsor if applicable;
- research questions;
- hypotheses;
- recruitment population;
- inclusion/exclusion;
- exact production/research boundary;
- data fields collected;
- retention period;
- consent/privacy language;
- randomization unit;
- treatment arms;
- primary metric;
- guardrails;
- stopping rule;
- risk assessment;
- de-identification plan;
- publication plan;
- code commit / policy version;
- adverse-event / withdrawal handling where applicable.

The experiment registry should store only the protocol reference/status. The approved protocol itself can be archived as a research artifact if publication is appropriate.

## Existing traffic vs prospective research

Do not retroactively call every existing analytics event a research subject.

Existing traffic can remain legitimate product telemetry. Whether historical data may be used in a research publication should be handled as its own research-data question and, where SCSU auspices or federal rules apply, included in the institutional determination.

The safest scientific structure is prospective:

1. preregister the research question;
2. obtain the applicable determination/approval;
3. record protocol reference in the experiment registry;
4. begin the research-eligible collection window;
5. freeze the analysis definition before reading treatment results;
6. analyze;
7. release only approved/de-identified outputs.

## Open-science publication chain

### GitHub

Git is the implementation provenance layer.

Every research result should record:

- source commit SHA;
- migration/schema version;
- policy version;
- experiment key;
- data-window bounds;
- analysis-script version.

CITATION.cff is the canonical software citation metadata for the repository.

### Zenodo

Zenodo supports research outputs including software, publications, datasets and presentations. Its GitHub integration can archive GitHub releases.

Zenodo DOI versioning creates:

- a DOI for each specific version; and
- a concept DOI representing all versions.

Use the **version DOI** when a paper must identify exactly which software/data release produced a result. Use the **concept DOI** when referring to the evolving project as a whole.

Canonical sources:
- https://help.zenodo.org/docs/github/
- https://zenodo.org/help/versioning

### ORCID

ORCID can record research outputs including publications and datasets and can add works by DOI.

For each released research artifact:

1. release/archive the artifact;
2. mint or receive its DOI;
3. enter DOI + canonical metadata into research_artifacts;
4. add/import the DOI to ORCID;
5. record the ORCID work identifier if available;
6. link the public Research Lab page back to the release.

Canonical source:
https://support.orcid.org/hc/en-us/articles/360006973133-Add-works-to-your-ORCID-record

## Suggested publication series

Treat the lab as a repeatable research program rather than one giant paper.

Potential series:

### McCluster Adaptive Experience Reports
Methods, architecture, live experiment design and results.

### Direct-to-Fan Music Systems
Album discovery, catalog exploration, return behavior and direct relationship economics.

### Adaptive Interface Notes
UI composition, explicit preference memory, contextual-bandit and generative-UI experiments.

### Action Network Systems Research
Participation, distribution loops, network effects and spillover-aware experimentation.

### Research Software Releases
Versioned software/analysis releases archived through Zenodo.

Each paper/report should have one experiment or coherent group of experiments, not claim that the whole website proved everything at once.

## The album as the commercial testbed

**CIA Mind Control** is the core product testbed.

Commercial system:

discovery
→ album/song
→ direct website relationship
→ deeper catalog exploration
→ account/follow
→ repeat visits
→ Action Network / creator / clipping participation where relevant
→ monetization

Potential revenue hypotheses can test:

- direct purchase/support conversion;
- licensing interest;
- repeat-listener value;
- creator/clipping distribution economics;
- subscriber/member products;
- services or offers reached through artist-owned traffic.

Do not optimize solely for click-through rate. Commercial evaluation should include downstream revenue, retention, catalog diversity, user satisfaction, friction, and acquisition/serving cost.

A useful business paper can therefore report both:

- **technical evidence**: the adaptive/decision method;
- **economic evidence**: incremental effect on direct relationship and revenue.

## Federal funding path: NSF SBIR/STTR

The current active solicitation is **NSF 26-510 — Small Business Innovation Research / Small Business Technology Transfer Phase I, Phase II, Fast-Track Programs: Developing Deep Technologies that Advance U.S. Competitiveness and Security**.

As checked 2026-10-06:

- next listed full-proposal deadline: **November 4, 2026**;
- Phase I standard grants: up to **$305,000**;
- Phase II: up to **$1,250,000**;
- NSF states the program supports startups/small businesses developing high-risk technologies with commercial impact across nearly all technology areas and markets.

Canonical sources:
- https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation
- https://seedfund.nsf.gov/

### How McCluster would need to frame it

A competitive R&D framing is not:

> "We made a personalized music website."

It is closer to:

> "McCluster is developing an adaptive experience and experimentation engine that unifies first-party behavioral measurement, opportunity-aware recommendation, low-traffic causal experimentation, explicit preference memory, research/production policy separation, and constrained generative UI across heterogeneous content and transaction domains."

The technical risk must be real. The proposal should explain what is not solved by ordinary analytics/recommendation products, why the research is uncertain, what Phase I will prove, and why the technology can become a commercial product beyond Matthew's own site.

The current website can provide prototype evidence and a real testbed; it should not be presented as proof that the R&D risk is already solved.

## Public research artifacts and de-identification

Never publish raw first-party production telemetry merely to make the project look data-rich.

Publication exports should be generated separately and should omit direct identifiers such as:

- IP addresses;
- email addresses;
- phone numbers;
- exact street/postal location when not essential;
- auth user IDs;
- raw device IDs;
- free text that can identify a person.

Use experiment-specific pseudonyms and disclose only the fields needed to reproduce the published analysis.

The high-value research artifact is:

- protocol;
- opportunity/candidate set;
- treatment assignment;
- propensity;
- policy/model version;
- de-identified behavioral outcome;
- analysis code;
- data dictionary.

That is substantially more scientifically useful than a dump of user profiles.

## Promotion rule

Research result
→ reproducible artifact
→ review
→ publication
→ production promotion only if product evidence also supports it.

Publication is not itself permission to deploy a policy, and a successful commercial A/B test is not automatically a publishable scientific result.

## Canonical research files

- CITATION.cff
- data/research/references.json
- docs/control-plane/ADAPTIVE-EXPERIENCE-RESEARCH.md
- docs/research/RESEARCH-LAB-GOVERNANCE-AND-FUNDING.md
- research.html
- supabase/migrations/20261006210000_experience_evidence_plane_v1.sql
