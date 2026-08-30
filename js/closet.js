/* ============================================================
   THE DROP ROOM: one engine, every garment.
   A closet/<slug>.html shell names its drop (body[data-drop]) and
   this module dresses the whole room from data/prayer-closet.json:
   the look, the message, the chapter, the briefing, the closet,
   the claim. Fashion first. The garment is the front door; the
   Word is what you find when you step past it. The scripture is
   the World English Bible (public domain), served from this repo,
   free to every visitor: no purchase ever opens or closes it.
   Flip a drop's status in the JSON and this room repaints on the
   next load, no deploy per drop.
   COMMERCE: when the ledger carries a checkout link for a drop the
   Acquire room flips from first-claim capture to a live preorder.
   Two carriers, and the ledger picks by which key it fills in:

     preorder.shopify  a product or cart URL on the Shopify store
                       that TapStitch fulfils from. Sizes and
                       variants are chosen AT checkout, and the
                       garment is made and shipped automatically.
     preorder.square   a Square payment link. Sizes come back by
                       email afterwards and the house places the
                       production order by hand.

   Shopify wins when both are set, so the store can be switched on
   for a drop without deleting the Square link that was carrying
   it. Neither one is ever priced here: the checkout owns the
   price and this page only names the deposit the ledger records.
   The season's giving door stays on Square (season.give.square) --
   that is the nonprofit's register, not the store's.
   ============================================================ */
