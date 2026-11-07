/* Public, browser-local seven-day guest preview for Molecule Rush.
   The private Game Hub, other games and authoring tools keep their server owner checks.
   This is an onboarding timer, not an anti-abuse/payment entitlement or an identity system:
   anonymous visitors can clear local storage. A server-backed paid gate must be designed
   separately before charging anyone or making access claims across devices. */
export const TRIAL_KEY = 'mcc.chem108.guest-trial.v1';
export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_GRACE_MS = 5 * 60 * 1000;

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

function mountTrialPage() {
  const panel = document.querySelector('[data-chem108-trial]');
  if (!panel) return;
  const msg = document.getElementById('chemTrialMessage');
  const start = document.getElementById('chemTrialStart');
  const account = document.getElementById('chemTrialAccount');
  const game = document.getElementById('chemTrialGame');
  const heading = document.getElementById('chemTrialHeading');
  let view = null, ticket = 0, verified = false, playing = false;

  function read() {
    return readTrial(localStorage);
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
  async function openGame() {
    if (playing) return;
    const status = read();
    if (!verified && status.state !== 'active') { show(); return; }
    playing = true;
    const id = ++ticket;
    display(verified ? 'Signed-in account verified.' :
      'Guest trial: ' + formatRemaining(status.remainingMs) + ' remaining.', 'Molecule Rush', '', null, false);
    start.hidden = true;
    game.hidden = false;
    game.textContent = 'Loading Molecule Rush…';
    document.getElementById('chem108Main').classList.add('is-playing');
    try {
      const module = await import('./game.mjs');
      if (id !== ticket) return;
      if (!verified && read().state !== 'active') { closeGame(); show(); return; }
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
    if (verified) {
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

  function hasLocalSession() {
    try { return !!JSON.parse(localStorage.getItem('mccdb_session') || 'null')?.access_token; }
    catch (_) { return false; }
  }

  show();
  if (hasLocalSession() && window.MCC && typeof window.MCC.user === 'function') {
    Promise.resolve().then(() => window.MCC.user()).then(user => {
      if (!user) return;
      verified = true;
      if (!playing) show();
    }).catch(() => {
      // A failed network/account check is not a confirmed sign-out or a reason
      // to discard the guest preview; no access is granted from a local JWT.
    });
  }

  // A tab left open past day seven must not retain an unbounded playable round.
  window.setInterval(() => {
    if (verified) return;
    const state = read();
    if (playing && state.state !== 'active') { closeGame(); show(); }
    else if (!playing && state.state === 'active') show();
  }, 30000);
}

if (typeof document !== 'undefined') mountTrialPage();
