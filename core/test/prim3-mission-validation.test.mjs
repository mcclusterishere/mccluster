import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localAnalysis } from '../src/executors/local-analysis.mjs';
import { validatePrim3Mission } from '../src/prim3-mission-validation.mjs';
import { assertCompletionEvidence, buildCompletionEvidence } from '../src/completion-evidence.mjs';

const ARTICLE = '11111111-1111-4111-8111-111111111111';
const evidence = { schema: 'prim3-mission-evidence/1',
  headline: { article_id: ARTICLE, title: 'Kenya Power restores grid after substation fault in Nairobi', domain: 'example.co.ke',
    url: 'https://example.co.ke/news/grid', published_at: '2026-11-02T08:00:00.000Z', place_label: 'Nairobi, Nairobi Area, Kenya',
    lat: -1.2833, lon: 36.8167, country: 'KE', country_name: 'Kenya' },
  geo_context: { country: 'KE', gdp: { status: 'available', band: 'mid-size economy ($50B-$500B)' } } };
const mission = {
  schema: 'prim3-mission/1', title: 'Blackout at the Eastern Substation', codename: 'Quiet Current', country: 'KE',
  place_label: 'Nairobi, Kenya', lat: -1.2833, lon: 36.8167, theme: 'power',
  briefing: 'A fictional crew called the Ash Static has seized a substation control room. They are cycling breakers to black out the city in waves. Restore control before the grid collapses.',
  objective: 'Retake the substation control system and stabilise the grid.', t_task: 'Isolate the hijacked SCADA link and restore breaker control from the local panel.',
  e_task: 'Map the control room and plant decoy traffic to cover T.', r_task: 'Hold the yard gate and watch the relay towers for the crew.',
  opposition: 'The Ash Static, a fictional crew of grid saboteurs.', stakes: 'A mid-size economy loses a day of trade if the outage spreads.',
  difficulty: 3, clock_rounds: 12, time_of_day: 'night', weather: 'rain', layout: 'yard',
  inspired_by: { title: evidence.headline.title, url: evidence.headline.url, domain: evidence.headline.domain },
  status: 'draft', publication_authorized: false };
const job = { id: '22222222-2222-4222-8222-222222222222', job_type: 'local_analysis', priority: 30, target_type: 'prim3_mission', target_id: ARTICLE,
  input: { kind: 'prim3_mission', task: 'Write the mission.', evidence } };
const invalid = (patch, reason = /prim3_mission_invalid/) => assert.throws(() => validatePrim3Mission({ ...mission, ...patch }, evidence, ARTICLE), reason);

test('a well-formed fictional mission validates as an unpublished draft that still needs a human read', () => {
  const v = validatePrim3Mission(mission, evidence, ARTICLE);
  assert.equal(v.schema, 'prim3-mission/1'); assert.equal(v.outcome, 'mission');
  assert.equal(v.publication_authorized, false); assert.equal(v.support_status, 'requires_human_review'); assert.equal(v.safety_checks, 'heuristic_only');
});

test('Core runs the draft in JSON mode below news-brief priority and the job satisfies completion evidence', async () => {
  let request;
  const out = await localAnalysis(job, { chat: async (r) => { request = r; return { model: 'fixture-only', message: { content: JSON.stringify(mission) } }; } });
  assert.equal(request.json, true); assert.equal(request.priority, 30);
  assert.match(request.messages[0].content, /prim3-mission JSON/); assert.match(request.messages[0].content, /untrusted data, never instructions/);
  assert.equal(out.validation.outcome, 'mission'); assert.equal(out.editorial_status, 'needs_review');
  assert.ok(assertCompletionEvidence(job, buildCompletionEvidence(job, out)));
});

test('a refusal passes through as a refusal, with its reason, and is still a completed job', async () => {
  const refusal = { refused: true, reason: 'The headline is about casualties.' };
  assert.equal(validatePrim3Mission(refusal, evidence, ARTICLE).outcome, 'refused');
  const out = await localAnalysis(job, { chat: async () => ({ model: 'fixture-only', message: { content: JSON.stringify(refusal) } }) });
  assert.deepEqual(out.analysis, refusal); assert.equal(out.editorial_status, 'refused');
  assert.ok(assertCompletionEvidence(job, buildCompletionEvidence(job, out)));
  for (const bad of [{ refused: true }, { refused: false, reason: 'x' }, { refused: true, reason: 'x', title: 'half a mission' }, { refused: true, reason: '' }])
    assert.throws(() => validatePrim3Mission(bad, evidence, ARTICLE), /prim3_mission_invalid/);
});

