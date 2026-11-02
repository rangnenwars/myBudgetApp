import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { FEATURES } from '../constants/features';
import { useAuth } from '../context/AuthContext';

/** How many optional features the signed-in user doesn't have switched on. */
export const useUnlockableCount = (): number => {
  const { hasFeature } = useAuth();
  return FEATURES.filter((f) => !hasFeature(f.key)).length;
};

/** Home line pointing at the More features page. Hidden once everything is on. */
export const MoreFeaturesLink: React.FC = () => {
  const count = useUnlockableCount();
  if (count === 0) return null;
  return (
    <Pressable onPress={() => router.push('/more-features')} accessibilityRole="button" accessibilityLabel="Explore more features">
      <Card style={styles.row}>
        <Text style={styles.text}>
          <Ionicons name="sparkles-outline" size={15} color={COLORS.text} /> Explore more features
        </Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </Card>
    </Pressable>
  );
};

/** Settings row for the same page, with how many are available. */
export const MoreFeaturesRow: React.FC = () => {
  const count = useUnlockableCount();
  return (
    <Pressable onPress={() => router.push('/more-features')} accessibilityRole="button" accessibilityLabel="More features">
      <Card style={styles.row}>
        <Text style={styles.title}>More features</Text>
        <View style={styles.right}>
          {count > 0 && <Text style={styles.count}>{count} available</Text>}
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  text: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  right: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  count: { color: COLORS.textMuted, fontSize: 13 },
});
