"""Build selected display-only Sea Ice Index v4 frames; inputs are local, no network.
Usage: python tools/build-arctic-sea-ice.py <directory-of-northern-GeoTIFFs>
Dependencies: rasterio 1.5, numpy 2, Pillow 12. No dependency is shipped to the browser.
"""
from datetime import date
from pathlib import Path
import calendar
import hashlib
import json
import sys
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / 'data/environment/arctic-ice'
DAYS = ('2020-03-15', '2020-06-15', '2020-09-15', *(f'2026-11-{d:02}' for d in range(19, 26)))
BOUNDS = (-180, 45, 180, 90)
WIDTH, HEIGHT = 1440, 180
# Sequential indexed product, not RGB values sampled from a map or implied precision.
PALETTE = [(0, 0, 0), (26, 65, 111), (39, 126, 157), (65, 193, 201),
           (146, 228, 220), (238, 255, 249)]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

def build(source_dir, output):
    output.mkdir(parents=True, exist_ok=True)
    frames = []
    for day in DAYS:
        d = date.fromisoformat(day)
        filename = f'N_{d:%Y%m%d}_concentration_v4.0.tif'
        source = source_dir / filename
        url = f'https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/geotiff/{d:%Y}/{d:%m}_{calendar.month_abbr[d.month]}/{filename}'
        with rasterio.open(source) as src:
            if (src.crs.to_epsg(), src.count, src.res, src.width, src.height) != (3411, 1, (25000, 25000), 304, 448):
                raise ValueError(f'{day}: unexpected source grid')
            native = src.read(1)
            if not np.isin(native[(native > 1000)], [2510, 2520, 2530, 2540, 2550]).all():
                raise ValueError(f'{day}: unknown flag')
            # Native concentration is tenths of a percent. 0 is ocean below the
            # product threshold. Non-concentration flags and out-of-grid are masked.
            sample = np.zeros(native.shape, dtype='uint8')
            sample[native < 150] = 1
            for boundary, code in [(150, 2), (400, 3), (700, 4), (900, 5)]:
                sample[(native >= boundary) & (native <= 1000)] = code
            dest = np.zeros((HEIGHT, WIDTH), dtype='uint8')
            reproject(sample, dest, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=from_bounds(*BOUNDS, WIDTH, HEIGHT), dst_crs='EPSG:4326',
                      resampling=Resampling.nearest, dst_nodata=0)
        image = Image.fromarray(dest)
        image.putpalette([x for color in PALETTE for x in color])
        path = output / (day + '.png')
        image.save(path, transparency=0, optimize=True)
        frames.append(dict(day=day, url=url, sourceSHA256=sha(source), image=path.name,
                           imageSHA256=sha(path), bytes=path.stat().st_size))
    manifest = dict(product='NOAA/NSIDC Sea Ice Index v4, daily northern concentration',
                    doi='https://doi.org/10.7265/a98x-0f50', sourceCRS='EPSG:3411',
                    outputCRS='EPSG:4326', bounds=list(BOUNDS), dimensions=[WIDTH, HEIGHT],
                    colors=['#%02x%02x%02x' % c for c in PALETTE], frames=frames)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    build(Path(sys.argv[1]), OUT)
