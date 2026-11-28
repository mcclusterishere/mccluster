/* EquityNet: the compute/network layer (McCluster for Windows on Prime and
   any other enrolled compute node, PR #824). Equity Fighter never talks to a
   device. It asks Core for the catalog capability `ai.chat`, which Core binds
   to owned, self-hosted implementations first (preferOwned; placement is
   Core's choice, not a message's), so a live
   EquityNet node running Qwen through Ollama answers when one is enrolled.
   The node's signed receipt stays EquityNet's business; this file only reads
   the task back through `compute.task.get`.

   `ai.chat` is catalog risk `read`, approval `none`, so it runs without an
   approval. Any change to that in core/capabilities/catalog.json makes the
   gate in dispatch.ts treat it as gated. */

import type { OwnerActor } from '../types.js';
import type { HarnessClient } from './mcp-client.js';

export const EQUITYNET_CHAT_CAPABILITY = 'ai.chat';
export const EQUITYNET_TASK_READ = 'compute.task.get';

export interface EquityNetTask {
  id: string;
  status: string;
  output?: unknown;
  last_error?: string | null;
}

export interface EquityNetClient {
  enqueueChat(prompt: string, actor: OwnerActor): Promise<EquityNetTask>;
  readTask(taskId: string, actor: OwnerActor): Promise<EquityNetTask | null>;
}

const SYSTEM_PROMPT =
  'You are Equity Fighter, Matthew McCluster\'s assistant, answering from his own compute (EquityNet). Answer briefly and plainly. You cannot send messages, spend money, deploy or delete anything; say so if asked.';

function asTask(raw: unknown): EquityNetTask | null {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const task = body.task && typeof body.task === 'object' ? body.task : body;
  if (!task || typeof task.id !== 'string') return null;
  return { id: task.id, status: String(task.status || 'queued'), output: task.output, last_error: task.last_error ?? null };
}

export function createEquityNetClient(harness: HarnessClient, opts: { orgId: string }): EquityNetClient {
  return {
    async enqueueChat(prompt, actor) {
      const args: Record<string, unknown> = {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt.slice(0, 8000) },
        ],
      };
      const task = asTask(await harness.callTool(EQUITYNET_CHAT_CAPABILITY, args, actor, { ownerPresent: true }));
      if (!task) throw new Error('Core did not return a compute task for ai.chat');
      return task;
    },
    async readTask(taskId, actor) {
      return asTask(await harness.callTool(EQUITYNET_TASK_READ, { org_id: opts.orgId, task_id: taskId }, actor, { ownerPresent: false, unattended: true }));
    },
  };
}

/** Best-effort text out of an ai.chat result (Ollama-style message.content or a plain text field). */
export function chatText(output: unknown): string | null {
  const o = (output && typeof output === 'object' ? output : {}) as Record<string, any>;
  const candidates = [o.message?.content, o.content, o.text, o.response, o.result?.message?.content, o.result?.text];
  const hit = candidates.find((c) => typeof c === 'string' && c.trim());
  return hit ? String(hit).trim() : null;
}
