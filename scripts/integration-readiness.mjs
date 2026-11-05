#!/usr/bin/env node
// Local, read-only preflight. Never sends requests, reads secret files or prints values.
import { pathToFileURL } from 'node:url';
import { SOURCES, sourceConfigured } from '../workers/mccluster/src/seek-first/source-registry.js';
import { adapterCapabilities } from '../workers/mccluster/src/seek-first/adapters.js';
import { marketsProvider } from '../workers/mccluster/src/intel/world-markets.js';
import { routingProvider } from '../workers/mccluster/src/travel-routing-provider.js';
import { globeRelease } from '../packages/release-policy/globe.mjs';

const present = value => typeof value === 'string' && value.trim().length > 0;
const cleanEnv = env => Object.fromEntries(Object.entries(env).filter(([, v]) => present(v)));

export function integrationReadiness(input = {}) {
  const env = cleanEnv(input);
  const capabilities = adapterCapabilities();
  const declared = new Set(Object.values(capabilities).flat());
  const sources = SOURCES.map(source => {
    const configured = sourceConfigured(source, env);
    const kind = capabilities.config_only.includes(source.key) ? 'configuration_only'
      : source.transport === 'websocket' ? 'websocket_gateway'
      : ['epa', 'data_commons'].includes(source.key) ? 'verified_gateway'
      : declared.has(source.key) ? 'http_adapter' : 'unclassified';
    return {
      id: source.key, name: source.name, adapter_kind: kind,
      configuration: !configured ? 'needs_credentials' : source.credentialEnv.length ? 'credentials_present_unverified' : 'no_required_key',
      missing_bindings: configured ? [] : source.credentialEnv.filter(key => !present(env[key])),
      credential_bindings: [...source.credentialEnv], optional_bindings: [...source.optionalCredentialEnv],
      lane: source.lane, persistence: source.persistence,
      runtime: 'not_checked', authorization_and_terms: 'requires_separate_verification',
    };
  });
  const market = marketsProvider(env);
  const routing = routingProvider(env);
  return {
    schema: 'mccluster.integration-readiness/v1',
    scope: 'local_environment_only', network_requests: 0, live_verified: false,
    instructions: 'This checks local bindings only. It does not inspect deployed secrets, grants, schemas, provider entitlement or runtime health. Do not upload this report as proof of live service.',
    markets: {
      provider: market.spec ? market.spec.id : null,
      configuration: market.state === 'ready' ? 'credentials_present_unverified' : market.state,
      missing_bindings: market.spec && market.state === 'needs_key' ? [market.spec.secret] : [],
      runtime: 'not_checked', owner_access: 'required',
    },
    travel: {
      provider: routing,
      configuration: routing ? 'configured_unverified' : 'not_connected',
      missing_bindings: env.TRAVEL_ROUTING_PROVIDER === 'tomtom' && !present(env.TRAVEL_TOMTOM_API_KEY) ? ['TRAVEL_TOMTOM_API_KEY'] : [],
      runtime: 'not_checked', prerequisites: ['Existing routing quota binding', 'Provider terms and capacity review'],
    },
    weather: {
      required_keys: [], ingest_requested: env.WEATHER_INGEST_ENABLED === 'true',
      release: globeRelease('weather', env), runtime: 'not_checked',
      prerequisites: ['Core promotion', 'Weather timer activation', 'bzip2 decoder', 'Fresh snapshot', 'House-owner session'],
    },
    sources,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--empty', '--help'].includes(arg))) {
    console.error('Usage: node scripts/integration-readiness.mjs [--empty]');
    process.exitCode = 2;
  } else if (args.includes('--help')) {
    console.log('Read-only local binding check; --empty rehearses the unconnected state. No network, secret-file reads, activation or live-status claims. Output contains binding names, never values.');
  } else {
    console.log(JSON.stringify(integrationReadiness(args.includes('--empty') ? {} : process.env), null, 2));
  }
}
