# S477 responsive UI reference notes

The goal is not to clone any product. These references establish interaction patterns for a digital twin that has to work for two audiences at once: a nontechnical visitor who reads visually, and an engineer who expects traceable data and progressive detail.

## Desktop / responsive web references

- Railway infrastructure metrics — https://mobbin.com/sites/sections/deb1d5b0-2f1f-4c2b-9f46-0af85cf249cb
  - Large sparse metric blocks make scale legible before the visitor reads technical prose.
- Better Stack status presentation — https://mobbin.com/sites/sections/8f9217b8-081f-4fa5-957a-5cadaf07024c
  - Status and historical context are visually obvious without hiding underlying system identity.
- Glide data/infrastructure section — https://mobbin.com/sites/sections/598c5205-72c0-4923-851a-90176d351902
  - Explanatory copy and a technical visual share the same viewport instead of separating marketing from engineering.
- Overmind technical diagram — https://mobbin.com/sites/sections/3a7b8338-2d78-4ced-9d4b-fbe12ac7e393
  - Cinematic technical visualization can carry real system meaning instead of acting as decoration.
- Adaline metric story — https://mobbin.com/sites/sections/9f9dcd49-e0da-4f0d-97f2-d3243eb5b093
  - Large numbers are paired with operational meaning and restrained supporting text.

## Mobile references

- Starlink Ping Success — https://mobbin.com/screens/77305d30-a9e6-42fb-a030-7b706463605f
  - A phone screen leads with one large operational number, then compact supporting telemetry.
- Mercedes-Benz status dashboard — https://mobbin.com/screens/56a361b4-84db-48cf-a4f4-58e398914361
  - Small system cards make a complicated machine understandable as tappable subsystems.
- Flighty airport status hierarchy — https://mobbin.com/screens/b39b56db-5cbc-49e7-879a-a34e5ec36c33
  - Operational state is visible at a glance, with density reserved for users who care.
- Bevel modular data cards — https://mobbin.com/screens/36231197-1ba8-4f80-8b82-e56b30ee3dd1
  - Modular cards make heterogeneous metrics scannable without forcing every metric into the same visual form.
- World App data sheet — https://mobbin.com/screens/145d4921-485b-4181-a95a-ab829598ab8a
  - Dense numerical information remains readable when typography, spacing and section hierarchy are disciplined.

## S477 implementation rules

1. Mobile is not a shrunken desktop. Metric blocks become a horizontal snap rail, the building inspector behaves like a bottom sheet, and system cards become compact modules.
2. Desktop uses width for inspection: large twin canvas, persistent inspector, proportional budget visualization and wider system architecture.
3. Simple mode says what a system does. Engineer mode says what it is, what it depends on, what remains unverified, and how it will be accepted.
4. Never invent live telemetry. Current visuals represent verified site facts, reference-design quantities, budget structure, source provenance and open survey status until real sensors exist.
5. Every beautiful number needs provenance. Every dense engineering detail needs progressive disclosure.