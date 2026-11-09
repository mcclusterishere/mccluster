/* Public, browser-local seven-day guest preview for Molecule Rush.
   The private Game Hub, other games and authoring tools keep their server owner checks.
   This is an onboarding timer, not an anti-abuse/payment entitlement or an identity system:
   anonymous visitors can clear local storage. A server-backed paid gate must be designed
   separately before charging anyone or making access claims across devices. */
export const TRIAL_KEY = 'mcc.chem108.guest-trial.v1';
export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_GRACE_MS = 5 * 60 * 1000;
const SESSION_KEY = 'mccdb_session';

export function trialStatus(record, now = Date.now()) {
  if (!record) return { state: 'new', remainingMs: TRIAL_MS };
  if (record.version !== 1 || !Number.isFinite(record.startedAt) ||
      !Number.isFinite(record.lastSeen) || record.startedAt <= 0 ||
      record.lastSeen < record.startedAt ||
      now + CLOCK_GRACE_MS < record.lastSeen ||
      now + CLOCK_GRACE_MS < record.startedAt) {
    return { state: 'invalid', remainingMs: 0 };
  }
  const left = record.startedAt + TRIAL_MS - now;
  return left > 0 ? { state: 'active', remainingMs: left } : { state: 'expired', remainingMs: 0 };
}

export function readTrial(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(TRIAL_KEY);
    if (!raw) return { state: 'new', remainingMs: TRIAL_MS };
    return trialStatus(JSON.parse(raw), now);
  } catch (_) {
    return { state: 'invalid', remainingMs: 0 };
  }
}

export function startTrial(storage, now = Date.now()) {
  try {
    const existing = storage.getItem(TRIAL_KEY);
    if (existing) return readTrial(storage, now);
    storage.setItem(TRIAL_KEY, JSON.stringify({ version: 1, startedAt: now, lastSeen: now }));
    return readTrial(storage, now);
  } catch (_) {
    return { state: 'unavailable', remainingMs: 0 };
  }
}

export function recordTrialVisit(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(TRIAL_KEY);
    if (!raw) return readTrial(storage, now);
    const record = JSON.parse(raw);
    const status = trialStatus(record, now);
    if (status.state !== 'active') return status;
    record.lastSeen = Math.max(record.lastSeen, now);
    storage.setItem(TRIAL_KEY, JSON.stringify(record));
    return status;
  } catch (_) {
    return { state: 'unavailable', remainingMs: 0 };
  }
}

function formatRemaining(ms) {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours > 24 ? Math.ceil(hours / 24) + ' days' : hours + (hours === 1 ? ' hour' : ' hours');
}

/* Whose session a token is: the subject its payload names, so a refreshed token is still the same account. A token
   that names nobody is only ever equal to itself. Nothing is trusted from it: only a server answer verifies an
   account, and this says which stored session that answer belongs to. */
function accountOf(token) {
  try {
    const subject = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    if (typeof subject === 'string' && subject) return 'account:' + subject;
  } catch (_) { /* not a readable JWT */ }
  return 'token:' + token;
}

