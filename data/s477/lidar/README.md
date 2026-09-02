# S477 LiDAR

The official 2023 Connecticut statewide LiDAR is connected to this project through NOAA dataset **10296**.

## What is available now

- Classified LAS/LAZ point cloud
- Streamable EPT point cloud
- NOAA browser-based 3D viewer
- Tile indexes in Shapefile and GeoPackage formats
- Hydro-flattened DEM derivatives
- Accuracy and delivery reports
- LiDAR-derived Connecticut building footprints

See `source-manifest.json` for machine-readable provenance and access URLs.

## Why the 4.1 TB statewide dataset is not committed to Git

The full statewide point cloud contains 23,381 tiles and hundreds of billions of points. Committing the statewide binary source would make this project repository effectively unusable and would duplicate an authoritative public cloud source.

The engineering pattern is:

1. Keep official provenance and stable source URLs in Git.
2. Resolve the exact 477 Broad Street parcel/building geometry from the City parcel service.
3. Crop only the site and immediate context from the NOAA EPT or tiled LAZ source.
4. Commit lightweight web derivatives such as GeoJSON, a hillshade preview, footprint polygons and metadata.
5. Store the cropped raw point cloud in object storage or Git LFS and reference it here.

## Current site-subset gate

**Status: parcel-accurate crop pending.**

The City of Bridgeport / MetroCOG parcel geometry service has been identified, but the exact feature geometry still needs to be extracted and matched to 477 Broad Street. We intentionally do not use a guessed geocoder point as the final crop boundary.

Once the parcel geometry is resolved, the preferred derived package is:

- `s477-site-classified.laz`
- `s477-site-building-ground.copc.laz`
- `s477-site-dem.tif`
- `s477-site-hillshade.webp`
- `s477-site-footprint.geojson`

The website should use the lightweight derived geometry and previews. Engineer workflows can follow the manifest back to the raw point cloud.