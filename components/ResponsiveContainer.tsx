import React from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { COLORS, T } from '../constants/theme';

// On native (phone/tablet) this is a passthrough. On web it centers content
// in a phone-width column on wide viewports (laptop) so the mobile-first
// screens don't stretch edge-to-edge, while still filling narrow viewports
// (mobile/tablet browsers) naturally.
// Sign-in and register use the full width on wide screens: AuthLayout shows the
// marketing slides beside the form there instead of a phone-width column.
export const AUTH_WIDE_MIN_WIDTH = 900;
const AUTH_PATHS = ['/login', '/register'];

export const ResponsiveContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  if (AUTH_PATHS.includes(pathname) && width >= AUTH_WIDE_MIN_WIDTH) {
    return <View style={styles.fullWidth}>{children}</View>;
  }

  return (
    <View style={styles.outer}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  fullWidth: { flex: 1, backgroundColor: COLORS.bg },
  outer: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: T.frame,
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    backgroundColor: COLORS.bg,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 0 40px rgba(0,0,0,0.12)' } as any)
      : {}),
  },
});
