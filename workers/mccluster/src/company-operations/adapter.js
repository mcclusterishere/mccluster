/* Installed McCluster adapter; canonical Supabase RPC and owner auth stay outside
 * the portable reducer. No new database, account, queue or payment provider. */
import {rpc} from '../intel/store.js';
import {CompanyOperationError} from './domain.js';
export function createSupabaseCompanyStore(env, call = rpc) {
  async function invoke(name, principal, companyId, rest = {}) {
    try {
      return await call(env, name, {p_org: principal.orgId, p_actor: principal.actorId, p_company: companyId, ...rest});
    } catch (error) {
      if (error.code === 'intel_schema_not_ready') throw new CompanyOperationError('company_schema_not_applied', 503);
      if (error.code === 'not_permitted') throw new CompanyOperationError('owner_required', 403);
      if (error.code === 'conflict') throw new CompanyOperationError('revision_or_idempotency_conflict', 409);
      throw new CompanyOperationError('company_store_unavailable', 503);
    }
  }
  return {read: (p, c) => invoke('company_operations_read_v1', p, c),
    append: (p, c, expected, event) => invoke('company_operations_append_v1', p, c, {p_expected: expected, p_event: event})};
}
/* Not registered in the shipping router. Integrator supplies the existing
 * authenticated service and enables only after schema/access/release review.
 * Commands carry no actor/tenant/auth/bank details. All replies are private. */
export async function handleCompanyOperations(request, {enabled = false, service, companyId} = {}) {
  const respond = (value, status = 200) => new Response(JSON.stringify(value), {status,
    headers: {'content-type': 'application/json', 'cache-control': 'private, no-store', 'vary': 'Authorization, Cookie'}});
  try {
    if (!enabled || !service) throw new CompanyOperationError('company_operations_disabled', 503);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].some(x => x !== 'declaration')) throw new CompanyOperationError('invalid_query');
      const declaration = url.searchParams.get('declaration');
      return respond({ok: true, value: declaration ? await service.handoff(request, companyId, declaration) : await service.read(request, companyId)});
    }
    if (request.method !== 'POST') throw new CompanyOperationError('method_not_allowed', 405);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new CompanyOperationError('json_required', 415);
    const reader = request.body?.getReader();
    if (!reader) throw new CompanyOperationError('invalid_request');
    let size = 0; const parts = [];
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 100 * 1024) { await reader.cancel(); throw new CompanyOperationError('request_too_large', 413); }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size); let position = 0;
    for (const part of parts) {bytes.set(part, position); position += part.byteLength;}
    let body;
    try {body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {throw new CompanyOperationError('invalid_json');}
    return respond({ok: true, value: await service.command(request, companyId, body)});
  } catch (error) {
    const status = error instanceof CompanyOperationError ? error.status : 503;
    return respond({ok: false, error: error instanceof CompanyOperationError ? error.code : 'company_operations_unavailable'}, status);
  }
}
