/* Reviewed public research only. No fetch, credentials, database, enrollment or order
 * methods. This is not the private Computershare review/eligibility engine. */
import REFERENCE from '../../../../data/markets/direct-ownership-routes.json' with { type: 'json' };
import SEC_DIRECTORY from '../../../../data/markets/sec-listing-directory.json' with { type: 'json' };
import { validateUniverseReference } from './universe.js';

const DAY = 86400000;
export const OWNERSHIP_REFERENCE_REVIEW_DAYS = 30;
const ENUMS = Object.freeze({
  newInvestorAccess: ['yes', 'no', 'unverified'],
  usResidentEligibility: ['yes_explicit', 'yes_general_public', 'unverified', 'no'],
  registrationModel: ['plan_nominee_with_drs_exit', 'plan_book_entry_details_unverified', 'registered_plan_shares', 'pure_registered', 'registered_adr'],
  evidenceStatus: ['verified_primary', 'current_offer_older_terms', 'partial_primary'],
  entryPath: ['direct_purchase_plan', 'existing_holder_drip_optional_cash', 'pure_registered_account'],
  planSponsorType: ['issuer', 'transfer_agent', 'transfer_agent_affiliate', 'depositary'],
});
// Exact reviewed publishers, not arbitrary tenants or arbitrary subdomains.
const SOURCE_HOSTS = new Set([
  'action.airliquide.com', 'continentalstock.com', 'dsppwizard.broadridge.com',
  'equiniti.com', 'invest.shareview.co.uk', 'investors.dominionenergy.com',
  'investors.renasant.com', 'jpmorganchaseco.gcs-web.com', 'nbbancorp.com',
  'services.tsxtrust.com', 'shareholder.broadridge.com', 'shareview.co.uk',
  'totalenergies.com', 'tsxtrust.com', 'www.airliquide.com', 'www.asx.com.au',
  'www.investor.gov', 'www.jpx.co.jp', 'www.manulife.com', 'www.merck.com',
  'www.mpms.mufg.com', 'www.nichicon.co.jp', 'www.pginvestor.com', 'www.sec.gov',
  'www.shareowneronline.com', 'www.sony.com', 'www.tsxtrust.com',
]);
// SEC exchange labels are not MICs. Only these exact mappings are reviewed here.
const MIC_EXCHANGES = Object.freeze({ XNYS: 'NYSE', XNAS: 'Nasdaq' });
const LIMITATIONS = Object.freeze([
  'Reviewed public research, not a complete provider, sector or exchange inventory, ranking or investment recommendation.',
  'No actual ownership or individual eligibility is asserted. New-investor access and U.S.-resident source wording are separate from investor-specific acceptance.',
  'General-public wording does not establish U.S.-specific acceptance. Identity, residence, tax, banking and plan conditions require current review before any action.',
  'Null means unknown, not zero, free, eligible or unavailable. Monetary minimums and whole-share requirements use different units.',
  'Plan nominee holdings, registered plan balances, pure registered ordinary shares and registered ADRs are distinct. An ADR does not directly register its underlying foreign ordinary shares.',
  'Fresh retrieval does not renew older or undated terms. Evidence and registration descriptions become review-due after 30 days; no automated refresh occurs.',
  'SEC ticker/exchange associations are a dated identity snapshot, not a live listing, share-class, purchase-plan or trade-eligibility check. CIK-missing routes never join by ticker alone.',
  'Provider directory entries and market-system notes are not purchasable issuer routes. No market-wide direct-purchase coverage or provider specialization is inferred.',
]);
const fail = code => { throw Object.assign(new Error(code), { code, status: 400 }); };
const plain = x => x !== null && typeof x === 'object'
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const text = (x, max = 2000) => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f<>]/.test(x);
const nullableText = (x, max) => x === null || text(x, max);
const finiteAmount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER;
const matches = (x, re) => typeof x === 'string' && re.test(x);

