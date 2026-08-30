# Turning the back office on

Everything below is built and tested. None of it is *connected*, because
connecting it needs accounts, app review and tokens — things only you can do.
This is the order to do them in and what each one buys.

**It serves more than one customer.** Every table carries an org, and the
staff routes take one:

```
POST /inbox { "action": "channels", "org": "shiloh" }
```

Somebody who works for one customer never has to say which. Somebody who
works for several is **asked** rather than guessed at — the 403 comes back
with the list, and that list is what draws the picker at the desk. Guessing
is how a message goes out from the wrong company.

Roles have teeth: **staff read, owners spend.** Turning a channel on,
sending, sweeping followers, adding to the knowledge base and arming a tool
are all the owner's.

`docs/social-connections.md` is the long version of what each platform permits.
This is the short version of what to actually type.

---

## What exists

| | |
| --- | --- |
| **The engine** | `supabase/functions/inbox/flows.ts` — rules in, actions out. 31 tests. |
| **The connectors** | `supabase/functions/inbox/platforms.ts` — webhook in, API call out. 40 tests. |
| **The brain** | `supabase/functions/inbox/brain.ts` — routing, cost, chunking, the gate, the ladder. 63 tests. |
| **The calls** | `supabase/functions/inbox/ai.ts` — Anthropic, Voyage, retrieval, memory, the tool loop. |
| **The machines** | `supabase/functions/inbox/mcp.ts` — MCP 2026-07-28. 29 tests, against a strict server. |
| **The function** | `supabase/functions/inbox/index.ts` — ingestion, sending, back office. 35 tests. |
| **The schema** | `0021`–`0028` |
| **The desk** | `inbox.html` — threads, channels, tools, knowledge, spend, queue |

Run everything:

```
for t in flows platforms inbox-auth price brain mcp; do
  node --experimental-strip-types supabase/tests/$t.test.mjs
done
node scripts/inbox-desk-smoke.mjs          # drives the desk in a browser
```

Three things are SQL, so they are tested against a real database instead —
each inside a transaction that rolls back, so it is safe to point at
anything that has the schema:

```
psql -d <db> -f supabase/tests/memory_note_test.sql   # supersede, not overwrite
psql -d <db> -f supabase/tests/tenancy_test.sql       # one customer sees nothing of another's
```

---

## 1. Deploy

CI does this on every push to `main` that touches `supabase/functions/`
(`.github/workflows/deploy-functions.yml`), once `SUPABASE_ACCESS_TOKEN`
exists as a repository secret. By hand:

```
supabase db push
supabase functions deploy inbox --project-ref zmnhbrjyhxzhkxmhkexs
```

`verify_jwt = false` for this function, declared in `supabase/config.toml`
rather than passed as a flag, so a deploy that forgets the flag cannot flip
it. It is deliberate: a visitor does not have an account, and Meta's webhook
cannot present one. The back-office routes verify the caller themselves and
refuse anyone who is not on the staff list.

> **Check the deployed version before believing anything below.** This
> function sat at version 1 — pre-brain, pre-tenancy, pre-MCP — for the
> whole of the work that added those things, because every deploy was by
> hand and one got missed. `supabase functions list --project-ref
> zmnhbrjyhxzhkxmhkexs` is the only honest answer to "is it live".

## 2. Secrets

Set these in Supabase → Edge Functions → Secrets. **Never in the repo.**

| secret | what it is |
| --- | --- |
| `META_VERIFY_TOKEN` | a string you invent; Meta echoes it back once |
| `META_APP_SECRET` | from your Meta app. Without it every webhook is refused |
| `META_PAGE_TOKEN` | long-lived Page token, after app review |
| `X_BEARER_TOKEN` | only if you want the X side |
| `THREADS_TOKEN` | only for Threads reply moderation |
| `TELEGRAM_TOKEN` | from @BotFather. **The one that works today** |
| `TELEGRAM_SECRET` | a string you invent and pass to `setWebhook` |
| `SLACK_BOT_TOKEN` | `xoxb-…` |
| `SLACK_SIGNING_SECRET` | without it every Slack post is refused |
| `WA_TOKEN` | WhatsApp Cloud. Signed with `META_APP_SECRET` |
| `BSKY_HANDLE` / `BSKY_APP_PASSWORD` | the app password needs DM access ticked |
| `ANTHROPIC_API_KEY` | optional. Without it the bot is flow rules only |
| `VOYAGE_API_KEY` | optional. Without it retrieval is keyword-only |
| `AI_DAY_BUDGET_USD` | default 2.00. Past it, replies hand off to you |

