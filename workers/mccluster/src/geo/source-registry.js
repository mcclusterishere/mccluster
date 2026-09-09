export const SOURCE_CLASSES = Object.freeze({
  PUBLIC_OPEN: 'PUBLIC_OPEN',
  NONPROFIT: 'NONPROFIT',
  ACADEMIC: 'ACADEMIC',
  COMMERCIAL: 'COMMERCIAL',
  INTERNAL: 'INTERNAL',
  RESTRICTED: 'RESTRICTED'
});

/*
  Credentials are named here, never stored here. The Worker only reports whether
  every required binding is present; it never returns the credential value.

  The entitlement fields are intentionally conservative. A provider's actual
  contract/terms stored in the data plane outrank these bootstrap hints.
*/
export const SOURCES = Object.freeze([
  {
    key: 'census',
    name: 'U.S. Census Data API',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['CENSUS_API_KEY'],
    capabilities: ['demographics', 'housing', 'commuting', 'business'],
    lane: 'OPEN'
  },
  {
    key: 'eia',
    name: 'U.S. Energy Information Administration',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['EIA_API_KEY'],
    capabilities: ['electricity', 'generation', 'demand', 'prices', 'grid-flows'],
    lane: 'OPEN'
  },
  {
    key: 'data_commons',
    name: 'Data Commons',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['DATA_COMMONS_API_KEY'],
    capabilities: ['knowledge-graph', 'statistics', 'place-variables'],
    lane: 'OPEN'
  },
  {
    key: 'bls',
    name: 'Bureau of Labor Statistics',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['BLS_API_KEY'],
    capabilities: ['labor', 'wages', 'employment', 'prices'],
    lane: 'OPEN'
  },
  {
    key: 'fred',
    name: 'Federal Reserve Economic Data',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['FRED_API_KEY'],
    capabilities: ['macroeconomics', 'regional-economics', 'housing', 'finance'],
    lane: 'OPEN'
  },
  {
    key: 'usaspending',
    name: 'USAspending',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['federal-awards', 'contracts', 'grants', 'recipients'],
    lane: 'OPEN'
  },
  {
    key: 'grants_gov',
    name: 'Grants.gov',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['grant-opportunities', 'agencies'],
    lane: 'OPEN'
  },
  {
    key: 'epa',
    name: 'U.S. Environmental Protection Agency',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['facilities', 'air', 'water', 'tri', 'compliance'],
    lane: 'OPEN'
  },
  {
    key: 'usgs',
    name: 'U.S. Geological Survey',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['earthquakes', 'geology', 'hazards'],
    lane: 'OPEN'
  },
  {
    key: 'open_meteo',
    name: 'Open-Meteo',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['weather', 'forecast', 'historical-weather'],
    lane: 'OPEN'
  },
  {
    key: 'nhtsa',
    name: 'National Highway Traffic Safety Administration',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['vehicle-safety', 'recalls', 'complaints', 'crashes'],
    lane: 'OPEN'
  },
  {
    key: 'celestrak',
    name: 'CelesTrak',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: [],
    capabilities: ['satellite-orbits'],
    lane: 'OPEN'
  },
  {
    key: 'copernicus',
    name: 'Copernicus Data Space Ecosystem',
    sourceClass: SOURCE_CLASSES.PUBLIC_OPEN,
    credentialEnv: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
    capabilities: ['sentinel-imagery', 'stac', 'earth-observation'],
    lane: 'OPEN'
  },
  {
    key: 'planet_research',
    name: 'Planet Education & Research',
    sourceClass: SOURCE_CLASSES.ACADEMIC,
    credentialEnv: ['PLANET_RESEARCH_API_KEY'],
    capabilities: ['planet-scope', 'change-detection', 'earth-observation'],
    lane: 'SCSU_RESEARCH'
  },
  {
    key: 'opensky_research',
    name: 'OpenSky Network Research',
    sourceClass: SOURCE_CLASSES.ACADEMIC,
    credentialEnv: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    capabilities: ['aircraft', 'flight-history'],
    lane: 'SCSU_RESEARCH'
  },
  {
    key: 'tomtom',
    name: 'TomTom',
    sourceClass: SOURCE_CLASSES.COMMERCIAL,
    credentialEnv: ['TOMTOM_API_KEY'],
    capabilities: ['traffic', 'routing', 'geocoding'],
    lane: 'COMMERCIAL'
  },
  {
    key: 'aisstream',
    name: 'AISStream',
    sourceClass: SOURCE_CLASSES.COMMERCIAL,
    credentialEnv: ['AISSTREAM_API_KEY'],
    capabilities: ['vessels', 'ais'],
    lane: 'COMMERCIAL'
  },
  {
    key: 'mapbox',
    name: 'Mapbox',
    sourceClass: SOURCE_CLASSES.COMMERCIAL,
    credentialEnv: ['MAPBOX_ACCESS_TOKEN'],
    capabilities: ['maps', 'tiles', 'routing', 'geocoding'],
    lane: 'COMMERCIAL_OR_NONPROFIT'
  },
  {
    key: 'google_maps',
    name: 'Google Maps Platform',
    sourceClass: SOURCE_CLASSES.NONPROFIT,
    credentialEnv: ['GOOGLE_MAPS_API_KEY'],
    capabilities: ['maps', 'places', 'geocoding', '3d-tiles'],
    lane: 'MCCLUSTER_NONPROFIT'
  },
  {
    key: 'cesium_ion',
    name: 'Cesium ion',
    sourceClass: SOURCE_CLASSES.COMMERCIAL,
    credentialEnv: ['CESIUM_ION_TOKEN'],
    capabilities: ['3d-tiles', 'terrain', 'viewer-assets'],
    lane: 'VIEWER'
  }
]);

export function sourceConfigured(source, env) {
  return source.credentialEnv.every((key) => Boolean(env[key]));
}

export function sourceCatalog(env) {
  return SOURCES.map((source) => ({
    key: source.key,
    name: source.name,
    source_class: source.sourceClass,
    lane: source.lane,
    capabilities: source.capabilities,
    credential_required: source.credentialEnv.length > 0,
    credential_bindings: source.credentialEnv,
    configured: sourceConfigured(source, env)
  }));
}
