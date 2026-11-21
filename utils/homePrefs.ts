import AsyncStorage from '@react-native-async-storage/async-storage';
import { CategoryOrder, parseCategoryOrder } from './categoryOrder';

// Small per-device choices for Home. Storage can be missing or blocked (private browsing),
// so every read and write is allowed to fail and Home still works with its defaults.

const CATEGORY_ORDER_KEY = 'home.categoryOrder';

export const loadCategoryOrder = async (): Promise<CategoryOrder> => {
  try {
    return parseCategoryOrder(await AsyncStorage.getItem(CATEGORY_ORDER_KEY));
  } catch {
    return 'highest';
  }
};

export const saveCategoryOrder = async (order: CategoryOrder): Promise<void> => {
  try {
    await AsyncStorage.setItem(CATEGORY_ORDER_KEY, order);
  } catch {
    // Not remembered this time; the choice still applies for this visit.
  }
};
