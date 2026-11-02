import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { withFeature } from '../../components/FeatureGate';
import { monthLabel, signedInr } from '../../components/PlanAheadCard';
import { ScreenHeader, Segmented, Notice, fmtInr } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { getForecast, Forecast } from '../../utils/database';

type View_ = 'likely' | 'known';

function PlanAheadScreen() {
  const { user } = useAuth();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View_>('likely');

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getForecast()
        .then((r) => {
          if (!active) return;
          setForecast(r);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  if (!forecast) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Plan ahead" />
        <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      </View>
    );
  }

  const likely = view === 'likely' && forecast.typical.available;
  const left = (m: Forecast['months'][number]) => (likely ? m.likely : m.known);
  const avg = (pick: (m: Forecast['months'][number]) => number) => forecast.months.reduce((s, m) => s + pick(m), 0) / forecast.months.length;
  const empty = forecast.incomeSource === 'none' && forecast.months.every((m) => m.fixed === 0);

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Plan ahead" />
      <ScrollView contentContainerStyle={styles.container}>
        {forecast.typical.available && (
          <Segmented<View_>
            options={[
              { key: 'likely', label: 'Likely' },
              { key: 'known', label: 'Known only' },
            ]}
            value={view}
            onChange={setView}
          />
        )}

        {empty ? (
          <Card>
            <Text style={styles.muted}>Log your income and bills and set them to repeat. Your next 12 months show up here.</Text>
          </Card>
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label="Income" value={fmtInr(Math.round(avg((m) => m.income)))} />
              <Tile label="Fixed bills" value={fmtInr(Math.round(avg((m) => m.fixed)))} />
              {likely && <Tile label="Typical spend" value={`~${fmtInr(forecast.typical.perMonth)}`} />}
            </View>
            <Text style={styles.small}>Monthly averages over the next 12 months.</Text>

            <Card style={styles.list}>
              {forecast.months.map((m, i) => {
                const l = left(m);
                const bigBill = m.items.filter((it) => it.kind !== 'income' && it.frequency && it.frequency !== 'monthly').sort((a, b) => b.amount - a.amount)[0];
                return (
                  <Pressable
                    key={`${m.year}-${m.month}`}
                    style={[styles.row, i !== 0 && styles.rowBorder, l < 0 && styles.rowTight]}
                    onPress={() => router.push({ pathname: '/plan-ahead/[ym]', params: { ym: `${m.year}-${m.month}`, view: likely ? 'likely' : 'known' } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${monthLabel(m.year, m.month)}, ${signedInr(l)}`}
                  >
                    <View style={styles.flexShrink}>
                      <Text style={styles.monthText}>{monthLabel(m.year, m.month)}</Text>
                      {l < 0 && bigBill && <Text style={styles.small}>{bigBill.label}</Text>}
                    </View>
                    <Text style={[styles.amount, { color: l < 0 ? COLORS.red : COLORS.positive }]}>{signedInr(l)}</Text>
                  </Pressable>
                );
              })}
            </Card>

            <Notice>
              {likely
                ? `Typical spend is estimated from your last ${forecast.typical.monthsUsed} ${forecast.typical.monthsUsed === 1 ? 'month' : 'months'}, leaving out bills that repeat on their own.`
                : forecast.typical.available
                  ? 'Known only: your income minus repeating bills and EMIs. Everyday spending is not included.'
                  : 'Not enough history yet to estimate your everyday spending, so this shows income minus repeating bills and EMIs.'}
              {forecast.incomeSource === 'average' ? ' Income is the average of your recent months. Set your salary to repeat for a firmer plan.' : ''}
            </Notice>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.tile}>
    <Text style={styles.small}>{label}</Text>
    <Text style={styles.tileValue}>{value}</Text>
  </View>
);

export default withFeature('forecast', PlanAheadScreen);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  flexShrink: { flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  small: { color: COLORS.textDim, fontSize: 12 },
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  tile: { flex: 1, backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.sm, gap: 2 },
  tileValue: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: SPACING.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowTight: { backgroundColor: COLORS.red + '1A' },
  monthText: { color: COLORS.text, fontSize: 14 },
  amount: { fontSize: 14, fontWeight: '700' },
});
