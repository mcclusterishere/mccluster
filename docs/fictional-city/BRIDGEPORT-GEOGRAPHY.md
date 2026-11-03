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

The script does not name these real addresses. Shop signs, tenant uses, heights, façades, entrances, interiors, open yards and connecting walks are authored game adaptations. Actual heights, door positions and interiors are not present in the downloaded footprint layer. The property assignments do not assert that any real owner, resident, business, school or church is part of the story.

| Source footprint | Game tenant | Enterable |
| --- | --- | --- |
| 279819 | Ashline Works | Yes |
| 250870 | Last Light Market | Yes |
| 264675 | Northline Walkups | Yes |
| 264674 | Second Spin Laundry | Yes |
| 283266 | Night Shift Club | Yes |
| 250913 | Brickline School | Yes |
| 279373 | Second Light Chapel | Yes |
| 250867 | Golden Hour Records | Exterior only |
| 279372 | Cinder & Thread | Exterior only |
| 282456 | Park City Print | Exterior only |
| 283235 | Broad Street Books | Exterior only |
| 278987 | Harbor Hardware | Exterior only |
| 279371 | Corner Signal Electronics | Exterior only |
| 265207 | Second Hand Sun | Exterior only |
| 283267 | North Window Café | Exterior only |
| 282451 | Last Stop Repairs | Exterior only |

Common Yard is an open 20 × 14 m space at X −140, Z −300. Railside Yard is an open 14 × 12 m space at X 142, Z −280. Both were checked clear of all 16 source footprints and mapped road widths. The latter contains authored parked-car props.

Road widths are estimates: secondary 12 m, tertiary 8 m, residential/service 6 m, pedestrian paths/steps 2 m. The dataset supplies centerlines, not measured road pavement edges.

The donation bin is a separate collision prop with its own `propPosition`, distinct from the story marker and ordinary market entrance. Story progression follows the unchanged seven-act narrative; Positions returns to Night Shift Club.

## Placement verification

All 18 place entrances, 13 story stop markers and the neighborhood spawn were checked with the runtime `createSpatialWorld` and `isWalkable` at a 0.7 m clearance radius, including the donation-bin and yard-fixture blockers. All 32 checks passed. Source footprint completeness, chronological path reachability and rendering checks remain part of the feature test suite.
