import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Localization from 'expo-localization';
import { api, setAuthToken, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';
import { tokenStore } from './tokenStore';

interface AuthState {
  user: User | null;
  /** True until the stored token has been read — screens must wait, or the app flashes the login screen. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    username: string;
    password: string;
    displayName: string;
    city?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    setAuthToken(null);
    setUser(null);
  }, []);

  // Restore the session on launch. A token can be present but expired, so it is
  // only trusted once /me accepts it.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await tokenStore.get();
        if (!token) return;
        setAuthToken(token);
        const me = await api.me();
        if (!cancelled) setUser(me.user);
      } catch {
        await tokenStore.clear();
        setAuthToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 anywhere drops the session rather than leaving a dead token in place.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const adopt = useCallback((res: { token: string; user: User }) => {
    setAuthToken(res.token);
    setUser(res.user);
    return tokenStore.set(res.token);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => adopt(await api.login({ email, password })),
      signUp: async (input) =>
        adopt(
          await api.register({
            ...input,
            // The streak is counted in the user's own day, so the device's zone
            // is the only sensible default.
            timezone: Localization.getCalendars()[0]?.timeZone ?? 'UTC',
            city: input.city || null,
          }),
        ),
      signOut,
      refresh: async () => {
        const me = await api.me();
        setUser(me.user);
      },
    }),
    [user, loading, adopt, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
