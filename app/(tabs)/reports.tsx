import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LineChart, PieChart } from 'react-native-chart-kit';
import { Card } from '../../components/Card';
import { MiniBar } from '../../components/MiniBar';
import { ProGate } from '../../components/ProGate';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import {
  getMonthlySeriesForRange,
  getRangeSummary,
  getCategoryBreakdownForRange,
  getExportCsv,
  getLoans,
  getGoals,
  getInvestments,
  recordNetWorthSnapshot,
  getNetWorthSnapshots,
  MonthPoint,
  Loan,
  SavingsGoal,
} from '../../utils/database';
import { computeNetWorth, computeSavingsRate } from '../../utils/calculations';
import { shareCsv } from '../../utils/exportFile';
import { useCategories } from '../../context/CategoriesContext';
import { showAlert } from '../../utils/alert';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

type RangePreset = 'month' | '3m' | '6m' | 'year' | 'all';
type TrendMetric = 'income' | 'expense' | 'net';

const RANGE_OPTIONS: { key: RangePreset; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '3m', label: 'Last 3 mo' },
  { key: '6m', label: 'Last 6 mo' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

const METRIC_OPTIONS: { key: TrendMetric; label: string; color: string; rgba: (opacity: number) => string }[] = [
  { key: 'income', label: 'Income', color: COLORS.accent, rgba: (o) => `rgba(16, 185, 129, ${o})` },
  { key: 'expense', label: 'Expense', color: COLORS.red, rgba: (o) => `rgba(248, 113, 113, ${o})` },
  { key: 'net', label: 'Net', color: COLORS.blue, rgba: (o) => `rgba(96, 165, 250, ${o})` },
];

const getRangeBounds = (preset: RangePreset, now: Date) => {
  const endMonth = now.getMonth() + 1;
  const endYear = now.getFullYear();
  if (preset === 'month') return { startMonth: endMonth, startYear: endYear, endMonth, endYear };
  if (preset === '3m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { startMonth: d.getMonth() + 1, startYear: d.getFullYear(), endMonth, endYear };
  }
  if (preset === '6m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { startMonth: d.getMonth() + 1, startYear: d.getFullYear(), endMonth, endYear };
  }
  if (preset === 'year') return { startMonth: 1, startYear: endYear, endMonth, endYear };
  // 'all' — pragmatic 5-year lookback rather than scanning every row for the true minimum
  return { startMonth: endMonth, startYear: endYear - 5, endMonth, endYear };
};

const chartConfig = {
  backgroundGradientFrom: COLORS.card,
  backgroundGradientTo: COLORS.card,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(156, 163, 175, ${opacity})`,
  propsForDots: { r: '3' },
  propsForBackgroundLines: { stroke: COLORS.cardBorder },
};

export default function ReportsScreen() {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const [range, setRange] = useState<RangePreset>('6m');
  const [metric, setMetric] = useState<TrendMetric>('net');
  const [series, setSeries] = useState<MonthPoint[]>([]);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, netSavings: 0 });
  const [categories, setCategories] = useState<{ category: string; total: number }[]>([]);
  const [netWorth, setNetWorth] = useState(0);
  const [netWorthTrend, setNetWorthTrend] = useState<{ month: number; year: number; net_worth: number }[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [chartWidth, setChartWidth] = useState(320);

  const load = useCallback(async () => {
    if (!user) return;
    const now = new Date();
    const { startMonth, startYear, endMonth, endYear } = getRangeBounds(range, now);

    const [monthSeries, rangeSummary, categoryBreakdown, investments, userGoals, userLoans] = await Promise.all([
      getMonthlySeriesForRange(startMonth, startYear, endMonth, endYear),
      getRangeSummary(startMonth, startYear, endMonth, endYear),
      getCategoryBreakdownForRange(startMonth, startYear, endMonth, endYear, 'expense'),
      getInvestments(),
      getGoals(),
      getLoans(),
    ]);
    setSeries(monthSeries);
    setSummary(rangeSummary);
    setCategories(categoryBreakdown);
    setGoals(userGoals);
    setLoans(userLoans);

    const currentNetWorth = computeNetWorth(investments, userGoals, userLoans);
    setNetWorth(currentNetWorth);
    await recordNetWorthSnapshot();
    setNetWorthTrend(await getNetWorthSnapshots());
  }, [user, range]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onExportCsv = async () => {
    if (!user) return;
    const now = new Date();
    const { startMonth, startYear, endMonth, endYear } = getRangeBounds(range, now);
    try {
      const csv = await getExportCsv(startMonth, startYear, endMonth, endYear);
      const hasRows = csv.trim().split('\n').length > 1;
      if (!hasRows) {
        showAlert('Nothing to export', 'There are no transactions in this range yet.');
        return;
      }
      const filename = `mybudget-${startYear}-${String(startMonth).padStart(2, '0')}_to_${endYear}-${String(endMonth).padStart(2, '0')}.csv`;
      await shareCsv(filename, csv);
    } catch {
      showAlert('Export failed', 'Could not generate the CSV file.');
    }
  };

  const onLayoutChart = (e: LayoutChangeEvent) => setChartWidth(e.nativeEvent.layout.width);

  const savingsRate = computeSavingsRate(summary);
  const totalDebt = loans.reduce((sum, l) => sum + l.outstanding, 0);
  const debtCountedInExpenses = loans.filter((l) => l.counts_as_expense).reduce((sum, l) => sum + l.outstanding, 0);
  const debtNotInExpenses = totalDebt - debtCountedInExpenses;
  const maxCategoryTotal = categories[0]?.total ?? 1;
  const trendData = {
    labels: series.map((p) => p.label),
    datasets: [{ data: series.length ? series.map((p) => p[metric]) : [0] }],
  };
  const netWorthChartData = {
    labels: netWorthTrend.map((s) => `${s.month}/${String(s.year).slice(2)}`),
    datasets: [{ data: netWorthTrend.length ? netWorthTrend.map((s) => s.net_worth) : [0] }],
  };
  const pieData = categories.slice(0, 6).map((c) => {
    const cat = getCategory(c.category);
    return {
      name: cat?.label ?? c.category,
      population: c.total,
      color: cat?.color ?? COLORS.textMuted,
      legendFontColor: COLORS.textMuted,
      legendFontSize: 11,
    };
  });

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reports</Text>
        <Pressable style={styles.exportBtn} onPress={onExportCsv}>
          <Text style={styles.exportBtnText}>Export CSV</Text>
        </Pressable>
      </View>

      <View style={styles.chipRow}>
        {RANGE_OPTIONS.map((opt) => (
          <Pressable key={opt.key} style={[styles.chip, range === opt.key && styles.chipActive]} onPress={() => setRange(opt.key)}>
            <Text style={[styles.chipText, range === opt.key && styles.chipTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>

      <ProGate
        title="Reports & trends"
        description="Summary dashboard and on-demand trend charts for any date range — available on Pro."
      >
        <View style={styles.summaryGrid}>
          <Card style={styles.summaryCell}>
            <Text style={styles.cardMuted}>Income</Text>
            <Text style={[styles.summaryValue, { color: COLORS.accent }]}>{fmt(summary.totalIncome)}</Text>
          </Card>
          <Card style={styles.summaryCell}>
            <Text style={styles.cardMuted}>Expense</Text>
            <Text style={[styles.summaryValue, { color: COLORS.red }]}>{fmt(summary.totalExpense)}</Text>
          </Card>
          <Card style={styles.summaryCell}>
            <Text style={styles.cardMuted}>Savings rate</Text>
            <Text style={styles.summaryValue}>{savingsRate.toFixed(0)}%</Text>
          </Card>
          <Card style={styles.summaryCell}>
            <Text style={styles.cardMuted}>Net worth</Text>
            <Text style={[styles.summaryValue, { color: netWorth >= 0 ? COLORS.accent : COLORS.red }]}>{fmt(netWorth)}</Text>
          </Card>
        </View>

        {loans.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Liabilities</Text>
            <Card>
              <View style={styles.catRow}>
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>Total debt to repay</Text>
                  <Text style={[styles.catValue, { color: COLORS.red }]}>{fmt(totalDebt)}</Text>
                </View>
              </View>
              <View style={[styles.catRow, styles.catRowBorder]}>
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>EMIs counted in expenses</Text>
                  <Text style={styles.catValue}>{fmt(debtCountedInExpenses)}</Text>
                </View>
              </View>
              <View style={[styles.catRow, styles.catRowBorder]}>
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>Not counted in expenses</Text>
                  <Text style={styles.catValue}>{fmt(debtNotInExpenses)}</Text>
                </View>
              </View>
            </Card>
          </>
        )}

        <Text style={styles.sectionTitle}>Trend</Text>
        <Card>
          <View style={styles.chipRowTight}>
            {METRIC_OPTIONS.map((opt) => (
              <Pressable key={opt.key} style={[styles.chip, metric === opt.key && { backgroundColor: opt.color }]} onPress={() => setMetric(opt.key)}>
                <Text style={[styles.chipText, metric === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
          <View onLayout={onLayoutChart}>
            {series.length > 0 && chartWidth > 0 ? (
              <LineChart
                data={trendData}
                width={chartWidth}
                height={200}
                chartConfig={{
                  ...chartConfig,
                  color: METRIC_OPTIONS.find((m) => m.key === metric)!.rgba,
                }}
                bezier
                style={styles.chart}
                fromZero
              />
            ) : (
              <Text style={styles.emptyText}>No data in this range yet.</Text>
            )}
          </View>
        </Card>

        {netWorthTrend.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Net worth over time</Text>
            <Card>
              <LineChart data={netWorthChartData} width={chartWidth || 320} height={160} chartConfig={chartConfig} bezier style={styles.chart} />
            </Card>
          </>
        )}

        <Text style={styles.sectionTitle}>Category breakdown</Text>
        <Card>
          {pieData.length === 0 ? (
            <Text style={styles.emptyText}>No expenses in this range yet.</Text>
          ) : (
            <>
              <PieChart
                data={pieData}
                width={chartWidth || 320}
                height={180}
                chartConfig={chartConfig}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="8"
                hasLegend={false}
              />
              {categories.slice(0, 6).map((c, idx) => {
                const cat = getCategory(c.category);
                return (
                  <View key={c.category} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
                    <View style={styles.catHeader}>
                      <Text style={styles.catLabel}>{cat?.icon ?? '💰'} {cat?.label ?? c.category}</Text>
                      <Text style={styles.catValue}>{fmt(c.total)}</Text>
                    </View>
                    <MiniBar percent={(c.total / maxCategoryTotal) * 100} color={cat?.color} />
                  </View>
                );
              })}
            </>
          )}
        </Card>

        <Text style={styles.sectionTitle}>Debt payoff progress</Text>
        <Card>
          {loans.length === 0 ? (
            <Text style={styles.emptyText}>No loans tracked yet.</Text>
          ) : (
            loans.map((l, idx) => {
              const pct = l.principal > 0 ? ((l.principal - l.outstanding) / l.principal) * 100 : 0;
              return (
                <View key={l.id} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
                  <View style={styles.catHeader}>
                    <Text style={styles.catLabel}>{l.name}{l.counts_as_expense ? '' : ' · not in expenses'}</Text>
                    <Text style={styles.catValue}>{pct.toFixed(0)}% paid</Text>
                  </View>
                  <MiniBar percent={pct} color={COLORS.blue} />
                </View>
              );
            })
          )}
        </Card>

        <Text style={styles.sectionTitle}>Goal progress</Text>
        <Card>
          {goals.length === 0 ? (
            <Text style={styles.emptyText}>No goals yet.</Text>
          ) : (
            goals.map((g, idx) => {
              const pct = g.target_amount > 0 ? (g.saved_amount / g.target_amount) * 100 : 0;
              return (
                <View key={g.id} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
                  <View style={styles.catHeader}>
                    <Text style={styles.catLabel}>{g.name}</Text>
                    <Text style={styles.catValue}>{Math.min(100, pct).toFixed(0)}%</Text>
                  </View>
                  <MiniBar percent={pct} color={g.color} />
                </View>
              );
            })
          )}
        </Card>
      </ProGate>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  exportBtn: { backgroundColor: `${COLORS.accent}22`, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  exportBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chipRowTight: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.sm },
  chip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 12 },
  chipTextActive: { color: '#04140D', fontWeight: '600' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  summaryCell: { flexBasis: '47%', flexGrow: 1 },
  summaryValue: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.md },
  chart: { borderRadius: RADIUS.md, marginTop: SPACING.xs },
  cardMuted: { color: COLORS.textMuted, fontSize: 12 },
  catRow: { paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  catLabel: { color: COLORS.text, fontSize: 13 },
  catValue: { color: COLORS.textMuted, fontSize: 13 },
});
