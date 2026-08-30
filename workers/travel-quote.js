/* ============================================================
   THE ROADSHOW WORKER — /api/travel/*  (Cloudflare Worker)

   Anyone on the planet books Matthew; this prices the trip and
   itemizes it honestly:

     POST /api/travel/quote   { "destination": "Chicago", "date": "2026-09-12", "nights": 1 }
       → { base, mode: "fly" | "local",
           legs: [ uber-to-airport, flight, uber-to-venue, ...reverse ],
           hotel, totals: { travel, note } }

     POST /api/travel/base    { "base": "ct" | "ga", "key": OWNER_KEY }
       → flips which home base quotes originate from. Wire the
         desk's login handler to POST this and the base follows
         wherever Matthew last logged in; until then it's one
         curl from the phone.

     GET  /api/travel/base    → { "base": "ct" }   (public, city-level only)

   THE BOOKING DESK (owner side — this is where it actually books):

     POST /api/travel/request  { destination, date, nights?, name, email }
       → public, rate-limited. Files a trip request with a live
         quote snapshot. The gate fires this automatically when a
         lead carries a job location.

     GET  /api/travel/requests?key=OWNER_KEY
       → the queue, newest first, with each request's quote.

     POST /api/travel/profile  { key, given_name, family_name,
                                 born_on, gender, email, phone_number }
       → set ONCE: the traveler profile Duffel needs to ticket a
         real flight. Never shipped in the repo; lives in KV.

     POST /api/travel/approve  { key, id, max_usd }
       → re-prices the request live and REGISTERS the quote on
         the record: the exact offer, the exact room rate, the
         exact dollars, and when each expires. Spends nothing.
         The max_usd ceiling is pinned here and enforced at every
         later stage.

     POST /api/travel/purchase { key, id, mode?: "hold"|"instant" }
       → executes the approved quote. Default is "hold": where
         the airline allows it, the seat books with NO payment,
         price-guaranteed until a deadline (status: held). If the
         airline demands instant payment, nothing is bought unless
         you pass mode:"instant". Flight offers expire in minutes,
         so if the pinned offer is stale it re-prices and proceeds
         only within 5% of the approved number — otherwise it
         stops and asks you to re-approve.

     POST /api/travel/pay      { key, id }
       → the ONLY step that spends money: pays the held flight
         from the Duffel balance and books the Hilton-family room
         (rooms cannot be held, so they book here, at pay time).
         Still capped by the approved max_usd.

   BINDINGS (wrangler.toml):
     kv_namespaces = [{ binding = "TRAVEL", id = "..." }]
     secrets: DUFFEL_TOKEN, OWNER_KEY

   Flights and hotels are LIVE prices from the Duffel API
   (duffel.com — self-serve signup, one token for flights AND
   stays; searches are free within their ratio and we never
   book through the API, so quoting costs pennies at worst).
   Amadeus Self-Service, the previous provider, was
   decommissioned July 17, 2026. Hotels filter to the
   Hilton family by brand: no motel in this bitch is a config
   value here, not a vibe. Ground legs have no public API
   (Uber closed theirs), so they are estimated per-mile/
   per-minute at posted averages and always LABELED estimates.
   Local jobs skip flight + hotel and bill the ride to the
   venue and back.

   The static config (bases, policy) mirrors data/travel.json —
   keep them in sync when either changes.
   ============================================================ */

const CONFIG = {
  bases: {
    ct: { label: "Connecticut", name: "Shiloh Baptist Church",
      address: "477 Broad Street, Bridgeport, CT 06604",
      lat: 41.1723, lng: -73.1931, airports: ["HVN", "BDL", "LGA", "JFK", "EWR"] },
    ga: { label: "Georgia", name: "N.H. Scott Recreation Center",
      address: "2230 Tilson Road, Decatur, GA 30032",
      lat: 33.7093, lng: -84.2585, airports: ["ATL"] },
  },
  localRadiusMi: 60,
  hiltonBrands: ["hilton", "hampton", "doubletree", "embassy", "homewood",
    "home2", "garden inn", "tru by", "canopy", "curio", "tapestry",
    "waldorf", "conrad", "lxr", "motto", "signia"],
  ground: { base: 2.5, perMile: 1.85, perMin: 0.45, min: 12, airportBufferPct: 25, mph: 28 },
};

