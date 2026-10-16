/** Local, synthetic example. No provider calls, fares, tickets or real drivers. */
import { createPlan, legHandoff } from '../../js/travel/navigation-core.mjs';

const home = { query: 'New Haven Union Station, Connecticut' };
const airport = { query: 'Bradley International Airport, Connecticut' };
const arrival = { query: 'Arrival airport (example only)' };
const hotel = { query: 'Chosen hotel (example only)' };
const plan = createPlan({ id: 'free-travel-demo', legs: [
  { id: 'to-airport', kind: 'drive', origin: home, destination: airport },
  { id: 'flight', kind: 'flight', origin: airport, destination: arrival },
  { id: 'pickup', kind: 'drive', origin: arrival, destination: hotel },
  { id: 'stay', kind: 'stay', destination: hotel },
] });
console.log(JSON.stringify({
  notice: 'Example planning data only. No reservation, live tracking, dispatch or route calculation.',
  plan,
  firstLegGoogle: legHandoff(plan, 'to-airport', 'google'),
  firstLegApple: legHandoff(plan, 'to-airport', 'apple'),
  flightHandoff: legHandoff(plan, 'flight', 'google'),
}, null, 2));
