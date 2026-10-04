import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// react-native-web renders real DOM elements but has no prop for a few
// attributes browsers and password managers rely on (an input's `name`, a
// button's `type`). This sets them on the underlying element after mount.
// No-op on native.
//
// Runs after every render, not just on mount: React DOM resets an <input>'s
// `name` attribute on each update when no `name` prop reached it, which is
// always the case through react-native-web.
export const useWebAttributes = <T>(attrs: Record<string, string | undefined>) => {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || typeof el.setAttribute !== 'function') return;
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined) el.removeAttribute(name);
      else el.setAttribute(name, value);
    }
  });
  return ref;
};