(function () {
  "use strict";

  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/closet\.js.*$/, "") : "../";
  })();
  var SLUG = document.body && document.body.getAttribute("data-drop");
  if (!SLUG) return;

  var esc = function (x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; };
  var track = function (n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p || {}); };
  var CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var STATUS = { concept: "Concept", preview: "Preview", "coming-soon": "Coming soon",
    live: "Live now", "sold-out": "Sold out", archived: "Archive" };
  var AREAS = { front: "Front chest", back: "Full back", hood: "Hood",
    "left-sleeve": "Left sleeve", "right-sleeve": "Right sleeve",
    "left-leg": "Jogger · left leg", "right-leg": "Jogger · right leg",
    "pocket": "Front hip · pocket", "inside-label": "Inside label" };

  /* Matthew 6:6, the room the brand is named for. WEB, public domain. */
  var CLOSET_VERSE = "But you, when you pray, enter into your inner room, and having shut your door, pray to your Father who is in secret; and your Father who sees in secret will reward you openly.";

  /* ---------- the room's own cloth ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".pcd__main{max-width:52rem;margin:0 auto;padding:clamp(1.6rem,5vh,3rem) clamp(1rem,4vw,2rem) 9rem}" +
    /* the reveal */
    ".rv{opacity:0;transform:translateY(1.1rem)}" +
    ".rv.on{opacity:1;transform:none;transition:opacity 0.8s ease,transform 0.8s cubic-bezier(0.2,0.7,0.2,1)}" +
    "@media (prefers-reduced-motion: reduce){.rv{opacity:1;transform:none}}" +
    /* hero: the garment wears the door */
    ".dph{position:relative;border-radius:26px;overflow:hidden;isolation:isolate;min-height:clamp(24rem,66vh,36rem);" +
      "display:grid;align-content:end;padding:clamp(1.4rem,4vw,2.6rem);" +
      "box-shadow:0 46px 100px -42px rgba(0,0,0,0.95),inset 0 0 0 1px var(--edge)}" +
    ".dph::before{content:\"\";position:absolute;inset:-40% -60%;z-index:-1;pointer-events:none;" +
      "background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,0.13) 50%,transparent 58%);" +
      "animation:dphSheen 9s ease-in-out infinite}" +
    "@keyframes dphSheen{0%,55%,100%{transform:translateX(-38%)}78%{transform:translateX(38%)}}" +
    "@media (prefers-reduced-motion: reduce){.dph::before{animation:none}}" +
    ".dph__wm{position:absolute;right:-0.06em;top:-0.14em;z-index:-2;font-family:var(--serif);font-style:italic;" +
      "font-weight:700;font-size:clamp(8rem,30vw,20rem);line-height:1;opacity:0.13;user-select:none;pointer-events:none}" +
    ".dph__hang{position:absolute;left:50%;top:9%;transform:translateX(-50%);z-index:-1;opacity:0.45}" +
    /* the real garment wears the door; the gradient stays underneath as the fallback */
    ".dph__field{position:absolute;inset:0;z-index:-3}" +
    ".dph__field img{width:100%;height:100%;object-fit:cover;object-position:center 10%;display:block}" +
    ".dph.has-photo .dph__wm{opacity:0.05}" +
    ".dph.has-photo::before{opacity:0.4}" +
    /* the copy needs a bed: bare, the headline lands on the garment's own
       chest print and the two read as one smeared word */
    ".dph.has-photo{min-height:clamp(28rem,68vh,38rem)}" +
    ".dph.has-photo::after{content:\"\";position:absolute;inset:0;z-index:-1;pointer-events:none;" +
      "background:linear-gradient(180deg,rgba(8,6,5,0.14) 0%,rgba(8,6,5,0.02) 18%," +
      "rgba(8,6,5,0.45) 36%,rgba(8,6,5,0.84) 55%,rgba(8,6,5,0.95) 73%,rgba(8,6,5,0.98) 100%)}" +
    /* THE LOOK GALLERY: front, back, and the details, on the house rail grammar */
    ".look{display:grid;grid-auto-flow:column;grid-auto-columns:clamp(13rem,60vw,19rem);gap:0.8rem;" +
      "overflow-x:auto;padding:0.2rem 0.2rem 1rem;scroll-snap-type:x mandatory;scrollbar-width:none;" +
      "margin-bottom:1.2rem}" +
    ".look::-webkit-scrollbar{display:none}" +
    ".look figure{margin:0;scroll-snap-align:start;border-radius:18px;overflow:hidden;position:relative;" +
      "box-shadow:inset 0 0 0 1px var(--edge),0 26px 60px -30px rgba(0,0,0,0.95);background:rgba(0,0,0,0.25)}" +
    ".look img{display:block;width:100%;height:auto;aspect-ratio:1/1.06;object-fit:cover}" +
    ".look figure.is-detail img{aspect-ratio:1/1.25}" +
    ".look figcaption{position:absolute;left:0;right:0;bottom:0;padding:1.6rem 0.9rem 0.7rem;" +
      "font-weight:700;font-size:0.66rem;letter-spacing:0.04em;color:var(--cream);" +
      "background:linear-gradient(180deg,transparent,rgba(6,5,4,0.9))}" +
    /* the placement's own artwork, nested INSIDE the phrase cell. The row stays
       two-track. These are transparent line-art marks, so they CONTAIN (cover
       would crop the mark) on a faint panel that lets the ink read */
    ".tpk__art{display:block;width:3.4rem;height:3.4rem;object-fit:contain;border-radius:9px;margin-top:0.5rem;" +
      "padding:0.28rem;max-width:100%;background:rgba(0,0,0,0.28);box-shadow:inset 0 0 0 1px var(--edge)}" +
    ".dph__em{position:absolute;left:clamp(1.4rem,4vw,2.6rem);top:clamp(1.3rem,4vw,2.4rem);" +
      "display:flex;align-items:center;gap:0.65rem}" +
    ".dph__em img{width:clamp(2.4rem,6.5vw,3.2rem);height:auto;display:block;filter:drop-shadow(0 6px 18px rgba(0,0,0,0.5))}" +
    ".dph__em b{font-weight:800;font-size:0.58rem;letter-spacing:0.32em;text-transform:uppercase;opacity:0.85}" +
    ".dph__share{position:absolute;right:clamp(1.2rem,4vw,2.4rem);top:clamp(1.2rem,4vw,2.3rem);" +
      "-webkit-appearance:none;appearance:none;border:0;cursor:pointer;display:flex;align-items:center;gap:0.5rem;" +
      "font-family:var(--ui);font-weight:800;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;" +
      "color:inherit;background:rgba(0,0,0,0.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "border-radius:100px;padding:0.55rem 1rem;box-shadow:inset 0 0 0 1px currentColor}" +
    ".dph__share svg{width:0.9rem;height:0.9rem;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}" +
    ".dph__k{font-weight:800;font-size:0.64rem;letter-spacing:0.32em;text-transform:uppercase;opacity:0.8}" +
    ".dph h1{font-family:var(--sig);text-transform:uppercase;line-height:0.88;font-size:clamp(3rem,13vw,6.6rem);margin:0.25rem 0 0.4rem}" +
    ".dph__sub{font-family:var(--serif);font-style:italic;font-weight:700;font-size:clamp(1rem,3vw,1.45rem);opacity:0.92}" +
    ".dph__meta{display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:1rem}" +
    ".dph__meta span{font-weight:800;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;border-radius:100px;" +
      "padding:0.42rem 0.85rem;box-shadow:inset 0 0 0 1px currentColor;opacity:0.85;" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}" +
    /* the compass: six stages, one thin rail that knows where you are */
    ".cmp{position:sticky;top:3.3rem;z-index:120;margin:1.1rem -0.2rem 0;display:flex;gap:0.3rem;overflow-x:auto;" +
      "scrollbar-width:none;padding:0.45rem;border-radius:100px;" +
      "background:linear-gradient(180deg,rgba(24,19,16,0.88),rgba(14,11,9,0.9));" +
      "backdrop-filter:blur(16px) saturate(1.2);-webkit-backdrop-filter:blur(16px) saturate(1.2);" +
      "box-shadow:inset 0 0 0 1px var(--edge),0 18px 40px -22px rgba(0,0,0,0.9)}" +
    ".cmp::-webkit-scrollbar{display:none}" +
    ".cmp a{flex:none;text-decoration:none;font-weight:800;font-size:0.58rem;letter-spacing:0.14em;" +
      "text-transform:uppercase;color:var(--cream-dim);border-radius:100px;padding:0.5rem 0.85rem;" +
      "transition:color 0.3s,background 0.3s}" +
    ".cmp a.on{color:#fff;background:var(--metal);box-shadow:inset 0 1px 0 rgba(255,255,255,0.45)}" +
    /* section furniture */
    ".dsc{margin-top:clamp(2.6rem,8vh,4.2rem)}" +
    ".dsc__k{font-weight:800;font-size:0.66rem;letter-spacing:0.3em;text-transform:uppercase;color:var(--ruby-hot);margin:0 0 0.35rem}" +
    ".dsc__t{font-family:var(--serif);font-style:italic;font-weight:700;font-size:clamp(1.4rem,4.4vw,2.1rem);margin:0 0 1.1rem}" +
    ".dsc p{font-weight:600;font-size:0.92rem;line-height:1.75;color:var(--cream-dim);max-width:58ch}" +
    /* the look: tech-pack table */
    ".tpk{border-radius:20px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--edge);" +
      "background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo))}" +
    ".tpk__row{display:grid;grid-template-columns:minmax(7.5rem,0.65fr) 1fr;gap:0.8rem;align-items:baseline;" +
      "padding:0.85rem 1.1rem;box-shadow:inset 0 -1px 0 var(--edge);transition:background 0.3s ease}" +
    "@media (hover:hover){.tpk__row:hover{background:rgba(255,255,255,0.045)}}" +
    ".tpk__row:last-child{box-shadow:none}" +
    ".tpk__a{font-weight:800;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--cream-dim)}" +
    ".tpk__p{font-family:var(--serif);font-style:italic;font-weight:700;font-size:0.98rem}" +
    ".tpk__n{display:block;font-weight:600;font-size:0.68rem;color:var(--cream-dim);margin-top:0.15rem;font-family:var(--ui);font-style:normal}" +
    /* the cloth: the spec block under the tech pack */
    ".tpk--spec{margin-top:0.8rem}" +
    ".tpk__hd{font-weight:800;font-size:0.6rem;letter-spacing:0.24em;text-transform:uppercase;" +
      "color:var(--ruby-hot);padding:0.85rem 1.1rem 0.4rem}" +
    ".szt{width:100%;border-collapse:collapse;margin-top:0.8rem;font-family:var(--ui);font-size:0.84rem}" +
    ".szt caption{text-align:left;font-weight:800;font-size:0.6rem;letter-spacing:0.18em;" +
      "text-transform:uppercase;color:var(--cream-dim);padding-bottom:0.5rem}" +
    ".szt th,.szt td{text-align:left;padding:0.5rem 0.7rem;box-shadow:inset 0 -1px 0 var(--edge)}" +
    ".szt thead th{font-weight:800;font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--cream-dim)}" +
    ".szt tbody th{font-weight:800}" +
    ".szt td{font-variant-numeric:tabular-nums}" +
    ".szt__note{margin-top:0.8rem;font-size:0.82rem;line-height:1.6;color:var(--cream-dim)}" +
    ".swatch{display:inline-block;width:0.85rem;height:0.85rem;border-radius:100px;vertical-align:-0.12em;" +
      "margin-right:0.45rem;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35)}" +
    ".tiers{display:grid;gap:0.8rem;margin-top:1rem}" +
    ".tiers article{border-radius:18px;padding:1rem 1.15rem;box-shadow:inset 0 0 0 1px var(--edge);" +
      "transition:transform 0.4s cubic-bezier(0.2,0.7,0.2,1)}" +
    "@media (hover:hover){.tiers article:hover{transform:translateY(-2px)}}" +
    ".tiers b{display:block;font-weight:800;font-size:0.8rem;letter-spacing:0.08em;text-transform:uppercase}" +
    ".tiers small{display:block;font-weight:600;font-size:0.78rem;line-height:1.6;color:var(--cream-dim);margin-top:0.3rem}" +
    /* the chapter: the Word behind the garment */
    ".word{border-radius:24px;padding:clamp(1.6rem,5vw,2.8rem);text-align:center;" +
      "background:linear-gradient(180deg,rgba(255,255,255,0.05),transparent);box-shadow:inset 0 0 0 1px var(--edge)}" +
    ".word__q{font-family:var(--serif);font-style:italic;font-weight:700;font-size:clamp(1.25rem,4vw,1.85rem);" +
      "line-height:1.45;max-width:34ch;margin:0 auto}" +
    ".word__q .w{opacity:0;transition:opacity 0.5s ease}" +
    ".word__q .w.lit{opacity:1}" +
    "@media (prefers-reduced-motion: reduce){.word__q .w{opacity:1;transition:none}}" +
    ".word__r{font-weight:800;font-size:0.66rem;letter-spacing:0.26em;text-transform:uppercase;color:var(--ruby-hot);" +
      "display:block;margin-top:1.1rem}" +
    ".word__t{font-weight:600;font-size:0.68rem;color:var(--cream-dim);margin-top:0.5rem}" +
    ".word__go{display:inline-block;margin-top:1.3rem;text-decoration:none;font-weight:800;font-size:0.72rem;" +
      "letter-spacing:0.2em;text-transform:uppercase;color:var(--cream);border-bottom:1px solid var(--ruby-hot);padding-bottom:0.3rem}" +
    /* the briefing */
    ".brf{display:grid;gap:0.8rem}" +
    ".brf article{border-radius:18px;padding:1.05rem 1.2rem;background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));" +
      "box-shadow:inset 0 0 0 1px var(--edge);transition:transform 0.4s cubic-bezier(0.2,0.7,0.2,1),box-shadow 0.4s ease}" +
    "@media (hover:hover){.brf article:hover{transform:translateY(-2px);box-shadow:inset 0 0 0 1px var(--edge),0 18px 40px -22px rgba(0,0,0,0.9)}}" +
    ".brf b{display:block;font-weight:800;font-size:0.86rem}" +
    ".brf small{display:block;font-weight:600;font-size:0.8rem;line-height:1.65;color:var(--cream-dim);margin-top:0.35rem}" +
    ".brf a{display:inline-block;margin-top:0.5rem;text-decoration:none;font-weight:800;font-size:0.6rem;" +
      "letter-spacing:0.18em;text-transform:uppercase;color:var(--ruby-hot)}" +
    ".brf__qs{margin:1.2rem 0 0;padding:0;list-style:none;display:grid;gap:0.6rem}" +
    ".brf__qs li{font-family:var(--serif);font-style:italic;font-weight:700;font-size:0.98rem;line-height:1.5;" +
      "padding-left:1.1rem;position:relative}" +
    ".brf__qs li::before{content:\"·\";position:absolute;left:0;color:var(--ruby-hot)}" +
    /* the closet: the private page */
    ".clo{border-radius:24px;padding:clamp(1.6rem,5vw,2.6rem);box-shadow:inset 0 0 0 1px var(--edge);" +
      "background:linear-gradient(180deg,rgba(255,255,255,0.04),transparent)}" +
    ".clo__v{font-family:var(--serif);font-style:italic;font-weight:700;font-size:0.98rem;line-height:1.6;" +
      "color:var(--cream-dim);max-width:52ch}" +
    ".clo__pr{font-family:var(--serif);font-style:italic;font-weight:700;font-size:1.1rem;line-height:1.6;margin-top:1.1rem}" +
    ".clo textarea{width:100%;margin-top:1.2rem;min-height:7.5rem;border-radius:14px;border:0;resize:vertical;" +
      "background:rgba(0,0,0,0.35);box-shadow:inset 0 0 0 1px var(--edge);color:var(--cream);" +
      "font-family:var(--ui);font-weight:600;font-size:0.92rem;line-height:1.7;padding:1rem 1.1rem;" +
      "transition:box-shadow 0.3s ease}" +
    ".clo textarea:focus{outline:none;box-shadow:inset 0 0 0 1px var(--ruby-hot)}" +
    ".clo__hint{display:flex;justify-content:space-between;gap:1rem;margin-top:0.5rem;font-weight:600;" +
      "font-size:0.66rem;color:var(--cream-dim)}" +
    /* the claim / preorder */
    ".clm{border-radius:26px;padding:clamp(1.6rem,5vw,2.6rem);text-align:center;box-shadow:inset 0 0 0 1px var(--edge);" +
      "position:relative;overflow:hidden;isolation:isolate}" +
    ".clm__t{font-family:var(--sig);text-transform:uppercase;line-height:0.92;font-size:clamp(1.8rem,7vw,3rem)}" +
    ".clm p{margin:0.8rem auto 0;max-width:46ch}" +
    ".clm__dep{display:block;margin-top:1.2rem;font-family:var(--serif);font-style:italic;font-weight:700;" +
      "font-size:clamp(1.6rem,6vw,2.4rem)}" +
    ".clm__dep small{display:block;font-family:var(--ui);font-style:normal;font-weight:800;font-size:0.6rem;" +
      "letter-spacing:0.22em;text-transform:uppercase;opacity:0.75;margin-top:0.3rem}" +
    ".sizes{display:flex;gap:0.45rem;flex-wrap:wrap;justify-content:center;margin-top:1.2rem}" +
    ".sizes button{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;font-family:var(--ui);" +
      "font-weight:800;font-size:0.72rem;letter-spacing:0.08em;color:inherit;background:transparent;" +
      "border-radius:100px;min-width:2.7rem;padding:0.6rem 0.8rem;box-shadow:inset 0 0 0 1px currentColor;" +
      "opacity:0.7;transition:opacity 0.25s,transform 0.25s}" +
    ".sizes button.on{opacity:1;transform:scale(1.06);box-shadow:inset 0 0 0 2px currentColor}" +
    ".clm form{display:grid;gap:0.6rem;max-width:24rem;margin:1.4rem auto 0}" +
    ".clm input{border-radius:100px;border:0;background:rgba(0,0,0,0.35);box-shadow:inset 0 0 0 1px var(--edge);" +
      "color:var(--cream);font-family:var(--ui);font-weight:600;font-size:0.9rem;padding:0.85rem 1.2rem}" +
    ".clm input:focus{outline:none;box-shadow:inset 0 0 0 1px var(--ruby-hot)}" +
    ".clm button[type=submit],.clm .clm__go{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;text-decoration:none;" +
      "display:inline-block;font-family:var(--ui);font-weight:800;font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:#fff;" +
      "background:var(--metal);border-radius:100px;padding:0.95rem 1.6rem;" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),0 14px 34px -14px rgba(229,56,59,0.55);" +
      "transition:transform 0.3s cubic-bezier(0.2,0.7,0.2,1)}" +
    "@media (hover:hover){.clm button[type=submit]:hover,.clm .clm__go:hover{transform:translateY(-2px)}}" +
    ".clm__alt{display:block;margin-top:1rem;font-weight:700;font-size:0.7rem;color:inherit;opacity:0.8}" +
    ".clm__ok,.clm__err{font-weight:700;font-size:0.82rem;margin-top:0.9rem}" +
    ".clm__ok{color:inherit}.clm__err{color:var(--ruby-hot)}" +
    ".clm__ed{display:block;margin-top:1.1rem;font-weight:600;font-size:0.66rem;letter-spacing:0.08em;opacity:0.75}" +
    ".clm__terms{margin:1.4rem auto 0;padding:1rem 1.2rem;max-width:30rem;text-align:left;list-style:none;" +
      "border-radius:16px;background:rgba(0,0,0,0.22);box-shadow:inset 0 0 0 1px currentColor;display:grid;gap:0.45rem}" +
    ".clm__terms li{font-weight:600;font-size:0.74rem;line-height:1.55;opacity:0.92;padding-left:1rem;position:relative}" +
    ".clm__terms li::before{content:\"·\";position:absolute;left:0;opacity:0.7}" +
    ".clm__terms b{font-weight:800}" +
    ".clm__sow{display:block;margin-top:1.4rem;font-weight:700;font-size:0.72rem;color:inherit;opacity:0.85}" +
    ".clm__sow a{color:inherit;font-weight:800}" +
    /* the walk-on: prev / next drops */
    ".dnx{display:grid;grid-template-columns:1fr 1fr;gap:0.8rem}" +
    "@media (max-width:34rem){.dnx{grid-template-columns:1fr}}" +
    ".dnx a{border-radius:18px;padding:1.1rem 1.2rem;text-decoration:none;display:grid;gap:0.25rem;" +
      "position:relative;overflow:hidden;isolation:isolate;" +
      "box-shadow:inset 0 0 0 1px var(--edge);transition:transform 0.4s cubic-bezier(0.2,0.7,0.2,1)}" +
    ".dnx a .dnxf{position:absolute;inset:0;z-index:-1}" +
    ".dnx a .dnxf img{width:100%;height:100%;object-fit:cover;opacity:0.5}" +
    ".dnx a .dnxf::after{content:\"\";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,5,4,0.35),rgba(6,5,4,0.8))}" +
    "@media (hover:hover){.dnx a:hover{transform:translateY(-3px)}}" +
    ".dnx i{font-style:normal;font-weight:800;font-size:0.58rem;letter-spacing:0.22em;text-transform:uppercase;opacity:0.75}" +
    ".dnx b{font-family:var(--sig);text-transform:uppercase;font-size:1.15rem}" +
    ".dnx--home{display:block;text-align:center;margin-top:0.8rem;text-decoration:none;font-weight:800;" +
      "font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--cream-dim)}";
  document.head.appendChild(css);

  /* ---------- paint ---------- */
  function field(c) {
    return "background:radial-gradient(120% 90% at 50% 18%, " + c.hex + " 0%, color-mix(in srgb, " + c.hex + " 72%, #000) 58%, " +
      "color-mix(in srgb, " + c.hex + " 38%, #000) 100%);color:" + c.ink;
  }
  /* the picture, when the ledger has one, layered over the color field, so a
     missing file falls back to the gradient with no onerror handler */
  function photo(src, alt, cls) {
    return src ? '<img' + (cls ? ' class="' + cls + '"' : "") + ' src="' + esc(ROOT + src) +
      '" alt="' + esc(alt || "") + '" loading="lazy" decoding="async">' : "";
  }
  function shotsOf(d, role) {
    return (d.media || []).filter(function (m) { return m.role === role; });
  }
  function hanger(ink, w) {
    w = w || 130;
    var h = Math.round(w * 0.7);
    return '<svg class="dph__hang" width="' + w + '" height="' + h + '" viewBox="0 0 86 60" fill="none" aria-hidden="true">' +
      '<path d="M43 8a6 6 0 1 1 6-6" stroke="' + ink + '" stroke-width="2"/>' +
      '<path d="M43 8 82 34a4 4 0 0 1-2.4 7.2H6.4A4 4 0 0 1 4 34z" stroke="' + ink + '" stroke-width="2"/></svg>';
  }
  function verseSpan(ref) {
    /* "Matthew 6:33" / "Matthew 5:14 to 16" maps to [start, end] */
    var m = /:(\d+)(?:\s*[–—-]\s*(\d+))?/.exec(ref || "");
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2] || m[1], 10)];
  }
  function money(n) {
    return "$" + (Math.round(n * 100) / 100).toLocaleString("en-US");
  }

  /* WHICH CHECKOUT IS CARRYING THIS DROP.

     One question, asked in one place, so the button, the deposit chip, the
     terms and the analytics can never disagree about where the money goes.
     Returns null when the ledger names no checkout at all, which is what
     puts the room back on first-claim capture.

     Shopify outranks Square deliberately. Switching a drop over to the
     store is then a matter of pasting one link, not of remembering to
     clear the other one first -- and a half-finished switch fails towards
     the store that can actually take a size, rather than towards a payment
     link that cannot. */
  function checkoutOf(pre) {
    if (!pre) return null;
    if (pre.shopify) return { id: "shopify", via: "the store", href: pre.shopify };
    if (pre.square) return { id: "square", via: "Square", href: pre.square };
    return null;
  }

  fetch(ROOT + "data/prayer-closet.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
    var drops = j.drops || [];
    var idx = -1;
    drops.forEach(function (d, i) { if (d.slug === SLUG) idx = i; });
    if (idx < 0) return;
    var d = drops[idx];
    var colab = (j.collaborators || []).filter(function (c) { return c.id === d.collaborator; })[0] || {};
    var emblem = ROOT + (j.season && j.season.emblem ? j.season.emblem : "assets/img/hm-mark.png");
    var give = j.season && j.season.give;

    /* ----- hero: dress the door in the drop's color ----- */
    var hero = document.getElementById("dphHero");
    if (hero) {
      hero.style.cssText += field(d.color);
      var heroShot = d.cover || (shotsOf(d, "front")[0] || {}).src || "";
      if (heroShot) hero.classList.add("has-photo");
      hero.insertAdjacentHTML("afterbegin",
        '<span class="dph__wm" aria-hidden="true">M' + d.chapter + "</span>" +
        (heroShot ? '<span class="dph__field" aria-hidden="true">' + photo(heroShot, d.title + " · " + d.garment) + "</span>"
                  : hanger(d.color.ink)) +
        '<span class="dph__em"><img src="' + esc(emblem) + '" alt=""><b>Prayer&nbsp;Closet</b></span>' +
        '<button class="dph__share" type="button" id="dphShare">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.6"/><circle cx="17.5" cy="5.5" r="2.6"/><circle cx="17.5" cy="18.5" r="2.6"/><path d="M8.3 10.7l6.9-4M8.3 13.3l6.9 4"/></svg>' +
        "<span>Share</span></button>");
      var k = document.getElementById("dphK");
      if (k) k.textContent = "Prayer Closet · " + (d.tag || "Drop " + d.no) + " · " + (STATUS[d.status] || d.status);
      var meta = document.getElementById("dphMeta");
      if (meta) meta.innerHTML = [d.garment, d.color.name, d.reference,
        colab.name ? "with " + colab.name : null].filter(Boolean).map(function (m) {
          return "<span>" + esc(m) + "</span>"; }).join("");
    }

    /* THE CLOTH: the spec a buyer at $333 is entitled to before they order.
       One block for the season (season.specs), overridable per drop. The
       measurement table only renders when the ledger actually holds numbers:
       until a production sample has been measured, the room says sizing is
       settled by email rather than printing a chart nobody checked. */
    function specHtml(drop) {
      var s = drop.specs || (j.season && j.season.specs);
      if (!s) return "";
      var rows = [
        ["Weight", s.weight], ["Fabric", s.fabric],
        ["Composition", s.composition], ["Fit", s.fit],
      ].filter(function (r) { return r[1]; }).map(function (r) {
        return '<div class="tpk__row"><span class="tpk__a">' + esc(r[0]) + "</span>" +
          '<span class="tpk__p">' + esc(r[1]) + "</span></div>";
      }).join("");

      var m = s.measure || {};
      var chart = "";
      if (m.rows && m.rows.length) {
        var cols = Object.keys(m.rows[0]).filter(function (k) { return k !== "size"; });
        chart = '<table class="szt"><caption>Garment measurements, ' + esc(m.unit || "in") + "</caption>" +
          "<thead><tr><th>Size</th>" + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" + m.rows.map(function (r) {
            return "<tr><th>" + esc(r.size) + "</th>" +
              cols.map(function (c) { return "<td>" + esc(String(r[c])) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>";
      } else if (m.note) {
        chart = '<p class="szt__note">' + esc(m.note) + "</p>";
      }
      return '<div class="tpk tpk--spec"><div class="tpk__hd">The cloth</div>' + rows + "</div>" + chart;
    }

    /* ----- the body, staged: look → message → chapter → briefing → closet → acquire ----- */
    var b = d.briefing || {};
    var edFmt = (j.editionFormat || "").split(",")[0].replace("{chapter}", d.chapter).replace("{drop}", d.no).replace("{serial}", "····");
    var innerHref = ROOT + "inner-room.html#mt" + d.chapter;
    var briefName = "The " + ((colab.name || "").split(" ")[0] || "Mission") + " Briefing";

    var tiers = (j.tiers || []).filter(function (t) { return (d.fulfillment || []).indexOf(t.id) !== -1; });
    var gallery = (d.media || []).length
      ? '<div class="look">' + (d.media || []).map(function (m) {
          return '<figure class="' + (m.role === "detail" ? "is-detail" : "is-" + m.role) + '">' +
            photo(m.src, (m.note || d.title)) +
            (m.note ? "<figcaption>" + esc(m.note) + "</figcaption>" : "") + "</figure>";
        }).join("") + "</div>"
      : "";
    var lookHtml =
      '<section class="dsc rv" id="look">' +
      '<p class="dsc__k">The Look</p><h2 class="dsc__t">Built like a tech pack, worn like a testimony.</h2>' +
      gallery +
      '<div class="tpk">' +
      '<div class="tpk__row"><span class="tpk__a">Garment</span><span class="tpk__p">' + esc(d.garment) + "</span></div>" +
      '<div class="tpk__row"><span class="tpk__a">Colorway</span><span class="tpk__p"><span class="swatch" style="background:' + esc(d.color.hex) + '"></span>' +
        esc(d.color.name) + (d.color.note ? '<span class="tpk__n">' + esc(d.color.note) + "</span>" : "") + "</span></div>" +
      (d.placements || []).map(function (p) {
        return '<div class="tpk__row"><span class="tpk__a">' + esc(AREAS[p.area] || p.area) + "</span>" +
          '<span class="tpk__p">&ldquo;' + esc(p.phrase) + "&rdquo;" +
          (p.productionNotes ? '<span class="tpk__n">' + esc(p.productionNotes) + "</span>" : "") +
          photo(p.art, esc(p.phrase) + " · " + (AREAS[p.area] || p.area), "tpk__art") + "</span></div>";
      }).join("") +
      "</div>" +
      specHtml(d) +
      '<div class="tiers">' + tiers.map(function (t) {
        return "<article><b>" + esc(t.name) + (t.localModCost ? " · +$" + t.localModCost : "") + "</b><small>" + esc(t.what) + "</small></article>";
      }).join("") + "</div></section>";

    var msgHtml =
      '<section class="dsc rv" id="message">' +
      '<p class="dsc__k">The Message</p><h2 class="dsc__t">' + esc(d.support) + ".</h2>" +
      "<p>" + esc(d.why) + "</p>" +
      '<div class="dph__meta" style="margin-top:1rem">' + (d.theme || []).map(function (t) {
        return "<span>" + esc(t) + "</span>"; }).join("") + "</div></section>";

    var briefHtml = b.mission ?
      '<section class="dsc rv" id="briefing">' +
      '<p class="dsc__k">' + esc(briefName) + "</p>" +
      '<h2 class="dsc__t">' + esc(b.mission) + "</h2>" +
      '<div class="brf">' + (b.points || []).map(function (p) {
        return "<article><b>" + esc(p.k) + "</b><small>" + esc(p.p) + "</small>" +
          '<a href="' + ROOT + "inner-room.html#mt" + d.chapter + "v" + p.v + '">' + esc(p.ref) + " &#8594;</a></article>";
      }).join("") + "</div>" +
      '<ul class="brf__qs">' + (b.questions || []).map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul>" +
      "</section>" : "";

    var cloHtml =
      '<section class="dsc rv" id="closet"><div class="clo">' +
      '<p class="dsc__k">The Prayer Closet</p>' +
      '<p class="clo__v">&ldquo;' + esc(CLOSET_VERSE) + '&rdquo; · Matthew 6:6 (WEB)</p>' +
      (b.prayer ? '<p class="clo__pr">' + esc(b.prayer) + "</p>" : "") +
      '<textarea id="cloNote" placeholder="Shut the door. What you write here is yours." maxlength="4000"></textarea>' +
      '<div class="clo__hint"><span>Saved on this device only. Never sent anywhere.</span><span id="cloSt"></span></div>' +
      "</div></section>";

    /* claim / preorder / acquire: status and the ledger decide the honest sentence */
    var live = d.status === "live" && d.offering;
    var soldOut = d.status === "sold-out";
    var pre = d.preorder || {};
    var buy = checkoutOf(pre);
    var preLive = !!buy;
    var sizes = d.sizes || [];
    var sizesHtml = sizes.length ?
      '<div class="sizes" id="clmSizes" role="group" aria-label="Size">' + sizes.map(function (s) {
        return '<button type="button" data-size="' + esc(s) + '">' + esc(s) + "</button>"; }).join("") + "</div>" : "";

    var clmBody;
    if (live) {
      clmBody =
        "<p>" + (d.price ? money(d.price) + " &middot; " : "") + esc(d.garment) + " &middot; sold by McCluster Corp.</p>" +
        '<a class="clm__go" style="margin-top:1.4rem" href="' + ROOT + "pay.html?offer=" + esc(d.offering) + '">Take it home &#8594;</a>';
    } else if (soldOut) {
      clmBody = "<p>This edition is gone. The chapter never sells out. The Inner Room stays open, and the next drop is on the rail.</p>";
    } else if (preLive) {
      /* the honesty layer: a preorder states its terms where the money moves.
         Ledger-driven: set preorder.terms (array of strings) to override. */
      var sizeLine = buy.id === "shopify"
        /* on the store the variant IS the size, so it is picked before the
           money moves; the email step below only ever existed because a
           Square payment link cannot carry one */
        ? "<b>Sizing:</b> pick your size at checkout (" + (sizes[0] || "S") + " to " + (sizes[sizes.length - 1] || "2XL") + ")"
        : "<b>Sizing &amp; customization:</b> chosen by email right after checkout (" +
          (sizes[0] || "S") + " to " + (sizes[sizes.length - 1] || "2XL") + ")";
      var terms = (pre.terms && pre.terms.length) ? pre.terms : [
        "<b>What ships:</b> " + esc(d.garment) + " in " + esc(d.color.name) + ", every placement on the tech pack above",
        "<b>When:</b> about four weeks from order to door. Tracking lands in your email",
        sizeLine,
        "<b>Change of heart:</b> full refund any time before your set ships. One email does it",
        "<b>A person answers:</b> matthew@mccluster.org",
      ];
      clmBody =
        "<p>" + (pre.how ? esc(pre.how)
          : "The set is in production. A preorder holds your edition before the rail opens. Checkout runs through " +
            buy.via + ", and the house ships the moment the garments land.") + "</p>" +
        (pre.deposit ? '<span class="clm__dep">' + money(pre.deposit) + "<small>preorder &middot; through " + buy.via + "</small></span>" : "") +
        '<a class="clm__go" style="margin-top:1.3rem" id="clmBuy" href="' + esc(buy.href) + '" rel="noopener">Preorder through ' + buy.via + ' &#8594;</a>' +
        '<span class="clm__alt">Not ready? <a href="#" id="clmClaimAlt" style="color:inherit">Put your name on the list instead</a>.</span>' +
        '<div id="clmClaimWrap" hidden>' + sizesHtml +
        '<form id="clmForm"><input name="name" placeholder="Your name" autocomplete="name" maxlength="80" required>' +
        '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="120" required>' +
        '<button type="submit">Claim the first call &#8594;</button></form>' +
        '<p class="clm__ok" hidden id="clmOk">On the list. When it ships, you hear first.</p>' +
        '<p class="clm__err" hidden id="clmErr">That didn&rsquo;t go through. Check the email and try again.</p></div>' +
        '<ul class="clm__terms">' + terms.map(function (t) {
          return "<li>" + ((pre.terms && pre.terms.length) ? esc(t) : t) + "</li>";
        }).join("") + "</ul>";
    } else {
      clmBody =
        "<p>No charge today and nothing to check out &mdash; the garment isn&rsquo;t real until it&rsquo;s real. First claim puts your name on the list: when Drop " +
        esc(d.no) + " opens for preorder, you get the first call before it hits the rail.</p>" +
        sizesHtml +
        '<form id="clmForm"><input name="name" placeholder="Your name" autocomplete="name" maxlength="80" required>' +
        '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="120" required>' +
        '<button type="submit">Claim the first call &#8594;</button></form>' +
        '<p class="clm__ok" hidden id="clmOk">On the list. When it drops, you hear first.</p>' +
        '<p class="clm__err" hidden id="clmErr">That didn&rsquo;t go through. Check the email and try again.</p>';
    }
    var clmHtml =
      '<section class="dsc rv" id="acquire"><div class="clm" style="' + field(d.color) + '">' +
      '<p class="dsc__k" style="color:inherit;opacity:0.8">' + esc(d.tag || "Drop " + d.no) + " &middot; " +
        esc(preLive && !live && !soldOut ? "Preorder open" : (STATUS[d.status] || d.status)) + "</p>" +
      '<h2 class="clm__t">' + esc(d.phrase) + "</h2>" + clmBody +
      '<span class="clm__ed">Editions run numbered &mdash; ' + esc(edFmt) + " &middot; registry opens when the drop goes live.</span>" +
      (give && give.square ? '<span class="clm__sow">Or simply sow into the season &mdash; <a href="' + esc(give.square) + '" data-sow rel="noopener">give through Square &#8594;</a></span>' : "") +
      "</div></section>";

    var prev = drops[(idx + drops.length - 1) % drops.length];
    var next = drops[(idx + 1) % drops.length];
    var nxHtml =
      '<section class="dsc rv"><div class="dnx">' +
      '<a href="' + esc(prev.slug) + '.html" style="' + field(prev.color) + '">' +
        (prev.cover ? '<span class="dnxf" aria-hidden="true">' + photo(prev.cover, "") + "</span>" : "") +
        '<i>&#8592; ' + esc(prev.tag || "Drop " + prev.no) + "</i><b>" + esc(prev.title) + "</b></a>" +
      '<a href="' + esc(next.slug) + '.html" style="' + field(next.color) + '">' +
        (next.cover ? '<span class="dnxf" aria-hidden="true">' + photo(next.cover, "") + "</span>" : "") +
        '<i>' + esc(next.tag || "Drop " + next.no) + " &#8594;</i><b>" + esc(next.title) + "</b></a>" +
      '</div><a class="dnx--home" href="' + ROOT + 'prayer-closet.html">Back into the Closet</a></section>';

    var wordShell =
      '<section class="dsc rv" id="chapter"><div class="word">' +
      '<p class="dsc__k">The Chapter</p>' +
      '<blockquote class="word__q" id="wordQ" style="margin:0.8rem 0 0">&hellip;</blockquote>' +
      '<span class="word__r" id="wordR">' + esc(d.reference) + "</span>" +
      '<p class="word__t">World English Bible &middot; public domain &middot; free to read, no purchase required &mdash; ever.</p>' +
      '<a class="word__go" href="' + innerHref + '">Read all of Matthew ' + d.chapter + " in the Inner Room &#8594;</a>" +
      "</div></section>";

    /* the compass: six doors, one thin rail */
    var STAGES = [["look", "Garment"], ["message", "Message"], ["chapter", "Chapter"],
      ["briefing", "Briefing"], ["closet", "Prayer"], ["acquire", "Acquire"]];
    var cmpHtml = '<nav class="cmp" id="cmp" aria-label="Drop stages">' + STAGES.map(function (s) {
      return '<a href="#' + s[0] + '">' + s[1] + "</a>"; }).join("") + "</nav>";

    document.getElementById("dropBody").innerHTML =
      cmpHtml + lookHtml + msgHtml + wordShell + briefHtml + cloHtml + clmHtml + nxHtml;

    /* ----- the Word itself, from the house copy of the WEB ----- */
    fetch(ROOT + "data/scripture/" + d.book + "-" + d.chapter + ".json", { cache: "force-cache" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var span = verseSpan(d.reference);
        if (!span) return;
        var text = (s.verses || []).filter(function (v) { return v.verse >= span[0] && v.verse <= span[1]; })
          .map(function (v) { return v.text.replace(/\s+/g, " ").trim(); }).join(" ");
        if (!text) return;
        var q = document.getElementById("wordQ");
        q.innerHTML = "&ldquo;" + text.split(" ").map(function (w) {
          return '<span class="w">' + esc(w) + "</span>"; }).join(" ") + "&rdquo;";
        /* the verse arrives word by word when the room comes into view */
        var words = q.querySelectorAll(".w");
        var light = function () {
          words.forEach(function (w, i) {
            setTimeout(function () { w.classList.add("lit"); }, CALM ? 0 : Math.min(i * 55, 2600));
          });
        };
        if (CALM || !("IntersectionObserver" in window)) { light(); return; }
        var io = new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting) { light(); io.disconnect(); } });
        }, { threshold: 0.35 });
        io.observe(q);
      }).catch(function () {});

    /* ----- the compass follows the scroll ----- */
    (function () {
      var links = document.querySelectorAll("#cmp a");
      if (!("IntersectionObserver" in window)) return;
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          var id = e.target.id;
          links.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + id); });
        });
      }, { rootMargin: "-30% 0px -55% 0px" });
      STAGES.forEach(function (s) {
        var el = document.getElementById(s[0]);
        if (el) io.observe(el);
      });
    })();

    /* ----- the reveal ----- */
    (function () {
      var els = document.querySelectorAll(".rv");
      if (CALM || !("IntersectionObserver" in window)) {
        els.forEach(function (el) { el.classList.add("on"); });
        return;
      }
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px" });
      els.forEach(function (el) { io.observe(el); });
    })();

    /* ----- share: the drop travels ----- */
    var shareBtn = document.getElementById("dphShare");
    if (shareBtn) shareBtn.addEventListener("click", function () {
      var payload = { title: d.title + " · Prayer Closet", text: d.phrase + " · " + d.support + " · " + d.reference,
        url: location.href };
      if (navigator.share) {
        navigator.share(payload).then(function () { track("closet_share", { drop: d.slug, via: "sheet" }); }).catch(function () {});
      } else {
        try {
          navigator.clipboard.writeText(location.href);
          shareBtn.querySelector("span").textContent = "Copied";
          setTimeout(function () { shareBtn.querySelector("span").textContent = "Share"; }, 1800);
          track("closet_share", { drop: d.slug, via: "copy" });
        } catch (e) {}
      }
    });

    /* ----- the private page: kept on the device, nowhere else ----- */
    var noteEl = document.getElementById("cloNote");
    var stEl = document.getElementById("cloSt");
    var NK = "mcc_pc_reflect_" + SLUG;
    try { noteEl.value = localStorage.getItem(NK) || ""; } catch (e) {}
    var t = null;
    noteEl.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        try { localStorage.setItem(NK, noteEl.value); stEl.textContent = "Kept."; } catch (e) {}
        setTimeout(function () { stEl.textContent = ""; }, 1600);
      }, 500);
    });

    /* ----- sizes: the chip rides the claim ----- */
    var sizePick = null;
    var sizeWrap = document.getElementById("clmSizes");
    if (sizeWrap) sizeWrap.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-size]");
      if (!btn) return;
      sizePick = btn.getAttribute("data-size");
      sizeWrap.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === btn); });
    });

    /* ----- preorder: whichever checkout the ledger named carries it ----- */
    var sq = document.getElementById("clmBuy");
    if (sq) sq.addEventListener("click", function () {
      track("closet_preorder_click", { drop: d.slug, via: buy.id, deposit: pre.deposit || null });
    });
    var alt = document.getElementById("clmClaimAlt");
    if (alt) alt.addEventListener("click", function (e) {
      e.preventDefault();
      document.getElementById("clmClaimWrap").hidden = false;
      alt.parentNode.removeChild(alt);
    });

    /* ----- first claim files as a lead on the desk ----- */
    var form = document.getElementById("clmForm");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="name"]').value.trim();
      var email = form.querySelector('[name="email"]').value.trim();
      if (!name || !/.+@.+\..+/.test(email)) { document.getElementById("clmErr").hidden = false; return; }
      var btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "Claiming…";
      var lead = { name: name, email: email, campaign: "prayer-closet",
        want: "Prayer Closet · Drop " + d.no + " " + d.title + " (first claim)",
        note: d.garment + " · " + d.color.name + " · " + d.reference + (sizePick ? " · size " + sizePick : "") };
      (window.MCC_CRM && window.MCC_CRM.send ? window.MCC_CRM.send(lead) : Promise.reject())
        .then(function () {
          form.hidden = true;
          if (sizeWrap) sizeWrap.hidden = true;
          document.getElementById("clmErr").hidden = true;
          document.getElementById("clmOk").hidden = false;
          track("closet_claim", { drop: d.slug, status: d.status, size: sizePick || "" });
        }).catch(function () {
          btn.disabled = false; btn.textContent = "Claim the first call →";
          document.getElementById("clmErr").hidden = false;
        });
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-sow]")) track("closet_sow_click", { from: d.slug });
    });

    track("closet_drop_view", { drop: d.slug, status: d.status, chapter: d.chapter,
      preorder: preLive, via: buy ? buy.id : null });
  }).catch(function () {});
})();
