import { buildRecastPlan, transitionJob } from '/lib/recast-contract.mjs';

const $ = (id) => document.getElementById(id);
let source = null, character = null, currentPlan = null, job = null, revision = 0, timer = null;
let sourceUrl = null, characterUrl = null;
const notes = {
  'fal-h3-max-recast': 'Hosted API candidate. Commercial service terms and account eligibility must be cleared before launch.',
  'wan22-animate-selfhost': 'Open-weight candidate under Apache 2.0. GPU, preprocessing dependencies, identity quality and costs are not yet verified.',
  'openjutsu-h3-selfhost': 'Blocked: the default MiniMax H3 license excludes US use. A separate license is required. The MIT app license does not override model terms.',
};
function status(message) { $('form-status').textContent = message; }
function stopTimer() { if (timer) clearTimeout(timer); timer = null; }
function invalidate(message = 'Settings changed. Build a new plan before simulating.') {
  revision += 1; stopTimer(); currentPlan = null; job = null;
  $('take-card').hidden = true; $('take-empty').hidden = false;
  $('cancel-button').disabled = true; $('simulate-button').disabled = false;
  status(message); updateEstimate();
}
function clearAttestations() {
  for (const id of ['rights-footage', 'rights-likeness', 'rights-sharing', 'shot-check']) $(id).checked = false;
}
function updateEstimate() {
  const renderer = $('renderer').value, seconds = Number($('duration').value);
  const rate = $('resolution').value === '1080P' ? .45 : .30;
  $('renderer-note').textContent = notes[renderer];
  if (renderer !== 'fal-h3-max-recast') {
    $('estimate').textContent = renderer === 'openjutsu-h3-selfhost' ? 'License blocked' : 'Not benchmarked';
    $('estimate-note').textContent = 'No live renderer, GPU allocation or charge. A verified license and hardware benchmark are required.';
  } else {
    $('estimate').textContent = Number.isFinite(seconds) && seconds > 0 ? `$${(Math.ceil(seconds * rate * 100) / 100).toFixed(2)} / take` : 'Choose a length';
    $('estimate-note').textContent = `${seconds || 0} seconds × $${rate.toFixed(2)}. Taxes, retries and storage excluded. No charge in this preview.`;
  }
}
function displayJob(description) {
  $('job-state').textContent = job.state[0].toUpperCase() + job.state.slice(1);
  $('job-description').textContent = description;
  const completed = { ready: 1, queued: 2, running: 3, succeeded: 4, canceled: 1 }[job.state] || 1;
  ['plan', 'queue', 'render', 'review'].forEach((s, i) => $('progress-' + s).classList.toggle('done', i < completed));
}
$('replace-source').addEventListener('click', () => $('source-input').click());
$('source-input').addEventListener('change', () => {
  const file = $('source-input').files[0]; if (!file) return;
  clearAttestations(); invalidate('Reading the local video. Nothing leaves this device.'); source = null;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  $('source-preview').hidden = true; $('source-empty').hidden = false;
  $('source-status').textContent = 'Checking clip';
  if (file.size > 512 * 1024 * 1024 || !/\.(mp4|mov|webm)$/i.test(file.name)) {
    $('source-status').textContent = 'Clip rejected'; return status('Choose MP4, MOV or WebM video below 512 MB.');
  }
  const url = URL.createObjectURL(file); sourceUrl = url;
  const video = $('source-preview');
  video.onloadedmetadata = () => {
    if (sourceUrl !== url) return;
    if (!Number.isFinite(video.duration) || video.duration < 5) { $('source-status').textContent = 'Clip too short'; return status('The source needs at least 5 seconds of playable video.'); }
    source = { id: 'local-video-' + crypto.randomUUID(), seconds: video.duration, size: file.size };
    $('duration').value = Math.min(10, Math.floor(video.duration * 10) / 10); $('start').value = 0;
    $('source-name').textContent = `${file.name} · ${video.duration.toFixed(1)}s · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    $('source-status').textContent = 'Local clip ready'; video.hidden = false; $('source-empty').hidden = true;
    updateEstimate(); status('Clip stays on your device. Add a character and confirm the planning checks.');
  };
  video.onerror = () => { if (sourceUrl === url) { source = null; $('source-status').textContent = 'Preview unavailable'; status('This browser cannot play that file. Try an H.264 MP4.'); } };
  video.src = url;
});
$('character-input').addEventListener('change', () => {
  const file = $('character-input').files[0]; if (!file) return;
  clearAttestations(); invalidate('Reading the local reference photo.'); character = null;
  if (characterUrl) URL.revokeObjectURL(characterUrl);
  $('character-preview').hidden = true; $('character-empty').hidden = false;
  if (file.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return status('Choose a JPEG, PNG or WebP image below 20 MB.');
  const url = URL.createObjectURL(file); characterUrl = url;
  $('character-preview').onload = () => {
    if (characterUrl !== url) return;
    character = { id: 'local-character-' + crypto.randomUUID(), size: file.size };
    $('character-preview').hidden = false; $('character-empty').hidden = true; $('character-name').textContent = file.name;
    status('Reference is ready. These files are still local; no provider has received them.');
  };
  $('character-preview').onerror = () => { character = null; status('That photo could not be decoded. Try another image.'); };
  $('character-preview').src = url;
});
for (const id of ['start', 'duration', 'fps', 'budget', 'character-label', 'direction', 'rights-footage', 'rights-likeness', 'rights-sharing', 'shot-check', 'resolution']) {
  $(id).addEventListener('input', () => invalidate());
}
$('renderer').addEventListener('change', () => {
  $('rights-sharing').checked = false;
  const wan = $('renderer').value === 'wan22-animate-selfhost';
  $('resolution').replaceChildren(...(wan ? [['480P', '480p · GPU candidate'], ['720P', '720p · GPU candidate']] : [['768P', '768p · test takes'], ['1080P', '1080p · final takes']]).map(([value, label]) => new Option(label, value)));
  invalidate('Renderer changed. Review its license and renew the provider-sharing planning check.');
});
$('plan-button').addEventListener('click', async () => {
  if (!source || !character) return status('Choose both a playable source video and a character photo first.');
  const start = Number($('start').value), seconds = Number($('duration').value);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(seconds) || start + seconds > source.seconds + .01) return status('The selected in point and take length must fit inside your source video.');
  if (!$('shot-check').checked) return status('Review the selected footage and confirm that no shot exceeds 15 seconds.');
  const myRevision = revision;
  $('plan-button').disabled = true;
  try {
    const plan = await buildRecastPlan({
      orgId: 'prototype-local', operationId: 'prototype-' + crypto.randomUUID(),
      sourceVideo: { id: source.id, seconds: source.seconds, fps: Number($('fps').value) }, characterReferences: [{ id: character.id }],
      provider: $('renderer').value, resolution: $('resolution').value, budgetUsd: Number($('budget').value), territory: 'US',
      editorial: { startSeconds: start, durationSeconds: seconds, characterLabel: $('character-label').value, direction: $('direction').value },
      attestations: { footageRights: $('rights-footage').checked, likenessConsent: $('rights-likeness').checked, providerSharing: $('rights-sharing').checked },
    });
    if (revision !== myRevision) return;
    if (plan.errors?.length) return status(plan.errors.map(e => typeof e === 'string' ? e : e.message || e.code).join(' '));
    currentPlan = { ...plan, previewOnly: true, metadataVerification: 'Local preview metadata and user-entered FPS. Server verification is required.', output: null };
    job = { state: 'ready', orgId: plan.orgId, operationId: plan.operationId, planHash: plan.planHash };
    $('take-card').hidden = false; $('take-empty').hidden = true;
    $('take-name').textContent = `${$('character-label').value.trim() || 'Character'} · Take 01`;
    $('provenance').textContent = JSON.stringify(currentPlan, null, 2);
    displayJob('Plan prepared locally. No renderer called. Simulate the workflow to inspect its states.');
    status('Plan built. Live rendering stays disabled until provider, licensing, media permissions and backend launch checks pass.');
  } catch (error) { status(error.message || 'Could not build the plan.'); }
  finally { $('plan-button').disabled = false; }
});
$('simulate-button').addEventListener('click', () => {
  if (!job || job.state !== 'ready') return;
  job = transitionJob(job, 'queued'); $('simulate-button').disabled = true; $('cancel-button').disabled = false;
  displayJob('Simulation only: a future real job would now be accepted by the canonical media queue.');
  timer = setTimeout(() => {
    job = transitionJob(job, 'running'); displayJob('Simulation only: showing progress. No GPU is working and no video is being generated.');
    timer = setTimeout(() => {
      job = transitionJob(job, 'succeeded', { outcomeVerified: true });
      displayJob('Simulation completed. No generated output exists. Real identity, motion and audio quality remain untested.');
      $('job-state').textContent = 'Simulation complete'; $('cancel-button').disabled = true; timer = null;
    }, 1300);
  }, 900);
});
$('cancel-button').addEventListener('click', () => {
  if (!job || !['queued', 'running'].includes(job.state)) return;
  stopTimer(); job = transitionJob(job, 'canceled', { outcomeVerified: true });
  displayJob('Local simulation canceled. No upload or charge occurred. Build a new plan to simulate again.'); $('cancel-button').disabled = true;
});
$('export-button').addEventListener('click', () => {
  if (!currentPlan) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentPlan, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'recast-plan-preview.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('reset-button').addEventListener('click', () => {
  source = null; character = null; clearAttestations(); invalidate('Preview reset. No files were uploaded or saved by this app.');
  $('source-preview').onloadedmetadata = null; $('source-preview').onerror = null;
  $('character-preview').onload = null; $('character-preview').onerror = null;
  $('source-preview').pause(); $('source-preview').removeAttribute('src'); $('source-preview').load();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (characterUrl) URL.revokeObjectURL(characterUrl);
  sourceUrl = null; characterUrl = null; $('source-input').value = ''; $('character-input').value = '';
  $('source-preview').hidden = true; $('source-empty').hidden = false; $('character-preview').hidden = true; $('character-empty').hidden = false;
  $('character-preview').removeAttribute('src'); $('source-name').textContent = 'MP4, MOV or WebM · local preview only'; $('source-status').textContent = 'No clip selected'; $('character-name').textContent = 'JPEG, PNG or WebP';
});
window.addEventListener('pagehide', () => { stopTimer(); if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (characterUrl) URL.revokeObjectURL(characterUrl); });
updateEstimate();
