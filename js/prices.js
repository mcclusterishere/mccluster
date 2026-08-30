/* ============================================================
   THE PRICE ENGINE: one finished number per thing sold.

   This file used to compute retail in the browser from what the house
   pays: a lab cost per print size, a per-garment blank cost, postage,
   and a markup, all published in data/prints.json and data/merch.json.
   It repriced beautifully. It also meant the cost of every item and the
   margin on it were a URL away for anyone curious, because a ledger the
   page fetches is a ledger the public has.

   So the arithmetic moved off the web. The ledgers now carry the price
   the buyer pays and nothing standing behind it: no cost, no markup, no
   supplier, no formula. Repricing is still one edit in one JSON file and
   every surface repaints on next load. What the house pays is recorded
   at the desk, where a login stands between it and the world.

   The engine that remains does two honest jobs: make sure nothing ever
   renders unpriced, and add up a set from its pieces.
   ============================================================ */
(function () {
  "use strict";

  function roundTo(n, step) { return Math.round(n / step) * step; }

  /* Retail arrives finished from the ledger. It used to be computed here
     from a lab cost and a markup published in data/prints.json, which
     meant anyone could open that file and read what a print costs the
     house. What the shop pays and what it clears are desk business now;
     the ledger carries the number the buyer pays and nothing behind it. */
  function derive(shop) {
    if (!shop) return shop;
    var floor = (shop.pricing || {}).floor || 12;
    (shop.sizes || []).forEach(function (s) {
      if (typeof s.price !== "number") s.price = floor;  // nothing sells unpriced
    });
    return shop;
  }

  // the profit the desk clears, when the desk supplies the real cost
  function margin(size, landedCost) {
    if (!size || typeof size.price !== "number") return null;
    return size.price - (landedCost || 0);
  }

  /* ---------- THE RACK ----------
     Every piece carries a finished retail price and nothing else. What a
     garment costs the house, who makes it, and what the desk clears are
     the house's business, and they used to be derived HERE, in the
     browser, off cost fields published in data/merch.json: anyone who
     opened the file could read the landed cost and the markup. The
     arithmetic moved to the desk; the ledger now ships the answer only.
     Shipping is still inside the price, so the buyer sees one number
     with delivery included and the house never quietly eats postage. */
  function deriveMerch(rack) {
    if (!rack) return rack;
    var pc = rack.pricing || {};
    var floor = pc.floor || 25;
    (rack.garments || []).forEach(function (g) {
      if (typeof g.price !== "number") g.price = floor;  // a piece never goes out unpriced
    });
    return rack;
  }

  /** The cheapest garment on the rack: what "from $X" should say. */
  function rackFrom(rack) {
    var prices = (rack && rack.garments ? rack.garments : [])
      .map(function (g) { return g.price; })
      .filter(function (p) { return typeof p === "number"; });
    return prices.length ? Math.min.apply(null, prices) : null;
  }

  /* A set is a top and a bottom bought together, and it comes in under
     the two single prices. The saving is set at the desk (pricing.setSaving)
     because it comes out of a real line in the cost of shipping one parcel
     instead of two, not out of thin air and not out of the margin. */
  function setPrice(rack, drop) {
    if (!rack || !drop || !drop.pieces) return null;
    var by = {};
    (rack.garments || []).forEach(function (g) { by[g.id] = g; });
    var pieces = drop.pieces.map(function (id) { return by[id]; }).filter(Boolean);
    if (pieces.length !== (drop.pieces || []).length) return null;

    var full = pieces.reduce(function (a, g) { return a + (g.price || 0); }, 0);
    var saving = (rack.pricing && rack.pricing.setSaving) || 0;
    var price = Math.max(0, roundTo(full - saving, (rack.pricing && rack.pricing.roundTo) || 5));

    return { pieces: pieces, full: full, price: price, saved: full - price };
  }

  window.MCC_PRICE = {
    derive: derive,
    deriveMerch: deriveMerch,
    rackFrom: rackFrom,
    setPrice: setPrice,
    roundTo: roundTo,
    margin: margin,
  };
})();
