import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { MiniBar } from './MiniBar';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { getOverallBudget, OverallBudget } from '../utils/database';
import { useAuth } from '../context/AuthContext';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const STATUS_COLOR = { ok: COLORS.accent, warning: COLORS.yellow, over: COLORS.red } as const;

interface Props {
  month: number;
  year: number;
  /** Whether the dashboard is showing the current month (only then is "no budget yet" offered). */
  isCurrentMonth: boolean;
  /** Change to reload (e.g. after saving an entry). */
  refreshKey?: number;
}

/** Home card for the one overall monthly budget: what's left and how much that is per day. */
export const BudgetCard: React.FC<Props> = ({ month, year, isCurrentMonth, refreshKey = 0 }) => {
  const userId = useAuth().user?.id;
  const [info, setInfo] = useState<OverallBudget | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      getOverallBudget(month, year)
        .then((r) => active && setInfo(r))
        .catch(() => active && setInfo(null));
      return () => {
        active = false;
      };
      // refreshKey: not read inside, but changing it is how Home asks for a reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, month, year, refreshKey])
  );

  if (!info) return null;

  if (info.amount == null) {
    if (!isCurrentMonth) return null;
    return (
      <Card style={styles.gap}>
        <Text style={styles.title}>No monthly budget yet</Text>
        <Text style={styles.detail}>Set one monthly number and we’ll track it for you.</Text>
        <Pressable style={styles.cta} onPress={() => router.push('/budgets')} accessibilityRole="button">
          <Text style={styles.ctaText}>Set monthly budget</Text>
        </Pressable>
      </Card>
    );
  }

  const left = info.left ?? 0;
  const color = STATUS_COLOR[info.status ?? 'ok'];
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long' });

  return (
    <Pressable onPress={() => router.push('/budgets')} accessibilityRole="button" accessibilityLabel="Monthly budget, open budgets">
      <Card style={styles.gap}>
        <View style={styles.top}>
          <Text style={styles.title}>{monthName} budget</Text>
          <View style={styles.top}>
            <Text style={styles.small}>{Math.round((info.ratio ?? 0) * 100)}%</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </View>
        </View>
        <Text style={[styles.headline, left < 0 && { color: COLORS.red }]}>{left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}</Text>
        <MiniBar percent={(info.ratio ?? 0) * 100} color={color} />
        <Text style={styles.detail}>
          {(info.per_day ?? 0) > 0 ? (
            <>
              About <Text style={styles.strong}>{fmt(info.per_day!)}/day</Text> for the next {info.days_left} {info.days_left === 1 ? 'day' : 'days'}
            </>
          ) : (
            `${fmt(info.spent)} spent of ${fmt(info.amount)}`
          )}
        </Text>
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  gap: { gap: SPACING.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.xs },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  headline: { color: COLORS.text, fontSize: 24, fontWeight: '700' },
  small: { color: COLORS.textDim, fontSize: 12 },
  detail: { color: COLORS.textMuted, fontSize: 13 },
  strong: { color: COLORS.text, fontWeight: '700' },
  cta: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center', marginTop: SPACING.xs },
  ctaText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 14 },
});
