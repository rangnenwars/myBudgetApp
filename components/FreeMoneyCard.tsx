import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { getFreeMoneyDay, FreeMoneyDayInfo } from '../utils/database';
import { useAuth } from '../context/AuthContext';

/** "19 Oct" for a day of the given month. */
export const dayLabel = (year: number, month: number, day: number): string =>
  new Date(year, month - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Month bar: the days paying for fixed commitments, then the days left to spend. */
export const FreeMoneyBar: React.FC<{ day: number; daysInMonth: number }> = ({ day, daysInMonth }) => (
  <View style={styles.bar} accessibilityLabel={`${day} of ${daysInMonth} days go to fixed commitments`}>
    <View style={{ flex: day, backgroundColor: COLORS.accent }} />
    <View style={{ flex: Math.max(daysInMonth - day, 0), backgroundColor: COLORS.positive, opacity: 0.55 }} />
  </View>
);

/** "2 days earlier than last week" / "1 day later…" / "Same as last week"; null without a previous reading. */
export const weekChange = (daysEarlier: number | null): { text: string; color: string } | null => {
  if (daysEarlier == null) return null;
  if (daysEarlier === 0) return { text: 'Same as last week', color: COLORS.textMuted };
  const n = Math.abs(daysEarlier);
  const unit = n === 1 ? 'day' : 'days';
  return daysEarlier > 0 ? { text: `${n} ${unit} earlier than last week`, color: COLORS.positive } : { text: `${n} ${unit} later than last week`, color: COLORS.red };
};

interface Props {
  /** Change to reload (e.g. after saving an entry). */
  refreshKey?: number;
}

export const FreeMoneyCard: React.FC<Props> = ({ refreshKey = 0 }) => {
  const { user } = useAuth();
  const [info, setInfo] = useState<FreeMoneyDayInfo | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getFreeMoneyDay()
        .then((r) => active && setInfo(r))
        .catch(() => active && setInfo(null));
      return () => {
        active = false;
      };
    }, [user?.id, refreshKey])
  );

  if (!info) return null;

  const change = weekChange(info.daysEarlier);
  let headline = '';
  let detail = '';
  if (info.status === 'no_income') {
    headline = 'Not enough to work out yet';
    detail = 'Log your income as a transaction, or set it to repeat, and your free-money day appears here.';
  } else if (info.status === 'over') {
    headline = 'No free days';
    detail = 'Your fixed bills and EMIs are as much as your income.';
  } else if (info.day === 0) {
    headline = 'Every day is free';
    detail = 'No EMIs or repeating bills are set up.';
  } else {
    headline = dayLabel(info.year, info.month, info.day!);
    detail = `${info.daysFree} ${info.daysFree === 1 ? 'day' : 'days'} left that are yours to spend`;
  }

  return (
    <Pressable onPress={() => router.push('/free-money-day')} accessibilityRole="button" accessibilityLabel="Free-money day, open details">
      <Card>
        <View style={styles.top}>
          <Text style={styles.title}>Your free-money day</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
        <Text style={styles.sub}>{info.status === 'ok' && info.day! > 0 ? 'Everything fixed is paid for by' : ' '}</Text>
        <Text style={[styles.headline, info.status === 'over' && { color: COLORS.red }]}>{headline}</Text>
        {info.status === 'ok' && info.day! > 0 && (
          <>
            <FreeMoneyBar day={info.day!} daysInMonth={info.daysInMonth} />
            <View style={styles.ends}>
              <Text style={styles.small}>{dayLabel(info.year, info.month, 1)}</Text>
              <Text style={styles.small}>{dayLabel(info.year, info.month, info.daysInMonth)}</Text>
            </View>
          </>
        )}
        <Text style={styles.detail}>{detail}</Text>
        {info.status !== 'no_income' && (
          <View style={styles.footer}>
            <Text style={styles.small}>{Math.round(info.share * 100)}% of income is committed</Text>
            {change && <Text style={[styles.small, { color: change.color, fontWeight: '600' }]}>{change.text}</Text>}
          </View>
        )}
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  sub: { color: COLORS.textDim, fontSize: 12, marginTop: SPACING.xs },
  headline: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginBottom: SPACING.xs },
  bar: { flexDirection: 'row', height: 10, borderRadius: RADIUS.full, overflow: 'hidden', backgroundColor: COLORS.cardBorder },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  small: { color: COLORS.textDim, fontSize: 12 },
  detail: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.sm },
  footer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
});
