# Mobbin references — the sales lane redesign

Authenticated Mobbin MCP, session of 2026-08-10. Every reference below was
opened as an **image** and read off the screen; nothing here is inferred from
titles or metadata. Each entry records what the screens actually show, what
HERE takes, what HERE refuses, and the implementation decision it changed.

---

## 1. Squarespace — Onboarding (the named reference)

`https://mobbin.com/flows/e76d1476-38c5-4a6e-9f4c-478f90b52825` · web · 13 screens

**What the screens actually show.** Marketing hero → *"What's your site about?"*
as a single question with a chip grid of ~20 categories (Travel, Education, Art,
Photography, Consulting, Non-Profit…) and, beneath it, *"Don't see what you're
looking for?"* with a free-text `Describe your site…` field. A hairline progress
rule sits directly under the question's sub-line, not at the page top. `SKIP` and
`NEXT` sit bottom-right. A second variant asks the same question as a single
search input with a typed value (`Food`) and an arrow submit. **Account creation
comes after the tailoring questions**, not before — first name, last name, email,
password, with an OAuth variant (Google / Apple / Email). Later screens ask
*"What is your site called?"* one question at a time over a **named step rail**:
`SITE TITLE · HOMEPAGE · PAGES · COLORS · FONTS`. The Blueprint AI variant runs a
live preview on the left and the question on the right with the rail reading
`Topic · Goals · Site info · Homepage · Pages · Colors · Fonts`, `BACK` bottom-left
and `NEXT` bottom-right. An `I'M JUST BROWSING` escape hatch sits top-right.

**Adopt.** One primary question per screen. A **named** step rail rather than a
bare "Step 4 of 12" — the client can see the shape of what remains. Chip grid
plus a free-text fallback so a business that doesn't fit a preset is never
trapped. `Back` bottom-left / `Continue` bottom-right, fixed position on every
screen. Ask the qualifying questions *before* demanding an account.

**Avoid.** At 1440 the category screen is mostly empty white — the question
floats without an anchor. HERE is dark and editorial, so the question screen
keeps a visible left-hand chapter mark and the offer being configured.

**Decision it changed.** `onboard.html` progress became a named rail
(`Offer · Mode · You · Business · …· Review`) rendered from the step list, and
the offer/mode questions were moved ahead of the account step.

---

## 2. Laravel Cloud — Completing a survey

`https://mobbin.com/flows/50d44602-9183-47a6-8e5f-91782acd2840` · web · 5 screens

**What the screens actually show.** *"Question 1 of 3"* in small caps above a
three-segment progress bar where only the completed segments are filled. One
question (*"How did you find out about Laravel Cloud?"*), eight full-width radio
rows, a black `Continue` button, and a quiet `Skip survey` beneath it. The last
screen swaps `Continue` for `Finish`. Completion is a single centred card with a
large `$5` credit and one `Get started` button.

**Adopt.** Segmented progress rather than a sliding percentage bar — discrete
segments read as "how many questions are left". Full-width option rows are far
easier to hit on a phone than a chip cloud. The terminal button changes its verb
on the last step.

**Avoid.** `Skip survey` on every screen — HERE's onboarding *is* the brief, so
required questions cannot be skipped past. Optional questions get their own
explicit `Skip` and the rest do not.

**Decision it changed.** The onboarding progress rail renders one segment per
step with `aria-valuenow`, and the final step's button reads `Send it to the desk`
instead of `Continue`.

---

## 3. Contra — commission comparison

`https://mobbin.com/sites/sections/e4b79a1e-8227-432f-8438-9f91a799ce0d`

**What the section actually shows.** A dark card. *"If you earn `$100,000` / year"*
with the figure in an inline editable field and a slider under it. Beneath, two
columns side by side: **with Contra — YOU LOSE `$0` — 0% COMMISSION FEE** and
**with other platforms — YOU LOSE `$20,000` — 20% COMMISSION FEE**. The number
the user gives up is the largest type in each column.

**Adopt.** This is the model for M Mode versus Equity Uprise. The client's own
revenue is the input at the top; both economic outcomes sit side by side; and the
amount shared is stated in the largest type on the Equity side rather than buried
in a footnote. Naming the cost plainly is what makes the offer credible.

**Avoid.** The neon blobs, the glow and the frosted-glass card. The brief bans
neon and heavy glassmorphism, and the finish is doing persuasion the numbers
should be doing on their own. HERE takes the structure and renders it in flat
dark editorial.

**Decision it changed.** The Equity Uprise calculator on `hire.html` and the mode
comparison inside each service chapter both take this shape: one revenue input,
two outcome columns, the shared amount and the cap in display type.

---

## 4. Stripe — "Estimate your cost"

`https://mobbin.com/sites/sections/088a670f-2b5e-4b7a-ad9b-680405acd8fb`

