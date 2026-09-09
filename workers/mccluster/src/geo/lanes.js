import { GeoAdapterError } from './errors.js';
import { CAPABILITIES } from './identity.js';

/*
  Lanes are capability gates, not caller-supplied product names.

  Entitlements evaluate identity.capabilities. A Whip session cannot become
  POLICY by sending {"consumer":"policy"}. A house owner operating Whip is
  still Whip if the authenticated app is a Whip product.
*/

export const LANE_CAPABILITIES = Object.freeze({
  OPEN: Object.freeze([]),
  SCSU_RESEARCH: Object.freeze([CAPABILITIES.RESEARCH]),
  COMMERCIAL: Object.freeze([CAPABILITIES.TRAFFIC, CAPABILITIES.MOBILITY]),
  COMMERCIAL_OR_NONPROFIT: Object.freeze([
    CAPABILITIES.TRAFFIC,
    CAPABILITIES.MOBILITY,
    CAPABILITIES.POLICY,
    CAPABILITIES.VIEWER
  ]),
  VIEWER: Object.freeze([CAPABILITIES.VIEWER]),
  INTERNAL: Object.freeze([CAPABILITIES.INTERNAL])
});

function allowsWhip(required) {
  if (!required.length) return true;
  return required.includes(CAPABILITIES.MOBILITY) || required.includes(CAPABILITIES.TRAFFIC);
}

const LANE_NOTES = Object.freeze({
  OPEN: 'Open public feeds. Any identified app may consume.',
  SCSU_RESEARCH: 'Academic Planet/OpenSky. Requires RESEARCH. Never a commercial Whip session.',
  COMMERCIAL: 'Paid traffic/AIS. Commercial mobility products including Whip may consume where the license allows.',
  COMMERCIAL_OR_NONPROFIT: 'Vendor tiles and geocoding. Commercial mobility or nonprofit/viewer capabilities.',
  VIEWER: 'Cesium/Mapbox viewer tokens stay on the viewer satellite. Not a Whip feed.',
  INTERNAL: 'House geography. Requires INTERNAL. Never a public dump, never a Whip client.'
});

export const LANE_CONTRACT = Object.freeze(
  Object.fromEntries(
    Object.entries(LANE_CAPABILITIES).map(([lane, capabilities]) => [
      lane,
      Object.freeze({
        capabilities,
        whip: allowsWhip(capabilities),
        notes: LANE_NOTES[lane]
      })
    ])
  )
);

function requiredCapabilities(source) {
  if (Array.isArray(source?.requiredCapabilities)) return source.requiredCapabilities;
  return LANE_CAPABILITIES[source?.lane];
}

export function assertLane(source, identity) {
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  if (!identity?.app || !Array.isArray(identity.capabilities)) {
    throw new GeoAdapterError('Spatial app identity is required', 403, 'unidentified_app');
  }
  const required = requiredCapabilities(source);
  if (!required) {
    throw new GeoAdapterError(
      `Source ${source.key} has an unknown lane ${source.lane}`,
      500,
      'unknown_lane',
      { source: source.key, lane: source.lane }
    );
  }
  const allowed = required.length === 0 || required.some((capability) => identity.capabilities.includes(capability));
  if (!allowed) {
    throw new GeoAdapterError(
      `${source.key} lane ${source.lane} forbids app ${identity.app}`,
      403,
      'lane_forbidden',
      {
        source: source.key,
        lane: source.lane,
        app: identity.app,
        app_key: identity.app_key || null,
        class: identity.class,
        capabilities: identity.capabilities,
        required
      }
    );
  }
  return {
    source: source.key,
    lane: source.lane,
    app: identity.app,
    class: identity.class,
    capabilities: identity.capabilities,
    required
  };
}
