# Do active and quiet ice need different scaling slopes?

**Pilot result: splitting by activity helped estimate the level of deformation, but fitting an additional slope did not improve the held-out score.** This is a small retrospective experiment on public MOSAiC observations, not evidence of a universal ice law. It is separate from the Globe's ice-concentration layer: measuring how much surface is ice does not measure how that ice deforms.

## The question and the field

[Hutchings et al. (2024)](https://doi.org/10.1029/2024GL108582) used Beaufort Sea buoys to test scaling across floes and aggregates; including small scales undermined a single scale-invariant description. [Uusinoka et al. (2025)](https://doi.org/10.5194/tc-19-6493-2025) used MOSAiC ship radar and saw scaling during active winter events above roughly 100 m, but not the same pattern in the summer floe regime. Those experiments used different places, instruments, scales and sampling intervals. These papers motivate the test; this pilot does **not** adjudicate a contradiction or reproduce either experiment. Most recently, [Hutter & Bitz (2026)](https://tc.copernicus.org/articles/20/6331/2026/) used this same Sentinel-1 archive to study floe-size distributions and deformation history. Here the response is deformation as a function of **observation-window size**, not floe size.

## Run it

From this directory with Python 3.12 and NumPy: `python pilot.py --records results/observations.json --out replay`. No download or credentials. Compare replay/validation.json with the checked-in validation. Each row in observations.json contains the source filename, UTC endpoints, SHA-256 of the input, proxy-region and target-region summary rates, support sizes, and local projected-to-ground scale factors. The [worksheet](WORKBOOK.ipynb) uses just those observations.

To rebuild directly from the source files, preferably in a fresh virtual environment:

```sh
python -m pip install -r requirements.txt
python fetch.py cache --download
python pilot.py --cache cache --out rebuilt
python -m unittest -v
```

The download consisted of **615,529,314 bytes** across 13 individual NetCDF files, not the entire dataset. Fetching never registers an account. When fetching a later revision, compare its hashes with results/observations.json *before* calling it a reproduction. Refit output can differ at floating-point precision across BLAS or operating systems. Nothing runs on a server, trains an AI model, or changes the site.

## What we measured

One near-24-hour pair in each of 13 UTC weeks, October 15, 2019 06:02 to January 7, 2020 04:24 (pair intervals 22.20–24.68 h). One pair characterizes the **sampled day**, not a whole week's ice. These are historical scenes around a drifting Arctic expedition, not a map of the entire Arctic. The native 50 m SAR pixel is *not* the resolution of the deformation data. Drift is gridded at 700 m; [Ringeisen et al. (2023)](https://doi.org/10.5194/tc-17-4047-2023) report about 1.4 km deformation resolution. Target block sides are 2.8, 5.6 and 11.2 km in EPSG:3413, approximately 2.88, 5.76 and 11.52 km on the ground here (ground lengths about 2.7–3.1% larger than projected).

For each square, average the **signed** velocity-gradient components first. With horizontal velocities u and v and subscripts denoting derivatives, compute

    divergence = ux + vy
    shear = sqrt((ux − vy)² + (uy + vx)²)
    total rate = sqrt(divergence² + shear²)

Area-average those norms over common coverage and convert from per second to per day. Opposing distortions in a block can cancel in the gradient average. Averaging already-positive pixel magnitudes would erase that scale dependence. This is a block-gradient proxy using the authors' regridded derivative fields, **not** a reproduction of their native total-deformation raster, ship-radar finite strain, concentration, thickness, or floe size.

Activity was the western region’s 1.4 km block estimate. East-region target data were separated from the west by an 11.2 km gap. Each held-out scene was classified using the median proxy of its *training* weeks. Matching activity and target on the same day gives a conditional estimate, **not a future forecast**. The sectors share atmospheric/ice conditions. Absolute rates and labels depend on the footprint and tracking method.

## What happened

Lower is better: mean squared difference of predicted and observed natural-log rates. One equally weighted score per held-out week. Each fit withheld that week, embargoed its immediate neighbors, and rejected touching or overlapping acquisition windows.

| Setup | Pooled | Different levels, one slope | Different levels and slopes |
|---|---:|---:|---:|
| Primary | 0.3341 | **0.2529** | 0.2556 |
| Strict coverage | 0.3306 | **0.2446** | 0.2471 |
| Grid origin shifted 5.6 km | 0.3213 | **0.2470** | 0.2501 |
| Classifier and response sectors reversed | 0.2649 | **0.1952** | 0.1972 |

The primary common-slope/two-level model lowered error by about 24% relative to pooling. Adding different slopes raised it by about 1.1% and won in only 2 of 13 primary held-out weeks. The fold-by-fold squared-error difference (two slopes minus one shared slope) ranged from −0.0050 to +0.0171. Descriptive fitted signed slopes for lower and higher activity using all 13 pairs were −0.304 and −0.272; these are **not** independent validation or evidence of statistical significance. If using D ∝ L^−β, β is the negative of each signed slope. See [frozen protocol](PROTOCOL.md) and [per-fold scores](results/validation.json).

**Limits and next test.** Thirteen correlated early-season days, shifting footprints, tracking noise and just three target scales limit power. The exact methods, intervals and scales differ from the cited studies. Texture reliability is required to be present but not calibrated into a retrieval error model. We did not estimate a sensor-error distribution, a population confidence interval, an intrinsic scale break, or the minimum valid continuum scale. Plan an untouched post-gap seasonal block, independent ship/wind proxy where available, explicit propagation of drift errors, and more spatial/temporal replication *before* broader claims. The dataset itself has a January 14–March 15, 2020 coverage gap. No simulated data are presented as measurements.

**Credit.** Observations derived from Luisa von Albedyll & Nils Hutter (2023), *High-resolution sea ice drift and deformation from sequential SAR images in the Transpolar Drift during MOSAiC 2019/2020*, [PANGAEA DOI](https://doi.org/10.1594/PANGAEA.958449), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The derived summary tables retain this attribution and license. The new contributions here are the pilot selection, aggregation, model comparison, software and teaching materials, developed with AI assistance. No affiliation with or endorsement by the data producers or Haystack is implied.
