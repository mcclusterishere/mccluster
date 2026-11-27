# Arctic sea ice on the World timeline

Review order: this is an incremental change on the shared cursor from #840, not a standalone merge to main. No database, server process, cron, permissions, external imagery account or production flags are changed.

## Review the journey

Open World, choose the Equity Uprise emblem in the feed row, and turn on **Arctic sea ice archive**. Choose an observation day or use the existing **Time** slider. **View Arctic** points the globe north; scrubbing changes the layer without moving the camera. The archive defaults off, respects the environmental module's existing ready gate, and switching feed scope turns it off. This local viewing choice is not an administrative setting. If WebGL or the raster fails, use **Open flat image** or **Source GeoTIFF**. The flat image is a longitude/latitude strip, not a north-polar map. Live and dates outside the sample show no image. This does not schedule refreshes or represent near-real-time service.

The selected samples are 15 March, 15 June and 15 September 2020, plus each day from 19 to 25 November 2026 UTC. These dates are illustrative and not a representative or climatological sample. Even adjacent frames describe ice *concentration*, not the displacement of a parcel, deformation, thickness, or navigation safety. Do not infer local deformation from a concentration gradient. A movement/deformation study requires separate motion data.

## Data, rights and cost

Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & Stafford, T. (2025). *Sea Ice Index* (G02135, Version 4) [Data set]. National Snow and Ice Data Center. [DOI and citation](https://doi.org/10.7265/a98x-0f50). Subset: northern daily concentration GeoTIFFs for the dates above, accessed 2026-11-27. The [official catalog entry](https://catalog.data.gov/dataset/sea-ice-index-version-4) lists the US government works license; NSIDC [asks for a citation](https://nsidc.org/about/citation-policies) and provides the [product guide](https://nsidc.org/sites/default/files/documents/user-guide/g02135-v004-userguide.pdf). No implied agency endorsement. The observations and original data processing are not ours; our contribution is the derived display, timeline integration and reproducible transformation.

The records are [free to access](https://nsidc.org/data/user-resources/get-started-nsidc-data). We fetched the source bytes over public HTTPS without an account or key. All ten derived PNGs together are 91,583 bytes. Only the selected frame is requested while using this layer; repeated requests may use the ordinary browser/hosting cache. The feature adds no separate hosting, paid API, GPU, tile service or OVH processing. Serving local static files still counts toward whatever bandwidth the existing site uses.

## Reproduce and check

The [manifest](../../data/environment/arctic-ice/manifest.json) lists the exact public URL for every input, source and derived SHA-256 hashes, bytes, palette, dates, bounds and projection. Download those ten inputs into a local directory using the basenames in their URLs; verify hashes before treating reruns as reproductions because recent source releases may change. Install rasterio 1.5, numpy 2 and Pillow 12 in an isolated Python environment, and run from the repository root:

```
python tools/build-arctic-sea-ice.py <local-directory-of-inputs>
node --test scripts/test/arctic-sea-ice.test.mjs scripts/test/world-environment-cursor.test.mjs
```

The script reads a 304 × 448, 25 km NSIDC north polar stereographic grid (EPSG:3411). Native values 150–1000 encode 15–100% concentration in tenths of a percent. Below-threshold ocean has a separate swatch. Surface flags (including coast, land, pole hole and missing data) and pixels outside the grid are transparent, not open water. We classify on the native grid before nearest-neighbor reprojection to EPSG:4326 on a 0.25° display grid (180°W to 180°E, 45°N to 90°N). The display grid does not improve the native 25 km resolution. The four ice categories are editorial display bins; for numeric analysis, use the original grid.

For the local, production-isolated World proof, use the existing prerequisites documented in `scripts/e2e/environment-timeline.e2e.mjs`. Set `E2E_ARCTIC_ONLY=1` for this focused path (included by default in a full run too). A signed-out visitor opens the real feed, selects the layer and two frames, scrubs the shared keyboard control, checks the actual Cesium layer and shows no ice at Live. The local backend uses fixtures, the basemap is neutral, but the sea-ice rasters are the real source-derived observations. Run at 390 and 1280 logical pixels; a physical phone and a hosted, production-shaped preview are separate release checks.
