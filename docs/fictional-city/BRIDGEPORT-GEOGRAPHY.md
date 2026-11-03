# Bridgeport neighborhood geometry

The Robbery 1s neighborhood is an additive northern extension of McCluster City. It uses selected downtown Bridgeport building footprints and street centerlines. The original commercial district, garage, HQ island and handoff routes retain their positions and IDs.

## Public source geometry

- Footprints: [CT State GIS Office, 2023 Connecticut Buildings](https://geodata.ct.gov/datasets/ctmaps::2023-connecticut-buildings/about), derived from the 2023 LiDAR collection. [Project overview](https://maps.cteco.uconn.edu/data/flight2023/).
- Government [metadata](https://cteco.uconn.edu/download/metadata/CT_Statewide_BuildingFootprints_2023.xml) gives no access or use restrictions, with temporal and accuracy limitations. Automated adjacent-building merges and tree-cover artifacts are possible.
- Streets: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. Retain this credit and license link with derived street data. The OSM-derived street evidence file remains under ODbL.
- Exact selected footprint rings: `geography/bridgeport-footprints-2023.geojson`. Original OSM ways used to derive the clipped centerlines: `geography/bridgeport-streets-osm.geojson`. Both contain only public geographic data.

## Reproduction

Select complete polygons whose exterior area centroid is inside longitude −73.1921…−73.1885 and latitude 41.1788…41.1808. Retain the entire ring even when an edge extends beyond that selection box. There are **16 selected polygons**, each mapped to exactly one retained city place. None is replaced by an open yard.

Use origin longitude −73.1903, latitude 41.1798. Convert to metres with `x = (lon - lon0) * 111320 * cos(lat0)` and `z = -(lat - lat0) * 111320 - 220`, with latitude converted to radians for cosine. Round derived metre coordinates to four decimal places; the evidence GeoJSON preserves the original source coordinates. Clip street centerline segments to the selection box before applying the same projection. No geometry is rescaled.

Full retained footprint/road bounds are X −153.6721…150.8124 and Z −333.5935…−58.5296. The extension land surface covers X −165…165 and Z −345…−58. Two authored walk links join the original district at X ±32, Z −58.

## Story tenants and authored adaptations

The script does not name these real addresses. Non-government shop signs and tenant uses, heights, façades, game entrances, interiors, open yards and connecting walks are authored game adaptations. Verified government institutions retain their names, addresses and public functions. Actual heights, door positions and interiors are not present in the downloaded footprint layer. The property assignments do not assert that any real owner, resident, business, school or church is part of the story.

| Source footprint | Game tenant | Enterable |
| --- | --- | --- |
| 279819 | Bridgeport Superior Court · G.A. 2 | Exterior only |
| 250870 | Last Light Market | Yes |
| 264675 | Northline Walkups | Yes |
| 264674 | Second Spin Laundry | Yes |
| 283266 | Night Shift Club | Yes |
| 250913 | Brickline School | Yes |
| 279373 | Second Light Chapel | Yes |
| 250867 | Ashline Works | Yes |
| 279372 | Cinder & Thread | Exterior only |
| 282456 | Park City Print | Exterior only |
| 283235 | Broad Street Books | Exterior only |
| 278987 | Harbor Hardware | Exterior only |
| 279371 | Corner Signal Electronics | Exterior only |
| 265207 | Second Hand Sun | Exterior only |
| 283267 | Bridgeport Superior Court · Judicial District | Exterior only |
| 282451 | Last Stop Repairs | Exterior only |

Common Yard is an open 14 × 10 m space at X 6, Z −340, with game entrance/story marker X 1, Z −337, on private parcel 908-20C. Railside Yard is an open 14 × 12 m space at X 17, Z −255, with game entrance/story marker X 17, Z −250.3, on private parcel 915-9B. Both rectangles were checked inside their private parcels, clear of retained footprint edges and estimated road widths, and inside the existing land surface. The latter contains authored parked-car props. The smaller Common Yard fits the available private ground.

Road widths are estimates: secondary 12 m, tertiary 8 m, residential/service 6 m, pedestrian paths/steps 2 m. The dataset supplies centerlines, not measured road pavement edges.

The donation bin is a separate collision prop with its own `propPosition`, distinct from the story marker and ordinary market entrance. Story progression follows the unchanged seven-act narrative; Positions returns to Night Shift Club.

## Placement verification

All 18 place entrances, 13 story stop markers and the neighborhood spawn were checked with the runtime `createSpatialWorld` and `isWalkable` at a 0.7 m clearance radius, including the donation-bin and yard-fixture blockers. All 32 checks passed. Source footprint completeness, chronological path reachability and rendering checks remain part of the feature test suite.

## Government identity correction — 2026-11-03

The owner's clarified rule preserves city and street names, official geography and government entities. Non-government tenants and story people may be authored. A public building is not a vacant commercial slot.

The [official Connecticut court directory](https://portal.ct.gov/dcj/states-attorneys/bridgeport/office-court-locations) identifies the two courts at **172 Golden Hill Street** and **1061 Main Street**. The [municipal parcel service](https://maps.ctmetro.org/server/rest/services/Bridgeport/Bridgeport_Parcels_NAD83/MapServer/7) identifies their state-owned parcels. Their map coordinates fall inside retained CT footprints 279819 and 283267 respectively.

The original Ashline assignment occupied the Golden Hill courthouse footprint. Ashline's story identity and interior now use footprint **250867** on privately owned parcel **908-20C**, replacing the newly authored Golden Hour Records background tenant. The courthouse footprint stays in its original position. North Window Café's assignment similarly becomes the actual Main Street courthouse. Both courts are exterior landmarks with their real public identity, without fictional commercial interiors or story encounters. Heights and facade detail remain illustrative; no surveyed courthouse interior or full architectural reconstruction is claimed.

The original Common Yard point fell on Bridgeport Parking Authority parcel **908-8**. The original Railside Yard point fell on federally owned parcel **913-1**, the Main Post Office grounds. The authored yards have moved to the private parcels above. All 16 selected building polygons remain unchanged.

The minimized [classification evidence](geography/bridgeport-government-classification.json) records all 16 footprint-center parcel matches, the two independent court identifications, yard corrections, source endpoints and limitations. It excludes private personal owner names and mailing addresses. **A center-to-parcel ownership match is not a complete government-use audit:** a footprint may span parcels, and privately owned premises can contain government tenants. Check institutional use as well as ownership before future assignments.

## Elm Street Willy Whackers

The owner selected the pattern “[nearby street] Willy Whackers” for the story's fictional gang. **Elm Street Willy Whackers** is the new group label for the existing Mr. GREAT/Harold crew. Night Shift Club's footprint center is approximately **15.14 m** from the retained Elm Street centerline, compared with **36.48 m** from Golden Hill Street. This is a naming choice on the sourced street grid, not a claim about any real group or organization at that address.

## Verification of this correction

The focused story and spatial suites passed **20/20** locally after the place moves. Following loss of the terminal workspace, the latest corrected source was rebased onto inspected main `fe035461` (with the tested city files unchanged from `49b9f3bf`) and the same **20 test cases passed in an in-memory JavaScript runner**, using the repository runtime and test bodies with filesystem/assertion adapters. This covers all 18 entrances, the 13 stops in order, return to the island, old-save behavior, government-name protection and exact footprint parity.

The full Node/publication/Core suites and a real WebGL device pass still need to run on the review branch. The in-memory check does not establish browser rendering, module loading, publish output or device performance.
