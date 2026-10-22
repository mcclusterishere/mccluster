# The Halo view: design reference and decisions

Owner, 2026-10-21, with four screens:

> "Here's a visual guide for the new Hitman Halo view. I think this would be better. I need you to analyze it and try to get
> it close to this."

The four screens are kept here, unaltered apart from compression:

- `reference/halo-view-01-world.jpg`
- `reference/halo-view-02-missions.jpg`
- `reference/halo-view-03-intelligence.jpg`
- `reference/halo-view-04-people.jpg`

Each is marked "Design preview · Demo data". The build is `js/halo/halo.js` and `css/halo.css`. Where it lives and who may
open it are in `docs/control-plane/HALO-ADMIN-GLOBE.md`.

## What the screens say

**One frame, four tabs.** Every screen has the same frame:

- **Top bar:** the mark and name on the left, the tabs World · Missions · People · Intelligence in the middle (the active
  one underlined in cyan), and the operator with an avatar on the right.
- **Strip:** a page title and line (not on World), coloured counts with dividers, the UTC clock with a green live dot, and
  one outlined amber action.
- **Columns:** a list panel on the left, the Earth in the middle, a detail panel on the right.
- **Timeline:** an activity bar across the bottom.

**The Earth** floats in black space with stars and a blue atmosphere. Over it:

- a search box and a Layers button;
- a column of round controls (north, zoom in, zoom out, locate);
- a hint ("Drag to orbit · Scroll to zoom");
- a legend for that tab's marks;
- a Satellite / Terrain switch.

**Marks** are glowing dots. The selected one has a white ring and an uppercase label with a second line for the place.

**Panels** are deep navy plates with hairline edges and section labels in small uppercase with wide tracking:

- **Lists:** search, segmented tabs with counts, a sort or filter row, and cards. A card has a square thumbnail, a title, a
  place, a status in coloured uppercase with a dot, a progress bar, the due time, and faces.
- **Detail:** breadcrumb, large title, place, status pills, sub-tabs, a progress bar with a fraction and percent, a two-cell
  key/value row, a team of round avatars with status dots, next steps, evidence rows with thumbnails and times, one gold
  primary action, and two outlined secondary actions.

**Colour has jobs:**

| Colour | Meaning |
|---|---|
| Cyan | Observed or selected (the tab underline, active status, the progress bar) |
| Amber | Attention (awaiting review, blocked, the main action) |
| Green | Live or online |
| White | Text only |

## Tokens taken from the screens

| Token | Value | Use |
|---|---|---|
| `--hx-bg` / `--hx-bar` | `#030912` / `#050c17` | page, top bar and strip |
| `--hx-panel` | `rgba(7,14,26,.95)` | panels, timeline |
| `--hx-line` / `--hx-line-2` | `#15243a` / `#22364f` | dividers / panel and control edges |
| `--hx-ink` / `--hx-ink-2` / `--hx-mute` | `#eef3f9` / `#c6d1df` / `#8e9fb5` | text, secondary, labels |
| `--hx-cyan` | `#45b8f4` | observed, selected, progress |
| `--hx-amber` | `#f2b448` | attention; the gold action is `#f7cd86 → #d9a050` with dark text |
| `--hx-green` | `#4fdf98` | live |
| `--hx-red` | `#ff7a7a` | paused, unavailable |
| Type | Inter | labels 11px with 0.16em tracking; titles 25–27px |

## How each part became real

The screens use demo people and photographs. The build uses what McCluster actually has, and says so where it has nothing.

