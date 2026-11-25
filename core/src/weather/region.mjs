/* THE CONNECTICUT PILOT WEATHER REGION: what Core fetches, once per region.

   One snapshot job fetches each feed below ONCE and writes one small normalized
   snapshot. Readers (the Worker route, the owner's desk, later the city and the
   globe) read the snapshot; the number of players never multiplies an upstream
   call. Station, grid, zone and gauge come from the read-only probes recorded
   in docs/fictional-city/PLANET-CONNECTICUT.md ("Phase C prep").

   The grid is the statewide bounding box of core/data/fictional-city/regions/
   connecticut-pilot.v1.json (bounds.statewide), rounded outward to 0.02 deg.
   Physical weather resolution stays independent of the building mesh. */

export const SNAPSHOT_SCHEMA = 'mccluster.weather.snapshot.v1';
export const FIELD_SCHEMA = 'mccluster.weather.field.v1';
export const REGION_ID = 'connecticut-pilot';

/* Generic and identifying, as NWS asks; never a person's address. */
export const USER_AGENT = 'mccluster-weather-desk/0.1 (+https://github.com/mcclusterishere/mccluster)';

export const GRID = Object.freeze({
  crs: 'EPSG:4326',
  west: -73.76, south: 40.96, east: -71.76, north: 42.08,
  dlon: 0.02, dlat: 0.02, nx: 100, ny: 56,
  order: 'row-major, north row first, west to east; a cell value is sampled at the cell centre',
});

export const REGION = Object.freeze({
  id: REGION_ID,
  name: 'Connecticut pilot',
  descriptor: 'core/data/fictional-city/regions/connecticut-pilot.v1.json',
  focus: Object.freeze({ name: 'Bridgeport harbour', lat: 41.172, lon: -73.1885 }),
  grid: GRID,
  feeds: Object.freeze({
    observation: Object.freeze({
      source_id: 'nws', product: 'station-observation', station: 'KBDR', station_name: 'Bridgeport, Sikorsky Memorial Airport',
      url: 'https://api.weather.gov/stations/KBDR/observations/latest',
      expected_cadence_s: 3600, stale_after_s: 5400, attribution: 'NOAA/National Weather Service',
    }),
    forecast_hourly: Object.freeze({
      source_id: 'nws', product: 'gridpoint-forecast-hourly', office: 'OKX', grid_x: 58, grid_y: 67,
      url: 'https://api.weather.gov/gridpoints/OKX/58,67/forecast/hourly',
      periods: 24, expected_cadence_s: 3600, stale_after_s: 4 * 3600, attribution: 'NOAA/National Weather Service',
    }),
    alerts: Object.freeze({
      source_id: 'nws', product: 'active-alerts', zone: 'CTZ009', zone_name: 'Southern Fairfield',
      url: 'https://api.weather.gov/alerts/active?zone=CTZ009',
      expected_cadence_s: 300, stale_after_s: 900, attribution: 'NOAA/National Weather Service',
    }),
    water_level: Object.freeze({
      source_id: 'noaa-coops', product: 'water_level', station: '8467150', station_name: 'Bridgeport, CT',
      lat: 41.17582, lon: -73.18397, datum: 'NAVD', vertical_datum: 'NAVD88',
      url: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=8467150&datum=NAVD&units=metric&time_zone=gmt&date=latest&format=json&application=mccluster-weather-desk',
      expected_cadence_s: 360, stale_after_s: 1800, attribution: 'NOAA/NOS/CO-OPS',
    }),
    tide_predictions: Object.freeze({
      source_id: 'noaa-coops', product: 'predictions-hilo', station: '8467150', station_name: 'Bridgeport, CT',
      lat: 41.17582, lon: -73.18397, datum: 'NAVD', vertical_datum: 'NAVD88',
      // begin_date and range are filled per run (from yesterday, 72 h) so the current tide sits between two events
      url: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=8467150&datum=NAVD&units=metric&time_zone=gmt&interval=hilo&format=json&application=mccluster-weather-desk',
      expected_cadence_s: 86400, stale_after_s: 2 * 86400, attribution: 'NOAA/NOS/CO-OPS',
    }),
    rain_now: Object.freeze({
      source_id: 'noaa-mrms', product: 'PrecipRate_00.00', bucket: 'noaa-mrms-pds', prefix: 'CONUS/PrecipRate_00.00/',
      expected_cadence_s: 120, stale_after_s: 900, attribution: 'NOAA/NSSL MRMS (noaa-mrms-pds, NOAA Open Data Dissemination)',
    }),
    radar_reflectivity: Object.freeze({
      source_id: 'nexrad-level3', product: 'N0B', radar: 'KOKX', site: 'OKX', bucket: 'unidata-nexrad-level3',
      expected_cadence_s: 360, stale_after_s: 1200, attribution: 'NOAA/NWS NEXRAD Level III via Unidata (unidata-nexrad-level3)',
    }),
    radar_velocity: Object.freeze({
      source_id: 'nexrad-level3', product: 'N0G', radar: 'KOKX', site: 'OKX', bucket: 'unidata-nexrad-level3',
      expected_cadence_s: 360, stale_after_s: 1200, attribution: 'NOAA/NWS NEXRAD Level III via Unidata (unidata-nexrad-level3)',
    }),
  }),
});

export const FEED_KEYS = Object.freeze(Object.keys(REGION.feeds));
