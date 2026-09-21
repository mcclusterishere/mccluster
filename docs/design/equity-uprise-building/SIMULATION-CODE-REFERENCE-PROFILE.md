# Equity Uprise Digital-Twin Code / Safety Research Profile

> Status: RESEARCH REFERENCE — NOT A COMPLIANCE CERTIFICATION
>
> Retrieval date: 2026-09-21

## Purpose

Equity Uprise is virtual, but its built environment is intended to behave like a serious hypothetical physical headquarters.

This profile records the real-world references used to shape simulation behavior. It does not assert that the virtual building complies with any adopted code.

## Reference baseline

For a concrete U.S. comparison profile, the current Connecticut State Building Code page identifies the **2022 Connecticut State Building Code** as current and states that it is based on the **2021 International Codes**, including the 2021 International Building Code, and references **ICC A117.1-2017** for accessibility.

The Equity Uprise model is not assigned to a Connecticut parcel or permitting jurisdiction. Connecticut is used only as a useful current reference profile unless a later owner decision selects another simulation jurisdiction.

Primary official references consulted:

- Connecticut Department of Administrative Services — Current State Building Code / adopted model codes:
  https://portal.ct.gov/en/das/office-of-state-building-inspector/connecticut-state-building-code/regulations
- ICC 2021 IBC — Section 1028.2 Exit discharge:
  https://codes.iccsafe.org/s/IBC2021P2/chapter-10-means-of-egress/IBC2021P2-Ch10-Sec1028.2
- ICC 2021 IBC — Section 1006.2 egress from rooms/spaces, including basements:
  https://codes.iccsafe.org/s/IBC2021P2/chapter-10-means-of-egress/IBC2021P2-Ch10-Sec1006.2
- U.S. Access Board — Accessible Means of Egress:
  https://www.access-board.gov/ada/guides/chapter-4-accessible-means-of-egress/
- OSHA — Emergency Action Plans / evacuation elements:
  https://www.osha.gov/etools/evacuation-plans-procedures/eap/elements
- OSHA 29 CFR 1910.38 — Emergency Action Plans:
  https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38
- OSHA 29 CFR 1910.36 — Exit routes / exit discharge:
  https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36

## Modeling consequences adopted now

### Floor 1 is the level of exit discharge

Protected stairs must route occupants to grade/open space/public way rather than treating the lobby as a magical endpoint.

### Two remote exit concepts remain valuable

The digital twin retains Stair A and Stair B as separate protected egress concepts.

### Stair continuation below grade requires explicit discharge-direction control

If the stairs continue to B1, Floor 1 must visibly/physically prevent evacuees from unintentionally continuing below the level of exit discharge.

The simulation therefore models discharge-direction barriers/wayfinding at Stair A and Stair B.

### Below-grade accessibility changes the simulation

B1 is below the level of exit discharge. The passenger-elevator landing, protected stairs, two-way communication concepts, and assisted-evacuation procedures therefore need to exist in the training model.

This does not mean an untrained occupant is instructed to use the elevator during a fire.

### Emergency action planning is more than an exit map

The simulation should include:

- emergency reporting;
- evacuation routes;
- roles/chain of command;
- critical-operations shutdown procedures;
- assistance for visitors/people with disabilities;
- accountability at assembly areas;
- rescue/medical roles;
- current emergency contacts.

### Assembly areas need operational logic

The model includes primary and alternate muster locations. Scenarios may change which is safe based on the hazard, wind, responder access or blocked routes.

## Basement decision

A basement is **not assumed to be a code requirement**.

Equity Uprise intentionally adds one B1 technical/service basement because it provides a realistic home for building systems and creates a high-value training environment.

B1 does not receive an E-Q-U-I-T-Y developmental letter and does not become a normal public program floor.

## Future research hooks

Before any claim of compliance or a formal code-validation lab, select and version:

- occupancy classifications;
- occupant loads;
- construction type;
- sprinkler assumptions;
- required exit count/capacity/separation;
- travel/common-path limits;
- fire-resistance ratings;
- elevator/fire-service strategy;
- accessible means-of-egress configuration;
- plumbing fixture assumptions;
- structural design basis;
- MEP design loads;
- site/fire department access assumptions.

Until those are explicitly selected, validators test internal simulation consistency—not legal compliance.
