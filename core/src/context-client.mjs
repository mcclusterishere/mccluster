const SB = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const API_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const CONTEXT_TOKEN = String(process.env.MCCLUSTER_CONTEXT_TOKEN || '');

export async function fetchConversationContext({ orgId, conversationId, maxMessages = 40, maxChars = 96_000 } = {}) {
  if (!SB) throw new Error('SUPABASE_URL is required for private context reads');
  if (!CONTEXT_TOKEN) throw new Error('MCCLUSTER_CONTEXT_TOKEN is required for private context reads');
  if (!orgId || !conversationId) throw new Error('orgId and conversationId are required for private context reads');

  const headers = {
    'content-type': 'application/json',
    'x-mccluster-context-token': CONTEXT_TOKEN,
  };
  if (API_KEY) headers.apikey = API_KEY;

  const response = await fetch(`${SB}/functions/v1/context-core`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      org_id: orgId,
      conversation_id: conversationId,
      max_messages: Math.min(80, Math.max(1, Number(maxMessages) || 40)),
      max_chars: Math.min(160_000, Math.max(1_000, Number(maxChars) || 96_000)),
    }),
    signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_CONTEXT_TIMEOUT_MS || 30_000)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `context-core returned ${response.status}`);
  if (!Array.isArray(data?.messages)) throw new Error('context-core returned no message array');
  return data;
}
