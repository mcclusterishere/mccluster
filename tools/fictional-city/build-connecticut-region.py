#!/usr/bin/env python3
"""McCluster Planet, Connecticut pilot: bounded source acquisition for one small crop.

    python3 -m venv .venv && .venv/bin/pip install pyogrio shapely rasterio numpy
    .venv/bin/python -I tools/fictional-city/build-connecticut-region.py [--cache DIR] [--out FILE]

Stage 1 of 2. This script fetches ONLY what one crop needs, never a statewide archive:

  1. Footprints: CT State GIS Office "2023 Connecticut Buildings" feature service (lidar-derived,
     captured 2023-03-22..2023-05-07), queried by envelope in its native CRS EPSG:6434 (US survey feet).
     Footprints whose exterior area centroid lies in the crop box are kept whole.
  2. Lidar roof heights: the CT 2023 3D Buildings delivery (CT ECO, CC0 per the CT Geodata catalog) is a
     FileGDB of multipatch "cells" with no per-building ID. We HTTP-range-read just the FileGDB system tables
     and the one feature-class table that covers the crop (Block 2 / Block02_C2, ~68 MB compressed) out of the
     503 MB Block 2 zip, then sample roof faces inside each footprint.
  3. Bare-earth terrain: the 2023 hydro-flattened DEM through NOAA's public mirror (EPSG:6433 metres, NAVD88),
     read as a window from the VRT over HTTP range requests and averaged to TERRAIN_STEP_M posts.

Output: tools/fictional-city/data/connecticut-pilot/<crop>.source.json, a small normalized file in source
coordinates (State Plane feet for footprints, State Plane metres for the terrain grid). Raw downloads stay in
--cache (default: a scratch directory outside git). Stage 2 is build-connecticut-region.mjs (Node, no network,
deterministic): georeference → simplify → LOD → chunk → manifest with hashes.

Published output carries geometry and heights only. Source data has no names; this script copies no
attribute except the source OBJECTID and GlobalID. All uses and names in the game are invented.
"""
import argparse, hashlib, json, os, struct, sys, urllib.parse, urllib.request, zlib, datetime

UA = 'mccluster-planet-prep/0.1 (+https://github.com/mcclusterishere/mccluster)'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

CROP = {
    'id': 'bridgeport-harbor-west',
    'description': 'Downtown Bridgeport west bank of the inner harbour, south of the authored McCluster City frame',
    'bbox': [-73.1940, 41.1695, -73.1830, 41.1745],  # W, S, E, N (NAD83(2011) ~ WGS84 degrees)
    'selection': 'complete footprints whose exterior area centroid lies inside bbox',
}
FOOTPRINTS = {
    'id': 'ct-gis-2023-buildings-2d',
    'url': 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/CT_Buildings/FeatureServer/0/query',
    'item': 'https://www.arcgis.com/home/item.html?id=1fc1468133cc4080a9cd8d64c49c8b2d',
}
BLDG3D = {
    'id': 'ct-eco-2023-3d-buildings',
    # Plain HTTP: through this environment's proxy the https chain of cteco.uconn.edu fails to verify.
    # Integrity is pinned by size + Last-Modified + per-member SHA-256 below.
    'zip': 'http://cteco.uconn.edu/download/buildings/2023/CT_3D_Buildings_Block2_2023.zip',
    'zipBytes': 503546483,
    'table': 'a0000003b',
    'layer': 'Block02_C2',
    'system': ['a00000001', 'a00000002', 'a00000003', 'a00000004', 'a00000005', 'a00000006', 'a00000007'],
}
DEM = {
    'id': 'ct-2023-dem-noaa-mirror',
    'vrt': 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/CT_Statewide_DEM_2023_10316/CT_Statewide_DEM_2023_m10316_EPSG-6433.vrt',
}
TERRAIN_STEP_M = 4.0
DEFAULT_HEIGHT_M = 6.0  # estimated when no lidar roof face is found inside a footprint
FT = 1200 / 3937


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def http(url, headers=None, timeout=120):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


