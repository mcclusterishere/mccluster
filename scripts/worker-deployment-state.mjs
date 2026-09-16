import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function currentDeployment(input) {
  const list = Array.isArray(input) ? input : input?.deployments;
  if (!Array.isArray(list) || !list.length) throw new Error('No serving deployment recorded; refusing an unprotected promotion');
  if (list.some(d => !Number.isFinite(Date.parse(d.created_on)))) throw new Error('Invalid deployment timestamp');
  const latest = [...list].sort((a,b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  const versions = latest.versions;
  if (!Array.isArray(versions) || !versions.length || versions.some(v => !UUID.test(v.version_id) || !Number.isFinite(v.percentage) || v.percentage <= 0 || v.percentage > 100)
    || new Set(versions.map(v=>v.version_id)).size !== versions.length
    || Math.abs(versions.reduce((sum,v)=>sum+v.percentage,0)-100) > 0.00001) throw new Error('Invalid traffic allocation; refusing promotion');
  return { id: latest.id, versions: versions.map(v => ({ version_id: v.version_id, percentage: v.percentage })) };
}
export function allocation(deployment) {
  return deployment.versions.map(v => `${v.version_id}@${v.percentage}`).sort();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file, other] = process.argv.slice(2);
  const state = currentDeployment(JSON.parse(await readFile(file, 'utf8')));
  if (mode === 'capture') { await writeFile(other, JSON.stringify([stateWithTime(state)]) + '\n'); console.log(allocation(state).join(' ')); }
  else if (mode === 'verify') {
    const expected = currentDeployment(JSON.parse(await readFile(other, 'utf8')));
    if (JSON.stringify(allocation(state)) !== JSON.stringify(allocation(expected))) throw new Error('Traffic changed outside this release');
    console.log('Traffic allocation verified');
  } else throw new Error('Use capture <input> <snapshot> or verify <current> <snapshot>');
}
function stateWithTime(state) { return { ...state, created_on: new Date().toISOString() }; }
