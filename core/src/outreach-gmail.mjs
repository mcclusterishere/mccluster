function required(name, env) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for Gmail outreach transport`);
  return value;
}

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function headerSafe(value, max = 500) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function bodySafe(value, max = 20_000) {
  return String(value || '').replace(/\r?\n/g, '\r\n').trim().slice(0, max);
}

async function gmailAccessToken(env = process.env) {
  const clientId = required('GMAIL_CLIENT_ID', env);
  const clientSecret = required('GMAIL_CLIENT_SECRET', env);
  const refreshToken = required('GMAIL_REFRESH_TOKEN', env);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description || data?.error || `Gmail token refresh failed: ${response.status}`);
  return data.access_token;
}

export function buildFirstTouchMessage({ sender, to, subject, bodyText, unsubscribeUrl = null } = {}) {
  const fromName = headerSafe(sender?.from_name || 'Matthew McCluster');
  const fromEmail = headerSafe(sender?.from_email);
  const replyTo = headerSafe(sender?.reply_to || fromEmail);
  const address = headerSafe(to);
  const title = headerSafe(subject, 998);
  const body = bodySafe(bodyText);
  if (!fromEmail || !address || !title || !body) throw new Error('from, to, subject and body are required');

  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${address}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${title}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (unsubscribeUrl) {
    const url = headerSafe(unsubscribeUrl, 1000);
    if (url) headers.push(`List-Unsubscribe: <${url}>`);
  }
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

export async function gmailSendFirstTouch({ sender, to, subject, bodyText, unsubscribeUrl = null, env = process.env } = {}) {
  const token = await gmailAccessToken(env);
  const raw = base64url(buildFirstTouchMessage({ sender, to, subject, bodyText, unsubscribeUrl }));
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(data?.error?.message || `Gmail send failed: ${response.status}`);
  return { provider: 'gmail', id: data.id, threadId: data.threadId || null, labelIds: data.labelIds || [] };
}

export async function gmailThreadHasExternalReply({ threadId, senderEmail, sentAt, env = process.env } = {}) {
  if (!threadId) return false;
  const token = await gmailAccessToken(env);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Gmail thread lookup failed: ${response.status}`);
  const self = String(senderEmail || '').toLowerCase();
  const threshold = sentAt ? new Date(sentAt).getTime() : 0;
  return (data?.messages || []).some((message) => {
    const headers = Object.fromEntries((message.payload?.headers || []).map((entry) => [String(entry.name || '').toLowerCase(), String(entry.value || '')]));
    const from = String(headers.from || '').toLowerCase();
    const received = Number(message.internalDate || 0);
    return from && !from.includes(self) && (!threshold || received >= threshold);
  });
}
