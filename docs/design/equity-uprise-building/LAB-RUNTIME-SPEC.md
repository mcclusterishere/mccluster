# Equity Uprise Lab Runtime — Step 1 Foundation

## Purpose

The Lab Runtime turns canonical Equity Uprise training definitions into deterministic, sandbox-only runtime sessions.

Step 1 establishes the execution contract only. It does **not** yet mutate the electronics/IT asset graph, the 3D building, B1 operational systems, or any live equipment. Step 2 will connect runtime fault state to the canonical Step 4A electronics fabric.

## Canonical inputs

The runtime adapts, but does not replace:

- `production/electronics/generated/equity-uprise-it-lab-catalog-v1.json`
- `production/electronics/generated/equity-uprise-electronics-manifest-v1.json`
- `production/electronics/generated/equity-uprise-electronics-connections-v1.json`
- the Digital-to-Physical Asset Registry and Step 3A/3B causal graph;
- `../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json`.

Federal course completion remains external evidence. It is never equivalent to Equity Uprise competency mastery.

## Runtime contract

Every catalog lab is adapted into an executable-scenario envelope with stable runtime identifiers while preserving the source lab ID, tier, title, skills, target selectors, student tasks, fault declarations, success criteria and reset language.

The Step 1 session state machine is:

`CREATED -> RUNNING -> COMPLETED`

A session may be moved to `RESET` from any active/completed state and started again from the same canonical scenario definition.

The runtime exposes these learner/instructor operations:

1. `start()` — activates the sandbox session and its abstract fault declarations.
2. `inspect(target, detail)` — records an observation without changing system state.
3. `perform(action, ...)` — records a simulated learner action.
4. `satisfyCriterion(criterionId, evidence)` — records evidence against a canonical success criterion.
5. `evaluate()` — returns deterministic pass/fail state without mutating the session.
6. `complete()` — completes only when every required success criterion has evidence.
7. `reset()` — deactivates injected faults and clears criterion satisfaction while preserving the audit ledger.

## Evidence contract

Every runtime event is append-only and receives a deterministic monotonic `event_seq`. Step 1 deliberately does not use wall-clock time so CI, replay and later grading remain reproducible.

Events include:

- session start;
- abstract fault injection;
- inspection;
- simulated action;
- criterion satisfaction;
- session completion;
- reset.

The evidence bundle exports the scenario identity, session identity, current phase, criterion status, abstract fault state, ordered event ledger and current evaluation result.

Step 6 will add richer scoring, timing, hints, penalties and competency evidence. Step 1 only creates the durable event spine those systems will consume.

## Safety / authority boundary

Non-negotiable:

- runtime execution target is `SANDBOX` only;
- source labs must remain `mode: "SIMULATION"`;
- source labs must remain `live_control_allowed: false`;
- any request for `LIVE` execution is rejected before a session starts;
- any per-action live-control request is rejected;
- no runtime operation writes to a building controller, BAS, fire-alarm system, access-control panel, network switch, hypervisor, camera, power system or B1 operational service;
- B1 / OT learner work remains a sandboxed clone only;
- this runtime is training software, not construction, commissioning or operational-control authority.

## Step 1 completion boundary

Step 1 is complete when:

- all 40 Step 4A labs adapt successfully into the runtime envelope;
- the state machine starts, records learner evidence, evaluates, completes and resets deterministically;
- incomplete scenarios cannot complete;
- LIVE execution is rejected;
- CI runs the runtime verifier on every Core V2 validation.

## Next

**Step 2:** bind runtime target selectors and fault declarations to the Step 4A electronics manifest/connections and Digital-to-Physical Asset Registry so simulated devices, links and services can change state and propagate consequences inside the sandbox.