The database stores the **name** of each secret, never its value. A token in a
row is a token in every backup.

## 3. Point Meta at it

Webhook URL: `https://<project>.functions.supabase.co/inbox`
Verify token: whatever you set as `META_VERIFY_TOKEN`.

Subscribe the Page to `feed` and `messages`; subscribe the Instagram account to
`comments` and `messages`.

## 4. Tell it which account is you

Your own comments come back as webhooks. Without this the bot answers itself.

```
POST /inbox   { "action": "set_channel", "channel": "instagram",
                "account_id": "<ig user id>", "self_ids": ["<ig user id>"] }
```
with your desk login's `Authorization: Bearer <jwt>`.

## 5. Turn a channel on

```
POST /inbox   { "action": "set_channel", "channel": "instagram", "enabled": true }
```

Check it first:

```
POST /inbox   { "action": "channels" }
```

That returns each channel's capabilities, its credential, and
`token_present` — whether the named secret is actually set. A configured token
that is missing is the commonest reason for silence.

---

## Telegram, in five minutes

Everything above needs somebody at Meta or X to approve something. This does
not. If you want to watch the whole thing work today, do this:

1. Message **@BotFather** on Telegram, `/newbot`, take the token.
2. Set `TELEGRAM_TOKEN` to it and `TELEGRAM_SECRET` to any string you invent
   (A–Z, a–z, 0–9, `_`, `-`; 1–256 characters).
3. Point Telegram at the function:

```
curl "https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook" \
  -d "url=https://<project>.functions.supabase.co/inbox/telegram" \
  -d "secret_token=<TELEGRAM_SECRET>"
```

4. `POST /inbox { "action": "set_channel", "channel": "telegram", "enabled": true }`
5. Message your bot.

The secret is what makes the endpoint yours: Telegram does not sign anything,
it echoes your secret in `X-Telegram-Bot-Api-Secret-Token`, and a delivery
without a matching one is dropped. **If `TELEGRAM_SECRET` is unset, every
Telegram delivery is refused** — an endpoint you cannot authenticate is an
endpoint anybody can post to.

## Slack

Webhook URL `…/inbox/slack`. Subscribe to `message.im` and `app_mention`.
Set `SLACK_SIGNING_SECRET`; without it every delivery is refused, including
the one-time `url_verification` handshake, so set it *before* you save the
URL in Slack or the handshake will fail.

Slack answers `200 OK` with `{"ok": false, "error": "..."}` when a send
fails. That is recorded as **failed**, not as sent — worth knowing, because
every naive integration on the internet records it as sent.

## WhatsApp

Same webhook URL as the other Meta channels and the same `META_APP_SECRET`
signature; only the payload shape differs, and the function dispatches on
`object == "whatsapp_business_account"`.

Two things you must set or nothing sends:

- `WA_TOKEN`
- the **phone_number_id you send from**, as the credential's `account_id`. It
  goes in the URL path, not the body.

Outside the 24-hour customer-service window only a pre-approved template may
be sent. Templates are not wired here, so a late reply is **refused with a
reason**, not silently dropped.

## Bluesky

Bluesky has no webhooks. Nothing pushes; somebody asks:

```
POST /inbox   { "action": "poll", "channel": "bluesky" }
```

Run it from the desk, or on a cron every few minutes. It is idempotent —
`external_id` collides on the second look exactly as it does for a redelivered
webhook, so polling twice cannot answer twice.

The credential is a handle and an **app password created with direct-message
access ticked**. Without that tick every chat call returns "Bad token scope".
The app password is exchanged for a session that expires in about two hours;
that is handled here, including re-login on a mid-poll 401.

