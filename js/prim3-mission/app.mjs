import { storedToken, SESSION_KEY } from '../owner-only.mjs';
import { createPracticeClient } from './client.mjs';
const $ = id => document.getElementById(id);
const client = createPracticeClient({ token: () => storedToken() });
let available = false, working = false, returned = false;
const message = text => { $('pmFeedback').textContent = text; };
function render() {
  const s = client.current, flow = s?.flow;
  $('pmOwner').hidden = Boolean(s);
  $('pmBrief').hidden = flow?.phase !== 'brief';
  $('pmTactical').hidden = flow?.phase !== 'play' || returned;
  $('pmPlay').hidden = flow?.phase !== 'play' || !flow.tacticalHandoff || !returned;
  $('pmDebrief').hidden = flow?.phase !== 'debrief';
  $('pmHandoff').hidden = Boolean(flow?.tacticalHandoff);
  $('pmLaunch').hidden = !flow?.tacticalHandoff;
  $('pmRetry').hidden = !client.pending;
  for (const b of document.querySelectorAll('.pm button')) b.disabled = working || (client.pending && b.id !== 'pmRetry');
  $('pmRelease').disabled ||= !available;
  if (!flow) return;
  $('pmBriefText').textContent = flow.brief;
  $('pmLevel').textContent = `Practice level ${flow.level} of 3 · expires ${new Date(flow.mission.expiresAt).toLocaleString()}`;
  $('pmQuestion').textContent = flow.question?.prompt || '';
  for (const b of $('pmForm').querySelectorAll('button')) b.disabled ||= client.mustFinish;
  $('pmHint').disabled ||= client.mustAnswer;
  $('pmAnswer').disabled = working || client.pending || client.mustFinish;
  if (client.mustFinish) $('pmLevel').textContent += ' · Practice limit reached. Save your debrief.';
  else if (client.mustAnswer) $('pmLevel').textContent += ' · Answer this checkpoint, then save your debrief.';
  $('pmFinish').disabled ||= flow.debrief.attempts === 0;
  $('pmSummary').textContent = `${flow.debrief.correct} of ${flow.debrief.attempts} answers correct; ${flow.debrief.independent} without hints. Tactical outcome: ${flow.debrief.gameOutcome || 'not reported'} (learner-reported). ${flow.debrief.label} Evidence session: ${s.session_id}.`;
  $('pmNext').textContent = flow.debrief.nextStep;
}
async function run(fn) {
  if (working) return; working = true; render();
  try { const out = await fn(); const r = out?.result;
    if (r?.hint) message(r.hint);
    else if (typeof r?.correct === 'boolean') message(`${r.correct ? 'Correct.' : 'Review the explanation.'} ${r.feedback}\n${r.independent ? 'Independent answer recorded.' : 'Practice recorded with scaffolding or an incorrect response.'}`);
    else message(out?.flow?.phase === 'debrief' ? 'Debrief saved to your learning evidence.' : 'Saved. Continue when ready.');
  } catch (e) { message(`${e.message}${client.pending ? ' Your pending request is retained; retry before another action.' : ''}`); }
  finally { working = false; render(); }
}
$('pmRelease').onclick = () => run(() => client.start({ fictionChecked: $('pmFiction').checked, geographyChecked: $('pmGeography').checked }));
$('pmBegin').onclick = () => run(() => client.submit('begin'));
$('pmHandoff').onclick = () => run(() => client.submit('handoff'));
$('pmReturn').onclick = () => { returned = true; render(); };
$('pmHint').onclick = () => run(() => client.submit('hint'));
$('pmForm').onsubmit = e => { e.preventDefault(); void run(async () => { const r = await client.submit('answer', { answer: $('pmAnswer').value }); $('pmAnswer').value = ''; return r; }); };
$('pmFinish').onclick = () => run(() => client.submit('finish', { outcome: $('pmOutcome').value }));
$('pmRetry').onclick = () => run(() => client.retry());
function accountChanged() { client.clear(); document.querySelector('.pm').hidden = true; }
window.addEventListener('mcc:auth-changed', accountChanged);
window.addEventListener('storage', e => { if (e.key === SESSION_KEY || e.key === null) accountChanged(); });
try { const { config } = await client.connect(); available = config.enabled;
  $('pmConfig').textContent = available ? 'Owner-only practice service ready.' : 'This integration is disabled until the owner configures the practice service.';
  message(client.pending ? 'A request is pending. Retry it to recover the original receipt.' : client.current ? 'Your practice session was restored.' : available ? 'Complete owner review before release.' : 'Service disabled. No learning record has been written.');
} catch (e) { message(e.message); }
render();
