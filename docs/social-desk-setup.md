# Turning the desk on for Instagram and Facebook

Everything in this repo is built and tested. What is left is the half only
you can do: the accounts, the app, the tokens and the two secrets. This is
that list, in the order it has to happen, with the check that proves each
step worked before you move to the next one.

Nothing here needs a developer. It needs about ninety minutes and a laptop.

---

## What is already done

| | |
| --- | --- |
| Webhook receiver, signature-checked | built, tested |
| Instagram + Facebook parsing (DMs, comments, mentions) | built, tested |
| Comment replies, private replies, the 24h DM window | built, tested |
| Echo suppression, so it never answers itself | built, tested |
| Knowledge base — 14 documents, 78 passages, every price from the ledger | **loaded and live** |
| Market anchors, and the golden 33% ceiling | **loaded and live** |
| Voice, and 13 house policies including the sales rules | **loaded and live** |
| Routing rules, including refunds always going to you | **loaded and live** |
| The function itself, with the brain in it | **deployed, version 2** |
| Domain search, checkout, Stripe | **live and taking money** |

## What is left

Six steps. Step 1 is done for now by a bridge; **step 2 is the one thing
standing between you and a bot that answers.**

---

## Step 1 — Let the code deploy itself

> **DONE, by a bridge.** The inbox is live at **version 2**, deployed
> 2026-08-29 from commit `b95b533`. `{"action":"health"}` answers
> `brain: true, documents: 14`, the new flow rules are running, and every
> security boundary was re-checked after the deploy: the Meta handshake
> refuses a wrong verify token, an unsigned webhook is refused, and the
> staff routes still refuse an unauthenticated caller.
>
> That deploy is a POINTER — a one-line `index.ts` importing the six real
> modules from the repository at a pinned, immutable commit, which Deno
> bundles at deploy time. The management API takes file contents inline
> and the real bundle is ~200 KB; re-typing tested code by hand to get it
> onto a server is how a transcription error reaches production.
>
> **Still do the step below.** The bridge cannot redeploy itself, so
> every future change to the function needs it done again by hand until
> the token exists. With the token, CI deploys the real files on every
> push — after running all eight suites and the golden-discount check —
> and replaces the pointer with the actual source.

**Why:** so the function deploys itself from now on, instead of needing a
hand-built bridge every time the code changes.

1. Supabase dashboard → click your avatar → **Access Tokens**
2. **Generate new token**, name it `github actions`, copy it
3. GitHub → the `Here` repo → **Settings → Secrets and variables → Actions**
4. **New repository secret**, name it exactly `SUPABASE_ACCESS_TOKEN`, paste, save
5. GitHub → **Actions** tab → **Deploy edge functions** → **Run workflow**

**Check it worked:** the run goes green and its summary lists `inbox` at a
version higher than 1. From now on every push deploys automatically.

> While you are in that Secrets screen, `SUPABASE_DB_URL` is also stale —
> it has been failing since July. Supabase → **Project Settings → Database
> → Connection string → URI (session pooler)**, copy it with the current
> password, and update that secret too. Database changes then apply
> themselves as well. Nothing will be replayed; the ledger of what is
> already applied has been backfilled.

---

## Step 2 — The two secrets that make it think and speak

Supabase → **Edge Functions → Secrets**. Never in the repo, never in a
message, never in a screenshot.

| Secret | What it is | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **THIS IS THE ONE BLOCKING EVERYTHING NOW.** The brain is deployed and reads all 14 documents; with no key it cannot form an answer, so flows still fire and every real question goes to you in silence. |
| `META_APP_SECRET` | Step 3 gives you this | Every webhook is refused. Nothing arrives at all. |
| `META_VERIFY_TOKEN` | **You invent it.** Any long random string. | Meta cannot complete the handshake in step 5. |
| `META_PAGE_TOKEN` | Step 4 gives you this | Messages arrive and are read; nothing can be sent back. |
| `VOYAGE_API_KEY` | Optional. voyageai.com | Search stays keyword-only, which already works. Adding it makes retrieval better, not different. |

Spending is capped at **$5 a day** in the org settings. Past 75% of it the
bot drops to the cheap model; at 100% it stops answering and hands off
rather than spending more. Change it in `orgs.settings.ai_day_budget_usd`.

---

## Step 3 — The Meta app

