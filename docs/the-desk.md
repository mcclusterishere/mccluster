# THE DESK: CRM, outreach, and the machine behind it

    https://matthew.mccluster.org/desk.html   (owner login)

---

## 1. THE DESIGN LAW: one move, not a list

You said you don't want clutter or an infinite scroll of tasks. So the
desk shows **exactly one card**: the single best move right now, with the
email already written.

    THE STRIP    the whole pipeline in seven numbers, one glance
    THE MOVE     one person. why them. how hot. what to say.
    THREE KEYS   Send it  ·  Later  ·  Nurture

Send it, and the next card replaces it. There is no list to triage,
because the database already decided. `crm_next_move` scores everyone by
urgency (a reply outranks a due follow-up, which outranks a cold first
touch) and hands back the top one with **the reason attached**, so the
card can tell you *why* this person and not someone else.

When there's nothing due it says **DESK CLEAR** and stops. That's the
goal, not a bug.

## 2. THE FRONT OF THE HOUSE IS LISTENING

`js/signals.js` now runs on every public page. No popups, no chat bubble,
no "how did you hear about us." It records what a visitor **chose to do**:

| Signal | Weight | Why it predicts money |
|---|---|---|
| `rate_view` | 5 | They opened the hire page. Nothing else comes close |
| `return_visit` | 4 to 6 | Came back another day. The strongest cheap signal there is |
| `deep_read` | 3 | Reached the bottom of a page and stayed past 20 seconds |
| `print_open` | 3 | Priced a print |
| `wall_view` | 2 | Opened a specific shoot |
| `film_play` | 2 | Started a film |

The visitor is an anonymous id in their own browser. **It is not tied to a
person until that person hands you their own name.** Then every signal
joins up and appears as chips on their card. So when the desk says a
contact is at heat 78, that's evidence, not a guess.

**What it deliberately does not record:** keystrokes, mouse paths, form
contents, anything typed but not submitted. A signal is a public action,
the same thing a shop owner sees standing behind the counter. Keep it
that way; it's both the honest line and the legally safe one.

## 3. THE OUTREACH MACHINE

Five templates written for *this* business, not generic sales mail:

- **`press-cold`**: a photo editor at an outlet that covered an event you
  also shot. The strongest cold open you own, because you're offering
  something they already wanted.
- **`org-cold`**: a chapter, county office or nonprofit running events
  you're not shooting yet.
- **`client-recap`**: the day the wall goes up. Turns one job into the
  next, and asks for the credit link that feeds your entity SEO.
- **`follow-1`**: one nudge after five days. Never two.
- **`warm-signal`**: fires when someone's been reading walls and rate
  pages. They already want it.

Every `{{name}}`, `{{org}}`, `{{event}}` and `{{wall}}` fills itself from
the contact. Sequences cap at **two touches, then nurture**. A photo
editor who hasn't answered twice isn't interested this month, and the
third email is how you become the guy they filter.

### Sending real email: the part you have to set up

GitHub Pages can't send mail. You need a sending service, and you were
right that the domain matters. Recommended: **Resend** (resend.com).
Generous free tier, one API call, clean deliverability.

1. Sign up, add **`mccluster.org`** as a sending domain
2. Add the DKIM, SPF and DMARC records they give you to your DNS
3. Create a Supabase edge function called **`send-mail`** holding the API
   key as a secret. The desk already calls
   `/functions/v1/send-mail` with `{to, subject, text, contact_id}`.

**Until that exists, nothing breaks.** The desk records the touch, then
opens your mail client with the message pre-filled. The record stays
complete either way. That's deliberate: the CRM should never lose a touch
because a service isn't wired yet.

**Deliverability, said plainly:** warm up slowly. Ten to twenty a day for
the first two weeks, personalised. Blast 500 cold emails from a new domain
and you'll burn `mccluster.org` for every purpose including your ordinary
mail. The two-touch cap in the sequences isn't politeness, it's protection.

