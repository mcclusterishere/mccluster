# Equity Uprise — Building Services / Nervous System Spec

> Status: **ACTIVE WHOLE-BUILDING SERVICES AUTHORITY — SERVICES STEP 6 VERIFIED / STEP 7 ACTIVE**
>
> Machine companion: `production/building-services-core-v2.json`.
>
> Current visible implementation: the canonical Services GLB/viewer layer contains the Step 2 vertical backbone, Step 3 B1 source/plant distribution, Step 4 Floors 1–3 branches, Step 5 Floors 4–6 distribution and representative Level 7 handoffs, plus the verified Step 6 detailed roof terminations, devices, service-screen routes and lightning-protection concept. Step 7 is the active implementation layer for representative interior device, ceiling and service-access realism across Floors 1–6.
>
> **Not for construction or engineering approval.**

## Purpose

Make the digital twin operate conceptually as one serviced building from B1 through the roof.

B1 is the principal visible infrastructure origin; vertical risers distribute services; each floor receives logical branches and endpoints.

## System families

### Electrical
Represent conceptually:
- incoming / main distribution;
- B1 switchgear;
- normal-power distribution;
- emergency/standby distribution;
- UPS-backed loads where appropriate;
- floor electrical panels / distribution points;
- branch pathways to representative loads;
- lighting-power/control relationship.

### Lighting + controls
Represent:
- normal architectural lighting;
- emergency/egress lighting;
- scene/control zones in media, forum, briefing and command spaces;
- exterior / roof lighting;
- occupancy/daylight/control sensors where useful.

### Telecom / data / AV
Represent:
- B1 telecom/core network;
- vertical structured-cabling backbone;
- floor IDF / telecom distribution where needed;
- AV/media paths on Floor 4 and other display-intensive spaces;
- network support for building controls, access devices and digital surfaces;
- representative server/network racks, patching and service clearances.

### BAS / controls / sensing
Represent:
- B1 building automation / observation;
- vertical controls backbone;
- HVAC/environmental sensors;
- flood/sump monitoring;
- electrical/metering status;
- representative alarm/status integration.

### Security / access / communications
Represent where appropriate:
- access-controlled doors;
- readers/controllers;
- intercom / emergency communication;
- cameras in public/service/security-relevant areas;
- restricted B1 / service interfaces.

Security visualization must not expose real secrets, credentials or live occupancy.

### HVAC
Represent:
- B1 mechanical plant concept;
- vertical supply/return/exhaust distribution concept;
- floor branches;
- diffusers/grilles or exposed ductwork depending on room character;
- dedicated environmental support for equipment/media-heavy spaces where plausible;
- roof/service terminations where appropriate.

No equipment capacities are claimed yet.

### Domestic water
Represent:
- B1 water-service origin concept;
- vertical domestic-water riser;
- branches to restrooms, service sinks and other authorized plumbing fixtures.

### Sanitary / vent
Represent:
- plumbing fixture connections at schematic level;
- vertical sanitary/vent stack concept;
- B1 connection/boundary concept only.

### Storm / roof drainage / sump
Represent:
- Level 7 roof drains / drainage collection;
- vertical storm route;
- B1 sump/flood-management relationship where conceptually appropriate;
- no invented municipal connection details.

### Fire protection
Represent:
- B1 fire/water equipment concept;
- vertical sprinkler/standpipe riser concept;
- floor sprinkler branch logic;
- representative valves/status devices;
- extinguisher locations;
- stair-related fire-protection support where appropriate.

### Fire alarm / life safety
Represent:
- initiating/notification devices at representative level;
- emergency communication;
- exit / stair wayfinding;
- interface with access/elevator/building-status concepts.

### Service / housekeeping
Represent:
- janitorial/support storage where needed;
- facilities workshop/storage;
- receiving/staging;
- maintenance access paths;
- replacement routes for significant equipment where conceptually useful.

## Functional traceability

Each machine-readable system must eventually declare:
- source;
- riser/path;
- floors served;
- representative endpoints;
- dependencies;
- visible/concealed behavior;
- service-access expectations;
- unresolved engineering items.

## Simulation boundary

The digital twin may simulate system state, faults and training scenarios.

It must not claim:
- engineered capacity;
- code compliance;
- final pipe/duct/wire sizes;
- final electrical studies;
- final pressure/flow calculations;
- real-life safety approval;
- live operational connectivity unless separately authorized.
