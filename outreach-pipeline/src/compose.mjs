/* Compose one letter per person from their own research. There is no template: the model gets the facts,
   the frame's rules, and the openings already used, and every result is checked before it can be queued.
   A letter that fails any check is retried with the reasons; after maxAttempts it is dropped, never forced. */
import { frameViolations, dashViolations } from './text-rules.mjs';
import { guard } from './similarity.mjs';

export const SENDER_PROFILE = Object.freeze({
  name: 'Matthew McCluster',
  email: 'mattmccluster@gmail.com',
  facts: [
    'first year Computer Science student at Southern Connecticut State University',
    'founder of McCluster Corp, building a job and agent platform on his own',
    'also runs Equity Uprise, a civic fellowship platform',
  ],
});

const FRAME_BRIEF = {
  A: 'Frame A, student interview request. Say plainly he is a student. Tie one specific thing this person did recently to what he is building. Ask for a short conversation or a few questions by email. Warm, specific, no flattery.',
  B: 'Frame B, observation plus one question. One sharp, specific observation about something this person recently did, then exactly one question only they could answer. No pitch. Do not say he is a student, do not name his projects, do not ask for a call. Four to six sentences.',
  C: 'Frame C, power frame. This person has leverage (executive, gatekeeper, connector, operator). Ask for one small, concrete piece of help or one introduction that fits their exact role. Say in a sentence who he is. Short.',
};

export function buildPrompt({ person, frame, hooks, avoidOpenings = [], feedback = [] }) {
  return [
    `Write one cold email from ${SENDER_PROFILE.name} to ${person.name} (${person.role || ''}${person.organization ? `, ${person.organization}` : ''}).`,
    FRAME_BRIEF[frame],
    `About the sender (use only what fits the frame): ${SENDER_PROFILE.facts.join('; ')}.`,
    'Ground the letter in these sourced facts about the recipient. Use at least one of them by name and do not invent anything else:',
    ...hooks.map((h, i) => `[${i + 1}] ${h.title} (${h.year}) ${h.url}\n${h.excerpt.slice(0, 600)}`),
    'Hard rules: no dash characters of any kind, including hyphens in compound words (write "one third", "cofounder", "follow up"). No generic praise. No line that could be pasted into a letter to someone else. Under 180 words. Sign off with just his name.',
    avoidOpenings.length ? `Do not open like any of these earlier letters: ${avoidOpenings.slice(-40).map((o) => `"${o}"`).join('; ')}` : '',
    feedback.length ? `Your last attempt was rejected for: ${feedback.join('; ')}. Write a genuinely different letter.` : '',
    'Return JSON: {"subject":"...","body":"..."}',
  ].filter(Boolean).join('\n\n');
}

const STOP = new Set('about after again their there these those which would could should where while being between because before through during other first years still since under people company'.split(' '));
export function groundedInHooks(body, hooks) {
  const text = String(body).toLowerCase();
  for (const h of hooks) {
    const tokens = `${h.title} ${h.excerpt.slice(0, 400)}`.match(/\b[A-Za-z][A-Za-z']{4,}\b/g) || [];
    const distinct = [...new Set(tokens.map((t) => t.toLowerCase()))].filter((t) => !STOP.has(t));
    const hits = distinct.filter((t) => text.includes(t));
    if (hits.length >= 2) return { ok: true, hook: h.url, matched: hits.slice(0, 6) };
  }
  return { ok: false };
}

export function checkLetter({ letter, frame, hooks, historyFingerprints, signatureLines, embedding = null }) {
  const problems = [...frameViolations(frame, letter)];
  const grounding = groundedInHooks(letter.body, hooks);
  if (!grounding.ok) problems.push('letter does not use any sourced recent activity');
  const sim = guard({ ...letter, embedding }, historyFingerprints, { signatureLines });
  if (!sim.ok) problems.push(...sim.violations.flatMap((v) => v.reasons.map((r) => `too close to an earlier letter (${r.rule})`)));
  return { ok: problems.length === 0, problems: [...new Set(problems)], grounding, similarity: { ok: sim.ok, worst: sim.worst, violations: sim.violations, checkedAgainst: sim.checkedAgainst }, fingerprint: sim.fingerprint };
}

/* composer: async ({ prompt, person, frame, hooks, attempt }) => { subject, body } */
export async function composeLetter({ person, frame, hooks, composer, historyFingerprints, avoidOpenings, signatureLines, embed = null, maxAttempts = 3 }) {
  const feedback = [];
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = buildPrompt({ person, frame, hooks, avoidOpenings, feedback });
    let letter;
    try { letter = await composer({ prompt, person, frame, hooks, attempt }); }
    catch (e) { attempts.push({ attempt, error: e.message }); continue; }
    if (!letter?.subject || !letter?.body) { attempts.push({ attempt, error: 'composer returned no letter' }); feedback.push('return a subject and a body'); continue; }
    letter = { subject: String(letter.subject).trim(), body: String(letter.body).trim() };
    const embedding = embed ? await embed(letter.body).catch(() => null) : null;
    const check = checkLetter({ letter, frame, hooks, historyFingerprints, signatureLines, embedding });
    attempts.push({ attempt, problems: check.problems });
    if (check.ok) return { ok: true, letter, check, attempts, embedding };
    feedback.splice(0, feedback.length, ...check.problems);
  }
  return { ok: false, attempts };
}

export function llmComposer(llm) {
  return async ({ prompt }) => {
    const out = await llm.json(prompt, { temperature: 0.95 });
    return out && { subject: out.subject, body: out.body };
  };
}
export { dashViolations };
