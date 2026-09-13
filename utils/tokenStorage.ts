import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = '@budget/accessToken';
const REFRESH_TOKEN_KEY = '@budget/refreshToken';

export const getAccessToken = (): Promise<string | null> => AsyncStorage.getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = (): Promise<string | null> => AsyncStorage.getItem(REFRESH_TOKEN_KEY);

export const setTokens = async (accessToken: string, refreshToken: string): Promise<void> => {
  await AsyncStorage.multiSet([
    [ACCESS_TOKEN_KEY, accessToken],
    [REFRESH_TOKEN_KEY, refreshToken],
  ]);
};

export const clearTokens = (): Promise<void> => AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
