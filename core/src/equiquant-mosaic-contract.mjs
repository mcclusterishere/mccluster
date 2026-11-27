export const MOSAIC_JOB = 'equiquant_mosaic_replay';
// Shared operator views cannot resolve a private project's members.
export const SHARED_JOB_FILTER = `neq.${MOSAIC_JOB}`;
export const MOSAIC_EXECUTOR = 'equiquant_mosaic_replay:v1';
export const MOSAIC_SOURCE = Object.freeze({
  dataset_doi: '10.1594/PANGAEA.958449',
  source_commit: '523112ddbcd2b9dfcc16891437f83a5781d045fb',
  observations_sha256: '6539910bd6218f85f8a2bd436ca73f544e722f2d207e8c6c3098d371c37f4c63',
});

// These are hashes of the rounded projections of the upstream validation table,
// independently of Core's refit. Each covers all four configurations and 52 folds.
const REFERENCE = Object.freeze({
  pooled: ['1ff244cbd378d568008aacb022beeddb4ddd3f56b1f1f8efdfdd7ddc56bfeddf', 0.3340546369],
  group_levels: ['2c92416ed00303e53775306edfb97e3fd3ff725ff580e8cdc34015401b27b782', 0.2529111721],
  group_slopes: ['b0fe5ad9536b8681eae1eb1f1aadcb4df8d4e020abd6d0bd99bfbe631d9f9fa6', 0.2556166798],
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function replaySelection(job) {
  const input = job?.input;
  if (job?.job_type !== MOSAIC_JOB || job.target_type !== 'equiquant_project' ||
      !UUID.test(job.target_id || '') || !UUID.test(job.org_id || '')) {
    throw new Error('Expected a workspace-scoped EquiQuant project replay');
  }
  if (!input || Array.isArray(input) || Object.keys(input).length !== 1 ||
      !Object.hasOwn(input, 'scenario') || typeof input.scenario !== 'string' ||
      !Object.hasOwn(REFERENCE, input.scenario)) {
    throw new Error('Expected a single allowlisted MOSAiC scenario');
  }
  const [resultSha256, heldOutMse] = REFERENCE[input.scenario];
  return { scenario: input.scenario, resultSha256, heldOutMse };
}
