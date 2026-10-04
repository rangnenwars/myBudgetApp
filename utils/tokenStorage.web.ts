// Web: nothing token-related is written to localStorage, where any injected
// script could read it. The refresh token is an httpOnly cookie set by the
// server (routes/auth.ts) that JavaScript never sees; the 15-minute access
// token is held only in memory. A page reload starts with no access token,
// and the first API call's 401 triggers a cookie refresh (utils/api.ts).
//
// The one thing kept in localStorage is a yes/no "this browser had a
// session" hint (no token, nothing secret). It lets a signed-out visitor skip
// the startup /auth/me + /auth/refresh round trip, which can only 401.

export const REFRESH_VIA_COOKIE = true;

let accessToken: string | null = null;

// Earlier builds kept both tokens in localStorage (AsyncStorage on web) — remove them.
try {
  globalThis.localStorage?.removeItem('@budget/accessToken');
  globalThis.localStorage?.removeItem('@budget/refreshToken');
} catch {
  // Storage blocked (private mode, etc.) — nothing to clean up.
}

const SESSION_HINT_KEY = 'prapanji/session';

const writeHint = (value: '1' | '0') => {
  try {
    globalThis.localStorage?.setItem(SESSION_HINT_KEY, value);
  } catch {
    // Storage blocked — the app just keeps checking at startup, as before.
  }
};

/**
 * false: this browser signed out (or its last session check failed), so
 * there is no refresh cookie worth trying. true: it was signed in. null:
 * unknown (first visit, or a build from before the hint) — check once.
 */
export const hasSessionHint = (): boolean | null => {
  try {
    const value = globalThis.localStorage?.getItem(SESSION_HINT_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
};

export const getAccessToken = async (): Promise<string | null> => accessToken;

/** Always null on web — the refresh token is in an httpOnly cookie the page can't read. */
export const getRefreshToken = async (): Promise<string | null> => null;

export const setTokens = async (nextAccessToken: string, _refreshToken?: string): Promise<void> => {
  accessToken = nextAccessToken;
  writeHint('1');
};

export const clearTokens = async (): Promise<void> => {
  accessToken = null;
  writeHint('0');
};
