import { SCHEMA, CompanyOperationError, requireValue, canonical, digest, emptyCompany, reduceCompany, handoffPacket, accountingProposal } from './domain.js';
const MAX_BYTES = 96 * 1024;
export async function replayCompany(orgId, companyId, events, reducer = reduceCompany) {
  requireValue(Array.isArray(events) && events.length <= 2000, 'history_invalid', 503);
  let state = emptyCompany(orgId, companyId), previousHash = null;
  for (const event of events) {
    const {hash, ...body} = event;
    requireValue(body.orgId === orgId && body.companyId === companyId && body.revision === state.revision + 1 && body.previousHash === previousHash && await digest(body) === hash, 'history_integrity_failed', 503);
    try { state = reducer(state, body.command, {orgId, companyId, actorId: body.actorId, at: body.at, human: body.human}); }
    catch { throw new CompanyOperationError('history_schema_or_record_invalid', 503); }
    previousHash = hash;
  }
  return {state, previousHash};
}
/* authorize is the installed host's EXISTING authenticated owner resolver, called
 * on every operation. It must never obtain identity/role/human from command JSON.
 * SQL also rechecks canonical org membership in the same transaction as append.
 * verifyArtifact resolves a private canonical artifact, hash and org; not a URL. */
export function createCompanyOperations({store, authorize, verifyArtifact, now = () => new Date().toISOString(), reducer = reduceCompany, artifactCommandTypes = ['record_document']} = {}) {
  requireValue(store && typeof authorize === 'function' && typeof reducer === 'function', 'authorization_unavailable', 503);
  requireValue(Array.isArray(artifactCommandTypes) && artifactCommandTypes.every(x => typeof x === 'string'), 'invalid_server_configuration', 503);
  async function load(session, companyId) {
    const principal = await authorize(session);
    requireValue(principal?.role === 'owner' && principal.enabled === true && principal.actorId && principal.orgId, 'owner_required', 403);
    const rows = await store.read(principal, companyId);
    const {state, previousHash} = await replayCompany(principal.orgId, companyId, rows, reducer);
    return {principal, rows, state, previousHash};
  }
  return {
    async read(session, companyId) { return (await load(session, companyId)).state; },
    async command(session, companyId, request) {
      requireValue(request && Object.keys(request).sort().join(',') === 'command,expectedRevision' && Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0, 'invalid_request');
      const signature = canonical(request.command);
      requireValue(new TextEncoder().encode(signature).length <= MAX_BYTES, 'request_too_large', 413);
      const {principal, rows, state, previousHash} = await load(session, companyId);
      const prior = rows.find(x => x.command.id === request.command?.id);
      if (prior) {
        requireValue(prior.actorId === principal.actorId && canonical(prior.command) === signature, 'idempotency_conflict', 409);
        return {schema: SCHEMA, replay: true, appliedRevision: prior.revision, state};
      }
      requireValue(request.expectedRevision === state.revision, 'revision_conflict', 409);
      if (artifactCommandTypes.includes(request.command?.type)) {
        requireValue(typeof verifyArtifact === 'function', 'artifact_verifier_unavailable', 503);
        const doc = request.command.data;
        const artifact = await verifyArtifact(principal, doc?.artifactRef);
        requireValue(artifact?.orgId === principal.orgId && artifact?.artifactRef === doc?.artifactRef && artifact?.sha256 === doc?.sha256 && artifact?.immutable === true, 'artifact_scope_or_hash_mismatch', 403);
      }
      const body = {orgId: principal.orgId, companyId, actorId: principal.actorId, human: principal.human === true, at: now(),
        revision: state.revision + 1, previousHash, command: structuredClone(request.command)};
      const next = reducer(state, body.command, body);
      requireValue(new TextEncoder().encode(canonical(next)).length <= 2 * 1024 * 1024, 'workspace_capacity', 409);
      const event = {...body, hash: await digest(body)};
      // Atomically append command, audit identity and revision. Do not silently
      // retry on an uncertain result. Same command id safely reconciles later.
      const receipt = await store.append(principal, companyId, state.revision, event);
      requireValue(receipt?.hash && receipt?.command?.id === event.command.id, 'append_outcome_uncertain', 503);
      if (receipt.hash !== event.hash) {
        requireValue(receipt.actorId === principal.actorId && canonical(receipt.command) === signature, 'idempotency_conflict', 409);
        return {schema: SCHEMA, replay: true, appliedRevision: receipt.revision, state: (await load(session, companyId)).state};
      }
      return {schema: SCHEMA, replay: false, appliedRevision: event.revision, state: next};
    },
    async handoff(session, companyId, declarationId) {
      const {state} = await load(session, companyId);
      const packet = {...handoffPacket(state, declarationId), accountingProposal: accountingProposal(state, declarationId)};
      return {...packet, packetSha256: await digest(packet)};
    },
    async executePayment() { throw new CompanyOperationError('human_handoff_required', 403); }
  };
}
