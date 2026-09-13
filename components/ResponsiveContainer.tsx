import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { COLORS } from '../constants/theme';

// On native (phone/tablet) this is a passthrough. On web it centers content
// in a phone-width column on wide viewports (laptop) so the mobile-first
// screens don't stretch edge-to-edge, while still filling narrow viewports
// (mobile/tablet browsers) naturally.
export const ResponsiveContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return (
    <View style={styles.outer}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.adminBg === COLORS.bg ? COLORS.bg : '#05070E',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    backgroundColor: COLORS.bg,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 0 40px rgba(0,0,0,0.4)' } as any)
      : {}),
  },
});
