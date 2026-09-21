/* THE FAN LIST.
   ============================================================
   The complaint underneath this file: there was no way for somebody who
   downloaded a song to hear about the next one.

   That turned out not to be a missing mailing system. The mailing system
   exists and is careful — out_contacts carries a per-person unsubscribe
   token, supabase/functions/outreach appends a real postal address and
   sets List-Unsubscribe and List-Unsubscribe-Post, and a cold campaign
   cannot send without a named human approving it. What was missing was
   any connection between that machinery and the people who listen.
   fan_profiles.marketing_consent was a boolean that nothing on earth
   read, so a listener could ask to be emailed and the answer went into a
   column and stopped.

   Three things are pinned here.

   ONE — the bridge exists and runs in both directions. A consent that
   only travels one way is worse than none: the checkbox and the mail
   would disagree, and the disagreement would be the site claiming
   somebody is subscribed after they left.

   TWO — only a confirmed address is enrolled. This project runs with
   mailer_autoconfirm off, so email_confirmed_at means the person opened
   the mail. That is what makes a tick a confirmed opt-in instead of a
   typed claim, and it is the guard against somebody being signed up
   under an address that is not theirs.

   THREE — the ask is above the address form, not below it. This is a
   layout fact, so it belongs in a test: the reason the number of
   consenting listeners was zero is that the checkbox sat under a legal
   name, a street address, a phone and a birth year.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

const BRIDGE = 'supabase/migrations/20260921075108_fan_list_bridge.sql';
/* Comments in this repo explain the reasoning at length, and a naive
   grep for a phrase would keep matching the paragraph that describes it
   rather than the statement that does it. */
const sqlCode = (src) => src.replace(/^\s*--.*$/gm, ' ');

/* ---------------------------------------------------------------
   1. CONSENT REACHES THE LIST
   --------------------------------------------------------------- */

test('a consenting listener is written into out_contacts, not a new table', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /insert into public\.out_contacts/,
    'the bridge must enrol into the existing outreach contacts table');
  assert.match(sql, /'opted_in'/, 'an explicit tick is an opt-in, and must be recorded as one');
  assert.match(sql, /'fan_profile'/, 'the consent source has to say where the yes came from');
  assert.doesNotMatch(sql, /create table/i,
    'this is a bridge: a second mailing list is exactly what it exists to avoid');
});

test('the list belongs to the house org, resolved by slug rather than a pasted id', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /where slug = 'mccluster'/,
    'a hardcoded org uuid breaks the moment this runs anywhere but production');
});

/* ---------------------------------------------------------------
   2. ONLY A PROVEN ADDRESS
   --------------------------------------------------------------- */

test('an unconfirmed email is not enrolled, and is enrolled when it is confirmed', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /email_verified_at is not null or u\.email_confirmed_at is not null/,
    'enrolment must require a confirmed address');
  assert.match(sql, /if v_consent and v_verified then/,
    'consent alone is not enough to enrol; the address has to be proven too');
  assert.match(sql, /on auth\.users/,
    'somebody who ticks before confirming needs a trigger that lets them in afterwards');
});

/* ---------------------------------------------------------------
   3. THE DOOR OUT WORKS FROM BOTH SIDES
   --------------------------------------------------------------- */

test('unticking withdraws consent AND writes a suppression', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /set consent='none', consent_at=null/,
    'withdrawal has to clear the consent on the contact');
  assert.match(sql, /insert into public\.out_suppressions[\s\S]{0,200}'unsubscribed'/,
    'withdrawal must also suppress, so no other row can resurrect the address');
});

test('re-opting-in lifts the suppression', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /delete from public\.out_suppressions/,
    'a suppression left in place would silently drop somebody who just asked to come back');
});

test('an unsubscribe from a message flips the checkbox back', async () => {
  const sql = sqlCode(await read(BRIDGE));
  assert.match(sql, /on public\.out_suppressions/,
    'the list has to be able to talk back to the profile');
  assert.match(sql, /set marketing_consent = false/,
    'account.html must not show a ticked box to somebody who has unsubscribed');
});

test('the two directions cannot loop', async () => {
  const sql = sqlCode(await read(BRIDGE));
  /* The suppression insert is the hinge. It only happens when consent is
     already false, and it is idempotent, so the trigger it wakes finds
     nothing left to change and the second pass ends there. */
  assert.match(sql, /on conflict \(org_id, address\) do nothing/,
    'the suppression insert must be idempotent or the two triggers ping-pong');
  assert.match(sql, /and f\.marketing_consent\b/,
    'the reverse update must no-op when the box is already unticked');
});

