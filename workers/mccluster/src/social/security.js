const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTAGRAM_ENV_RE = /^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$/;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function requireOrgId(value) {
  const orgId = String(value || '').trim();
  if (!orgId) throw httpError('org_id is required for social operations', 400);
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
  if (String(platform || '').toLowerCase() !== 'instagram') return null;

  const value = String(ref).trim();
  if (value.startsWith('vault:')) {
    const id = value.slice('vault:'.length);
    return UUID_RE.test(id) ? { kind: 'vault', id } : null;
  }

  const name = value.startsWith('env:') ? value.slice('env:'.length) : value;
  if (!INSTAGRAM_ENV_RE.test(name)) return null;
  return { kind: 'env', name };
}

export function credentialRefForConfiguredChannel(platform, channel) {
  if (!channel) return null;
  if (String(platform || '').toLowerCase() !== 'instagram') return null;
  if (channel.secret_id) return `vault:${channel.secret_id}`;
  if (channel.token_env) {
    const ref = `env:${channel.token_env}`;
    if (!parseSocialCredentialRef(platform, ref)) {
      throw httpError('Configured Instagram credential binding is not allowlisted', 500);
    }
    return ref;
  }
  return null;
}
