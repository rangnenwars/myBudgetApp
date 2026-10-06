import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getPeople, PeopleSummary } from '../utils/database';
import { fmtAmount } from '../utils/people';

/** The way into People from Home, with what you get and owe shown underneath. */
export const PeopleButton: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const { user } = useAuth();
  const [data, setData] = useState<PeopleSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getPeople()
        .then((r) => active && setData(r))
        .catch(() => active && setData(null));
      return () => {
        active = false;
      };
    }, [user?.id, refreshKey])
  );

  const hasPeople = !!data && data.people.length > 0;

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.button} onPress={() => router.push('/people')} accessibilityRole="button" accessibilityLabel="People">
        <Ionicons name="people-outline" size={20} color={COLORS.onAccent} />
        <Text style={styles.label}>People</Text>
      </Pressable>
      <Text style={styles.caption}>
        {hasPeople ? (
          <>
            <Text style={{ color: COLORS.positive, fontWeight: '600' }}>You get {fmtAmount(data!.youGet)}</Text>
            {'  ·  '}
            <Text style={{ color: COLORS.red, fontWeight: '600' }}>You owe {fmtAmount(data!.youOwe)}</Text>
          </>
        ) : (
          'Split bills and track money you lend or borrow'
        )}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
  },
  label: { color: COLORS.onAccent, fontSize: 16, fontWeight: '700' },
  caption: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
});
