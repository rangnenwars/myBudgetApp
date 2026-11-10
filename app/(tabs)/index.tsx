import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../../components/Card';
import { useSharedAmounts } from '../../components/AmountText';
import { MiniBar } from '../../components/MiniBar';
import { BudgetClassBadge } from '../../components/BudgetClassBadge';
import { ProGate } from '../../components/ProGate';
import { QuickAddSheet } from '../../components/QuickAddSheet';
import { FreeMoneyCard } from '../../components/FreeMoneyCard';
import { MoreFeaturesLink } from '../../components/MoreFeaturesLink';
import { HomeHeroCard } from '../../components/HomeHeroCard';
import { PlanStrip } from '../../components/PlanStrip';
import { RecentTransactions } from '../../components/RecentTransactions';
import { PeopleButton } from '../../components/PeopleButton';
import { useAuth } from '../../context/AuthContext';
import { useCategories } from '../../context/CategoriesContext';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { getMonthSummary, getCategoryBreakdown, getBudgets, BudgetStatus, CategoryTotal } from '../../utils/database';
import { computeCategoryDeltas, computeSavingsRate, CategoryDelta } from '../../utils/calculations';
import { shiftMonth } from '../../utils/dates';
import { monthFilter, txnLink } from '../../utils/txnLink';