function fields(value, required, optional = []) {
  if (!plain(value)) fail('invalid_ownership_reference');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key)
      || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)
      || required.some(key => !Object.hasOwn(descriptors, key))) fail('invalid_ownership_reference');
}
function list(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max
      || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false;
  }
  return true;
}
function date(value) {
  if (!matches(value, /^\d{4}-\d{2}-\d{2}$/)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function sourceUrl(value) {
  if (!text(value, 2048) || /[\\\s]|%(?:0[0-9a-f]|1[0-9a-f]|7f|3c|3e|5c)/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && SOURCE_HOSTS.has(url.hostname) && value.startsWith('https://' + url.hostname + '/');
  } catch { return false; }
}
function strings(value, max = 30, length = 2000, min = 0) {
  return list(value, max, min) && value.every(item => text(item, length));
}
function validateSource(source, reviewedAt) {
  fields(source, ['url', 'title', 'documentDate', 'verifiedAt']);
  if (!sourceUrl(source.url) || !text(source.title, 500) || !date(source.verifiedAt)
      || source.verifiedAt > reviewedAt || source.documentDate !== null
      && (!date(source.documentDate) || source.documentDate > source.verifiedAt)) fail('invalid_ownership_source');
}
function validateSources(sources, reviewedAt) {
  if (!list(sources, 20, 1)) fail('invalid_ownership_source');
  const urls = new Set();
  for (const source of sources) {
    validateSource(source, reviewedAt);
    if (urls.has(source.url)) fail('invalid_ownership_source');
    urls.add(source.url);
  }
}
function validateMinimum(minimum) {
  if (minimum === null) return;
  fields(minimum, ['amount', 'currency', 'note', 'unit']);
  if (!finiteAmount(minimum.amount) || !nullableText(minimum.note)) fail('invalid_ownership_minimum');
  if (minimum.unit === 'currency') {
    if (!matches(minimum.currency, /^[A-Z]{3}$/)) fail('invalid_ownership_minimum');
  } else if (!['existing_whole_share', 'whole_share'].includes(minimum.unit)
      || minimum.currency !== null || !Number.isSafeInteger(minimum.amount) || minimum.amount < 1) fail('invalid_ownership_minimum');
}

export function validateOwnershipReference(doc) {
  fields(doc, ['schemaVersion', 'verifiedAt', 'researchScope', 'enums', 'interpretation', 'routes', 'providerDirectory', 'marketNotes', 'staleClaimsToAvoid']);
  if (doc.schemaVersion !== 1 || !date(doc.verifiedAt) || !text(doc.researchScope)
      || !strings(doc.interpretation, 30, 2000, 1) || !list(doc.routes, 500, 1)
      || !list(doc.providerDirectory, 100) || !list(doc.marketNotes, 100)
      || !list(doc.staleClaimsToAvoid, 100)) fail('invalid_ownership_reference');
  fields(doc.enums, Object.keys(ENUMS));
  for (const [key, values] of Object.entries(ENUMS)) {
    if (!list(doc.enums[key], values.length, values.length)
        || doc.enums[key].some((value, index) => value !== values[index])) fail('invalid_ownership_enum');
  }
  const ids = new Set();
  for (const route of doc.routes) {
    fields(route, ['id', 'issuerName', 'ticker', 'domicile', 'issuerIdentity', 'provider', 'providerRole', 'securityType', 'entryPath', 'planSponsorType', 'newInvestorAccess', 'usResidentEligibility', 'registrationModel', 'initialMinimum', 'optionalMinimum', 'fees', 'evidenceStatus', 'sources', 'caveats']);
    if (!matches(route.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/) || route.id.length > 150 || ids.has(route.id)
        || !text(route.issuerName, 250) || !matches(route.ticker, /^[A-Z][A-Z0-9.\-]{0,19}$/)
        || !matches(route.domicile, /^[A-Z]{2}$/) || !text(route.provider, 250)
        || !['transfer_agent_plan_administrator', 'issuer_shareholder_services', 'registrar_account_administrator', 'adr_plan_administrator'].includes(route.providerRole)
        || !['ordinary_common', 'adr'].includes(route.securityType) || !strings(route.caveats)) fail('invalid_ownership_route');
    ids.add(route.id);
    for (const [key, values] of Object.entries(ENUMS)) if (!values.includes(route[key])) fail('invalid_ownership_route');
    fields(route.issuerIdentity, ['cik', 'homeListing'], ['isin']);
    if (route.issuerIdentity.cik !== null && !matches(route.issuerIdentity.cik, /^\d{10}$/)
        || !text(route.issuerIdentity.homeListing, 500)
        || route.issuerIdentity.isin !== undefined && !matches(route.issuerIdentity.isin, /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/)) fail('invalid_ownership_identity');
    validateMinimum(route.initialMinimum);
    validateMinimum(route.optionalMinimum);
    fields(route.fees, ['enrollment', 'purchase', 'drip', 'sale', 'note']);
    // Source fee descriptions are not an executable pricing schedule. Numeric
    // enrollment amounts retain the source's currency context in fees.note.
    if (route.fees.enrollment !== null && !finiteAmount(route.fees.enrollment)
        || !['purchase', 'drip', 'sale'].every(key => nullableText(route.fees[key]))
        || !text(route.fees.note)) fail('invalid_ownership_fees');
    validateSources(route.sources, doc.verifiedAt);
    if ((route.securityType === 'adr') !== (route.registrationModel === 'registered_adr')
        || route.registrationModel === 'registered_adr' && route.providerRole !== 'adr_plan_administrator'
        || route.entryPath === 'existing_holder_drip_optional_cash' && (route.newInvestorAccess !== 'no'
          || route.initialMinimum?.unit !== 'existing_whole_share')
        || route.initialMinimum?.unit === 'existing_whole_share' && route.newInvestorAccess !== 'no'
        || (route.registrationModel === 'pure_registered') !== (route.entryPath === 'pure_registered_account')) fail('invalid_ownership_route_semantics');
  }
  const providers = new Set();
  for (const provider of doc.providerDirectory) {
    fields(provider, ['name', 'market', 'role', 'url', 'note', 'sources']);
    if (!text(provider.name, 250) || providers.has(provider.name) || !text(provider.market, 250)
        || !text(provider.role, 500) || !sourceUrl(provider.url) || !text(provider.note)) fail('invalid_ownership_provider');
    providers.add(provider.name);
    validateSources(provider.sources, doc.verifiedAt);
  }
  const markets = new Set();
  for (const note of doc.marketNotes) {
    fields(note, ['market', 'finding', 'details', 'sources']);
    if (!text(note.market, 250) || markets.has(note.market) || !text(note.finding)
        || !strings(note.details, 30, 2000, 1)) fail('invalid_ownership_market_note');
    markets.add(note.market);
    validateSources(note.sources, doc.verifiedAt);
  }
  for (const claim of doc.staleClaimsToAvoid) {
    fields(claim, ['claim', 'correction', 'source']);
    if (!text(claim.claim) || !text(claim.correction)) fail('invalid_ownership_claim');
    validateSource(claim.source, doc.verifiedAt);
  }
  return doc;
}

function freshness(sources, now, evidenceStatus = null) {
  const observed = sources.map(source => source.verifiedAt).sort()[0];
  const observedMs = Date.parse(observed + 'T00:00:00Z');
  const future = sources.some(source => Date.parse(source.verifiedAt + 'T00:00:00Z') > now);
  const expires = observedMs + OWNERSHIP_REFERENCE_REVIEW_DAYS * DAY;
  const dated = sources.filter(source => source.documentDate !== null).map(source => source.documentDate).sort();
  const older = evidenceStatus === 'current_offer_older_terms'
    || dated.some(value => now - Date.parse(value + 'T00:00:00Z') >= 365 * DAY);
  return {
    state: future ? 'future_observation' : now >= expires ? 'review_due' : 'recently_observed',
    observed_at: observed, review_due_at: new Date(expires).toISOString().slice(0, 10),
    age_days: future ? null : Math.floor((now - observedMs) / DAY),
    is_live: false, document_dates: dated,
    document_state: older ? 'older_terms_require_review' : !dated.length ? 'undated_documents'
      : dated.length < sources.length ? 'includes_undated_documents' : 'dated_documents',
    current_terms_verified: false,
  };
}
function routeView(route, now) {
  const evidenceFreshness = freshness(route.sources, now, route.evidenceStatus);
  return {
    ...structuredClone(route),
    issuer_id: route.issuerIdentity.cik === null ? null : 'sec:' + route.issuerIdentity.cik,
    identity_status: route.issuerIdentity.cik === null ? 'unresolved_for_sec_join' : 'reviewed_cik',
    evidenceFreshness,
    registrationEvidence: {
      model: route.registrationModel,
      status: evidenceFreshness.state === 'recently_observed'
        ? route.registrationModel === 'plan_book_entry_details_unverified' ? 'details_unverified' : 'source_description_observed'
        : evidenceFreshness.state,
      review_due_at: evidenceFreshness.review_due_at,
      current_registration_verified: false,
    },
    userEligibility: 'not_assessed',
  };
}

export function ownershipOptionsView({ issuer_id = null, symbol = null, mic = null, now = Date.now(), reference = REFERENCE, directory = SEC_DIRECTORY } = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())
      || issuer_id !== null && !matches(issuer_id, /^sec:\d{10}$/)
      || symbol !== null && !matches(symbol, /^[A-Z][A-Z0-9.\-]{0,19}$/)
      || mic !== null && !matches(mic, /^[A-Z0-9]{4}$/)
      || (symbol === null) !== (mic === null) || issuer_id !== null && symbol !== null) fail('invalid_ownership_query');
  const doc = validateOwnershipReference(reference);
  let routes = doc.routes, status = 'available', reason = null, matching_basis = 'catalog_no_identity_join';
  let resolvedIssuer = issuer_id, directorySnapshot = null;
  if (symbol !== null) {
    const checked = validateUniverseReference(directory);
    directorySnapshot = { retrieved_at: checked.retrieved_at, source_url: checked.source.url, sha256: checked.source.sha256 };
    matching_basis = 'sec_snapshot_symbol_and_mic';
    const exchange = Object.hasOwn(MIC_EXCHANGES, mic) ? MIC_EXCHANGES[mic] : null;
    const candidates = exchange === null ? [] : checked.listings.filter(row => row.ticker === symbol && row.exchange === exchange);
    const ciks = new Set(candidates.map(row => row.cik));
    if (ciks.size !== 1) {
      status = 'identity_unresolved';
      reason = exchange === null ? 'This MIC has no reviewed SEC exchange mapping.'
        : 'The dated SEC directory does not resolve this symbol and MIC to one issuer.';
      routes = [];
    } else {
      resolvedIssuer = 'sec:' + [...ciks][0];
      // CIK AND symbol must match. Do not transfer common-share terms to another
      // same-issuer ticker, or attach a null-CIK foreign route by ticker alone.
      routes = routes.filter(route => route.issuerIdentity.cik !== null
        && 'sec:' + route.issuerIdentity.cik === resolvedIssuer && route.ticker === symbol);
    }
  } else if (issuer_id !== null) {
    matching_basis = 'explicit_reviewed_cik';
    routes = routes.filter(route => route.issuerIdentity.cik !== null && 'sec:' + route.issuerIdentity.cik === issuer_id);
  }
  if (status === 'available' && routes.length === 0) {
    status = 'not_covered';
    reason = 'No reviewed route matches this issuer identity. A ticker-only candidate is not joined; current plan and identity review are needed.';
  }
  return {
    schema: 'finance-direct-ownership-options/v1', status, reason, needs_review: status !== 'available',
    generated_at: new Date(now).toISOString(), reference_date: doc.verifiedAt,
    kind: 'reviewed_public_reference', is_live: false, automatic_collection: false,
    ownership: 'not_asserted', userEligibility: 'not_assessed',
    matching_basis, issuer_id: resolvedIssuer, symbol, mic, identity_snapshot: directorySnapshot,
    counts: { sample_routes: doc.routes.length, provider_entries: doc.providerDirectory.length,
      market_notes: doc.marketNotes.length, returned_routes: routes.length },
    researchScope: doc.researchScope, limitations: [...LIMITATIONS], interpretation: [...doc.interpretation],
    routes: routes.map(route => routeView(route, now)),
    providerDirectory: doc.providerDirectory.map(provider => ({ ...structuredClone(provider), evidenceFreshness: freshness(provider.sources, now) })),
    marketNotes: doc.marketNotes.map(note => ({ ...structuredClone(note), evidenceFreshness: freshness(note.sources, now) })),
    staleClaimsToAvoid: doc.staleClaimsToAvoid.map(claim => ({ ...structuredClone(claim), evidenceFreshness: freshness([claim.source], now) })),
  };
}
