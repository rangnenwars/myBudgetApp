import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, apiErrorMessage, registerSessionExpiredHandler } from '../utils/api';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../utils/tokenStorage';

export type Tier = 'standard' | 'pro';
export type Role = 'user' | 'admin';

interface SessionUser {
  id: number;
  name: string;
  email: string;
  tier: Tier;
  budgetClass: string | null;
  role: Role;
  isActive: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshBudgetClass: () => Promise<void>;
  setTier: (tier: Tier) => Promise<void>;
  isPro: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<SessionUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    registerSessionExpiredHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [accessToken, refreshToken] = await Promise.all([getAccessToken(), getRefreshToken()]);
        if (!accessToken && !refreshToken) return;
        // If the access token has expired, api.ts's response interceptor
        // transparently refreshes it on this very request — no separate
        // "is my token still valid" check needed here.
        const { data } = await api.get('/auth/me');
        setUser(data);
      } catch {
        // No valid session — stay logged out. Local data never persisted
        // in this build anyway (everything lives server-side now), so
        // there's nothing to preserve here the way the old local-only
        // build's "never delete on logout" rule cared about.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: apiErrorMessage(err, 'Sign in failed.') };
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      const { data } = await api.post('/auth/register', { name: name.trim(), email, password });
      await setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: apiErrorMessage(err, 'Could not create account.') };
    }
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      // Best-effort — even if this fails (offline, server down), the
      // local tokens still get cleared below so the app logs out either way.
      await api.post('/auth/logout', { refreshToken }).catch(() => {});
    }
    await clearTokens();
    setUser(null);
  }, []);

  const refreshBudgetClass = useCallback(async () => {
    if (!userRef.current) return;
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {
      // Transient network error — keep the last-known value rather than clearing it.
    }
  }, []);

  // No payment processor exists in this build (see docs/MASTER_BUILD_PROMPT_v3_BACKEND.md
  // — RevenueCat was never wired up). This is a stand-in so Pro features are
  // actually reachable for testing, not a real purchase flow. The server's
  // PATCH /auth/me/tier endpoint is named accordingly.
  const setTier = useCallback(async (tier: Tier) => {
    if (!userRef.current) return;
    const { data } = await api.patch('/auth/me/tier', { tier });
    setUser(data);
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    register,
    logout,
    refreshBudgetClass,
    setTier,
    isPro: user?.tier === 'pro',
    isAdmin: user?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
