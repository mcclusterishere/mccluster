/* Approval policy, enforced in code on every harness call this gateway
   makes. Deny by default. The rules (in the spirit of Hermes Agent's
   approval modes, rebuilt for McCluster's catalog classes):

     catalog approval   risk                   behaviour from Equity Fighter
     ----------------   --------------------   ---------------------------------------------
     none               read                   run (also unattended)
     none               write                  run when the owner is present in this turn;
                                               denied for unattended (scheduled) work
     owner              any but always-gated   run ONLY on an explicit owner confirmation
                                               typed in this turn ("go"), and the harness
                                               re-checks the Control approval itself
     review-required    any                    deny here: only reachable through
     budget-gated                              dispatch.turn, which files a pending
     owner-policy-gated                        control_approvals row instead of running
     anything           spend/deploy/destructive  deny here, always
     unknown tool / unknown class              deny

   Tainted input (content that came from outside the owner, e.g. a quoted
   web page) can only reach read capabilities.

   CAPABILITY_CLASSES is a snapshot of core/capabilities/catalog.json for the
   only tools this gateway may call (harness/mcp-client.ts ALLOWED_TOOLS).
   test/policy.test.ts fails if the catalog and this snapshot drift, so a
   catalog tightening can never be silently ignored here. */

export type ApprovalClass = 'none' | 'owner' | 'review-required' | 'budget-gated' | 'owner-policy-gated';
export type Risk = 'read' | 'write' | 'spend' | 'deploy' | 'destructive';

export interface CapabilityClass {
  risk: Risk;
  approval: ApprovalClass;
}

export const CAPABILITY_CLASSES: Readonly<Record<string, CapabilityClass>> = Object.freeze({
  'dispatch.turn': { risk: 'write', approval: 'none' },
  'dispatch.get': { risk: 'read', approval: 'none' },
  'dispatch.execute': { risk: 'write', approval: 'owner' },
  'ai.chat': { risk: 'read', approval: 'none' },
  'compute.task.get': { risk: 'read', approval: 'none' },
});

const ALWAYS_GATED: ReadonlySet<string> = new Set(['spend', 'deploy', 'destructive']);

export interface PolicyContext {
  /** A paired/allowlisted owner sent the message that caused this call. */
  ownerPresent: boolean;
  /** The owner typed an explicit confirmation ("go") in this very message. */
  ownerConfirmed?: boolean;
  /** Scheduled/background work with nobody in the conversation. */
  unattended?: boolean;
  /** The request carries content from outside the owner. */
  tainted?: boolean;
}

export type PolicyDecision = { allow: true; reason: string } | { allow: false; reason: string; code: string };

export function decide(tool: string, ctx: PolicyContext, classes: Readonly<Record<string, CapabilityClass>> = CAPABILITY_CLASSES): PolicyDecision {
  const cls = classes[tool];
  const deny = (code: string, reason: string): PolicyDecision => ({ allow: false, code, reason });
  if (!cls) return deny('EF_POLICY_UNKNOWN', `${tool} is not a capability Equity Fighter knows; denied by default`);
  if (ALWAYS_GATED.has(cls.risk)) return deny('EF_POLICY_ALWAYS_GATED', `${tool} has risk ${cls.risk}; never started from the chat layer`);
  if (ctx.tainted && cls.risk !== 'read') return deny('EF_POLICY_TAINTED', `${tool} writes, and this request carries outside content`);
  if (cls.risk === 'read' && cls.approval === 'none') return { allow: true, reason: 'read, approval none' };
  if (!ctx.ownerPresent || ctx.unattended) return deny('EF_POLICY_UNATTENDED', `${tool} changes state and the owner is not in this turn`);
  switch (cls.approval) {
    case 'none':
      return { allow: true, reason: 'write, approval none, owner present' };
    case 'owner':
      return ctx.ownerConfirmed
        ? { allow: true, reason: 'owner class, explicit owner confirmation this turn; harness re-checks the Control approval' }
        : deny('EF_POLICY_OWNER_CONFIRMATION', `${tool} needs the owner's explicit confirmation`);
    case 'review-required':
    case 'budget-gated':
    case 'owner-policy-gated':
      return deny('EF_POLICY_GATED', `${tool} is ${cls.approval}; ask through dispatch.turn so it is filed for approval`);
    default:
      return deny('EF_POLICY_UNKNOWN_CLASS', `${tool} has an unknown approval class`);
  }
}

export class PolicyDeniedError extends Error {
  readonly code: string;
  constructor(tool: string, decision: Extract<PolicyDecision, { allow: false }>) {
    super(`Denied by Equity Fighter policy: ${decision.reason}`);
    this.name = 'PolicyDeniedError';
    this.code = decision.code;
  }
}
