# Equity Uprise Floor 01 — Digital Twin Activity & Simulation Program

> Status: **CANONICAL FLOOR 1 ACTIVITY / SIMULATION AUTHORITY v0.1**
>
> Working developmental stage: **ENTER**
>
> Final E-Q-U-I-T-Y acronym word: **NOT LOCKED**
>
> This document does not replace shared Core V2 geometry. It defines what Floor 1 is for, what people do there, what virtual building systems must exist, and how the floor supports training and simulation.

## 1. Floor 1 mission

Floor 1 performs three jobs simultaneously:

1. the actual front door to Equity Uprise;
2. the place a participant learns how to function inside the institution;
3. the first built-environment simulation laboratory.

Human question:

> Where am I, what am I trying to accomplish, how does this place work, and what should I do next?

Physical-world question:

> Can I safely and correctly enter, navigate, understand, and respond to this building?

## 2. Fidelity rule

Equity Uprise is a virtual building, but the building is designed as a high-fidelity hypothetical physical headquarters.

Real-world architectural, accessibility, life-safety, MEP, IT, security, service, structural, operational and emergency concepts should be modeled where useful.

The project does **not** currently claim real-world code compliance. A later explicit simulation profile may bind a jurisdiction, adopted code editions, occupancy assumptions and engineering assumptions.

The purpose of realism is educational fidelity, scenario quality and believable shared presence.

## 3. Core V2 chassis retained

Keep:

- 72' × 72' floor plate;
- Floor 1 public south entrance;
- entry vestibule;
- passenger elevator;
- freight/service elevator;
- Stair A;
- Stair B;
- restrooms;
- IT/electrical;
- MEP/riser reservation;
- janitor/service;
- north support/service circulation.

The program changes what these systems *do* in the virtual institution. It does not casually move the shared core.

## 4. Primary spaces

| Space | Normal institutional purpose | Simulation / training purpose |
|---|---|---|
| Entry Vestibule | public arrival / spawn threshold | doors, access, power, emergency state |
| Arrival Atrium | orientation, presence, return-to-work | wayfinding, alarms, evacuation |
| Orientation Lounge | onboarding, waiting, mentor greeting | communication, accessible participation |
| Intake / Verification Consultation | private intake, consent, verification, service clinic | privacy, interviewing, document handling |
| Development Passport Studio | goals, competency state, credentials, current project | digital workflow, privacy-aware interfaces |
| Journey Wall | seven-stage progression | emergency-information override |
| Reception / Concierge / Security Desk | help, visitor check-in, access assistance | incident communication, building status |
| Next Action / Building Directory | routing and personal next step | alternate-route/emergency navigation |

## 5. Floor 1 geometry program

Program zones:

- Entry Vestibule: X29–43 / Y0–9
- Arrival Atrium: X20–52 / Y10–30
- Orientation Lounge: X2–18 / Y12–28
- Intake / Verification Consultation: X2–16 / Y32–44
- Development Passport Studio: X20–52 / Y32–44
- Journey Wall: X28–44 / Y50–54
- Reception / Concierge / Security Desk: X30–42 / Y44–47
- Next Action / Building Directory: X49–51 / Y24–29

Shared support/core geometry remains controlled by Core V2.

## 6. Development Passport Studio

The Passport Studio is a shared architectural zone with private individual interfaces.

It supports:

- goals;
- interests/pathway selection;
- competency maturity;
- credential import;
- project history/current project;
- privacy/accessibility preferences;
- next action;
- what the current action unlocks.

Default participant view remains simple:

**Current Stage → Current Project → Next Action → What This Unlocks**

The full competency graph is available on demand, not forced into the default view.

## 7. Reception / concierge / security

The desk supports:

- visitor check-in;
- directions;
- member help;
- accessibility assistance;
- incident communications;
- limited building-status visibility.

Physical/simulation concepts may include:

- intercom;
- visitor credentials;
- emergency/duress communications;
- building-status display;
- life-safety annunciation concepts.

Public proximity never grants staff/private access.

## 8. Intake room modes

Canonical states:

- Open
- Reserved
- Private
- Service Intake
- Assessment
- Simulation

The room can support private onboarding as well as realistic service-clinic workflows such as future VITA-style intake.

## 9. Building systems remain part of the program

### Building Operations / Life Safety
Models alarm state, emergency communication, access, elevator/power/building status.

### IT / Electrical
Models network, access-control, electrical distribution concepts, UPS/backup concepts and metering.

### MEP / Risers
Models vertical infrastructure continuity and gives advanced learners a building-systems training substrate.

### Janitor / Service
Supports realistic maintenance/service circulation and hazard-awareness scenarios.

### Freight / Service Elevator
Supports delivery, equipment replacement, maintenance and service movement.

Restrooms remain because realistic accessibility/plumbing/service planning is itself part of the digital-twin environment.

