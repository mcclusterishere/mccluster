import { probeGameStudioHost, smokeLaunchGameStudioHost } from './staging-gate.mjs';

const smoke = process.argv.includes('--smoke');
const projectArgIndex = process.argv.indexOf('--project');
const project_dir = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : undefined;

const result = smoke
  ? smokeLaunchGameStudioHost({ project_dir })
  : probeGameStudioHost({ project_dir });

console.log(JSON.stringify(result, null, 2));
if (smoke ? !result.smoke_ok : !result.ready) process.exitCode = 1;
