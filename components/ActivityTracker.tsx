import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { ActivityBuffer } from '../utils/activity';
import { sendPageHits } from '../utils/database';

const FLUSH_EVERY_MS = 30_000;

// Reports which pages the signed-in person opens, as fixed patterns (utils/pagePatterns.ts), in small batches.
// Does nothing when they have switched "Share which pages I visit" off, or when nobody is signed in.
// Failures are silent: this must never get in the way of using the app.
export const ActivityTracker: React.FC = () => {
  const { user } = useAuth();
  const pathname = usePathname();
  const buffer = useRef(new ActivityBuffer());
  const sending = useRef(false);
  const userId = user?.id ?? null;
  const sharing = !!user && user.shareActivity !== false;

  useEffect(() => {
    if (!sharing) buffer.current.clear();
  }, [sharing, userId]);

  useEffect(() => {
    if (sharing) buffer.current.add(pathname);
  }, [pathname, sharing]);

  useEffect(() => {
    if (!sharing) return;
    const flush = async () => {
      if (sending.current) return;
      const batch = buffer.current.drain();
      if (!batch.length) return;
      sending.current = true;
      try {
        await sendPageHits(batch);
      } catch {
        buffer.current.restore(batch);
      } finally {
        sending.current = false;
      }
    };
    const timer = setInterval(flush, FLUSH_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush();
    });
    const onHide = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      sub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [sharing, userId]);

  return null;
};