# ---------- 1. footprints ----------
def fetch_footprints(cache):
    W, S, E, N = CROP['bbox']
    pad = 0.0006  # also fetch footprints that cross the edge; selection is by centroid below
    features, offset, raw_hashes = [], 0, []
    while True:
        q = {'geometry': f'{W - pad},{S - pad},{E + pad},{N + pad}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
             'outSR': 6434, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'OBJECTID,GlobalID',
             'orderByFields': 'OBJECTID', 'resultOffset': offset, 'resultRecordCount': 1000, 'f': 'json'}
        body, _ = http(FOOTPRINTS['url'] + '?' + urllib.parse.urlencode(q))
        raw_hashes.append(sha256(body))
        with open(os.path.join(cache, f'footprints-{offset}.json'), 'wb') as fh:
            fh.write(body)
        d = json.loads(body)
        if 'error' in d:
            raise SystemExit('footprint query failed: ' + json.dumps(d['error']))
        features += d['features']
        if not d.get('exceededTransferLimit'):
            break
        offset += len(d['features'])
    return features, raw_hashes


def centroid(ring):
    # Area centroid computed relative to the first vertex: raw large coordinates cancel catastrophically.
    ox, oy = ring[0]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        x0, y0, x1, y1 = x0 - ox, y0 - oy, x1 - ox, y1 - oy
        c = x0 * y1 - x1 * y0
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    a /= 2
    return (cx / (6 * a) + ox, cy / (6 * a) + oy), abs(a)


# ---------- 2. lidar 3D buildings (range-read from the regional zip) ----------
def rng(url, a, b):
    body, _ = http(url, {'Range': f'bytes={a}-{b}'}, timeout=600)
    return body


def zip_directory(url, size):
    tail = rng(url, size - 70000, size - 1)
    i = tail.rfind(b'PK\x05\x06')
    n, cdsize, cdoff = struct.unpack('<HII', tail[i + 10:i + 20])
    if cdoff == 0xffffffff or n == 0xffff:
        j = tail.rfind(b'PK\x06\x06')
        n, cdsize, cdoff = struct.unpack('<QQQ', tail[j + 32:j + 56])
    data, out, p = rng(url, cdoff, cdoff + cdsize - 1), [], 0
    while p < len(data) and data[p:p + 4] == b'PK\x01\x02':
        meth, = struct.unpack('<H', data[p + 10:p + 12])
        crc, csz, usz = struct.unpack('<III', data[p + 16:p + 28])
        fl, el, cl = struct.unpack('<HHH', data[p + 28:p + 34])
        off, = struct.unpack('<I', data[p + 42:p + 46])
        name = data[p + 46:p + 46 + fl].decode()
        extra, q = data[p + 46 + fl:p + 46 + fl + el], 0
        while q < len(extra):
            hid, hl = struct.unpack('<HH', extra[q:q + 4])
            if hid == 1:
                vals, k = extra[q + 4:q + 4 + hl], 0
                if usz == 0xffffffff: usz, = struct.unpack('<Q', vals[k:k + 8]); k += 8
                if csz == 0xffffffff: csz, = struct.unpack('<Q', vals[k:k + 8]); k += 8
                if off == 0xffffffff: off, = struct.unpack('<Q', vals[k:k + 8]); k += 8
            q += 4 + hl
        out.append({'name': name, 'method': meth, 'crc32': crc, 'csize': csz, 'size': usz, 'offset': off})
        p += 46 + fl + el + cl
    return out


def zip_member(url, ent):
    h = rng(url, ent['offset'], ent['offset'] + 29)
    fl, el = struct.unpack('<HH', h[26:30])
    start = ent['offset'] + 30 + fl + el
    raw = rng(url, start, start + ent['csize'] - 1)
    body = zlib.decompress(raw, -15) if ent['method'] == 8 else raw
    if zlib.crc32(body) & 0xffffffff != ent['crc32'] or len(body) != ent['size']:
        raise SystemExit('zip member failed CRC/size check: ' + ent['name'])
    return body


