import { localAiChat } from './compute/local-ai-client.mjs';
import { executeResidentTool, RESIDENT_TOOLS } from './resident-tools.mjs';

export function toolResultMessage(value, maxChars = 5000) {
  const serialized = JSON.stringify(value);
  return serialized.length <= maxChars ? serialized : JSON.stringify({ truncated: true, excerpt: serialized.slice(0, maxChars - 100), instruction: 'Narrow the query to retrieve further detail.' });
}

export async function runResidentAgent({ messages, context, metadata, checkpoint = async () => {}, maxRounds = 3, maxCalls = 6 }, dependencies = {}) {
  const chat = dependencies.chat || localAiChat;
  const execute = dependencies.execute || executeResidentTool;
  const history = [...messages];
  const receipts = [], measurements = [];
  let calls = 0;
  const started = Date.now();
  const deadline = started + 240000;
  for (let round = 0; round <= maxRounds; round += 1) {
    const allowTools = round < maxRounds && calls < maxCalls && Date.now() < deadline - 30000;
    const response = await chat({
      messages: history, tools: allowTools ? RESIDENT_TOOLS : undefined,
      think: false, temperature: 0.3, numCtx: 16384, numPredict: allowTools ? 1024 : 1536,
      timeoutMs: Math.max(30000, deadline - Date.now()), priority: 100, metadata,
    });
    measurements.push({ round, model: response.model, queue_wait_ms: response.queue_wait_ms, usage: response.usage || {}, settings: response.settings, done_reason: response.done_reason });
    const requested = response.message?.tool_calls || [];
    if (!requested.length) return { ...response, tool_receipts: receipts, inference_rounds: measurements, duration_ms: Date.now() - started };
    if (!allowTools) throw new Error('Model requested tools after its execution budget was exhausted');
    history.push(response.message);
    for (const call of requested) {
      const name = String(call.function?.name || '');
      let result, args;
      const toolStarted = Date.now();
      let ok = false;
      try {
        if (calls >= maxCalls || Date.now() >= deadline - 30000) throw new Error('Tool budget exhausted; finish using the evidence already returned');
        calls += 1;
        args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function?.arguments || {});
        result = await execute(name, args, context);
        ok = true;
      } catch (error) { result = { error: String(error.message).slice(0, 400), performed: false }; }
      const receipt = { tool: name, ok, duration_ms: Date.now() - toolStarted, job_id: result?.job_id || null, error: ok ? null : result.error };
      receipts.push(receipt);
      // Persist receipts before the next inference; retries cannot silently lose
      // a queued task. analysis_queue is also idempotent across the whole turn.
      await checkpoint(receipts);
      history.push({ role: 'tool', tool_name: name, content: toolResultMessage(result), ...(call.id ? { tool_call_id: call.id } : {}) });
    }
    if (round === maxRounds - 1 || calls >= maxCalls) history.push({ role: 'user', content: 'Execution budget reached. Give the best supported answer now. Distinguish queued work from completed work and include job IDs.' });
  }
  throw new Error('Resident agent exhausted its inference budget');
}
