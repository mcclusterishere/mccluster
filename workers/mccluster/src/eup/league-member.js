/* E=Up → Environmental Justice League → member routes: /v1/eup/member/league/*.

   Reached ONLY through the one member branch of ./router.js, after the Worker's own session check verified the
   bearer. `user` is that verified session user and nothing else: no body field, query value or header can name an
   account, and a body that carries actor, applicant, participant, user_id or tenant at any depth is refused (422)
   before any call. Every route is a member row of ROUTES in ./league-contract.js and makes exactly the calls the
   row names, with p_actor = the session user:
     reads and commands  one eup_league_member_command call
     uploads             the member command, then the media module (./league-media.js) in MEDIA.order:
       POST assignments/:id/uploads  uploads.begin → beginUpload (the grant exists only in this answer)
       POST uploads/:id/complete     uploads.get → completeUpload, which measures the object and seals it through
                                     ctx.seal = one eup_league_media_seal call made here, mapped like every member call
       POST uploads/:id/discard      uploads.discard → discardUpload
       GET  uploads/:id/url          uploads.get with sign → signOwnRead
   Every SQL decision stays in the SQL: who is in the released audience, whose row it is, readiness, entitlement,
   state and revision. This file caches nothing: every request asks again, so a revoked grant or a paused campaign
   is seen by the very next request.

   What a member is told (ERRORS in the contract): "no such row", "not your row", "not released to you" and "schema
   not applied" are one answer, 404 not_available, with nothing else in it, so no route confirms that another
   account's record or an unreleased campaign exists. A missing or invalid League policy is 503 policy_unavailable;
   module state comes from MODULE_POLICY_ERRORS in ./modules.js (draining, disabled, ...).

   What a member is shown: an upload only through projectShape('member_upload') or 'proof_media' (no tenant, family
   or storage identity, and never a storage path); every other answer through its contract shape; and nowhere a
   field that names another account (FOREIGN_ID_FIELDS), at any depth, whatever the store answered. */
import { FOREIGN_ID_FIELDS, MEMBER_ACTIONS, ROUTES, matchRoute, projectShape } from './league-contract.js';
import { beginUpload, completeUpload, discardUpload, signOwnRead } from './league-media.js';
import { leagueCall, leagueFailure, leagueRpc, mediaContext, prepareCall, routePath, rpcContext } from './league.js';

const FOREIGN = new Set(FOREIGN_ID_FIELDS);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* A copy of a member answer without any key that names another account, at any depth. */
export function memberSafe(value) {
  if (Array.isArray(value)) return value.map(memberSafe);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => !FOREIGN.has(key)).map(([key, child]) => [key, memberSafe(child)]));
  return value;
}

/* The shape a member route answers with: the route's own narrowing (member_upload, proof_media) when it names one,
   otherwise the action's result shape. A list result keeps its rows (the SQL builds them member-shaped). */
function answerShape(route) {
  if (route.answer) return route.answer;
  const result = MEMBER_ACTIONS[route.action]?.result;
  return typeof result === 'string' && !result.endsWith('[]') ? result : null;
}
const shaped = (shape, value) => memberSafe(shape ? projectShape(shape, value) : value);

/* A stored receipt answers what its route answered: an upload receipt carries a member_upload, not the raw row. */
const RECEIPT_SHAPES = Object.freeze(Object.fromEntries(ROUTES
  .filter((r) => r.surface === 'member' && r.rpc === 'member' && MEMBER_ACTIONS[r.action]?.kind === 'mutation')
  .map((r) => [r.action, answerShape(r)])));
function receiptAnswer(receipt) {
  const row = projectShape('receipt', receipt);
  const shape = typeof row.operation === 'string' && Object.hasOwn(RECEIPT_SHAPES, row.operation) ? RECEIPT_SHAPES[row.operation] : null;
  return memberSafe(shape ? { ...row, result: isPlainObject(row.result) ? projectShape(shape, row.result) : null } : row);
}

/* /v1/eup/member/league/* . ctx = { user, rest, url, fetchImpl, now, fail, rpcTimeoutMs }; user.id is the verified
   session user, lower case. */
export async function handleLeagueMember(request, env, ctx) {
  const { user, rest = '', url, fail } = ctx;
  const actor = user.id;
  const path = routePath(rest ? rest.split('/') : []);
  const hit = path === null ? null : matchRoute('member', request.method, path);
  if (!hit) throw leagueFailure(fail, 'not_available');
  const { route, params } = hit;
  const call = await prepareCall(request, url, route, params, fail);
  const rpc = rpcContext(ctx);
  const command = (action, extra) => leagueCall(env, rpc, 'member', { action, actor, ...extra });
  const send = () => command(route.action, { id: call.id, document: call.document, revision: call.revision, key: call.key });

  switch (route.media) {
    case 'beginUpload': {
      /* The staged row first (a replayed key returns the same row); the grant is signed only now, for the path of
         the row's own ids, and only while it cannot outlive the row (409 upload_expired otherwise). */
      const row = await send();
      const grant = await beginUpload(mediaContext(env, ctx), row);
      return { ok: true, [route.response]: shaped(route.answer, row), grant };
    }
    case 'completeUpload': {
      /* The participant's own row first (404 for anyone else), then the module lists, reads and measures the object
         and hands what it measured to the seal. The seal is called here, as this member, and is mapped like every
         member call; whatever it refuses passes through the module unchanged. */
      const row = await command('uploads.get', { id: call.id, document: {} });
      const seal = async (args) => {
        if (!isPlainObject(args) || typeof args.p_actor !== 'string' || args.p_actor.toLowerCase() !== actor) throw leagueFailure(fail, 'storage_unavailable', 503);
        const sealed = await leagueRpc(env, rpc, 'media', { p_upload: args.p_upload, p_actor: actor, p_result: args.p_result });
        if (!isPlainObject(sealed)) throw leagueFailure(fail, 'storage_unavailable', 503);
        return sealed;
      };
      const after = await completeUpload(mediaContext(env, ctx, { seal }), row, actor);
      return { ok: true, [route.response]: shaped(route.answer, after) };
    }
    case 'discardUpload': {
      const row = await send();
      await discardUpload(mediaContext(env, ctx), row); // never throws: what stays behind is left to the purge
      return { ok: true, [route.response]: shaped(route.answer, row) };
    }
    case 'signOwnRead': {
      const row = await send();
      const signed = await signOwnRead(mediaContext(env, ctx), row);
      return { ok: true, [route.response]: shaped(route.answer, { ...row, upload_id: row.id }), url: signed.url, expires_in: signed.expires_in };
    }
    default: {
      const result = await send();
      if (route.action === 'receipts.get') return { ok: true, [route.response]: receiptAnswer(result) };
      return { ok: true, [route.response]: shaped(answerShape(route), result) };
    }
  }
}