def fetch_3d(cache):
    gdb = os.path.join(cache, 'ct3d-' + BLDG3D['layer'] + '.gdb')
    os.makedirs(gdb, exist_ok=True)
    _, headers = http(BLDG3D['zip'], {'Range': 'bytes=0-0'})
    entries = zip_directory(BLDG3D['zip'], BLDG3D['zipBytes'])
    want = tuple(BLDG3D['system'] + [BLDG3D['table']])
    members = []
    for ent in entries:
        base = ent['name'].rsplit('/', 1)[-1]
        if not base or not (base.split('.')[0] in want or base in ('gdb', 'timestamps')):
            continue
        dest = os.path.join(gdb, base)
        if not (os.path.exists(dest) and os.path.getsize(dest) == ent['size']):
            with open(dest, 'wb') as fh:
                fh.write(zip_member(BLDG3D['zip'], ent))
        with open(dest, 'rb') as fh:
            members.append({'name': base, 'bytes': ent['size'], 'sha256': sha256(fh.read())})
    return gdb, {'lastModified': next((v for k, v in headers.items() if k.lower() == 'last-modified'), None), 'members': sorted(members, key=lambda m: m['name'])}


def roof_stats(footprints, gdb):
    import pyogrio
    from pyogrio.raw import read
    from shapely import wkb
    from shapely.geometry import Polygon
    layers = [l[0] for l in pyogrio.list_layers(gdb)]
    if layers != [BLDG3D['layer']]:
        raise SystemExit(f'expected only {BLDG3D["layer"]} in the partial FileGDB, found {layers}')
    xs = [x for f in footprints for x, _ in f['ring']]
    ys = [y for f in footprints for _, y in f['ring']]
    _, _, geoms, _ = read(gdb, layer=BLDG3D['layer'], bbox=(min(xs), min(ys), max(xs), max(ys)))
    faces = []  # (2D polygon, mean z ft, plan area sq ft)
    for g in geoms:
        for part in wkb.loads(g).geoms:
            coords = list(part.exterior.coords)
            flat = Polygon([(x, y) for x, y, _ in coords])
            if flat.area < 1.0:  # vertical walls project to (almost) nothing
                continue
            faces.append((flat, sum(c[2] for c in coords) / len(coords), flat.area))
    for f in footprints:
        poly = Polygon(f['ring']).buffer(0)
        inside = sorted((z, a) for flat, z, a in faces if poly.contains(flat.representative_point()))
        if not inside:
            f['roof'] = None
            continue
        # Each closed multipatch carries its bottom slab at the base elevation; roof planes sit above it.
        base = inside[0][0]
        roofs = [(z, a) for z, a in inside if z > base + 0.5] or inside
        total, acc, p95, p50 = sum(a for _, a in roofs), 0.0, None, None
        for z, a in roofs:
            acc += a
            if p50 is None and acc >= 0.5 * total: p50 = z
            if p95 is None and acc >= 0.95 * total: p95 = z
        f['roof'] = {'faces': len(inside), 'roofFaces': len(roofs), 'baseFt': round(base, 2), 'p50Ft': round(p50, 2), 'p95Ft': round(p95, 2)}