**What the section actually shows.** A slider with labelled tier stops
(`0–500`, `501–1,000`, `1,001–5,000`, `5,001–50,000`, `50,001+`). Above it, two
figures separated by a rule: `1000 — Charges per month` and `$43.00 — Estimated
monthly cost`. Below, the band that currently applies is highlighted in colour
while the others stay grey, and the arithmetic is spelled out
(`2¢/charge` + `1.8¢/charge · $25 infrastructure fee`). A footnote reads *"Custom
pricing is available for companies with large payments volume… Contact our sales
team to learn more."*

**Adopt.** The derived total is the hero and the inputs sit beside it, but the
**band math stays visible** — the client can see how the number was reached. And
that footnote is the polished register HERE needs for Who Did the Shoot and Write
a Song Equity: an unresolved price is announced as bespoke, not as missing.

**Avoid.** Nothing structural. Stripe's light palette is inverted for HERE.

**Decision it changed.** Two things. The Runway receipt shows its arithmetic
(`$30 domain + $30 first month = $60`, then `+ 11 × $30` to the `$390` first
year) instead of only a total. And every unapproved Equity formula renders as
**"Equity terms structured during discovery."** — the phrase carries the same
confidence as Stripe's custom-pricing line, with no warning chip anywhere.

---

## 5. Cofounder — "Estimate your monthly cost"

`https://mobbin.com/sites/sections/7567c411-413a-46d1-9f30-701a78b29c2b`

**What the section actually shows.** Numbered inputs down the left —
`1 Choose your plan` (two pill options with their prices inline), `2 How big is
your business?` (a ticked ruler slider with a `Micro $50` chip). On the right, a
bordered receipt: `Included usage from the Pro Plan — $20 included`, then line
items (Number of agents `10`, Token cost `$40`, Compute cost `$10`, Database
cost `$0`…) resolving to `Total monthly cost (estimated) $50` in display type.

**Adopt.** Inputs left, itemised receipt right, total in display type at the
bottom of the receipt. Line items that resolve to `$0` are still printed —
showing a zero is how you prove nothing is hidden.

**Avoid.** Nothing. This is the cleanest calculator layout of the set.

**Decision it changed.** The Runway receipt on `hire.html` prints every component
including the ones that cost nothing at signup (`Basic website build — included`,
`Revenue share — none`), and the Equity calculator prints `Ownership taken — None`
as a literal line rather than as prose.

---

## 6. Productboard — account into workspace

`https://mobbin.com/flows/bb415e7b-db8a-4bcf-b434-959ef818f13a` · web · 3 screens

**What the screens actually show.** *"You've been invited to Productboard"* with
Google sign-up or work email + full name + password. Then, immediately, the
workspace: a left rail carrying the org name (`asmobbin`), and a main panel
headed **"👋 Welcome Jon"** with a **Quick start** card — *"Get started with
Productboard by completing the following tasks"*, `1/5 Completed` in the corner,
and five numbered rows where row 1 (*Set up a workspace*) is checked and struck
through. A **Members** block beneath shows avatars for `Alex Smith` and
`Jon Smith`. A `Watch 3 min overview` and `Resources` column sits to the right.

**Adopt.** The completion state is not a thank-you page — it is the workspace,
already populated, with the first task **already ticked** because signing up
completed it. Named members with roles. The remaining work shown as a numbered,
countable checklist.

**Avoid.** The resource sidebar (academy, Slack community) — HERE has no such
estate and filler links would read as padding.

**Decision it changed.** `onboard.html`'s final screen is a workspace, not a
receipt: it prints person → organization → engagement → property → roles, shows
`1/5 complete` with *Account created* already struck through, and lists the four
remaining setup steps the desk will drive.

---

## 7. Jobber — client request

`https://mobbin.com/flows/13bc2f40-c708-4405-89a3-3a6e72376e07` · web · 4 screens

**What the screens actually show.** An empty state — *"Need some work done? Send
us a request to fill us in on the details"* with one `+ New Request` button and a
left rail (`Requests · Quotes · Appointments · Invoices`). The form carries
**Service Details** (*"Please provide as much information as you can"*, free
text), **Your Availability** — *"Which day would be best for an assessment of the
work?"* with a date picker, *"What is another day that works for you?"* marked
`(optional)`, and *"What are your preferred arrival times?"* as `Any time /
Morning / Afternoon / Evening` checkboxes — then an optional image upload warning
*"Do not upload files with payment information. Ensure you have all required
rights, consent and permissions to share."* Submission returns a green banner
*"Request submitted. We'll be in touch soon."* above a dated request card.

**Adopt.** For Who Did the Shoot: a **preferred date plus an explicit alternate
date**, because a single date kills a booking that could have moved by a day.
Time-of-day as multi-select rather than a clock. The safety warning next to any
upload or access question.

**Avoid.** The four-section single-page form. HERE's booking path stays one
question per screen; Jobber's grouping is what HERE's *review* screen looks like,
not its input.

**Decision it changed.** The Who Did the Shoot path asks date and alternate date
as one screen with two fields, and the access/ownership questions in the
Anti-Social path carry a "never send passwords here" line inherited from the
existing onboarding and reinforced by this reference.

