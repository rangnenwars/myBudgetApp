import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { AmountText } from './AmountText';
import { MiniBar } from './MiniBar';
import { changeColor } from './MonthlyExpensesView';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getOverallBudget, OverallBudget } from '../utils/database';
import { changePct, changeText } from '../utils/expenseReports';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const STATUS_COLOR = { ok: COLORS.accent, warning: COLORS.yellow, over: COLORS.red } as const;

interface Props {
  month: number;
  year: number;
  /** Whether Home is showing the current month (only then is "set a budget" offered). */
  isCurrentMonth: boolean;
  /** The viewed month's expenses and the month before's, for the "Spent ₹X · +N%" line. */
  spent: number;
  previousSpent: number;
  /** Change to reload (e.g. after saving an entry). */
  refreshKey?: number;
}

/**
 * Home's main card: what is left of the monthly budget and per day, with how
 * much was spent and how that compares with last month underneath. Without a
 * budget it leads with the spent total and offers to set one.
 */
export const HomeHeroCard: React.FC<Props> = ({ month, year, isCurrentMonth, spent, previousSpent, refreshKey = 0 }) => {
  const userId = useAuth().user?.id;
  const [budget, setBudget] = useState<OverallBudget | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      getOverallBudget(month, year)
        .then((r) => active && setBudget(r))
        .catch(() => active && setBudget(null));
      return () => {
        active = false;
      };
      // refreshKey: not read inside, but changing it is how Home asks for a reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, month, year, refreshKey])
  );

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' });
  const change = changePct(spent, previousSpent);
  const hasBudget = budget?.amount != null;
  const left = budget?.left ?? 0;

  const spentLine = (
    <Pressable
      style={styles.spentRow}
      onPress={() => router.push({ pathname: '/(tabs)/reports', params: { view: 'monthly', n: String(Date.now()) } })}
      accessibilityRole="button"
      accessibilityLabel={`${monthName} expenses ${fmt(spent)}, open monthly expenses`}
    >
      <Text style={styles.spentText}>
        Spent <Text style={styles.strong}>{fmt(spent)}</Text>
        {change != null && <Text style={{ color: changeColor(change), fontWeight: '600' }}> · {changeText(change)} vs last month</Text>}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
    </Pressable>
  );

  if (!hasBudget) {
    return (
      <Card style={styles.gap}>
        <Text style={styles.title}>{isCurrentMonth ? 'This month' : monthName}</Text>
        <AmountText style={styles.headline}>{`${fmt(spent)} spent`}</AmountText>
        {change != null && <Text style={{ color: changeColor(change), fontSize: 13, fontWeight: '600' }}>{changeText(change)} vs last month</Text>}
        {isCurrentMonth && (
          <Pressable style={styles.cta} onPress={() => router.push('/budgets')} accessibilityRole="button">
            <Text style={styles.ctaText}>Set a monthly budget</Text>
          </Pressable>
        )}
        {!isCurrentMonth && spentLine}
      </Card>
    );
  }

  const color = STATUS_COLOR[budget?.status ?? 'ok'];
  return (
    <Card style={styles.gap}>
      <Pressable onPress={() => router.push('/budgets')} accessibilityRole="button" accessibilityLabel="Monthly budget, open budgets" style={styles.gap}>
        <View style={styles.top}>
          <Text style={styles.title}>Left this month</Text>
          <View style={styles.top}>
            <Text style={styles.small}>{Math.round((budget?.ratio ?? 0) * 100)}% used</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </View>
        </View>
        <AmountText style={[styles.headline, left < 0 && { color: COLORS.red }]}>{left >= 0 ? fmt(left) : `${fmt(-left)} over`}</AmountText>
        <MiniBar percent={(budget?.ratio ?? 0) * 100} color={color} />
        {(budget?.per_day ?? 0) > 0 && (
          <Text style={styles.detail}>
            About <Text style={styles.strong}>{fmt(budget!.per_day!)}/day</Text> for the next {budget!.days_left} {budget!.days_left === 1 ? 'day' : 'days'}
          </Text>
        )}
      </Pressable>
      {spentLine}
    </Card>
  );
};

const styles = StyleSheet.create({
  gap: { gap: SPACING.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.xs },
  title: { color: COLORS.textMuted, fontSize: 13 },
  headline: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  small: { color: COLORS.textDim, fontSize: 12 },
  detail: { color: COLORS.textMuted, fontSize: 13 },
  strong: { color: COLORS.text, fontWeight: '700' },
  spentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: SPACING.sm, marginTop: SPACING.xs },
  spentText: { color: COLORS.textMuted, fontSize: 13, flexShrink: 1 },
  cta: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center', marginTop: SPACING.xs },
  ctaText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 14 },
});