# ---------- 3. terrain ----------
def fetch_terrain():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    os.environ.setdefault('GDAL_HTTP_USERAGENT', UA)
    os.environ.setdefault('CURL_CA_BUNDLE', os.environ.get('SSL_CERT_FILE', '/root/.ccr/ca-bundle.crt'))
    W, S, E, N = CROP['bbox']
    x0, y0, x1, y1 = transform_bounds('EPSG:6318', 'EPSG:6433', W, S, E, N, densify_pts=21)
    # snap the grid to whole TERRAIN_STEP_M metres so a rebuild lands on the same posts
    st = TERRAIN_STEP_M
    x0, y0 = (x0 // st) * st, (y0 // st) * st
    x1, y1 = -((-x1) // st) * st, -((-y1) // st) * st
    cols, rows = int(round((x1 - x0) / st)), int(round((y1 - y0) / st))
    with rasterio.open('/vsicurl/' + DEM['vrt']) as ds:
        win = from_bounds(x0, y0, x1, y1, ds.transform)
        a = ds.read(1, window=win, out_shape=(rows, cols), resampling=Resampling.average, masked=True)
        res = ds.res
    import numpy as np
    mask = np.ma.getmaskarray(a)
    heights = [None if mask[r, c] else int(round(float(a[r, c]) * 100)) for r in range(rows) for c in range(cols)]
    return {'crs': 'EPSG:6433', 'vertical': 'NAVD88 metres', 'sourceResolutionM': list(res), 'stepM': st,
            'originM': [x0, y1], 'cols': cols, 'rows': rows, 'order': 'row-major from the north-west post; row r is northing originM[1] - (r + 0.5) * stepM, column c is easting originM[0] + (c + 0.5) * stepM',
            'heightsCm': heights}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.environ.get('CT_PILOT_CACHE', os.path.join(os.path.expanduser('~'), '.cache', 'mccluster-ct-pilot')))
    ap.add_argument('--out', default=os.path.join(HERE, 'data', 'connecticut-pilot', CROP['id'] + '.source.json'))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    raw, raw_hashes = fetch_footprints(args.cache)
    from rasterio.warp import transform
    W, S, E, N = CROP['bbox']
    seen, footprints = set(), []
    for feat in raw:
        oid, rings = feat['attributes']['OBJECTID'], feat['geometry']['rings']
        if oid in seen:
            continue
        seen.add(oid)
        (cx, cy), area = centroid(rings[0])
        lon, lat = transform('EPSG:6434', 'EPSG:6318', [cx], [cy])
        if not (W <= lon[0] <= E and S <= lat[0] <= N):
            continue
        footprints.append({'sourceId': oid, 'globalId': feat['attributes']['GlobalID'].lower(),
                           'ring': [[round(x, 2), round(y, 2)] for x, y in rings[0]],
                           'holes': [[[round(x, 2), round(y, 2)] for x, y in h] for h in rings[1:]],
                           'areaSqFt': round(area, 1)})
    footprints.sort(key=lambda f: f['sourceId'])

    gdb, zipinfo = fetch_3d(args.cache)
    roof_stats(footprints, gdb)
    terrain = fetch_terrain()

    out = {
        'schema': 'mccluster.planet.source-crop/v1',
        'region': 'connecticut-pilot',
        'crop': CROP,
        'retrievedAt': datetime.date.today().isoformat(),
        'sources': {
            FOOTPRINTS['id']: {'url': FOOTPRINTS['url'], 'item': FOOTPRINTS['item'], 'crs': 'EPSG:6434 (US survey feet)', 'responseSha256': raw_hashes,
                               'fieldsKept': ['OBJECTID', 'GlobalID']},
            BLDG3D['id']: {'zip': BLDG3D['zip'], 'zipBytes': BLDG3D['zipBytes'], 'zipLastModified': zipinfo['lastModified'],
                           'layer': BLDG3D['layer'], 'members': zipinfo['members'], 'crs': 'EPSG:6434 + NAVD88 height (ftUS)'},
            DEM['id']: {'vrt': DEM['vrt'], 'crs': 'EPSG:6433 + NAVD88 (metres)'},
        },
        'heightRule': {'roof': 'area-weighted 95th percentile of the mean z of non-vertical 3D roof faces (above the multipatch bottom slab) whose interior point lies in the footprint; baseFt is the bottom slab',
                       'ground': 'median bare-earth DEM post inside the footprint (stage 2)', 'fallbackHeightM': DEFAULT_HEIGHT_M},
        'footprints': footprints,
        'terrain': terrain,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
        fh.write('\n')
    lidar = sum(1 for f in footprints if f['roof'])
    print(json.dumps({'out': os.path.relpath(args.out, ROOT), 'footprints': len(footprints), 'lidarRoofs': lidar,
                      'terrainPosts': terrain['cols'] * terrain['rows'], 'bytes': os.path.getsize(args.out)}))


if __name__ == '__main__':
    sys.exit(main())
