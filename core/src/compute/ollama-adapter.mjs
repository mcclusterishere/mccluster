import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_PORT || 4790);
const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const check = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return send(res, check.ok ? 200 : 503, {
        ok: check.ok,
        service: 'mccluster-ollama-adapter',
        model: MODEL,
      });
    }

    if (req.method === 'POST' && req.url === '/execute') {
      const body = await readJson(req);
      if (body.capability !== 'ai.chat') return send(res, 400, { error: `unsupported capability: ${body.capability}` });

      const input = body.input || {};
      const messages = Array.isArray(input.messages)
        ? input.messages
        : [{ role: 'user', content: String(input.prompt || '') }];

      if (!messages.length || !messages.some((m) => String(m?.content || '').trim())) {
        return send(res, 400, { error: 'messages or prompt is required' });
      }

      const response = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          messages,
          format: input.json === true ? 'json' : undefined,
          options: {
            temperature: Number(input.temperature ?? 0.2),
            num_ctx: Math.min(16384, Math.max(2048, Number(input.num_ctx || 8192))),
          },
        }),
        signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS || 600000)),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) return send(res, response.status, { error: data?.error || `Ollama returned HTTP ${response.status}` });

      return send(res, 200, {
        model: MODEL,
        content: String(data?.message?.content || ''),
        usage: {
          prompt_eval_count: data?.prompt_eval_count ?? null,
          eval_count: data?.eval_count ?? null,
          total_duration_ns: data?.total_duration ?? null,
        },
      });
    }

    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'ollama_adapter_ready', host: HOST, port: PORT, model: MODEL }));
});
