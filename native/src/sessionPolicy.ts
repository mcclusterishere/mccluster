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
  /** When the access token stops being usable, on this device's clock (stampExpiry). */
  expires_at: number;
  /** The auth server's own expires_at, on its clock: kept, never compared with Date.now(). */
  server_expires_at?: number;
  token_type?: string;
  user?: StoredUser | null;
};

/** A session whose expiry has been stamped (stampExpiry). */
export type Stamped<T> = Omit<T, 'expires_in' | 'expires_at' | 'server_expires_at'> & {
  expires_at: number;
  server_expires_at?: number;
};

/**
 * ONE CLOCK FOR "IS THIS SESSION FRESH?" (the rule js/mcc-auth.js stampExpiry
 * follows on the web)
 *
 * isFresh compares a session's expires_at with Date.now(), this device's
 * clock. The expires_at Supabase Auth sends is a time on the auth server's
 * clock. Kept as sent, the comparison held only while the two clocks agreed: on
 * a phone an hour ahead, with one-hour tokens, every token was stale the moment
 * it arrived and every call refreshed; on one an hour behind, tokens the server
 * had already expired were still sent, and launch read the server's refusal
 * (bad_jwt) as a dead session and signed the member out.
 *
 * expires_in is a duration, and a duration needs no shared clock. So the
 * expires_at kept here is on this device's clock, measured when the answer
 * arrives: now + expires_in. The answer lands a moment after the token was
 * issued, so the stamp runs late by at most one request's flight, well inside
 * isFresh's one-minute margin. The server's own expires_at is kept beside it as
 * server_expires_at. An answer without expires_in keeps a server expires_at as
 * it was, and one with neither is given an hour, as before.
 *
 * expires_in counts from the moment the server answered, so it is spent once
 * stamped: the stamped session no longer carries it, and stamping that session
 * again, an hour or a week later, changes nothing. A session read back from the
 * keychain never had it. The answer passed in is not changed. Nothing changes
 * at the server, which still refuses an expired token.
 */
export function stampExpiry<T extends { expires_in?: unknown; expires_at?: unknown; server_expires_at?: unknown }>(
  answer: T,
  nowSeconds = Date.now() / 1000,
): Stamped<T> {
  const { expires_in, expires_at, server_expires_at, ...rest } = answer;
  const now = Math.floor(nowSeconds);
  const life = Number(expires_in);
  const at = Number(expires_at);
  if (life > 0) return { ...rest, expires_at: now + life, ...(at > 0 ? { server_expires_at: at } : {}) };
  const server = Number(server_expires_at);
  return { ...rest, expires_at: at > 0 ? at : now + 3600, ...(server > 0 ? { server_expires_at: server } : {}) };
}

/**
 * What goes into the keychain: the tokens, their expiry, and the user's id
 * and email. The full auth user (identities, metadata) is left out: it can
 * exceed what some iOS keychains accept (about 2 KB), and it is re-read from
 * /auth/v1/user on launch anyway. The id and email keep the signed-in member
 * usable offline.
 *
 * The expiry follows stampExpiry: an answer straight from the auth server is
 * stamped now, and a session already stamped keeps its expiry. Both clocks are
 * kept: expires_at (this device's), which isFresh reads, and server_expires_at
 * (the server's), which nothing compares with Date.now(). The second costs
 * about 30 bytes and says, of a stored session, that its expires_at was
 * measured here: an earlier build stored the server's expires_at alone.
 */
export function persistableSession(session: any, nowSeconds = Date.now() / 1000): StoredSession | null {
  if (!session || typeof session !== 'object' || !session.access_token || !session.refresh_token) return null;
  const { expires_at, server_expires_at } = stampExpiry(session, nowSeconds);
  const user = session.user && typeof session.user === 'object' && session.user.id
    ? { id: String(session.user.id), email: session.user.email ? String(session.user.email) : null }
    : null;
  return {
    access_token: String(session.access_token),
    refresh_token: String(session.refresh_token),
    expires_at,
    ...(server_expires_at ? { server_expires_at } : {}),
    ...(session.token_type ? { token_type: String(session.token_type) } : {}),
    user,
  };
}

