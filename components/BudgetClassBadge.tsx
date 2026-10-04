import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CLASS_COLORS, CLASS_LABELS, COLORS, RADIUS, SPACING } from '../constants/theme';

interface Props {
  budgetClass: string | null;
}

export const BudgetClassBadge: React.FC<Props> = ({ budgetClass }) => {
  if (!budgetClass) return null;
  const color = CLASS_COLORS[budgetClass] ?? COLORS.textMuted;
  const label = CLASS_LABELS[budgetClass] ?? budgetClass;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}22` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