Replying to a *post* is not wired: it needs the parent's `cid` as well as its
`uri`, which the notification list does not carry. DMs work.

## Discord

Off, and not because of a setting. Reading message content needs a gateway
websocket held open, and an edge function cannot hold one. Discord can be
posted *to* from here; it cannot be listened to. If you want Discord properly,
it needs a small always-on process, which is a different shape of thing from
everything else in this repo.

---

## The follower thank-you

You asked for this one specifically. Here is where it actually works, and
where it cannot, which is not the same list as where you would want it to.

| | |
| --- | --- |
| **Bluesky** | **Works, and it is free.** A follower list you can page through and a DM API with no per-message cost and no window. This is the one to use. |
| **X** | Works. Every DM is **billed**, so nothing is sent until you turn `auto_greet` on for that channel — recorded and not messaged is the default. |
| **Instagram** | Impossible. There is no follow event and the follower list is not readable — only a count. Nothing to diff and nothing to be notified about. |
| **Facebook** | Same. |
| **Threads** | Impossible. No direct-message API exists at all. |
| **Telegram, Slack, WhatsApp** | There is no such thing as a follower. People message you or they do not. |
| **LinkedIn** | Partner-only, and requires a member to press send on an editable draft. Automating it is the thing the rule forbids. |

Set the message first, or nobody is sent anything:

```
POST /inbox { "action": "set_channel", "channel": "bluesky",
              "follow_greeting": "Thanks for the follow — I AM HERE is out now.",
              "auto_greet": true }
```

Then sweep:

```
POST /inbox { "action": "followers", "channel": "bluesky" }
POST /inbox { "action": "followers", "channel": "bluesky", "dry_run": true }
```

**The first sweep messages nobody.** It records your existing followers as
the baseline and says so. Without that, turning this on would DM your
entire existing following at once, which is the single worst thing this
feature could do.

After that, each sweep greets whoever is new. `dedupe_key` is
`follow:<channel>:<id>`, so running it twice in a minute cannot thank
anyone twice, and neither can two overlapping crons.

On Bluesky a DM goes to a **conversation**, not to a person, so one is
opened per follower before anything is sent. That is also the step that
fails — per person, recorded, not retried — when somebody only accepts
messages from people they follow. Their choice, and it shows up in the
`failures` list rather than as an error.

## Teaching it to answer

Until you put something in the knowledge base, the bot only says what a flow
rule tells it to. The knowledge base is the act of authorising what it may
say — anything not in there, it will not claim.

```
POST /inbox { "action": "kb_put",
              "kind": "page",
              "title": "McCluster Sites",
              "url": "https://matthew.mccluster.org/sites/",
              "body": "<the page, as text or markdown>" }
```

Headings matter. Each chunk is stored with `<document title> — <heading>`
in front of it, which is what makes "do you take new clients?" findable
when the answer under it is just "yes, usually two a month". A wall of text
with no headings still works; it just retrieves worse.

Re-putting an unchanged page costs nothing — it is hashed and skipped.
Re-putting a changed one replaces every chunk rather than diffing, because
deciding whether new chunk 4 "is" old chunk 4 is how a stale answer survives
in the index forever.

Check what it would find **before** it says anything to anybody:

```
POST /inbox { "action": "kb_try", "q": "how much for a website" }
```

That returns the passages, their scores, and their keyword and vector ranks
separately. When a reply comes out wrong, this is nearly always where the bug
is — the model answered honestly from the wrong passages.

### What is true right now

Hours, a closure, the current release — things that change and are true for
everybody:

```
POST /inbox { "action": "shared_put", "key": "hours", "value": "Closed until the 8th" }
```

Sent with an empty value, it deletes the key. No model is involved; this is
typed by a person and quoted verbatim into every answer.

### What it costs

```
POST /inbox { "action": "ai_spend" }
```

Every call is a row — routing, answering, extraction, embedding — with its
model, tokens, latency and cost in micro-dollars. Cost comes from the
`ai_model_prices` table, so correcting a price is an `update`, not a deploy.