function mountTrialPage() {
  const panel = document.querySelector('[data-chem108-trial]');
  if (!panel) return;
  const msg = document.getElementById('chemTrialMessage');
  const start = document.getElementById('chemTrialStart');
  const account = document.getElementById('chemTrialAccount');
  const game = document.getElementById('chemTrialGame');
  const heading = document.getElementById('chemTrialHeading');
  let view = null, ticket = 0, playing = false;
  /* An account answer belongs to the session that asked for it. `confirmed` is the account the server answered
     for, and it counts only while that account's session is the one stored. `generation` moves on every sign-in,
     sign-out, change of account and cleared store the page sees, and when the page is frozen, so an answer still
     in flight then arrives late and is dropped. */
  let generation = 0, confirmed = null, asking = null;

  function read() {
    return readTrial(localStorage);
  }
  // The account the stored session belongs to, or null when nobody is signed in.
  function sessionAccount() {
    try {
      const token = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.access_token;
      return typeof token === 'string' && token ? accountOf(token) : null;
    } catch (_) { return null; }
  }
  // Read at every decision, never remembered.
  function verified() {
    return confirmed !== null && confirmed === sessionAccount();
  }
  function closeGame() {
    ++ticket;
    if (view) { view.destroy(); view = null; }
    game.hidden = true;
    playing = false;
    document.getElementById('chem108Main').classList.remove('is-playing');
  }
  function display(text, title, button, callback, showAccount) {
    heading.textContent = title;
    msg.textContent = text;
    panel.hidden = false;
    start.hidden = !button;
    start.textContent = button || '';
    start.onclick = button ? callback : null;
    account.hidden = !showAccount;
  }
  function showRound(status) {
    display(verified() ? 'Signed-in account verified.' :
      'Guest trial: ' + formatRemaining(status.remainingMs) + ' remaining.', 'Molecule Rush', '', null, false);
  }
  async function openGame() {
    if (playing) return;
    const status = read();
    if (!verified() && status.state !== 'active') { show(); return; }
    playing = true;
    const id = ++ticket;
    showRound(status);
    start.hidden = true;
    game.hidden = false;
    game.textContent = 'Loading Molecule Rush…';
    document.getElementById('chem108Main').classList.add('is-playing');
    try {
      const module = await import('./game.mjs');
      if (id !== ticket) return;
      if (!verified() && read().state !== 'active') { closeGame(); show(); return; }
      view = module.mount(game, { onExit: () => { closeGame(); show(); } });
    } catch (_) {
      if (id !== ticket) return;
      closeGame();
      display('The chemistry game could not load. Check your connection and try again.',
        'Game unavailable', 'Retry', () => void openGame(), false);
    }
  }
  function show() {
    if (playing) return;
    if (verified()) {
      display('Your M Account is verified. Continue learning with Molecule Rush.',
        'Welcome back', 'Play Chemistry', () => void openGame(), false);
      return;
    }
    const status = read();
    if (status.state === 'new') {
      display('Play every mode for seven days without creating an account. The clock starts when you choose Start. After that, sign in or create a free M Account to keep playing. No payment is collected here.',
        'Seven days free', 'Start my free trial', () => {
          const result = startTrial(localStorage);
          if (result.state === 'active') { recordTrialVisit(localStorage); void openGame(); }
          else show();
        }, false);
    } else if (status.state === 'active') {
      display('Your free guest preview has ' + formatRemaining(status.remainingMs) + ' left.',
        'Your chemistry trial', 'Play Chemistry', () => { recordTrialVisit(localStorage); void openGame(); }, false);
    } else {
      display(status.state === 'expired' ?
        'Your seven-day guest preview has ended. Sign in or create a free M Account to keep playing. No payment is collected here.' :
        'Guest trial access cannot be verified in this browser. To continue, enable local storage or use a free M Account.',
        'Continue with an M Account', '', null, true);
    }
  }

  // After a session change or an account answer: a round neither the account nor the trial covers closes, and
  // the page says what is true now.
  function apply() {
    const status = read();
    if (playing && (verified() || status.state === 'active')) { showRound(status); return; }
    if (playing) closeGame();
    show();
  }

  // Ask the server whose session is stored. An account it has already answered for is not asked about again,
  // and one request is in flight per account.
  function askAccount(followUp) {
    const asked = sessionAccount();
    if (!asked || asked === confirmed || !window.MCC || typeof window.MCC.user !== 'function') return;
    if (asking && asking.account === asked && asking.generation === generation) return;
    const ask = asking = { account: asked, generation };
    new Promise(resolve => resolve(window.MCC.user())).catch(() => null).then(user => {
      if (asking === ask) asking = null;
      if (ask.generation !== generation) return;
      // Storage no longer holds this account's session and no event said so: the answer is not about what is
      // stored now. A session that is there gets one question of its own; storage that keeps changing waits for
      // the next return to the tab.
      if (sessionAccount() !== ask.account) { if (!followUp) askAccount(true); return; }
      // No user: a failed network/account check is not a confirmed sign-out or a reason to discard the guest
      // preview; no access is granted from a local JWT.
      if (!user) return;
      confirmed = ask.account;
      apply();
    });
  }

  // Signed in, signed out or another account: nothing answered before applies to what is stored now, and
  // nothing still in flight will.
  function sessionChanged() {
    ++generation;
    confirmed = null;
    apply();
    askAccount();
  }

  // A sign-in or sign-out, announced in this tab or seen from another. The same account's refreshed token is
  // neither.
  function sessionSignal() {
    if (!verified()) sessionChanged();
  }

  // A tab left open past day seven must not retain an unbounded playable round, and a session cleared or
  // replaced without an event (another script, the browser's own storage controls) must not keep an account
  // answer.
  function recheck() {
    if (verified()) return;
    if (confirmed !== null) { sessionChanged(); return; }
    const state = read();
    if (playing && state.state !== 'active') { closeGame(); show(); }
    else if (!playing && state.state === 'active') show();
  }

  // Back in front of the visitor, from a hidden tab or from the back/forward cache.
  function comeBack() {
    recheck();
    askAccount();
  }

  show();
  askAccount();

  // Events make the change immediate where the host delivers them; the timer covers the same ground without.
  window.addEventListener?.('mcc:auth-changed', sessionSignal);
  window.addEventListener?.('storage', event => { if (event.key === SESSION_KEY || event.key === null) sessionSignal(); });
  window.addEventListener?.('pagehide', () => { ++generation; });
  window.addEventListener?.('pageshow', event => { if (event.persisted) comeBack(); });
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') comeBack(); });
  window.setInterval(recheck, 30000);
}

if (typeof document !== 'undefined') mountTrialPage();
