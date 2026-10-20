import os from 'node:os';
import { localAiChat, localAiDiagnostics } from '../compute/local-ai-client.mjs';
import { run } from '../process.mjs';

export async function aiDiagnostics(job = {}, dependencies = {}) {
  const inspect = dependencies.inspect || localAiDiagnostics;
  const chat = dependencies.chat || localAiChat;
  const shell = dependencies.run || run;
  const limits = await shell('systemctl', ['show', 'ollama.service', '--property=CPUQuotaPerSecUSec,MemoryMax,TasksMax'], { timeoutMs: 5000 }).then(result => result.stdout.trim()).catch(() => null);
  const installed = await inspect();
  const benchmarks = [];
  // Fixed synthetic prompts only. Diagnostics cannot run caller-provided code,
  // arbitrary HTTP, shell commands, or private conversation benchmarks.
  if (job.input?.benchmark === true) {
    for (const numCtx of [8192, 16384]) {
      for (let repetition = 1; repetition <= 2; repetition += 1) {
        const started = Date.now();
        const response = await chat({ prompt: 'Reply exactly MCCLUSTER_AI_READY. /no_think', think: false, numCtx, numPredict: 96, temperature: 0.2, priority: -50, timeoutMs: 120000, metadata: { source: 'ai-diagnostics', synthetic: true, job_id: job.id } });
        benchmarks.push({ num_ctx: numCtx, repetition, wall_ms: Date.now() - started, exact_match: response.message.content.trim() === 'MCCLUSTER_AI_READY', output: response.message.content.slice(0, 100), queue_wait_ms: response.queue_wait_ms, settings: response.settings, usage: response.usage, done_reason: response.done_reason, thinking_chars: response.thinking_chars });
      }
    }
  }
  return { executor: 'ai_diagnostics:v1', observed_at: new Date().toISOString(), installed, host: { platform: os.platform(), arch: os.arch(), logical_cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model || null, total_memory_bytes: os.totalmem(), free_memory_bytes: os.freemem(), load_average: os.loadavg(), ollama_service_limits: limits }, configuration: { private_context_configured: Boolean(process.env.MCCLUSTER_CONTEXT_TOKEN), recent_history_limit: 120, resident_context_tokens: 16384 }, benchmarks, summary: 'Measured installed local inference runtime and optional fixed synthetic benchmarks.' };
}
