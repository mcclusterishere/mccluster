/* ============================================================
   THE REGISTRY — every operator surface, in one place.

   THE PROBLEM THIS EXISTS TO END. The Control Room shipped with a rail
   of six surfaces and knew about three of the sixteen places the owner
   actually works. The other thirteen -- the outreach desk, the travel
   console, the socials room, the analytics, the Equity Uprise desk, the
   music review queue, the vault, the lanes -- were reachable only by
   typing the URL from memory. That is not a discoverability problem, it
   is an absent one, and it is why the back end felt like a Frankenstein:
   the parts were all built, nothing joined them.

   So: ONE list. The rail reads it, the command palette reads it, and the
   test reads it to prove no surface is orphaned. Adding a page to the
   system means adding a line here, and if you forget, the test fails.

   `state` is honest on purpose:
     live    works, go ahead
     legacy  works, being migrated, do not build on it
     dark    exists but needs something switched on -- `needs` says what

   A rail that shows a dead thing as though it were alive is worse than
   one that omits it, because the owner spends the click and learns
   nothing.
   ============================================================ */
(function (root) {
  "use strict";

  var SURFACES = [
    /* ---- MONEY -------------------------------------------------- */
    { id: "crm", label: "Front Desk", href: "crm.html", group: "Money",
      blurb: "Leads as they land. Name, email, what they want.",
      keywords: "leads inquiries pipeline sales customers signup signed", state: "live" },
    { id: "console", label: "Business Console", href: "console.html", group: "Money",
      blurb: "Client sites: what is sold, live and owed.",
      keywords: "sites clients billing invoices subscriptions", state: "live" },
    { id: "desk", label: "Outreach Desk", href: "desk.html", group: "Money",
      blurb: "Campaigns, contacts and who has opted out.",
      keywords: "outreach email mail campaigns contacts suppressions unsubscribe newsletter list", state: "live" },
    { id: "admin", label: "Back Office", href: "admin.html", group: "Money",
      blurb: "Orders and bookings. Being migrated; do not build on it.",
      keywords: "orders bookings back office prints", state: "legacy" },

    /* ---- AUDIENCE ----------------------------------------------- */
    { id: "analytics", label: "Analytics", href: "analytics.html", group: "Audience",
      blurb: "Traffic, audience, funnel and habit. One board.",
      keywords: "analytics insights traffic visitors telemetry stats reach signups accounts engagement funnel retention stickiness cohort paths content export csv dashboard charts", state: "live" },
    { id: "mnet", label: "Mnet", href: "mnet.html", group: "Audience",
      blurb: "The social network. Posts, follows, moderation.",
      keywords: "social network posts feed follows moderation community members accounts signed users", state: "live" },
    { id: "management", label: "Socials Room", href: "management.html", group: "Audience",
      blurb: "Write once, post to Mnet and every connected platform.",
      keywords: "instagram social media scheduling posts management compose publish broadcast telegram x facebook mnet crosspost hootsuite", state: "live" },

    /* ---- MUSIC --------------------------------------------------- */
    { id: "listen", label: "Listening Room", href: "listen.html", group: "Music",
      blurb: "What listeners see. Ranked from real signals.",
      keywords: "music listen explore album tracks discovery", state: "live" },
    { id: "music-admin", label: "Review Desk", href: "music-admin.html", group: "Music",
      blurb: "Submissions waiting on a yes or a no.",
      keywords: "music review submissions approve creator queue", state: "live" },
    { id: "vault", label: "The Vault", href: "vault.html", group: "Music",
      blurb: "Catalogue of record. ISRCs and rights.",
      keywords: "vault catalog catalogue isrc rights masters", state: "live" },
    { id: "lanes", label: "The Lanes", href: "lanes.html", group: "Music",
      blurb: "Distribution: where each release is going.",
      keywords: "lanes distribution release delivery dsp spotify", state: "live" },
    { id: "studio", label: "Studio", href: "studio.html", group: "Music",
      blurb: "Where work gets made.",
      keywords: "studio create make production", state: "live" },

    /* ---- EQUITY UPRISE ------------------------------------------- */
    { id: "uprise-dashboard", label: "Uprise Dashboard", href: "dashboard.html", group: "Equity Uprise",
      blurb: "Program-wide queue, health and execution view for Equity Uprise.",
      keywords: "uprise equity dashboard operations queue triage", state: "live" },
    { id: "uprise-admin", label: "Uprise Admin", href: "uprise-admin.html", group: "Equity Uprise",
      blurb: "Administrative controls and approvals for Equity Uprise.",
      keywords: "uprise admin approvals governance controls", state: "live" },
    { id: "travel-desk", label: "Travel Desk", href: "travel-desk.html", group: "Equity Uprise",
      blurb: "Travel and movement planning for active workstreams.",
      keywords: "travel desk routing logistics itinerary", state: "live" },
    { id: "ecosystem", label: "Ecosystem", href: "ecosystem.html", group: "Equity Uprise",
      blurb: "Cross-plane systems map and status overview.",
      keywords: "ecosystem control plane map status", state: "live" },

    /* ---- SYSTEM --------------------------------------------------- */
    { id: "account", label: "Your Account", href: "account.html", group: "System",
      blurb: "Sign-in, profile, consents.",
      keywords: "account sign in profile password consent settings email mail", state: "live" }
  ];

  var GROUPS = ["Money", "Audience", "Music", "Equity Uprise", "System"];

  /* Ranked, not filtered. Typing "mail" should surface the outreach desk
     even though the word is in its keywords rather than its label, and a
     label match should still beat a keyword match. */
  function search(q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return SURFACES.slice();
    /* Two rules learned from watching it get this wrong.

       Stopwords are dropped. "who signed up" carries one useful word.

       And a keyword hit must land on a WORD BOUNDARY, not anywhere in
       the string. Raw substring matching let the "up" in "signed up"
       match "Uprise", so asking who signed up put the Equity Uprise
       dashboard above the front desk -- the precise kind of guessing
       this palette exists to stop. Names still match on prefix, so
       typing "ana" reaches Analytics before you finish the word. */
    var STOP = /^(a|an|the|my|me|i|is|are|was|to|of|in|on|for|and|or|do|did|does|show|see|get|go|who|what|where|how|can|all)$/;
    var terms = q.split(/\s+/).filter(function (t) { return t.length >= 3 && !STOP.test(t); });
    if (!terms.length) return SURFACES.slice();

    return SURFACES.map(function (s) {
      var label = s.label.toLowerCase();
      var hay = (s.label + " " + s.group + " " + s.blurb + " " + s.keywords).toLowerCase();
      var score = 0;
      terms.forEach(function (t) {
        var safe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        /* WHOLE word, both ends. A leading \b alone still let "up" match
           "uprise", which is the bug that put the Equity Uprise dashboard
           above the front desk when asking who signed up. Names keep
           prefix matching, so "ana" still reaches Analytics. */
        var whole = new RegExp("\\b" + safe + "\\b");
        if (label.indexOf(t) === 0) score += 100;      // starts the name
        else if (label.indexOf(t) >= 0) score += 50;   // inside the name
        else if (whole.test(hay)) score += 10;         // a whole word elsewhere
      });
      return { s: s, score: score };
    }).filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.s.label.localeCompare(b.s.label); })
      .map(function (r) { return r.s; });
  }

  function byGroup() {
    return GROUPS.map(function (g) {
      return { group: g, items: SURFACES.filter(function (s) { return s.group === g; }) };
    }).filter(function (g) { return g.items.length; });
  }

  root.MCC_SURFACES = {
    all: SURFACES,
    groups: GROUPS,
    byGroup: byGroup,
    search: search,
    get: function (id) {
      for (var i = 0; i < SURFACES.length; i++) if (SURFACES[i].id === id) return SURFACES[i];
      return null;
    }
  };
})(window);
