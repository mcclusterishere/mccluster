import { normalizeJourney, journeyTitle, itinerary, legAction, searchCities } from './journey-core.mjs';
import { createAddressSearch } from './address-search.mjs';
import { journeyStore } from './journey-store.mjs';
import { fetchRoute } from './route-client.mjs';
import { navigationProgress } from './navigation-progress.mjs';
import { rideHandoff } from './ride-handoff.mjs';
import { attachWhipBooking } from './whip-booking.mjs';

const $ = id => document.getElementById(id), root = document.documentElement;
const frame = $('mnWorldFrame'), panel = $('wtPlanner');
panel.setAttribute('data-private', '');
$('wtDestination').setAttribute('data-private', '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  flight:'m3 15 7-4V4l2-2 2 2v7l7 4v2l-7-2v4l2 2h-8l2-2v-4-0L3 17z',
  train:'M7 3h10a2 2 0 0 1 2 2v12H5V5a2 2 0 0 1 2-2ZM5 11h14M8 20l-2 2m10-2 2 2M8 14h.1m7.9 0h.1M12 3v8',
  drive:'m4 10 2-5h12l2 5M4 10h16v8H4zM6 18v3m12-3v3M7 14h.1m9.9 0h.1',
  stay:'M3 19V6m0 8h18v5M3 9h7v5m0-5h8a3 3 0 0 1 3 3v2',
  walk:'M14 3h.01M11 8l3 1 3 4M8 13l3-5-1 8-4 5m4-5 5 2 2 4',
  cycle:'M7 8h10l3 10M7 8l-3 9h10L9 5H6M16 5h3M7 18a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm17 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3 12h18M5 7.5h14M5 16.5h14',
  target:'M12 4v3m0 10v3M4 12h3m10 0h3M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  search:'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm5 11.5L20 20',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  route:'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6',
  near:'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.7a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z',
  saved:'M6 3h12v18l-6-4-6 4z',
  luggage:'M8 7V4h8v3M4 7h16v12H4zM9 11v4m6-4v4M8 19v2m8-2v2',
};
const icon = name => `<svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.drive}"/></svg>`;
const labels = { flight:'Flights', train:'Trains', drive:'Drive', stay:'Stays', transit:'Transit', walk:'Walk', cycle:'Bike' };
const groundModes = ['drive', 'walk', 'cycle'];
const isGround = () => groundModes.includes(draft.mode);
const hasCoordinates = place => Array.isArray(place?.coordinates) && place.coordinates.length === 2 &&
  place.coordinates.every(Number.isFinite) && Math.abs(place.coordinates[0]) <= 180 && Math.abs(place.coordinates[1]) <= 90;
const freshDraft = () => normalizeJourney({ mode:'drive' });
let draft = freshDraft(), savedId = null, dirty = false, busy = false, revision = 0, tripEpoch = 0, tripShape = 'rides';
let catalogPromise, currentMode = 'travel', hostVisible = document.body.dataset.worldAudioVisible !== 'false';
const send = data => frame?.contentWindow?.postMessage(data, location.origin);
const status = (message = '') => { $('wtMessage').textContent = message; };
const addressSearch = createAddressSearch();
let addressController;
const searchClosers = [];

// Routes and live fixes stay in memory. Only the explicit Save action writes a journey.
let route = null, routeState = 'idle', routeError = '', routeController, routeSequence = 0, retryOrigin = null;
let navigating = false, navigationWatch = null, navigationSequence = 0, navigationFollow = true;
let liveFix = null, progress = null, navigationNotice = '', offRouteFixes = 0, lastRerouteAt = 0;
let locating = false, autoLocated = false, locationSequence = 0, originRevision = 0;
// Selecting a place on the existing Cesium globe is optional; GPS, typed
// addresses and the public routing provider remain separate concerns.
let mapPick = null, mapPickExpanded = false;
let originSource = 'manual', ridePickupFix = null, rideLocating = false, rideLocationSequence = 0, rideExpiryTimer;
const rideFixMaxAge = 30000;

