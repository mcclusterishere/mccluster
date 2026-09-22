# Equity Uprise — Digital-to-Physical Asset Registry

> Status: **STEP 3B — FLOOR BRANCH / ENDPOINT GRAPH**
>
> This is digital-twin, training, commissioning and facilities information architecture. It is **not construction documentation, engineering approval, or authorization to control physical building systems**.

## Objective

Create one durable identity and data contract that can follow an Equity Uprise asset through:

**authority → 3D model → semantic graph → training scenario → future physical tag → telemetry → commissioning → maintenance**

The registry is the bridge between the existing digital twin and a future physical training facility.

## Step 1 boundary

Step 1 defines the schema and the complete source surface. It does **not** invent manufacturers, models, serial numbers, BACnet addresses, QR/NFC tags, as-built locations, installed equipment, or live-control routes.

## One identity rule

Existing stable inventory IDs are preserved. A quantity-one object normally keeps its existing ID as the canonical `asset_id`.

If one aggregate record later needs individually taggable/maintainable/telemetry-addressable instances, preserve its `source_record_id` and derive `<source_record_id>-I001`, `-I002`, etc.

A future QR/NFC label encodes that same canonical `asset_id`. There is no second physical identifier namespace.

## Whole-building source surface

The Step 1 contract covers the current complete source classes:
- **512** B1–L7 inventory records;
- **288** facade module records;
- **68** facade finish/assembly records;
- **14** service families;
- **10** vertical-riser/separation allocations;
- **56** program/capability records;
- **8** canonical levels from B1 through L7.

These source classes are intentionally different. A service family or capability record is semantic authority and must not automatically become a physical QR-tagged asset.

## Required asset domains

Every future registry asset can carry:
1. canonical identity and physical-tag state;
2. normalized classification plus original source category;
3. level/zone/Core V2 location;
4. authority and provenance;
5. digital representation and model node bindings;
6. physical representation and commissioning fields;
7. verified external semantic bindings such as IFC/BACnet when they actually exist;
8. system/capability/upstream/downstream/dependency relationships;
9. normal/fault/alarm/operating state model;
10. sensor/actuator/command/setpoint/status/alarm/trend/meter/calculated points;
11. training eligibility, objectives, failure modes and reset behavior;
12. security, visibility and command permissions;
13. lifecycle/as-built/commissioning state;
14. service access, maintenance documentation and replacement routes.

## Operating modes

### SIMULATION
Synthetic state and fault injection. Commands are sandboxed and cannot reach physical equipment.

### SHADOW
Authorized physical telemetry may update the twin. **Writes are prohibited.**

### LIVE
Physical commands are **deny-by-default** and require a separately authorized integration, asset-level permissions, role checks, human confirmation where required and audit logging.

Training should work in SIMULATION first, SHADOW second, and LIVE only after real commissioning and explicit authorization.

## Point semantics

Points are modeled independently from visible meshes. A physical or simulated asset may expose sensor, actuator, command, setpoint, status, alarm, trend, meter and calculated points.

Protocol fields may later bind simulation, BACnet, Modbus, OPC UA, MQTT, HTTP or manual observation. Step 1 leaves real addresses null/unverified.

## Relationship graph

The graph supports feeds/served-by, upstream/downstream, dependencies, contains/part-of, located-in, connects-to, monitors, controls, protects, routes-through, mounted-on, adjacent-to, represents-capability, accessed-via and commissioned-against.

This graph is what will let a learner scan or click one asset and trace the related physical/digital system through the building.

## Quantity expansion

Quantity fields are not blindly expanded.

Individual instances are required when an item needs its own:
- physical tag;
- state;
- telemetry/control binding;
- commissioning result;
- maintenance history;
- fault injection;
- inspection/lab score.

Furniture/decorative groups may remain aggregate until a real operational or training need requires instance identity.

## Source precedence

Registry data follows:
1. current Equity Uprise authority;
2. B1/F1–F7 stable inventories;
3. Core V2 shared geometry;
4. building-services authority;
5. facade inventories;
6. capability map;
7. generated geometry/reports as implementation evidence;
8. later verified as-built and commissioning data.

Generated geometry never invents physical facts.

## External semantic alignment

The schema reserves explicit verified fields for IFC/BIM and BACnet-style identities, but does not claim compliance or fabricate identifiers.

## Step 1 acceptance

Step 1 is complete when:
- schema and source contract exist;
- current B1–L7/facade/services/capability counts are verified;
- stable-ID policy is locked;
- SIMULATION/SHADOW/LIVE safety policy is locked;
- physical/commissioning fields exist but remain unassigned;
- state/point/training/security/operations domains are represented;
- CI runs the deterministic verifier.

## Next step

**Step 2 — deterministic registry ingestion.**

Step 2 will create the first real registry document from current authority, preserve stable IDs, make explicit aggregate-vs-instance decisions, and classify each record as digital-only, physicalizable, or deferred.


## Step 3A — B1 operational graph

Step 3A enriches the populated Step 2 registry without changing asset identity.

Authority-backed graph layers:
- B1 source equipment/instances **feeds** one of the nine source-connected service families;
- each of those nine service families **routes_through** its dedicated conceptual riser allocation;
- all 14 service families materialize their declared **depends_on** relationships.

When Step 2 expanded a grouped source record (for example pumps, UPS cabinets or telecom racks), Step 3A resolves the source reference to every deterministic instance ID rather than reconnecting the obsolete aggregate ID.

Every graph edge is written into both:
- the top-level relationship graph; and
- the affected assets' upstream/downstream/dependency fields.

This is the first lab-ready causal layer: a future scenario can start at a B1 component, identify the service family it feeds, identify the riser that carries that service vertically, and follow declared system prerequisites.

Step 3A does **not** claim utility capacities, pipe/duct/wire sizing, external utility connections, live-control connectivity, or engineering approval.

Generated report:
- `production/asset-registry/generated/equity-uprise-asset-registry-step3a-report.json`

**Next:** Step 3B extends the graph from riser/service families into floor branches and representative endpoints, beginning with the operational assets that already have reliable placement.


## Step 3B — floor branch / endpoint graph

Step 3B extends the Step 3A causal graph upward from service systems and dedicated risers into modeled floor handoffs, branch routes and canonical endpoint assets from F1 through L7.

Rules:
- a branch with a verified canonical inventory reference may create an asset relationship;
- an old/generic or ambiguous endpoint never creates a fake physical asset;
- semantic-only branches remain represented in the lab trace report;
- service connection XY is a modeled training coordinate, not an as-built asset center;
- grouped repeated assets are paired one-to-one only when branch count and expanded instance count match; otherwise the branch may serve the full canonical group.

The services builder now publishes deterministic `floor_branch_records` into its generated report. Step 3B consumes those records after the services build, enriches the canonical registry, and produces complete lab-trace records for every modeled F1-L7 service branch.

**Next:** derive first scenario definitions from the graph: source failure, dependency propagation, affected endpoint discovery, inspection route, learner action and reset criteria.
