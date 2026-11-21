import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './i18n';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { AmountText } from './AmountText';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { getFreeMoneyDay, FreeMoneyDayInfo } from '../utils/database';
import { useAuth } from '../context/AuthContext';
import { TourTarget } from '../context/TourTargetsContext';
import { fmtInr } from './ScreenKit';

import { t, dateLocale } from '../utils/i18n';
/** "19 Oct" for a day of the given month. */
export const dayLabel = (year: number, month: number, day: number): string =>
  new Date(year, month - 1, day).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });

/** Month bar: the days paying for fixed commitments, then the days left to spend. */
export const FreeMoneyBar: React.FC<{ day: number; daysInMonth: number }> = ({ day, daysInMonth }) => (
  <View style={styles.bar} accessibilityLabel={t('{0} of {1} days go to fixed commitments', { 0: day, 1: daysInMonth })}>
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
  return daysEarlier > 0 ? { text: t('{0} {1} earlier than last week', { 0: n, 1: unit }), color: COLORS.positive } : { text: t('{0} {1} later than last week', { 0: n, 1: unit }), color: COLORS.red };
};

interface Props {
  /** Change to reload (e.g. after saving an entry). */
  refreshKey?: number;
}

export const FreeMoneyCard: React.FC<Props> = ({ refreshKey = 0 }) => {
  const { user, hasFeature } = useAuth();
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
    <TourTarget id="home-money">
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
            <AmountText style={[styles.headline, { color: COLORS.red }]}>{t('{0} short', { 0: fmtInr(short) })}</AmountText>
            <View style={styles.bar}>
              <View style={{ flex: 1, backgroundColor: COLORS.red }} />
            </View>
            <Text style={styles.detail}>
              Your EMIs and repeating entries ({fmtInr(info.committed)}) are more than your usual income ({fmtInr(info.income)}).
            </Text>
          </>
        ) : (
          <>
            <AmountText style={styles.headline}>{fmtInr(free)}</AmountText>
            <Text style={styles.detail}>
              yours to spend this month, about {fmtInr(perDay)} a day
            </Text>
            <View style={styles.bar} accessibilityLabel={t('{0}% of income goes to fixed bills', { 0: Math.round(sharePct) })}>
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
        {hasFeature('forecast') && (
          <Pressable style={styles.planLink} onPress={() => router.push('/plan-ahead')} accessibilityRole="link" accessibilityLabel="Plan ahead, open the next 12 months">
            <Text style={styles.planLinkText}>Plan ahead: next 12 months ›</Text>
          </Pressable>
        )}
      </Card>
    </Pressable>
    </TourTarget>
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
  planLink: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, marginTop: SPACING.sm, paddingTop: SPACING.sm },
  planLinkText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACING.xs, marginTop: 2, marginBottom: SPACING.xs },
});
