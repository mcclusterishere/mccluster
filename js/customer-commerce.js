(function () {
 'use strict';
 const notice = document.getElementById('notice');
 const detail = document.getElementById('checkout-detail');
 const plans = document.getElementById('plans');
 const subscriptions = document.getElementById('subscriptions');
 const resume = document.getElementById('resume');
 const refresh = document.getElementById('refresh');
 const recovery = document.getElementById('recovery');
 const guardedStatuses = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];
 const inflight = new Map();
 let generation = 0, view = null;

 function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
 function sameAccount(context) {
  const session = window.MCC.session();
  return session?.access_token === context.token && session?.user?.id === context.owner;
 }
 function current(context) { return view === context && context.version === generation && sameAccount(context); }
 function storageKey(owner, plan, period) { return 'creator-checkout-' + owner + '-' + plan + '-' + period; }
 function requestIdentity(context, plan) {
  const key = storageKey(context.owner, plan.plan, plan.period);
  try {
   const id = sessionStorage.getItem(key) || crypto.randomUUID();
   sessionStorage.setItem(key, id);
   return id;
  } catch (_) { return crypto.randomUUID(); }
 }
 function clearAttempt(context, attempt) {
  if (!attempt?.plan || !attempt?.period || !attempt?.request_id) return;
  try {
   const key = storageKey(context.owner, attempt.plan, attempt.period);
   if (sessionStorage.getItem(key) === attempt.request_id) sessionStorage.removeItem(key);
  } catch (_) {}
 }
 function clearAccountAttempts(context) {
  try {
   const prefix = 'creator-checkout-' + context.owner + '-';
   Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key));
  } catch (_) {}
 }
 async function api(path, body, token) {
  const res = await fetch('https://api.mccluster.org/v1/creator-billing/' + path, {
   method: body ? 'POST' : 'GET',
   headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
   body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
  });
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || 'Billing request failed'); error.data = data; throw error; }
  return data;
 }
 function hasSubscription(context) {
  return context.status.paid || context.status.subscriptions.some(row => guardedStatuses.includes(row.status));
 }
 function controls(context) {
  if (!current(context)) return;
  const busy = inflight.has(context.owner), paid = hasSubscription(context);
  plans.querySelectorAll('button').forEach(button => { button.disabled = busy || paid || !!context.status.checkout; });
  subscriptions.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  recovery.querySelectorAll('button,input').forEach(control => { control.disabled = busy; });
  refresh.disabled = busy;
  resume.disabled = busy || paid || context.status.checkout?.state === 'requires_owner' || context.status.checkout?.recoverable === false;
  resume.textContent = context.status.checkout?.state === 'ready' ? 'Continue existing checkout' : 'Resume or recover checkout';
  notice.setAttribute('aria-busy', String(busy));
 }
 function showStatus(context, message) {
  if (!current(context)) return;
  const checkout = context.status.checkout;
  const prefix = context.catalog.mode === 'test' ? 'Sandbox checkout: no live purchase. ' : '';
  let text, state;
  if (context.status.paid) {
   state = 'paid';
   text = 'Your paid workspace is active.';
  } else if (hasSubscription(context)) {
   state = 'pending';
   text = 'Your existing subscription needs billing attention or confirmation. Manage billing or refresh status before starting another plan.';
  } else if (checkout?.state === 'requires_owner') {
   state = 'requires_owner';
   text = 'This checkout needs the McCluster owner or billing support to review it. Do not start another payment. Refresh billing status after the review.';
  } else if (checkout) {
   state = checkout.state === 'ready' ? 'ready' : 'pending';
   text = state === 'ready' ? 'Your existing checkout is ready to resume. Continue it before choosing another plan.' : 'Payment confirmation is pending. Resume the existing attempt before choosing another plan.';
  } else {
   state = message?.state || (hasSubscription(context) ? 'paid' : 'available');
   text = message?.text || (context.status.paid ? 'Your paid workspace is active.' : new URLSearchParams(location.search).has('checkout') ? 'Checkout returned. Refresh status while payment confirmation is processed.' : 'No active paid workspace.');
  }
  notice.dataset.state = state;
  notice.textContent = prefix + text;
  detail.hidden = !checkout;
  detail.textContent = checkout ? [checkout.plan && checkout.period ? 'Existing plan: ' + checkout.plan + ' · ' + checkout.period + '.' : '', checkout.request_id ? 'Checkout reference: ' + checkout.request_id : ''].filter(Boolean).join(' ') : '';
  controls(context);
 }
 function begin(context) {
  if (!current(context) || inflight.has(context.owner)) return null;
  const operation = {};
  inflight.set(context.owner, operation);
  controls(context);
  return operation;
 }
 function finish(context, operation) {
  if (inflight.get(context.owner) !== operation) return;
  inflight.delete(context.owner);
  if (current(context)) controls(context);
  // A refresh or token renewal can replace a view while its request is running.
  // Re-read that account, never let an old account's completion unlock a new one.
  else if (view?.owner === context.owner && current(view)) load();
 }
 async function redirect(context, path, body, attempt) {
  if (!current(context) || (path !== 'portal' && hasSubscription(context)) || (path === 'checkout' && context.status.checkout) || (path === 'resume' && (context.status.checkout?.state === 'requires_owner' || context.status.checkout?.recoverable === false))) return;
  const operation = begin(context);
  if (!operation) return;
  if (path !== 'portal') {
   context.status.checkout = context.status.checkout || { ...attempt, state: 'pending', recoverable: true };
   showStatus(context);
  }
  try {
   const data = await api(path, body, context.token);
   if (!current(context)) return;
   if (path !== 'portal' && data.released === true) {
    clearAccountAttempts(context);
    inflight.delete(context.owner);
    await load({ owner: context.owner, message: { text: 'The previous checkout is cleared. Choose a plan to start again.', state: 'available' } });
    return;
   }
   const url = new URL(data.url);
   if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected billing destination');
   location.assign(url.href);
  } catch (error) {
   if (!current(context)) return;
   const data = error.data || {};
   if (path === 'portal') notice.textContent = error.message;
   else if (data.state === 'validation_failed' && data.released === true && data.retryable === true && attempt?.request_id === data.request_id) {
    // Only a verified rejection can rotate this account/plan's original identity.
    clearAttempt(context, attempt);
    context.status.checkout = null;
    showStatus(context, { state: 'validation_failed', text: 'Checkout validation failed. ' + error.message + ' Choose the plan again to retry.' });
   } else {
    const previous = { ...(context.status.checkout || attempt || {}), ...(data.checkout || {}) };
    context.status.checkout = { ...previous, request_id: data.request_id || previous.request_id, state: data.state === 'requires_owner' ? 'requires_owner' : 'pending', recoverable: data.state !== 'requires_owner' };
    showStatus(context);
   }
  } finally { finish(context, operation); }
 }
 async function reconcile(context, row, input, output) {
  if (!current(context) || !context.status.can_reconcile) return;
  const sessionId = input?.value.trim();
  if (sessionId && !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) { output.textContent = 'Enter a Stripe Checkout session ID beginning with cs_.'; return; }
  const operation = begin(context);
  if (!operation) return;
  let message;
  try {
   await api('reconcile', { owner_user_id: row.owner_user_id, request_id: row.request_id, ...(sessionId ? { session_id: sessionId } : {}) }, context.token);
   message = 'Reconciliation checked. The queue below shows the latest state.';
  } catch (error) { message = 'Reconciliation needs attention: ' + error.message; }
  finally {
   if (current(context)) {
    inflight.delete(context.owner);
    await load({ owner: context.owner, recoveryMessage: message });
   } else finish(context, operation);
  }
 }
 async function loadQueue(context, message) {
  if (!current(context) || !context.status.can_reconcile) return;
  recovery.hidden = false;
  recovery.append(node('h2', 'Checkout recovery · owner controls'));
  const output = node('p', message || 'Checking checkout recovery…');
  output.setAttribute('role', 'status');
  recovery.append(output);
  try {
   const data = await api('recovery', null, context.token);
   if (!current(context)) return;
   output.textContent = message || (data.attempts.length ? 'Review uncertain attempts below. Actions are audited and never force a reservation release.' : 'No checkout attempts need recovery.');
   data.attempts.forEach(row => {
    const card = node('section', '');
    card.append(node('h3', (row.plan || 'Unknown plan') + ' · ' + (row.period || 'Unknown period')), node('p', 'Account: ' + row.owner_user_id), node('p', 'Checkout reference: ' + row.request_id), node('p', 'State: ' + row.state));
    let input;
    if (row.state === 'requires_owner') {
     const label = node('label', 'Known Stripe Checkout session ID (optional)');
     input = document.createElement('input'); input.type = 'text'; input.placeholder = 'cs_…'; input.autocomplete = 'off'; input.spellcheck = false;
     label.append(input);
     card.append(label, node('p', 'Use a session ID from Stripe. The server verifies the original account and attempt before changing their state.'));
    }
    const button = node('button', 'Reconcile original attempt');
    button.type = 'button'; button.onclick = () => reconcile(context, row, input, output);
    card.append(button); recovery.append(card);
   });
   controls(context);
  } catch (error) { if (current(context)) output.textContent = 'Recovery queue unavailable: ' + error.message; }
 }
 async function load(options = {}) {
  const version = ++generation;
  view = null;
  plans.replaceChildren(); subscriptions.replaceChildren(); recovery.replaceChildren(); recovery.hidden = true;
  detail.hidden = true; detail.textContent = '';
  resume.disabled = true; refresh.disabled = false;
  notice.dataset.state = 'loading'; notice.textContent = 'Checking your account…'; notice.setAttribute('aria-busy', 'true');
  try {
   const session = await window.MCC.refreshIfNeeded();
   if (version !== generation) return;
   if (!session?.access_token || !session?.user?.id) throw new Error('Sign in to view your plans and billing.');
   const context = { version, token: session.access_token, owner: session.user.id };
   const [status, catalog] = await Promise.all([api('status', null, context.token), api('plans', null, context.token)]);
   if (version !== generation || !sameAccount(context)) return;
   context.status = status; context.catalog = catalog; view = context;
   status.subscriptions.forEach(row => {
    const card = node('section', ''); card.append(node('h2', 'Subscription: ' + row.status));
    if (row.current_period_end) card.append(node('p', 'Current period ends ' + new Date(row.current_period_end).toLocaleDateString()));
    if (row.cancel_at_period_end) card.append(node('p', 'Cancellation is scheduled for the period end.'));
    const button = node('button', 'Manage billing, invoices or cancellation');
    button.onclick = () => redirect(context, 'portal', { subscription_id: row.stripe_subscription_id });
    card.append(button); subscriptions.append(card);
   });
   if (!catalog.plans.length) plans.append(node('p', 'Plans are not available for purchase yet. Your existing page remains accessible from Your site.'));
   catalog.plans.forEach(plan => {
    const card = node('section', '');
    card.append(node('h2', plan.plan + ' · ' + plan.period), node('p', new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.amount / 100)));
    const button = node('button', 'Continue to checkout');
    button.onclick = () => {
     if (!current(context) || inflight.has(context.owner) || hasSubscription(context) || context.status.checkout) return;
     const attempt = { plan: plan.plan, period: plan.period, request_id: requestIdentity(context, plan) };
     redirect(context, 'checkout', attempt, attempt);
    };
    card.append(button); plans.append(card);
   });
   showStatus(context, options.owner === context.owner ? options.message : null);
   loadQueue(context, options.owner === context.owner ? options.recoveryMessage : null);
  } catch (error) {
   if (version === generation) { notice.textContent = error.message; notice.dataset.state = 'unavailable'; notice.setAttribute('aria-busy', 'false'); }
  }
 }
 resume.onclick = () => { if (view) redirect(view, 'resume', {}, view.status.checkout); };
 refresh.onclick = () => load();
 window.addEventListener('storage', () => load());
 window.addEventListener('mcc:auth-changed', () => load());
 load();
})();