/* ---------------------------------------------------------------
   4. THE ASK IS SOMEWHERE A PERSON WILL SEE IT
   --------------------------------------------------------------- */

test('the email ask sits above the address fields', async () => {
  const html = await read('account.html');
  const ask = html.indexOf('id="fnMarketing"');
  const addr = html.indexOf('id="fnAddr1"');
  const legal = html.indexOf('id="fnLegal"');
  assert.ok(ask > 0 && addr > 0 && legal > 0, 'all three fields should still exist');
  assert.ok(ask < legal && ask < addr,
    'the ask must come before the paperwork, which is the whole point of moving it');
});

test('the address form is a drawer, and the consent is not inside it', async () => {
  const html = await read('account.html');
  const open = html.indexOf('<details class="fan__more"');
  const close = html.indexOf('</details>', open);
  assert.ok(open > 0 && close > open, 'the mailing address should be behind a disclosure');
  const ask = html.indexOf('id="fnMarketing"');
  assert.ok(ask < open,
    'an ask hidden inside a collapsed drawer is the bug this change is fixing');
  assert.ok(html.indexOf('id="fnAddr1"') > open && html.indexOf('id="fnAddr1"') < close,
    'the address fields belong in the drawer');
});

test('neither consent box is pre-ticked', async () => {
  const html = await read('account.html');
  const boxes = html.match(/<input type="checkbox" id="fn(?:Marketing|Share)"[^>]*>/g) ?? [];
  assert.equal(boxes.length, 2, 'both consent boxes should be present');
  for (const b of boxes) {
    assert.doesNotMatch(b, /\bchecked\b/,
      'moving an ask into view is fair; ticking it for somebody is not');
  }
});

/* ---------------------------------------------------------------
   5. THE DEAD CAPTURE PATH IS GONE
   --------------------------------------------------------------- */

test('no page still loads the lead form that could never open', async () => {
  /* js/lead.js returned on its first line forever: window.INTAKE_ENDPOINT
     was set nowhere, and there was not one [data-lead] attribute in the
     repository for it to bind to. js/crm.js is the path that actually
     writes a lead, and it is live. */
  for (const page of ['index.html', 'hire.html']) {
    assert.doesNotMatch(await read(page), /js\/lead\.js/,
      `${page} still loads the inert lead form`);
  }
});

test('the live lead path is still wired', async () => {
  const html = await read('index.html');
  assert.match(html, /js\/crm\.js/, 'removing the dead path must not take the live one with it');
});

/* ---------------------------------------------------------------
   6. THE TOKEN THAT WAS NEVER DECLARED

   Found while checking this card actually rendered. album.html, admin,
   card, crm and desk each declared --ui in their own <style> block. The
   pages that came later -- account, listen, and the whole of
   css/mnet.css -- used var(--ui) without it ever being declared.

   An undefined custom property inside a `font:` shorthand does not fall
   back to the next family in the stack: the declaration is invalid and
   is thrown away whole, so those rules were also losing their weight
   and their size, and every one of them painted at inherited body size.
   --------------------------------------------------------------- */

test('--ui is declared in the sheet every page loads', async () => {
  const css = await read('css/style.css');
  assert.match(css, /--ui:\s*"Manrope"/,
    'var(--ui) is used on pages that declare it nowhere; the shared sheet must define it');
  assert.match(css, /@font-face\{font-family:"Manrope"/,
    'declaring the token without the face would name a font the page never loads');
});

test('no page uses var(--ui) without something declaring it', async () => {
  const shared = await read('css/style.css');
  const declaresGlobally = /--ui:/.test(shared);
  assert.ok(declaresGlobally, 'the shared sheet should carry the declaration');

  /* Belt and braces: if the shared declaration is ever removed, every page
     that uses the token has to carry its own, or its type silently
     collapses again. */
  for (const page of ['account.html', 'listen.html']) {
    const html = await read(page);
    if (!/var\(--ui\)/.test(html)) continue;
    assert.ok(declaresGlobally || /--ui\s*:/.test(html),
      `${page} uses var(--ui) but nothing declares it`);
  }
});