const fmt = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function DashboardScreen() {
  const { user, logout, refreshBudgetClass, isPro, isStaff, canViewMetrics } = useAuth();
  const { categories, getCategory } = useCategories();
  const now = new Date();
  const currentMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const [view, setView] = useState(currentMonth);
  const isCurrentMonth = view.month === currentMonth.month && view.year === currentMonth.year;
  const viewLabel = new Date(view.year, view.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, netSavings: 0 });
  const [topCategories, setTopCategories] = useState<{ category: string; total: number }[]>([]);
  const [deltas, setDeltas] = useState<CategoryDelta[]>([]);
  const [prevExpense, setPrevExpense] = useState(0);
  // Budgets at 80% or more of their limit in the viewed month.
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetStatus[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  // Bumped after a quick add so the totals and the free-money card reload.
  const [refreshKey, setRefreshKey] = useState(0);

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

        setBudgetAlerts(budgets.filter((b) => b.status !== 'ok'));

        setSummary(monthSummary);
        setPrevExpense(prevCategories.reduce((sum, c) => sum + c.total, 0));
        setTopCategories(monthCategories.slice(0, 5));

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
    }, [user?.id, categories.length, view.month, view.year, refreshKey])
  );

  const maxCategoryTotal = topCategories[0]?.total ?? 1;
  // One line for the top strip: the worst budgets first, e.g. "Food over by ₹300 · Travel 85% used".
  const alertText = (() => {
    const sorted = [...budgetAlerts].sort((a, b) => b.ratio - a.ratio);
    const shown = sorted.slice(0, 2).map((b) => `${getCategory(b.category)?.label ?? b.category} ${b.status === 'over' ? `over by ${fmt(b.spent - b.monthly_limit)}` : `${Math.round(b.ratio * 100)}% used`}`);
    return shown.join(' · ') + (sorted.length > 2 ? ` · +${sorted.length - 2} more` : '');
  })();
  const savingsRate = computeSavingsRate(summary);
  // One size for Income / Expense / Net savings so the row looks even, and no figure wraps.
  const shared = useSharedAmounts(20, [
    { text: fmt(summary.totalIncome), value: summary.totalIncome },
    { text: fmt(summary.totalExpense), value: summary.totalExpense },
    { text: fmt(summary.netSavings), value: summary.netSavings },
  ]);

  return (
    <View style={styles.flex}>
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
        <View style={styles.tierChip}>
          <Text style={styles.tierChipText}>{isPro ? 'Pro' : 'Standard'}</Text>
        </View>
      </View>

      {user && !user.emailVerified && (
        <Pressable style={styles.verifyBanner} onPress={() => router.push('/settings')}>
          <Ionicons name="mail-unread-outline" size={18} color={COLORS.yellow} />
          <Text style={styles.verifyText}>Confirm your email so you can reset your password if you forget it.</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}

      <PlanStrip />

      {budgetAlerts.length > 0 && (
        <Pressable style={styles.alertStrip} onPress={() => router.push('/budgets')} accessibilityRole="button" accessibilityLabel={`Budget alert: ${alertText}`}>
          <Ionicons name="alert-circle-outline" size={18} color={COLORS.yellow} />
          <Text style={styles.alertText} numberOfLines={2}>
            {alertText}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}

      <HomeHeroCard month={view.month} year={view.year} isCurrentMonth={isCurrentMonth} spent={summary.totalExpense} previousSpent={prevExpense} refreshKey={refreshKey} />

      {isCurrentMonth && <FreeMoneyCard refreshKey={refreshKey} />}

      <PeopleButton
        refreshKey={refreshKey}
        beside={
          <Pressable style={styles.accountsBtn} onPress={() => router.push('/accounts')} accessibilityRole="button" accessibilityLabel="Accounts">
            <Ionicons name="wallet-outline" size={20} color={COLORS.accent} />
            <Text style={styles.accountsBtnText}>Accounts</Text>
          </Pressable>
        }
      />

      <Card>
        <View style={styles.summaryRow}>
          <Pressable style={styles.summaryItem} onLayout={shared.onLayout} onPress={() => router.push(txnLink({ type: 'income', ...monthFilter(view.year, view.month) }))} accessibilityRole="link" accessibilityLabel={`Income ${fmt(summary.totalIncome)}, see the entries`}>
            <Text style={styles.summaryLabel}>Income ›</Text>
            <Text numberOfLines={1} style={[styles.summaryValue, { color: COLORS.accent, fontSize: shared.fontSize }]}>{shared.texts[0]}</Text>
          </Pressable>
          <Pressable style={styles.summaryItem} onPress={() => router.push(txnLink({ type: 'expense', ...monthFilter(view.year, view.month) }))} accessibilityRole="link" accessibilityLabel={`Expense ${fmt(summary.totalExpense)}, see the entries`}>
            <Text style={styles.summaryLabel}>Expense ›</Text>
            <Text numberOfLines={1} style={[styles.summaryValue, { color: COLORS.red, fontSize: shared.fontSize }]}>{shared.texts[1]}</Text>
          </Pressable>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Net savings</Text>
            <Text numberOfLines={1} style={[styles.summaryValue, { color: summary.netSavings >= 0 ? COLORS.accent : COLORS.red, fontSize: shared.fontSize }]}>{shared.texts[2]}</Text>
          </View>
        </View>
      </Card>

      <Text style={styles.sectionTitle}>Top expense categories</Text>
      <Card>
        {topCategories.length === 0 ? (
          <Text style={styles.emptyText}>No expenses logged this month yet.</Text>
        ) : (
          topCategories.map((c, idx) => {
            const cat = getCategory(c.category);
            return (
              <Pressable
                key={c.category}
                style={[styles.catRow, idx !== 0 && styles.catRowBorder]}
                onPress={() => router.push(txnLink({ type: 'expense', category: c.category, ...monthFilter(view.year, view.month) }))}
                accessibilityRole="link"
                accessibilityLabel={`${cat?.label ?? c.category} ${fmt(c.total)}, see the entries`}
              >
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>
                    {cat?.icon ?? '💰'} {cat?.label ?? c.category}
                  </Text>
                  <Text style={styles.catValue}>{fmt(c.total)} ›</Text>
                </View>
                <MiniBar percent={(c.total / maxCategoryTotal) * 100} color={cat?.color} />
              </Pressable>
            );
          })
        )}
        {topCategories.length > 0 && (
          <Pressable
            style={styles.allCats}
            onPress={() => router.push({ pathname: '/(tabs)/reports', params: { view: 'categories', n: String(Date.now()) } })}
            accessibilityRole="link"
            accessibilityLabel="All categories, open Reports"
          >
            <Text style={styles.allCatsText}>All categories ›</Text>
          </Pressable>
        )}
      </Card>

      <RecentTransactions refreshKey={refreshKey} />

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

      <MoreFeaturesLink />
    </ScrollView>

    <Pressable style={styles.fab} onPress={() => setQuickOpen(true)} accessibilityRole="button" accessibilityLabel="Add an entry">
      <Ionicons name="add" size={30} color="#FFFFFF" />
    </Pressable>
    <QuickAddSheet visible={quickOpen} onClose={() => setQuickOpen(false)} onSaved={() => setRefreshKey((k) => k + 1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 3, gap: SPACING.md },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: SPACING.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.proGold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
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
  accountsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    backgroundColor: COLORS.card,
  },
  accountsBtnText: { color: COLORS.accent, fontSize: 16, fontWeight: '700' },
  alertStrip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderWidth: 1, borderColor: `${COLORS.yellow}66`, borderRadius: RADIUS.md, padding: SPACING.sm, backgroundColor: COLORS.card },
  alertText: { flex: 1, color: COLORS.text, fontSize: 12.5 },
  allCats: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: SPACING.sm, alignItems: 'flex-end' },
  allCatsText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  summaryCard: { marginTop: SPACING.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  summaryItem: { flex: 1, minWidth: 0 },
  summaryLabel: { color: COLORS.textMuted, fontSize: 12 },
  summaryValue: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  divider: { height: 1, backgroundColor: COLORS.cardBorder, marginVertical: SPACING.sm },
  savingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  savingsValue: { fontSize: 18, fontWeight: '700' },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.md },
  catRow: { paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: 6 },
  catLabel: { color: COLORS.text, fontSize: 13, flexShrink: 1 },
  catValue: { color: COLORS.textMuted, fontSize: 13, flexShrink: 0 },
});
