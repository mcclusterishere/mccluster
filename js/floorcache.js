/* MCC_FLOOR: one fetch feeds all of Our Street.
   Before this, every engine on a page (exchange, deal builder, pay
   keypad, desk, spaces) pulled data/providers.json and the cloud
   listing independently, the same bytes three and four times per
   load. Now the first caller pays, everyone else shares the promise.
   The merge rule matches what every consumer already did: local seed
   first, cloud rows joining by slug without duplicating. */
(function () {
  "use strict";
  var pending = null;

  function merge(seedJson, cloudRows) {
    var all = (seedJson.providers || []).slice();
    (cloudRows || []).forEach(function (c) {
      if (all.some(function (p) { return (p.slug || p.id) === c.slug; })) return;
      all.push({
        id: c.slug, slug: c.slug, cloud_id: c.id, name: c.name, headline: c.headline,
        blurb: c.blurb, area: c.area, roles: c.roles || [], badgeColor: c.badge_color,
        ticker: c.ticker, terms: c.terms, space: c.space, photo: c.photo,
        href: c.href, book: c.book, profile: c.href,
        square: c.square, stripe_acct: c.stripe_acct, charges_enabled: c.charges_enabled,
        id_verified: c.id_verified,
      });
    });
    return {
      providers: all,
      categories: seedJson.categories || ["Photo", "Video", "Web", "Studios", "Stages"],
    };
  }

  function load() {
    if (pending) return pending;
    pending = Promise.all([
      fetch("data/providers.json", { cache: "no-cache" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { providers: [] }; }),
      window.MCC_NET && window.MCC_NET.listProviders
        ? window.MCC_NET.listProviders().catch(function () { return []; })
        : Promise.resolve([]),
    ]).then(function (both) { return merge(both[0], both[1]); });
    return pending;
  }

  /* a save that changes Our Street can drop the cache so the next
     reader sees the new world */
  function invalidate() { pending = null; }

  window.MCC_FLOOR = { load: load, invalidate: invalidate };
})();