panel.innerHTML = `
  <div class="wt-sheet-grab" aria-hidden="true"></div>
  <header class="wt-planner-head"><h2 id="wtTitle">Where to?</h2><span class="wt-status" id="wtDraftStatus">Draft</span><button type="button" id="wtActivity" class="wt-activity">${icon('clock')}<span>Activity</span><b aria-hidden="true">›</b></button></header>
  <form id="wtForm">
    <!-- THE TRIP CARD (owner's reference, 2026-10-19): pickup over destination, joined by a dotted thread. The pickup
         reads "Use my location" until the member types or pins something else; the globe pins sit inside each row. -->
    <div class="wt-fields wt-fields--main wt-trip">
      <div class="wt-field wt-origin-field"><span class="wt-trip-dot wt-trip-dot--from" aria-hidden="true"></span><label for="wtFrom">Pickup</label><input id="wtFrom" name="from" autocomplete="off" maxlength="240" placeholder="Use my location" aria-describedby="wtLocationStatus"><div class="wt-field-tools"><button type="button" id="wtPickFrom" class="wt-field-tool" data-map-pick="from" aria-pressed="false" aria-label="Pick your starting point on the globe" title="Pick on the globe">${icon('globe')}</button><button type="button" id="wtLocate" class="wt-locate wt-field-tool" aria-label="Use my current location" title="Use my location">${icon('target')}</button></div><div id="wtFromResults" class="wt-suggest" hidden></div></div>
      <div class="wt-field wt-destination-field"><span class="wt-trip-dot wt-trip-dot--to" aria-hidden="true"></span><label for="wtTo">Destination</label><input id="wtTo" name="to" autocomplete="off" maxlength="240" placeholder="Where would you like to go?" required aria-describedby="wtEndpointHint wtRoutePrivacy"><div class="wt-field-tools"><span class="wt-field-glyph" aria-hidden="true">${icon('search')}</span><button type="button" id="wtPickTo" class="wt-field-tool" data-map-pick="to" aria-pressed="false" aria-label="Pick your destination on the globe" title="Pick on the globe">${icon('globe')}</button></div><div id="wtToResults" class="wt-suggest" hidden></div></div>
    </div>
    <!-- trip type: Rides is the street route (drive, walk, bike, a ride); Flights and Multi-city open the longer-trip planner -->
    <nav class="wt-kinds" aria-label="Trip type"><button type="button" data-travel-chip="rides" aria-pressed="true">${icon('drive')}<span>Rides</span></button><button type="button" data-travel-chip="flights" aria-pressed="false">${icon('flight')}<span>Flights</span></button><button type="button" data-travel-chip="multi" aria-pressed="false">${icon('route')}<span>Multi-city</span></button></nav>
    <p id="wtLocationStatus" class="wt-location-status" role="status" aria-live="polite">Allow location, or enter your starting address.</p>
    <p id="wtEndpointHint" class="wt-location-status" role="status" aria-live="polite"></p>
    <p id="wtRoutePrivacy" class="wt-route-privacy">Choose a destination to get directions. Your starting point and destination are shared with the <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">routing provider</a>.</p>
    <!-- GO SOMEWHERE: real shortcuts only. Home and Work are not stored anywhere, so they are not offered. -->
    <section class="wt-go" id="wtGo" aria-labelledby="wtGoTitle"><h3 id="wtGoTitle" class="wt-section-h">Go somewhere</h3><div class="wt-go-row"><button type="button" data-travel-go="near">${icon('near')}<span>Near me</span></button><button type="button" data-travel-go="airports">${icon('flight')}<span>Airports</span></button><button type="button" data-travel-go="hotels">${icon('stay')}<span>Hotels</span></button><button type="button" data-travel-go="globe">${icon('globe')}<span>On the globe</span></button><button type="button" data-travel-go="saved">${icon('saved')}<span>Saved</span></button></div></section>
    <div id="wtGroundOptions" class="wt-ground-options" hidden>
      <nav class="wt-toolbar wt-local-toolbar" aria-label="Directions mode">${groundModes.map(m => `<button type="button" data-travel-kind="${m}" aria-pressed="${m === 'drive'}">${icon(m)}${labels[m]}</button>`).join('')}</nav>
      <button id="wtRide" class="wt-ride-button" type="button" aria-expanded="false" aria-controls="wtRidePanel">Get a ride</button>
    </div>
    <section id="wtRidePanel" class="wt-ride-panel" aria-labelledby="wtRideTitle" hidden>
      <h3 id="wtRideTitle">Get a ride</h3><p>Ride booking is not connected here yet.</p>
      <p id="wtRidePickup" class="wt-ride-pickup"></p>
      <p id="wtRideHint">Choose your pickup and destination to continue in Uber.</p>
      <a id="wtUber" target="_blank" rel="noopener noreferrer" hidden>Continue in Uber ↗</a>
      <button id="wtRideLocate" type="button" hidden>Refresh pickup location</button>
      <p id="wtRideLocationStatus" role="status" aria-live="polite"></p>
      <button id="wtRideDirections" type="button">Continue with driving directions</button>
    </section>
    <section id="wtDirections" class="wt-directions" aria-label="Route and navigation" hidden>
      <p id="wtRouteMessage" class="wt-route-message" role="status" aria-live="polite"></p>
      <div id="wtRouteCard" class="wt-route-card" hidden>
        <div id="wtRouteSummary" class="wt-route-summary"></div>
        <p id="wtRouteLabel" class="wt-route-label"></p>
        <div id="wtNavigation" class="wt-navigation" hidden>
          <div role="status" aria-live="polite" aria-atomic="true"><p id="wtNavDistance" class="wt-nav-distance"></p><h3 id="wtNavInstruction"></h3></div>
          <p id="wtNavRemaining" class="wt-nav-remaining"></p>
        </div>
      </div>
      <div class="wt-route-actions"><button id="wtNavigate" class="wt-primary" type="button">Get directions</button><button id="wtStopNavigation" type="button" hidden>Stop navigation</button><button id="wtRecenter" type="button" hidden>Recenter</button></div>
      <p id="wtDirectionsHint" class="wt-navigation-hint"></p>
      <details id="wtSteps" class="wt-steps" hidden><summary>Step-by-step directions</summary><ol id="wtRouteSteps"></ol></details>
      <p id="wtRouteAttribution" class="wt-attribution" hidden></p>
    </section>
    <details id="wtOptions" class="wt-options" hidden><summary>Plan a longer trip</summary>
      <nav class="wt-toolbar wt-long-toolbar" aria-label="Longer trip options">${['flight','train','stay'].map(m => `<button type="button" data-travel-kind="${m}" ${m !== 'stay' ? 'aria-pressed="false"' : ''}>${icon(m)}${labels[m]}</button>`).join('')}</nav>
      <div class="wt-fields"><label class="wt-field"><span>Departure</span><input id="wtDeparture" name="departure" type="date"></label><label class="wt-field"><span>Travelers</span><select id="wtTravelers" name="travelers">${Array.from({ length:16 }, (_, i) => `<option value="${i+1}">${i+1} ${i ? 'travelers':'traveler'}</option>`).join('')}</select></label></div>
      <div class="wt-date-row"><button type="button" id="wtSwap" aria-label="Swap origin and destination">Swap places ⇄</button><button type="button" id="wtAddReturn" aria-expanded="false">Add return date</button><label class="wt-field wt-return" id="wtReturnField" hidden><span>Return</span><input id="wtReturning" type="date" name="returning"></label></div>
      <details class="wt-details" id="wtDetails"><summary>Airports, stations &amp; final address</summary><div class="wt-fields">
        <label class="wt-field"><span>Departure airport or station</span><input id="wtDepartureHub" name="departureHub" maxlength="240" placeholder="Choose your departure point"></label>
        <label class="wt-field"><span>Arrival airport or station</span><input id="wtArrivalHub" name="arrivalHub" maxlength="240" placeholder="Choose your arrival point"></label>
        <label class="wt-field"><span>Your stay or final address</span><input id="wtStay" name="stay" maxlength="240" placeholder="Hotel, address or place name"></label>
      </div></details>
      <div id="wtItinerary"></div><div id="wtStaySearch" class="wt-stay-search" hidden></div>
      <div class="wt-actions"><button class="wt-primary" id="wtPlan" type="submit" hidden>Plan journey <span aria-hidden="true">→</span></button></div>
    </details>
    <!-- PLAN A TRIP: both cards open the planning draft that already exists; nothing is priced or booked here -->
    <section class="wt-plan" aria-labelledby="wtPlanTitle"><h3 id="wtPlanTitle" class="wt-section-h">Plan a trip</h3><div class="wt-plan-cards"><button type="button" data-travel-plan="flights"><span class="wt-plan-icon">${icon('flight')}</span><span class="wt-plan-text"><strong>Search flights</strong><small>Compare dates and routes</small></span><b aria-hidden="true">›</b></button><button type="button" data-travel-plan="multi"><span class="wt-plan-icon">${icon('luggage')}</span><span class="wt-plan-text"><strong>Door-to-door</strong><small>Rides + flights + rides in one draft</small></span><b aria-hidden="true">›</b></button></div></section>
    <div id="wtSaveRow" class="wt-save-row" hidden><button class="wt-text-button" id="wtSave" type="button">Save journey</button></div>
  </form>
  <div class="wt-footer" id="wtSaveFooter" hidden><p id="wtSaveHint">Your saved journeys are private.</p><button class="wt-text-button" type="button" id="wtSaved">Saved journeys</button></div>
  <p class="wt-attribution">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Fix the map</a> · <a href="mailto:matthew@mccluster.org">Contact</a></p><p class="wt-message" id="wtMessage" role="status" aria-live="polite"></p>`;

