# THE STOCK LANES: SFTP explained, and the honest money

You asked three things: what SFTP means functionally, how to use the lanes
that take it, and what 100 photos a week would actually earn. The third
answer changes the first two, so it goes first.

---

## PART 1: THE MONEY, STRAIGHT

### What a stock photo earns in 2026

| Agency | Your cut | Per download |
|---|---|---|
| **Adobe Stock** | 33% (images), 35% (video) | ~$0.35 to $0.99 |
| **Shutterstock** | tiered | ~$0.25 to $0.38 (enhanced licences $15 to $60, rare) |
| **Alamy** | **20%** for contributors under $3,000/yr as of 1 Sept 2026 | higher per sale ($50 to $100 gross), far fewer sales |
| **Depositphotos / 123RF** | ~30% | $0.30 to $0.35 |

**The industry benchmark is about $1.00 per image per YEAR**, across all
agencies combined. That is the number everything else is built on. Alamy
just cut small contributors from 40% to 20%, which tells you which
direction the whole market is moving.

### So: 100 photos a week

100/week = **5,200 images a year.** Run it out honestly:

| | Images live (avg) | Realistic earnings |
|---|---|---|
| **Year 1** | ~2,600 (portfolio is ramping, new files take months to index) | **$600 to $2,000** |
| **Year 2** (another 5,200) | ~7,800 | **$3,000 to $7,000** |
| **Year 3** | ~13,000 | **$6,000 to $13,000** |

Now the cost side, which nobody puts in the pitch:

- **Keywording.** Every image needs a title and 25 to 50 keywords or it never
  surfaces. At 2 minutes each that is **173 hours a year**, a full month of
  working days. (The Vault's Gemini pass cuts this hard, which is a real
  edge, but it still needs review.)
- **Acceptance.** Agencies reject for noise, focus, composition, and
  "oversupplied subject." Expect 60 to 85% acceptance, so 5,200 uploaded is
  maybe 4,000 live.
- **Shooting time** for 100 frames a week of *sellable commercial* content,
  which is not the same as 100 frames of an event.

**Year 1 works out to somewhere around $5 to $15 an hour.** You charge multiples
of that for an assignment.

### The comparison that settles it

You shot the Candler Crossing groundbreaking for DeKalb County. **That one
assignment is worth more than the first full year of a 5,200-image stock
portfolio**, and it took an afternoon.

So here is my actual recommendation, and I'd rather say it than sell you a
funnel:

> **Do not go shoot 100 photos a week for stock.** Stock is a **byproduct
> lane**: you upload what you already shot on assignment, at near-zero
> incremental effort, because the Vault has already done the metadata,
> the stamping and the catalog id. It is found money on work you were paid
> for once already. It is not a business you build a week around.

### Where the money actually is, in order

1. **Assignment work**: what you already do. DeKalb County, 100 Black Men,
   Future Successors. One shoot beats a year of microstock.
2. **Licensing back to the client and their partners.** The Candler frames
   have an audience of Decide DeKalb, Venture South, Publix and every outlet
   that covered it. That is a rate card, not a royalty.
3. **Prints**: you already run the shop, and the margin is yours.
4. **Editorial / news wire**: this is the one stock lane that genuinely
   fits you. See below.
5. **Microstock**: the byproduct.

### The lane that actually fits you: editorial

**Live News images sell for more than regular stock on Alamy**, and
editorial does not require model releases. That matters enormously, since
your work is full of identifiable people at public events.

You are already at newsworthy events with credentials and a real camera.
Groundbreakings with county officials, civic rallies, festival stages. That
content is worth more to a wire than to a microstock subscription pool, and
the frames already exist.

**Worth pursuing:** Alamy Live News, direct-to-publication sales (local
outlets like Decaturish, Rough Draft, On Common Ground already covered
Candler; they buy photos), and a stringer relationship with a wire.

---

## PART 2: WHAT SFTP ACTUALLY IS

**SFTP = Secure File Transfer Protocol.** Functionally: a private folder on
someone else's server that you can drop files into. You get a hostname, a
username and a password. You connect, you drag files across, they land.

That is genuinely all it is. It is older and dumber than an API, and for
this job that makes it **better**:

| API | SFTP |
|---|---|
| Needs an app, OAuth, app review (2 to 4 weeks for Meta) | Needs a username and password |
| Metadata sent as separate JSON fields | **Metadata rides inside the file** |
| Breaks when they version the API | Has worked identically since 2001 |

**The part that matters for you:** stock agencies read the **IPTC/XMP
metadata embedded in the JPEG itself**. Title, description, keywords,
creator, copyright: all of it travels inside the file. So an SFTP drop is
not "upload then fill in a form 5,200 times". It is "drop correctly-stamped
files, the agency reads them."

**The Vault already stamps every derivative.** Creator, copyright, credit,
PLUS licensor, catalog id, and `DigitalSourceType=digitalCapture`. What is
missing for stock is title + description + keywords, which is exactly what
the Gemini pass generates and you confirm on `vault.html`.

### How each SFTP lane works

| Agency | Host | Flow |
|---|---|---|
| **Adobe Stock** | `sftp://sftp.contributor.adobestock.com` | Drop JPEGs → they appear in your contributor portal as "uploaded" → you review/submit → moderation → live. Metadata read from the file |
| **Alamy** | FTP via their contributor area | Drop → files appear in "Manage Images" → add/confirm metadata → submit for QC |
| **Shutterstock** | FTP per contributor account | Drop → appears in "To Submit" → confirm keywords → submit |

All three: **no per-file fee, no review process to get in the door beyond
the contributor account itself.** Adobe and Shutterstock accept anyone who
passes a short quality test. Alamy takes anyone.

### What the pipeline would do

The Vault's job for this lane is one command:

1. Pull every capture in an event where `status='reviewed'` and
   `release_clear` is true (or the shoot is editorial-only)
2. Write a full-resolution JPEG with **title, description and keywords
   stamped into the IPTC** alongside the credit block already there
3. Drop the folder onto the agency's SFTP host
4. Log a `vault_pushes` row per file so the ledger stays complete

Steps 1 and 2 are a small addition to what already exists. Step 3 is `curl`
with SFTP support, or `lftp mirror -R`. Nothing exotic.

**I have not built this yet, on purpose.** It should be pointed at whichever
lane you actually open an account with, and I'd rather build one lane that
works than three that are guesses. Say the word and it's an afternoon.

---

## PART 3: SO WHAT DO YOU GO SHOOT?

If you want volume anyway (and there is a version of this that works), do
not shoot generic stock. That market is saturated and collapsing.

**Shoot what you have access to and others don't:**

- **Authentic Black community, business and civic life in metro Atlanta.**
  This is genuinely underserved in every stock library, buyers actively
  search for it, and you are already inside those rooms with trust.
- **Model-released portraits of real people**, not models; the releases
  table exists for exactly this. Released content licences commercially,
  which is where the higher-value sales are.
- **The city itself**: DeKalb, Decatur, Stonecrest, Bridgeport. Local
  landmarks, transit, streetscapes, seasonal.
- **Behind-the-scenes of your own work**: production, gear, crew. It sells
  and you're standing in it.

**But get the release.** A released commercial image of a real person is
worth many times an unreleased editorial one, and it's a one-page form.

### The honest bottom line

Stock will not replace your income. What it will do, once the Vault is
running, is turn **work you already got paid for** into a second small
cheque that keeps arriving, at nearly zero extra effort, and give you a
catalog so organised that the assignment side, the print side and the
licensing side all get faster.

That's the real return. The catalog is the asset. The royalties are gravy.
