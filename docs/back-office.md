# THE BACK OFFICE: admin.html

The owner's desk. Everything the house took in, on one screen:
print orders, bookings, the gallery waitlist, the state of every wall,
and the live profit ladder.

    https://matthew.mccluster.org/admin.html

Noindexed and disallowed in robots.txt, so it never shows up in search.

## How you get in

Email + password, straight in. There is also a "email me a sign-in link"
fallback if you'd rather not keep a password.

**One-time setup: create the owner login (2 minutes):**

1. Supabase → your project → **Authentication → Users → Add user**
2. Email: `matthew@mccluster.org` (it must be exactly this; see below)
3. Set a password, and turn **Auto Confirm User ON**
4. Save. That's it. Sign in at admin.html with those details.

## Why it's actually secure

The lock is not the login screen. Hiding a page in the browser protects
nothing; anyone can read the HTML. The real wall is **row-level security
in Postgres** (`docs/crm.sql`):

```sql
create policy leads_desk on public.leads
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');
```

The database itself refuses to hand over a single row unless the signed-in
token carries that exact email. A stranger who opens admin.html, or who
signs up their own account and tries, gets an empty answer from the
server. There is nothing to leak. That is why the email in step 2 has to
match the policy exactly.

If a non-owner account does sign in, the desk detects the refusal, says so,
and signs them straight back out.

## The lanes

| Lane | What it holds |
|---|---|
| **Orders** | Print-shop orders, parsed into a ticket: photo id, format, amount, and the shipping address (or "deliver by email" for files). Reply mails the buyer. |
| **Bookings** | Real enquiries from the lead sheet: the project, the source, the page they came from. |
| **Waitlist** | People who asked to be told when a gallery wall goes live. |
| **The walls** | Every event in `data/gallery.json`: which are live with media, which are still staged, and a link straight to the wall. |
| **The shop** | The price ladder as the buyer sees it, next to lab cost, landed cost, and what you keep on every line. |

The four stat tiles across the top: orders still to fill, total ordered,
new in the last 7 days, and waitlist size.

Marking an order **replied / booked / closed** writes straight back to the
database, so the state follows you to any device.

## What it does NOT do (on purpose)

- **It doesn't edit the walls or prices.** Those live in `data/gallery.json`
  and `data/prints.json` inside the repo, and a static site can't rewrite its
  own files. Those two lanes are read-only mirrors of the live state.
- **It doesn't take payment.** Orders still land as instructions to invoice.
  Arming real card checkout is the Stripe + Prodigi work in
  `docs/print-shop.md`.
