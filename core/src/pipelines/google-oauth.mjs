// Exchange a stored Google OAuth refresh token for a short-lived access token. Nothing is cached on disk.
export async function googleAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(new Error('Google OAuth client id, client secret and refresh token are required'), { code: 'GOOGLE_OAUTH_MISSING' });
  }
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never echo the token response; it can carry credentials.
    throw Object.assign(new Error(`Google token exchange failed (${res.status}${body.error ? `: ${body.error}` : ''})`), { code: 'GOOGLE_OAUTH_FAILED' });
  }
  return body.access_token;
}

export async function googleGet(url, token, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google API ${res.status}${body?.error?.status ? ` ${body.error.status}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return body;
}