---

## 8. Zendesk · Circle · monday.com · Dovetail — pricing grids (counter-reference)

`ce2647e2-7b63-4ef9-a35e-5d676312f03d` · `75daae46-73f0-457a-ba76-04fd57ce0a91`
`0f3ab25a-6c43-4cb3-b051-28afb7429c6b` · `623b2b4a-9071-4717-ae9b-8ea2494df43f`

**What the sections actually show.** Four or five visually identical columns.
Zendesk: Suite Team `$49` / Growth `$79` / Professional `$99` / Enterprise `$150`,
with a black **Most popular** tab clipped over the third card. Circle: three cards,
`MOST POPULAR` on the first and `BEST FOR BRANDS` on the third — two of three
carry a badge. monday.com: five columns, `Most Popular` flag, a team-size select
above. Dovetail: five columns with `Most popular` over the middle one.

**Adopt.** One thing only: Circle's **cumulative** feature lists — *"Everything in
Professional, plus:"* — which describe a ladder rather than four unrelated
products.

**Avoid.** Everything else, and deliberately. This is exactly the pattern the
brief forbids: repetitive equal cards, and "recommended" badges that are
persuasion rather than information — Circle badges two of its three plans, which
is proof the badge means nothing. HERE has seven configurations and rendering
them as seven equal cards would be this failure, squared.

**Decision it changed.** This is the reference that justifies the four-chapter
structure. `hire.html` renders **four service chapters** with the mode switch
*inside* the top three, never seven cards, and carries **no badge on any offer**.
Runway leads on width and type scale because it is the entry point, not because a
label says "most popular".

---

## 9. Gumroad · Lemon Squeezy — single-number pricing

`0c7c853b-8214-40b8-9b04-0c5723553f6a` · `9087ff81-a7f6-4519-9f8f-cfb8c1256b7a`

**What the sections actually show.** Gumroad: the entire pricing page is the words
**"10% flat"** at display scale over yellow, with one sentence under it. Lemon
Squeezy: a two-column split, each half its own tinted field — `ECOMMERCE 5% + 50¢`
against `EMAIL MARKETING $0/m` — each with its own checklist and its own slider.

**Adopt.** Gumroad's nerve: when a price is simple, set it enormous and say
nothing else. Runway's `$60` gets that treatment. Lemon Squeezy's split confirms
the two-field M-versus-Equity layout taken from Contra.

**Avoid.** Gumroad's asterisk-free brevity where terms genuinely exist — Equity
Uprise has a term, a cap and a revenue definition, and those stay visible next to
the number rather than in a footnote.

**Decision it changed.** Runway renders `$60` as the largest number on
`hire.html`, and the Equity panel prints share / term / cap / ownership as four
literal rows adjacent to the price.

---

## 10. Upwork · Wix — setup checklists

`af1cd9c4-0db4-4a30-a9e3-57b671b2b887` · `0d851540-2f07-4e4b-aea1-d647dad004f8`

**What the screens actually show.** Upwork: a *"Complete your profile"* modal with
a ring at `100% complete`, a `Well done!` label, and rows carrying their own weight
(*Employment history — Past job experiences and positions (+20%)*, *Portfolio …
(+10%)*), plus a collapsed `Show completed (6)` group. A sidebar shows
`Complete your profile 70%` against a thin bar. Wix: a persistent
`Let's set up your blog — 3/5 completed` rail item, a `Start Selling 0/3` card
with `Add Your First Product` / `Define Shipping Regions` (with an inline `Skip`)
/ `Connect Payment Methods`, each row carrying its own action button.

**Adopt.** Completed items stay visible but collapse — progress you can see you
made. Each remaining row owns a specific verb (`Set Up Shipping`, `Get Paid`), not
a generic "continue".

**Avoid.** Percentage-weighted completion (`+20%`, `+10%`). It gamifies a client
engagement, and a client who is 70% set up is not 70% of a client.

**Decision it changed.** The `onboard.html` workspace completion state uses
`n/5 complete` counting, with `Account created` and `Brief filed` already struck
through, and each open row naming the actual next action.

---

## Coverage against the brief

| Required subject | Reference(s) inspected |
|---|---|
| One-question-at-a-time onboarding | Squarespace ①, Laravel Cloud ② |
| Service selection | Squarespace ① chip grid + free-text fallback |
| Pricing comparison | Zendesk / Circle / monday / Dovetail ⑧ (counter-reference) |
| Standard vs revenue-sharing | Contra ③, Gumroad ⑨, Lemon Squeezy ⑨ |
| Quote calculators | Stripe ④, Cofounder ⑤, Duolingo (slider → per-unit → total) |
| Account-to-workspace onboarding | Productboard ⑥ |
| Client setup checklists | Productboard ⑥, Upwork ⑩, Wix ⑩ |
| Creative booking / campaign intake | Jobber ⑦, Wix service creation ⑩ |
