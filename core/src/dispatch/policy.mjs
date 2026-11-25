/* ============================================================
   DISPATCH POLICY: what a routed capability or job may do right now.

   For a catalog route the capability catalog (core/capabilities/
   catalog.json) is the only source of risk and approval, read again at
   call time; this module never relaxes it. A direct job route has no
   catalog entry and carries the risk and approval declared for it in
   routes.mjs. Either way:

     approval "none" and risk read/write   -> run now
     any other approval value              -> pending owner approval
       (review-required, budget-gated, owner, owner-policy-gated)
     risk spend, deploy or destructive     -> pending owner approval,
                                              whatever approval says
     excluded, unknown, inactive, or no    -> refused
       mcp/agent interface

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

function decideGate(risk, approval, source) {
  if (approval !== 'none' || ALWAYS_GATED_RISK.has(risk)) {
    return { decision: 'approval', risk, approval, risk_class: risk === 'read' ? 'medium' : 'high', reason: `${source}: risk ${risk}, approval ${approval}` };
  }
  return { decision: 'run', risk, approval, risk_class: risk === 'read' ? 'low' : 'medium', reason: `${source}: risk ${risk}, approval none` };
}

export function gateFor(route, catalog) {
  if (!route) return { decision: 'refused', reason: 'no route' };
  if (NEVER_DISPATCHED.includes(route.capability)) return { decision: 'refused', reason: `${route.capability} is never dispatched from chat` };
  if (route.via === 'job') return decideGate(String(route.risk || 'write'), String(route.approval || 'review-required'), `job ${route.jobType}`);
  const entry = catalogEntry(catalog, route.capability);
  if (!entry) return { decision: 'refused', reason: `${route.capability} is not in the capability catalog` };
  if (entry.lifecycle && entry.lifecycle !== 'active') return { decision: 'refused', reason: `${route.capability} is ${entry.lifecycle}` };
  const interfaces = Array.isArray(entry.interfaces) ? entry.interfaces : [];
  if (!interfaces.includes('mcp') && !interfaces.includes('agent')) return { decision: 'refused', reason: `${route.capability} is not exposed to agents` };
  return decideGate(String(entry.risk || 'write'), String(entry.approval || 'review-required'), 'catalog');
}
