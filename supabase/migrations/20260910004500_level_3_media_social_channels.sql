-- ============================================================
-- LEVEL 3 MEDIA — the social channel registry for this client.
--
-- Control-plane law: "Client social is a McCluster service. Every client
-- backend gets accounts, campaigns, and a queue on the plane." JNH
-- Elevate and McCluster each have their eleven org_channels rows. Level
-- 3 had none, so the Worker had nothing to resolve a credential against
-- and the studio desk had nothing to show. This is that row set.
--
-- Every channel lands DISABLED except `site`, and every token_env names
-- a variable that does not exist yet. That is deliberate and is not a
-- placeholder to tidy later: a channel row says "this is where this
-- client's credential WILL live", and enabling one before the token
-- exists would make the publish queue fail against a real account
-- instead of refusing cleanly here.
--
-- What this does NOT do is give Level 3 a general posting scheduler.
-- The queue the Worker implements today is Instagram trial/reel video
-- (see workers/mccluster/src/social/router.js → queuePublish). The other
-- ten rows are registry, honestly labelled as such on his desk.
-- ============================================================

insert into public.org_channels (org_id, channel, enabled, token_env, account_label)
select o.id, c.channel, c.enabled, c.token_env, c.account_label
from public.orgs o
cross join (values
  ('instagram', false, 'L3_META_PAGE_TOKEN',     'the Instagram professional account, through its linked Page'),
  ('facebook',  false, 'L3_META_PAGE_TOKEN',     'the Facebook Page'),
  ('threads',   false, 'L3_THREADS_TOKEN',       'the Threads profile'),
  ('x',         false, 'L3_X_BEARER_TOKEN',      'the X account'),
  ('bluesky',   false, 'L3_BSKY_APP_PASSWORD',   'Bluesky app password'),
  ('linkedin',  false, 'L3_LINKEDIN_TOKEN',      'unused: automated sending is not permitted'),
  ('slack',     false, 'L3_SLACK_BOT_TOKEN',     'Slack bot user'),
  ('telegram',  false, 'L3_TELEGRAM_TOKEN',      'BotFather bot'),
  ('discord',   false, 'L3_DISCORD_TOKEN',       null),
  ('whatsapp',  false, 'L3_WA_TOKEN',            'WhatsApp Cloud number'),
  ('site',      true,  null,                     null)
) as c(channel, enabled, token_env, account_label)
where o.slug = 'level-3-media'
on conflict (org_id, channel) do update set
  token_env = excluded.token_env,
  account_label = excluded.account_label,
  updated_at = now();
