import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/Card';
import { MiniBar } from '../../components/MiniBar';
import { BudgetClassBadge } from '../../components/BudgetClassBadge';
import { ProGate } from '../../components/ProGate';
import { useAuth } from '../../context/AuthContext';
import { useCategories } from '../../context/CategoriesContext';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { getMonthSummary, getCategoryBreakdown, getBudgets, BudgetStatus, CategoryTotal } from '../../utils/database';
import { computeCategoryDeltas, computeSavingsRate, bucketForGroup, CategoryDelta, CategoryBucket } from '../../utils/calculations';
import { shiftMonth } from '../../utils/dates';
import { showAlert } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';

const BUCKET_LABEL: Record<CategoryBucket, string> = { expense: 'Expenses', loan: 'Loan payments', investment: 'Investments' };
const BUCKET_COLOR: Record<CategoryBucket, string> = { expense: COLORS.red, loan: COLORS.blue, investment: COLORS.purple };

const fmt = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function DashboardScreen() {
  const { user, logout, refreshBudgetClass, isPro, isStaff, canViewMetrics, setTier } = useAuth();
  const { categories, getCategory } = useCategories();
  const now = new Date();
  const currentMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const [view, setView] = useState(currentMonth);
  const isCurrentMonth = view.month === currentMonth.month && view.year === currentMonth.year;
  const viewLabel = new Date(view.year, view.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, netSavings: 0 });
  const [topCategories, setTopCategories] = useState<{ category: string; total: number }[]>([]);
  const [deltas, setDeltas] = useState<CategoryDelta[]>([]);
  const [breakdown, setBreakdown] = useState<Record<CategoryBucket, number>>({ expense: 0, loan: 0, investment: 0 });
  // Budgets at 80% or more of their limit in the viewed month.
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetStatus[]>([]);
  const [hasBudgets, setHasBudgets] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      // Ignore a response that arrives after the user already moved to another month.
      let active = true;
      (async () => {
        const { month, year } = view;
        const prev = shiftMonth(view, -1);

        // Category totals for this month and last (computed on the server),
        // rather than every transaction of both months.
        const [monthSummary, monthCategories, prevCategories, budgets] = await Promise.all([
          getMonthSummary(month, year),
          getCategoryBreakdown(month, year, 'expense'),
          getCategoryBreakdown(prev.month, prev.year, 'expense'),
          getBudgets(month, year).catch(() => [] as BudgetStatus[]),
        ]);
        if (!active) return;

        setHasBudgets(budgets.length > 0);
        setBudgetAlerts(budgets.filter((b) => b.status !== 'ok'));

        setSummary(monthSummary);
        setTopCategories(monthCategories.slice(0, 5));

        const buckets: Record<CategoryBucket, number> = { expense: 0, loan: 0, investment: 0 };
        for (const c of monthCategories) {
          const bucket = bucketForGroup(getCategory(c.category)?.group ?? '');
          buckets[bucket] += c.total;
        }
        setBreakdown(buckets);

        const asTotals = (rows: CategoryTotal[], m: number, y: number) => rows.map((c) => ({ type: 'expense' as const, amount: c.total, category: c.category, month: m, year: y }));
        setDeltas(
          computeCategoryDeltas(asTotals(monthCategories, month, year), asTotals(prevCategories, prev.month, prev.year), 'expense')
            .filter((d) => d.current > 0 || d.previous > 0)
            .slice(0, 3)
        );

        refreshBudgetClass();
      })();
      return () => {
        active = false;
      };
      // categories.length: re-run once CategoriesContext's initial fetch
      // resolves, so a focus that races ahead of it self-corrects instead
      // of leaving every category miscategorized as "expense" until the
      // next focus.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, categories.length, view.month, view.year])
  );

  const maxCategoryTotal = topCategories[0]?.total ?? 1;
  const savingsRate = computeSavingsRate(summary);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] ?? 'there'}</Text>
          <View style={styles.monthNav}>
            <Pressable onPress={() => setView((v) => shiftMonth(v, -1))} hitSlop={8} style={styles.monthArrow}>
              <Ionicons name="chevron-back" size={16} color={COLORS.textMuted} />
            </Pressable>
            <Text style={styles.monthLabel}>{viewLabel}</Text>
            <Pressable
              onPress={() => setView((v) => shiftMonth(v, 1))}
              disabled={isCurrentMonth}
              hitSlop={8}
              style={[styles.monthArrow, isCurrentMonth && styles.monthArrowDisabled]}
            >
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/report-issue')} style={styles.logoutBtn} accessibilityLabel="Report an issue">
            <Ionicons name="bug-outline" size={22} color={COLORS.textMuted} />
          </Pressable>
          {(isStaff || canViewMetrics) && (
            <Pressable
              onPress={() => router.push(isStaff ? '/admin' : '/admin/metrics')}
              style={styles.logoutBtn}
              accessibilityLabel={isStaff ? 'Manage accounts' : 'System metrics'}
            >
              <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/settings')} style={styles.logoutBtn} accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={22} color={COLORS.textMuted} />
          </Pressable>
          <Pressable onPress={logout} style={styles.logoutBtn} accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={22} color={COLORS.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.badgeRow}>
        <BudgetClassBadge budgetClass={user?.budgetClass ?? null} />
        <Pressable
          style={styles.tierChip}
          onPress={() =>
            // The test-mode toggle is switched off on the server in production — say so instead of failing silently.
            setTier(isPro ? 'standard' : 'pro').catch((err) => showAlert('Plan', apiErrorMessage(err, 'Plan changes are not available yet.')))
          }
        >
          <Text style={styles.tierChipText}>{isPro ? 'Pro (test mode) · tap to reset' : 'Standard'}</Text>
        </Pressable>
      </View>

      {user && !user.emailVerified && (
        <Pressable style={styles.verifyBanner} onPress={() => router.push('/settings')}>
          <Ionicons name="mail-unread-outline" size={18} color={COLORS.yellow} />
          <Text style={styles.verifyText}>Confirm your email so you can reset your password if you forget it.</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Income</Text>
            <Text style={[styles.summaryValue, { color: COLORS.accent }]}>{fmt(summary.totalIncome)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Expense</Text>
            <Text style={[styles.summaryValue, { color: COLORS.red }]}>{fmt(summary.totalExpense)}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.savingsRow}>
          <Text style={styles.summaryLabel}>Net savings</Text>
          <Text
            style={[
              styles.savingsValue,
              { color: summary.netSavings >= 0 ? COLORS.accent : COLORS.red },
            ]}
          >
            {fmt(summary.netSavings)}
          </Text>
        </View>
      </Card>

      <View style={styles.quickLinks}>
        <Pressable style={styles.quickLink} onPress={() => router.push('/budgets')}>
          <Ionicons name="pie-chart-outline" size={18} color={COLORS.accent} />
          <Text style={styles.quickLinkText}>Budgets</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => router.push('/accounts')}>
          <Ionicons name="wallet-outline" size={18} color={COLORS.accent} />
          <Text style={styles.quickLinkText}>Accounts</Text>
        </Pressable>
      </View>

      {budgetAlerts.length > 0 && (
        <Pressable onPress={() => router.push('/budgets')}>
          <Card style={styles.alertCard}>
            <Text style={styles.alertTitle}>Budget alerts</Text>
            {budgetAlerts.map((b) => {
              const cat = getCategory(b.category);
              const over = b.status === 'over';
              return (
                <View key={b.category} style={styles.catRow}>
                  <View style={styles.catHeader}>
                    <Text style={styles.catLabel}>
                      {cat?.icon ?? '💰'} {cat?.label ?? b.category}
                    </Text>
                    <Text style={[styles.catValue, { color: over ? COLORS.red : COLORS.yellow }]}>
                      {over ? `${fmt(b.spent - b.monthly_limit)} over` : `${Math.round(b.ratio * 100)}% used`}
                    </Text>
                  </View>
                  <MiniBar percent={b.ratio * 100} color={over ? COLORS.red : COLORS.yellow} />
                </View>
              );
            })}
          </Card>
        </Pressable>
      )}
      {!hasBudgets && isCurrentMonth && (
        <Text style={styles.hintText}>Tip: set monthly limits under Budgets and you’ll be warned here at 80%.</Text>
      )}

      <Text style={styles.sectionTitle}>{isCurrentMonth ? "This month's" : viewLabel} breakdown</Text>
      <Card>
        {breakdown.expense + breakdown.loan + breakdown.investment === 0 ? (
          <Text style={styles.emptyText}>{isCurrentMonth ? 'Nothing logged yet — try adding a transaction.' : 'Nothing logged this month.'}</Text>
        ) : (
          (['expense', 'loan', 'investment'] as CategoryBucket[]).map((bucket, idx) => (
            <View key={bucket} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
              <View style={styles.catHeader}>
                <Text style={styles.catLabel}>{BUCKET_LABEL[bucket]}</Text>
                <Text style={[styles.catValue, { color: BUCKET_COLOR[bucket] }]}>{fmt(breakdown[bucket])}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.sectionTitle}>Top expense categories</Text>
      <Card>
        {topCategories.length === 0 ? (
          <Text style={styles.emptyText}>No expenses logged this month yet.</Text>
        ) : (
          topCategories.map((c, idx) => {
            const cat = getCategory(c.category);
            return (
              <View key={c.category} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>
                    {cat?.icon ?? '💰'} {cat?.label ?? c.category}
                  </Text>
                  <Text style={styles.catValue}>{fmt(c.total)}</Text>
                </View>
                <MiniBar percent={(c.total / maxCategoryTotal) * 100} color={cat?.color} />
              </View>
            );
          })
        )}
      </Card>

      <Text style={styles.sectionTitle}>Pro insights</Text>
      <ProGate
        title="Spending insights"
        description="Month-over-month trends, loan payoff ETA, and goal projections — available on Pro."
      >
        <Card>
          <View style={[styles.catRow]}>
            <View style={styles.catHeader}>
              <Text style={styles.catLabel}>Savings rate this month</Text>
              <Text style={[styles.catValue, { color: savingsRate >= 0 ? COLORS.accent : COLORS.red }]}>
                {savingsRate.toFixed(0)}%
              </Text>
            </View>
          </View>
          {deltas.length === 0 ? (
            <Text style={styles.emptyText}>Not enough history yet to compare months.</Text>
          ) : (
            deltas.map((d) => {
              const cat = getCategory(d.category);
              const label = d.deltaPct == null ? 'New this month' : `${d.deltaPct >= 0 ? '+' : ''}${d.deltaPct.toFixed(0)}% vs last month`;
              return (
                <View key={d.category} style={[styles.catRow, styles.catRowBorder]}>
                  <View style={styles.catHeader}>
                    <Text style={styles.catLabel}>{cat?.icon ?? '💰'} {cat?.label ?? d.category}</Text>
                    <Text style={[styles.catValue, { color: d.deltaAmount >= 0 ? COLORS.red : COLORS.accent }]}>{label}</Text>
                  </View>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  monthLabel: { color: COLORS.textMuted, fontSize: 13 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: 2 },
  monthArrow: { padding: 2 },
  monthArrowDisabled: { opacity: 0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  logoutBtn: { padding: SPACING.xs },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  tierChip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  tierChipText: { color: COLORS.textMuted, fontSize: 11 },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: `${COLORS.yellow}66`,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    backgroundColor: COLORS.card,
  },
  verifyText: { flex: 1, color: COLORS.text, fontSize: 12.5 },
  quickLinks: { flexDirection: 'row', gap: SPACING.sm },
  quickLink: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
  },
  quickLinkText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  alertCard: { borderColor: `${COLORS.yellow}66` },
  alertTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: SPACING.xs },
  hintText: { color: COLORS.textDim, fontSize: 12 },
  summaryCard: { marginTop: SPACING.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { flex: 1 },
  summaryLabel: { color: COLORS.textMuted, fontSize: 12 },
  summaryValue: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  divider: { height: 1, backgroundColor: COLORS.cardBorder, marginVertical: SPACING.sm },
  savingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  savingsValue: { fontSize: 18, fontWeight: '700' },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.md },
  catRow: { paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  catLabel: { color: COLORS.text, fontSize: 13 },
  catValue: { color: COLORS.textMuted, fontSize: 13 },
});
