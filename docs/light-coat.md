# The light coat: what was invisible, and how it was found

The house turns with the visitor's own clock — daylight hours get the
gallery coat, evening gets the cinema (`js/theme.js`). That means every
page ships in two coats and, on any given look, you are only ever
checking one of them.

That asymmetry is the whole bug. A rule paints a panel with a literal
dark colour; the text inside it rides `var(--cream)`, which flips to ink
at seven in the morning. In the cinema the two agree. In daylight the
panel stays near-black while the words inside it turn near-black too, and
a whole section of the page goes silent — while looking perfectly correct
to whoever last edited it after dark.

Reported as: *"there are still elements of the website in the light
version that cannot be seen."*

---

## How it was found

Not by reading stylesheets. Reading them produces guesses, and the two
static scans written along the way (dark literal panels, cream literal
ink) flagged **118** and **150-odd** candidates respectively — almost all
of them fine, because a cream label on a scrim over a photograph is
correct and a stylesheet cannot tell you that.

So the question was put to the pixels instead. `scripts/legibility.mjs`:

1. loads a page with `mcc_theme="light"` forced,
2. walks it a viewport at a time, screenshotting each stop,
3. decodes the PNG in-process (`scripts/png-read.mjs`, no dependencies),
4. and for every element that paints its own text, builds a luminance
   histogram of the pixels inside its box.

Ground is the modal bucket. Ink is the far end. Text drawn in the
background colour scores **1:1** — invisible — no matter what the
stylesheet claims the colours are.

Anything that fails is then **parked mid-viewport, given a second to
settle, and measured again**, because a scroll sweep will otherwise
photograph elements mid-reveal and report an easing animation as a
contrast bug. Only a second failure counts.

### What the tool is good at, and what it is not

- **Decisive under ~2.5:1.** Every finding in that band held up when
  rendered and looked at. That is the band the complaint was about.
- **Unreliable between ~3:1 and 4.5:1.** It under-reads small
  letterspaced text in a wide box: the glyphs occupy too little of the
  box for the percentile sweep to reach their core. `--offer-quiet`
  (0.62 alpha) measures 2.4:1 and is really **4.84:1**; `--cream-dim`
  (0.72) measures 3.1:1 and is really **6.75:1**. Both clear AA.
- **Wrong on gradient buttons**, where it measures one end of the
  gradient against the other instead of the text against either.

Treat that middle band as a list of places to go and look. Three
findings in it were false alarms and were left alone after being
rendered and checked by eye.

---

## What was actually broken

| Where | What a visitor saw at midday | Cause |
| --- | --- | --- |
| `docket-516.html` TL;DR | the entire plain-English summary of the case, unreadable | `.tldr` painted `rgba(20,16,12,0.85)` with tokened text |
| `case-designer-kicks.html` chart | months, y-ticks, gridlines and the cut line all gone; a red line floating in nothing | SVG takes `fill`, not `color` — `.dkc__*` named cream literals and never rode the flip |
| `gallery.html` strip (and the four stubs that forward to it) | shoot titles and dates lost into the photographs | captions inherited `--gx-ink`/`--gx-gold` and turned to ink over a night shot |
| `gallery.html` event cards | the year badge | `--gx-mut` grey vanished on dark covers; bone then vanished on light ones |
| `fellowships.html` badges | whether a listing is VERIFIED or UNVERIFIED | five pale pastels, 1.2:1–1.6:1 on the card |
| `hire.html` calculator | the whole equity calculator and its receipt | `.calc` / `.runway` dark slabs, no light coat |
| `onboard.html` | the money summary, the acknowledgement, the review rows | `.obsum` / `.oback` dark slabs; cream hairlines on cream |
| `album.html` comments | the heading, the field outlines | `js/comments.js` injects its CSS with dark-coat literals |
| `album.html` footer | the contact links | hardcoded `#e5383b`, 3.6:1 on bone |
| `matthew-mccluster.html` | the one CTA a recruiter is meant to press | ink on a gradient whose red end sat at 4.4:1 |
| `offers.css` timeline | the bead and its rail | `var(--paper)` — a token **no stylesheet ever defined**, so the rule was dropped as invalid |

---

## The two rules that came out of it

**1. If a surface names a literal colour, it needs a light coat.**
Tokens turn on their own; literals do not. Both new `html[data-theme="light"]`
blocks (`css/offers.css`, `css/onboard.css`) say so in place.

**2. If text sits on a photograph, it must not turn at all** — and it
should not depend on the photograph either. A cover can be a night
rooftop or a white studio wall, so the gallery captions got a scrim and
the year badge got a chip. Both are the same in both coats, because the
thing they sit on is.

---

## Keeping it fixed

`scripts/smoke.mjs` carries a **light coat** section: cheap computed-style
tripwires on exactly the surfaces that were caught, so an edit that
re-breaks one fails the release gate rather than shipping. It is a
tripwire, not a sweep — for the sweep, run the tool:

> **Alpha is the whole point on these panels.** A wash *is* ink — 5% of
> it — so any check that reads `backgroundColor` and drops the alpha
> measures the ink and calls a pale wash a black slab. The first version
> of the docket tripwire did exactly that and the gate refused the push.
> Composite over the page ground before asking how dark anything is.


```
PW_MODULE=<playwright> PW_CHROME=<chrome> \
  node scripts/legibility.mjs gallery.html docket-516.html ...
```

`LEG_PORT` moves the local server (two sweeps at once); `LEG_OUT` chooses
where the JSON lands. Theme-locked pages (`data-theme-lock="dark"` — the
cinema rooms, the closet, the track pages) report themselves skipped
rather than being audited against a coat they never wear.

## Known and left alone

- `walls/*.html` breadcrumb links, `#ff5a5c` at 4.25:1 — over a hero
  photograph, identical in both coats, and brightening is the only safe
  direction over an unpredictable image. Not a daylight regression.
- `hire.html` band eyebrow, `#e5383b` at 4.17:1 — sits on a `.92` ink
  veil over a photo. Same in both coats.
- **Card hairlines.** Around forty rules in `css/style.css` pair
  `background: var(--ink-2)` — which flips on its own — with
  `border: 1px solid rgba(244,239,230, …)`, which does not. In daylight
  those outlines go cream on cream. The panels still read, because
  `--ink-2` in the light coat (`#e8e1d4`) is *darker* than the page
  ground (`#f2ede4`), so each card separates by fill; only the hairline
  is missing. The pixel sweep cannot see this at all — it measures text,
  not structure. Left alone deliberately: the real fix is one token for
  the hairline flipped in one place, not forty hand-edited rules, and
  that is a refactor rather than a legibility fix.
- **Hover and overlay states.** A sweep does not hover, does not open
  modals and does not expand panels, so nothing behind an interaction was
  measured. One such case was caught by reading rather than measuring —
  the chart's cursor readout (`.dkc__tip`), whose fill flips while its
  hairline does not — and is fixed. Others may remain.