| On the screens | In the build | Source |
|---|---|---|
| "4 Active missions · 8 Team online · 3 Awaiting review" | The same counts from the owner's missions. "Members online" is shown only when five or more are online (a dash otherwise) | `/v1/world/halo/missions` counts, `/v1/world/halo/people` online (k-anonymous) |
| World data groups with switches | The same six groups. Each switch turns its group's live layers on; the disclosure lists each layer with its count or state | the globe's layers and `js/halo/layers.js` |
| "17 available · 4 context · 12 planned" | Counted from what is listed: available layers; the four context views (satellite, street map, 3D cities, borders); Halo layers still to come (networks, dams, data centres, radio, news) | — |
| Source health ("Updated 2m ago", "Calculated", "Partial") | The same words from each layer's own state: Updated *n* ago, Calculated from orbital elements, Stale, Needs a key, Unavailable, Reference | each layer's answer |
| Mission cards with photos, "4 of 6 tasks" | A thumbnail tile in the status colour (missions carry no image); "*n* of *m* verified" (missions have participants and verified proofs, not tasks); Due from the mission's end time | `/v1/world/halo/missions` |
| Owner / Assigned team / Last check-in | Team (joined of capacity) and Due; the team's avatars with their assignment status; "Last activity" from proofs and joins (there are no check-ins) | the same |
| Next steps (checkboxes) | Derived and plain: "Review 2 submitted proofs", "Draft: publish it in the Control Room…" (there is no task list to tick) | the same |
| Evidence thumbnails | Proofs with their kind, author, statement and time; photo proofs load the Worker's short-lived signed link when the owner opens the mission | `/v1/mnet/missions/proofs/:id/media` |
| Review evidence / Open mission / Mission history | Review evidence → the Control Room review (`control.html#create:action-network`); Open mission → its public page; Activity | — |
| People on the map ("MAYA CHEN · reported 4m ago") | **Not built as drawn.** Members agreed only to be counted in regions of five or more. The People Earth shows mission places with head counts; a person's Location reads "Not shared" | privacy: `docs/control-plane/HALO-ADMIN-GLOBE.md` |
| Intelligence feed (water level, camera frame, thermal, AIS, satellites) | The same kinds, each labelled Observed, Calculated, Reported or Reference: USGS quakes, NHC storms, FIRMS hotspots, AIS, the orbital model, and intelligence evidence (Needs review) | the layers, `/v1/intel/evidence` |
| "Water level 0.84 m · MLLW datum" with a chart | A NOAA station opens its observed level, a 24-hour chart (one series, crosshair readout, readings table) and the missions within 300 km | `/v1/world/tides/:station` |
| Briefs / Sources tabs | Briefs: the daily country briefs. Sources: every source with its health | `/v1/news-briefs`, `/v1/intel/health` |
| Satellite / Terrain | Satellite / Map / 3D cities. There is no terrain layer; Google's photoreal city mesh is the 3D view | the globe's base map, ion asset 2275207 |
| Activity: Current / Replay | Current works; Replay is shown and disabled until the time machine (phase 4) | — |
| Ring mark beside the name | The supplied HM mark (`assets/img/hm-mark-96.png`), scaled whole. The ring mark on the screens is not supplied artwork, and a logo is never drawn (CLAUDE.md rule 10) | — |
| No bottom bar | The house app bar stays (owner, 2026-10-15: present in every experience); the timeline sits above it | — |

## Phone first

The screens are desktop. The build starts at 390px (CLAUDE.md rule 12):

- **The frame:** the bar stacks over the four tabs and the strip, and the strip scrolls sideways inside itself.
- **The Earth** sits under the search row.
- **The list** is a sheet at the bottom: its grip or chevron opens it.
- **A selection** opens its detail as a sheet over the list. × closes it.
- **The timeline** is a strip above the app bar.
- **From 768px:** the tabs move into the bar, the list and the detail float as columns, and the Satellite / Map / 3D switch
  joins the Earth's corner from 1200px.
- **From 1200px** the detail column stays open on the first thing in the list.
- **From 1400px** the hint shows.

Only min-width queries. Every control is 44px, form text is at least 16px, and the page never scrolls sideways (checked at
390 and 1280 in `scripts/e2e/world-release.e2e.mjs`).

## Not yet

These remain in the later phases (`docs/control-plane/HALO-ADMIN-GLOBE.md`):

- **Infrastructure layers:** networks, dams, data centres.
- **Places and media:** radio and news.
- **Mission flight and ship arcs.** The screens draw illustrative ones; real ones need a tracked route.
- **Replay.**
- **Per-person check-ins.** These need a consented check-in record first.
