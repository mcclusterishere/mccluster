/**
 * One M Account on device.
 *
 * Native equivalent of js/mcc-auth.js. Supabase auth remains the credential
 * authority; RLS and authenticated RPCs remain the security boundary.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isDefinitiveAuthFailure, isFresh, persistableSession, singleFlight } from './sessionPolicy';

export const SUPABASE_URL = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
export const MCC_API_URL = 'https://api.mccluster.org';

/**
 * Reuse the canonical web surface. Native is another client of the same
 * Action Network, not a second profile/feed/onboarding universe.
 */
export const ACTION_APP_KEY = 'mccluster-web';

const SESSION_KEY = 'mcc.session.v1';

export type MccUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type MccSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: MccUser | null;
};

type JsonInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

type SignUpResult = {
  session: boolean;
  user: MccUser | null;
  confirm: boolean;
  existing: boolean;
};

type MccContextValue = {
  ready: boolean;
  session: MccSession | null;
  user: MccUser | null;
  signIn(email: string, password: string): Promise<MccUser | null>;
  signUp(email: string, password: string, data?: Record<string, unknown>): Promise<SignUpResult>;
  signOut(): Promise<void>;
  refresh(): Promise<MccSession | null>;
  accessToken(): Promise<string>;
  api<T = any>(path: string, init?: JsonInit): Promise<T>;
  rest<T = any>(path: string, init?: JsonInit): Promise<T>;
  rpc<T = any>(name: string, body?: Record<string, unknown>): Promise<T>;
};

const MccContext = createContext<MccContextValue | null>(null);

function normalizeSession(value: any): MccSession | null {
  if (!value || typeof value !== 'object' || !value.access_token) return null;
  const session: MccSession = value;
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  }
  return session;
}

async function storedSession(): Promise<MccSession | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = (globalThis as any).localStorage?.getItem(SESSION_KEY);
      return normalizeSession(raw ? JSON.parse(raw) : null);
    }
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return normalizeSession(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

async function persistSession(session: MccSession | null): Promise<void> {
  if (Platform.OS === 'web') {
    const store = (globalThis as any).localStorage;
    if (!store) return;
    const stored = persistableSession(session);
    if (stored) store.setItem(SESSION_KEY, JSON.stringify(stored));
    else store.removeItem(SESSION_KEY);
    return;
  }
  const stored = persistableSession(session);
  if (stored) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(stored), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

async function responseJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object'
        ? data.message || data.error_description || data.msg || data.error
        : null;
    throw Object.assign(new Error(String(message || 'Request failed')), {
      status: response.status,
      data,
    });
  }
  return data as T;
}

