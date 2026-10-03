// Web: nothing token-related is written to localStorage, where any injected
// script could read it. The refresh token is an httpOnly cookie set by the
// server (routes/auth.ts) that JavaScript never sees; the 15-minute access
// token is held only in memory. A page reload starts with no access token,
// and the first API call's 401 triggers a cookie refresh (utils/api.ts).

export const REFRESH_VIA_COOKIE = true;

let accessToken: string | null = null;

// Earlier builds kept both tokens in localStorage (AsyncStorage on web) — remove them.
try {
  globalThis.localStorage?.removeItem('@budget/accessToken');
  globalThis.localStorage?.removeItem('@budget/refreshToken');
} catch {
  // Storage blocked (private mode, etc.) — nothing to clean up.
}

export const getAccessToken = async (): Promise<string | null> => accessToken;

/** Always null on web — the refresh token is in an httpOnly cookie the page can't read. */
export const getRefreshToken = async (): Promise<string | null> => null;

export const setTokens = async (nextAccessToken: string, _refreshToken?: string): Promise<void> => {
  accessToken = nextAccessToken;
};

export const clearTokens = async (): Promise<void> => {
  accessToken = null;
};
