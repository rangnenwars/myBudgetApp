import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Native (iOS/Android): both tokens live in the OS keychain/keystore via
// expo-secure-store, encrypted at rest and excluded from Android Auto Backup
// by its config plugin. The web build uses tokenStorage.web.ts instead.

/** Web sends the refresh token as an httpOnly cookie; native sends it in the request body. */
export const REFRESH_VIA_COOKIE = false;

// SecureStore keys may only contain letters, digits, '.', '-' and '_'.
const ACCESS_TOKEN_KEY = 'budget.accessToken';
const REFRESH_TOKEN_KEY = 'budget.refreshToken';

// Where earlier builds kept the tokens, unencrypted. Moved into SecureStore
// on first read so existing installs stay signed in, then deleted.
const LEGACY_ACCESS_KEY = '@budget/accessToken';
const LEGACY_REFRESH_KEY = '@budget/refreshToken';

let migration: Promise<void> | null = null;
const migrateLegacyTokens = (): Promise<void> => {
  migration ??= (async () => {
    try {
      const [[, access], [, refresh]] = await AsyncStorage.multiGet([LEGACY_ACCESS_KEY, LEGACY_REFRESH_KEY]);
      if (refresh && !(await SecureStore.getItemAsync(REFRESH_TOKEN_KEY))) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
        if (access) await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
      }
      if (access || refresh) await AsyncStorage.multiRemove([LEGACY_ACCESS_KEY, LEGACY_REFRESH_KEY]);
    } catch {
      // Worst case the user signs in again — never block startup on this.
    }
  })();
  return migration;
};

/** Web-only optimisation (see tokenStorage.web.ts); native reads the stored tokens instead. */
export const hasSessionHint = (): boolean | null => null;

export const getAccessToken = async (): Promise<string | null> => {
  await migrateLegacyTokens();
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
};

export const getRefreshToken = async (): Promise<string | null> => {
  await migrateLegacyTokens();
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
};

export const setTokens = async (accessToken: string, refreshToken?: string): Promise<void> => {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearTokens = async (): Promise<void> => {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
};