`AI_DAY_BUDGET_USD` (default $2) is enforced, not advisory. Past 75% of it the
router collapses to the cheapest model at the lowest effort; past 100% it
stops calling anything and every reply becomes a handoff to you. **A bot that
goes quiet is recoverable; a bot that quietly spends is not.**

### What it remembers

```
POST /inbox { "action": "memory", "contact_id": "<uuid>" }
```

Returns what it currently believes about that person, and what it used to
believe. Facts are superseded, never overwritten: when somebody says you got
it wrong, the old value is still there to look at. Passwords, card numbers,
government IDs and dates of birth are dropped before they are ever written.

---

## What it will refuse, and why that is the point

Ask it to do something a platform does not allow and it returns a **refusal**,
recorded next to the successes in `inbox_outbound`:

```
Threads has no direct-message API at all. This is not a permission you can
be granted.

LinkedIn messaging is partner-only and requires a member to press send on an
editable draft. Automated sending is the thing the rule forbids.

the 24h window on instagram closed 26h ago.
```

A refusal is a first-class outcome, not an error. When nobody gets thanked,
that table is the answer to why.

---

## It reads a message before it pays to answer one

A cheap model looks first and sorts the message into one bucket. Two of
those buckets are the reason this step exists at all:

- **Abuse is never answered, and never closed.** A model asked to be
  helpful will try to be helpful at somebody calling you names, in public,
  under your own post. It hands off instead. Closed would be worse than
  answered — closed is hidden, and this is the thread you most want to
  see, because you may need to block, report, or delete a comment.
- **Spam is closed without a reply.** Engaging a link farm confirms the
  address is live and costs a full answer to do it.

The rest:

| bucket | what happens |
| --- | --- |
| support | answered normally |
| lead | answered, tagged `lead`, and **written into the CRM** if they left an email |
| praise, in public | a short thank-you |
| praise, in a DM | handed to you — a bot thanking you for a compliment and then going quiet reads worse than nothing |

A lead with no email address does **not** get a row invented for it. A
handle in the email column is worse than no row, because somebody would
try to use it; the conversation is tagged and stays in the inbox instead.

If triage itself fails, the message is answered normally. It is a filter,
never the only thing standing between a stranger and a reply.

## Telling it when it was wrong

Every answer the model writes carries the id of the call that produced it,
so the **good** / **wrong** links under it in the thread land on that exact
call — not on the conversation, which may hold three answers of which one
is the bad one.

```
POST /inbox { "action": "eval", "call_id": "…", "verdict": -1, "dimension": "helpful" }
```

`dimension` is one of `grounded`, `helpful`, `in_voice`, `safe`; `verdict`
is `-1`, `0` or `1`. Every verdict lands in `ai_evals` next to the call's
model, cost, and the passages it was given — which is what makes "the
answers got worse last week" a question with an answer.

## Connecting a machine

The bot can tell somebody what a document says. It cannot tell them what the
sanctuary is reading *right now*, and it certainly cannot change it. That
needs a tool, and a tool has to run where the hardware is — on the
customer's own box, behind their own network — not in this function.

That is what MCP is for here. They run a server; this calls it.

```
POST /inbox { "action": "set_server", "org": "shiloh",
              "name": "the church building",
              "url": "https://shiloh.example/mcp",
              "token_env": "SHILOH_MCP" }
```

Never paste the token. Name the secret; the row holds the name. Then look at
what it can do:

```
POST /inbox { "action": "refresh_tools", "org": "shiloh", "server_id": "…" }
```

### Every tool arrives switched off

And classed `act`, which is the most cautious thing it could be. Three
classes, and the difference is not a matter of opinion:

| class | what it means | may it run unattended? |
| --- | --- | --- |
| `read` | no side effect | only if you *also* arm it, and never from a public comment |
| `write` | changes something you could change back | no |
| `act` | changes the world in a way somebody walking in would notice — a door, a stream, a siren | **no, and there is no setting that makes it yes** |

That last row is a database CHECK constraint, not a sentence in a prompt. A
tool classed `write` or `act` cannot be marked automatic; the insert is
refused.

### What happens when the bot wants to do something it may not

