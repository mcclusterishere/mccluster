function requiredTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_FROM || '';
  const to = process.env.MCCLUSTER_PHONE || '';
  if (!accountSid || !authToken || !from || !to) return null;
  return { accountSid, authToken, from, to };
}

export async function sendSms(message) {
  const cfg = requiredTwilio();
  if (!cfg) return { sent: false, reason: 'twilio_not_configured' };

  const body = new URLSearchParams({
    To: cfg.to,
    From: cfg.from,
    Body: String(message || '').slice(0, 1500),
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Twilio returned ${response.status}`);
  return { sent: true, sid: data?.sid || null, status: data?.status || null };
}
