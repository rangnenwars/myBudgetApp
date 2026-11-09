import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Card } from './Card';
import { changeColor } from './MonthlyExpensesView';
import { COLORS, SPACING } from '../constants/theme';
import { changePct, changeText } from '../utils/expenseReports';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

interface Props {
  /** "This month" for the current month, else the month's name. */
  title: string;
  total: number;
  previousTotal: number;
}

/** Home card: the month's expenses and how that compares with the month before. Opens Reports > Monthly. */
export const ThisMonthCard: React.FC<Props> = ({ title, total, previousTotal }) => {
  const change = changePct(total, previousTotal);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(tabs)/reports', params: { view: 'monthly', n: String(Date.now()) } })}
      accessibilityRole="button"
      accessibilityLabel={`${title} expenses ${fmt(total)}, open monthly expenses`}
    >
      <Card>
        <View style={styles.top}>
          <Text style={styles.title}>{title}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
        <View style={styles.row}>
          <Text style={styles.total}>{fmt(total)}</Text>
          {change != null && (
            <Text style={[styles.change, { color: changeColor(change) }]}>{changeText(change)} vs last month</Text>
          )}
        </View>
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.textMuted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm, flexWrap: 'wrap', marginTop: 2 },
  total: { color: COLORS.text, fontSize: 24, fontWeight: '700' },
  change: { fontSize: 13, fontWeight: '600' },
});
