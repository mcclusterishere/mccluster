import { SOURCE_CLASSES, PERSISTENCE } from './source-registry.js';

/*
  Planetary sensing sources: the physical earth, not the built one.

  Flights and vessels are discrete objects and fit in rows. The systems that
  actually move the planet -- wind, ocean current, radar reflectivity, lightning,
  space weather -- are continuous fields, published as gridded binaries (GRIB2,
  NetCDF, radar chunks) that are hundreds of megabytes per timestep and produced
  every few minutes, forever. NOAA alone publishes tens of terabytes a day.

  Which forces the architectural decision that makes planetary scale possible:

    INDEX, DO NOT INGEST.

  For a field source we record WHERE each timestep lives and what it covers --
  model run, valid hour, variable, bounding box, object key -- and read the bytes
  on demand with a ranged request when a query actually needs them. Storing every
  grid cell is impossible for anyone, including the agencies producing them.
  Knowing where every one of them is, and fetching in milliseconds, is not.
  Trillions of observations become addressable without ever being copied.

  transport:
    http          request/response, returns rows directly
    object_index  an object store listing; we index keys, not contents

  Every endpoint below was verified live before being written here.
*/

function planetary({
  key, name, capabilities, upstream, adapter = null,
  transport = 'http', sourceClass = SOURCE_CLASSES.PUBLIC_OPEN,
  persistence = PERSISTENCE.PERSISTENT, attribution, cadence, resolution = null
}) {
  return Object.freeze({
    key, name, sourceClass,
    credentialEnv: Object.freeze([]),
    optionalCredentialEnv: Object.freeze([]),
    capabilities: Object.freeze([...capabilities]),
    lane: 'OPEN',
    adapter, transport, persistence, attribution, upstream,
    cadence, resolution
  });
}

export const PLANETARY_SOURCES = Object.freeze([
  // ── Doppler radar ───────────────────────────────────────────────────────
  planetary({
    key: 'nexrad_level2',
    name: 'NEXRAD Level II Doppler radar',
    capabilities: ['radar', 'reflectivity', 'velocity', 'precipitation'],
    upstream: 'https://unidata-nexrad-level2-chunks.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA/NWS NEXRAD via Unidata on AWS Open Data',
    cadence: 'sub-minute chunks, ~160 US radars',
    resolution: '250 m range gates'
  }),
  planetary({
    key: 'mrms',
    name: 'MRMS multi-radar multi-sensor mosaic',
    capabilities: ['radar', 'precipitation', 'hail', 'rotation'],
    upstream: 'https://mrms.ncep.noaa.gov/2D/',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA National Severe Storms Laboratory',
    cadence: '2 minutes, CONUS mosaic',
    resolution: '1 km'
  }),

  // ── Wind and atmosphere ─────────────────────────────────────────────────
  planetary({
    key: 'gfs',
    name: 'GFS global forecast model',
    capabilities: ['wind', 'temperature', 'pressure', 'humidity', 'forecast'],
    upstream: 'https://noaa-gfs-bdp-pds.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA NCEP GFS via AWS Open Data',
    cadence: '4 runs/day, 384 forecast hours',
    resolution: '0.25 deg global'
  }),
  planetary({
    key: 'hrrr',
    name: 'HRRR high-resolution rapid refresh',
    capabilities: ['wind', 'convection', 'nowcast', 'forecast'],
    upstream: 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA NCEP HRRR via AWS Open Data',
    cadence: 'hourly runs, 48 forecast hours',
    resolution: '3 km CONUS'
  }),
  planetary({
    key: 'era5',
    name: 'ERA5 atmospheric reanalysis',
    capabilities: ['wind', 'temperature', 'reanalysis', 'history'],
    upstream: 'https://nsf-ncar-era5.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'ECMWF ERA5 via NSF NCAR on AWS Open Data',
    cadence: 'hourly, 1940 to present',
    resolution: '0.25 deg global'
  }),

  // ── Ocean ───────────────────────────────────────────────────────────────
  planetary({
    key: 'rtofs',
    name: 'RTOFS global ocean currents',
    capabilities: ['currents', 'sea_surface_temperature', 'salinity', 'ocean'],
    upstream: 'https://noaa-nws-rtofs-pds.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA NWS Real-Time Ocean Forecast System via AWS Open Data',
    cadence: 'daily runs, 8-day forecast',
    resolution: '1/12 deg global'
  }),
  planetary({
    key: 'ndbc',
    name: 'NDBC marine buoy network',
    capabilities: ['waves', 'wind', 'currents', 'sea_temperature', 'in_situ'],
    upstream: 'https://www.ndbc.noaa.gov/data/realtime2/',
    adapter: 'ndbc',
    attribution: 'NOAA National Data Buoy Center',
    cadence: '941 stations reporting, sub-hourly'
  }),
  planetary({
    key: 'coops',
    name: 'CO-OPS tides and currents',
    capabilities: ['tides', 'currents', 'water_level', 'in_situ'],
    upstream: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
    adapter: 'coops',
    attribution: 'NOAA CO-OPS',
    cadence: '6 minutes'
  }),

  // ── Lightning, space weather, solid earth, fresh water ──────────────────
  planetary({
    key: 'goes',
    name: 'GOES geostationary imagery and lightning mapper',
    capabilities: ['lightning', 'imagery', 'fire_detection', 'cloud'],
    upstream: 'https://noaa-goes19.s3.amazonaws.com',
    transport: 'object_index',
    persistence: PERSISTENCE.TRANSIENT,
    attribution: 'NOAA GOES via AWS Open Data',
    cadence: '30 seconds full disk, 20 s lightning',
    resolution: '0.5-2 km'
  }),
  planetary({
    key: 'swpc',
    name: 'NOAA Space Weather Prediction Center',
    capabilities: ['geomagnetic', 'solar_wind', 'aurora', 'space_weather'],
    upstream: 'https://services.swpc.noaa.gov/json/',
    adapter: 'swpc',
    attribution: 'NOAA Space Weather Prediction Center',
    cadence: '1 minute'
  }),
  planetary({
    key: 'usgs_water',
    name: 'USGS National Water Information System',
    capabilities: ['river_discharge', 'gauge_height', 'flood', 'in_situ'],
    upstream: 'https://waterservices.usgs.gov/nwis/iv/',
    adapter: 'usgsWater',
    attribution: 'U.S. Geological Survey NWIS',
    cadence: '15 minutes, ~11,000 gauges'
  }),
  planetary({
    key: 'iris_seismic',
    name: 'IRIS global seismic network',
    capabilities: ['seismic', 'stations', 'waveforms', 'in_situ'],
    upstream: 'https://service.iris.edu/fdsnws/',
    adapter: 'irisSeismic',
    attribution: 'IRIS/EarthScope FDSN web services',
    cadence: 'continuous waveform'
  })
]);

/** Sources whose timesteps are indexed rather than ingested. */
export function objectIndexSources() {
  return PLANETARY_SOURCES.filter((s) => s.transport === 'object_index');
}

/** Sources that return rows directly and have an adapter. */
export function directSources() {
  return PLANETARY_SOURCES.filter((s) => s.transport === 'http' && s.adapter);
}

export function planetaryByKey(key) {
  return PLANETARY_SOURCES.find((s) => s.key === key) ?? null;
}