const dialog = document.createElement('dialog');
dialog.className = 'wt-saved'; dialog.id = 'wtSavedDialog';
dialog.setAttribute('aria-labelledby', 'wtSavedTitle'); dialog.setAttribute('data-private', '');
dialog.innerHTML = '<header><h2 id="wtSavedTitle">Your journeys</h2><button type="button" id="wtSavedClose" aria-label="Close saved journeys">×</button></header><p id="wtSavedMessage" role="status"></p><div id="wtSavedList"></div><button type="button" id="wtNew">Start a new journey</button>';
document.body.append(dialog);
// These overlays live above the same globe iframe, including when the
// expanded map temporarily hides the scrolling directions panel.
const pickBanner = document.createElement('div');
pickBanner.id = 'wtMapPickBanner'; pickBanner.className = 'wt-map-pick-banner'; pickBanner.hidden = true;
pickBanner.innerHTML = '<span id="wtMapPickPrompt" role="status" aria-live="polite"></span><button id="wtMapPickCancel" type="button">Cancel</button>';
const mapNav = document.createElement('div');
mapNav.id = 'wtMapNav'; mapNav.className = 'wt-map-nav'; mapNav.hidden = true;
mapNav.innerHTML = '<p id="wtMapNavSummary" role="status" aria-live="polite"></p><div class="wt-map-nav-actions"><button id="wtMapNavGo" type="button">Go</button><button id="wtMapNavStop" type="button" hidden>Stop</button><button id="wtMapNavRecenter" type="button" hidden>Recenter</button></div>';
$('mnWorld').append(pickBanner, mapNav);
$('wtSavedClose').onclick = () => dialog.close();
dialog.addEventListener('click', e => {
  if (e.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dialog.close();
});

function closeSearches() { addressController?.abort(); searchClosers.forEach(close => close()); }
async function catalog() {
  if (!catalogPromise) catalogPromise = fetch('data/travel/cities.json', { signal:AbortSignal.timeout(12000) })
    .then(r => { if (!r.ok) throw Error('Place search is unavailable. Try again shortly.'); return r.json(); })
    .catch(e => { catalogPromise = null; throw e; });
  return catalogPromise;
}
function cancelLocate() {
  locationSequence++; originRevision++; locating = false; $('wtLocate').disabled = false;
  send({ type:'hu:location-state', busy:false });
  if ($('wtLocationStatus').textContent === 'Finding your starting point…') $('wtLocationStatus').textContent = 'Use location, or choose your starting address.';
}
function cancelRideRefresh() {
  rideLocationSequence++; rideLocating = false; clearTimeout(rideExpiryTimer);
  $('wtRideLocate').disabled = false; $('wtRideLocationStatus').textContent = '';
}
function stopNavigation(message = '', { resetProgress = false } = {}) {
  navigationSequence++;
  if (navigationWatch !== null) navigator.geolocation?.clearWatch(navigationWatch);
  navigationWatch = null; navigating = false; offRouteFixes = 0;
  if (routeState === 'rerouting') {
    routeSequence++; routeController?.abort(); routeController = null;
    route = null; routeState = 'idle'; send({ type:'hu:route', route:null });
  }
  if (resetProgress) progress = null;
  navigationNotice = message;
  root.classList.remove('wt-navigating');
  if (liveFix) send({ type:'hu:location', coordinates:liveFix.coordinates, accuracy:liveFix.accuracy, follow:false });
}
function invalidateRoute({ clearPosition = false, preserveOriginLookup = false } = {}) {
  stopNavigation('', { resetProgress:true }); if (!preserveOriginLookup) cancelLocate(); cancelRideRefresh();
  routeSequence++; routeController?.abort(); routeController = null;
  route = null; routeState = 'idle'; routeError = ''; retryOrigin = null;
  send({ type:'hu:route', route:null });
  if (clearPosition) { liveFix = null; ridePickupFix = null; send({ type:'hu:location', coordinates:null }); }
  $('wtRidePanel').hidden = true; $('wtRide').setAttribute('aria-expanded', 'false');
}
function changed({ preserveOriginLookup = false } = {}) {
  invalidateRoute({ preserveOriginLookup }); dirty = true; revision++;
  $('wtDraftStatus').textContent = savedId ? 'Unsaved' : 'Draft'; status();
}
function read() {
  const pick = (key, id) => {
    const label = $(id).value.trim();
    return label ? { label, coordinates:draft[key]?.label === label ? draft[key].coordinates : null } : null;
  };
  return normalizeJourney({ ...draft, from:pick('from', 'wtFrom'), to:pick('to', 'wtTo'),
    departure:$('wtDeparture').value, returning:$('wtReturning').value, travelers:Number($('wtTravelers').value),
    departureHub:$('wtDepartureHub').value, arrivalHub:$('wtArrivalHub').value, stay:$('wtStay').value,
    lowestCost:draft.lowestCost, freeOptions:draft.freeOptions });
}
function renderGlobe(fly = false) {
  const travel = currentMode === 'travel';
  root.classList.toggle('wt-local-map', travel && (!!route || !!liveFix));
  send({ type:'hu:travel-mode', on:travel });
  send({ type:'hu:map-pick-mode', kind:travel ? mapPick : null });
  send({ type:'hu:journey', points:[draft.from, draft.to].filter(hasCoordinates).map(p => ({ label:p.label.split(',')[0], coordinates:p.coordinates })), connect:draft.mode === 'flight', fly });
  send({ type:'hu:route', route:travel && route ? { geometry:route.geometry, origin:route.origin, destination:route.destination } : null, fly });
  send({ type:'hu:location', coordinates:travel ? liveFix?.coordinates || null : null, accuracy:liveFix?.accuracy, follow:travel && navigating && navigationFollow, fly:fly && !route });
  const dest = $('wtDestination'); dest.hidden = !travel || !!route || !hasCoordinates(draft.to);
  if (!dest.hidden) {
    dest.replaceChildren(); const title = document.createElement('strong'), sub = document.createElement('small');
    title.textContent = draft.to.label.split(',')[0];
    sub.textContent = draft.to.label.split(',').slice(1).join(',').trim() || 'Your destination'; dest.append(title, sub);
  }
}
function renderMapNav() {
  const visible = currentMode === 'travel' && root.classList.contains('wt-expanded') && !!route && !mapPick;
  mapNav.hidden = !visible;
  if (!visible) return;
  $('wtMapNavSummary').textContent = navigating
    ? progress?.nextStep?.instruction || navigationNotice || 'Following your route…'
    : `${labels[route.mode] || 'Route'} · ${durationText(route.durationSeconds)} · ${distanceText(route.distanceMeters)}`;
  $('wtMapNavGo').hidden = navigating;
  $('wtMapNavGo').disabled = navigating || !route || ['loading','rerouting'].includes(routeState);
  $('wtMapNavStop').hidden = !navigating;
  $('wtMapNavRecenter').hidden = !navigating || navigationFollow || !liveFix;
}
function distanceText(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 160.934) return `${Math.max(0, Math.round(meters * 3.28084 / 10) * 10)} ft`;
  const miles = meters / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
function durationText(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours} hr${rest ? ` ${rest} min` : ''}`;
}
function renderSteps() {
  const list = $('wtRouteSteps'); list.replaceChildren();
  for (const [index, step] of (route?.steps || []).entries()) {
    const item = document.createElement('li'), button = document.createElement('button');
    const instruction = document.createElement('span'), distance = document.createElement('small');
    button.type = 'button'; button.dataset.stepIndex = String(index);
    instruction.textContent = step.instruction; distance.textContent = distanceText(step.distanceMeters);
    button.append(instruction, distance);
    button.onclick = () => {
      if (!route || !hasCoordinates({ coordinates:step.location })) return;
      navigationFollow = false;
      if (liveFix) send({ type:'hu:location', coordinates:liveFix.coordinates, accuracy:liveFix.accuracy, follow:false });
      send({ type:'hu:route-step', coordinates:step.location }); renderDirections();
    };
    item.append(button); list.append(item);
  }
}
function endpointHint() {
  if (draft.to && !hasCoordinates(draft.to)) return 'Choose a destination from the suggestions to get a precise route.';
  if (hasCoordinates(draft.to) && !hasCoordinates(draft.from)) return 'Use your location, or choose a starting address from the suggestions.';
  return '';
}
function currentRideFix() {
  return [liveFix, ridePickupFix].filter(fix => fix && fix.accuracy <= 100 && Date.now() - fix.timestamp >= 0 && Date.now() - fix.timestamp < rideFixMaxAge)
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}
function renderRide() {
  clearTimeout(rideExpiryTimer);
  const resolved = hasCoordinates(draft.from) && hasCoordinates(draft.to), devicePickup = originSource === 'device';
  const fix = devicePickup ? currentRideFix() : null, ready = resolved && (!devicePickup || !!fix), link = $('wtUber');
  link.hidden = !ready; link.removeAttribute('href');
  $('wtRidePickup').textContent = devicePickup ? fix ? 'Pickup: Your current location' : 'Pickup: Your current location needs refreshing' : draft.from ? `Pickup: ${draft.from.label}` : 'Choose your pickup address.';
  $('wtRideLocate').hidden = !resolved || !devicePickup; $('wtRideLocate').disabled = rideLocating;
  $('wtRideLocate').textContent = rideLocating ? 'Refreshing pickup…' : 'Refresh pickup location';
  $('wtRideHint').textContent = ready ? 'Review availability, price and confirm your ride in Uber. Your pickup and destination are shared when you continue.' : resolved && devicePickup ? 'Refresh your current pickup, or choose a starting address, before continuing in Uber.' : 'Choose your pickup and destination to continue in Uber.';
  if (ready) {
    try { link.href = rideHandoff({ origin:fix?.coordinates || draft.from.coordinates, destination:draft.to.coordinates, originLabel:devicePickup ? 'Current location' : draft.from.label, destinationLabel:draft.to.label }); }
    catch { link.hidden = true; $('wtRideHint').textContent = 'Choose a pickup and destination before continuing in Uber.'; }
  }
  if (fix && !$('wtRidePanel').hidden && hostVisible && !document.hidden) rideExpiryTimer = setTimeout(renderRide, Math.max(50, fix.timestamp + rideFixMaxAge - Date.now() + 10));
}
function renderDirections() {
  renderMapNav();
  const destinationReady = hasCoordinates(draft.to), endpointsReady = destinationReady && hasCoordinates(draft.from);
  $('wtEndpointHint').textContent = endpointHint();
  $('wtGroundOptions').hidden = !destinationReady; $('wtOptions').hidden = !destinationReady; $('wtGo').hidden = destinationReady;
  $('wtSaveRow').hidden = !account() || !draft.from || !draft.to;
  $('wtDirections').hidden = !destinationReady || (!isGround() && draft.mode !== 'transit');
  renderRide();
  const button = $('wtNavigate'), loading = ['loading', 'rerouting'].includes(routeState);
  button.disabled = !endpointsReady || loading || !isGround(); button.hidden = navigating;
  button.textContent = loading ? 'Finding your route…' : route ? 'Go' : routeState === 'error' ? 'Try route again' : 'Get directions';
  button.setAttribute('aria-label', route ? 'Go — start live navigation' : button.textContent);
  $('wtStopNavigation').hidden = !navigating; $('wtRecenter').hidden = !navigating || navigationFollow || !liveFix;
  $('wtRouteCard').hidden = !route; $('wtSteps').hidden = !route; $('wtRouteAttribution').hidden = !route;
  $('wtRouteMessage').textContent = routeState === 'loading' ? 'Finding a route between your selected places…' : routeState === 'rerouting' ? 'Recalculating from your current location…' : routeError || (draft.mode === 'transit' ? 'Transit directions are not connected here yet. Choose Drive, Walk or Bike.' : '');
  $('wtDirectionsHint').textContent = navigationNotice || (route ? `${route.traffic ? 'Travel time is an estimate.' : 'Estimated time without live traffic.'} Keep this page open for navigation.` : endpointsReady ? 'Your route and directions will appear here.' : 'Choose both places before finding a route.');
  if (!route) {
    $('wtRouteSummary').replaceChildren(); $('wtRouteSteps').replaceChildren();
    $('wtRouteLabel').textContent = ''; $('wtRouteAttribution').textContent = '';
    $('wtNavigation').hidden = true;
    for (const id of ['wtNavDistance', 'wtNavInstruction', 'wtNavRemaining']) $(id).textContent = '';
    return;
  }
  const summary = $('wtRouteSummary'); summary.replaceChildren();
  const duration = document.createElement('strong'), distance = document.createElement('span');
  duration.textContent = durationText(route.durationSeconds); distance.textContent = distanceText(route.distanceMeters); summary.append(duration, distance);
  $('wtRouteLabel').textContent = `${labels[route.mode] || 'Route'} · ${route.traffic ? 'Estimated with live traffic' : 'No live traffic'}${route.fromLive ? ' · From your current location' : ''}`;
  $('wtRouteAttribution').textContent = String(route.attribution || '© OpenStreetMap contributors');
  const showNavigation = navigating || progress?.arrived === true; $('wtNavigation').hidden = !showNavigation;
  if (showNavigation) {
    $('wtNavDistance').textContent = progress?.arrived ? 'Destination reached' : progress?.nextStep?.maneuver.type === 'depart' ? 'Start here' : progress?.nextStep ? progress.distanceToNextMeters < 10 ? 'Now' : `In ${distanceText(progress.distanceToNextMeters)}` : 'Live directions';
    $('wtNavInstruction').textContent = progress?.arrived ? 'You’ve arrived.' : progress?.nextStep?.instruction || 'Finding your location…';
    $('wtNavRemaining').textContent = progress?.arrived ? 'Route complete.' : progress ? `${distanceText(progress.remainingDistanceMeters)} remaining · about ${durationText(progress.remainingSeconds)}` : 'Waiting for a location fix.';
  }
  $('wtRouteSteps').querySelectorAll('[data-step-index]').forEach(step => {
    if (showNavigation && Number(step.dataset.stepIndex) === progress?.stepIndex) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}
function renderItinerary() {
  renderDirections(); const longDistance = ['flight', 'train'].includes(draft.mode), box = $('wtItinerary'); $('wtPlan').hidden = !longDistance;
  const stays = $('wtStaySearch'); stays.replaceChildren(); stays.hidden = true;
  if (!longDistance) {
    box.replaceChildren();
    if (draft.from && draft.to) {
      const action = legAction(draft, 'stay');
      if (action.url) {
        const link = document.createElement('a'); link.href = action.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Search places to stay ↗';
        const note = document.createElement('p'); note.className = 'wt-note'; note.textContent = 'Opens a search. No stay is booked here.'; stays.append(link, note); stays.hidden = false;
      }
    }
    return;
  }
  const legs = itinerary(draft);
  if (!legs.length) { box.innerHTML = '<p class="wt-note">Choose your starting point and destination to plan the rest of your trip.</p>'; return; }
  box.innerHTML = '<div class="wt-legs">' + legs.map(leg => {
    const action = legAction(draft, leg.id);
    const label = action.type === 'edit' ? 'Add details' : action.type === 'directions' ? 'Open transfer directions ↗' : leg.kind === 'stay' ? 'Search stays ↗' : `Search ${leg.kind === 'flight' ? 'flights' : 'trains'} ↗`;
    return `<article class="wt-leg"><span class="wt-leg-symbol">${icon(leg.kind)}</span><div><strong>${esc(leg.title)}</strong><small>${esc(leg.subtitle)}</small></div>${action.url ? `<a href="${esc(action.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} for ${esc(leg.title)} (opens Google)">${label}</a>` : `<button type="button" data-edit="${esc(action.field)}">${label} →</button>`}</article>`;
  }).join('') + '</div><p class="wt-note">Longer trips are planning drafts. Searches and transfer links open Google; tickets, rides and stays are not booked here.</p>';
}
function syncInputs() {
  $('wtFrom').value = draft.from?.label || ''; $('wtTo').value = draft.to?.label || '';
  for (const [key, id] of [['departure','wtDeparture'],['returning','wtReturning'],['travelers','wtTravelers'],['departureHub','wtDepartureHub'],['arrivalHub','wtArrivalHub'],['stay','wtStay']]) $(id).value = draft[key];
  $('wtReturnField').hidden = !draft.returning; $('wtAddReturn').setAttribute('aria-expanded', String(!!draft.returning));
  $('wtAddReturn').textContent = draft.returning ? 'Remove return' : 'Add return date'; $('wtReturning').min = draft.departure;
  panel.querySelectorAll('[data-travel-kind][aria-pressed]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.travelKind === draft.mode)));
  if (isGround() || draft.mode === 'transit') tripShape = 'rides'; else if (tripShape === 'rides') tripShape = 'flights';
  panel.querySelectorAll('[data-travel-chip]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.travelChip === tripShape)));
  renderItinerary(); renderGlobe();
}
function setMapPick(kind = null) {
  if (kind !== null && !['from','to'].includes(kind)) return;
  if (kind && (currentMode !== 'travel' || !hostVisible || document.hidden)) return;
  if (kind && !root.classList.contains('wt-expanded')) {
    root.classList.add('wt-expanded'); mapPickExpanded = true;
    expanded.setAttribute('aria-label', 'Return to directions');
  }
  mapPick = kind;
  if (!kind && mapPickExpanded) {
    root.classList.remove('wt-expanded'); mapPickExpanded = false;
    expanded.setAttribute('aria-label', 'Expand the map');
  }
  pickBanner.hidden = !kind;
  $('wtMapPickPrompt').textContent = kind ? `Tap the globe to set your ${kind === 'from' ? 'starting point' : 'destination'}.` : '';
  for (const button of panel.querySelectorAll('[data-map-pick]'))
    button.setAttribute('aria-pressed', String(button.dataset.mapPick === kind));
  send({ type:'hu:map-pick-mode', kind });
  renderMapNav();
}
function choosePlace(key, row, { source = 'manual' } = {}) {
  draft = read(); draft[key] = ['from', 'to'].includes(key) ? { label:row.label, coordinates:row.coordinates } : row.label;
  if (key === 'from') { originSource = source; ridePickupFix = null; }
  changed({ preserveOriginLookup:key === 'to' }); closeSearches(); syncInputs(); renderGlobe(true);
  if (key === 'from') $('wtLocationStatus').textContent = liveFix ? 'Starting from your selected address. The blue dot shows your last location.' : 'Starting from your selected address.';
  if (key === 'from' || key === 'to') void requestRoute({ reveal:true });
}
// Cross-origin music chrome cannot be covered by the iframe's own z-index.
function announceAddressPicking(){
  const active=!!panel.querySelector('.wt-suggest:not([hidden])');
  window.dispatchEvent(new CustomEvent('mcc:travel-autocomplete',{detail:{active}}));
}
function autocomplete(id, resultId, key) {
  const input = $(id), results = $(resultId); let seq = 0, timer;
  const refit = () => fitSuggestions(results, input, { scrolled:true });
  window.addEventListener('resize', refit, { passive:true }); window.visualViewport?.addEventListener('resize', refit, { passive:true });
  $('mnWorldFeed').addEventListener('scroll', refit, { passive:true });
  // announceAddressPicking() fires right after a list is shown: fit it then, so the
  // measurement happens with the options rendered and the viewport settled.
  window.addEventListener('mcc:travel-autocomplete', e => { if (e.detail?.active && !results.hidden) fitSuggestions(results, input); });
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', resultId); input.setAttribute('aria-expanded', 'false'); results.setAttribute('role', 'listbox');
  const close = () => { seq++; clearTimeout(timer); results.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-busy'); announceAddressPicking(); };
  searchClosers.push(close);
  input.addEventListener('input', () => {
    close(); addressController?.abort(); addressController = new AbortController(); const signal = addressController.signal;
    const request = seq, query = input.value.trim(); if (query.length < 3) return;
    timer = setTimeout(async () => {
      input.setAttribute('aria-busy', 'true');
      try {
        let matches, fallback = false;
        try { matches = await addressSearch(query, signal); }
        catch { if (signal.aborted) return; matches = searchCities(await catalog(), query); fallback = true; }
        if (request !== seq || input.value.trim() !== query || currentMode !== 'travel' || signal.aborted) return;
        results.replaceChildren();
        for (const row of matches) {
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option'); button.textContent = row.label;
          button.onclick = e => { try { input.blur(); choosePlace(key, row); close(); if (!e.detail) input.focus({ preventScroll:true }); } catch (error) { status(error.message); } }; results.append(button);
        }
        if (fallback || !matches.length) {
          const note = document.createElement('small'); note.className = 'wt-search-note';
          note.textContent = fallback ? 'Address search is unavailable. These city matches lead to a city center; try again for a precise address.' : 'No matching place yet. Add the street number, city or postal code, then choose a result.'; results.append(note);
        }
        results.hidden = false; input.setAttribute('aria-expanded', 'true'); announceAddressPicking();
      } catch { if (request === seq && !signal.aborted) status('Address search is unavailable. Try again shortly; directions need a selected location.'); }
      finally { if (request === seq) input.removeAttribute('aria-busy'); }
    }, 650);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && !results.hidden) { e.preventDefault(); results.querySelector('button')?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  results.addEventListener('keydown', e => {
    const buttons = [...results.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
      e.preventDefault(); if (e.key === 'Escape') { close(); input.focus(); }
      else buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  });
  document.addEventListener('pointerdown', e => { if (!results.contains(e.target) && e.target !== input) close(); });
  input.addEventListener('focusout', e => { if (e.relatedTarget && !results.contains(e.relatedTarget)) close(); });
  results.addEventListener('focusout', e => { if (e.relatedTarget !== input && !results.contains(e.relatedTarget)) close(); });
}
for (const [id, key] of [['wtFrom','from'],['wtTo','to'],['wtDepartureHub','departureHub'],['wtArrivalHub','arrivalHub'],['wtStay','stay']]) {
  let results = $(id + 'Results');
  if (!results) { results = document.createElement('span'); results.id = id + 'Results'; results.className = 'wt-suggest'; results.hidden = true; $(id).after(results); $(id).autocomplete = 'off'; }
  autocomplete(id, results.id, key);
}

async function requestRoute({ reroute = false, originOverride = null, reveal = false } = {}) {
  if (!isGround() || !hasCoordinates(draft.from) || !hasCoordinates(draft.to) || !hostVisible || currentMode !== 'travel' || document.hidden) { renderDirections(); return; }
  if (routeState === 'loading' && !reroute) return;
  const origin = originOverride || draft.from.coordinates, destination = [...draft.to.coordinates], mode = draft.mode;
  if (!hasCoordinates({ coordinates:origin })) return;
  routeController?.abort(); const controller = new AbortController(); routeController = controller;
  const request = ++routeSequence, version = revision, epoch = tripEpoch;
  routeState = reroute ? 'rerouting' : 'loading'; routeError = ''; retryOrigin = originOverride; renderDirections();
  if (reveal) $('wtNavigate').scrollIntoView({ block:'nearest', behavior:'auto' });
  try {
    const result = await fetchRoute({ origin:[...origin], destination, mode }, { signal:controller.signal });
    if (controller.signal.aborted || request !== routeSequence || version !== revision || epoch !== tripEpoch || currentMode !== 'travel' || document.hidden) return;
    route = { ...result, origin:[...origin], destination, mode, fromLive:!!originOverride };
    routeState = 'ready'; routeError = ''; retryOrigin = null; progress = null; offRouteFixes = 0;
    renderSteps(); renderDirections(); renderGlobe(!navigating);
    if (reveal) $('wtRouteCard').scrollIntoView({ block:'start', behavior:'auto' });
    if (navigating && liveFix) applyFix(liveFix, false);
  } catch (error) {
    if (controller.signal.aborted || request !== routeSequence || version !== revision || epoch !== tripEpoch) return;
    stopNavigation('', { resetProgress:true }); route = null; routeState = 'error';
    routeError = error?.message || 'Directions could not be loaded. Try again or choose another starting point.';
    send({ type:'hu:route', route:null }); renderSteps(); renderDirections();
    if (reveal) $('wtRouteMessage').scrollIntoView({ block:'start', behavior:'auto' });
  } finally { if (request === routeSequence) routeController = null; }
}
function locationError(error) {
  if (error?.code === 1) return 'Location access is off. Enter your starting address, or enable location in your browser settings.';
  return 'Your location could not be found. Try again or enter your starting address.';
}
function positionFix(position) {
  const coordinates = [position?.coords?.longitude, position?.coords?.latitude], accuracy = position?.coords?.accuracy;
  if (!hasCoordinates({ coordinates }) || !Number.isFinite(accuracy) || accuracy < 0) throw Error('Your location could not be read. Try again or enter your starting address.');
  return { coordinates, accuracy, timestamp:Number.isFinite(position.timestamp) ? position.timestamp : Date.now() };
}
async function locate({ automatic = false } = {}) {
  if (locating || !hostVisible || currentMode !== 'travel') return;
  if (!navigator.geolocation) { $('wtLocationStatus').textContent = 'Location is unavailable here. Enter your starting address.'; $('wtFrom').focus(); return; }
  const wasNavigating = navigating, navigationVersion = navigationSequence;
  closeSearches(); if (!wasNavigating) invalidateRoute(); renderDirections(); locating = true; autoLocated = true;
  const request = ++locationSequence, fromVersion = originRevision, initialFrom = $('wtFrom').value, epoch = tripEpoch, owner = account();
  $('wtLocate').disabled = true; $('wtLocationStatus').textContent = 'Finding your starting point…';
  send({ type:'hu:location-state', busy:true });
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:12000, maximumAge:automatic ? 60000 : 0 }));
    if (request !== locationSequence) return;
    if (originRevision !== fromVersion || $('wtFrom').value !== initialFrom || epoch !== tripEpoch || account() !== owner || currentMode !== 'travel' || document.hidden || (wasNavigating && (!navigating || navigationSequence !== navigationVersion))) { cancelLocate(); return; }
    const fix = positionFix(position);
    if (wasNavigating) {
      navigationFollow = true;
      if (!liveFix || fix.timestamp > liveFix.timestamp) { liveFix = fix; applyFix(fix); }
      send({ type:'hu:location', coordinates:liveFix.coordinates, accuracy:liveFix.accuracy, follow:navigating, fly:true });
      $('wtLocationStatus').textContent = 'Location updated.'; renderDirections(); return;
    }
    choosePlace('from', { label:'Current location', coordinates:fix.coordinates }, { source:'device' }); liveFix = fix;
    $('wtLocationStatus').textContent = fix.accuracy > 100 ? 'Using your approximate location. Choose an address for a more precise starting point.' : 'Starting from your current location.';
    root.classList.add('wt-local-map');
    send({ type:'hu:location', coordinates:fix.coordinates, accuracy:fix.accuracy, fly:true }); renderDirections();
  } catch (error) {
    if (request === locationSequence) $('wtLocationStatus').textContent = typeof error?.code === 'number' ? locationError(error) : error?.message || locationError(error);
  } finally { if (request === locationSequence) { locating = false; $('wtLocate').disabled = false; send({ type:'hu:location-state', busy:false }); } }
}
function autoLocate() {
  if (autoLocated || !hostVisible || currentMode !== 'travel' || !root.classList.contains('mn-world-on') || draft.from || !window.MCC_PRIVACY?.accepted?.()) return;
  autoLocated = true;
  try { if (sessionStorage.getItem('wt_location_asked')) return; sessionStorage.setItem('wt_location_asked', '1'); } catch { /* Location remains optional when browser storage is unavailable. */ }
  void locate({ automatic:true });
}
async function refreshRidePickup() {
  if (rideLocating || originSource !== 'device' || !hasCoordinates(draft.from) || !hasCoordinates(draft.to) || !hostVisible || currentMode !== 'travel' || document.hidden) return;
  if (!navigator.geolocation) { $('wtRideLocationStatus').textContent = 'Location is unavailable. Choose a starting address for pickup.'; return; }
  rideLocating = true;
  const request = ++rideLocationSequence, version = revision, epoch = tripEpoch, fromVersion = originRevision, owner = account();
  $('wtRideLocationStatus').textContent = 'Finding your current pickup…'; renderRide();
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:12000, maximumAge:0 }));
    if (request !== rideLocationSequence || version !== revision || epoch !== tripEpoch || fromVersion !== originRevision || owner !== account() || currentMode !== 'travel' || document.hidden || $('wtRidePanel').hidden) return;
    const fix = positionFix(position);
    if (fix.accuracy > 100 || Date.now() - fix.timestamp >= rideFixMaxAge) { $('wtRideLocationStatus').textContent = 'Pickup location is not precise enough yet. Try again or choose a starting address.'; return; }
    ridePickupFix = fix;
    if (!liveFix || fix.timestamp >= liveFix.timestamp) liveFix = fix;
    root.classList.add('wt-local-map');
    $('wtRideLocationStatus').textContent = 'Pickup updated to your current location. Review the pickup pin in Uber.';
    send({ type:'hu:location', coordinates:fix.coordinates, accuracy:fix.accuracy, follow:navigating && navigationFollow, fly:!navigating });
  } catch (error) { if (request === rideLocationSequence) $('wtRideLocationStatus').textContent = typeof error?.code === 'number' ? locationError(error) : error?.message || locationError(error); }
  finally { if (request === rideLocationSequence) { rideLocating = false; renderRide(); } }
}
function applyFix(fix, allowReroute = true) {
  if (!navigating || !route || !hostVisible) return;
  const next = navigationProgress(route, fix.coordinates, { accuracy:fix.accuracy, previousProgressMeters:progress?.distanceAlongMeters || 0 });
  send({ type:'hu:location', coordinates:fix.coordinates, accuracy:fix.accuracy, follow:navigationFollow && next.usable !== false });
  if (next.usable === false) { offRouteFixes = 0; navigationNotice = 'Location accuracy is low. Waiting for a clearer signal…'; renderDirections(); return; }
  progress = next;
  if (next.arrived) { stopNavigation('You’ve reached your destination. Location tracking has stopped.'); renderDirections(); return; }
  if (next.offRoute) {
    offRouteFixes++; navigationNotice = 'You are away from this route. Checking your location…';
    if (allowReroute && offRouteFixes >= 2 && Date.now() - lastRerouteAt >= 30000 && routeState !== 'rerouting') {
      lastRerouteAt = Date.now(); offRouteFixes = 0; navigationNotice = 'Recalculating your route…'; void requestRoute({ reroute:true, originOverride:fix.coordinates });
    }
  } else { offRouteFixes = 0; navigationNotice = ''; }
  renderDirections();
}
// Keep every suggestion reachable: the list may not run under the fixed app
// bar, the transport or the keyboard-shrunk viewport. It scrolls inside itself.
function fitSuggestions(results, input, { scrolled = false } = {}) {
  if (results.hidden) return;
  const room = () => {
    const top = results.getBoundingClientRect().top;
    const limits = [window.visualViewport?.height ?? innerHeight];
    // Embedded under the Music continuity shell this document's own app bar is
    // hidden and the parent's retained bar and transport sit over its bottom
    // edge. The bridge reserves their height in --mn-bar-clear; honour it.
    if (document.body.dataset.worldAudioChild === 'ready') {
      const clearance = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear')) || 0;
      if (clearance > 0) limits.push((window.visualViewport?.height ?? innerHeight) - clearance);
    }
    for (const selector of ['.appbar', '#mccWorldAudioControls']) {
      const el = document.querySelector(selector);
      if (el && el.offsetHeight && getComputedStyle(el).visibility !== 'hidden') { const r = el.getBoundingClientRect(); if (r.top > top) limits.push(r.top); }
    }
    return Math.floor(Math.min(...limits) - top - 8);
  };
  let available = room();
  // With the keyboard open the field can sit at the bottom of the visible area.
  // Bring it to the top of the panel once so the list has somewhere to open.
  if (available < 132 && !scrolled && input) { input.scrollIntoView({ block:'start', behavior:'auto' }); available = room(); }
  results.style.maxHeight = `${Math.max(132, available)}px`;
}
function startNavigation() {
  if (!route || navigating || !hostVisible || currentMode !== 'travel' || document.hidden) return;
  cancelLocate(); navigating = true; offRouteFixes = 0; navigationFollow = true;
  // Directions start at the route's first step right away. A live location
  // fix refines them; a missing or denied location never blocks Go.
  try { progress = navigationProgress(route, route.origin, { accuracy:0, previousProgressMeters:0 }); } catch { progress = null; }
  const request = ++navigationSequence; let lastWatchTimestamp = 0, watchId = null;
  root.classList.add('wt-navigating');
  const stepsOnly = message => { navigationWatch = null; if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch {} watchId = null; } navigationNotice = message; renderDirections(); };
  if (!navigator.geolocation) { stepsOnly('Live location is unavailable here. Follow the steps below from your starting point.'); $('wtNavigation').scrollIntoView({ block:'start', behavior:'auto' }); return; }
  navigationNotice = 'Finding your location. Keep this page open for live directions.';
  renderDirections();
  $('wtNavigation').scrollIntoView({ block:'start', behavior:'auto' });
  try {
    watchId = navigator.geolocation.watchPosition(position => {
      if (request !== navigationSequence || !navigating || document.hidden || currentMode !== 'travel') return;
      try {
        const fix = positionFix(position);
        if (Date.now() - fix.timestamp > 20000 || fix.timestamp <= lastWatchTimestamp || (liveFix && fix.timestamp < liveFix.timestamp)) { navigationNotice = 'Waiting for a fresh location fix…'; renderDirections(); return; }
        lastWatchTimestamp = fix.timestamp;
        liveFix = fix; applyFix(fix);
      } catch (error) { stopNavigation(error.message, { resetProgress:true }); renderDirections(); }
    }, error => {
      if (request !== navigationSequence || !navigating) return;
      stepsOnly(error?.code === 1 ? 'Location access is off. Follow the steps below; enable location for live guidance.' : 'Live location was interrupted. Follow the steps below, or tap Stop and then Go to retry.');
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:5000 });
    if (request !== navigationSequence || !navigating) navigator.geolocation.clearWatch(watchId);
    else navigationWatch = watchId;
  } catch { stepsOnly('Live location could not start. Follow the steps below from your starting point.'); }
}
$('wtLocate').onclick = () => void locate();
$('wtNavigate').onclick = () => {
  if (!hasCoordinates(draft.from) || !hasCoordinates(draft.to)) { status(endpointHint()); (!hasCoordinates(draft.from) ? $('wtFrom') : $('wtTo')).focus(); return; }
  if (route) startNavigation(); else void requestRoute({ originOverride:retryOrigin });
};
$('wtStopNavigation').onclick = () => {
  const rerouting = routeState === 'rerouting'; routeSequence++; routeController?.abort(); routeController = null; routeState = route ? 'ready' : 'idle';
  stopNavigation(rerouting ? 'Navigation stopped. Recalculate before starting again.' : 'Navigation stopped. Your route steps are still available.', { resetProgress:true });
  if (rerouting) { route = null; send({ type:'hu:route', route:null }); } renderDirections();
};
$('wtRecenter').onclick = () => {
  navigationFollow = true;
  if (liveFix) send({ type:'hu:location', coordinates:liveFix.coordinates, accuracy:liveFix.accuracy, follow:true, fly:true });
  renderDirections();
};
$('wtRide').onclick = () => { const show = $('wtRidePanel').hidden; $('wtRidePanel').hidden = !show; $('wtRide').setAttribute('aria-expanded', String(show)); if (!show) cancelRideRefresh(); renderRide(); };
$('wtRideLocate').onclick = () => void refreshRidePickup();
$('wtUber').onclick = e => {
  renderRide();
  if ($('wtUber').hidden || !$('wtUber').hasAttribute('href')) {
    e.preventDefault(); $('wtRideLocationStatus').textContent = 'Refresh your pickup location before continuing in Uber.'; $('wtRideLocate').focus();
  }
};
$('wtRideDirections').onclick = () => {
  try {
    if (draft.mode === 'drive' && route) { $('wtRidePanel').hidden = true; $('wtRide').setAttribute('aria-expanded', 'false'); return; }
    draft = read(); draft.mode = 'drive'; changed(); syncInputs(); void requestRoute();
  } catch (error) { status(error.message); }
};

function setMode(mode) {
  if (!['travel', 'missions', 'posts'].includes(mode)) return;
  if (mode !== currentMode) { setMapPick(null); invalidateRoute(); closeSearches(); }
  currentMode = mode; root.dataset.worldMode = mode;
  if (mode !== 'travel') root.classList.remove('wt-expanded');
  frame.title = mode === 'travel' ? 'Travel map. Drag to explore; your selected places and road directions appear here.' : 'Equity Uprise globe. Drag to explore; select a mission pin to see its details.';
  root.classList.remove('hu-search-open'); $('huSearchToggle').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('[data-world-mode][aria-pressed]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.worldMode === mode)));
  $('mnWorldFeed').scrollTop = 0; renderDirections(); renderGlobe(); autoLocate();
  window.dispatchEvent(new CustomEvent('mcc:world-mode', { detail:{ mode } }));
}
window.MCC_WORLD_MODE = { set:setMode, get:() => currentMode };
const modeButtons = [...document.querySelectorAll('.wt-world-modes button')];
modeButtons.forEach(button => {
  button.onclick = () => setMode(button.dataset.worldMode);
  button.onkeydown = e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); let index = modeButtons.indexOf(button);
      index = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
      modeButtons[index].click(); modeButtons[index].focus();
    }
  };
});
let touchStart = null;
$('mnWorldFeed').addEventListener('touchstart', e => { touchStart = e.touches.length !== 1 || e.target.closest('input,select,button,a,summary,.wt-toolbar,[data-mission-deck]') ? null : { x:e.touches[0].clientX, y:e.touches[0].clientY }; }, { passive:true });
$('mnWorldFeed').addEventListener('touchend', e => {
  if (!touchStart) return; const dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y; touchStart = null;
  if (Math.abs(dx) > 100 && Math.abs(dx) > Math.abs(dy) * 2) { const modes = ['travel', 'missions', 'posts']; setMode(modes[(modes.indexOf(currentMode) + (dx < 0 ? 1 : 2)) % 3]); }
}, { passive:true });
$('mnWorldFeed').addEventListener('touchcancel', () => { touchStart = null; }, { passive:true });
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  if (e.data?.type === 'hu:globe-ready') {
    for (const button of panel.querySelectorAll('[data-map-pick]')) button.disabled = false;
    renderGlobe(!!route || !!liveFix);
  }
  if (e.data?.type === 'hu:travel-location-selected' && currentMode === 'travel' && mapPick &&
      e.data.kind === mapPick && hasCoordinates({ coordinates:e.data.coordinates })) {
    const kind = mapPick, [longitude, latitude] = e.data.coordinates;
    // A map pin is not a verified street address or ride pickup entrance.
    const label = `Pinned map location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
    setMapPick(null);
    choosePlace(kind, { label, coordinates:[longitude, latitude] }, { source:'manual' });
  }
  if (e.data?.type === 'hu:globe-unavailable') {
    if (mapPick) setMapPick(null);
    for (const button of panel.querySelectorAll('[data-map-pick]')) {
      button.disabled = true; button.title = 'The interactive globe is unavailable. Use an address instead.';
    }
    renderGlobe(false); status('The interactive map is unavailable here. You can still use route steps and live directions.');
  }
  if (e.data?.type === 'hu:request-location' && currentMode === 'travel') void locate();
  if (e.data?.type === 'hu:map-interaction' && currentMode === 'travel') { navigationFollow = false; renderDirections(); }
  if (e.data?.type === 'hu:country' && currentMode === 'travel' && e.data.country?.name) {
    try { draft = read(); draft.to = { label:String(e.data.country.name).slice(0, 240), coordinates:null }; changed(); closeSearches(); syncInputs(); status('Country selected. Search for a city or address, then choose a result for directions.'); $('wtTo').focus(); }
    catch (error) { status(error.message); }
  }
  if (e.data?.type === 'hu:mission-selected' && currentMode === 'travel') setMode('missions');
});

