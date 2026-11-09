import React, { useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { getRecurring, RecurringTransaction } from '../utils/database';
import { RepeatingEntries } from './RepeatingEntries';

export type BillKind = 'loan' | 'repeating' | 'bill' | 'income';

/**
 * Tap-through for a fixed bill on Plan ahead or the free-money day: a loan EMI
 * opens that loan on the Loans tab, a repeating bill or income opens its
 * "Edit repeating entry" sheet. Render `sheet` once on the screen.
 */
export const useOpenBill = (onChanged: () => void) => {
  const { hasFeature } = useAuth();
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  /** A loan line can only open while Loans is switched on for the user. */
  const canOpen = (kind: BillKind, id?: number | null): boolean => id != null && (kind !== 'loan' || hasFeature('loans'));

  const open = async (kind: BillKind, id: number) => {
    if (kind === 'loan') {
      router.push({ pathname: '/(tabs)/loans', params: { open: String(id) } });
      return;
    }
    setRules(await getRecurring());
    setOpenId(id);
  };

  const sheet = <RepeatingEntries visible={openId != null} rules={rules} openId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />;
  return { open, canOpen, sheet };
};
