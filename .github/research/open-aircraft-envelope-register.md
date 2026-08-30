# Site 0 Open Aircraft Envelope Register

**Status:** internal research artifact — not linked or imported by the public HERE site.

**As of:** 2026-08-13

This register converts open-aircraft research into architectural constraints for HITMAN Prim3 Site 0. It is not an aircraft airworthiness registry and does not imply FAA, EASA, military, or other certification.

## Qualification rule

For Site 0, “strict open-source hardware” means the editable design source is public and the license permits people to study, modify, manufacture, distribute, and commercially use the hardware. Publicly viewable drawings alone do not qualify.

Open-source certification and open licensing are **not** airworthiness certifications.

## Site 0 planning classes

| Class | Planning envelope | Use |
|---|---|---|
| **OA-S** | ~15 m clear-width handling class | Current small/open aircraft ecosystem plus handling clearance |
| **OA-M** | ~25 × 25 × 8 m transport envelope | V1/V2, B4 and modular/folding aircraft movement |
| **OA-L** | ~60 m span reference; ~70 m architectural clear zone | Full-span development, L1 deploy/egress where required, L3 operations |

These are **Site 0 conceptual planning values**, not aviation-code minimums.

## Governing facility rule

Aircraft larger than OA-M in operational configuration must be designed with folding, removable, or modular primary structures if they are expected to move through V1/V2 and B4. B2 may assemble at full span in selected halls. L1 may deploy a transported aircraft into a larger egress envelope. L3 is the primary full-span operational deck.

## Register fields

Each record tracks:

1. Project and aircraft type
2. Open-source qualification / license / OSHWA ID when known
3. Maturity
4. Operational geometry
5. Transport geometry
6. Mass / payload where published
7. Source completeness
8. OA class
9. Site 0 compatibility by level/system
10. Verification status

The machine-readable source of truth is `open-aircraft-envelope-register.json` in this same internal directory.

## Research handling

Entries explicitly marked **source refresh required**, **license verification required**, or **geometry extraction required** must not be promoted to verified engineering constraints until the relevant native CAD/source files are inspected and exact X/Y/Z bounding boxes are calculated.

The next register phase should automate CAD bounding-box extraction and add: wheel track, wheelbase, turning sweep, prop/rotor clearance, longest indivisible component, manufacturing processes, and source completeness scores.
