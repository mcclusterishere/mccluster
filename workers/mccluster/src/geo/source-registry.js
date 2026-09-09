export const SOURCE_CLASSES = Object.freeze({
  PUBLIC_OPEN: 'PUBLIC_OPEN',
  NONPROFIT: 'NONPROFIT',
  ACADEMIC: 'ACADEMIC',
  COMMERCIAL: 'COMMERCIAL',
  INTERNAL: 'INTERNAL',
  RESTRICTED: 'RESTRICTED'
});

export const PERSISTENCE = Object.freeze({
  PERSISTENT: 'persistent',
  TRANSIENT: 'transient',
  NONE: 'none'
});

function source({
  key,
  name,
  sourceClass = SOURCE_CLASSES.PUBLIC_OPEN,
  credentialEnv = [],
  optionalCredentialEnv = [],
  capabilities = [],
  lane = 'OPEN',
  adapter = null,
  transport = 'http',
  persistence = PERSISTENCE.PERSISTENT,
  attribution = null,
  upstream = null
}) {
  return Object.freeze({
    key,
    name,
    sourceClass,
    credentialEnv: Object.freeze([...credentialEnv]),
    optionalCredentialEnv: Object.freeze([...optionalCredentialEnv]),
    capabilities: Object.freeze([...capabilities]),
    lane,
    adapter,
    transport,
    persistence,
    attribution,
    upstream
  });
}

