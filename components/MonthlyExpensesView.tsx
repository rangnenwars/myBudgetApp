import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { AmountText } from './AmountText';
import { MiniBar } from './MiniBar';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getMonthlySeriesForRange } from '../utils/database';
import { shiftMonth } from '../utils/dates';
import { MonthlyExpenseRow, changeText, monthlyExpenseRows } from '../utils/expenseReports';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const MONTHS = 12;

/** Colour for a month-on-month change: spending more is red, less is green. */
export const changeColor = (pct: number): string => (pct > 0 ? COLORS.red : pct < 0 ? COLORS.positive : COLORS.textDim);

/** Reports > Monthly: the last 12 months of expenses, each with a bar and the change from the month before. */
export const MonthlyExpensesView: React.FC = () => {
  const { user } = useAuth();
  // 0 = the 12 months ending this month; 1 = the 12 before that, and so on.
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ReturnType<typeof monthlyExpenseRows> | null>(null);
  const [failed, setFailed] = useState(false);

  const now = new Date();
  const end = shiftMonth({ month: now.getMonth() + 1, year: now.getFullYear() }, -page * MONTHS);
  const first = shiftMonth(end, -(MONTHS - 1));

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      setData(null);
      // One extra month before the window, only so the oldest listed month has a % change.
      const baseline = shiftMonth(first, -1);
      getMonthlySeriesForRange(baseline.month, baseline.year, end.month, end.year)
        .then((series) => active && (setData(monthlyExpenseRows(series)), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, page])
  );

  const label = (m: { month: number; year: number }) => new Date(m.year, m.month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const open = (row: MonthlyExpenseRow) => router.push({ pathname: '/monthly-expenses/[ym]', params: { ym: `${row.year}-${row.month}` } });

  return (
    <View style={styles.wrap}>
      <View style={styles.pager}>
        <Pressable onPress={() => setPage((p) => p + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Earlier 12 months">
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={styles.pagerText}>
          {label(first)} to {label(end)}
        </Text>
        <Pressable onPress={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} hitSlop={10} accessibilityRole="button" accessibilityLabel="Later 12 months">
          <Ionicons name="chevron-forward" size={20} color={page === 0 ? COLORS.cardBorder : COLORS.text} />
        </Pressable>
      </View>

      {!data ? (
        <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Try again in a moment.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      ) : (
        <>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.muted}>Avg / month</Text>
              <AmountText value={data.average} style={styles.tileValue}>{fmt(data.average)}</AmountText>
            </View>
            <View style={styles.tile}>
              <Text style={styles.muted}>Highest</Text>
              <AmountText style={styles.tileValue}>{data.highest ? `${new Date(data.highest.year, data.highest.month - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} ${fmt(data.highest.total)}` : '₹0'}</AmountText>
            </View>
          </View>

          <Card style={styles.list}>
            {data.rows.map((r, i) => (
              <Pressable
                key={`${r.year}-${r.month}`}
                style={[styles.row, i !== 0 && styles.rowBorder]}
                onPress={() => open(r)}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}, ${fmt(r.total)}, see the categories`}
              >
                <View style={styles.rowTop}>
                  <Text style={styles.month}>{r.label}</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.amount}>{fmt(r.total)}</Text>
                    {r.changePct != null && <Text style={[styles.change, { color: changeColor(r.changePct) }]}>{changeText(r.changePct)}</Text>}
                    <Ionicons name="chevron-forward" size={14} color={COLORS.textDim} />
                  </View>
                </View>
                <MiniBar percent={r.barPct} color={COLORS.red} />
              </Pressable>
            ))}
          </Card>
          <Text style={styles.muted}>Tap a month to see where the money went.</Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.md },
  center: { alignItems: 'center', padding: SPACING.lg },
  muted: { color: COLORS.textDim, fontSize: 12 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pagerText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  tile: { flex: 1, minWidth: 0, backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: 2 },
  tileValue: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  list: { padding: 0, overflow: 'hidden' },
  row: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.xs },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexShrink: 0 },
  month: { color: COLORS.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  amount: { color: COLORS.text, fontSize: 14, fontWeight: '700', flexShrink: 0 },
  change: { fontSize: 12, fontWeight: '600', minWidth: 40, textAlign: 'right' },
});