$('wtForm').addEventListener('input', e => {
  changed({ preserveOriginLookup:e.target.id !== 'wtFrom' }); if (e.target.id === 'wtDeparture') $('wtReturning').min = e.target.value;
  if (['wtFrom', 'wtTo'].includes(e.target.id)) {
    const key = e.target.id === 'wtFrom' ? 'from' : 'to'; draft[key] = e.target.value.trim() ? { label:e.target.value.trim(), coordinates:null } : null;
    if (key === 'from') { originSource = 'manual'; ridePickupFix = null; $('wtLocationStatus').textContent = 'Choose a matching starting address, or use your location.'; }
  }
  try { draft = read(); renderItinerary(); renderGlobe(); } catch (error) { renderDirections(); status(error.message); }
});
function requireEndpoints(action, coordinates = false) {
  const missing = !draft.from || (coordinates && !hasCoordinates(draft.from)) ? 'From' : !draft.to || (coordinates && !hasCoordinates(draft.to)) ? 'To' : null;
  if (!missing) return true;
  status(coordinates ? `Choose ${missing === 'From' ? 'a starting address or use your location' : 'a destination from the suggestions'} before ${action}.` : `Add ${missing === 'From' ? 'a starting point' : 'a destination'} before ${action}.`);
  $('wt' + missing).focus(); return false;
}
$('wtForm').onsubmit = e => {
  e.preventDefault();
  try {
    draft = read(); if (!requireEndpoints(isGround() ? 'getting directions' : 'planning this journey', isGround())) return;
    if (isGround()) { if (!route) void requestRoute(); return; }
    renderItinerary(); renderGlobe(true); status('Your draft is ready. Add the airport, station or stay details as you choose them.'); $('wtItinerary').scrollIntoView({ block:'nearest', behavior:'auto' });
  } catch (error) { status(error.message); }
};
$('wtSwap').onclick = () => {
  try { draft = read(); [draft.from, draft.to] = [draft.to, draft.from]; [draft.departureHub, draft.arrivalHub] = [draft.arrivalHub, draft.departureHub]; draft.stay = ''; originSource = 'manual'; ridePickupFix = null; changed(); closeSearches(); syncInputs(); $('wtLocationStatus').textContent = 'Starting from your selected address.'; renderGlobe(true); void requestRoute({ reveal:true }); }
  catch (error) { status(error.message); }
};
$('wtAddReturn').onclick = () => {
  const show = $('wtReturnField').hidden; $('wtReturnField').hidden = !show;
  $('wtAddReturn').textContent = show ? 'Remove return' : 'Add return date'; $('wtAddReturn').setAttribute('aria-expanded', String(show));
  if (show) $('wtReturning').focus(); else { $('wtReturning').value = ''; draft.returning = ''; changed({ preserveOriginLookup:true }); renderItinerary(); }
};
function editField(key) {
  const ids = { from:'wtFrom', departureHub:'wtDepartureHub', arrivalHub:'wtArrivalHub', stay:'wtStay' };
  if (key !== 'from') { $('wtOptions').open = true; $('wtDetails').open = true; } $(ids[key] || 'wtFrom').focus();
}
/* Rides, Flights and Multi-city are the three shapes a trip takes here. Rides is the street route (and a ride);
   Flights and Multi-city are the same longer-trip draft, Multi-city with the airports and stay fields open. */
