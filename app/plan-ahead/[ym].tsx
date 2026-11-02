import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { withFeature } from '../../components/FeatureGate';
import { monthLabel, signedInr } from '../../components/PlanAheadCard';
import { ScreenHeader, SectionTitle, fmtInr } from '../../components/ScreenKit';
import { COLORS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { getForecast, Forecast, ForecastItem } from '../../utils/database';

/** "15 Mar" for a YYYY-MM-DD date. */
const dayText = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const itemText = (it: ForecastItem): string => {
  const when = it.date ? ` · ${dayText(it.date)}` : '';
  const how = it.frequency === 'yearly' ? ' (yearly)' : it.frequency === 'quarterly' ? ' (quarterly)' : '';
  return `${it.label}${how}${when}`;
};

function PlanAheadMonthScreen() {
  const { user } = useAuth();
  const { ym, view } = useLocalSearchParams<{ ym: string; view?: string }>();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [failed, setFailed] = useState(false);
  const [year, month] = String(ym ?? '').split('-').map(Number);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getForecast()
        .then((r) => active && (setForecast(r), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  const m = forecast?.months.find((x) => x.year === year && x.month === month);
  if (!forecast || !m) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={year && month ? monthLabel(year, month) : 'Plan ahead'} />
        <View style={styles.center}>
          {failed || (forecast && !m) ? <Text style={styles.muted}>Could not load this month. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}
        </View>
      </View>
    );
  }

  const likely = view !== 'known' && forecast.typical.available;
  const left = likely ? m.likely : m.known;
  const income = m.items.filter((i) => i.kind === 'income');
  const bills = m.items.filter((i) => i.kind !== 'income');

  return (
    <View style={styles.flex}>
      <ScreenHeader title={monthLabel(m.year, m.month)} />
      <ScrollView contentContainerStyle={styles.container}>
        <SectionTitle>Money in</SectionTitle>
        <Card>
          {income.length === 0 ? <Text style={styles.muted}>No repeating income in this month.</Text> : income.map((it, i) => <Line key={i} text={itemText(it)} amount={fmtInr(it.amount)} first={i === 0} />)}
        </Card>

        <SectionTitle>Fixed bills</SectionTitle>
        <Card>
          {bills.length === 0 ? <Text style={styles.muted}>No repeating bills or EMIs in this month.</Text> : bills.map((it, i) => <Line key={i} text={itemText(it)} amount={fmtInr(it.amount)} first={i === 0} hot={it.frequency != null && it.frequency !== 'monthly' && left < 0} />)}
        </Card>

        {likely && (
          <>
            <SectionTitle>Typical spending (estimate)</SectionTitle>
            <Card>
              {forecast.typical.categories.length === 0 ? (
                <Text style={styles.muted}>No everyday spending in your recent months.</Text>
              ) : (
                forecast.typical.categories.map((c, i) => <Line key={c.category} text={c.label} amount={`~${fmtInr(c.amount)}`} first={i === 0} />)
              )}
            </Card>
          </>
        )}

        <Card style={styles.total}>
          <Text style={styles.totalLabel}>Left over</Text>
          <Text style={[styles.totalValue, { color: left < 0 ? COLORS.red : COLORS.positive }]}>{signedInr(left)}</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const Line: React.FC<{ text: string; amount: string; first: boolean; hot?: boolean }> = ({ text, amount, first, hot }) => (
  <View style={[styles.line, !first && styles.lineBorder]}>
    <Text style={[styles.lineText, hot && { color: COLORS.red }]} numberOfLines={2}>
      {text}
    </Text>
    <Text style={[styles.lineAmount, hot && { color: COLORS.red }]}>{amount}</Text>
  </View>
);

export default withFeature('forecast', PlanAheadMonthScreen);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.sm },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.sm },
  lineBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  lineText: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  lineAmount: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm },
  totalLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  totalValue: { fontSize: 17, fontWeight: '700' },
});
