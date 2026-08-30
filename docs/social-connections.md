# Connecting the socials: what each platform will actually let you do

Written 2026-08-19, against the live developer documentation for each
platform. Every claim below was checked, not remembered. Where a thing is
impossible, it says so plainly rather than leaving you to discover it
after building against it.

---

## The short version

You asked for two behaviours: **reply to comments**, and **DM everyone
who follows me with a thank-you and a link to the music page**.

The first is buildable. The second mostly is not, and not because of
anything in this repo.

| Platform | Read comments | Reply to comments | Send a DM | Know when someone follows you |
| --- | --- | --- | --- | --- |
| **Instagram** | yes, webhook | yes | yes, but only *inside a 24-hour reply window* | **no such event exists** |
| **Threads** | yes, webhook | yes | **no DM API at all** | no |
| **X / Twitter** | yes | yes | yes, **$0.015 per DM** | only by polling your follower list |
| **LinkedIn** | org pages only, partner approval | org pages only | **partner-only, and automation is prohibited** | no |

---

## Why the auto-DM-on-follow does not work

### Instagram: there is no follow event

Instagram's webhook fields are `comments`, `live_comments`, `mentions`,
`messages`, `message_echoes`, `message_reactions`, `messaging_handover`,
`messaging_optins`, `messaging_postbacks`, `messaging_referral`,
`messaging_seen`, `story_insights`, `response_feedback`, `standby` and
`messaging_policy_enforcement`.

**There is no field for a new follower.** Nothing fires when someone
follows you. And the Graph API will not hand you your follower *list*
either — only `followers_count`, a number — so you cannot poll and diff
your way around it the way you can on X.

There is also a second wall behind the first. Instagram only lets you
send a message to someone inside a **24-hour window that opens when they
message you**. A person who follows you and says nothing has not opened
that window, so even with a follow event you would have nobody you were
allowed to message.

And the third: sending unsolicited promotional DMs in bulk is against
Meta's Platform Terms. Accounts that do it get messaging permissions
pulled. This is the part I'd push back on even if it were technically
possible — a thank-you DM with a link, sent automatically to everyone who
follows, reads as a bot to the people most likely to have followed you
because they liked something specific you made.

### Threads: no direct messages, full stop

The Threads API covers publishing, retrieving posts, **reply
moderation**, insights and webhooks. There is no messaging product. You
cannot send a Threads DM from an API because the endpoint does not exist.

### LinkedIn: allowed only if a human presses send

LinkedIn's Messages API is restricted to approved partners, and even for
them it only supports member-to-member messages to **first-degree
connections** or replies inside an existing thread. LinkedIn requires
that every message tie to *a specific, non-automated member action*, and
that the member can **edit any pre-prepared draft before it sends**.

An automated thank-you to new followers fails all three tests. It is not
a rate limit to engineer around; it is the thing the rule forbids.

### X: the one that can work, at a price

X replaced its tiered plans with pay-per-use on 6 February 2026. New
developers cannot sign up for Basic or Pro at all — it is pay-per-use or
nothing, and **a DM send costs $0.015**.

X will let you read your own follower list, so a poll-and-diff job can
detect new followers without a webhook. That makes X the only one of the
four where "thank you for following" is actually achievable end to end.

At 100 new followers a month that is $1.50. Worth knowing before it is
switched on, and worth a cap in the config either way.

---

## What IS worth building, and what it needs from you

### 1. Comment replies on Instagram and Threads — real, and the best of it

This is the version of what you asked for that works, and it is arguably
the more valuable half: someone comments on a post, you answer, fast,
every time, without sitting in the app.

**Instagram needs, from you:**

1. An Instagram **professional** account (Business or Creator) — a
   personal account cannot use the API.
2. A Facebook Page linked to it.
3. A Meta app at `developers.facebook.com`, with the Instagram product
   added.
4. **Business verification** on the Meta account.
5. **App review** for `instagram_manage_comments` (to reply) and
   `instagram_manage_messages` (to answer DMs people send you).
6. A long-lived access token, and the webhook pointed at the receiver in
   this repo with the verify token you choose.

App review is the slow part — expect it to take days to weeks, and expect
to record a screencast showing what the integration does. It cannot be
rushed and I cannot do it for you; it is tied to your identity and your
business.

**Threads needs** its own app permissions (`threads_basic`,
`threads_manage_replies`) and its own webhook subscription, but no
business verification.

### 2. The chat on your own site — works today, needs nobody's permission

The one channel nobody gates is your own website. A visitor opens the
chat on the music page, it answers, and the conversation lands in the
same inbox as everything else. No app review, no tokens, no monthly fee.

That is what got built first, on purpose: it is the only channel that can
be finished today, and it is the one where the person is already on your
site and already interested.

### 3. Everything through one inbox

Whatever a channel is allowed to do, it does through the same schema:
one contact, one conversation, one thread of messages, whichever platform
it came in on. Adding a channel later is adding an adapter, not rebuilding
the engine.

---

## What you have to do yourself, in order

Nothing below can be done from inside this repo, because all of it is
tied to your identity.

1. **Switch Instagram to a professional account** if it is not already,
   and link it to a Facebook Page.
2. **Create the Meta app** and add the Instagram product.
3. **Start business verification** — it is the longest pole; start it
   before you need it.
4. **Submit for app review** for comments first. Messages can follow.
5. **Threads app permissions** — separate, faster.
6. **Decide about X.** It costs real money per message now. If the
   follower thank-you matters to you, X is the only place it can happen,
   and it is cheap at your volume.
7. **LinkedIn: leave it.** Post there by hand. There is no compliant
   automated path for a personal profile, and the ones being sold to you
   by third-party tools work by driving a logged-in browser session,
   which is against LinkedIn's user agreement and gets accounts
   restricted.

Set the tokens as Supabase function secrets when you have them. Do not
put them in the repo — everything under the web root is public, and a
Meta token in a public file is somebody else's account by the afternoon.

---

## Sources

- [Instagram Platform webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [Threads API](https://developers.facebook.com/docs/threads/)
- [X API pricing in 2026](https://postproxy.dev/blog/x-api-pricing-2026/)
- [LinkedIn Messages API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages)
- [LinkedIn API access and partner approval in 2026](https://www.getphyllo.com/post/linkedin-api-access-in-2026-partner-program-approval-timeline-alternatives)
