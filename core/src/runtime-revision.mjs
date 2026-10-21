import { readFileSync } from 'node:fs';

// Capture once during process initialization, before the broker listens. A
// deployment can replace the disk manifest before restarting this process.
export function readRevisionAtStartup(path = process.env.MCCLUSTER_DEPLOY_MANIFEST || '/opt/mccluster/core/.mccluster-deploy.json') {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const sha = String(parsed?.commit_sha || '');
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export const RUNNING_DEPLOYMENT_SHA = readRevisionAtStartup();
