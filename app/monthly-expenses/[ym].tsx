import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { MiniBar } from '../../components/MiniBar';
import { ScreenHeader, fmtInr } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCategories } from '../../context/CategoriesContext';
import { getCategoryBreakdown, CategoryTotal } from '../../utils/database';
import { OTHERS_KEY, categoryRows } from '../../utils/expenseReports';
import { monthFilter, txnLink } from '../../utils/txnLink';

// Month detail for Reports > Monthly: where that month's money went.
const KEEP = 3;

export default function MonthlyExpenseDetailScreen() {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const { ym } = useLocalSearchParams<{ ym: string }>();
  const [year, month] = String(ym ?? '').split('-').map(Number);
  const [breakdown, setBreakdown] = useState<CategoryTotal[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user || !year || !month) return;
      let active = true;
      getCategoryBreakdown(month, year, 'expense')
        .then((r) => active && (setBreakdown(r), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id, year, month])
  );

  const title = year && month ? new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'Month';
  const { total, rows } = categoryRows(breakdown ?? [], null, KEEP, (c) => !!getCategory(c));

  return (
    <View style={styles.flex}>
      <ScreenHeader title={title} right={breakdown ? <Text style={styles.headerTotal}>{fmtInr(total)}</Text> : undefined} />
      <ScrollView contentContainerStyle={styles.container}>
        {!breakdown ? (
          <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this month. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
        ) : rows.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No expenses in {title}.</Text>
          </Card>
        ) : (
          <Card>
            {rows.map((r, i) => {
              const cat = r.category === OTHERS_KEY ? null : getCategory(r.category);
              const label = r.category === OTHERS_KEY ? 'Others' : `${cat?.icon ?? '💰'} ${cat?.label ?? r.category}`;
              const body = (
                <>
                  <View style={styles.rowTop}>
                    <Text style={styles.label}>{label}</Text>
                    <Text style={styles.amount}>
                      {fmtInr(r.total)} <Text style={styles.share}>{r.sharePct}%</Text>
                    </Text>
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
                  onPress={() => router.push(txnLink({ type: 'expense', category: r.category, ...monthFilter(year, month) }))}
                  accessibilityRole="link"
                  accessibilityLabel={`${cat?.label ?? r.category} ${fmtInr(r.total)}, see the entries`}
                >
                  {body}
                </Pressable>
              );
            })}
          </Card>
        )}

        {breakdown && (
          <Pressable style={styles.allBtn} onPress={() => router.push(txnLink({ type: 'expense', ...monthFilter(year, month) }))} accessibilityRole="button">
            <Text style={styles.allBtnText}>See all transactions ›</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', padding: SPACING.lg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  headerTotal: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  row: { paddingVertical: SPACING.sm, gap: SPACING.xs },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  amount: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  share: { color: COLORS.textDim, fontSize: 12, fontWeight: '400' },
  allBtn: { borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  allBtnText: { color: COLORS.accent, fontWeight: '700', fontSize: 15 },
});
