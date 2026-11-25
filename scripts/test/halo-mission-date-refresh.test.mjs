/* Execute the production list renderer. The tiny DOM model records node identity:
   replacing innerHTML disconnects its controls, just as it does in the browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/halo/halo.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness() {
  let now = Date.parse('2026-11-10T23:59:00Z'), html = '', cards = [], dates = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const document = { activeElement: null };
  const list = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      for (const card of cards) card.isConnected = false;
      if (cards.includes(document.activeElement)) document.activeElement = null;
      html = value;
      cards = [...value.matchAll(/data-sel="([^"]+)"/g)].map((match) => ({
        dataset: { sel: match[1] }, isConnected: true,
        focus() { document.activeElement = this; }
      }));
      dates = [...value.matchAll(/data-mission-due="([^"]*)"[^>]*>([^<]*)</g)].map((match) => ({
        dataset: { missionDue: match[1] }, textContent: match[2]
      }));
    }
  };
  const status = { innerHTML: '' };
  const mission = { id: 'mission-1', title: 'Harbor check', status: 'active', ends_at: '2026-11-11T03:00:00Z', counts: {}, team: [] };
  let selected = null;
  const context = {
    Date: Clock, document, view: 'missions', listSig: '', tabs: { missions: 'active' },
    ui: { leftBody: {}, leftSub: {} }, ICON: { flag: '', arrow: '', chev: '' },
    $: (selector) => selector === '.hx-list' ? list : selector === '.hx-coverage' ? status : null,
    $$: (selector) => selector === '[data-sel]' ? cards : selector === '[data-mission-due]' ? dates : [],
    current: () => null, missions: () => [mission], missionsFiltered: () => [mission],
    missionProgress: () => ({ known: true, done: 0, total: 1, pct: 0 }),
    missionTone: () => 'cyan', missionWord: () => 'Active', placed: () => false,
    esc: (value) => String(value ?? ''), n: String, fin: Number.isFinite,
    ms: (value) => value ? Date.parse(value) : null,
    hhmm: (value) => new Date(value).toISOString().slice(11, 16),
    coverage: () => '<p>' + now + '</p>', select: (value) => { selected = value; }
  };
  vm.createContext(context);
  vm.runInContext(section('  function due(', '  function initials(')
    + section('  function missionCard(', '  function personRow(')
    + section('  function paintList()', '  /* ---------- the detail panel'), context);
  return {
    paint: () => context.paintList(), advance: (ms) => { now += ms; },
    card: () => cards[0], dates: () => dates, status, document,
    selected: () => selected, mission,
    dateText: () => dates[0]?.textContent || /Due ([^<]*)/.exec(html)?.[0] || ''
  };
}

test('midnight updates the due label without detaching the focused mission', () => {
  const h = harness(); h.paint();
  const card = h.card(), beforeStatus = h.status.innerHTML;
  card.focus();
  assert.match(h.dateText(), /Tomorrow, 03:00 UTC/);
  h.advance(120000); h.paint();
  assert.equal(h.card(), card, 'time-only metadata must preserve the mission control');
  assert.equal(card.isConnected, true);
  assert.equal(h.document.activeElement, card);
  assert.match(h.dateText(), /Today, 03:00 UTC/);
  assert.notEqual(h.status.innerHTML, beforeStatus);
  card.onclick();
  assert.equal(h.selected().id, h.mission.id);
});

test('a pressed mission remains attached across midnight and still activates', () => {
  const h = harness(); h.paint();
  const pressed = h.card();
  h.advance(240000); h.paint();
  assert.equal(h.card(), pressed);
  assert.equal(pressed.isConnected, true);
  pressed.onclick();
  assert.equal(h.selected().id, h.mission.id);
  assert.match(h.dateText(), /Today, 03:00 UTC/);
});

test('changed mission data and cleared dates still update rather than keeping stale content', () => {
  const h = harness(); h.paint();
  h.mission.ends_at = '2026-11-11T04:30:00Z'; h.paint();
  assert.match(h.dateText(), /Tomorrow, 04:30 UTC/);
  h.mission.ends_at = null; h.paint();
  assert.equal(h.dateText(), '');
});