Your Instagram must be a **Professional account** (Business or Creator) and
it must be **linked to a Facebook Page**. That is not our choice; the
messaging API only exists through a Page. Instagram app → Settings →
Account type and tools.

1. developers.facebook.com → **My Apps → Create App**
2. Use case: **Other** → type: **Business** → name it
3. **App settings → Basic** → copy the **App Secret** → that is
   `META_APP_SECRET` from step 2
4. Add products: **Messenger**, **Instagram**, **Webhooks**

---

## Step 4 — Permissions and the token

Under **App Review → Permissions and Features**, request these. There are
eight and you need all eight:

```
pages_show_list            pages_manage_metadata
pages_messaging            pages_read_engagement
pages_manage_engagement    instagram_basic
instagram_manage_messages  instagram_manage_comments
```

Then **Messenger → Settings → Access Tokens** → add your Page → **Generate
Token**. That is `META_PAGE_TOKEN`.

> **The thing nobody tells you.** While the app is in Development mode,
> all of this works — but only for people with a role on the app. You can
> message your own Page from your own account and the bot answers. A
> stranger messages it and nothing happens. Going live for the public
> means **App Review**, which needs a screencast of the bot working and a
> privacy policy URL, and takes a few days. Do everything else first; the
> review goes much faster when you can record it working.

---

## Step 5 — Point Meta at the desk

**Webhooks → Add Callback URL**

```
Callback URL:  https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/inbox
Verify Token:  the META_VERIFY_TOKEN you invented in step 2
```

Meta calls the URL once and expects its challenge echoed back. The function
does that already — if it fails, the verify token does not match.

Then subscribe the fields. Two objects, separately:

| Object | Fields |
| --- | --- |
| **Page** | `messages`, `messaging_postbacks`, `feed` |
| **Instagram** | `messages`, `comments`, `mentions` |

Last, in **Messenger → Settings**, make sure your Page is in the list under
webhooks. A Page that is not subscribed sends nothing, silently.

---

## Step 6 — Tell the desk which accounts are yours

This is the step that is easy to skip and breaks everything quietly. The
webhook says which account a message arrived at; if the desk does not
recognise that account, **the message is dropped** — deliberately, because
answering in the wrong company's name is worse than missing a message.

**Find the two IDs.** Graph API Explorer (developers.facebook.com/tools/explorer),
your app, your Page token:

```
GET /me/accounts
      → the Page ID

GET /{page-id}?fields=instagram_business_account
      → the Instagram account ID
```

**Then run this** in Supabase → SQL Editor, with your two IDs pasted in:

```sql
-- put your real ids here
\set page_id    '000000000000000'
\set instagram_id '000000000000000'

update public.org_channels
   set account_id = :'page_id',
       self_ids   = array[:'page_id'],
       enabled    = true,
       connected_at = now()
 where channel = 'facebook'
   and org_id = (select id from public.orgs where slug = 'mccluster');

update public.org_channels
   set account_id = :'instagram_id',
       self_ids   = array[:'instagram_id'],
       enabled    = true,
       connected_at = now()
 where channel = 'instagram'
   and org_id = (select id from public.orgs where slug = 'mccluster');

-- the platform-wide switch, which is separate on purpose:
-- "this integration works" vs "this customer has it on"
update public.inbox_channels set enabled = true
 where key in ('instagram', 'facebook');
```

`self_ids` is what stops the bot answering its own replies. Meta delivers
your own outgoing messages back to you as webhooks; without this it would
read its own reply, answer that, and loop.

---

## Now test it, in this order

Each of these isolates one link. Do them in order, because a failure at
step 2 makes step 4 look broken.

**1. Does anything arrive?**
Message your Page from your own Instagram. Then:

```sql
select channel, direction, body, at
  from public.inbox_messages order by at desc limit 5;
```
Nothing? The webhook is not reaching you. Check the callback URL and that
your Page is subscribed.

**2. Did it arrive attributed to you?**

```sql
select detail from public.inbox_flow_runs
 where matched = false and detail ? 'unattributed'
 order by id desc limit 5;
```
Rows here mean step 6 is wrong — the `account_id` does not match what Meta
is sending. The `recipient_id` in that row is the ID you should have used.

**3. Did it think?**

