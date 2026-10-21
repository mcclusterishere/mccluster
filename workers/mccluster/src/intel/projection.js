/* Versioned, descriptive projection of existing Intel records. It confers no
   access or human review authority and never promotes derived coordinates. */
export const TRUTH_KINDS = Object.freeze(['unknown', 'observation', 'published_report', 'forecast', 'reference', 'aggregate', 'inference', 'fiction']);

export function evidenceProjection(record, { orgId, sourceId = null, truthKind = 'unknown', sourceRevision = null,
  publishedAt = null, discoveredAt = null, forecastIssuedAt = null, forecastValidFrom = null,
  forecastValidUntil = null, derivedGeometry = null, coverage = null, sourceHealth = null, values = null } = {}) {
  if (!TRUTH_KINDS.includes(truthKind)) throw new TypeError('Unknown truth kind');
  const lat=record.lat, lon=record.lon;
  const supplied=Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 && !(lat===0 && lon===0);
  if (supplied && record.geo_source !== 'source_published') throw new TypeError('Canonical observation geometry must be source-published');
  if (derivedGeometry && (!derivedGeometry.method || !('uncertainty' in derivedGeometry))) {
    throw new TypeError('Derived geometry requires its method and explicit uncertainty (null if unknown)');
  }
  return {
    schema:'mccluster-intel-projection/v1',
    org_id:orgId ?? record.org_id ?? null, source_id:sourceId,
    record_id:record.id ?? null, source_record_id:record.source_record_id ?? null,
    event_id:record.external_id ?? null, source_revision:sourceRevision, source_hash:record.content_sha256 ?? record.content_hash ?? null,
    truth_kind:truthKind,
    time:{ observed_at:record.observed_at ?? null, publisher_published_at:publishedAt,
      discovered_at:discoveredAt, retrieved_at:record.retrieved_at ?? null,
      forecast_issued_at:forecastIssuedAt, forecast_valid_from:forecastValidFrom, forecast_valid_until:forecastValidUntil,
      basis:record.observed_at ? 'source_observation' : (publishedAt ? 'publisher_publication' : record.retrieved_at ? 'retrieval' : 'unknown') },
    geometry:supplied ? { type:'Point', coordinates:[lon,lat], basis:'source_published', precision:null } : null,
    derived_geometry:derivedGeometry,
    measures:record.measures ?? {}, values, coverage, source_health:sourceHealth,
    rights:{ license:record.license ?? null, attribution:record.attribution ?? null, use_limits:record.use_limits ?? null },
    review:{ status:record.review_status ?? 'unreviewed', reviewer_id:record.reviewed_by ?? null, reviewed_at:record.reviewed_at ?? null },
    references:{ supports:record.supports ?? [], contradicts:record.contradicts ?? [], context:record.context ?? [] }
  };
}

export function sourceHealthProjection(health, { now = new Date(), staleAfterSeconds = 1800 } = {}) {
  const latest=health?.latest_run, last=health?.last_successful_run;
  const lastAt=last?.finished_at ?? health?.connector?.last_ok_at ?? null;
  const age=lastAt && Number.isFinite(Date.parse(lastAt)) ? Math.max(0,(now.valueOf()-Date.parse(lastAt))/1000) : null;
  const stale=age===null ? null : age>staleAfterSeconds;
  const error=String(latest?.error ?? '');
  const failed=latest?.status==='failed';
  const transport=!latest ? 'unavailable' : failed
    ? (/timeout/.test(error) ? 'timeout' : /http_40[13]|entitlement|denied/.test(error) ? 'denied' : 'failed')
    : latest.status==='running' ? 'running' : 'responded';
  const truncated=latest?.metadata?.page_full===true || latest?.metadata?.truncated===true;
  const complete=['succeeded','partial'].includes(latest?.status) && !truncated;
  const seen=Number.isInteger(latest?.records_seen) ? latest.records_seen : null;
  const coverage=truncated ? 'truncated' : failed ? (last ? 'last_success_only' : 'unavailable')
    : complete && seen===0 ? 'empty' : complete ? 'monitored' : 'unknown';
  return { schema:'mccluster-source-health/v1', transport, coverage,
    last_success_at:lastAt, age_seconds:age, stale, stale_after_seconds:staleAfterSeconds,
    records_seen:seen, data_quality:{ rejected:latest?.records_rejected ?? null, status:latest?.status==='partial' ? 'partial' : 'unknown' },
    error:failed ? error : null };
}
