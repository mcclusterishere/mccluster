const SUCCESS_NOTIFY_TYPES = new Set([
  'code_patch',
  'game_media_collect',
  'game_branch_smoke',
  'game_release_decision',
  'preview_deploy',
]);

function smsEnabled() {
  return !['0', 'false', 'off', 'no'].includes(String(process.env.MCCLUSTER_SMS_NOTIFY || 'true').toLowerCase());
}

function requiredTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const apiKey = process.env.TWILIO_API_KEY || '';
  const apiSecret = process.env.TWILIO_API_SECRET || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_FROM || '';
  const to = process.env.MCCLUSTER_PHONE || '';
  const username = apiKey || accountSid;
  const password = apiKey ? apiSecret : authToken;
  if (!accountSid || !username || !password || !from || !to) return null;
  return { accountSid, username, password, from, to, authMode: apiKey ? 'api_key' : 'auth_token' };
}

function compact(value, max = 260) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function successMessage(job, output = {}) {
  const summary = compact(output?.summary || output?.state || output?.executor || 'completed');
  if (job.job_type === 'game_media_collect') return `McCluster: PRIM3 assets are ready for your review. ${summary}`;
  if (job.job_type === 'game_branch_smoke') return `McCluster: PRIM3 implementation validation finished. ${summary}`;
  if (job.job_type === 'game_release_decision') return `McCluster: PRIM3 release decision processed. ${summary}`;
  if (job.job_type === 'preview_deploy') return `McCluster: preview deployment finished. ${summary}`;
  if (job.job_type === 'code_patch') return `McCluster: autonomous code work finished and is ready for review. ${summary}`;
  return `McCluster: ${job.job_type} completed. ${summary}`;
}

export async function sendSms(message) {
  if (!smsEnabled()) return { sent: false, reason: 'sms_disabled' };
  const cfg = requiredTwilio();
  if (!cfg) return { sent: false, reason: 'twilio_not_configured' };

  const body = new URLSearchParams({
    To: cfg.to,
    From: cfg.from,
    Body: compact(message, 1200),
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Twilio returned ${response.status}`);
  return { sent: true, sid: data?.sid || null, status: data?.status || null, auth_mode: cfg.authMode };
}

export async function notifyJobSuccess(job, output) {
  const explicit = job?.input?.notify_owner === true;
  if (!explicit && !SUCCESS_NOTIFY_TYPES.has(job?.job_type)) return { sent: false, reason: 'not_routable' };
  return sendSms(successMessage(job, output));
}

export async function notifyJobFailure(job, error, status = 'failed') {
  if (status !== 'failed') return { sent: false, reason: 'retry_pending' };
  const message = compact(error?.message || error || 'unknown failure', 500);
  return sendSms(`McCluster ALERT: ${job?.job_type || 'job'} failed after retries. ${message}`);
}
