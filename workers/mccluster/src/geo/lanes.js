import { GeoAdapterError } from './errors.js';

/*
  Lanes are not labels. ChatGPT's registry wrote them. This module is the
  firewall that actually throws.

  A commercial satellite such as Whip must never receive SCSU_RESEARCH or
  INTERNAL house/policy rows merely because the same person owns both.
*/

export const CONSUMERS = Object.freeze(['house', 'policy', 'mobility', 'viewer', 'whip']);

export const LANE_ALLOW = Object.freeze({
  OPEN: Object.freeze(['house', 'policy', 'mobility', 'viewer', 'whip']),
  SCSU_RESEARCH: Object.freeze(['house', 'policy']),
  COMMERCIAL: Object.freeze(['house', 'mobility', 'viewer']),
  COMMERCIAL_OR_NONPROFIT: Object.freeze(['house', 'policy', 'mobility', 'viewer']),
  VIEWER: Object.freeze(['house', 'viewer']),
  INTERNAL: Object.freeze(['house', 'policy'])
});

export const LANE_CONTRACT = Object.freeze(
  Object.fromEntries(
    Object.entries(LANE_ALLOW).map(([lane, consumers]) => [
      lane,
      Object.freeze({
        consumers,
        whip: consumers.includes('whip'),
        notes: lane === 'SCSU_RESEARCH'
          ? 'Academic Planet/OpenSky. Never Whip. Never a commercial satellite.'
          : lane === 'INTERNAL'
            ? 'House and Equity Uprise geography. Never Whip. Never a public viewer dump.'
            : lane === 'VIEWER'
              ? 'Cesium/Mapbox tokens stay on the viewer satellite. Not a Whip feed.'
              : lane === 'COMMERCIAL'
                ? 'Paid traffic/AIS. House and mobility only. Not a policy-research dump.'
                : 'Open public feeds. Any satellite may consume.'
      })
    ])
  )
);

export function normalizeConsumer(value) {
  const consumer = String(value || 'house').trim().toLowerCase();
  if (!CONSUMERS.includes(consumer)) {
    throw new GeoAdapterError(
      'consumer must be house, policy, mobility, viewer, or whip',
      400,
      'invalid_consumer',
      { consumer, allowed: CONSUMERS }
    );
  }
  return consumer;
}

export function assertLane(source, consumer) {
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  const allowed = LANE_ALLOW[source.lane];
  if (!allowed) {
    throw new GeoAdapterError(
      `Source ${source.key} has an unknown lane ${source.lane}`,
      500,
      'unknown_lane',
      { source: source.key, lane: source.lane }
    );
  }
  if (!allowed.includes(consumer)) {
    throw new GeoAdapterError(
      `${source.key} lane ${source.lane} forbids consumer ${consumer}`,
      403,
      'lane_forbidden',
      { source: source.key, lane: source.lane, consumer, allowed }
    );
  }
  return { source: source.key, lane: source.lane, consumer, allowed };
}
