/* Pipeline configuration. Everything comes from env; nothing here is a secret.
   Caps are clamped so env can lower them but never raise them past the agreed ceiling
   (150 a day total from mattmccluster@gmail.com, 50 per frame). */
export const FRAMES = Object.freeze({
  A: { key: 'A', label: 'student interview request', wealthFloor: true },
  B: { key: 'B', label: 'observation plus one question', wealthFloor: true },
  C: { key: 'C', label: 'power frame: one small help or intro', wealthFloor: false },
});
export const FRAME_KEYS = Object.freeze(Object.keys(FRAMES));
export const HARD_DAILY_CAP = 150;
export const HARD_FRAME_CAP = 50;
export const SEND_FROM = 'mattmccluster@gmail.com';
export const TIME_ZONE = 'America/New_York';
export const WEALTH_FLOOR_USD = 1_000_000;

const intEnv = (env, key, fallback) => {
  const n = Math.trunc(Number(env[key]));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env = process.env) {
  const dailyCap = Math.min(HARD_DAILY_CAP, intEnv(env, 'OUTREACH_DAILY_CAP', HARD_DAILY_CAP));
  const frameCap = Math.min(HARD_FRAME_CAP, intEnv(env, 'OUTREACH_FRAME_CAP', HARD_FRAME_CAP));
  return {
    enabled: String(env.OUTREACH_PIPELINE_ENABLED || '').trim().toLowerCase() === 'true',
    dailyCap,
    frameCap,
    /* drafts produced per run per frame; defaults to the frame cap, never above it */
    draftsPerFrame: Math.min(frameCap, intEnv(env, 'OUTREACH_DRAFTS_PER_FRAME', frameCap)),
    maxCandidatesPerRun: intEnv(env, 'OUTREACH_MAX_CANDIDATES_PER_RUN', 400),
    sendFrom: SEND_FROM,
    timeZone: TIME_ZONE,
    searchProvider: String(env.OUTREACH_SEARCH_PROVIDER || 'none').trim().toLowerCase(),
    searchApiKey: String(env.OUTREACH_SEARCH_API_KEY || ''),
    llm: {
      url: String(env.OUTREACH_LLM_URL || '').replace(/\/$/, ''),
      model: String(env.OUTREACH_LLM_MODEL || ''),
      apiKey: String(env.OUTREACH_LLM_API_KEY || ''),
    },
    embeddings: {
      url: String(env.OUTREACH_EMBED_URL || '').replace(/\/$/, ''),
      model: String(env.OUTREACH_EMBED_MODEL || ''),
      apiKey: String(env.OUTREACH_EMBED_API_KEY || ''),
    },
    historyDir: String(env.OUTREACH_HISTORY_DIR || ''),
    dataDir: String(env.OUTREACH_DATA_DIR || ''),
    store: String(env.OUTREACH_STORE || 'local').trim().toLowerCase(),
    userAgent: String(env.OUTREACH_USER_AGENT || 'McClusterOutreachResearch/0.1 (+https://mccluster.org; contact mattmccluster@gmail.com)'),
    signatureLines: String(env.OUTREACH_SIGNATURE_LINES || 'Matthew McCluster|Matthew|mattmccluster@gmail.com|Thanks|Thank you|Best|Best,|Thanks,|Matthew McCluster,')
      .split('|').map((s) => s.trim()).filter(Boolean),
  };
}

/* The calendar day a timestamp falls on in Matthew's zone, as YYYY-MM-DD. */
export function nyDay(at = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
