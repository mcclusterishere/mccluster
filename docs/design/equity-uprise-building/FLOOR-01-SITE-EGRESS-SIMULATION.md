# Equity Uprise Floor 1 — Site / Exit-Discharge Simulation Layer

> Status: **CANONICAL FLOOR 1 EXTERIOR / EGRESS SIMULATION AUTHORITY v0.1**

Floor 1 is the level of exit discharge.

This layer gives protected stairs, the public entrance, service entrance, exterior walks, public-way connection, emergency equipment and assembly/accountability workflow a real spatial destination instead of ending at the building wall.

## Exterior organization

- South: public/accessible approach and public-way/street edge.
- East: Stair A discharge walk to the south public way.
- West: Stair B discharge (via the kept-clear west service approach X0-18 / Y54-60) through the west exit leaf to a marked walk south to the public way.
- West: secure service/delivery apron and service entrance.
- East/southeast and northeast: primary/alternate assembly areas outside the immediate building keep-clear zone.

## Protected-stair discharge

Stair A receives an exit-only east exterior discharge door.

Stair B discharges through the level of exit discharge (IBC 1028.1 exception 1 used as the simulation reference: one of the two stairs) to the west exit leaf at X0 / Y54.3-57.1, paired in one frame with the secure service leaf (Y57.1-59.9).

**v3 model reconciliation (2026-11-03).** The egress plan used to carry two doors the model did not have:
- the Stair A east exit (then Y56-60) — the stair wall was solid and the facade had a glass slit; the opening ran onto the top tread of the B1 flight. It is now Y55.0-58.2, on the Stair A Floor 1 landing, and exists as a real opening + leaf in the combined chassis, the Floor 1 model and the facade (`FAC-EAST-F1-M10`, classification `egress_door`);
- the Stair B north exit (Y72 / X12-15) — physically impossible: the stair's north end is the mid-landing at -6.75 / +6.75 ft, with no Floor 1 landing there. Relocated as above.
The discharge-direction barriers now sit across the head of each down-flight to B1 (east strip, Y58.25), not across the stair doors. `production/interiors/audit_interior_consistency.py` fails CI if any of these drift.

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
