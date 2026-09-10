const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/* One strict pattern per platform that has a publisher, and nothing else.
   The point of this allowlist is that a wrong — or tampered — org_channels
   row cannot aim a publisher at some other secret in the Worker's
   environment, so widening it for Facebook and Threads means adding their
   own narrow patterns, never relaxing Instagram's. A platform absent from
   this map has no binding at all, which is what keeps the eight channels
   that are registry-only from resolving a credential. */
const CREDENTIAL_ENV_RE = {
  instagram: /^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$/,
  facebook: /^SOCIAL_FB_[A-Z0-9_]+_ACCESS_TOKEN$/,
  threads: /^SOCIAL_TH_[A-Z0-9_]+_ACCESS_TOKEN$/
};

function envPatternFor(platform) {
  return CREDENTIAL_ENV_RE[String(platform || '').toLowerCase()] || null;
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function requireOrgId(value) {
  const orgId = String(value || '').trim();
  if (!orgId) throw httpError('org_id is required for tenant-scoped operations', 400);
  if (!UUID_RE.test(orgId)) throw httpError('org_id must be a UUID', 400);
  return orgId;
}

export function requireOrgRole(membership, allowedRoles = ['owner']) {
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw httpError(`Social operation requires role: ${allowedRoles.join(' or ')}`, 403);
  }
  return membership;
}

export function parseSocialCredentialRef(platform, ref) {
  if (!ref) return null;
  const pattern = envPatternFor(platform);
  if (!pattern) return null;

  const value = String(ref).trim();
  if (value.startsWith('vault:')) {
    const id = value.slice('vault:'.length);
    return UUID_RE.test(id) ? { kind: 'vault', id } : null;
  }

  const name = value.startsWith('env:') ? value.slice('env:'.length) : value;
  if (!pattern.test(name)) return null;
  return { kind: 'env', name };
}

export function credentialRefForConfiguredChannel(platform, channel) {
  if (!channel) return null;
  const name = String(platform || '').toLowerCase();
  if (!envPatternFor(name)) return null;
  if (channel.secret_id) return `vault:${channel.secret_id}`;
  if (channel.token_env) {
    const ref = `env:${channel.token_env}`;
    if (!parseSocialCredentialRef(name, ref)) {
      throw httpError(`Configured ${name} credential binding is not allowlisted`, 500);
    }
    return ref;
  }
  return null;
}