async function authRequest<T = any>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    'content-type': 'application/json',
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return responseJson<T>(
    await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

export function MccProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<MccSession | null>(null);
  const [user, setUser] = useState<MccUser | null>(null);
  const sessionRef = useRef<MccSession | null>(null);

  const commitSession = useCallback(async (next: MccSession | null) => {
    const normalized = normalizeSession(next);
    sessionRef.current = normalized;
    setSession(normalized);
    await persistSession(normalized);
    return normalized;
  }, []);

  /* One refresh at a time (refresh tokens are single-use). Only a definitive
     answer from the auth server ends the session; offline, a timeout or a
     5xx keeps it, and the failure reaches the caller instead. */
  const refresh = useMemo(
    () =>
      singleFlight(async (): Promise<MccSession | null> => {
        const current = sessionRef.current;
        if (!current?.refresh_token) {
          await commitSession(null);
          setUser(null);
          return null;
        }
        try {
          const next = normalizeSession(
            await authRequest<MccSession>('token?grant_type=refresh_token', {
              method: 'POST',
              body: { refresh_token: current.refresh_token },
            }),
          );
          /* signed out (or signed in again) while this was in flight */
          if (sessionRef.current !== current) return sessionRef.current;
          await commitSession(next);
          if (next?.user) setUser(next.user);
          return next;
        } catch (error) {
          if (sessionRef.current !== current) return sessionRef.current;
          if (!isDefinitiveAuthFailure(error)) throw error;
          await commitSession(null);
          setUser(null);
          return null;
        }
      }),
    [commitSession],
  );

  const freshSession = useCallback(async (): Promise<MccSession> => {
    let current = sessionRef.current;
    if (!current) throw Object.assign(new Error('Sign in first.'), { status: 401 });
    if (!isFresh(current)) {
      current = await refresh();
    }
    if (!current?.access_token) throw Object.assign(new Error('Sign in first.'), { status: 401 });
    return current;
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      /* The stored session signs the member in at once, offline included;
         the server is asked afterwards and only a definitive answer ends it. */
      let restored = await storedSession();
      sessionRef.current = restored;
      if (restored) {
        setSession(restored);
        if (restored.user?.id) setUser(restored.user);
      }
      if (restored && !isFresh(restored)) {
        try {
          restored = await refresh();
        } catch {
          /* offline: keep the stored session; the next request refreshes */
        }
      }
      if (restored && isFresh(restored)) {
        try {
          const who = await authRequest<MccUser>('user', { token: restored.access_token });
          if (alive) setUser(who);
        } catch (error) {
          if (alive && isDefinitiveAuthFailure(error)) {
            await commitSession(null);
            setUser(null);
          }
        }
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [commitSession, refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) throw new Error('Email and password are required.');
      const next = normalizeSession(
        await authRequest<MccSession>('token?grant_type=password', {
          method: 'POST',
          body: { email: cleanEmail, password },
        }),
      );
      if (!next) throw new Error('Sign-in failed.');
      await commitSession(next);
      const who = next.user || (await authRequest<MccUser>('user', { token: next.access_token }));
      setUser(who || null);
      return who || null;
    },
    [commitSession],
  );

  const signUp = useCallback(
    async (email: string, password: string, data: Record<string, unknown> = {}) => {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) throw new Error('Email and password are required.');
      if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
      const result: any = await authRequest('signup', {
        method: 'POST',
        body: { email: cleanEmail, password, data },
      });
      const next = normalizeSession(result);
      if (next) {
        await commitSession(next);
        const who = next.user || null;
        setUser(who);
        return { session: true, user: who, confirm: false, existing: false };
      }
      const identities = result?.user?.identities;
      const existing = Array.isArray(identities) && identities.length === 0;
      return {
        session: false,
        user: result?.user || null,
        confirm: !existing,
        existing,
      };
    },
    [commitSession],
  );

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    await commitSession(null);
    setUser(null);
    if (current?.access_token) {
      await authRequest('logout', { method: 'POST', token: current.access_token }).catch(() => null);
    }
  }, [commitSession]);

  const accessToken = useCallback(async () => (await freshSession()).access_token, [freshSession]);

  const api = useCallback(
    async <T,>(path: string, init: JsonInit = {}): Promise<T> => {
      const current = await freshSession();
      return responseJson<T>(
        await fetch(MCC_API_URL + path, {
          method: init.method || 'GET',
          headers: {
            authorization: `Bearer ${current.access_token}`,
            'content-type': 'application/json',
            ...(init.headers || {}),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      );
    },
    [freshSession],
  );

  const rest = useCallback(
    async <T,>(path: string, init: JsonInit = {}): Promise<T> => {
      const current = await freshSession();
      return responseJson<T>(
        await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
          method: init.method || 'GET',
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            authorization: `Bearer ${current.access_token}`,
            'content-type': 'application/json',
            ...(init.headers || {}),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      );
    },
    [freshSession],
  );

  const rpc = useCallback(
    async <T,>(name: string, body: Record<string, unknown> = {}) =>
      rest<T>(`rpc/${name}`, { method: 'POST', body }),
    [rest],
  );

  const value = useMemo<MccContextValue>(
    () => ({ ready, session, user, signIn, signUp, signOut, refresh, accessToken, api, rest, rpc }),
    [ready, session, user, signIn, signUp, signOut, refresh, accessToken, api, rest, rpc],
  );

  return <MccContext.Provider value={value}>{children}</MccContext.Provider>;
}

export function useMcc(): MccContextValue {
  const value = useContext(MccContext);
  if (!value) throw new Error('useMcc must be used inside MccProvider');
  return value;
}
