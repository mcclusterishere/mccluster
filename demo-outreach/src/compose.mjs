/* One short first person letter per candidate, from the template plus that person's sourced hook.
   No model call: the letter is deterministic so Matthew reviews exactly what would go out. */
import { letterProblems } from './text-rules.mjs';

export function subjectFor(c) {
  const topic = String(c.subject_topic || c.org || '').trim();
  const s = `${topic} and a short open records demo`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function composeLetter(c, target, { fromName, fromEmail }) {
  const greeting = c.salutation?.startsWith('Hello') ? `${c.salutation},` : `Dear ${c.salutation},`;
  const body = [
    greeting,
    '',
    c.hook,
    '',
    `My name is Matthew McCluster. I study computer science at Southern Connecticut State University and run McCluster Corp in Bridgeport. I built a project I would like to show you. ${target.summary} You can see it here: ${target.url}`,
    '',
    target.relevance,
    '',
    'Would you be open to a 15 minute demo, or to telling me where it falls short for the people you work with?',
    '',
    'Thank you for your time.',
    '',
    fromName,
    fromEmail,
  ].join('\n');
  const letter = { subject: subjectFor(c), body };
  return { ...letter, problems: letterProblems(letter) };
}

export function resolveTarget(targets, key) {
  const k = key || targets.default;
  const t = targets.targets[k];
  if (!t) throw new Error(`unknown target ${k}`);
  return { key: k, ...t };
}