function chooseMode(kind, { shape = null, details = false } = {}) {
  if (shape) tripShape = shape;
  if (details) { $('wtOptions').open = true; $('wtDetails').open = true; }
  if (kind === draft.mode) { syncInputs(); return; }
  draft = read(); draft.mode = kind; $('wtOptions').open = ['flight', 'train'].includes(draft.mode) || details;
  changed(); closeSearches(); syncInputs(); void requestRoute({ reveal:true });
}
function goSomewhere(what) {
  if (what === 'near') { $('wtLocate').click(); return; }
  if (what === 'globe') { $('wtPickTo').click(); return; }
  if (what === 'saved') { $('wtSaved').click(); return; }
  if (what === 'hotels') {
    if (!draft.to) { $('wtEndpointHint').textContent = 'Choose a destination, then search places to stay there.'; $('wtTo').focus(); return; }
    editField('stay'); return;
  }
  if (what === 'airports') {
    const to = $('wtTo'); to.value = 'Airport'; to.focus(); to.dispatchEvent(new Event('input', { bubbles:true }));
    $('wtEndpointHint').textContent = 'Add the city to find its airport, then choose a result.';
  }
}
panel.addEventListener('click', e => {
  const mode = e.target.closest('[data-travel-kind]'), edit = e.target.closest('[data-edit]');
  const chip = e.target.closest('[data-travel-chip],[data-travel-plan]'), go = e.target.closest('[data-travel-go]');
  try {
    if (mode) {
      if (mode.dataset.travelKind === 'stay') { editField('stay'); return; }
      chooseMode(mode.dataset.travelKind); return;
    }
    if (chip) {
      const which = chip.dataset.travelChip || chip.dataset.travelPlan;
      chooseMode(which === 'rides' ? (isGround() || draft.mode === 'transit' ? draft.mode : 'drive') : 'flight', { shape: which, details: which === 'multi' });
      if (which !== 'rides' && !draft.to) { $('wtEndpointHint').textContent = which === 'multi' ? 'Choose a destination to draft a door-to-door trip.' : 'Choose a destination to plan flights.'; $('wtTo').focus(); }
      return;
    }
    if (go) { goSomewhere(go.dataset.travelGo); return; }
    if (edit) editField(edit.dataset.edit);
  } catch (error) { status(error.message); }
});
$('wtActivity').onclick = () => $('wtSaved').click();
const expanded = $('mnWorld').querySelector('.mn__world-expand');
for (const button of panel.querySelectorAll('[data-map-pick]')) {
  button.addEventListener('click', () => setMapPick(mapPick === button.dataset.mapPick ? null : button.dataset.mapPick));
}
$('wtMapPickCancel').onclick = () => setMapPick(null);
$('wtMapNavGo').onclick = () => $('wtNavigate').click();
$('wtMapNavStop').onclick = () => $('wtStopNavigation').click();
$('wtMapNavRecenter').onclick = () => $('wtRecenter').click();
expanded.addEventListener('click', e => {
  if (currentMode !== 'travel') return;
  e.preventDefault();
  if (mapPick) { setMapPick(null); return; }
  const on = root.classList.toggle('wt-expanded');
  expanded.setAttribute('aria-label', on ? 'Return to directions' : 'Expand the map');
  renderMapNav();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (mapPick) { setMapPick(null); $('wtPickTo').focus(); return; }
  if (root.classList.contains('wt-expanded')) {
    root.classList.remove('wt-expanded'); expanded.setAttribute('aria-label', 'Expand the map');
    renderMapNav(); expanded.focus();
  }
});

