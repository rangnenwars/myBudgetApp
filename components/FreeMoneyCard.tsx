import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { getFreeMoneyDay, FreeMoneyDayInfo } from '../utils/database';
import { useAuth } from '../context/AuthContext';
import { fmtInr } from './ScreenKit';

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

  const free = Math.max(Math.round(info.income - info.committed), 0);
  const perDay = Math.round(free / info.daysInMonth);
  const short = Math.round(info.committed - info.income);
  const sharePct = Math.min(Math.max(info.share * 100, 0), 100);

  return (
    <Pressable onPress={() => router.push('/free-money-day')} accessibilityRole="button" accessibilityLabel="Money left after fixed bills, open details">
      <Card>
        <View style={styles.top}>
          <Text style={styles.title}>Money left after fixed bills</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
        {info.status === 'no_income' ? (
          <Text style={styles.detail}>Add your income as a transaction, or set it to repeat, and this shows how much is yours to spend.</Text>
        ) : info.status === 'over' ? (
          <>
            <Text style={[styles.headline, { color: COLORS.red }]}>{fmtInr(short)} short</Text>
            <View style={styles.bar}>
              <View style={{ flex: 1, backgroundColor: COLORS.red }} />
            </View>
            <Text style={styles.detail}>
              Your EMIs and repeating entries ({fmtInr(info.committed)}) are more than your usual income ({fmtInr(info.income)}).
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.headline}>{fmtInr(free)}</Text>
            <Text style={styles.detail}>
              yours to spend this month, about {fmtInr(perDay)} a day
            </Text>
            <View style={styles.bar} accessibilityLabel={`${Math.round(sharePct)}% of income goes to fixed bills`}>
              <View style={{ flex: sharePct, backgroundColor: COLORS.accent }} />
              <View style={{ flex: 100 - sharePct, backgroundColor: COLORS.positive, opacity: 0.55 }} />
            </View>
            <View style={styles.footer}>
              <Text style={styles.small}>Fixed bills {fmtInr(info.committed)}</Text>
              <Text style={styles.small}>Yours {fmtInr(free)}</Text>
            </View>
            <Text style={styles.small}>
              Fixed bills are your EMIs and repeating entries. Based on your usual income of {fmtInr(info.income)} a month.
            </Text>
          </>
        )}
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  headline: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginTop: SPACING.xs },
  bar: { flexDirection: 'row', height: 10, borderRadius: RADIUS.full, overflow: 'hidden', backgroundColor: COLORS.cardBorder, marginTop: SPACING.sm },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  small: { color: COLORS.textDim, fontSize: 12 },
  detail: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  footer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACING.xs, marginTop: 2, marginBottom: SPACING.xs },
});
