# The inbox

One thread per person, whatever door they came in. This is the engine
half of "mini chat mixed with chatfuel mixed with every chatbot" — the
part that is the same no matter which platform is on the other end, so
adding a channel later is writing an adapter rather than rebuilding
anything.

`docs/social-connections.md` is the checked account of what each platform
actually permits, and it is the thing to read first, because it decides
what this engine is allowed to do.

---

## What is here

| Piece | Where | What it is |
| --- | --- | --- |
| Schema | `supabase/migrations/0021_inbox.sql` | contacts, conversations, messages, channels, flows, tags, and the RLS |
| Flow engine | `supabase/functions/inbox/flows.ts` | a pure function: message in, actions out. No database, no network. |
| The door | `supabase/functions/inbox/index.ts` | the only thing allowed to write a message |
| Tests | `supabase/tests/flows.test.mjs` | 31 assertions, mostly about when the bot must stay quiet |
| Widget | `js/deskchat.js`, `css/deskchat.css` | the chat on the site itself |

Live on eleven public rooms: the front page, Sites, the album, the
gallery, Hire, Equity Uprise, the Closet, Give, Press, the fellowship
directory and Topics. Not on the staff desks, and not on
`matthew-mccluster.html` — that is the page a hiring manager opens, and
it deliberately carries no chrome.

---

## It is live

