import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadLanguage, saveLanguage } from '../languagePrefs';
import { clearTourPending, isTourPending, markTourPending } from '../tourPrefs';
import { loadCategoryOrder, saveCategoryOrder } from '../homePrefs';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Small per-device choices. Storage can be blocked or broken (private browsing), so none of these may throw
// and each falls back to a safe default.

// A failure that happens once, so the storage mock's own behaviour is left alone for the next test.
const failing = (method: 'getItem' | 'setItem' | 'removeItem') => {
  (AsyncStorage[method] as jest.Mock).mockRejectedValueOnce(new Error('blocked'));
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('language', () => {
  it('is English until a choice is saved', async () => {
    expect(await loadLanguage()).toBe('en');
  });
  it('remembers Hindi, and going back to English', async () => {
    await saveLanguage('hi');
    expect(await loadLanguage()).toBe('hi');
    await saveLanguage('en');
    expect(await loadLanguage()).toBe('en');
  });
  it('ignores a saved value it does not know', async () => {
    await AsyncStorage.setItem('app.language', 'klingon');
    expect(await loadLanguage()).toBe('en');
  });
  it('does not throw when storage fails, and stays English', async () => {
    failing('getItem');
    failing('setItem');
    expect(await loadLanguage()).toBe('en');
    await expect(saveLanguage('hi')).resolves.toBeUndefined();
  });
});

describe('tour pending', () => {
  it('nobody has a tour waiting at first', async () => {
    expect(await isTourPending(1)).toBe(false);
  });
  it('is waiting for exactly the user who signed up, and no one else', async () => {
    await markTourPending(42);
    expect(await isTourPending(42)).toBe(true);
    expect(await isTourPending(43)).toBe(false);
  });
  it('clearing it means it never opens again by itself', async () => {
    await markTourPending(42);
    await clearTourPending();
    expect(await isTourPending(42)).toBe(false);
  });
  it('a new sign-up on the same device replaces the earlier one', async () => {
    await markTourPending(1);
    await markTourPending(2);
    expect(await isTourPending(1)).toBe(false);
    expect(await isTourPending(2)).toBe(true);
  });
  it('does not throw when storage fails: no automatic tour, the app still works', async () => {
    failing('getItem');
    failing('setItem');
    failing('removeItem');
    expect(await isTourPending(1)).toBe(false);
    await expect(markTourPending(1)).resolves.toBeUndefined();
    await expect(clearTourPending()).resolves.toBeUndefined();
  });
});

describe('home category order', () => {
  it('is Highest until a choice is saved, then remembers Lowest', async () => {
    expect(await loadCategoryOrder()).toBe('highest');
    await saveCategoryOrder('lowest');
    expect(await loadCategoryOrder()).toBe('lowest');
  });
  it('falls back to Highest when storage fails or holds something unknown', async () => {
    await AsyncStorage.setItem('home.categoryOrder', 'sideways');
    expect(await loadCategoryOrder()).toBe('highest');
    failing('getItem');
    expect(await loadCategoryOrder()).toBe('highest');
  });
});