## 4. THE AI LAYER: your instinct is right, with one correction

You proposed ChatGPT as the main brain with Gemini as a sub-agent. That's
a sound split, and here's the sharper version:

| Job | Model | Why |
|---|---|---|
| **Reading photographs** | **Gemini** | Already wired in `vault-ingest.mjs`. Fast, cheap on images, and it's doing the frame-by-frame work |
| **Writing and reasoning** | **GPT** | Better at the outreach voice, research briefs and multi-step planning |
| **The desk's assistant** | **GPT calling tools** | Research a contact, draft the email, propose the next move |

The correction: **don't have ChatGPT "run" Gemini directly.** Have the
*desk* orchestrate. GPT decides what's needed, your edge function calls
whichever model does that job. Model-calls-model chains fail in ways you
can't debug, and you own the middle.

Both keys live in Supabase edge function secrets, never in a page. The
schema is ready for this; the functions are the next build.

## 5. THE DOMAIN MOVE

`tools/rename-domain.mjs matthew.mccluster.org` rewrites everything:
CNAME, every canonical, og:url, the sitemap, the wall generator, the tap
card, the vCard.

**⚠ Run it AFTER the DNS record exists, not before.** GitHub Pages serves
one custom domain, taken from CNAME. Push a CNAME for a host that doesn't
resolve and the live site goes dark until it does.

    1. DNS:  CNAME  matthew  →  mcclusterishere.github.io
    2. wait: dig matthew.mccluster.org
    3. node tools/rename-domain.mjs matthew.mccluster.org
    4. node tools/vcard.mjs && python3 tools/qr.py && node tools/build-walls.mjs
    5. commit, push, tick Enforce HTTPS when the cert issues

**Do it now, while the site is young.** The SEO equity on
`matthew.mccluster.org` is close to zero and a name-matched domain is worth
more forever. Waiting six months makes this expensive.

**One real cost:** anything already printed (NFC tags, QR stickers,
business cards) points at the old host. If any is in the wild, keep
`matthew.mccluster.org` alive as a redirect.

**And separate the concerns:** send bulk mail from a *dedicated* sending
subdomain (`mail.mccluster.org`) rather than the one your website lives
on. If outreach ever gets a spam complaint, the damage stays off the
domain that serves your portfolio.

## 6. MAKING GOOGLE KNOW WHO YOU ARE

Straight answer on **Dexter McCluster**: he's a former NFL player with a
decade of national sports coverage. **You will not outrank him for
"McCluster" alone, and chasing that is a waste.** What you *can* own,
completely, is **"Matthew McCluster"**. And that's the query that
matters, because it's what someone types after they've met you, got your
card, or seen your credit.

Four things build the knowledge card, in order of weight:

1. **One canonical entity page** with `Person` JSON-LD carrying `sameAs`
   to every profile you control: Instagram, YouTube, TikTok, ORCID
   (`0009-0000-8988-8955`), ISNI (`0000 0005 2956 3111`), SSRN. **Your
   ISNI and ORCID are unusual assets** for a photographer; they're
   authority-file identifiers that Google's entity graph already trusts.
   Most people applying for a knowledge panel have nothing like them.
2. **The same `@id` on every page**, so the whole site points at one
   entity instead of forty loose mentions. The wall pages already do this.
3. **Third-party corroboration**: being named in press coverage, credited
   with a link on a `.gov` or a chapter site. This is the one that
   actually flips the panel on, and it's the one you have to go get.
4. **The name-matched domain**, which is why point 5 above matters.

The `client-recap` template asks for the credit link on every job. That
isn't a nicety. Over a year it's the single biggest lever you have.

---

## Setup

1. Supabase → SQL Editor → run **`docs/the-desk.sql`**
2. Open **`desk.html`**, sign in, add three photo editors
3. Deploy the `send-mail` edge function when you're ready. The desk works
   without it
