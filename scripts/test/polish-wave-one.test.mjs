import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=(p)=>readFile(new URL('../../'+p,import.meta.url),'utf8');

test('account and auth surfaces use shared polish motion', async()=>{
  const [account,login,forgot,reset]=await Promise.all(['account.html','login.html','forgot-password.html','reset-password.html'].map(read));
  assert.match(account,/animation:mcc-rise/);
  assert.match(account,/var\(--mcc-spring\)/);
  assert.match(login,/animation:mcc-rise/);
  assert.match(login,/var\(--mcc-surface-2\)/);
  assert.match(forgot,/animation:mcc-rise/);
  assert.match(reset,/animation:mcc-rise/);
});

test('onboarding gets animated selections steps and completion feedback', async()=>{
  const css=await read('css/onboard.css');
  assert.match(css,/\.ob__step:not\(\[hidden\]\).*mcc-rise/);
  assert.match(css,/\.pick > button\[aria-pressed="true"\]::after/);
  assert.match(css,/\.ws__list li\.is-done::before.*mcc-pop/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('Create consumes the shared motion tokens and tactile states', async()=>{
  const css=await read('css/create.css');
  assert.match(css,/--cr-ease: var\(--mcc-ease/);
  assert.match(css,/--cr-spring: var\(--mcc-spring/);
  assert.match(css,/\.cr__form:focus-within/);
  assert.match(css,/\.cr__upl\.is-ok.*mcc-badge-in/);
  assert.match(css,/\.cr__qi.*mcc-rise/);
});
