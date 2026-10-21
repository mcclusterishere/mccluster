/* Owner-only aggregate read diagnostics. Never return upstream message,
 * SQL, request URL, row data, credentials, or arbitrary headers. */
const cleanCode = value => typeof value === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|[A-Z][A-Z0-9_]{0,23})$/.test(value) ? value : null;
const cleanRequest = value => typeof value === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(value) ? value : null;
const cleanStatus = value => Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
const timeMs = value => Math.min(120000, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

export function databaseErrorMetadata(response, body) {
  return {
    db_code: cleanCode(body?.code),
    upstream_status: cleanStatus(response?.status),
    request_id: cleanRequest(response?.headers?.get?.('x-request-id')) ||
      cleanRequest(response?.headers?.get?.('cf-ray'))
  };
}
export function readFailureDiagnostics(error, elapsedMs) {
  const code = cleanCode(error?.db_code);
  const status = cleanStatus(error?.upstream_status);
  const name = typeof error?.name === 'string' ? error.name : '';
  const category = code === '57014' || status === 408 || status === 504 ||
    name === 'TimeoutError' || name === 'AbortError' ? 'timeout'
    : status === 401 || status === 403 || code === '42501' ? 'authorization'
    : status === 404 || code === 'PGRST202' || code === 'PGRST205' ? 'missing_source'
    : status !== null && status >= 500 ? 'upstream_error'
    : 'unavailable';
  return {
    status: 'failed', reason: category, error_code: code,
    upstream_http_status: status, request_id: cleanRequest(error?.request_id),
    elapsed_ms: timeMs(elapsedMs)
  };
}
export function successfulReadDiagnostics(elapsedMs, skipped = false) {
  return {
    status: skipped ? 'not_applicable' : 'ready',
    elapsed_ms: timeMs(elapsedMs)
  };
}
