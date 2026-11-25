/* ============================================================
   DISPATCH POLICY: what a routed capability may do right now.

   The capability catalog (core/capabilities/catalog.json) is the only
   source of risk and approval. This module never relaxes it:

     approval "none" and risk read/write   -> run now
     any other approval value              -> pending owner approval
       (review-required, budget-gated, owner, owner-policy-gated)
     risk spend, deploy or destructive     -> pending owner approval,
                                              whatever approval says
     never-dispatched capability, or one   -> refused
       missing from the catalog

   And before any of that: a dispatch turn is accepted only from the
   house owner (actor kind "owner" with a UUID user id, stamped by the
   signed Cloudflare edge after its owner check). A message can never
   name its own actor.
   ============================================================ */

import { NEVER_DISPATCHED } from './routes.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALWAYS_GATED_RISK = new Set(['spend', 'deploy', 'destructive']);

export function requireOwner(actor) {
  if (actor?.kind !== 'owner' || !UUID.test(String(actor?.user_id || ''))) {
    throw Object.assign(new Error('dispatch requires the house owner session (signed edge actor)'), { status: 403, code: 'DISPATCH_OWNER_REQUIRED' });
  }
  return String(actor.user_id).toLowerCase();
}

export function catalogEntry(catalog, capability) {
  const list = Array.isArray(catalog?.capabilities) ? catalog.capabilities : [];
  return list.find((entry) => entry?.id === capability) || null;
}

/* core.resume and the workstream reads are control tools that are not
   all catalog capabilities under the same id; they are read-only by
   construction and listed here explicitly rather than guessed. */
const READ_ONLY_CONTROL = new Set(['core.resume']);

export function gateFor(route, catalog) {
  if (!route) return { decision: 'refused', reason: 'no route' };
  if (NEVER_DISPATCHED.includes(route.capability)) return { decision: 'refused', reason: `${route.capability} is never dispatched from chat` };
  const entry = catalogEntry(catalog, route.capability);
  if (!entry) {
    if (READ_ONLY_CONTROL.has(route.capability)) return { decision: 'run', risk: 'read', approval: 'none', risk_class: 'low', reason: 'read-only control tool' };
    return { decision: 'refused', reason: `${route.capability} is not in the capability catalog` };
  }
  if (entry.lifecycle && entry.lifecycle !== 'active') return { decision: 'refused', reason: `${route.capability} is ${entry.lifecycle}` };
  const risk = String(entry.risk || 'write');
  const approval = String(entry.approval || 'review-required');
  if (approval !== 'none' || ALWAYS_GATED_RISK.has(risk)) {
    return { decision: 'approval', risk, approval, risk_class: risk === 'read' ? 'medium' : 'high', reason: `catalog: risk ${risk}, approval ${approval}` };
  }
  return { decision: 'run', risk, approval, risk_class: risk === 'read' ? 'low' : 'medium', reason: `catalog: risk ${risk}, approval none` };
}
