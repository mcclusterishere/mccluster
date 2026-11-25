/* OpenAI compatible chat and embeddings clients, configured by env only.
   Point OUTREACH_LLM_URL at any /v1 compatible endpoint you already run; this module changes no machine setup. */
export function createLlm(config, { fetchImpl = globalThis.fetch } = {}) {
  const { url, model, apiKey } = config.llm || {};
  if (!url || !model) return null;
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  async function chat(messages, { temperature = 0.9 } = {}) {
    const res = await fetchImpl(`${url}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages, temperature }) });
    if (!res.ok) throw new Error(`llm ${res.status}`);
    const body = await res.json();
    return String(body.choices?.[0]?.message?.content || '');
  }
  return {
    chat,
    async json(prompt, opts) {
      const text = await chat([{ role: 'system', content: 'Reply with one JSON object and nothing else.' }, { role: 'user', content: prompt }], { temperature: 0.2, ...opts });
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
  };
}

export function createEmbedder(config, { fetchImpl = globalThis.fetch } = {}) {
  const { url, model, apiKey } = config.embeddings || {};
  if (!url || !model) return null;
  return async function embed(text) {
    const res = await fetchImpl(`${url}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, input: String(text).slice(0, 8000) }) });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    return (await res.json()).data?.[0]?.embedding || null;
  };
}
