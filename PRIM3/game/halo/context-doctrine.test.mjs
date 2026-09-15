import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const countryRules = await readFile(resolve(here, 'COUNTRY-ASSIGNMENT-RULES.md'), 'utf8');
const doctrine = await readFile(resolve(here, 'TECHNOLOGY-CULTURE-PLACEMENT-DOCTRINE.md'), 'utf8');
const ghana = JSON.parse(
  await readFile(resolve(here, 'research/context-profiles/ghana-mobile-identity.candidate.json'), 'utf8')
);

test('country placement requires technology and cultural evidence', () => {
  assert.match(countryRules, /technology\/institution adoption profile/i);
  assert.match(countryRules, /implicit cultural-learning plan/i);
  assert.match(countryRules, /source quality and freshness/i);
});

test('canon rejects technology hierarchy and SIM/eSIM oversimplification', () => {
  assert.match(doctrine, /Technology context is not a hierarchy/i);
  assert.match(doctrine, /Physical SIM cards are not the sole prerequisite/i);
  assert.match(doctrine, /eSIM environments can still be attacked/i);
});

test('cultural learning is implicit and anti-stereotype', () => {
  assert.match(doctrine, /environmental, not a quiz layer/i);
  assert.match(doctrine, /must never stand in for the entire country/i);
  assert.match(doctrine, /Avoid exoticism, poverty tourism, caricature/i);
});

test('Ghana remains a sourced candidate rather than an invented locked assignment', () => {
  assert.equal(ghana.country, 'Ghana');
  assert.equal(ghana.status, 'candidate');
  assert.ok(Array.isArray(ghana.sources) && ghana.sources.length >= 3);
  assert.ok(ghana.open_questions.some((question) => /physical-SIM versus eSIM/i.test(question)));
  assert.ok(ghana.threat_context.anti_misconceptions.some((item) => /not exclusive to physical SIM/i.test(item)));
});
