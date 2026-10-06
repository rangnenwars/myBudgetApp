import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, apiErrorMessage, registerSessionExpiredHandler } from '../utils/api';
import type { FeatureKey } from '../constants/features';
import { getAccessToken, getRefreshToken, setTokens, clearTokens, hasSessionHint, REFRESH_VIA_COOKIE } from '../utils/tokenStorage';

export type Tier = 'standard' | 'pro';
export type Role = 'user' | 'admin' | 'support' | 'system_manager';

interface SessionUser {
  id: number;
  name: string;
  email: string;
  /** E.164 (+91XXXXXXXXXX); null for accounts made before sign-up asked for it. */
  phone: string | null;
  tier: Tier;
  budgetClass: string | null;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  /** Optional features staff have switched on for this account (goals, loans, investments). */
  features: FeatureKey[];
}

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (name: string, email: string, phone: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshBudgetClass: () => Promise<void>;
  setTier: (tier: Tier) => Promise<void>;
  /** Re-reads the profile (e.g. after the user confirms their email elsewhere). */
  reloadUser: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Ends every session, this one included. */
  logoutEverywhere: () => Promise<void>;
  /** Permanently deletes the account (password required), then signs out. */
  deleteMyAccount: (password: string) => Promise<void>;
  isPro: boolean;
  isAdmin: boolean;
  /** admin or support — can open the account list (support: activate/deactivate users only). */
  isStaff: boolean;
  /** admin or system_manager — can see aggregate system metrics. */
  canViewMetrics: boolean;
  /** Whether an optional feature is switched on for this account. */
  hasFeature: (key: FeatureKey) => boolean;
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
        // Web can't see its refresh token (httpOnly cookie), so it tries
        // unless this browser is known to be signed out — that skips two
        // guaranteed 401s (/auth/me, /auth/refresh) on every signed-out visit.
        if (!accessToken && !refreshToken && !REFRESH_VIA_COOKIE) return;
        if (REFRESH_VIA_COOKIE && !accessToken && hasSessionHint() === false) return;
        // If the access token has expired, api.ts's response interceptor
        // transparently refreshes it on this very request — no separate
        // "is my token still valid" check needed here.
        const { data } = await api.get('/auth/me');
        setUser(data);
      } catch (err) {
        // The server said "no session": record it so the next visit skips
        // this check. A network failure doesn't count — the session may be fine.
        if ((err as { response?: { status?: number } }).response?.status === 401) await clearTokens().catch(() => {});
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

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    try {
      const { data } = await api.post('/auth/register', { name: name.trim(), email, phone, password });
      await setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: apiErrorMessage(err, 'Could not create account.') };
    }
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken || REFRESH_VIA_COOKIE) {
      // Best-effort — even if this fails (offline, server down), the
      // local tokens still get cleared below so the app logs out either way.
      // On web the body is empty: the server revokes and clears the cookie.
      await api.post('/auth/logout', refreshToken ? { refreshToken } : {}).catch(() => {});
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

  const reloadUser = useCallback(async () => {
    if (!userRef.current) return;
    const { data } = await api.get('/auth/me');
    setUser(data);
  }, []);

  // The server signs out every other device and returns a fresh session for this one.
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { data } = await api.post('/auth/me/password', { currentPassword, newPassword });
    await setTokens(data.accessToken, data.refreshToken);
  }, []);

  const logoutEverywhere = useCallback(async () => {
    await api.post('/auth/me/logout-all').catch(() => {});
    await clearTokens();
    setUser(null);
  }, []);

  // Errors (wrong password, last admin) propagate so the screen can show them.
  const deleteMyAccount = useCallback(async (password: string) => {
    await api.delete('/auth/me', { data: { password } });
    await clearTokens();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    register,
    logout,
    refreshBudgetClass,
    setTier,
    reloadUser,
    changePassword,
    logoutEverywhere,
    deleteMyAccount,
    isPro: user?.tier === 'pro',
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'admin' || user?.role === 'support',
    canViewMetrics: user?.role === 'admin' || user?.role === 'system_manager',
    hasFeature: (key: FeatureKey) => user?.features?.includes(key) ?? false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