```sql
select purpose, model, ok, error, cost_micros, at
  from public.ai_calls order by at desc limit 5;
```
Empty means no `ANTHROPIC_API_KEY`. `ok = false` shows the reason.

**4. Did it send?**

```sql
select channel, state, error, at
  from public.inbox_outbound order by at desc limit 5;
```
`state = 'failed'` with an error is Meta rejecting the send — almost always
a missing permission or an expired Page token.

---

## What it will do on day one

- **Answers price questions itself**, from the ledger, with citations. "How
  much for a website" gets $66 to go live, $33 a month, or $393 for the
  year — the same figures the cards charge, because they come from the same
  file.
- **Answers what is included, what is not, how long, can I keep my domain,
  do you take a cut, who have you built for.**
- **Tags every website enquiry** `sites-lead` so you can find them.
- **Replies to public comments** in public, shorter and more carefully than
  a DM — 400 characters, and a higher confidence bar, because a comment
  cannot be unsent.
- **Sends you anything about a charge.** Refunds, chargebacks, "you charged
  me twice", cancellations — in DMs and in public comments. It says one
  line and gets you.
- **Refuses to guess.** If the passages do not answer the question, it says
  so and hands off. It cannot invent a price, a date or a discount; an
  answer citing a passage it was not given is thrown away before it is
  sent.
- **Remembers people.** What someone told you last month is there next time,
  and a changed fact supersedes rather than overwrites.

## What it will not do

- **Register domains.** It checks availability live and takes the money;
  you register the name after the payment lands.
- **Message anyone first.** Meta's 24-hour window: outside it, a DM is
  refused rather than silently dropped.
- **Work for strangers before App Review.** Development mode is app roles
  only.
- **Do anything on Threads or Discord.** Threads has no DM API at all.
  Discord needs a always-on connection an edge function cannot hold.

---

## If you want it working this afternoon instead

Telegram needs no review, no app, no Page and no waiting: a token from
@BotFather, one secret, one `setWebhook` call. The same brain, the same
knowledge base, the same rules — live in ten minutes. It is a good way to
watch the thing work while Meta's review sits in a queue.
See `docs/social-connections.md`.

---

## Where the pieces are

| | |
| --- | --- |
| The brain | `supabase/functions/inbox/brain.ts` |
| Model calls, retrieval, memory | `supabase/functions/inbox/ai.ts` |
| Platform parsing and sending | `supabase/functions/inbox/platforms.ts` |
| Routing rules engine | `supabase/functions/inbox/flows.ts` |
| What the live rules do to real messages | `supabase/tests/desk-flows.test.mjs` |
| Rebuilding the knowledge after a price change | `node scripts/kb-build.mjs` |
| Day-to-day running | `docs/inbox-runbook.md` |
| What each platform actually permits | `docs/social-connections.md` |

---

## The golden discount, and where it is enforced

Every price is at or under **67% of the market median** for the same work —
"at least a third below what this work costs around here", which is the
line the ads run on.

The medians are researched, dated and sourced in `data/market-rates.json`.
The ceilings are never typed: `scripts/golden-check.mjs` re-derives every
one of them from that file, compares it against `data/offers.json`, and
**fails the build** if a price drifts above. It runs on every push in
`deploy-functions.yml`.

```
node --experimental-strip-types scripts/golden-check.mjs
```

It is a **ceiling, not a target**. A price already below it is left alone
rather than raised to meet it — raising the cheap end to hit a discount
number exactly would put the price up on the people the discount exists to
reach, and would end the free build.

After changing a price, or after re-checking a median, run it. If it goes
red the advertised claim is not true as the ledger stands, and the ad is
the thing that has to change if the price does not.

## Who qualifies for Equity Uprise

The 50% rate and the revenue share need three things, and all three exist
to make the revenue **measurable**:

1. **The website is one we built.** On somebody else's site we cannot see
   the orders, and the customer would be self-reporting the number their
   own bill is based on.
2. **The traffic runs through that website.** A bio link straight to a
   third-party checkout is a sale the site never sees.
3. **Payments run on the rails we connect.** This is the meter.

A business that wants to keep its own site is not turned away — that is M
Mode, at the standard price, with no revenue share and nothing to measure.

Eligible is not approved: it still takes a programme-fit review and a
signed agreement, and the desk is instructed never to tell anyone they are
approved.
