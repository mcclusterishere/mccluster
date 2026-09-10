-- ============================================================
-- Name Level 3's Instagram credential the only way the Worker will
-- accept it.
--
-- workers/mccluster/src/social/security.js allowlists credential
-- bindings against /^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$/ before it will
-- read an env var — so that a wrong or tampered channel row cannot point
-- the publisher at some other secret in the Worker's environment. Good
-- rule. But no org_channels row on this plane has ever satisfied it:
--
--   mccluster    -> META_PAGE_TOKEN
--   jnh-elevate  -> JNH_META_PAGE_TOKEN
--   level-3-media-> L3_META_PAGE_TOKEN   (mirrored from the two above)
--
-- All three throw "Configured Instagram credential binding is not
-- allowlisted" the moment anyone tries to publish. Nothing has published
-- yet, so nothing has failed loudly; the first real attempt would have.
--
-- This fixes Level 3, whose row this task added. The other two orgs are
-- the owner's to rename — they are named here so the next person reading
-- this knows it was seen and left deliberately, not missed.
--
-- Only the Instagram binding is allowlist-checked today; the other ten
-- channels keep descriptive names until each grows a publisher and its
-- own binding rule.
-- ============================================================

update public.org_channels c
set token_env = 'SOCIAL_IG_LEVEL3_ACCESS_TOKEN', updated_at = now()
from public.orgs o
where o.id = c.org_id and o.slug = 'level-3-media' and c.channel = 'instagram';
