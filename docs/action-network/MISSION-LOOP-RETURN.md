# The mission loop: why someone comes back

Owner, 2026-10-20: double down on what exists instead of adding new feature sets.
The audit (ChatGPT's competitive review, checked against this repo) found the
mission loop already works end to end: join, proof, review in Control,
verified, points, receipt, share. People were leaking out at its edges. This is
step 1 of that plan: give people a reason to come back because something real
happened for them. That rules out streak penalties, reward slot machines and
endless autoplay.

## What this adds

| Piece | Where | State |
| --- | --- | --- |
| **A comment is heard.** A new comment on a post alerts the post's author and anyone who commented on that post in the last 14 days. It never alerts the commenter, never crosses a block in either direction, skips anyone who muted the commenter, and alerts at most 20 people. A failed alert never fails the comment. | `notifyComment` in `workers/mccluster/src/platform-api.js` | Live on deploy. No database change: the Worker already writes the comment with the service role. |
| **The alert opens the discussion.** "See the comment →" goes to `mnet.html?view=feed&post=…&comments=1`, which scrolls to the post and opens its discussion. | `js/mnet.js` | Live on deploy. |
| **Next for you.** Once a mission is verified, the Action Record names one open mission the member hasn't taken. It prefers one that shares a skill or field with the work they finished; otherwise it picks the most-joined. Nothing shows when there is nothing new to take. | `nextMission` in `js/mnet.js` | Live on deploy. Uses the open missions the page already loads. |
| **Alerts on this device.** An opt-in "Turn on" in Notifications. The browser asks for permission only after that tap. The five-minute cron pushes what the bell already shows: at most one push per person per 15 minutes, nothing older than 30 minutes, and each alert claimed once. | `workers/mccluster/src/web-push.js`, `sw.js`, `js/mnet.js` | **Off.** See below. |

## Turning device alerts on (owner)

1. Apply `supabase/pending/20261020150000_network_web_push.sql`. It:
   - creates the subscriptions table, readable by the service role only;
   - marks every existing alert as already pushed, so no backlog is sent.

   Rollback: the `.rollback.sql` next to it.
2. Make a P-256 key pair and set these Worker secrets:
   - `WEB_PUSH_VAPID_PUBLIC_KEY`: the 65-byte public point, base64url.
   - `WEB_PUSH_VAPID_PRIVATE_KEY`: the 32-byte private scalar, base64url.
   - Optionally `WEB_PUSH_CONTACT`: a `mailto:` or `https:` address the push services can reach.

   Any Web Push library prints such a pair, for example `npx web-push generate-vapid-keys`.
3. Set `WEB_PUSH_ENABLED = "true"` in `workers/mccluster/wrangler.toml`.

On an iPhone, web push works only after the site is added to the Home Screen
(iOS 16.4 or later). Elsewhere the row stays hidden wherever the browser can't
take push.

### Safety

The Worker posts only to browser push services:
- Google FCM
- Mozilla
- Apple
- Windows

It never posts to an address a page supplies. Payloads are encrypted to that
one browser (RFC 8291) and signed for this server (RFC 8292). A device the
push service reports as gone (404 or 410) is deleted, and so is a device that
has failed ten times in a row.

## What to watch

These measure whether the loop pays off. Read them before building more:

- time from a post to its first comment;
- for missions: joined → proof submitted → verified, and how long review takes;
- a second mission within 14 days of the first verification;
- 7-day return, per World tab;
- `push_on`, `push_off` and `alert_open` (a comment alert that opened its discussion) events.
