/* WHO YOU ARE AND WHAT YOU MAY OPEN — resolved on the server, once.

   Every backend room on this site had been answering that question for
   itself, and answering it differently. studio.html read
   localStorage.mcc_org_id and broke when it was unset. crm.html compared
   a browser-held email string against the owner's address. admin.html
   assumed the house org because the house is the only tenant today.
   Three rooms, three answers, none of them checkable by the server.

   The consequence is not only that it is brittle. It is that there is no
   clone contract: a second tenant cannot be handed the same pages,
   because the pages do not take a tenant as input — they each hardcode
   the fact that there is exactly one.

   So the workspace becomes a server fact. The caller presents its bearer
   token and nothing else. What comes back is the list of orgs that token
   is actually a member of, the role it holds in each, and one default
   selection — computed here so every room picks the same one instead of
   each inventing a rule.

   A CLIENT CAN STILL NAME AN ORG, and should: a person in two workspaces
   has to be able to switch. What it can no longer do is assert one it
   does not belong to. The selection is checked against this list on every
   privileged route, which is why the membership check stays where the
   write happens and is not replaced by this call. This endpoint tells a
   page what to put in its switcher. It is not the authorization. */

const CONTRACT = 'mccluster-workspace/v1';

/* owner may spend and change credentials, staff may read and reply,
   viewer may read. The default lands on the strongest role held, so
   somebody who owns the house and merely views a client's shop opens on
   the house. */
const ROLE_RANK = { owner: 0, staff: 1, viewer: 2 };

/* Within an equal role, the studio is the house itself and is the room
   the owner almost always wants. Slug breaks any remaining tie so the
   answer is stable across calls rather than following row order. */
const KIND_RANK = { studio: 0, business: 1, building: 2 };

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: headers(env) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw Object.assign(new Error('Workspace lookup failed'), { status: res.status, detail: data });
  }
  return data;
}

function rank(row) {
  return [
    ROLE_RANK[row.role] ?? 9,
    KIND_RANK[row.kind] ?? 9,
    String(row.slug || '')
  ];
}

function compare(a, b) {
  const left = rank(a);
  const right = rank(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/* The memberships behind one token, newest schema first: org_members is
   the join, orgs carries the name the switcher shows. A disabled org
   stays in the list — a page that hides it entirely leaves somebody
   wondering where their workspace went — but it can never be the
   default, because opening straight into a switched-off tenant is a
   worse first screen than the switcher. */
export async function resolveWorkspaces(env, user) {
  const profileId = String(user?.id || '');
  if (!profileId) throw Object.assign(new Error('Not signed in'), { status: 401 });

  const rows = await db(
    env,
    `org_members?profile_id=eq.${encodeURIComponent(profileId)}` +
      '&select=role,added_at,orgs(id,slug,name,kind,enabled)'
  );

  const workspaces = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.orgs?.id)
    .map((row) => ({
      org_id: row.orgs.id,
      slug: row.orgs.slug,
      name: row.orgs.name,
      kind: row.orgs.kind,
      enabled: row.orgs.enabled !== false,
      role: row.role,
      added_at: row.added_at || null
    }))
    .sort(compare);

  const fallback = workspaces.find((row) => row.enabled) || null;

  return {
    ok: true,
    contract: CONTRACT,
    profile: { id: profileId, email: user?.email || null },
    workspaces,
    default_org_id: fallback ? fallback.org_id : null,
    resolved_at: new Date().toISOString()
  };
}

/* The membership check every privileged route still owes its own write.
   Kept here so "is this caller in this org, and as what" has exactly one
   implementation to audit, rather than one per module. */
export async function requireMembership(env, user, orgId) {
  const wanted = String(orgId || '').trim();
  if (!wanted) throw Object.assign(new Error('org_id is required'), { status: 400 });

  const resolved = await resolveWorkspaces(env, user);
  const match = resolved.workspaces.find((row) => row.org_id === wanted);
  if (!match) {
    throw Object.assign(new Error('You are not a member of that organization'), { status: 403 });
  }
  if (!match.enabled) {
    throw Object.assign(new Error('That organization is switched off'), { status: 403 });
  }
  return match;
}