It doesn't do it. It files a request — what it wants to run, with what
arguments, and why in its own words — and tells the person it is talking to
that somebody is looking. The request appears at the top of the Tools room
and lapses in an hour if nobody answers, because a yes pressed tomorrow for
something asked today is a yes to something that is no longer true.

Two people pressing **Do it** at the same time produce one call, not two.

### Where a building actually needs to be

The URL has to be reachable from Supabase's edge, so a machine on a home or
church connection needs a tunnel — not a LAN address. That is the one piece
of this you cannot do from the desk.

## What it costs to be clever

The bot does not use everything it has on every message. `choosePattern`
picks the shape and records why:

| shape | when | what it costs |
| --- | --- | --- |
| `single` | nothing matched, nothing to ground it in | one call |
| `grounded` | passages matched. **The normal case.** | one call |
| `tools` | this org has a machine connected | one call per round trip, capped |
| `verified` | a public comment, or somebody asking to spend money | two calls |

**The tools rung does not exist on an org with no machine** — absent, not
disabled. Connecting a building changes what that customer's bot can do
without changing what anybody else's "how much is a website" costs. And past
three quarters of the day's budget nothing above the cheapest shape is bought
at all, whatever the message says: an expensive answer to the last question
of the day is an expensive answer nobody gets.

## Trying two versions and finding out

```
POST /inbox { "action": "set_experiment", "org": "shiloh",
              "key": "voice-2026-08",
              "dimension": "voice",
              "arms": [ { "name": "control", "weight": 50 },
                        { "name": "warmer",  "weight": 50,
                          "value": "Answer like somebody who is glad they wrote." } ],
              "enabled": true }
```

`dimension` is `voice`, `model` or `effort`. An arm with no `value` changes
nothing and is still recorded, which is exactly what a control is. An arm
with a weight of zero is refused: an arm that never runs is the shape of
every experiment that ever "proved" something.

**Assignment is to the person, not the message.** Somebody who gets the warm
voice in one reply and the terse one in the next has not been in an
experiment, they have been in a fault. The arm is a hash of the experiment
key and the contact, so it is the same after a restart, a redeploy, or this
code being rewritten — and two experiments running at once do not agree with
each other by accident.

```
POST /inbox { "action": "experiments", "org": "shiloh" }
```

comes back with cost, latency and verdicts per arm, and a sentence saying how
much to believe it. **Mostly it will say "not enough verdicts yet"**, and
that is the correct answer to almost every A/B test run at this size. It
starts calling a winner at thirty verdicts and a fifteen-point gap, and says
so plainly when the winner also costs noticeably more per answer.

Verdicts come from you pressing **good** or **wrong** in a thread. Nothing
scores itself.

## What the model is, and is not, allowed to do

The flow rules always win. The model is only asked when **no rule fired** —
it is never a second opinion on a question somebody already answered. That is
the entire guardrail: anything you cannot afford it to get wrong, you write a
flow for, and the model never sees it.

Before anything it writes is sent, it has to get past a gate:

- **A citation to a passage it was never given is fatal.** That is the tell
  for an answer built out of the model's own memory rather than out of your
  site, and it costs nothing to check, so it is checked every time.
- **An unsourced claim is refused** when passages were available.
- **A public comment needs more confidence than a DM**, and is held to a
  shorter length. A DM can be followed up; a comment on a post cannot be
  unsent.
- **The model asking for a person is honoured**, always.

Every refusal leaves the thread open at the desk with the reason recorded.
"The bot ignored me" and "the bot decided it did not know" look identical
from the outside and are not the same problem.

## Safety rails already in place

- **Redelivery**: a repeated webhook collides on `(conv_id, external_id)` and
  becomes nothing, instead of a second reply.
- **Duplicate sends**: `dedupe_key` is unique, so a retry cannot thank the same
  person twice.
- **Talking to itself**: ids listed in `self_ids` are recognised as us and
  ignored.
- **Public vs private**: a comment is answered where it was made and a DM as a
  DM. The send kind comes from the event, never from the flow.
- **Claimed threads**: when a human has taken a conversation, the bot does not
  talk over them.
- **Money**: X sends are flagged `costs_money` and gated behind `auto_greet`.
