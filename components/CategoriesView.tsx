import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { MiniBar } from './MiniBar';
import { changeColor } from './MonthlyExpensesView';
import { Segmented } from './ScreenKit';
import { COLORS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import { getCategoryBreakdownForRange, CategoryTotal } from '../utils/database';
import { shiftMonth } from '../utils/dates';
import { OTHERS_KEY, categoryPeriod, categoryRows, changeText, topSpendInsight } from '../utils/expenseReports';
import { monthFilter, rangeBounds, txnLink } from '../utils/txnLink';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const KEEP = 5;

type Mode = 'month' | 'year';
const MODES: { key: Mode; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

/** Reports > Categories: where the money went in a month or a year, largest first, with share and change. */
export const CategoriesView: React.FC = () => {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const now = new Date();
  const today = { month: now.getMonth() + 1, year: now.getFullYear() };
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState<{ current: CategoryTotal[]; previous: CategoryTotal[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const { current, previous } = categoryPeriod(mode, anchor, today);
  const isLatest = mode === 'month' ? anchor.year === today.year && anchor.month === today.month : anchor.year === today.year;
  const periodLabel = mode === 'month' ? new Date(anchor.year, anchor.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : String(anchor.year);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      setData(null);
      const load = (r: typeof current) => getCategoryBreakdownForRange(r.startMonth, r.startYear, r.endMonth, r.endYear, 'expense');
      Promise.all([load(current), load(previous)])
        .then(([c, p]) => active && (setData({ current: c, previous: p }), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, mode, anchor.month, anchor.year])
  );

  const step = (delta: number) => setAnchor((a) => (mode === 'month' ? shiftMonth(a, delta) : { ...a, year: a.year + delta }));
  const labelOf = (c: string) => getCategory(c)?.label ?? c;
  const result = data ? categoryRows(data.current, data.previous, KEEP, (c) => !!getCategory(c)) : null;
  const insight = result ? topSpendInsight(result.rows, labelOf) : null;

  const open = (category: string) => {
    if (mode === 'month') {
      router.push(txnLink({ type: 'expense', category, ...monthFilter(anchor.year, anchor.month) }));
    } else {
      router.push({ pathname: '/category-trend/[category]', params: { category, year: String(anchor.year) } });
    }
  };

  return (
    <View style={styles.wrap}>
      <Segmented<Mode> options={MODES} value={mode} onChange={setMode} />

      <View style={styles.pager}>
        <Pressable onPress={() => step(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={mode === 'month' ? 'Earlier month' : 'Earlier year'}>
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={styles.pagerText}>{periodLabel}</Text>
        <Pressable onPress={() => step(1)} disabled={isLatest} hitSlop={10} accessibilityRole="button" accessibilityLabel={mode === 'month' ? 'Later month' : 'Later year'}>
          <Ionicons name="chevron-forward" size={20} color={isLatest ? COLORS.cardBorder : COLORS.text} />
        </Pressable>
      </View>

      {!result ? (
        <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Try again in a moment.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      ) : result.rows.length === 0 ? (
        <Card>
          <Text style={styles.empty}>No expenses in {periodLabel}.</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.muted}>Total spent</Text>
            <Text style={styles.total}>{fmt(result.total)}</Text>
            {insight && <Text style={styles.insight}>{insight}</Text>}
          </Card>

          <Card style={styles.list}>
            {result.rows.map((r, i) => {
              const cat = r.category === OTHERS_KEY ? null : getCategory(r.category);
              const label = r.category === OTHERS_KEY ? 'Others' : `${cat?.icon ?? '💰'} ${cat?.label ?? r.category}`;
              const body = (
                <>
                  <View style={styles.rowTop}>
                    <Text style={styles.label} numberOfLines={1}>
                      {label}
                    </Text>
                    <View style={styles.rowRight}>
                      <Text style={styles.amount}>{fmt(r.total)}</Text>
                      <Text style={styles.share}>{r.sharePct}%</Text>
                      <Text style={[styles.change, { color: r.changePct == null ? COLORS.textDim : changeColor(r.changePct) }]}>{r.changePct == null ? '' : changeText(r.changePct)}</Text>
                      {r.category !== OTHERS_KEY && <Ionicons name="chevron-forward" size={14} color={COLORS.textDim} />}
                    </View>
                  </View>
                  <MiniBar percent={r.barPct} color={cat?.color ?? COLORS.textMuted} />
                </>
              );
              return r.category === OTHERS_KEY ? (
                <View key={r.category} style={[styles.row, i !== 0 && styles.rowBorder]}>
                  {body}
                </View>
              ) : (
                <Pressable
                  key={r.category}
                  style={[styles.row, i !== 0 && styles.rowBorder]}
                  onPress={() => open(r.category)}
                  accessibilityRole="button"
                  accessibilityLabel={`${cat?.label ?? r.category} ${fmt(r.total)}, ${mode === 'month' ? 'see the entries' : 'see month by month'}`}
                >
                  {body}
                </Pressable>
              );
            })}
          </Card>
          <Text style={styles.muted}>
            {mode === 'month' ? 'Tap a category to see its transactions.' : 'Tap a category to see it month by month.'} Change is against {mode === 'month' ? 'the month before' : anchor.year === today.year ? 'the same months last year' : 'the year before'}.
          </Text>
        </>
      )}
    </View>
  );
};

/** Date filter for a whole year (to today for the current year), for the "See transactions" links. */
export const yearFilter = (year: number, today: { month: number; year: number }) => {
  const b = rangeBounds(1, year, year === today.year ? today.month : 12, year);
  return { from: b.from, to: b.to, label: String(year) };
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.md },
  center: { alignItems: 'center', padding: SPACING.lg },
  muted: { color: COLORS.textDim, fontSize: 12 },
  empty: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: SPACING.sm },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pagerText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  total: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  insight: { color: COLORS.text, fontSize: 14, marginTop: SPACING.xs },
  list: { padding: 0, overflow: 'hidden' },
  row: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.xs },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  label: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  amount: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  share: { color: COLORS.textDim, fontSize: 12, minWidth: 32, textAlign: 'right' },
  change: { fontSize: 12, fontWeight: '600', minWidth: 40, textAlign: 'right' },
});
