/* ============================================================
   CHAT FIRST — but only once the chat can actually answer.

   The page ships with the cards. This promotes the conversation ahead
   of them, and it does that only after the live function says it can
   hold one: it has the answering path AND a knowledge base AND a model
   key. Any of those missing and the cards stay where they are.

   WHY A CHECK AND NOT A SETTING. A flag would have to be flipped by
   hand at exactly the moment the deploy landed, which means it is wrong
   twice: before somebody remembers, and after somebody forgets. The
   function is asked instead, and an older deployment answers "unknown
   action" because it does not have the route — a complete, unambiguous
   no with nothing to keep in sync.

   WHY IT DOES NOT FLASH. The verdict is cached in localStorage and read
   before the first paint, so a returning visitor gets the right layout
   immediately. Only a first-ever visit can see the swap, and it happens
   on an empty knowledge-base-less deployment anyway, where the answer is
   "stay as you are" and nothing moves at all.
   ============================================================ */
(function () {
  "use strict";

  var STORE = "mcc-chatfirst-v1";
  var FRESH_MS = 60 * 60 * 1000;   // re-ask hourly, so a deploy lands within the hour
  var TIMEOUT_MS = 4000;

  var talk = document.getElementById("talk");
  var buys = document.getElementById("offerBuy");
  if (!talk || !buys) return;

  /* MOST PEOPLE WILL NOT TYPE.
     That is the whole reason this page exists, and it is why the chips
     are not a one-time set of suggestions that vanish after the first
     tap. They refill after every exchange, so a visitor can hold an
     entire conversation — question, follow-up, close — without touching
     the keyboard once. Typing stays available underneath for the people
     who want it.

     OPENERS are the questions a buyer arrives with, in their own words.
     NEXT is what somebody asks second, plus the two ways out: the
     prices, and a person. Neither list is a menu of products; the cards
     are the menu of products and they are one tap away. */
  var OPENERS = [
    "How much for a website?",
    "Is my name available?",
    "What do I get for that?",
    "Can you run my socials too?"
  ];
  var NEXT = [
    "Is that cheaper than other places?",
    "How long does it take?",
    "What's Equity Uprise?",
    "Show me the prices",
    "Get Matthew"
  ];

  /* Two chips do something on this page rather than asking a question.
     They are still chips, because a visitor should not have to know
     which of their taps is a question and which is a control. */
  var DOES = {
    "Show me the prices": function () { setBrowsing(true); },
    "Get Matthew": null    // falls through and is sent, so the desk sees it
  };

  function readCache() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE));
      if (v && typeof v.answers === "boolean" && Date.now() - v.at < FRESH_MS) return v;
      return v && typeof v.answers === "boolean" ? Object.assign(v, { stale: true }) : null;
    } catch (e) { return null; }
  }
  function writeCache(answers) {
    try { localStorage.setItem(STORE, JSON.stringify({ answers: answers, at: Date.now() })); } catch (e) {}
  }

  /* ---------- the two layouts ---------- */

  var browsing = false;

  function esc(x) {
    return String(x).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function paintChips(list) {
    var row = document.getElementById("talkChips");
    if (!row) return;
    row.hidden = false;
    row.innerHTML = list.map(function (q) {
      return '<button type="button" class="talk__chip' +
        (DOES.hasOwnProperty(q) && DOES[q] ? " talk__chip--does" : "") +
        '">' + esc(q) + "</button>";
    }).join("");
  }

  function showChips() {
    var row = document.getElementById("talkChips");
    if (!row || row.dataset.built) return;
    row.dataset.built = "1";
    paintChips(OPENERS);

    row.addEventListener("click", function (e) {
      var b = e.target.closest(".talk__chip");
      if (!b) return;
      var q = b.textContent;

      if (DOES.hasOwnProperty(q) && DOES[q]) { DOES[q](); paintChips(NEXT); return; }

      /* Put the question in the box and send it, rather than posting it
         on the visitor's behalf from somewhere they cannot see. What
         goes up as their message is what is in the field. */
      var input = talk.querySelector(".dsk__in");
      var form = talk.querySelector(".dsk__bar");
      if (!input || !form) return;
      input.value = q;
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      /* REFILL, DO NOT VANISH. A rail that empties after one tap sends
         everybody who will not type straight to the keyboard, which is
         the exact person this page was built for. */
      paintChips(NEXT);
      if (window.MCC_TRACK) window.MCC_TRACK("chat_chip", { q: q });
    });

    /* Somebody who DOES type gets the follow-ups too, so the two ways of
       talking end up in the same place. */
    var form = talk.querySelector(".dsk__bar");
    if (form) form.addEventListener("submit", function () { setTimeout(function () { paintChips(NEXT); }, 0); });
  }

  function setBrowsing(on) {
    browsing = on;
    buys.hidden = !on;
    var browse = document.getElementById("talkBrowse");
    if (browse) browse.textContent = on ? "Hide them ↑" : "Look through all four →";
    if (on) buys.scrollIntoView({ behavior: "smooth", block: "start" });
    if (window.MCC_TRACK) window.MCC_TRACK("chat_browse", { open: on });
  }

  function chatFirst() {
    talk.hidden = false;
    buys.hidden = true;
    document.body.classList.add("is-chatfirst");
    showChips();

    var browse = document.getElementById("talkBrowse");
    if (browse && !browse.dataset.wired) {
      browse.dataset.wired = "1";
      browse.addEventListener("click", function () { setBrowsing(!browsing); });
    }
    if (window.MCC_TRACK) window.MCC_TRACK("sites_layout", { layout: "chat" });
  }

  function cardsFirst() {
    /* The shipped layout. Explicit rather than implicit so that flipping
       BACK — a deploy rolled back, a key removed — actually restores it. */
    talk.hidden = true;
    buys.hidden = false;
    document.body.classList.remove("is-chatfirst");
    if (window.MCC_TRACK) window.MCC_TRACK("sites_layout", { layout: "cards" });
  }

  /* ---------- ask ---------- */

  /* Resolves true, false, or NULL — and null is not false. "The key had
     not loaded yet" and "the deployment cannot answer" are different
     facts, and caching the first as the second pins the wrong layout for
     an hour over a race this file lost by one script tag. */
  function ask() {
    var S = window.MCC_SUPA;
    if (!S || !S.url) return Promise.resolve(null);

    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);

    return fetch(S.url + "/functions/v1/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: S.key },
      body: JSON.stringify({ action: "health", org: window.MCC_ORG || "mccluster" }),
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        /* every condition, not just the route existing: a deployment with
           the brain but no key, or no documents, answers nothing useful */
        return !!(j && j.ok && j.brain && j.ai && j.documents > 0 && j.answers);
      })
      /* a request that failed IS an answer: whatever is out there did not
         answer a question, which is the thing being asked about */
      .catch(function () { return false; })
      .then(function (v) { clearTimeout(timer); return v; });
  }

  /* ---------- run ---------- */

  var cached = readCache();
  if (cached) (cached.answers ? chatFirst : cardsFirst)();
  else cardsFirst();

  /* Re-ask when the cache is missing or old. The paint above already
     happened, so this only ever corrects a layout rather than choosing
     one from nothing — which is why a slow function costs a visitor
     nothing. */
  if (!cached || cached.stale) {
    /* MCC_SUPA comes from js/backend.js, which this file is loaded after
       for exactly that reason. The deferral is belt and braces: on a page
       that loads them the other way round, ask() returns null and this
       records nothing rather than recording a loss. */
    setTimeout(function () {
      ask().then(function (answers) {
        if (answers === null) return;                       // never asked; do not record it
        writeCache(answers);
        if (cached && cached.answers === answers) return;   // nothing to correct
        (answers ? chatFirst : cardsFirst)();
      });
    }, 0);
  }
})();