Applied to the `Here` project on 2026-08-19: migration `inbox`, migration
`inbox_view_runs_as_caller`, and the `inbox` edge function
(`verify_jwt` off, because a visitor does not need an account to say
hello and Meta's webhook cannot present one).

Verified against the live endpoint, not assumed:

| Probe | Result |
| --- | --- |
| first message from a valid visitor key | both greeting lines came back |
| "where can I hear your music" | the album link came back |
| a 3-character visitor key | `bad visitor key`, no thread issued |
| `direction:"out", author:"staff"` sent by the browser | **ignored** — stored as `in`/`contact` |
| reading a guessed visitor key | empty thread, nobody else's messages |
| webhook with a forged signature | `401` |
| Meta handshake with a wrong token | `403` |
| a 3,000-character body | `413` |

**One thing left for you**, once, with your profile id:

```sql
insert into public.inbox_staff (profile_id) values ('<your eu_profiles id>');
```

Until then the conversations are readable only through the Supabase table
editor, which is fine while there is no staff room yet.

### A leak that was caught before it held anything

`inbox_threads` shipped in the first migration without `security_invoker`.
Postgres reads a view's underlying tables **as the view's owner** unless
that flag is on, so the caller's RLS never applied — and as `anon`,
`select count(*), max(last_body) from inbox_threads` returned a seeded
conversation *and its full message body*. Every thread was readable by
anyone holding the publishable key.

The RLS on the tables was correct the whole time. The view walked around
it. It was found by seeding a row and looking at it as `anon` — not by
reading the SQL, where it looked fine. Fixed in
`inbox_view_runs_as_caller`: `security_invoker = on`, and `anon` revoked
from the view outright.

---

## Where the trust sits

Same rule the shake shop used, for the same reason: **the browser is not
trusted to write anything that matters.**

- `inbox_conversations` and `inbox_messages` have **no policy for anon at
  all**. A browser cannot insert a message even if it wants to.
- The edge function on the service role is the only writer.
- The client says *what its own visitor typed*. It does not get to say
  who the message came from — `direction` and `author` are set inside the
  function, never accepted from the request.
- The visitor key must match the shape the function issues
  (`[A-Za-z0-9_-]{16,64}`). A key we did not mint is refused a thread.
- Meta's webhook deliveries are HMAC-verified against `META_APP_SECRET`.
  **If the secret is unset, hooks are refused rather than allowed** —
  fail closed, not open.
- `external_id` is unique per conversation, so a webhook redelivery
  collides instead of double-posting. Webhooks retry; this is what makes
  that safe.

---

## Flows: the chatfuel half

A rule is *when TRIGGER, and every CONDITION holds, do ACTIONS*, and it
is a **row**, not code. You change what the bot says by editing the
database, not by waiting for a deploy.

```
trigger    {"on":"message_in","match":"any","keywords":["price","cost"]}
           {"on":"message_in","match":"first"}         first ever message
           {"on":"comment_in","match":"regex","pattern":"link|where"}
           {"on":"message_in","match":"always"}

conditions [{"not_tag":"already-greeted"}, {"channel":"site"}]

actions    [{"do":"reply","text":"…"},
            {"do":"tag","tag":"sites-lead"},
            {"do":"handoff"},
            {"do":"close"}]
```

Flows run in `ordinal` order; the first one that matches with `stop`
set wins. Every flow considered is written to `inbox_flow_runs` with the
reason it did or did not fire, so *"why did it say that"* has an answer —
and so does *"why did it say nothing"*, which is asked just as often.

### Two decisions worth knowing about

**Keywords match on word boundaries, not substrings.** `music` does not
fire inside `musicology`, and `cost` does not fire inside `Costa Rica`. A
bot that answers a question nobody asked is worse than one that stays
quiet.

**A human always wins.** Once somebody claims a conversation, the bot is
silent in it — and that is not a condition a flow can opt out of, because
there is no way to express opting out. If it were configurable it would
eventually be configured, and then somebody mid-sentence with Matthew
gets an autoresponder on top of him.

### The four seeded flows

Greet a first-time visitor · point at the album · Sites leads (tagged and
handed to a person) · anything about money (handed straight to a person,
because a bot quoting a price wrong is a bot costing money).

**There is deliberately no "thank you for following" flow.** No platform
of the four gives us a follower event, so seeding a rule that can never
fire would be a promise the schema cannot keep. `docs/social-connections.md`
has the detail.

---

## Channels

`inbox_channels` holds what each door is *allowed* to do, and the engine
checks it before anything is sent:

| key | on? | comments | DM | note |
| --- | --- | --- | --- | --- |
| `site` | **yes** | – | yes | needs nobody's permission; works today |
| `instagram` | no | yes | 24h window | needs business verification + app review |
| `threads` | no | yes | **never** | there is no Threads DM API |
| `x` | no | yes | yes | pay-per-use; a DM costs money |
| `linkedin` | no | no | no | partner-only, and automation is what the rule forbids |

`can_send_dm=false` on Threads is a fact about the platform, not a
setting waiting to be flipped.

The window check matters more than it looks. Instagram returns **success**
for a DM sent after its 24-hour window and the person never sees it — so
"we sent it" is not evidence it arrived. Refusing in the engine means the
desk shows a real failure instead of a false success.

---

## Adding a channel later

1. Get the platform's approval (that is the long part, and it is yours to
   do — it is tied to your identity).
2. `supabase secrets set …` for the tokens. Never in the repo: everything
   under the web root is public, and a Meta token in a public file is
   somebody else's account by the afternoon.
3. Write the adapter — one function that takes an outbound message and
   pushes it to that platform, and one that turns an inbound webhook
   payload into a contact + conversation + message.
4. Flip `enabled` on the channel row.

The webhook receiver, the signature check, the replay guard, the flow
engine, the inbox and the audit trail are already there and do not change.

---

## What is not built yet

Honest list, so nothing here reads as further along than it is:

- **The staff inbox room.** The schema, the view (`inbox_threads`) and the
  RLS are done; there is no page yet that renders them. Today you read the
  inbox in the Supabase table editor.
- **Channel adapters.** The webhook receiver verifies signatures and
  acknowledges Meta fast — it does not yet turn a payload into a
  conversation, because no channel is approved to send us one.
- **Outbound send.** On `site` the reply *is* the response body, so a
  written row is a delivered message. On a real channel that row would be
  queued work, and the adapter that drains the queue does not exist.
