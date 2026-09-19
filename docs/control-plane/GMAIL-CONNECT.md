# Connecting Gmail

The code is finished and deployed. Nothing is connected.

`supabase/functions/eu-google-workspace` has been ACTIVE since 2026-09-09. It
holds a full Gmail reader: `gmail.readonly`, a Pub/Sub `watch` with renewal,
history sync, and normalization of matched threads into `eu_communications`
with stakeholder staging. It has never run against a real mailbox.

The proof is one query:

```sql
select count(*) from public.eu_integrations;   -- 0
```

No integration row means no refresh token, no watch, no history cursor. Zero
messages have ever been ingested.

## Why this one needs you

Every other gap in this system is code. This one is not. Gmail requires an
OAuth consent from the account that owns the mailbox, and that consent can only
be given by the person holding the Google password. There is no way to write
around it, and any code that claimed to would be lying.

## What it needs

Seven values, all read from the edge function's environment:

| variable | where it comes from |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials → OAuth client (Web) |
| `GOOGLE_CLIENT_SECRET` | same client |
| `GOOGLE_REFRESH_TOKEN` | the consent flow below |
| `GMAIL_ACCOUNT_EMAIL` | the mailbox — defaults to `matthew@mccluster.org` |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project>/topics/<topic>` you create |
| `GMAIL_PUBSUB_AUDIENCE` | the push endpoint URL, for verifying pushes |
| `GMAIL_PUBSUB_SERVICE_ACCOUNT` | the service account Google pushes as |
| `EU_GOOGLE_WORKSPACE_SECRET` | generate it yourself; it gates the non-push actions |

## The order

1. **Google Cloud project** — enable the Gmail API and the Pub/Sub API.
2. **OAuth client**, type Web. Add your redirect URI.
3. **Consent**, once, as the mailbox owner, with scope
   `https://www.googleapis.com/auth/gmail.readonly`. Ask for offline access or
   no refresh token comes back. Keep the refresh token; it is the one value
   that cannot be regenerated without doing this again.
4. **Pub/Sub topic**, and grant `gmail-api-push@system.gserviceaccount.com` the
   Publisher role on it — Gmail will not create a watch without that.
5. **Push subscription** pointed at
   `https://<project>.supabase.co/functions/v1/eu-google-workspace/push`.
6. **Set the secrets** on the edge function. Do not put them in the repo and do
   not paste them into a chat.
7. **Start the watch**: call the function with `{"action":"gmail.watch.renew"}`
   and the internal secret. A watch expires in seven days, so this wants a
   schedule — `pg_cron` is already installed and can call it with `pg_net`.

## How to know it worked

```sql
select provider, status, scopes, created_at from public.eu_integrations;
select count(*) from public.eu_communications where provider = 'gmail';
```

An integration row and a rising message count. Until both are true, nothing has
connected, whatever the function's ACTIVE status says.

## What it will not do

The function is scoped `gmail.readonly` — it reads, it never sends. Mail is
classified against initiative and stakeholder state, and unrelated personal
mail is deliberately left alone rather than pulled into the Policy OS. Widening
that is a separate decision, not a config change.
