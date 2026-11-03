import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { getForecast, Forecast } from '../utils/database';
import { useAuth } from '../context/AuthContext';
import { fmtInr } from './ScreenKit';

/** "Mar 2027" for a year and month (1–12). */
export const monthLabel = (year: number, month: number): string =>
  new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

/** "+₹7,500" / "−₹4,500": what is left (or short) in a month. */
export const signedInr = (n: number): string => (n < 0 ? '−' : '+') + fmtInr(Math.abs(n));

/** Home card for Plan ahead. Renders nothing unless an admin switched the feature on and the forecast loaded. */
export const PlanAheadCard: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const { user, hasFeature } = useAuth();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const on = hasFeature('forecast');

  useFocusEffect(
    useCallback(() => {
      if (!user || !on) return;
      let active = true;
      getForecast()
        .then((r) => active && setForecast(r))
        .catch(() => active && setForecast(null));
      return () => {
        active = false;
      };
    }, [user?.id, on, refreshKey])
  );

  if (!on || !forecast) return null;
  const { tightest, averageLeft } = forecast.summary;
  const hasPlan = forecast.incomeSource !== 'none' || forecast.months.some((m) => m.fixed > 0);
  const basisText = forecast.basis === 'likely' ? 'Usually left over' : 'Left over after fixed bills';

  return (
    <Pressable onPress={() => router.push('/plan-ahead')} accessibilityRole="button" accessibilityLabel="Plan ahead, open the next 12 months">
      <Card>
        <View style={styles.top}>
          <Text style={styles.title}>
            <Ionicons name="calendar-outline" size={15} color={COLORS.text} /> Plan ahead
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
        <Text style={styles.detail}>Next 12 months, from your repeating entries</Text>
        {hasPlan && tightest ? (
          <>
            <Text style={styles.line}>
              Tightest month:{' '}
              <Text style={[styles.bold, tightest.left < 0 && { color: COLORS.red }]}>{monthLabel(tightest.year, tightest.month)}</Text>
            </Text>
            <Text style={styles.line}>
              {basisText}: <Text style={styles.bold}>{fmtInr(averageLeft)} / month</Text>
            </Text>
          </>
        ) : (
          <Text style={styles.detail}>Set your income and bills to repeat and your year fills in here.</Text>
        )}
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  detail: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.xs },
  line: { color: COLORS.text, fontSize: 13, marginTop: 2 },
  bold: { fontWeight: '700' },
});
