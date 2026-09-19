# McCluster Operational Intelligence Finish Line

Status: active engineering roadmap.

McCluster is not "done" because it can chat, queue jobs, or run a local model. The finish line is an integrated operational intelligence platform where data, organizational objects, actions, agents, evidence, decisions, and deployment are governed through one canonical system.

This document is an acceptance checklist, not a marketing comparison.

## Gate 0 — canonical control plane — COMPLETE

Acceptance:
- one Supabase durable truth plane;
- one Cloudflare public edge;
- one persistent OVH Core execution plane;
- stable capability registry;
- signed edge → Core dispatch;
- canonical objectives and durable job queue;
- self-hosted compute capability;
- exact-SHA deployment/reconciliation and drift detection;
- owner approvals for consequential actions.

## Gate 1 — operational ontology — IN PROGRESS

Acceptance:
- organization-scoped object types and objects;
- typed links;
- action types and action runs;
- durable lineage/provenance;
- canonical objectives, jobs, organizations, and applications materialized automatically;
- read/query/traversal capabilities over MCP;
- owner-attributed bounded ontology actions;
- source-backed data remains canonical and cannot be silently overwritten by ontology annotations.

## Gate 2 — universal ingestion + entity resolution

Acceptance:
- connector contract for APIs, databases, files, email/calendar, web research, telemetry, and event streams;
- every ingest has source, timestamp, license/retention policy, content hash, and trace id;
- deterministic deduplication and idempotency;
- entity resolution can merge aliases into one object without deleting provenance;
- conflicting facts remain representable rather than silently overwritten;
- incremental sync and replay are supported;
- failed ingests are observable and recoverable.

## Gate 3 — governed operational actions + write-back

Acceptance:
- action definitions can safely write back to approved canonical systems;
- every action declares risk, authorization, approval, idempotency, validation, and rollback/compensation behavior;
- object edits and external effects produce lineage and command evidence;
- agents cannot create arbitrary SQL, arbitrary HTTP effects, deployments, purchases, or communications outside capability policy;
- owner review gates remain mandatory for consequential effects.

## Gate 4 — Object Explorer + operational graph UI

Acceptance:
- global object search;
- type filtering, saved views, and recency/state filters;
- object detail view with biography/properties, linked objects, history, evidence, and available actions;
- graph traversal UI;
- lineage timeline;
- action history and approval state;
- live refresh without direct service-role exposure.

## Gate 5 — ontology-bound AI agents + evals

Acceptance:
- agents discover ontology schema/actions through the same MCP capability surface;
- agent permissions are scoped to identity/org/action policy;
- agents can plan, read objects, traverse links, request governed actions, and resume durable work;
- agent state is durable outside the model;
- every production agent has task-specific evals and regression thresholds;
- tool-use, factual grounding, action safety, cost, latency, and completion quality are measured;
- model/provider swaps do not change the durable operational contract.

## Gate 6 — decision intelligence + scenarios

Acceptance:
- metrics/features can be computed from ontology objects and linked evidence;
- decision records capture alternatives, assumptions, evidence, expected outcomes, owner decision, and later actual outcome;
- what-if scenarios operate on sandboxed snapshots rather than live production state;
- simulations can compare choices without automatically taking consequential action;
- outcomes feed back into evaluation and planning.

## Gate 7 — enterprise governance

Acceptance:
- object/action permissions support org, role, classification, and resource scope;
- sensitive fields can be redacted by policy;
- read access is auditable where required;
- retention/deletion policies propagate to derived objects;
- provenance can trace a displayed fact back to its source;
- secrets never enter ontology properties or model context by default;
- cross-tenant queries fail closed.

## Gate 8 — deployment and fleet mission control

Acceptance:
- desired state for Core, edge, and compute nodes is source-controlled;
- nodes report version, capability inventory, health, hardware, and deployment provenance;
- staged rollout/canary and automatic rollback are supported;
- drift is detected and remediated without silent mutation;
- model/runtime deployment uses the same provenance controls as application code;
- break-glass paths are explicit, logged, and not routine deployment owners.

## Gate 9 — reusable organization installation

Acceptance:
- a new organization can be provisioned from configuration rather than cloned ad hoc;
- identity, ontology, policies, apps, agents, dashboards, and connectors are tenant-scoped;
- organization data never leaks into McCluster house data or another tenant;
- the install has repeatable migration, backup, recovery, and offboarding procedures;
- a nonprofit/client deployment can inherit the platform without forking the control plane.

## Definition of done

McCluster reaches this finish line when an authorized operator can ask a question or issue an objective in plain language and the platform can:

1. find the relevant governed organizational objects and evidence;
2. explain the current operational state and provenance;
3. model or plan alternatives;
4. invoke only policy-permitted actions;
5. request human approval when authority requires it;
6. execute through durable jobs/capabilities;
7. observe completion and verify evidence;
8. update the operational graph;
9. learn from the actual outcome;
10. reproduce the entire chain later from audit/lineage records.

Until those gates are satisfied and tested, the operational-intelligence build remains open.
