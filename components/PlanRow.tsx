import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { planHeadline } from '../utils/planState';

/** Settings and More features: one row that opens Your plan, with where the user stands in a few words. */
export const PlanRow: React.FC = () => {
  const { user } = useAuth();
  if (!user?.plan) return null;
  const head = planHeadline(user.plan);
  return (
    <Pressable onPress={() => router.push('/plan')} accessibilityRole="button" accessibilityLabel={`Your plan: ${head.title}. ${head.detail}`}>
      <Card style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>Your plan</Text>
          <Text style={styles.detail}>
            {head.title}. {head.detail}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  text: { flex: 1, gap: 2 },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  detail: { color: COLORS.textMuted, fontSize: 12.5 },
});
