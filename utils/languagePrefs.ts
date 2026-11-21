import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, parseLanguage } from './i18n';

// The chosen language, per device. Storage can be missing or blocked (private browsing), so every
// read and write may fail and the app simply stays in English.

const KEY = 'app.language';

export const loadLanguage = async (): Promise<Language> => {
  try {
    return parseLanguage(await AsyncStorage.getItem(KEY));
  } catch {
    return 'en';
  }
};

export const saveLanguage = async (lang: Language): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEY, lang);
  } catch {
    // Not remembered this time; the choice still applies for this visit.
  }
};