/* ---------- helpers ---------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status,
    headers: { "content-type": "application/json",
      "access-control-allow-origin": "https://matthew.mccluster.org" } });

const miles = (a, b) => {
  const R = 3958.8, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function uberEstimate(mi, isAirport) {
  const g = CONFIG.ground;
  const mins = (mi / g.mph) * 60;
  let usd = Math.max(g.min, g.base + mi * g.perMile + mins * g.perMin);
  if (isAirport) usd *= 1 + g.airportBufferPct / 100;
  return Math.round(usd);
}

/* Duffel: one token, no OAuth dance. Mutations carry an Idempotency-Key
   so a retry after a dropped response can never double-book or double-pay —
   Duffel dedupes server-side, which is the only real lock KV cannot give. */
const duffel = async (env, method, path, body, idem) => {
  const headers = { authorization: "Bearer " + env.DUFFEL_TOKEN,
    "Duffel-Version": "v2", "content-type": "application/json" };
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch("https://api.duffel.com" + path, {
    method, headers,
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  if (!r.ok) throw new Error(path + " " + r.status);
  return (await r.json()).data;
};

/* every fare here is USD or it does not play — mixed currencies would make
   the ceiling, the labels and the math silently wrong */
const inUSD = (o) => (o.total_currency || o.cheapest_rate_currency || "USD") === "USD";

/* destination text → { name, lat, lng, airport } */
async function resolveDestination(env, q) {
  const hits = await duffel(env, "GET",
    "/places/suggestions?query=" + encodeURIComponent(q));
  const place = hits.find((h) => h.type === "city") || hits[0];
  if (!place) return null;
  return {
    name: place.city_name || place.name,
    lat: +place.latitude, lng: +place.longitude,
    airport: place.iata_code
      || place.airports?.[0]?.iata_code || null,
  };
}

const returnDate = (date, nights) =>
  new Date(new Date(date + "T12:00:00Z").getTime() + nights * 864e5).toISOString().slice(0, 10);

async function cheapestFlight(env, origins, destCode, date, nights) {
  let best = null;
  for (const o of origins.slice(0, 3)) {
    try {
      const req = await duffel(env, "POST",
        "/air/offer_requests?return_offers=true", {
          slices: [
            { origin: o, destination: destCode, departure_date: date },
            { origin: destCode, destination: o, departure_date: returnDate(date, nights) },
          ],
          passengers: [{ type: "adult" }], cabin_class: "economy",
        });
      for (const f of req.offers || []) {
        if (!inUSD(f)) continue;
        const usd = Math.round(+f.total_amount);
        if (usd && (!best || usd < best.usd))
          best = { usd, from: o, carrier: f.owner?.iata_code };
      }
    } catch (e) { /* an origin with no route is not an error */ }
  }
  return best;
}

const isHilton = (name) => {
  const n = (name || "").toLowerCase();
  return CONFIG.hiltonBrands.some((b) => n.includes(b));
};

async function hiltonNight(env, dest, date, nights) {
  try {
    const out = new Date(new Date(date + "T12:00:00Z").getTime() + nights * 864e5)
      .toISOString().slice(0, 10);
    const res = await duffel(env, "POST", "/stays/search", {
      location: { radius: 15,
        geographic_coordinates: { latitude: dest.lat, longitude: dest.lng } },
      check_in_date: date, check_out_date: out,
      rooms: 1, guests: [{ type: "adult" }],
    });
    let best = null;
    for (const r of res.results || []) {
      const acc = r.accommodation;
      if (!isHilton(acc?.name)) continue;      /* the no-motel law, enforced */
      if (acc && acc.cheapest_rate_currency && acc.cheapest_rate_currency !== "USD") continue;
      const usd = Math.round(+(acc && acc.cheapest_rate_total_amount) || 0);
      if (usd && (!best || usd < best.usd)) best = { usd, name: acc.name, nights };
    }
    return best;
  } catch (e) { return null; }
}

/* ---------- the quote ---------- */

async function quote(env, body) {
  const baseKey = (await env.TRAVEL.get("base")) || "ct";
  const base = CONFIG.bases[baseKey];
  const dest = await resolveDestination(env, String(body.destination || "").slice(0, 80));
  if (!dest) return json({ error: "Could not place that destination — try a city or airport name." }, 422);

  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date
    : new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const nights = Math.min(14, Math.max(1, +body.nights || 1));
  const distMi = Math.round(miles(base, dest));

  /* same city or town: still cool — they're still paying the ride */
  if (distMi <= CONFIG.localRadiusMi) {
    const ride = uberEstimate(distMi, false);
    return json({
      base: { key: baseKey, label: base.label }, mode: "local",
      destination: dest.name, distance_mi: distMi,
      legs: [
        { what: "Ride to the venue (est.)", usd: ride },
        { what: "Ride back (est.)", usd: ride },
      ],
      totals: { travel: ride * 2,
        note: "Ground is an estimate at posted per-mile averages; billed at the receipt." },
    });
  }

  const airportLeg = uberEstimate(30, true); // base → its airport, est. band
  const flight = await cheapestFlight(env, base.airports, dest.airport, date, nights);
  const destRide = uberEstimate(15, true);   // dest airport → venue, est. band
  const hotel = await hiltonNight(env, dest, date, nights);

  const legs = [
    { what: `Ride, ${base.label} base to airport (est.)`, usd: airportLeg },
    flight ? { what: `Round-trip flight ${flight.from} \u21c4 ${dest.airport} (live)`, usd: flight.usd }
           : { what: "Round-trip flight (quoted at booking)", usd: null },
    { what: "Ride, airport to the venue (est.)", usd: destRide },
    { what: "Ride, venue to airport (est.)", usd: destRide },
    { what: `Ride, airport to ${base.label} base (est.)`, usd: airportLeg },
  ];
  const known = legs.reduce((s, l) => s + (l.usd || 0), 0) + (hotel ? hotel.usd : 0);
  return json({
    base: { key: baseKey, label: base.label }, mode: "fly",
    destination: dest.name, date, distance_mi: distMi,
    legs,
    hotel: hotel
      ? { what: `${hotel.name} — ${nights} night${nights > 1 ? "s" : ""} (live, Hilton family)`, usd: hotel.usd }
      : { what: "Hilton-family room (quoted at booking — never a motel)", usd: null },
    totals: { travel: known,
      note: "Flights and rooms are live quotes; ground legs are estimates at posted averages. Travel bills at cost, itemized on the invoice." },
  });
}

/* ---------- the booking desk ---------- */

const reqId = () => "req:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function fileRequest(env, body) {
  const dest = String(body.destination || "").slice(0, 80).trim();
  if (!dest) return json({ error: "destination required" }, 422);
  const rec = {
    id: reqId(),
    destination: dest,
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : null,
    nights: Math.min(14, Math.max(1, +body.nights || 1)),
    name: String(body.name || "").slice(0, 80),
    email: String(body.email || "").slice(0, 120),
    status: "pending",
    created: new Date().toISOString(),
  };
  /* the public path never fans out to Duffel: a stranger's burst must not
     spend API budget. The queue prices at approve time, live, instead of
     carrying a stale filed-time snapshot. */
  rec.quote = null;
  /* a past date is a typo, not a time machine */
  if (rec.date && rec.date < new Date().toISOString().slice(0, 10)) rec.date = null;
  await env.TRAVEL.put(rec.id, JSON.stringify(rec), { expirationTtl: 90 * 86400 });
  return json({ ok: true, id: rec.id });
}

async function listRequests(env) {
  const keys = (await env.TRAVEL.list({ prefix: "req:" })).keys;
  const out = [];
  for (const k of keys.slice(-50)) {
    const v = await env.TRAVEL.get(k.name);
    if (v) out.push(JSON.parse(v));
  }
  out.sort((a, b) => (a.created < b.created ? 1 : -1));
  return json({ requests: out });
}

/* ---- stage 1: APPROVE — price it live, pin it, spend nothing ---- */

async function priceFlight(env, base, dest, date, nights) {
  let best = null, bestReq = null;
  for (const o of base.airports.slice(0, 3)) {
    try {
      const r = await duffel(env, "POST", "/air/offer_requests?return_offers=true", {
        slices: [
          { origin: o, destination: dest.airport, departure_date: date },
          { origin: dest.airport, destination: o, departure_date: returnDate(date, nights) },
        ],
        passengers: [{ type: "adult" }], cabin_class: "economy",
      });
      for (const f of r.offers || []) {
        if (!inUSD(f)) continue;
        if (!best || +f.total_amount < +best.total_amount) { best = f; bestReq = r; }
      }
    } catch (e) {}
  }
  return best ? { offer: best, passengerId: bestReq.passengers[0].id } : null;
}

async function priceStay(env, dest, date, nights) {
  const out = new Date(new Date(date + "T12:00:00Z").getTime() + nights * 864e5)
    .toISOString().slice(0, 10);
  const search = await duffel(env, "POST", "/stays/search", {
    location: { radius: 15, geographic_coordinates: { latitude: dest.lat, longitude: dest.lng } },
    check_in_date: date, check_out_date: out, rooms: 1, guests: [{ type: "adult" }],
  });
  let best = null;
  for (const r of search.results || []) {
    if (!isHilton(r.accommodation?.name)) continue;
    if (!best || +r.cheapest_rate_total_amount < +best.cheapest_rate_total_amount) best = r;
  }
  if (!best) return null;
  const rates = await duffel(env, "POST",
    "/stays/search_results/" + best.id + "/actions/fetch_all_rates", {});
  const rate = (rates.accommodation?.rooms?.[0]?.rates || [])
    .sort((a, b) => +a.total_amount - +b.total_amount)[0];
  return rate ? { name: best.accommodation?.name, rate_id: rate.id,
    usd: Math.round(+rate.total_amount) } : null;
}

async function approveTrip(env, body) {
  if (!/^req:/.test(body.id || "")) return json({ error: "bad id" }, 422);
  const rec = JSON.parse((await env.TRAVEL.get(body.id)) || "null");
  if (!rec) return json({ error: "no such request" }, 404);
  if (rec.status !== "pending" && rec.status !== "failed" && rec.status !== "approved")
    return json({ error: "already " + rec.status
      + " — a live booking must be cancelled before re-approving" }, 409);
  const maxUsd = +body.max_usd;
  if (!maxUsd || maxUsd < 1) return json({ error: "max_usd ceiling required — the cap is the safety" }, 422);

  const baseKey = (await env.TRAVEL.get("base")) || "ct";
  const base = CONFIG.bases[baseKey];
  const dest = await resolveDestination(env, rec.destination);
  if (!dest) return json({ error: "destination no longer resolves" }, 422);
  const date = rec.date || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  const flight = await priceFlight(env, base, dest, date, rec.nights);
  let stay = null;
  try { stay = await priceStay(env, dest, date, rec.nights); } catch (e) {}

  const flightUsd = flight ? Math.round(+flight.offer.total_amount) : 0;
  const total = flightUsd + (stay ? stay.usd : 0);
  if (total > maxUsd)
    return json({ error: "the live total (" + total + ") busts the " + maxUsd
      + " ceiling — nothing registered. Raise the cap or re-approve later.", total }, 402);

  rec.approved = {
    max_usd: maxUsd, total_usd: total, at: new Date().toISOString(),
    base: baseKey, dest: { name: dest.name, airport: dest.airport, lat: dest.lat, lng: dest.lng },
    date,
    flight: flight ? {
      offer_id: flight.offer.id, passenger_id: flight.passengerId,
      usd: flightUsd, amount: flight.offer.total_amount, currency: flight.offer.total_currency,
      origin: flight.offer.slices?.[0]?.origin?.iata_code,
      carrier: flight.offer.owner?.iata_code,
      expires_at: flight.offer.expires_at,
      holdable: flight.offer.payment_requirements
        ? flight.offer.payment_requirements.requires_instant_payment === false : false,
      guarantee: flight.offer.payment_requirements?.price_guarantee_expires_at || null,
    } : null,
    hotel: stay, /* rate ids are short-lived; re-matched at pay time */
  };
  rec.status = "approved";
  await env.TRAVEL.put(rec.id, JSON.stringify(rec));
  return json({ ok: true, rec, note: !flight
    ? "No round-trip flight found in USD — pay books the room alone."
    : rec.approved.flight.holdable
      ? "This airline allows a HOLD: purchase will book the seat with no payment."
      : "This airline wants instant payment — purchase needs mode:'instant' and spends immediately." });
}

/* ---- stage 2: PURCHASE — execute the approval; hold when the airline allows ---- */

async function purchaseTrip(env, body) {
  if (!/^req:/.test(body.id || "")) return json({ error: "bad id" }, 422);
  const rec = JSON.parse((await env.TRAVEL.get(body.id)) || "null");
  if (!rec) return json({ error: "no such request" }, 404);
  if (!rec.approved) return json({ error: "approve first: POST /api/travel/approve" }, 428);
  /* the ONLY purchasable state is approved-with-no-live-order: booked-flight,
     held and booked all refuse, and an existing order refuses even if the
     status field were ever wrong */
  if (rec.status !== "approved" || (rec.booked && rec.booked.flight))
    return json({ error: "not purchasable: status " + rec.status
      + (rec.booked && rec.booked.flight ? " with a live order " + rec.booked.flight.order_id : "")
      + " — cancel before re-buying", rec }, 409);
  const profile = JSON.parse((await env.TRAVEL.get("profile")) || "null");
  if (!profile) return json({ error: "set the traveler profile first: POST /api/travel/profile" }, 428);
  const ap = rec.approved;
  if (!ap.flight) return json({ error: "no flight in the approval — use pay to book the room alone" }, 422);

  /* offers die in minutes: refresh if stale, but never drift past 5% of the
     approved flight — and NEVER past the ceiling, on any path */
  let offerId = ap.flight.offer_id, paxId = ap.flight.passenger_id,
      usd = ap.flight.usd, amount = ap.flight.amount, currency = ap.flight.currency,
      holdable = ap.flight.holdable;
  if (!ap.flight.expires_at || new Date(ap.flight.expires_at) < new Date()) {
    const base = CONFIG.bases[ap.base];
    const fresh = await priceFlight(env, base, { airport: ap.dest.airport }, ap.date, rec.nights);
    if (!fresh) return json({ error: "no offers on refresh — re-approve" }, 409);
    const freshUsd = Math.round(+fresh.offer.total_amount);
    if (freshUsd > ap.flight.usd * 1.05)
      return json({ error: "price moved on refresh: " + freshUsd + " vs approved "
        + ap.flight.usd + " — re-approve to accept it" }, 409);
    offerId = fresh.offer.id; paxId = fresh.passengerId;
    usd = freshUsd; amount = fresh.offer.total_amount; currency = fresh.offer.total_currency;
    holdable = fresh.offer.payment_requirements
      ? fresh.offer.payment_requirements.requires_instant_payment === false : false;
  }
  const spent = rec.spend_usd || 0;
  if (usd + spent > ap.max_usd)
    return json({ error: "flight " + usd + " + already spent " + spent
      + " busts the " + ap.max_usd + " ceiling — nothing was bought" }, 402);

  const wantInstant = body.mode === "instant";
  if (!holdable && !wantInstant)
    return json({ error: "this airline demands instant payment — repeat with mode:'instant' to spend "
      + usd + " " + currency + " now, or re-approve a holdable carrier" }, 409);

  const passengers = [{ id: paxId, title: profile.title || "mr",
    given_name: profile.given_name, family_name: profile.family_name,
    born_on: profile.born_on, gender: profile.gender,
    email: profile.email, phone_number: profile.phone_number }];

  /* exact amount string, verbatim from the offer — Duffel refuses rounded money */
  const order = await duffel(env, "POST", "/air/orders",
    holdable && !wantInstant
      ? { type: "hold", selected_offers: [offerId], passengers: passengers }
      : { type: "instant", selected_offers: [offerId], passengers: passengers,
          payments: [{ type: "balance", amount: amount, currency: currency }] },
    "order:" + rec.id);

  rec.booked = rec.booked || {};
  rec.booked.flight = { order_id: order.id, reference: order.booking_reference,
    usd: usd, amount: amount, currency: currency, held: holdable && !wantInstant,
    pay_by: order.payment_status?.payment_required_by || null,
    price_guaranteed_until: order.payment_status?.price_guarantee_expires_at || null };
  rec.status = holdable && !wantInstant ? "held" : "booked-flight";
  rec.spend_usd = spent + (holdable && !wantInstant ? 0 : usd);
  await env.TRAVEL.put(rec.id, JSON.stringify(rec));
  return json({ ok: true, rec, note: rec.status === "held"
    ? "Seat is HELD, zero spent. Pay by " + (rec.booked.flight.pay_by || "the airline deadline")
      + " with POST /api/travel/pay — that step also books the room."
    : "Flight ticketed and paid. POST /api/travel/pay books the room." });
}

/* ---- stage 3: PAY — the only stage that spends ---- */

async function payTrip(env, body) {
  if (!/^req:/.test(body.id || "")) return json({ error: "bad id" }, 422);
  const rec = JSON.parse((await env.TRAVEL.get(body.id)) || "null");
  if (!rec) return json({ error: "no such request" }, 404);
  if (!rec.approved) return json({ error: "approve first" }, 428);
  const ap = rec.approved;
  /* a trip whose approval includes a flight is never payable before the
     flight exists — pay must not quietly book a room for a seatless trip */
  if (ap.flight && !(rec.booked && rec.booked.flight))
    return json({ error: "purchase the flight before pay" }, 428);
  const profile = JSON.parse((await env.TRAVEL.get("profile")) || "null");
  if (!profile) return json({ error: "set the traveler profile first" }, 428);
  rec.booked = rec.booked || {};
  let spend = rec.spend_usd || 0;

  /* the held flight gets paid — at the ORDER's current exact total, re-read
     from Duffel, never a rounded local number */
  if (rec.booked.flight && rec.booked.flight.held) {
    const f = rec.booked.flight;
    const live = await duffel(env, "GET", "/air/orders/" + f.order_id);
    const dueAmount = live.total_amount || f.amount;
    const dueCurrency = live.total_currency || f.currency;
    const dueUsd = Math.round(+dueAmount);
    if (dueCurrency !== "USD")
      return json({ error: "order settles in " + dueCurrency + " — manual review" }, 409);
    if (dueUsd > f.usd * 1.05)
      return json({ error: "held price moved: now " + dueUsd + " vs " + f.usd
        + " at purchase — re-check before paying" }, 409);
    if (spend + dueUsd > ap.max_usd)
      return json({ error: "paying the flight busts the approved ceiling — nothing charged" }, 402);
    await duffel(env, "POST", "/air/payments", {
      order_id: f.order_id,
      payment: { type: "balance", amount: dueAmount, currency: dueCurrency },
    }, "payflight:" + rec.id);
    f.held = false; f.usd = dueUsd; f.amount = dueAmount; spend += dueUsd;
  }

  /* the room books now — rates can't be held, so re-match the approved stay */
  if (ap.hotel && !rec.booked.hotel) {
    try {
      const stay = await priceStay(env, ap.dest, ap.date, rec.nights);
      if (stay && stay.usd <= ap.hotel.usd * 1.05 && spend + stay.usd <= ap.max_usd) {
        const q = await duffel(env, "POST", "/stays/quotes", { rate_id: stay.rate_id });
        const bk = await duffel(env, "POST", "/stays/bookings", {
          quote_id: q.id, email: profile.email, phone_number: profile.phone_number,
          guests: [{ given_name: profile.given_name, family_name: profile.family_name }],
        }, "stay:" + rec.id);
        rec.booked.hotel = { booking_id: bk.id, reference: bk.reference,
          name: stay.name, usd: stay.usd };
        spend += stay.usd;
      } else if (stay) {
        rec.booked.hotel_skipped = "room now " + stay.usd + " vs approved "
          + ap.hotel.usd + " or ceiling — re-approve to take it";
      }
    } catch (e) { rec.booked.hotel_error = String(e.message || e).slice(0, 120); }
  }

  rec.spend_usd = spend;
  /* booked means booked: a skipped or failed room is a partial, said plainly */
  rec.status = (ap.hotel && !rec.booked.hotel) ? "partially-booked" : "booked";
  await env.TRAVEL.put(rec.id, JSON.stringify(rec));
  return json({ ok: rec.status === "booked", rec });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS")
      return new Response(null, { headers: {
        "access-control-allow-origin": "https://matthew.mccluster.org",
        "access-control-allow-methods": "GET,POST",
        "access-control-allow-headers": "content-type" } });

    if (url.pathname === "/api/travel/base" && req.method === "GET") {
      const base = (await env.TRAVEL.get("base")) || "ct";
      return json({ base });
    }
    if (url.pathname === "/api/travel/base" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!keyOk(ownerKeyOf(b))) return json({ error: "no" }, 403);
      if (b.base !== "ct" && b.base !== "ga") return json({ error: "ct or ga" }, 422);
      await env.TRAVEL.put("base", b.base);
      return json({ base: b.base });
    }
    /* keyed hourly buckets: the window really is an hour, and steady use
       cannot pin the TTL open */
    const hour = Math.floor(Date.now() / 36e5);
    const bucket = async (name, cap) => {
      const ip = req.headers.get("cf-connecting-ip") || "x";
      const rk = name + ":" + ip + ":" + hour;
      const n = +(await env.TRAVEL.get(rk)) || 0;
      if (n >= cap) return false;
      await env.TRAVEL.put(rk, String(n + 1), { expirationTtl: 7200 });
      return true;
    };
    /* the owner key rides in a header (or a POST body) — never a query
       string, which lands in every log between here and the phone */
    const ownerKeyOf = (b) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
      || req.headers.get("x-owner-key") || (b && b.key) || "";
    const keyOk = (given) => {
      const a = new TextEncoder().encode(String(given || ""));
      const b2 = new TextEncoder().encode(env.OWNER_KEY || "");
      if (a.length !== b2.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b2[i];
      return diff === 0;
    };

    if (url.pathname === "/api/travel/request" && req.method === "POST") {
      if (!(await bucket("rlq", 10))) return json({ error: "slow down" }, 429);
      return fileRequest(env, await req.json().catch(() => ({})));
    }
    if (url.pathname === "/api/travel/requests" && req.method === "GET") {
      if (!keyOk(ownerKeyOf(null))) return json({ error: "no" }, 403);
      return listRequests(env);
    }
    if (url.pathname === "/api/travel/profile" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!keyOk(ownerKeyOf(b))) return json({ error: "no" }, 403);
      const need = ["given_name", "family_name", "born_on", "gender", "email", "phone_number"];
      const missing = need.filter((k) => !b[k]);
      if (missing.length) return json({ error: "missing: " + missing.join(", ") }, 422);
      const p = {}; need.concat(["title"]).forEach((k) => { if (b[k]) p[k] = String(b[k]).slice(0, 120); });
      await env.TRAVEL.put("profile", JSON.stringify(p));
      return json({ ok: true });
    }
    for (const [path, fn] of [["approve", approveTrip], ["purchase", purchaseTrip], ["pay", payTrip]]) {
      if (url.pathname === "/api/travel/" + path && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        if (!keyOk(ownerKeyOf(b))) return json({ error: "no" }, 403);
        try { return await fn(env, b); }
        catch (e) { return json({ error: path + " failed: " + String(e.message || e).slice(0, 160) }, 502); }
      }
    }
    if (url.pathname === "/api/travel/quote" && req.method === "POST") {
      if (!(await bucket("rl", 20))) return json({ error: "Slow down — try again in an hour." }, 429);
      try { return await quote(env, await req.json()); }
      catch (e) { return json({ error: "Quote engine warming up — book the call and the itemized number follows within 24 hours, weekdays." }, 503); }
    }
    return json({ error: "not found" }, 404);
  },
};