## 10. Operating modes

- Normal HQ
- New Member Orientation
- Public Service Clinic
- Building Systems Lab
- Emergency Exercise
- After Hours

Geometry stays substantially fixed. Building state and interfaces change.

## 11. Foundational scenarios

Floor 1 should support:

- basic evacuation;
- blocked Stair A;
- passenger-elevator outage;
- power interruption;
- medical incident in lobby;
- privacy error at intake;
- public-service surge;
- network/check-in outage;
- service-area incident.

Different developmental stages can run different versions of the same physical scenario.

A Stage 1 participant may learn to evacuate correctly.

A Stage 6 participant may later analyze why the building systems behaved as they did.

## 12. Exterior / site / exit-discharge layer

The exterior layer is now defined by:

- `FLOOR-01-SITE-EGRESS-SIMULATION.md`
- `production/floor-01/floor-01-site-egress.json`

It provides:

- Stair A east exit-only discharge;
- Stair B north/rear exit-only discharge;
- south public/accessible approach;
- connection to a modeled south public way;
- secure west service/delivery entrance and apron;
- primary and alternate assembly areas;
- responder keep-clear planning zone;
- emergency equipment locations;
- visitor/member accountability logic.

Because Stair A and Stair B continue down to B1, Floor 1 also includes explicit discharge-direction barriers/wayfinding so evacuation does not unintentionally continue below grade.

## 12A. B1 Technical / Service Basement

B1 now exists at **-13'-6"**.

It is not an E-Q-U-I-T-Y developmental floor and is not exposed in the normal public floor selector.

Live B1 does **not** open to learners through Building Systems Lab. The live basement is available only to the McCluster house owner or explicitly delegated underground-operations admin.

Learners/instructors launch a sandboxed clone of B1/tunnel geometry to work with simulated:

- mechanical plant;
- electrical/emergency power;
- fire protection/water;
- network/telecom;
- flood/sump systems;
- facilities/service operations;
- building automation / systems observation.

Floor 1 remains the modeled level of exit discharge.

### Floor 1 underground-access behavior

No new public room is added to Floor 1.

Instead:

- normal elevator selector shows only **1 · 2 · 3 · 4 · 5 · 6 · ↑**;
- B1 is hidden from the Journey Wall and public building directory;
- the passenger-elevator B1 stop is physically modeled but only revealed to house-owner / underground-operations-admin authority;
- stair travel downward from Floor 1 is access-controlled in normal operation;
- egress from B1 upward to Floor 1/exterior remains preserved;
- freight/service movement to B1 remains restricted operational infrastructure;
- Building Systems Lab launches the sandboxed training environment rather than unlocking live B1.

Tunnel authority:

- `UNDERGROUND-TUNNEL-NETWORK-SPEC.md`
- `production/underground-tunnel-network.json`

B1 authority:

- `BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md`
- `production/basement-b1-program.json`

## 13. Multiplayer / avatar behavior

Floor 1 must work completely for one participant.

Multiplayer enhances it through:

- shared arrival/presence;
- lounge conversation;
- mentor/staff presence;
- private room sessions;
- visible activity status;
- private personal screens;
- proximity/spatial communication when implemented.

A nearby avatar may see:

**Working at Passport Studio**

but may not see private Passport data.

## 14. Stateful building-object rule

Important architectural/system objects must eventually be modeled as simulation entities, not only meshes.

A simulated door may know:

- object ID;
- connected spaces;
- normal state;
- access class;
- accessible state;
- power dependency;
- scenario-controlled states;
- failure modes;
- sensors;
- competency/training bindings.

This principle eventually extends to elevators, lighting, alarms, panels, racks, HVAC zones, access-control devices, extinguishers, AEDs, displays and other meaningful systems.

## 15. Competency binding

Primary Stage 1 competencies:

- CORE-01 Self-Direction
- CORE-05 Digital Fluency
- CORE-06 Civic & Institutional Literacy
- CORE-07 Professional Practice
- CORE-08 Safety & Resilience

Floor 1 can also generate secondary evidence for communication, collaboration, ethics/privacy, accessibility, service navigation, public-program delivery and advanced operations competencies.

Competency status remains evidence-backed and separate from system authorization.

## 16. Training / credential binding

When an external training or credential teaches concepts that can be modeled spatially, the building should represent those concepts literally where practical.

Examples include:

- evacuation/incident roles;
- privacy/consent;
- public-service intake;
- access and cybersecurity;
- energy/building systems;
- accessibility;
- service/hazard awareness.

External credentials remain evidence toward competency. They are not automatically competency mastery.

## 17. Machine-readable authority

See:

- `production/floor-01/floor-01-digital-twin-program.json`
- `production/floor-01/floor-01-site-egress.json`
- `production/basement-b1-program.json`

These files are the machine-readable Floor 1/B1 activity, site, egress and simulation companions to this document.
