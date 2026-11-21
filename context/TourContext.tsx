import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { getLanguage } from '../utils/i18n';
import { recordTourOutcome } from '../utils/database';
import { clearTourPending, isTourPending } from '../utils/tourPrefs';

interface TourValue {
  visible: boolean;
  /** True when opened from Settings: it records nothing and never counts. */
  replay: boolean;
  /** Open the tour from Settings. */
  start: () => void;
  /** Close it, saying how it ended and on which card (1 to 5). */
  end: (outcome: 'finished' | 'skipped', step: number) => void;
}

const TourContext = createContext<TourValue>({ visible: false, replay: false, start: () => {}, end: () => {} });

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [replay, setReplay] = useState(false);

  // A new sign-up sees the tour once. Signing out closes it.
  useEffect(() => {
    if (!user) {
      setVisible(false);
      return;
    }
    let active = true;
    isTourPending(user.id).then((pending) => {
      if (!active || !pending) return;
      setReplay(false);
      setVisible(true);
    });
    return () => {
      active = false;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    setReplay(true);
    setVisible(true);
  }, []);

  const end = useCallback(
    (outcome: 'finished' | 'skipped', step: number) => {
      setVisible(false);
      clearTourPending();
      // Counts only, and only for the real first-time tour. A failed call changes nothing for the person.
      if (!replay) recordTourOutcome(outcome, step, getLanguage()).catch(() => {});
    },
    [replay]
  );

  const value = useMemo(() => ({ visible, replay, start, end }), [visible, replay, start, end]);
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
};

export const useTour = (): TourValue => useContext(TourContext);
