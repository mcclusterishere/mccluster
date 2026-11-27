export const MOSAIC_JOB = 'equiquant_mosaic_replay';
// Shared operator views cannot resolve a private project's members.
export const SHARED_JOB_FILTER = `neq.${MOSAIC_JOB}`;
export const MOSAIC_EXECUTOR = 'equiquant_mosaic_replay:v1';
export const MOSAIC_SOURCE = Object.freeze({
  dataset_doi: '10.1594/PANGAEA.958449',
  source_commit: '523112ddbcd2b9dfcc16891437f83a5781d045fb',
  observations_sha256: '6539910bd6218f85f8a2bd436ca73f544e722f2d207e8c6c3098d371c37f4c63',
});

export const MOSAIC_CODE_SHA256 = '52ad9f8d364159868b83532e1f811d92653a8e2ae199d791d28119592ac9b21e';
export const MOSAIC_SPEC_SHA256 = 'f12502819b7a9769ea22ae6c0bbfc079b669b3cb4ede2c55513ae7bb3a53be62';
export const MOSAIC_MODEL_HASHES = Object.freeze({
  "pooled": "5374cae4064179f0e65f0c5874220129955c426677bc6084fe0250d61e418ed2",
  "group_levels": "6e22a780cfd26067de53d7df5cde9ab74f56db5c93ebf01b66eb6939440eaf1b",
  "group_slopes": "f7bcc64b96eb31dcf31ed0e6c0ab73374b5c7c4da69b9d1eefa84808f5b28f9c"
});
export const MOSAIC_SPEC = Object.freeze({
  version: 'equiquant-mosaic/v2', code_sha256: MOSAIC_CODE_SHA256, model_hashes: MOSAIC_MODEL_HASHES,
  ...MOSAIC_SOURCE, precision: 'binary64', timing: 'monotonic_refit_all_folds_ns',
});

// These are hashes of the rounded projections of the upstream validation table,
// independently of Core's refit. Each covers all four configurations and 52 folds.
const REFERENCE = Object.freeze({
  pooled: ['1ff244cbd378d568008aacb022beeddb4ddd3f56b1f1f8efdfdd7ddc56bfeddf', 0.3340546369],
  group_levels: ['2c92416ed00303e53775306edfb97e3fd3ff725ff580e8cdc34015401b27b782', 0.2529111721],
  group_slopes: ['b0fe5ad9536b8681eae1eb1f1aadcb4df8d4e020abd6d0bd99bfbe631d9f9fa6', 0.2556166798],
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function mosaicReference(scenario) {
  if (typeof scenario !== 'string' || !Object.hasOwn(REFERENCE, scenario)) {
    throw new Error('Expected an allowlisted MOSAiC scenario');
  }
  const [resultSha256, heldOutMse] = REFERENCE[scenario];
  return { resultSha256, heldOutMse };
}

export function replaySelection(job) {
  const input = job?.input;
  if (job?.job_type !== MOSAIC_JOB || job.target_type !== 'equiquant_project' ||
      !UUID.test(job.target_id || '') || !UUID.test(job.org_id || '')) {
    throw new Error('Expected a workspace-scoped EquiQuant project replay');
  }
  if (!input || Array.isArray(input) || !Object.hasOwn(input, 'scenario')) {
    throw new Error('Expected a single allowlisted MOSAiC scenario');
  }
  const reference = mosaicReference(input.scenario);
  const keys = Object.keys(input);
  if (keys.length === 1) return { scenario: input.scenario, ...reference }; // initial receipt format
  if (keys.length !== 4 || typeof input.node_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.node_version) || !['prime', 'ovh_core'].includes(input.target) ||
      typeof input.hardware_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.hardware_sha256)) {
    throw new Error('Expected an allowlisted MOSAiC execution target and hardware fingerprint');
  }
  return { scenario: input.scenario, target: input.target, hardwareSha256: input.hardware_sha256, ...reference };
}
