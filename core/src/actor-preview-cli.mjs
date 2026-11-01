import { readFile } from 'node:fs/promises';
import { previewActorComment } from './actors/generate.mjs';
import { localAiDiagnostics } from './compute/local-ai-client.mjs';

// Explicit opt-in, sequential, six samples maximum; never imports a publication
// executor or accepts remote inference endpoints. Keep output in private storage.
const [flag, path] = process.argv.slice(2);
if (flag !== '--local' || !path) {
  console.error('Usage: node src/actor-preview-cli.mjs --local /private/path/batch.json (1–6 owned/authorized samples; no publishing)');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(input.samples) || !input.samples.length || input.samples.length > 6) throw new Error('Expected 1–6 preview samples');
    const installed = await localAiDiagnostics();
    console.log(JSON.stringify({ event: 'local_runtime', model: installed.model || null, model_digest: installed.digest || null,
      ollama_version: installed.ollama_version || null, observed_at: installed.observed_at || null }));
    for (const [index, sample] of input.samples.entries()) {
      const output = await previewActorComment({ ...sample, personaConfig: input.personaConfig,
        evidenceOptions: { ...(input.evidenceOptions || {}), now: new Date() } });
      console.log(JSON.stringify({ sample: index + 1, ...output }));
    }
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
