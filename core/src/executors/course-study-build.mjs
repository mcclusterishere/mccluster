import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { resultDigest } from '../completion-evidence.mjs';
import { selectChapters, verifyChapter, SOURCE_BYTE_LIMIT } from '../course-studio/chapters.mjs';
import { buildPractice } from '../course-studio/practice.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[<>]/.test(v);
function lost() { return Object.assign(new Error('Study build no longer owns the job'), { code: 'LEASE_LOST' }); }
function checkLease(signal) { if (signal?.aborted) throw lost(); }

// A retry after private finalization must acknowledge the stored bundle, not
// rebuild it against a potentially changed upstream source. Reject malformed
// private data rather than laundering it into a successful completion.
function receipt(bundle, chapters) {
  const urls = chapters.map(c => c.url);
  if (bundle?.version !== 1 || !Array.isArray(bundle.sources) || bundle.sources.length !== chapters.length ||
      !Array.isArray(bundle.brief) || bundle.brief.length !== 2 * chapters.length ||
      !Array.isArray(bundle.rounds) || bundle.rounds.length !== 4 * chapters.length ||
      !bundle.sources.every((s, i) => s && s.url === urls[i] && s.title === chapters[i].title &&
        sha256.test(s.sha256) && Number.isInteger(s.bytes) && s.bytes > 0 && s.bytes <= SOURCE_BYTE_LIMIT &&
        typeof s.checked_at === 'string' && Number.isFinite(Date.parse(s.checked_at))) ||
      !bundle.brief.every(b => text(b?.text) && urls.includes(b.source)) ||
      !bundle.rounds.every(r => text(r?.prompt) && text(r.explanation) && urls.includes(r.source) &&
        Number.isInteger(r.answer) && r.answer >= 0 && r.answer < 4 &&
        Array.isArray(r.choices) && r.choices.length === 4 && new Set(r.choices).size === 4 &&
        r.choices.every(v => typeof v === 'string' && /^-?\d{1,8}$/.test(v)))) {
    throw new Error('Study bundle has no verifiable receipt');
  }
  return { executor: 'course_study_build:v1', bundle_sha256: resultDigest(bundle),
    source_count: bundle.sources.length, brief_count: bundle.brief.length, round_count: bundle.rounds.length };
}

export async function courseStudyBuild(job, {
  query = rest, resolveOrg = resolveHouseOrgId, fetchImpl = globalThis.fetch, signal, now,
} = {}) {
  if (job?.job_type !== 'course_study_build' || job.target_type !== 'private_study_course' ||
      !uuid.test(job.target_id) || !uuid.test(job.id) || !uuid.test(job.org_id) ||
      job.status !== 'running' || !Number.isSafeInteger(job.attempts) || job.attempts < 1 ||
      typeof job.locked_by !== 'string' || !job.locked_by ||
      !job.input || typeof job.input !== 'object' || Array.isArray(job.input) || Object.keys(job.input).length) {
    throw new Error('Invalid private study job');
  }
  checkLease(signal);
  let house;
  try { house = await resolveOrg(); } catch { throw new Error('Study authority unavailable'); }
  if (job.org_id !== house) throw new Error('Study job outside Core authority');
  const params = new URLSearchParams({
    id: `eq.${job.target_id}`, job_id: `eq.${job.id}`, select: 'id,job_id,source_urls,bundle', limit: '1',
  });
  const db = async (path, options) => {
    checkLease(signal);
    const timeout = AbortSignal.timeout(10000);
    try { return await query(path, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
    catch { checkLease(signal); throw new Error('Private study storage unavailable'); }
  };
  const { body } = await db(`learning_studio_courses?${params}`);
  const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
  if (!row || row.id !== job.target_id || row.job_id !== job.id) throw new Error('Private study request unavailable');
  const chapters = selectChapters(row.source_urls);
  checkLease(signal);
  if (row.bundle !== null) return receipt(row.bundle, chapters);
  const sources = [];
  for (const c of chapters) {
    checkLease(signal);
    sources.push(await verifyChapter(c.url, { fetchImpl, signal, now }));
  }
  const bundle = buildPractice(row.id, sources);
  const result = receipt(bundle, chapters);
  const { body: saved } = await db('rpc/learning_studio_finish', {
    method: 'POST',
    body: JSON.stringify({ p_course: row.id, p_job: job.id, p_worker: job.locked_by, p_attempt: job.attempts, p_bundle: bundle }),
  });
  if (saved === false) throw lost();
  if (saved !== true) throw new Error('Private study persistence not confirmed');
  checkLease(signal);
  return result;
}
