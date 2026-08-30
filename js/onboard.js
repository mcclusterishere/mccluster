/* ============================================================
   ONBOARDING — the progressive brief.

   One primary question per screen. The steps are data, not markup,
   so the four service paths share one accessible engine: the same
   validation, the same Back, the same autosave, the same rail.

   Structure preserved end to end:
     person account -> organization workspace -> service engagement
     -> website or campaign -> assigned roles

   Rules the engine enforces:
     - Runway never sees a mode question. It has no Equity version.
     - Equity Uprise is never preselected, anywhere.
     - A question is asked once. Branching removes steps; it never
       repeats them.
     - Every answer autosaves, so a reload or a confirm-your-email
       round trip resumes exactly where it left off.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "mcc_onboard_v2";
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { S = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  var L = null;                       /* the ledger */
  var at = 0;                         /* index into the live walk */
  var el = function (id) { return document.getElementById(id); };
  function esc(x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; }

  /* ---------- helpers the step table uses ---------- */
  var isRunway = function () { return S.offer === "runway"; };
  var isEquity = function () { return S.offer !== "runway" && S.mode === "equity"; };
  var offerIs = function (id) { return function () { return S.offer === id; }; };

  /* ============================================================
     THE STEPS.

     kind:  offer | mode | choice | multi | text | textarea |
            contact | account | dates | summary | ack | review
     when:  predicate — the step exists only when it returns true
     ============================================================ */
  var STEPS = [
    /* ---------------- the offer ---------------- */
    { id: "offer", rail: "Offer", kind: "offer", key: "offer", required: true,
      q: "What are you here for?",
      sub: "Four services. Pick the one you came for — the questions after this are built around it." },

    /* ---------------- the mode ---------------- */
    { id: "mode", rail: "Mode", kind: "mode", key: "mode", required: true,
      when: function () { return !isRunway() && !!S.offer; },
      q: "How do you want to pay for it?",
      sub: "Two ways to buy the same service. Nothing is preselected — pick the one that fits." },

    /* ---------------- the person and the organization ---------------- */
    { id: "person", rail: "You", kind: "text", key: "name", required: true,
      q: "Who are you?", sub: "Your name goes on the account and on the record.",
      placeholder: "First and last name", autocomplete: "name" },

    { id: "org", rail: "You", kind: "text", key: "org", required: true,
      q: "What's the organization called?",
      sub: "This becomes your workspace. If it's just you for now, your own name is a fine answer.",
      placeholder: "Business, church, brand or your name", autocomplete: "organization" },

    { id: "biztype", rail: "You", kind: "choice", key: "biztype", required: true,
      q: "What kind of organization is it?",
      sub: "It sets the tone of the whole build.",
      options: [
        { v: "small-business", b: "Small business" }, { v: "church", b: "Church or ministry" },
        { v: "nonprofit", b: "Nonprofit" }, { v: "artist", b: "Artist or creator" },
        { v: "restaurant", b: "Restaurant or food" }, { v: "retail", b: "Retail or e-commerce" },
        { v: "services", b: "Professional services" }, { v: "other", b: "Something else" }
      ], chips: true, other: "biztypeOther", otherLabel: "Tell the desk what it is" },

    { id: "contact", rail: "You", kind: "contact", required: true,
      q: "How does the desk reach you?",
      sub: "Email for the record, phone for the build call. Nothing is sold or shared." },

    { id: "account", rail: "You", kind: "account", required: true,
      q: "Make your account.",
      sub: "Your answers are already saved on this device. The account is what carries them onto the desk, and it's how you reach your workspace later." },

    /* ================= RUNWAY ================= */
    { id: "r_goal", rail: "Brief", kind: "textarea", key: "goal", required: true,
      when: offerIs("runway"),
      q: "What does the website need to do?",
      sub: "One line is enough. That line is the brief.",
      placeholder: "Take bookings. Show service times. Sell three products. Look legitimate to a lender." },

    { id: "r_domain", rail: "Brief", kind: "choice", key: "domain", required: true,
      when: offerIs("runway"),
      q: "Do you have a domain yet?",
      /* the price and the offer name both come from the ledger; typed here
         they went stale the moment either one moved */
      sub: function (L) {
        var o = window.MCC_OFFERS.offerOf(L, "runway") || {};
        var dom = (((o.pricing || {}).start || {}).components || [])
          .filter(function (c) { return c.id === "domain"; })[0];
        return (o.name || "This") + " includes registering one. The " +
          (dom ? window.MCC_OFFERS.dollars(dom.amount) : "domain") +
          " domain line is that registration, for the year.";
      },
      options: [
        { v: "have", b: "I own one already", s: "Point it here and keep it." },
        { v: "need", b: "I need one", s: "Included. The desk registers it with you." },
        { v: "unsure", b: "Not sure what I have", s: "The desk will check it for you." }
      ],
      /* The card on sites.html can arrive here with a name already
         checked and free. It lands as "I need one" plus the name, so
         nobody is asked to type an address they just chose. */
      follow: { when: ["have", "need"], key: "domainName", label: "Which domain?",
                placeholder: "yourbusiness.com" } },

    { id: "r_pages", rail: "Brief", kind: "multi", key: "pages", required: true,
      when: offerIs("runway"),
      q: "Which pages does it need?",
      sub: "Pick everything that applies. This is the basic build included with Runway.",
      options: [
        { v: "home", b: "Home" }, { v: "about", b: "About" }, { v: "services", b: "Services" },
        { v: "contact", b: "Contact" }, { v: "gallery", b: "Gallery" }, { v: "events", b: "Events" },
        { v: "shop", b: "Shop" }, { v: "give", b: "Give / donate" }, { v: "blog", b: "Blog" }
      ], chips: true },

    { id: "r_content", rail: "Brief", kind: "choice", key: "content", required: true,
      when: offerIs("runway"),
      q: "How ready is your content?",
      sub: "Words and pictures. An honest answer here sets a real timeline.",
      options: [
        { v: "ready", b: "Ready to go", s: "Text and images, in hand." },
        { v: "some", b: "Some of it", s: "Enough to start, gaps to fill." },
        { v: "little", b: "Barely any", s: "The desk helps you build it." },
        { v: "none", b: "Nothing yet", s: "Start from the blank page together." }
      ] },

    { id: "r_summary", rail: "Money", kind: "summary", when: offerIs("runway"),
      q: "Here's the whole cost.",
      sub: "No revenue share. No setup fee. No surprise line at the end." },

    /* ================= ANTI-SOCIAL ================= */
    { id: "a_site", rail: "Brief", kind: "choice", key: "site", required: true,
      when: offerIs("anti-social"),
      q: "Is there a website up right now?",
      sub: "Anti-Social either takes over what exists or builds what should.",
      options: [
        { v: "yes", b: "Yes, it's live" }, { v: "outdated", b: "Yes, but it's out of date" },
        { v: "building", b: "Being built now" }, { v: "none", b: "No site yet" }
      ], follow: { when: ["yes", "outdated"], key: "siteUrl", label: "What's the address?", placeholder: "yourbusiness.com" } },

    { id: "a_domain", rail: "Brief", kind: "choice", key: "domain", required: true,
      when: offerIs("anti-social"),
      q: "Who holds the domain?",
      sub: "The domain is always yours and is always paid separately, up front.",
      options: [
        { v: "me", b: "I do", s: "You keep it. The desk gets pointed at it." },
        { v: "someone", b: "Someone else set it up", s: "A past developer, a relative, an agency." },
        { v: "need", b: "I still need one" },
        { v: "unsure", b: "I don't know" }
      ] },

    { id: "a_goals", rail: "Brief", kind: "textarea", key: "goals", required: true,
      when: offerIs("anti-social"),
      q: "What should this move the needle on?",
      sub: "Bookings, foot traffic, membership, donations, sales — name the number you actually watch.",
      placeholder: "More booked jobs. Fewer phone calls asking about hours. Sunday attendance." },

    { id: "a_webneeds", rail: "Brief", kind: "multi", key: "webneeds", required: true,
      when: offerIs("anti-social"),
      q: "What does the website need from the desk each month?",
      sub: "Everything the site side of Anti-Social covers.",
      options: [
        { v: "edits", b: "Routine edits" }, { v: "pages", b: "New pages" },
        { v: "products", b: "Products / menu" }, { v: "events", b: "Events" },
        { v: "seo", b: "Search visibility" }, { v: "speed", b: "Speed & uptime" },
        { v: "forms", b: "Forms & bookings" }, { v: "payments", b: "Payments" }
      ], chips: true },

    { id: "a_platforms", rail: "Brief", kind: "multi", key: "platforms", required: true,
      when: offerIs("anti-social"),
      q: "Which social platforms should the desk run?",
      sub: "Only pick the ones that matter to you. Running four badly beats nothing, but running two well beats four.",
      options: [
        { v: "Instagram", b: "Instagram" }, { v: "TikTok", b: "TikTok" }, { v: "Facebook", b: "Facebook" },
        { v: "YouTube", b: "YouTube" }, { v: "LinkedIn", b: "LinkedIn" }, { v: "X", b: "X" },
        { v: "Pinterest", b: "Pinterest" }, { v: "Threads", b: "Threads" }
      ], chips: true },

    { id: "a_ownership", rail: "Brief", kind: "choice", key: "ownership", required: true,
      when: offerIs("anti-social"),
      q: "Who owns those accounts today?",
      sub: "Ownership stays with you. The desk works inside your accounts, never around them.",
      options: [
        { v: "me", b: "I own and control them" },
        { v: "staff", b: "A staff member or volunteer runs them" },
        { v: "agency", b: "A past agency or contractor has them" },
        { v: "locked", b: "They exist but I'm locked out" },
        { v: "none", b: "They don't exist yet" }
      ] },

    { id: "a_audience", rail: "Brief", kind: "textarea", key: "audience", required: true,
      when: offerIs("anti-social"),
      q: "Who are you talking to?",
      sub: "The more specific, the better the writing gets.",
      placeholder: "Homeowners within 20 miles. Families with young kids. Brides booking 9 months out." },

    { id: "a_voice", rail: "Brief", kind: "multi", key: "voice", required: true,
      when: offerIs("anti-social"),
      q: "How should the brand sound?",
      sub: "Pick a few. The desk writes in this voice and keeps it consistent.",
      options: [
        { v: "warm", b: "Warm" }, { v: "professional", b: "Professional" }, { v: "bold", b: "Bold" },
        { v: "reverent", b: "Reverent" }, { v: "funny", b: "Funny" }, { v: "plain", b: "Plain-spoken" },
        { v: "luxury", b: "Elevated" }, { v: "streetwise", b: "Streetwise" }
      ], chips: true, other: "voiceOther", otherLabel: "Anything else about the voice" },

    { id: "a_posting", rail: "Brief", kind: "choice", key: "posting", required: true,
      when: offerIs("anti-social"),
      q: "How often should things go out?",
      sub: "The approved number of platforms and the posting rhythm are set in your agreement.",
      options: [
        { v: "daily", b: "Daily" }, { v: "few-week", b: "A few times a week" },
        { v: "weekly", b: "Weekly" }, { v: "campaign", b: "Around campaigns and events" },
        { v: "advise", b: "You tell me what's right" }
      ] },

    { id: "a_approval", rail: "Brief", kind: "choice", key: "approval", required: true,
      when: offerIs("anti-social"),
      q: "Who approves before it posts?",
      sub: "Every workflow has a human approval step. This decides whose.",
      options: [
        { v: "me-all", b: "Me, everything", s: "Nothing goes out unseen." },
        { v: "me-new", b: "Me, for anything new", s: "Routine posts run on their own." },
        { v: "team", b: "Someone on my team", s: "You'll name them on the call." },
        { v: "desk", b: "The desk runs it", s: "Inside the brand voice we agree on." }
      ] },

    { id: "a_reporting", rail: "Brief", kind: "multi", key: "reporting", required: true,
      when: offerIs("anti-social"),
      q: "What do you want to see back?",
      sub: "Reporting cadence is written into the agreement.",
      options: [
        { v: "reach", b: "Reach & growth" }, { v: "engagement", b: "Engagement" },
        { v: "traffic", b: "Website traffic" }, { v: "leads", b: "Leads & enquiries" },
        { v: "sales", b: "Sales" }, { v: "posts", b: "What went out" }
      ], chips: true },

    { id: "a_payments", rail: "Brief", kind: "choice", key: "payments", required: true,
      when: offerIs("anti-social"),
      q: "Does the site take money online?",
      sub: function () {
        return isEquity()
          ? "On Equity Uprise this matters twice over: the connected payment rails are what eligible revenue is measured through, and exactly how it's measured is written into your agreement."
          : "Payment-rail connections are part of the service either way.";
      },
      options: [
        { v: "yes", b: "Yes, already connected" }, { v: "want", b: "Not yet, but it should" },
        { v: "no", b: "No, and it doesn't need to" }, { v: "unsure", b: "I'm not sure" }
      ] },

    { id: "a_access", rail: "Brief", kind: "multi", key: "access", required: true,
      when: offerIs("anti-social"),
      q: "What access can you provide?",
      sub: "Just tick what exists. The desk walks you through handing over each one safely, on a call.",
      options: [
        { v: "domain", b: "Domain registrar" }, { v: "host", b: "Current host" },
        { v: "social", b: "Social accounts" }, { v: "analytics", b: "Analytics" },
        { v: "payments", b: "Payment processor" }, { v: "email", b: "Business email" }
      ], chips: true,
      note: "Never send passwords here, or in any form. Access is handed over one on one, through each platform's own invite." },

    /* ================= WHO DID THE SHOOT ================= */
    { id: "w_type", rail: "Brief", kind: "choice", key: "projectType", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "What kind of project is it?",
      sub: "This sets which rate line the quote is built from.",
      options: [
        { v: "event", b: "Event coverage", s: "Concert, service, launch, conference." },
        { v: "brand", b: "Brand shoot", s: "The campaign library." },
        { v: "portrait", b: "Portraits or headshots" },
        { v: "product", b: "Product photography" },
        { v: "brand-film", b: "Brand film" },
        { v: "music-video", b: "Music video" },
        { v: "interview", b: "Interview or documentary" },
        { v: "other", b: "Something else" }
      ], other: "projectTypeOther", otherLabel: "Describe the project" },

    { id: "w_location", rail: "Brief", kind: "text", key: "location", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "Where is it?",
      sub: "City and state is enough for now. Travel outside the home bases is quoted openly, never hidden in the total.",
      placeholder: "Bridgeport, CT" },

    { id: "w_date", rail: "Brief", kind: "dates", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "When is it?",
      sub: "A second date that also works saves a booking that a single date would lose." },

    { id: "w_photo", rail: "Brief", kind: "multi", key: "photoNeeds",
      when: offerIs("who-did-the-shoot"),
      q: "What photography do you need?",
      sub: "Skip this if the job is video only.", optional: true,
      options: [
        { v: "event", b: "Event coverage" }, { v: "portraits", b: "Portraits" },
        { v: "product", b: "Product" }, { v: "editorial", b: "Editorial" },
        { v: "candid", b: "Candids" }, { v: "group", b: "Group photos" }
      ], chips: true },

    { id: "w_video", rail: "Brief", kind: "multi", key: "videoNeeds",
      when: offerIs("who-did-the-shoot"),
      q: "What video do you need?",
      sub: "Skip this if the job is photography only.", optional: true,
      options: [
        { v: "highlight", b: "Highlight film" }, { v: "shortform", b: "Short-form cuts" },
        { v: "interview", b: "Interviews" }, { v: "broll", b: "B-roll" },
        { v: "livestream", b: "Live stream" }, { v: "promo", b: "Promo spot" }
      ], chips: true },

    { id: "w_deliver", rail: "Brief", kind: "multi", key: "deliverables", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "What do you need delivered?",
      sub: "Final assets, graded in house.",
      options: [
        { v: "edited-photos", b: "Edited photos" }, { v: "raw", b: "Raw files" },
        { v: "video-final", b: "Finished video" }, { v: "social-cuts", b: "Social cuts" },
        { v: "vertical", b: "Vertical versions" }, { v: "captions", b: "Captions" }
      ], chips: true },

    { id: "w_usage", rail: "Brief", kind: "multi", key: "usage", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "Where will the work be used?",
      sub: "Usage rights are defined by the agreement, so this question decides real terms.",
      options: [
        { v: "social", b: "Social media" }, { v: "website", b: "Your website" },
        { v: "print", b: "Print" }, { v: "ads", b: "Paid advertising" },
        { v: "billboard", b: "Out of home" }, { v: "broadcast", b: "Broadcast" }
      ], chips: true },

    { id: "w_turn", rail: "Brief", kind: "choice", key: "turnaround", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "How fast do you need it back?",
      sub: "Same-day edits are real and priced as their own line.",
      options: [
        { v: "same-day", b: "Same day", s: "The cut plays before the night ends." },
        { v: "48h", b: "Within 48 hours" }, { v: "week", b: "Within a week" },
        { v: "standard", b: "Standard turnaround is fine" }
      ] },

    { id: "w_platforms", rail: "Brief", kind: "multi", key: "platforms", required: true,
      when: offerIs("who-did-the-shoot"),
      q: "Which platforms is this cut for?",
      sub: "It changes aspect ratios, pacing and how much gets shot.",
      options: [
        { v: "Instagram", b: "Instagram" }, { v: "TikTok", b: "TikTok" }, { v: "YouTube", b: "YouTube" },
        { v: "Facebook", b: "Facebook" }, { v: "Website", b: "Website" }, { v: "Print", b: "Print" }
      ], chips: true },

    /* ================= WRITE A SONG ================= */
    { id: "g_brand", rail: "Brief", kind: "text", key: "campaignBrand", required: true,
      when: offerIs("write-a-song"),
      q: "Whose campaign is this?",
      sub: "The brand, product or moment the song is being written for.",
      placeholder: "The brand or campaign name" },

    { id: "g_goal", rail: "Brief", kind: "textarea", key: "campaignGoal", required: true,
      when: offerIs("write-a-song"),
      q: "What should the song accomplish?",
      sub: "No campaign here promises virality, views, sales or placement. Name the real objective and the work gets built around it.",
      placeholder: "Launch the new location. Make the brand name stick. Own a season." },

    { id: "g_audience", rail: "Brief", kind: "textarea", key: "campaignAudience", required: true,
      when: offerIs("write-a-song"),
      q: "Who is it for?",
      sub: "Who has to hear this and feel something.",
      placeholder: "18–34 in the tri-state. Church families. Sneaker buyers who already know the brand." },

    { id: "g_format", rail: "Brief", kind: "choice", key: "songFormat", required: true,
      when: offerIs("write-a-song"),
      q: "A jingle, or a full song?",
      sub: "Both are written and produced in house. They are different pieces of work.",
      options: [
        { v: "jingle", b: "A jingle", s: "Short, memorable, built to repeat." },
        { v: "full-song", b: "A full song", s: "A real record the campaign lives inside." },
        { v: "both", b: "Both", s: "The song, and a cut-down for spots." },
        { v: "advise", b: "You tell me which", s: "Decided in discovery." }
      ] },

    { id: "g_direction", rail: "Brief", kind: "multi", key: "musicalDirection", required: true,
      when: offerIs("write-a-song"),
      q: "What should it sound like?",
      sub: "Pick a few directions. Reference tracks can come later.",
      options: [
        { v: "hiphop", b: "Hip-hop" }, { v: "rnb", b: "R&B" }, { v: "gospel", b: "Gospel" },
        { v: "pop", b: "Pop" }, { v: "rock", b: "Rock" }, { v: "country", b: "Country" },
        { v: "afrobeat", b: "Afrobeat" }, { v: "electronic", b: "Electronic" },
        { v: "acoustic", b: "Acoustic" }
      ], chips: true, other: "directionOther", otherLabel: "References or anything else" },

    { id: "g_concept", rail: "Brief", kind: "textarea", key: "campaignConcept", required: true,
      when: offerIs("write-a-song"),
      q: "What's the campaign concept?",
      sub: "Even a rough idea. If there isn't one yet, say so — building it is part of the work.",
      placeholder: "The idea, the hook, the moment, or 'no idea yet — that's what I need'." },

    { id: "g_platforms", rail: "Brief", kind: "multi", key: "platforms", required: true,
      when: offerIs("write-a-song"),
      q: "Where does the campaign live?",
      sub: "It shapes the rollout and the deliverables.",
      options: [
        { v: "TikTok", b: "TikTok" }, { v: "Instagram", b: "Instagram" }, { v: "YouTube", b: "YouTube" },
        { v: "Radio", b: "Radio" }, { v: "TV", b: "TV" }, { v: "Spotify", b: "Streaming" },
        { v: "In-store", b: "In-store" }, { v: "Events", b: "Events" }
      ], chips: true },

    { id: "g_influencer", rail: "Brief", kind: "choice", key: "influencer", required: true,
      when: offerIs("write-a-song"),
      q: "Should influencers be part of it?",
      sub: "Influencer budgets are always quoted as their own line, never folded into a total. No participation is ever guaranteed.",
      options: [
        { v: "yes", b: "Yes, that's the plan" },
        { v: "maybe", b: "Maybe, if it's worth it" },
        { v: "no", b: "No" },
        { v: "advise", b: "You tell me" }
      ] },

    { id: "g_deliver", rail: "Brief", kind: "multi", key: "deliverables", required: true,
      when: offerIs("write-a-song"),
      q: "What do you need delivered?",
      sub: "The song is the centre. These are the pieces around it.",
      options: [
        { v: "master", b: "Final master" }, { v: "stems", b: "Stems" },
        { v: "cutdowns", b: "15s / 30s cuts" }, { v: "video", b: "Music video" },
        { v: "social", b: "Social assets" }, { v: "lyrics", b: "Lyric assets" },
        { v: "instrumental", b: "Instrumental" }
      ], chips: true },

    { id: "g_timeline", rail: "Brief", kind: "choice", key: "timeline", required: true,
      when: offerIs("write-a-song"),
      q: "When does it need to land?",
      sub: "Release planning is part of the campaign.",
      options: [
        { v: "asap", b: "As soon as possible" }, { v: "1month", b: "Within a month" },
        { v: "quarter", b: "This quarter" }, { v: "season", b: "Tied to a season or event" },
        { v: "open", b: "No fixed date" }
      ] },

    { id: "g_rights", rail: "Brief", kind: "choice", key: "rights", required: true,
      when: offerIs("write-a-song"),
      q: "What rights do you need?",
      sub: "Publishing, master ownership and licensing are written into the agreement. Nothing is assumed here.",
      options: [
        { v: "campaign", b: "Use it for this campaign" },
        { v: "perpetual", b: "Use it indefinitely" },
        { v: "exclusive", b: "Exclusive to us" },
        { v: "broadcast", b: "Broadcast and paid media" },
        { v: "advise", b: "Work it out in discovery" }
      ] },

    /* ---------------- budget: both project services ---------------- */
    { id: "budget", rail: "Money", kind: "choice", key: "budget", required: true,
      when: function () { return S.offer === "who-did-the-shoot" || S.offer === "write-a-song"; },
      q: "What's the budget?",
      sub: "An honest band gets you an honest quote faster than a guess does. Every rate is published on the hire page.",
      options: [
        { v: "under-1k", b: "Under $1,000" }, { v: "1-3k", b: "$1,000 – $3,000" },
        { v: "3-8k", b: "$3,000 – $8,000" }, { v: "8-20k", b: "$8,000 – $20,000" },
        { v: "20k-plus", b: "$20,000 and up" }, { v: "unsure", b: "I need guidance" }
      ] },

    /* ---------------- the Equity acknowledgement, alone ---------------- */
    { id: "equity_ack", rail: "Terms", kind: "ack", key: "equityAck", required: true,
      when: isEquity,
      q: "Before you go further.",
      sub: "Equity Uprise changes what you pay and what you share. Read it, then acknowledge it." },

    /* ---------------- review ---------------- */
    { id: "review", rail: "Review", kind: "review",
      q: "Check it, then send it.",
      sub: "Change anything that isn't right. This is what lands on the desk." }
  ];

  /* the live walk: only the steps whose condition holds */
  function walk() {
    return STEPS.filter(function (s) { return !s.when || s.when(); });
  }
  function railOf(w) {
    var seen = [], out = [];
    w.forEach(function (s) { if (seen.indexOf(s.rail) === -1) { seen.push(s.rail); out.push(s.rail); } });
    return out;
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  function fieldValue(key) { return S[key]; }

  function optionButton(s, o, selected) {
    return '<button type="button" role="button" data-v="' + esc(o.v) + '"' +
      ' aria-pressed="' + (selected ? "true" : "false") + '">' +
      (o.pr ? '<span class="pr">' + esc(o.pr) + "</span>" : "") +
      /* a mode carries its mark here too, so the walk shows the same two
         emblems the ladder and the chapters show. The name stays visible
         on this screen: the picker is a full-width row with room for it,
         and somebody mid-walk is choosing, not recognising. */
      (o.mark ? '<img class="pick__mark" src="' + esc(o.mark) + '" alt="" width="32" height="32" decoding="async">' : "") +
      "<b>" + esc(o.b) + "</b>" + (o.s ? "<small>" + esc(o.s) + "</small>" : "") + "</button>";
  }

  function renderOffer(s) {
    var offers = (L.offers || []).slice().sort(function (a, b) { return a.position - b.position; });
    return '<div class="pick" data-role="offer">' + offers.map(function (o) {
      var pr = window.MCC_OFFERS.priceOf(L, o.id, "m");
      var tag = pr && pr.approved ? (pr.kind === "start" ? pr.display + " to start" : pr.display) : "";
      return optionButton(s, { v: o.id, b: o.name, s: o.lede, pr: tag }, S.offer === o.id);
    }).join("") + "</div>";
  }

  function renderMode(s) {
    var o = window.MCC_OFFERS.offerOf(L, S.offer);
    if (!o) return "";
    return '<div class="pick" data-role="mode">' + o.modes.map(function (m) {
      var md = L.modes[m];
      var pr = window.MCC_OFFERS.priceOf(L, o.id, m);
      var tag = pr && pr.approved ? pr.display : "";
      var sub = md.short;
      if (m === "equity" && pr && pr.approved) {
        sub = md.short + " Here: " + pr.share_percent + "% of eligible connected revenue, up to " +
          pr.term_months + " months, capped at $" + window.MCC_OFFERS.money(pr.cap) + ".";
      } else if (m === "equity" && pr && !pr.approved) {
        sub = md.short + " " + pr.note;
      }
      /* Equity Uprise is never preselected: only an explicit choice selects it */
      return optionButton(s, { v: m, b: md.name, s: sub, pr: tag, mark: md.emblem }, S.mode === m);
    }).join("") + "</div>";
  }

  function renderSummary() {
    var o = window.MCC_OFFERS.offerOf(L, "runway");
    var p = o.pricing, M = window.MCC_OFFERS.money;
    var rows = (p.start.components || []).map(function (c) {
      return "<li><span>" + esc(c.label) + "</span><b>$" + M(c.amount) + "</b></li>";
    }).join("");
    rows += '<li class="is-total"><span>Due today</span><b>$' + M(p.start.total) + "</b></li>";
    rows += "<li><span>" + esc(p.recurring.label) + "</span><b>$" + M(p.recurring.amount) +
      "/" + esc(p.recurring.cadence) + "</b></li>";
    rows += "<li><span>" + esc(p.domain_renewal.label) + "</span><b>$" + M(p.domain_renewal.amount) +
      "/" + esc(p.domain_renewal.cadence) + "</b></li>";
    rows += "<li><span>Basic website build</span><b>Included</b></li>";
    rows += "<li><span>Revenue share</span><b>None</b></li>";
    rows += "<li><span>First year, all in <i style='display:block;font-style:normal;font-size:0.74rem;color:rgba(244,239,230,0.45)'>" +
      esc(p.first_year.breakdown) + "</i></span><b>$" + M(p.first_year.amount) + "</b></li>";

    return '<div class="obsum">' +
      '<div class="obsum__n"><sup>$</sup>' + M(p.start.total) +
        '<span class="obsum__per">' + esc(p.start.label) + "</span></div>" +
      "<ul>" + rows + "</ul></div>" +
      '<p class="ob__note">' + esc(L.estimate_disclaimer) + " Checkout opens after the desk confirms your domain is available.</p>";
  }

  function renderAck() {
    var eq = L.modes.equity;
    var pr = window.MCC_OFFERS.priceOf(L, S.offer, "equity");
    var o = window.MCC_OFFERS.offerOf(L, S.offer);
    var terms = "";
    if (pr && pr.approved) {
      terms = '<ul class="oback__terms">' +
        "<li><span>You pay</span><b>$" + window.MCC_OFFERS.money(pr.amount) + " per " + esc(pr.cadence) + "</b></li>" +
        "<li><span>You share</span><b>" + pr.share_percent + "% of eligible connected revenue</b></li>" +
        "<li><span>For</span><b>Up to " + pr.term_months + " months</b></li>" +
        "<li><span>Never more than</span><b>$" + window.MCC_OFFERS.money(pr.cap) + "</b></li>" +
        "<li><span>Sharing ends at</span><b>Whichever comes first</b></li>" +
        "<li><span>Ownership taken</span><b>None</b></li></ul>";
    } else {
      var epr = ((o.pricing || {}).equity) || {};
      terms = '<ul class="oback__terms">' +
        "<li><span>Terms</span><b>" + esc(epr.public_note || "Structured during discovery.") + "</b></li>" +
        "<li><span>Ownership taken</span><b>None</b></li></ul>" +
        (epr.public_detail ? '<p style="margin-top:0.9rem">' + esc(epr.public_detail) + "</p>" : "");
    }

    return '<div class="oback"><p><b>' + esc(eq.plain) + "</b></p>" + terms +
      "<p>" + esc(L.revenue_definition.public_note) + "</p></div>" +
      '<label class="obcheck"><input type="checkbox" id="obAck"' + (S.equityAck ? " checked" : "") + ">" +
      "<span>" + esc(eq.acknowledgement) + "</span></label>";
  }

  /* the answers, as the desk will read them */
  function answerLines() {
    var w = walk(), out = [];
    w.forEach(function (s) {
      if (s.kind === "review" || s.kind === "summary" || s.kind === "account") return;
      if (s.kind === "offer" || s.kind === "mode") return;
      if (s.kind === "contact") {
        out.push("Contact: " + (S.email || "—") + " · " + (S.phone || "—"));
        return;
      }
      if (s.kind === "dates") {
        out.push("Date: " + (S.date || "—") + (S.dateAlt ? " (alternate: " + S.dateAlt + ")" : ""));
        return;
      }
      if (s.kind === "ack") {
        out.push("Equity Uprise acknowledged: " + (S.equityAck ? "yes" : "no"));
        return;
      }
      var v = S[s.key];
      if (Array.isArray(v)) v = v.join(", ");
      var label = String(s.q).replace(/\?$/, "");
      var extra = "";
      if (s.follow && S[s.follow.key]) extra = " · " + S[s.follow.key];
      if (s.other && S[s.other]) extra += " · " + S[s.other];
      out.push(label + ": " + (v || "no answer") + extra);
    });
    return out;
  }

  function renderReview() {
    var w = walk();
    var rows = [];
    var o = window.MCC_OFFERS.offerOf(L, S.offer);
    var modeName = S.offer === "runway"
      ? "No mode. Infrastructure has no Equity version."
      : (L.modes[S.mode] || {}).name;
    var pr = window.MCC_OFFERS.priceOf(L, S.offer, S.offer === "runway" ? "m" : S.mode);

    rows.push(["Service", (o ? o.name : "—") + " · " + modeName, "offer"]);
    rows.push(["What it costs", pr && pr.approved
      ? (pr.kind === "start" ? pr.display + " to start, then $" + window.MCC_OFFERS.money(o.pricing.recurring.amount) + "/month"
        : pr.display + " " + pr.per)
      : (pr ? pr.note : "—"), "offer"]);

    w.forEach(function (s) {
      if (["offer", "mode", "review", "summary", "account"].indexOf(s.kind) !== -1) return;
      var v;
      if (s.kind === "contact") v = (S.email || "—") + " · " + (S.phone || "—");
      else if (s.kind === "dates") v = (S.date || "—") + (S.dateAlt ? " (or " + S.dateAlt + ")" : "");
      else if (s.kind === "ack") v = S.equityAck ? "Acknowledged" : "Not acknowledged";
      else {
        v = S[s.key];
        if (Array.isArray(v)) v = v.join(", ");
      }
      if (s.follow && S[s.follow.key]) v += " · " + S[s.follow.key];
      if (s.other && S[s.other]) v += " · " + S[s.other];
      rows.push([String(s.q).replace(/\?$/, ""), v || "no answer", s.id]);
    });

    return '<ul class="rev">' + rows.map(function (r) {
      return "<li><b>" + esc(r[0]) + "</b><span>" + esc(r[1]) + "</span>" +
        '<button type="button" class="rev__edit" data-goto="' + esc(r[2]) + '">Change</button></li>';
    }).join("") + "</ul>" +
    '<p class="ob__note" id="obSendMsg"></p>';
  }

  function render() {
    var w = walk();
    at = Math.max(0, Math.min(at, w.length - 1));
    var s = w[at];
    var rail = railOf(w);
    var railAt = rail.indexOf(s.rail);

    /* the named rail */
    el("obRail").innerHTML = rail.map(function (r, i) {
      return '<span class="' + (i === railAt ? "is-here" : i < railAt ? "is-done" : "") + '">' + esc(r) + "</span>";
    }).join("");

    /* segmented progress, one segment per live step */
    el("obSegs").innerHTML = w.map(function (_, i) {
      return '<i class="' + (i < at ? "is-done" : i === at ? "is-here" : "") + '"></i>';
    }).join("");
    var prog = el("obProg");
    prog.setAttribute("aria-valuenow", String(at + 1));
    prog.setAttribute("aria-valuemax", String(w.length));
    prog.setAttribute("aria-valuetext", "Step " + (at + 1) + " of " + w.length + ", " + s.rail);
    el("obStep").textContent = "Step " + (at + 1) + " of " + w.length;

    /* the question */
    var offer = S.offer ? window.MCC_OFFERS.offerOf(L, S.offer) : null;
    var ctx = offer ? offer.name + (S.offer !== "runway" && S.mode ? " · " + L.modes[S.mode].name : "") : "Onboarding";
    /* a step may compute its own sub-line from the ledger rather than
       carrying a typed copy of a price that can go stale */
    var sub = typeof s.sub === "function" ? s.sub(L) : s.sub;

    var body = "";
    switch (s.kind) {
      case "offer": body = renderOffer(s); break;
      case "mode": body = renderMode(s); break;
      case "choice":
      case "multi": {
        var sel = S[s.key];
        body = '<div class="pick' + (s.chips ? " pick--chips" : "") + '" data-role="' + s.kind + '" data-key="' + esc(s.key) + '">' +
          s.options.map(function (o) {
            var on = s.kind === "multi" ? (sel || []).indexOf(o.v) !== -1 : sel === o.v;
            return optionButton(s, o, on);
          }).join("") + "</div>";
        if (s.follow) {
          var show = [].concat(s.follow.when).indexOf(S[s.key]) !== -1;
          body += '<div id="obFollow"' + (show ? "" : " hidden") + '>' +
            '<label class="ob__lbl" for="obFollowIn">' + esc(s.follow.label) + "</label>" +
            '<input type="text" id="obFollowIn" placeholder="' + esc(s.follow.placeholder || "") +
            '" value="' + esc(S[s.follow.key] || "") + '"></div>';
        }
        if (s.other) {
          body += '<label class="ob__lbl" for="obOther">' + esc(s.otherLabel || "Anything else") + "</label>" +
            '<input type="text" id="obOther" value="' + esc(S[s.other] || "") + '">';
        }
        break;
      }
      case "text":
        body = '<input type="text" id="obIn" placeholder="' + esc(s.placeholder || "") +
          '" value="' + esc(fieldValue(s.key) || "") + '"' +
          (s.autocomplete ? ' autocomplete="' + esc(s.autocomplete) + '"' : "") +
          ' aria-labelledby="obQ">';
        break;
      case "textarea":
        body = '<textarea id="obIn" rows="4" placeholder="' + esc(s.placeholder || "") +
          '" aria-labelledby="obQ">' + esc(fieldValue(s.key) || "") + "</textarea>";
        break;
      case "contact":
        body = '<label class="ob__lbl" for="obEmail">Email</label>' +
          '<input type="email" id="obEmail" autocomplete="email" value="' + esc(S.email || "") + '">' +
          '<label class="ob__lbl" for="obPhone">Phone</label>' +
          '<input type="tel" id="obPhone" autocomplete="tel" value="' + esc(S.phone || "") + '">';
        break;
      case "dates":
        body = '<label class="ob__lbl" for="obDate">Preferred date</label>' +
          '<input type="date" id="obDate" value="' + esc(S.date || "") + '">' +
          '<label class="ob__lbl" for="obDateAlt">Another date that works <i style="font-style:normal;opacity:.6">(optional)</i></label>' +
          '<input type="date" id="obDateAlt" value="' + esc(S.dateAlt || "") + '">';
        break;
      case "account":
        body = '<div id="obAcctIn"></div>';
        break;
      case "summary": body = renderSummary(); break;
      case "ack": body = renderAck(); break;
      case "review": body = renderReview(); break;
    }

    el("obStage").innerHTML =
      '<p class="ob__ctx">' + esc(ctx) + "</p>" +
      '<h1 id="obQ">' + esc(s.q) + "</h1>" +
      (sub ? '<p class="ob__sub">' + esc(sub) + "</p>" : "") +
      body +
      (s.note ? '<p class="ob__note">' + esc(s.note) + "</p>" : "") +
      '<p class="ob__err" id="obErr" hidden></p>';

    el("obBack").hidden = at === 0;
    var next = el("obNext");
    next.textContent = s.kind === "review" ? "Send it to the desk" :
      s.kind === "summary" ? "Looks right — continue" : "Continue";
    next.disabled = false;

    if (s.kind === "account") mountAccount();

    /* focus the question so a screen reader and a keyboard land in the right place */
    var h = el("obQ"); h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (window.MCC_TRACK) window.MCC_TRACK("onboard_step", { step: s.id, offer: S.offer || "", mode: S.mode || "" });
  }

  /* ---------- stage wiring, attached ONCE ----------
     #obStage survives every render; only its innerHTML is replaced. Binding
     per render would stack one listener set per screen, and each stale
     listener would still hold the step it closed over — typing a name would
     then write that name into every earlier step's key. So these bind once
     and read the current step at event time. */
  function wireStage() {
    var stage = el("obStage");
    var current = function () { return walk()[at]; };

    stage.addEventListener("click", function (e) {
      var s = current();
      var b = e.target.closest && e.target.closest(".pick > button");
      if (!b) return;
      var wrap = b.parentElement, role = wrap.dataset.role, v = b.dataset.v;

      if (role === "offer") {
        if (S.offer !== v) { S.mode = null; }     /* changing offer clears a stale mode */
        S.offer = v;
        if (v === "runway") S.mode = "m";          /* Runway has exactly one mode */
      } else if (role === "mode") {
        S.mode = v;
      } else if (role === "multi") {
        var key = wrap.dataset.key;
        S[key] = S[key] || [];
        var i = S[key].indexOf(v);
        if (i === -1) S[key].push(v); else S[key].splice(i, 1);
      } else {
        S[wrap.dataset.key] = v;
      }
      save();

      /* repaint pressed state without rebuilding the screen */
      if (role === "multi") {
        b.setAttribute("aria-pressed", String(S[wrap.dataset.key].indexOf(v) !== -1));
      } else {
        wrap.querySelectorAll("button").forEach(function (x) {
          x.setAttribute("aria-pressed", String(x === b));
        });
      }
      if (s.follow) {
        var f = el("obFollow");
        if (f) f.hidden = [].concat(s.follow.when).indexOf(S[s.key]) === -1;
      }
      var err = el("obErr"); if (err) err.hidden = true;

      /* the review screen's Change links jump straight to a question */
      var g = e.target.closest && e.target.closest("[data-goto]");
      if (g) {
        var id = g.dataset.goto, w = walk();
        for (var i = 0; i < w.length; i++) if (w[i].id === id) { at = i; render(); return; }
      }
    });

    stage.addEventListener("input", function (e) {
      var s = current(), t = e.target;
      if (t.id === "obIn") S[s.key] = t.value;
      else if (t.id === "obFollowIn") S[s.follow.key] = t.value;
      else if (t.id === "obOther") S[s.other] = t.value;
      else if (t.id === "obEmail") S.email = t.value;
      else if (t.id === "obPhone") S.phone = t.value;
      else if (t.id === "obDate") S.date = t.value;
      else if (t.id === "obDateAlt") S.dateAlt = t.value;
      else if (t.id === "obAck") S.equityAck = t.checked;
      else return;
      save();
    });

    stage.addEventListener("change", function (e) {
      if (e.target.id === "obAck") { S.equityAck = e.target.checked; save(); }
    });

    /* Enter advances a single-line question */
    stage.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.tagName === "TEXTAREA") return;
      if (e.target.tagName === "INPUT") { e.preventDefault(); el("obNext").click(); }
    });
  }

  /* ---------- validation ---------- */
  function validate(s) {
    if (s.optional) return true;
    switch (s.kind) {
      case "offer": return S.offer ? true : "Pick the service you came for.";
      case "mode": return S.mode ? true : "Pick how you want to pay. Neither one is preselected on purpose.";
      case "contact":
        if (!/^\S+@\S+\.\S+$/.test((S.email || "").trim())) return "Type the whole email address.";
        if (!(S.phone || "").trim()) return "A phone number, just for the build call.";
        return true;
      case "dates": return (S.date || "").trim() ? true : "Give the desk a date to hold.";
      case "ack": return S.equityAck ? true : "Tick the box to confirm you've read the terms.";
      case "multi":
        if (!s.required) return true;
        return (S[s.key] || []).length ? true : "Pick at least one.";
      case "text":
      case "textarea":
      case "choice":
        if (!s.required) return true;
        return (S[s.key] || "").toString().trim() ? true : "This one's needed before the next screen.";
      default: return true;
    }
  }

  /* ---------- the account: person -> organization workspace ---------- */
  function mountAccount() {
    var host = el("obAcctIn");
    if (!host) return;
    var u = window.MCC_AUTH && window.MCC_AUTH.user && window.MCC_AUTH.user();
    if (u) {
      host.innerHTML = '<div class="oback"><p><b>Signed in as ' + esc(u.name || u.email) + ".</b></p>" +
        "<p>Your workspace for <b>" + esc(S.org || "your organization") + "</b> is ready. Continue.</p></div>";
      return;
    }
    host.innerHTML =
      '<div id="obMake"><label class="ob__lbl" for="obPass">Pick a password</label>' +
      '<input type="password" id="obPass" autocomplete="new-password" placeholder="At least 8 characters">' +
      '<p class="ob__note">Creating it as <b>' + esc(S.email || "your email") + "</b>. " +
      '<button type="button" class="ob__skip" id="obToIn">Already have an account? Sign in</button></p></div>' +
      '<div id="obIn2" hidden><label class="ob__lbl" for="obInEmail">Email</label>' +
      '<input type="email" id="obInEmail" autocomplete="email" value="' + esc(S.email || "") + '">' +
      '<label class="ob__lbl" for="obInPass">Password</label>' +
      '<input type="password" id="obInPass" autocomplete="current-password">' +
      '<p class="ob__note"><button type="button" class="ob__skip" id="obToMake">Make a new account instead</button></p></div>';

    el("obToIn").addEventListener("click", function () { el("obMake").hidden = true; el("obIn2").hidden = false; });
    el("obToMake").addEventListener("click", function () { el("obIn2").hidden = true; el("obMake").hidden = false; });
  }

  function ensureAccount() {
    var A = window.MCC_AUTH;
    if (!A) return Promise.reject("Accounts are being wired. Email matthew@mccluster.org and it counts the same.");
    var u = A.user && A.user();
    if (u) return Promise.resolve();

    var signIn = el("obIn2");
    if (signIn && !signIn.hidden) {
      var em = (el("obInEmail").value || "").trim(), pw = el("obInPass").value || "";
      if (!/^\S+@\S+\.\S+$/.test(em) || !pw) return Promise.reject("Email and password, both.");
      return A.signInPassword(em, pw);
    }
    var pass = (el("obPass") || {}).value || "";
    if (pass.length < 8) return Promise.reject("Password needs 8 characters or more.");
    return A.signUpPassword((S.email || "").trim(), pass, { name: S.name, phone: S.phone })
      .then(function (res) {
        if (res && res.confirm) throw "Confirm the email just sent, then come back to this page. Every answer is saved.";
      });
  }

  /* ---------- the workspace completion state ---------- */
  function finish(shape) {
    var o = window.MCC_OFFERS.offerOf(L, S.offer);
    var id = window.MCC_OFFER_CRM.identity(L, S.offer, S.offer === "runway" ? "m" : S.mode);
    var isProject = S.offer === "who-did-the-shoot" || S.offer === "write-a-song";

    var open = isRunway()
      ? [["Domain checked and registered", "The desk confirms availability, then checkout opens for $" +
          window.MCC_OFFERS.money(o.pricing.start.total) + "."],
         ["Build call", "Twenty minutes. Pages, content, the look."],
         ["Site built and shipped", "Basic build, hosted, SSL on."]]
      : isProject
      ? [["Discovery call", "The brief gets turned into a quote and a schedule."],
         ["Quote and agreement", "Every line itemised, third-party budgets shown separately."],
         [S.offer === "who-did-the-shoot" ? "Shoot booked" : "Campaign built", "Dates locked and the work begins."]]
      : [["Discovery call", "Access, accounts and the posting plan."],
         ["Agreement signed", "Scope, platforms, reporting and terms in writing."],
         ["Handover and first month", "Accounts connected, the desk takes over."]];

    var rows = [["Account created", "You're signed in and your answers are on the desk.", true],
      ["Brief filed", "Everything you answered, in one record.", true]]
      .concat(open.map(function (r) { return [r[0], r[1], false]; }));

    var doneCount = rows.filter(function (r) { return r[2]; }).length;

    el("obRail").innerHTML = "";
    el("obSegs").innerHTML = "";
    el("obStep").textContent = "Complete";
    el("obProg").setAttribute("aria-valuetext", "Onboarding complete");
    el("obBack").hidden = true;
    el("obNext").hidden = true;
    el("obNav").hidden = true;

    el("obStage").innerHTML =
      '<p class="ob__ctx">' + esc(o.name) + (S.offer !== "runway" ? " · " + esc(L.modes[S.mode].name) : "") + "</p>" +
      '<h1 class="ws__hi">Welcome, <em>' + esc((S.name || "").split(" ")[0] || "friend") + ".</em></h1>" +
      '<p class="ob__sub">This is your workspace. The desk has your brief and replies fast, usually the same day.</p>' +

      '<div class="ws__card"><div class="ws__head"><h2>Getting set up</h2>' +
        '<span class="ws__count">' + doneCount + "/" + rows.length + " complete</span></div>" +
        '<ul class="ws__list">' + rows.map(function (r) {
          return '<li class="' + (r[2] ? "is-done" : "") + '"><span><span class="ws__t">' + esc(r[0]) +
            '</span><span class="ws__d">' + esc(r[1]) + "</span></span></li>";
        }).join("") + "</ul></div>" +

      '<div class="ws__card"><div class="ws__head"><h2>Your engagement</h2></div>' +
        '<ul class="ws__chain">' +
        "<li><span>Person</span><b>" + esc(S.name || "—") + "</b></li>" +
        "<li><span>Organization</span><b>" + esc(S.org || "—") + "</b></li>" +
        "<li><span>Service</span><b>" + esc(id.label) + "</b></li>" +
        "<li><span>" + (isProject ? "Project" : "Property") + "</span><b>" +
          esc(S.siteUrl || S.domainName || S.campaignBrand || S.location || S.org || "—") + "</b></li>" +
        "<li><span>Your role</span><b>Owner</b></li>" +
        "<li><span>The desk's role</span><b>" +
          esc(isRunway() ? "Builder" : isProject ? "Producer" : "Manager") + "</b></li>" +
        "</ul></div>" +

      (isRunway()
        ? '<a class="ws__go" href="pay.html?offer=runway">Continue to checkout · $' +
            window.MCC_OFFERS.money(o.pricing.start.total) + "</a>"
        : '<a class="ws__go" href="console.html">Open your console</a>') +
      '<a class="ws__alt" href="console.html">Everything filed lives in your console &rarr;</a>' +
      (shape === "legacy" ? "" : "");

    try { localStorage.removeItem(KEY); } catch (e) {}
    if (window.MCC_TRACK) window.MCC_TRACK("onboard_sent", { offer: id.offer, mode: id.mode || "", config: id.config });
  }

  /* ---------- send ---------- */
  function send() {
    var btn = el("obNext");
    btn.disabled = true; btn.textContent = "Sending…";
    var payload = window.MCC_OFFER_CRM.build(L, {
      offer: S.offer, mode: S.mode, lines: answerLines()
    });

    window.MCC_OFFER_CRM.post(payload).then(function (res) {
      finish(res.shape);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "Send it to the desk";
      var m = el("obSendMsg");
      if (m) m.innerHTML = "The desk's wire is busy. Send the exact same brief by email instead: " +
        '<a href="mailto:matthew@mccluster.org?subject=' +
        encodeURIComponent("Onboarding · " + (S.org || "")) + "&body=" +
        encodeURIComponent(payload.body) + '">one tap</a>. It lands on the same desk.';
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  window.MCC_OFFERS.load().then(function (ledger) {
    L = ledger;

    /* deep links: ?offer= and ?plan= (the legacy lane links still work) */
    var q = new URLSearchParams(location.search);
    var qOffer = q.get("offer"), qMode = q.get("mode"), qPlan = q.get("plan");
    if (qOffer && window.MCC_OFFERS.offerOf(L, qOffer)) {
      S.offer = qOffer;
      if (qOffer === "runway") S.mode = "m";
    } else if (qPlan) {
      /* a legacy ?plan=hosting|management|social link maps onto the ladder.
         `web` joins them: the single Web lane that shipped to main sent
         people here as ?plan=web&mode=paid, and those links are already out
         in the world and on the live site until this deploys. Web is the
         website-and-socials service, which is Anti-Social here. */
      var map = { hosting: "runway", management: "anti-social",
                  social: "anti-social", web: "anti-social" };
      if (map[qPlan]) { S.offer = map[qPlan]; if (map[qPlan] === "runway") S.mode = "m"; }
    }
    /* Equity Uprise is never preselected — a ?mode=equity link is ignored.
       `paid` is what the Web lane called the standard rate; it means m. */
    if ((qMode === "m" || qMode === "paid") && S.offer && S.offer !== "runway") S.mode = "m";

    /* ?domain= — the address box on sites.html found this name free and
       sent it here. It is a prefill, not a purchase: the question is
       still asked, it just already has the answer in it. Only a name
       that survives the same shape check the search box applies is
       taken; a query string is typed by whoever holds the link. */
    var qDomain = (q.get("domain") || "").toLowerCase().trim();
    if (S.offer === "runway" && /^[a-z0-9-]{1,63}\.[a-z]{2,63}$/.test(qDomain)) {
      S.domain = "need";
      S.domainName = qDomain;
    }
    save();

    /* resume where they left off */
    var w = walk();
    if (S.offer) {
      for (var i = 0; i < w.length; i++) {
        var s = w[i], v = S[s.key];
        var answered = s.kind === "contact" ? (S.email && S.phone)
          : s.kind === "dates" ? !!S.date
          : s.kind === "ack" ? !!S.equityAck
          : s.kind === "account" ? !!(window.MCC_AUTH && window.MCC_AUTH.user && window.MCC_AUTH.user())
          : Array.isArray(v) ? v.length : !!v;
        if (!answered && !s.optional && s.kind !== "summary" && s.kind !== "review") { at = i; break; }
        at = i;
      }
    }

    el("obNext").addEventListener("click", function () {
      var w2 = walk(), s = w2[at];
      var v = validate(s);
      var err = el("obErr");
      if (v !== true) { err.textContent = v; err.hidden = false; err.focus && err.focus(); return; }
      err.hidden = true;

      if (s.kind === "review") { send(); return; }

      if (s.kind === "account") {
        var btn = this;
        btn.disabled = true; btn.textContent = "One second…";
        ensureAccount().then(function () {
          btn.disabled = false; btn.textContent = "Continue";
          at = Math.min(at + 1, walk().length - 1); render();
        }).catch(function (e) {
          btn.disabled = false; btn.textContent = "Continue";
          err.textContent = typeof e === "string" ? e : (e && e.message) || "That didn't go through. Try again.";
          err.hidden = false;
        });
        return;
      }
      at = Math.min(at + 1, walk().length - 1);
      render();
    });

    el("obBack").addEventListener("click", function () { at = Math.max(0, at - 1); render(); });

    wireStage();
    render();
  }).catch(function () {
    el("obStage").innerHTML = '<h1 id="obQ">The desk is a moment away.</h1>' +
      '<p class="ob__sub">Reload the page, or email <a href="mailto:matthew@mccluster.org" style="color:#e5383b">matthew@mccluster.org</a> and it counts the same.</p>';
  });
})();
