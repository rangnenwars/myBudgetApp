import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenStorage';

// Falls back to localhost for local dev if EXPO_PUBLIC_API_URL isn't set —
// works for the web build and the Android emulator's host-loopback alias,
// but a physical device needs the LAN URL set explicitly.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL: BASE_URL });

// Called once, by AuthContext, so a failed silent refresh can clear the
// user out of app state — api.ts itself has no navigation/UI to redirect
// with, it just reports "the session is gone."
let onSessionExpired: (() => void) | null = null;
export const registerSessionExpiredHandler = (handler: () => void): void => {
  onSessionExpired = handler;
};

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Concurrent requests that all 401 at once must trigger exactly one
// refresh call, not one per request — this promise is the lock.
let refreshPromise: Promise<string | null> | null = null;

const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
    await setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken as string;
  } catch {
    return null;
  }
};

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const isAuthEndpoint = config?.url?.includes('/auth/login') || config?.url?.includes('/auth/register') || config?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && config && !config._retried && !isAuthEndpoint) {
      config._retried = true;
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        config.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(config);
      }

      await clearTokens();
      onSessionExpired?.();
    }

    return Promise.reject(error);
  }
);

/** Extracts the server's { error } message, falling back to a generic one — every screen's error handling reads this shape. */
export const apiErrorMessage = (err: unknown, fallback = 'Something went wrong.'): string => {
  if (axios.isAxiosError(err) && typeof err.response?.data === 'object' && err.response?.data && 'error' in err.response.data) {
    return String((err.response.data as { error: unknown }).error);
  }
  return fallback;
};
