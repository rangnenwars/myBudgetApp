import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembering that a new sign-up has not seen the tour yet (per device).

const PENDING_KEY = 'tour.pending';

/** Called when someone signs up. The tour opens for exactly that user the next time the app shows. */
export const markTourPending = async (userId: number): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_KEY, String(userId));
  } catch {
    // Storage blocked: no automatic tour, but it is still in Settings.
  }
};

export const isTourPending = async (userId: number): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(PENDING_KEY)) === String(userId);
  } catch {
    return false;
  }
};

export const clearTourPending = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
};