/**
 * A session read back from the keychain, as it was stored. Its expiry was
 * stamped on this device's clock when its answer arrived, and it is never
 * stamped again: one with no usable expires_at is stale (isFresh), so it is
 * refreshed before its token is used rather than given a new hour.
 *
 * One without server_expires_at was stored by an earlier build, which kept the
 * server's expires_at as sent: a time on a clock this device cannot read. Its
 * expiry is treated as unknown, so it reads as stale and its first use (at
 * launch, when online) refreshes it, once: the answer is stamped and stored the
 * new way. Read as it was, on a device behind the server it would keep sending
 * a token the server had expired, and launch would take the server's bad_jwt
 * for a dead session and sign the member out. The cost is one refresh per
 * signed-in install, on the first launch after the update. What was stored is
 * not changed until that refresh answers.
 */
export function restoredSession<T extends { access_token?: unknown; server_expires_at?: unknown }>(
  stored: T | null | undefined,
): T | null {
  if (!stored || typeof stored !== 'object' || !stored.access_token) return null;
  return Number(stored.server_expires_at) > 0 ? stored : { ...stored, expires_at: 0 };
}

/**
 * Auth error codes that mean the session itself is gone, or its member is: no
 * refresh brings it back. Supabase Auth names the condition in `error_code`
 * (older servers: `error`), and its spec warns that the HTTP status for one
 * condition can vary (400 and 422 are used interchangeably), so the code is
 * checked first. The web clears a session on the same six (js/mcc-auth.js
 * refresh); invalid_grant is what older servers sent for a dead refresh token.
 */
const DEAD_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
  'invalid_grant',
]);

/**
 * Auth error codes that refuse only the access token presented: unreadable or
 * expired by the auth server's clock (bad_jwt), or not sent (no_authorization).
 * They say nothing about the session the token belongs to.
 */
const REFUSED_TOKEN_CODES = new Set(['bad_jwt', 'no_authorization']);

function authErrorCode(error: any): string {
  const data = error && typeof error.data === 'object' ? error.data : null;
  return String(
    (data && (data.error_code || (typeof data.code === 'string' ? data.code : '') || data.error)) || '',
  ).toLowerCase();
}

/**
 * Whether a failed refresh or user read is a definitive answer from the auth
 * server: a dead session or refused token error code, or failing that an
 * answer of 400, 401, 403, 404 or 422. Being offline, a timeout, a 5xx or a
 * 429 says nothing about the session, so the member stays signed in and the
 * next request tries again.
 *
 * A refused refresh means the session is dead. A refused user read may mean
 * only that its access token is: ask isAccessTokenRefusal first.
 */
export function isDefinitiveAuthFailure(error: any): boolean {
  const code = authErrorCode(error);
  if (DEAD_SESSION_CODES.has(code) || REFUSED_TOKEN_CODES.has(code)) return true;
  const status = Number(error && error.status);
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

/**
 * Whether the auth server refused only the access token presented, not its
 * session: bad_jwt or no_authorization, or a 401 or 403 that names no dead
 * session code.
 *
 * Supabase Auth answers a token that has expired by its clock with 403
 * bad_jwt, and the session can still be good: its refresh token does not
 * expire with the access token. With both clocks the phone's (stampExpiry) a
 * live session does not meet that answer, but a phone whose clock was set back
 * after the token arrived does: the token still reads as fresh here. So such an
 * answer never ends the session by itself. The session is refreshed once and
 * the request made again; a refused refresh, or an answer that names the
 * session or the member as gone, is what ends it.
 */
export function isAccessTokenRefusal(error: any): boolean {
  const code = authErrorCode(error);
  if (REFUSED_TOKEN_CODES.has(code)) return true;
  if (DEAD_SESSION_CODES.has(code)) return false;
  const status = Number(error && error.status);
  return status === 401 || status === 403;
}

/**
 * Thrown to a request whose session was replaced while it waited (signed out,
 * or signed in as someone else). An action started under one account must
 * never continue under another. It carries no HTTP status: nothing reached
 * the server.
 */
export function sessionChangedError(): Error {
  return Object.assign(new Error('Your account changed while this was loading. Try again.'), {
    code: 'session_changed',
  });
}

/**
 * A session that will still be valid for at least another minute: its
 * expires_at and now both read on this device's clock (stampExpiry).
 */
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
