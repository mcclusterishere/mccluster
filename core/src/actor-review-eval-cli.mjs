import { readFile } from 'node:fs/promises';
import { localAiDiagnostics } from './compute/local-ai-client.mjs';
import { evaluateActorReview } from './actors/evaluate.mjs';

const [flag, path, offsetArg = '0', limitArg = '2', ...extra] = process.argv.slice(2);
const offset = Number(offsetArg), limit = Number(limitArg);
if (flag !== '--local' || !path || extra.length || !/^\d+$/.test(offsetArg) || !/^\d+$/.test(limitArg) ||
    !Number.isInteger(offset) || !Number.isInteger(limit) || limit < 1 || limit > 6) {
  console.error('Usage: node src/actor-review-eval-cli.mjs --local /private/path/fixtures.json [offset=0] [limit=2, max=6]');
  process.exitCode = 2;
} else {
  try {
    const fixtures = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(fixtures.cases) || offset >= fixtures.cases.length) throw new Error('No cases in the selected batch');
    const runtime = await localAiDiagnostics();
    console.log(JSON.stringify({ event: 'local_runtime', model: runtime.model || null, model_digest: runtime.digest || null,
      ollama_version: runtime.ollama_version || null, observed_at: runtime.observed_at || null, offset, limit }));
    for (const entry of fixtures.cases.slice(offset, offset + limit)) {
      const result = await evaluateActorReview({ item: fixtures.item, actor: fixtures.actor, comment: entry.comment,
        proposedKind: entry.proposed_kind, expectedReject: entry.expected_reject, caseId: entry.id });
      console.log(JSON.stringify(result));
    }
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
