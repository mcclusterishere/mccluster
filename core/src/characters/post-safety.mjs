/* THE LAST GATE BEFORE A CHARACTER SPEAKS IN PUBLIC.

   Owner, 2026-11-03: characters can be crude and satirical, but no slurs
   aimed at real groups, no harassment of real members, no claim to be a real
   human when a member sincerely asks, nothing about real private individuals,
   and no medical, legal or financial advice framed as real.

   The prompt asks for all of that; this deterministic check refuses what slips
   through. A refused post is dropped, never edited: the character simply
   skips its turn. Profanity on its own passes. */

const SLURS = /\b(?:n[i1!]gg(?:a|er|ah|uh|az|ers)?s?|f[a@4]gg?(?:ot|it)?s?|k[i1]kes?|sp[i1]cs?|ch[i1]nks?|g[o0]oks?|wetbacks?|tr[a@]nn(?:y|ies)|retard(?:s|ed)?|towel-?heads?|raghead|beaners?|coons?|dykes?|wiggers?|pakis?)\b/i;
const THREATS = /\b(?:kill|murder|shoot|stab|rape|lynch|hang)\s+(?:you|him|her|them|y'all|u)\b|\bi(?:'ll| will) (?:find|hurt) you\b|\bdox+(?:ing|ed)?\b|\bhome address\b/i;
const LINKS = /https?:\/\/|www\.|<[^>]*>|(?:^|\s)[@#][\w.]+/i;
/* A character may stay in character, but never claims to be a real human being. */
const HUMAN_CLAIM = /\b(?:i(?:'m| am) (?:a )?(?:real|actual) (?:person|human|man|woman)|i(?:'m| am) not (?:an? )?(?:ai|bot|character|fictional)|i am human|i'm human|not a bot)\b/i;
/* Advice framed as real professional advice. Jokes about money or pills stay allowed. */
const REAL_ADVICE = /\b(?:\d+\s?(?:mg|milligrams?|ml)\b|(?:you should|you need to|i recommend you) (?:buy|sell|invest|short|take|stop taking|sue|file)\b|(?:legal|medical|financial|tax|investment) advice\b|guaranteed returns?|as (?:a|your) (?:doctor|lawyer|attorney|financial advis[eo]r|pharmacist))/i;
const MODEL_TALK = /\b(?:as an ai|language model|qwen|llama|gpt-?\d|chatgpt|openai|claude|gemini|anthropic)\b/i;
const MINOR_GROUPS = /\b529 boyz\b/i;

export function sentenceCount(text) {
  return String(text).split(/(?<=[.!?…])\s+(?=[A-Z0-9"“'‘(])/).filter(s => s.trim()).length;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* -> { ok: true, body } | { ok: false, reason } */
export function checkPost(value, { minors = [], min = 12, max = 480, maxSentences = 4 } = {}) {
  let body = String(value ?? '').replace(/\s+/g, ' ').trim();
  // Unwrap a post the model quoted whole; a quotation inside the post keeps its marks.
  if (/^["“][^"“”]*["”]$/.test(body)) body = body.slice(1, -1).trim();
  const length = [...body].length;
  if (length < min) return { ok: false, reason: 'too_short' };
  if (length > max) return { ok: false, reason: 'too_long' };
  if (sentenceCount(body) > maxSentences) return { ok: false, reason: 'too_many_sentences' };
  if (LINKS.test(body)) return { ok: false, reason: 'link_or_mention' };
  if (SLURS.test(body)) return { ok: false, reason: 'slur' };
  if (THREATS.test(body)) return { ok: false, reason: 'threat' };
  if (HUMAN_CLAIM.test(body)) return { ok: false, reason: 'claims_to_be_human' };
  if (REAL_ADVICE.test(body)) return { ok: false, reason: 'real_advice' };
  if (MODEL_TALK.test(body)) return { ok: false, reason: 'model_talk' };
  if (MINOR_GROUPS.test(body)) return { ok: false, reason: 'mentions_minor' };
  for (const name of minors) if (new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(body)) return { ok: false, reason: 'mentions_minor' };
  return { ok: true, body };
}