/*
  Credential VALUES never live in this file. The registry exposes binding names
  and readiness only. Provider terms outrank these bootstrap classifications.

  persistence:
    persistent — normalized observations may be retained in PostGIS.
    transient  — proxy/cache only; the adapter does not archive provider rows.
    none       — credential/readiness surface only; no provider content is stored.

  GEV upstream reference used for provider parity:
  bilawalsidhu/gods-eye-view@759652207fd1279ece97f0f19af566feb9a82146
*/
export const SOURCES = Object.freeze([
  source({ key: 'census', name: 'U.S. Census Data API', credentialEnv: ['CENSUS_API_KEY'], capabilities: ['demographics', 'housing', 'commuting', 'business'], adapter: 'census', upstream: 'https://api.census.gov' }),
  source({ key: 'eia', name: 'U.S. Energy Information Administration', credentialEnv: ['EIA_API_KEY'], capabilities: ['electricity', 'generation', 'demand', 'prices', 'grid-flows'], adapter: 'eia', upstream: 'https://api.eia.gov' }),
  source({ key: 'data_commons', name: 'Data Commons', credentialEnv: ['DATA_COMMONS_API_KEY'], capabilities: ['knowledge-graph', 'statistics', 'place-variables'], adapter: 'data_commons', upstream: 'https://api.datacommons.org' }),
  source({ key: 'bls', name: 'Bureau of Labor Statistics', credentialEnv: ['BLS_API_KEY'], capabilities: ['labor', 'wages', 'employment', 'prices'], adapter: 'bls', upstream: 'https://api.bls.gov' }),
  source({ key: 'fred', name: 'Federal Reserve Economic Data', credentialEnv: ['FRED_API_KEY'], capabilities: ['macroeconomics', 'regional-economics', 'housing', 'finance'], adapter: 'fred', upstream: 'https://api.stlouisfed.org' }),
  source({ key: 'usaspending', name: 'USAspending', capabilities: ['federal-awards', 'contracts', 'grants', 'recipients'], adapter: 'usaspending', upstream: 'https://api.usaspending.gov' }),
  source({ key: 'grants_gov', name: 'Grants.gov', capabilities: ['grant-opportunities', 'agencies'], adapter: 'grants_gov', upstream: 'https://api.grants.gov' }),
  source({ key: 'epa', name: 'U.S. Environmental Protection Agency', capabilities: ['facilities', 'air', 'water', 'tri', 'compliance'], adapter: 'epa', upstream: 'https://data.epa.gov' }),
  source({ key: 'usgs', name: 'U.S. Geological Survey', capabilities: ['earthquakes', 'geology', 'hazards'], adapter: 'usgs', upstream: 'https://earthquake.usgs.gov', attribution: 'Data courtesy of the U.S. Geological Survey' }),
  source({ key: 'open_meteo', name: 'Open-Meteo', capabilities: ['weather', 'forecast', 'historical-weather'], adapter: 'open_meteo', upstream: 'https://api.open-meteo.com', attribution: 'Weather data by Open-Meteo.com' }),
  source({ key: 'nhtsa', name: 'National Highway Traffic Safety Administration', capabilities: ['vehicle-safety', 'recalls', 'complaints', 'crashes'], adapter: 'nhtsa', upstream: 'https://api.nhtsa.gov' }),
  source({ key: 'celestrak', name: 'CelesTrak', capabilities: ['satellite-orbits'], adapter: 'celestrak', upstream: 'https://celestrak.org', attribution: 'CelesTrak (celestrak.org), Dr. T.S. Kelso' }),

  // GEV-native keyless/provider-backed runtime sources.
  source({ key: 'overpass', name: 'OpenStreetMap Overpass', capabilities: ['roads', 'infrastructure', 'military-installations', 'poi'], adapter: 'overpass', upstream: 'https://overpass-api.de/api', attribution: '© OpenStreetMap contributors' }),
  source({ key: 'adsb_lol', name: 'ADSB.lol', capabilities: ['aircraft', 'military-aircraft', 'aircraft-traces'], adapter: 'adsb_lol', upstream: 'https://api.adsb.lol', attribution: 'adsb.lol contributors — ODbL 1.0' }),
  source({ key: 'launch_library2', name: 'Launch Library 2', optionalCredentialEnv: ['LL2_API_TOKEN'], capabilities: ['launches', 'missions', 'pads', 'spaceflight-events'], adapter: 'launch_library2', upstream: 'https://ll.thespacedevs.com', attribution: 'Launch Library 2 — The Space Devs' }),
  source({ key: 'radio_browser', name: 'Radio Browser', capabilities: ['radio-stations', 'station-tags', 'geolocated-audio-directory'], adapter: 'radio_browser', upstream: 'https://all.api.radio-browser.info', attribution: 'Radio Browser' }),
  source({ key: 'reearth_terrain', name: 'Re:Earth Terrain / Mapterhorn', capabilities: ['terrain', 'height'], adapter: 'reearth_terrain', upstream: 'https://tiles.mapterhorn.com', attribution: 'Re:Earth Terrain / Mapterhorn (CC BY 4.0)' }),
  source({ key: 'gbfs', name: 'General Bikeshare Feed Specification', capabilities: ['bikeshare', 'stations', 'vehicle-availability'], adapter: 'gbfs', upstream: 'provider-specific', attribution: 'Per-feed operator attribution required' }),
  source({ key: 'cctv', name: 'Public Traffic Camera Catalogs', capabilities: ['traffic-cameras', 'public-camera-catalog'], adapter: 'cctv', persistence: PERSISTENCE.TRANSIENT, upstream: 'provider-specific', attribution: 'Per-camera provider attribution required' }),
  source({ key: 'nominatim', name: 'OpenStreetMap Nominatim', capabilities: ['reverse-geocoding', 'place-labels'], adapter: 'nominatim', persistence: PERSISTENCE.TRANSIENT, upstream: 'https://nominatim.openstreetmap.org', attribution: '© OpenStreetMap contributors' }),
  source({ key: 'gdelt', name: 'GDELT Project DOC 2.0', capabilities: ['regional-news', 'events', 'headlines'], adapter: 'gdelt', persistence: PERSISTENCE.TRANSIENT, upstream: 'https://api.gdeltproject.org', attribution: 'GDELT Project' }),

  // Authenticated/restricted lanes.
  source({ key: 'nasa_firms', name: 'NASA FIRMS Active Fires', credentialEnv: ['FIRMS_MAP_KEY'], capabilities: ['active-fires', 'thermal-anomalies'], adapter: 'nasa_firms', upstream: 'https://firms.modaps.eosdis.nasa.gov', attribution: 'NASA FIRMS' }),
  source({ key: 'copernicus', name: 'Copernicus Data Space Ecosystem', credentialEnv: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'], capabilities: ['sentinel-imagery', 'stac', 'earth-observation'], adapter: 'copernicus', upstream: 'https://catalogue.dataspace.copernicus.eu' }),
  source({ key: 'planet_research', name: 'Planet Education & Research', sourceClass: SOURCE_CLASSES.ACADEMIC, credentialEnv: ['PLANET_RESEARCH_API_KEY'], capabilities: ['planet-scope', 'change-detection', 'earth-observation'], lane: 'SCSU_RESEARCH', adapter: 'planet', upstream: 'https://api.planet.com' }),
  source({ key: 'opensky_research', name: 'OpenSky Network Research', sourceClass: SOURCE_CLASSES.ACADEMIC, credentialEnv: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'], capabilities: ['aircraft', 'flight-history'], lane: 'SCSU_RESEARCH', adapter: 'opensky', persistence: PERSISTENCE.TRANSIENT, upstream: 'https://opensky-network.org', attribution: 'OpenSky Network' }),
  source({ key: 'tomtom', name: 'TomTom Traffic', sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ['TOMTOM_API_KEY'], capabilities: ['traffic', 'flow-segments', 'flow-tiles', 'routing'], lane: 'COMMERCIAL', adapter: 'tomtom', persistence: PERSISTENCE.TRANSIENT, upstream: 'https://api.tomtom.com', attribution: 'Traffic flow data © TomTom' }),
  source({ key: 'aisstream', name: 'AISStream', sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ['AISSTREAM_API_KEY'], capabilities: ['vessels', 'ais'], lane: 'COMMERCIAL', adapter: 'aisstream', transport: 'websocket', persistence: PERSISTENCE.TRANSIENT, upstream: 'wss://stream.aisstream.io', attribution: 'AISStream.io' }),
  source({ key: 'mapbox', name: 'Mapbox', sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ['MAPBOX_ACCESS_TOKEN'], capabilities: ['maps', 'tiles', 'routing', 'geocoding'], lane: 'COMMERCIAL_OR_NONPROFIT', adapter: 'mapbox', persistence: PERSISTENCE.TRANSIENT, upstream: 'https://api.mapbox.com' }),
  source({ key: 'google_maps', name: 'Google Maps Platform', sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ['GOOGLE_MAPS_API_KEY'], capabilities: ['maps', 'places', 'geocoding', '3d-tiles'], lane: 'COMMERCIAL_OR_NONPROFIT', adapter: 'google_maps', persistence: PERSISTENCE.NONE, upstream: 'https://maps.googleapis.com', attribution: 'Google Maps' }),
  source({ key: 'cesium_ion', name: 'Cesium ion', sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ['CESIUM_ION_TOKEN'], capabilities: ['3d-tiles', 'terrain', 'viewer-assets'], lane: 'VIEWER', adapter: 'cesium_ion', persistence: PERSISTENCE.NONE, upstream: 'https://api.cesium.com', attribution: 'Cesium ion' }),

  // McCluster house INTERNAL. GEV never had these. Lane firewall forbids Whip.
  source({ key: 'house', name: 'McCluster house sites', sourceClass: SOURCE_CLASSES.INTERNAL, capabilities: ['facilities', 'control-plane', 'digital-twin'], lane: 'INTERNAL', adapter: 'house', attribution: 'McCluster house INTERNAL' }),
  source({ key: 'equity_uprise', name: 'Equity Uprise policy nodes', sourceClass: SOURCE_CLASSES.INTERNAL, capabilities: ['policy', 'environmental-justice', 'federal-awards-docket'], lane: 'INTERNAL', adapter: 'house', attribution: 'Equity Uprise / McCluster INTERNAL' }),
  source({ key: 'scsu_docket', name: 'SCSU research docket', sourceClass: SOURCE_CLASSES.INTERNAL, capabilities: ['academic-program', 'research-sites'], lane: 'INTERNAL', adapter: 'house', attribution: 'McCluster / SCSU research program INTERNAL' })
]);

const SOURCE_BY_KEY = new Map(SOURCES.map((item) => [item.key, item]));

export function sourceByKey(key) {
  return SOURCE_BY_KEY.get(String(key || '').trim()) || null;
}

export function sourceConfigured(item, env) {
  return item.credentialEnv.every((key) => Boolean(env?.[key]));
}

export function sourceCatalog(env) {
  return SOURCES.map((item) => ({
    key: item.key,
    name: item.name,
    source_class: item.sourceClass,
    lane: item.lane,
    capabilities: item.capabilities,
    transport: item.transport,
    persistence: item.persistence,
    attribution: item.attribution,
    credential_required: item.credentialEnv.length > 0,
    credential_bindings: item.credentialEnv,
    optional_credential_bindings: item.optionalCredentialEnv,
    configured: sourceConfigured(item, env)
  }));
}
