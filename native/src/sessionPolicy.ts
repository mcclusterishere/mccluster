/**
 * The rules the native M Account follows for its stored session.
 *
 * Pure functions with no React or native modules, so they run under plain
 * Node and are tested by behaviour (scripts/test/native-action-network.test.mjs).
 */

export type StoredUser = { id: string; email?: string | null };

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
  user?: StoredUser | null;
};

/**
 * What goes into the keychain: the tokens, their expiry, and the user's id
 * and email. The full auth user (identities, metadata) is left out: it can
 * exceed what some iOS keychains accept (about 2 KB), and it is re-read from
 * /auth/v1/user on launch anyway. The id and email keep the signed-in member
 * usable offline.
 */
export function persistableSession(session: any): StoredSession | null {
  if (!session || typeof session !== 'object' || !session.access_token || !session.refresh_token) return null;
  const expiresAt = Number(session.expires_at) || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  const user = session.user && typeof session.user === 'object' && session.user.id
    ? { id: String(session.user.id), email: session.user.email ? String(session.user.email) : null }
    : null;
  return {
    access_token: String(session.access_token),
    refresh_token: String(session.refresh_token),
    expires_at: expiresAt,
    ...(session.token_type ? { token_type: String(session.token_type) } : {}),
    user,
  };
}

/**
 * Whether a failed refresh or user read means the session is dead. Only an
 * answer from the auth server saying so counts: 400 (invalid or reused
 * refresh token), 401/403 (rejected token) or 404 (the user no longer
 * exists). Being offline, a timeout, a 5xx or a 429 says nothing about the
 * session, so the member stays signed in and the next request tries again.
 */
export function isDefinitiveAuthFailure(error: any): boolean {
  const status = Number(error && error.status);
  return status === 400 || status === 401 || status === 403 || status === 404;
}

/** A session that will still be valid for at least another minute. */
export function isFresh(session: { expires_at?: number } | null | undefined, nowSeconds = Date.now() / 1000): boolean {
  return !!session && !!session.expires_at && session.expires_at > nowSeconds + 60;
}

/**
 * One call in flight at a time. Supabase refresh tokens are single-use, so
 * requests that all find the token about to expire must share one refresh
 * rather than each spend the same refresh token.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) {
      inflight = fn().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}
