-- FIVE MORE DOORS
--
-- The four Meta-adjacent channels in 0021 all share one problem: none of
-- them works until somebody at Meta or X approves something. This adds the
-- ones that do not, and is honest about the ones that still cannot do what
-- you would want them to.
--
-- The capability columns are FACTS, not preferences. can_send_dm = false
-- on Discord is not a setting somebody forgot to turn on; it is what the
-- platform permits from a stateless HTTPS handler, and no amount of
-- configuring changes it. askFor() reads these and returns a refusal
-- naming the reason, which is why a wrong flow cannot make a wrong call.

insert into public.inbox_channels
  (key, label, enabled, can_read_comments, can_reply_comments, can_send_dm, dm_window_hours, note)
values
  ('telegram', 'Telegram', false, true, true, true, null,
   'The one that works this afternoon. A token from @BotFather, no review, no fees, no messaging window, and a rate limit nobody in this building will reach. A private chat is a DM; a group or channel post is treated as a public comment so the shorter reply rules apply. Deliveries are authenticated by the secret_token you set with setWebhook, echoed in X-Telegram-Bot-Api-Secret-Token.'),

  ('whatsapp', 'WhatsApp', false, false, false, true, 24,
   'Cloud API. Same signed envelope as the other Meta webhooks, a different value schema, and the phone_number_id you send FROM goes in the URL — set it as the credential''s account_id. There are no public comments on WhatsApp, so both comment columns are false as a matter of fact. Outside the 24h window only a pre-approved template may be sent, and templates are not wired here: a reply outside the window is refused rather than quietly dropped.'),

  ('slack', 'Slack', false, true, true, true, null,
   'Events API in, chat.postMessage out. A DM is channel_type=im; anything else is public and treated as a comment. Two things bite: Slack answers 200 with {ok:false} on failure, which is recorded as failed here rather than as sent, and a bot that answers its own messages is an infinite loop, so bot_id and subtype messages are dropped before anything else happens.'),

  ('bluesky', 'Bluesky', false, true, false, true, null,
   'Nothing pushes. No webhooks exist, so the desk (or a cron) polls chat.bsky.convo.listConvos and app.bsky.notification.listNotifications, and idempotency comes from external_id exactly as it does for a webhook. The credential is a handle and an app password WITH direct-message access granted, exchanged for a session that expires in about two hours. Replying to a post needs the parent''s cid as well as its uri, which the poll does not carry, so can_reply_comments is false until that is wired.'),

  ('discord', 'Discord', false, false, false, false, null,
   'Off by fact, not by choice. Reading message content requires a gateway websocket held open, which an edge function cannot do, and DMing a user requires opening a channel first and then listening on that same gateway. Discord can be posted TO from here; it cannot be listened to. Wire a small always-on process if you want Discord properly.')
on conflict (key) do nothing;

-- Which secret holds each token. Never the token.
insert into public.inbox_credentials (channel, token_env, account_label)
values
  ('telegram', 'TELEGRAM_TOKEN', 'BotFather bot'),
  ('whatsapp', 'WA_TOKEN',       'WhatsApp Cloud number'),
  ('slack',    'SLACK_BOT_TOKEN','Slack bot user'),
  ('bluesky',  'BSKY_APP_PASSWORD', 'Bluesky app password')
on conflict (channel) do nothing;

-- Bluesky's account_id is its PDS host, not a secret and not an account
-- number. askFor() falls back to bsky.social when it is null, so this is
-- only needed by somebody self-hosting a PDS.
comment on column public.inbox_credentials.account_id is
  'The non-secret half of a credential: a WhatsApp phone_number_id, a Bluesky PDS host, a Page id. Some sends cannot be built without it. Never a token.';