const account = () => window.MCC_SUPA?.uid?.() || null;
const signIn = () => { $('mnGuestSignIn').click(); };
const store = () => journeyStore(window.MCC_SUPA);
$('wtSave').onclick = async () => {
  if (busy) return; if (!account()) { signIn(); return; }
  try {
    draft = read(); if (!requireEndpoints('saving your journey') || !$('wtForm').reportValidity()) return;
    busy = true; $('wtSave').disabled = true; status('Saving your private draft…');
    const owner = account(), version = revision, epoch = tripEpoch;
    const row = await store().save(draft, savedId); if (account() !== owner || epoch !== tripEpoch) return;
    savedId = row.id; dirty = version !== revision; $('wtDraftStatus').textContent = dirty ? 'Unsaved' : 'Saved';
    status(dirty ? 'Earlier changes saved. Save again to include your latest edits.' : 'Saved to your account. Your journey is private.');
  } catch (error) { status(error.message); } finally { busy = false; $('wtSave').disabled = false; }
};
let listRequest = 0;
function replaceDraft(plan, id = null) {
  invalidateRoute({ clearPosition:true }); closeSearches(); tripEpoch++; revision++;
  draft = plan; originSource = draft.from?.label === 'Current location' ? 'device' : 'manual'; savedId = id; dirty = false; $('wtOptions').open = ['flight', 'train'].includes(draft.mode);
  $('wtLocationStatus').textContent = draft.from ? 'Starting point from your journey. Use location to update it.' : 'Allow location, or enter your starting address.';
  syncInputs(); $('wtDraftStatus').textContent = id ? 'Saved' : 'Draft'; dialog.close(); status(); renderGlobe(true);
}
$('wtSaved').onclick = async () => {
  if (busy) return; if (!account()) { signIn(); return; }
  dialog.showModal(); const request = ++listRequest, owner = account(); $('wtSavedList').replaceChildren(); $('wtSavedMessage').textContent = 'Loading your journeys…';
  try {
    const rows = await store().list(); if (request !== listRequest || account() !== owner) return;
    $('wtSavedMessage').textContent = rows.length ? 'Your 50 most recent drafts.' : 'Your next journey starts here.';
    rows.forEach(row => {
      let plan; try { plan = normalizeJourney(row.plan); } catch { return; }
      const item = document.createElement('div'); item.className = 'wt-saved-row';
      const open = document.createElement('button'), del = document.createElement('button'); open.type = del.type = 'button';
      open.textContent = journeyTitle(plan); del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete ${journeyTitle(plan)}`);
      open.onclick = () => { if (account() !== owner || (dirty && !window.confirm('Open this journey and discard your unsaved changes?'))) return; replaceDraft(plan, row.id); };
      del.onclick = async () => {
        if (account() !== owner || !window.confirm('Delete this saved journey?')) return; del.disabled = true;
        try { await store().remove(row.id); if (account() !== owner) return; item.remove(); if (savedId === row.id) { savedId = null; dirty = true; $('wtDraftStatus').textContent = 'Draft'; } if (!$('wtSavedList').children.length) $('wtSavedMessage').textContent = 'No saved journeys.'; }
        catch (error) { if (account() === owner) { $('wtSavedMessage').textContent = error.message; del.disabled = false; } }
      };
      item.append(open, del); $('wtSavedList').append(item);
    });
  } catch (error) { if (request === listRequest && account() === owner) $('wtSavedMessage').textContent = error.message; }
};
dialog.addEventListener('close', () => { listRequest++; $('wtSavedList').replaceChildren(); });
$('wtNew').onclick = () => { if (dirty && !window.confirm('Start a new journey and discard your unsaved changes?')) return; replaceDraft(freshDraft()); };
let lastOwner = account();
function sessionChanged() {
  const owner = account(); $('wtSaveFooter').hidden = !owner; $('wtDraftStatus').hidden = !owner;
  $('wtSaveRow').hidden = !owner || !draft.from || !draft.to;
  if (lastOwner && owner !== lastOwner) { listRequest++; replaceDraft(freshDraft()); } lastOwner = owner;
}
function suspendTravel(message) {
  if (mapPick) setMapPick(null);
  cancelLocate(); cancelRideRefresh(); closeSearches(); routeSequence++; routeController?.abort(); routeController = null;
  if (routeState === 'rerouting') { route = null; send({ type:'hu:route', route:null }); } routeState = route ? 'ready' : 'idle';
  if (navigating) stopNavigation(message, { resetProgress:true }); renderDirections();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) suspendTravel('Navigation paused. Tap Go when you return.'); else renderRide(); });
window.addEventListener('pagehide', () => suspendTravel('Navigation paused. Tap Go when you return.'));
window.addEventListener('mcc:world-audio-visibility', e => {
  hostVisible = e.detail?.visible !== false;
  if (!hostVisible) suspendTravel('Navigation paused. Tap Go when you return.');
  else renderRide();
});
window.addEventListener('storage', sessionChanged);
for (const event of ['mcc:auth', 'mcc:auth-changed', 'mcc:auth-state']) window.addEventListener(event, sessionChanged);
new MutationObserver(() => {
  sessionChanged();
  if (!root.classList.contains('mn-world-on') && (navigating || locating || rideLocating || routeController || mapPick)) suspendTravel('Navigation paused. Return to Travel to continue.');
  autoLocate();
}).observe(root, { attributes:true, attributeFilter:['class'] });
window.addEventListener('beforeunload', e => { if (account() && savedId && dirty && draft.from && draft.to) { e.preventDefault(); e.returnValue = ''; } });
const whipStyle = document.createElement('link');
whipStyle.rel = 'stylesheet';
whipStyle.href = new URL('../../css/whip-booking.css?v=__STAMP__', import.meta.url).href;
document.head.append(whipStyle);
attachWhipBooking({
  panel: $('wtRidePanel'),
  currentTrip: () => hasCoordinates(draft.from) && hasCoordinates(draft.to)
    ? { origin:[...draft.from.coordinates],destination:[...draft.to.coordinates],
        pickup_label:draft.from.label,dropoff_label:draft.to.label } : null,
  accountApi: () => typeof window.MCC?.api === 'function' ? window.MCC.api.bind(window.MCC) : null
});
syncInputs(); sessionChanged();
const query = new URLSearchParams(location.search), requestedMode = query.get('mode');
setMode(query.has('mission') || query.has('completed') ? 'missions' : query.has('song') ? 'posts' : ['travel', 'missions', 'posts'].includes(requestedMode) ? requestedMode : 'travel');
send({ type:'hu:hello' }); autoLocate();
