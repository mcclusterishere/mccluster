/* No account, location, network, storage, payment or dispatch dependency. */
export const WHIP_BETA_PLAN = Object.freeze({ maxDrivers:49, ridesLive:false, intakeOpen:false });
export function attachWhipDemo({ panel }) {
  if (!panel) return null;
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'wtBookWhip'; button.textContent = 'Try hailing a cab · demo';
  const anchor = panel.querySelector('#wtRideDirections');
  if (anchor) anchor.before(button); else panel.append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'wtWhipDialog'; dialog.className = 'we-book-dialog';
  dialog.setAttribute('aria-labelledby', 'wtWhipTitle');
  dialog.innerHTML = `
    <div class="we-book-head"><div><p class="we-book-kicker">WHIP EQUIPPED · DEMO</p>
    <h2 id="wtWhipTitle">Explore a driving trip</h2></div>
    <button id="weDemoClose" type="button" aria-label="Close driving demo">×</button></div>
    <p><strong>No real ride is booked.</strong> No driver is contacted and no payment is taken.</p>
    <section id="weDemoExplore">
      <p>Walk through hailing a cab using an example journey. These places are examples, not your location or available service.</p>
      <label for="weDemoRoute">Example journey</label>
      <select id="weDemoRoute"><option>Station to community center</option><option>Library to grocery store</option></select>
      <p>Driver availability, pickup times and fares are not offered in this demo.</p>
      <button id="weDemoReview" class="we-book-primary" type="button">Review demo ride</button>
    </section>
    <section id="weDemoReviewPanel" hidden>
      <h3>Your demo journey</h3><p id="weDemoJourney"></p>
      <p>The proposed initial program would offer sponsored free rides to qualifying riders, with other riders on a waitlist. Funding, eligibility and service areas are still to be decided. No eligibility or income details are requested here.</p>
      <button id="weDemoInvite" class="we-book-primary" type="button">Preview beta invitation</button>
      <button id="weDemoBack" type="button">Change example journey</button>
    </section>
    <section id="weDemoInvitation" hidden>
      <h3>You're invited to explore the proposed beta</h3>
      <p>This is an invitation preview, not enrollment. Rider and driver intake are not open; you have not joined a waitlist or reserved a place.</p>
      <p>The proposed pilot has a maximum of ${WHIP_BETA_PLAN.maxDrivers} drivers. This is a planning limit, not a count of available drivers or an exemption from licensing, insurance, safety or regulatory requirements.</p>
      <p>Sponsored free rides are the initial goal. Paid fares and financial design are deferred. A public-benefit corporation is a proposal, not a formed entity asserted by this demo.</p>
      <p>Future invitations require an approved, secured intake and a reviewed consent and eligibility process. Please do not submit personal or income information here.</p>
      <button id="weDemoRestart" type="button">Explore another example</button>
    </section>
    <p id="weDemoStatus" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#'+id);
  function show(step) {
    for (const [id, value] of [['weDemoExplore','explore'],['weDemoReviewPanel','review'],['weDemoInvitation','invitation']]) $(id).hidden = step !== value;
    $('weDemoStatus').textContent = step === 'invitation' ? 'Demo complete. No ride, waitlist entry or invitation delivery was created.' : 'Demo only. No real ride is booked.';
    if (dialog.open) $(step === 'explore' ? 'weDemoRoute' : step === 'review' ? 'weDemoInvite' : 'weDemoRestart').focus();
  }
  button.onclick = () => { show('explore'); dialog.showModal(); $('weDemoRoute').focus(); };
  $('weDemoReview').onclick = () => { $('weDemoJourney').textContent = $('weDemoRoute').value; show('review'); };
  $('weDemoInvite').onclick = () => show('invitation');
  $('weDemoBack').onclick = $('weDemoRestart').onclick = () => show('explore');
  $('weDemoClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { show('explore'); button.focus(); });
  return { dialog, button, close: () => dialog.close() };
}
