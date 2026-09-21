# Equity Uprise Floor 1 — Site / Exit-Discharge Simulation Layer

> Status: **CANONICAL FLOOR 1 EXTERIOR / EGRESS SIMULATION AUTHORITY v0.1**

Floor 1 is the level of exit discharge.

This layer gives protected stairs, the public entrance, service entrance, exterior walks, public-way connection, emergency equipment and assembly/accountability workflow a real spatial destination instead of ending at the building wall.

## Exterior organization

- South: public/accessible approach and public-way/street edge.
- East: Stair A discharge walk to the south public way.
- North/rear: Stair B discharge to an exterior open route that continues to the public way.
- West: secure service/delivery apron and service entrance.
- East/southeast and northeast: primary/alternate assembly areas outside the immediate building keep-clear zone.

## Protected-stair discharge

Stair A receives an exit-only east exterior discharge door.

Stair B receives an exit-only north exterior discharge door.

Neither becomes a normal public entrance.

Because both stairs continue down to B1, Floor 1 includes explicit discharge-direction barriers/wayfinding so an evacuating occupant is not unintentionally carried below grade.

## Emergency equipment represented

The Floor 1 simulation model now reserves:

- AED;
- first-aid kit;
- marked fire-extinguisher cabinets;
- service spill kit;
- two You-Are-Here / egress maps;
- emergency two-way communication concept at the passenger-elevator landing.

## Emergency Action Plan simulation

The site layer supports:

- reporting an emergency;
- primary/alternate evacuation routes;
- critical-operations shutdown roles;
- accountability after evacuation;
- visitor/contractor accountability;
- rescue/medical-role distinction;
- incident contact roles.

## Assembly areas

Two assembly areas exist because a single fixed muster location is not appropriate for every scenario.

The scenario engine may choose the safe location based on:

- incident origin;
- blocked route;
- simulated wind/plume direction;
- responder access;
- secondary hazard.

## Service entrance

A secure west service/delivery entrance connects the exterior service apron to the west service approach and freight/service core.

It is not a public entrance and not counted as a substitute for a required exit.

## Machine-readable authority

See:

`production/floor-01/floor-01-site-egress.json`

**NOT FOR CONSTRUCTION / NOT A CODE-COMPLIANCE CLAIM.**