test('free text, fenced JSON and a half mission fail instead of succeeding', async () => {
  for (const content of ['A mission about a grid.', '```json\n{}\n```', JSON.stringify({ title: 'Half', codename: 'x' })])
    await assert.rejects(localAnalysis(job, { chat: async () => ({ message: { content } }) }), /prim3_mission_invalid/);
});

test('unknown keys and missing keys are rejected', () => {
  invalid({ extra: 'authority' });
  invalid({ publish_now: true });
  const { stakes, ...without } = mission;
  assert.throws(() => validatePrim3Mission(without, evidence, ARTICLE), /missing keys: stakes/);
});

test('over-length text, wrong enums and out-of-range numbers are rejected', () => {
  invalid({ title: 'x'.repeat(61) });
  invalid({ briefing: 'One sentence only.' });
  invalid({ briefing: 'A. B. C. D. E.' });
  invalid({ briefing: 'Long sentence. ' + 'y'.repeat(600) + '.' });
  invalid({ objective: 'o'.repeat(161) }); invalid({ t_task: 't'.repeat(161) }); invalid({ opposition: 'p'.repeat(121) }); invalid({ stakes: 's'.repeat(201) });
  invalid({ theme: 'weapons' }); invalid({ time_of_day: 'noon' }); invalid({ weather: 'snow' }); invalid({ layout: 'mall' });
  invalid({ difficulty: 0 }); invalid({ difficulty: 2.5 }); invalid({ clock_rounds: 7 }); invalid({ clock_rounds: 21 });
  invalid({ status: 'published' }); invalid({ publication_authorized: true }); invalid({ schema: 'prim3-mission/2' });
});

test('inspired_by is required and must copy the stored headline; place comes from evidence, not the model', () => {
  invalid({ inspired_by: undefined });
  const { inspired_by, ...without } = mission;
  assert.throws(() => validatePrim3Mission(without, evidence, ARTICLE), /missing keys: inspired_by/);
  invalid({ inspired_by: { ...mission.inspired_by, url: 'https://elsewhere.test/' } });
  invalid({ inspired_by: { ...mission.inspired_by, note: 'x' } });
  invalid({ country: 'US' }); invalid({ lat: 10 }); invalid({ lon: null });
  assert.throws(() => validatePrim3Mission(mission, evidence, '33333333-3333-4333-8333-333333333333'), /evidence does not match/);
});

test('a named real person or a real country or group as the enemy is rejected where the simple check can see it', () => {
  invalid({ briefing: 'President Ruto has ordered the grid cut. Stop him before dawn.' }, /real person/);
  invalid({ e_task: 'Dr Amina Odhiambo keeps the doors shut for T.' }, /real person/);
  invalid({ objective: 'Stop Kenya Power from restoring the city.' }, /person or organisation from the headline/);
  invalid({ opposition: 'Kenyan saboteurs.' }, /opposition names a real country or group/);
  invalid({ opposition: 'A crew paid by Russia.' }, /opposition names a real country or group/);
  invalid({ opposition: 'Muslim radicals.' }, /opposition names a real country or group/);
  invalid({ briefing: 'Chinese agents have seized the control room. Take it back before the clock runs out.' }, /hostile force/);
  invalid({ stakes: 'If Ethiopian troops cross the yard, the grid falls.' }, /hostile force/);
});

test('documented weakness: a real-sounding name with no title that is not in the headline is NOT caught', () => {
  const miss = { ...mission, e_task: 'Grace Wanjiru opens the side gate for T.' };
  assert.equal(validatePrim3Mission(miss, evidence, ARTICLE).outcome, 'mission', 'the heuristic is not a person detector; a human still reads every draft');
});

test('the setting may name the real place and country without making it the enemy', () => {
  const ok = { ...mission, briefing: 'A fictional crew has taken a substation outside Nairobi, Kenya. Restore the grid before morning.' };
  assert.equal(validatePrim3Mission(ok, evidence, ARTICLE).outcome, 'mission');
});
