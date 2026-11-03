# Equity Uprise — Facade Branding + Signage Spec

> Status: **ACTIVE IDENTITY AUTHORITY — EXACT REPO LOGO REQUIRED**
>
> Companion authority: `EXTERIOR-FACADE-UPGRADE-SPEC.md`.
>
> **Not for fabrication or construction.**

## Canonical architectural identity

The building must visibly identify as Equity Uprise using the **actual approved Equity Uprise logo already in this repository**.

Canonical raster source:
- `assets/img/equity-uprise-logo.webp`
- Git blob SHA: `53b9a07ee14c107e45cb13b871bd1637db7bebe6`
- SHA-256: `3dd74068b984173a3c88bfd124f150653cdf04e35657006df2cf8961e57ce29f`

Canonical vector source:
- matching inline `.appbar__eq` SVG in `equity-uprise.html`;
- viewBox `0 0 45.7 24`;
- machine-readable facade copy: `production/facade/equity-uprise-logo-vector.json`.

The approved mark is the navy **E + equals + rising arrow / ascending bars** symbol. It is **not** literal `E = U` typography.

> **v3 brand-slot contract (2026-11-03) — supersedes any instruction below to model the mark or the wordmark as geometry.** No builder draws, traces, extrudes, plates, haloes or letters a mark (root `AGENTS.md`: THE LOGOS ARE NOT YOURS TO DRAW). The facade and every identity wall carry **brand slots**: empty named nodes (`brand-slot::<id>`) whose glTF extras hold the slot record from `production/brand/brand-manifest.json` (centre, normal, up, max width/height, mount, fit `contain`). At runtime `production/brand/equity-uprise-brand-slots.mjs` places the owner-supplied artwork on each enabled slot as one textured plane, scaled proportionally, never cropped or recoloured. Default artwork: `assets/img/equity-uprise-logo.webp` (owner-supplied emblem, includes its own tile). The canopy-fascia slot is empty until the owner supplies a horizontal lockup; the mark is never written out in words. **To assign the building a new logo:** add the owner's file, point `artwork.default` (or a slot's `artwork` variant) at it, update `sha256`, enable any optional slots — no GLB rebuild needed.

Primary institutional wordmark: **Equity Uprise**.

## Brand-color rule

The repo's existing brand treatment is controlling:
- preserve the logo's navy color;
- do not recolor the logo just to survive a background;
- when the architectural surface is dark or visually variable, give the mark a restrained pale architectural plate/ground;
- the pale plate is a mounting treatment, not a replacement logo.

This follows the existing rule in `css/offers.css`.

## Hierarchy

1. **Primary entrance identity**
   - exact approved Equity Uprise logo mark;
   - Equity Uprise institutional wordmark;
   - integrated with entrance/canopy/lobby threshold;
   - mark centered on the main south entrance axis.

2. **Secondary building mark**
   - one carefully placed facade/crown-scale use of the **same approved logo** may be used;
   - it must not be replaced by `E=U` text;
   - should read as architectural identity, not advertising.

3. **Wayfinding**
   - floor / destination / arrival / service signage;
   - consistent typographic and material family;
   - program signage remains subordinate to building identity.

## Rules

- do not redraw the approved logo from memory;
- do not substitute `E=U`, `E = U`, or an invented monogram for the approved mark;
- do not recolor the approved navy mark;
- do not repeat logos on every wall or bay;
- do not create billboard-scale marketing surfaces;
- do not use floating signage that ignores facade geometry;
- signs require a real mounting plane, depth, lighting strategy or material treatment;
- exterior branding must remain legible day and night;
- roof branding may not imply aviation approval or mobility certification.

## Material direction

Appropriate identity treatments may include:
- dimensional reproduction of the approved logo geometry;
- dimensional metal institutional wordmark;
- restrained pale logo backer/plate;
- backlit/halo-lit architectural signage;
- carved/inset mineral base treatment.

Specific fabrication system is unresolved.

## Interior continuity

The exact approved Equity Uprise logo may recur at major institutional thresholds, but floor-specific identity should not compete with the building mark.

The goal is a coherent institution, not a collection of unrelated branded rooms.
