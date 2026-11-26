/* Configuration. Draft mode is the default. Send mode needs every one of:
   DEMO_OUTREACH_MODE=send, DEMO_OUTREACH_SEND_ENABLED=true, an explicit transport module, and --confirm on the CLI.
   The per run cap is clamped: env can lower it and never raise it above HARD_MAX_PER_RUN. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARD_MAX_PER_RUN = 5;
const here = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.resolve(here, '..');

export function loadConfig(env = process.env) {
  const requested = Number.parseInt(env.DEMO_OUTREACH_MAX_PER_RUN ?? `${HARD_MAX_PER_RUN}`, 10);
  const maxPerRun = Number.isFinite(requested) && requested > 0 ? Math.min(requested, HARD_MAX_PER_RUN) : HARD_MAX_PER_RUN;
  const mode = env.DEMO_OUTREACH_MODE === 'send' ? 'send' : 'draft';
  return {
    mode,
    sendEnabled: mode === 'send' && env.DEMO_OUTREACH_SEND_ENABLED === 'true',
    maxPerRun,
    target: env.DEMO_OUTREACH_TARGET || null,
    fromName: env.DEMO_OUTREACH_FROM_NAME || 'Matthew McCluster',
    fromEmail: env.DEMO_OUTREACH_FROM_EMAIL || 'matthew@mccluster.org',
    stateDir: env.DEMO_OUTREACH_STATE_DIR || path.join(PKG_DIR, 'state'),
    candidatesFile: env.DEMO_OUTREACH_CANDIDATES || path.join(PKG_DIR, 'data', 'candidates.json'),
    targetsFile: env.DEMO_OUTREACH_TARGETS || path.join(PKG_DIR, 'data', 'targets.json'),
  };
}
