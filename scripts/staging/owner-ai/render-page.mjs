/* Test-only page composition. The product HTML and JS are reused unchanged;
   only the isolated server calls this function after its access-code gate. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const BOOTSTRAP_PATH = fileURLToPath(new URL('./bootstrap.js', import.meta.url));

export async function renderOwnerAiStagingPage({ root = ROOT } = {}) {
  const html = await readFile(join(root, 'control.html'), 'utf8');
  if (!html.includes('js/control-room/owner-ai.js') || !html.includes('js/control-room-v2.js')) throw new Error('Owner AI modules are missing from the source Control page.');
  return html.replace('<head>', '<head><meta name="mccluster-staging" content="owner-ai-isolated-runtime"><meta name="referrer" content="no-referrer"><script src="/__staging/owner-ai-bootstrap.js"></script><style>#ownerAiStagingBanner{padding:12px 18px;border-bottom:1px solid #b48331;background:#2b2110;color:#fff1c9;font:600 13px/1.55 system-ui,sans-serif;text-align:center;overflow-wrap:anywhere}.owner-ai-staging-identities{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}#ownerAiStagingWorkers{max-width:720px;margin:10px auto;padding:0 16px;color:var(--cr-dim);font:13px/1.6 system-ui,sans-serif}#ownerAiStagingWorkers>summary{min-height:44px;padding:10px 0;cursor:pointer;font-weight:700}#ownerAiStagingWorkers label{display:grid;gap:6px;margin:12px 0}#ownerAiStagingWorkers input{font-size:16px;width:100%;min-width:0}#ownerAiStagingWorkers button{min-height:44px}</style>')
    .replace('<title>Admin Home · McCluster</title>', '<title>Owner AI staging · Equity Upreneurs</title>')
    .replace('<span class="cr-env">PROD</span>', '<span class="cr-env">STAGING</span>');
}
