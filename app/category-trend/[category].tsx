import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { MiniBar } from '../../components/MiniBar';
import { yearFilter } from '../../components/CategoriesView';
import { ScreenHeader, fmtInr } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCategories } from '../../context/CategoriesContext';
import { getTransactionsForRange } from '../../utils/database';
import { MonthTotal, categoryByMonth } from '../../utils/expenseReports';
import { monthFilter, txnLink } from '../../utils/txnLink';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Year view of Reports > Categories: one category, month by month.
export default function CategoryTrendScreen() {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const { category, year: yearParam } = useLocalSearchParams<{ category: string; year: string }>();
  const year = Number(yearParam);
  const [months, setMonths] = useState<MonthTotal[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user || !category || !year) return;
      let active = true;
      getTransactionsForRange(1, year, 12, year)
        .then((rows) => active && (setMonths(categoryByMonth(rows, category)), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id, category, year])
  );

  const cat = getCategory(String(category));
  const total = months?.reduce((s, m) => s + m.total, 0) ?? 0;
  const max = Math.max(0, ...(months ?? []).map((m) => m.total));
  const now = new Date();
  const today = { month: now.getMonth() + 1, year: now.getFullYear() };

  return (
    <View style={styles.flex}>
      <ScreenHeader title={`${cat?.label ?? category} · ${year}`} right={months ? <Text style={styles.headerTotal}>{fmtInr(total)}</Text> : undefined} />
      <ScrollView contentContainerStyle={styles.container}>
        {!months ? (
          <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
        ) : total === 0 ? (
          <Card>
            <Text style={styles.muted}>No {cat?.label ?? 'expenses'} in {year}.</Text>
          </Card>
        ) : (
          <Card>
            {months.map((m, i) => (
              <Pressable
                key={m.month}
                style={[styles.row, i !== 0 && styles.rowBorder]}
                onPress={() => router.push(txnLink({ type: 'expense', category: String(category), ...monthFilter(year, m.month) }))}
                accessibilityRole="link"
                accessibilityLabel={`${MONTHS[m.month - 1]} ${year}, ${fmtInr(m.total)}, see the entries`}
              >
                <Text style={styles.month}>{MONTHS[m.month - 1]}</Text>
                <View style={styles.bar}>
                  <MiniBar percent={max > 0 ? (m.total / max) * 100 : 0} color={cat?.color ?? COLORS.red} />
                </View>
                <Text style={styles.amount}>{fmtInr(m.total)}</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {months && total > 0 && (
          <Pressable
            style={styles.allBtn}
            onPress={() => router.push(txnLink({ type: 'expense', category: String(category), ...yearFilter(year, today) }))}
            accessibilityRole="button"
          >
            <Text style={styles.allBtnText}>See transactions ›</Text>
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
  headerTotal: { color: COLORS.text, fontSize: 15, fontWeight: '700', flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  month: { color: COLORS.text, fontSize: 13, width: 32, flexShrink: 1 },
  bar: { flex: 1 },
  amount: { color: COLORS.text, fontSize: 13, fontWeight: '700', minWidth: 76, textAlign: 'right', flexShrink: 0 },
  allBtn: { borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  allBtnText: { color: COLORS.accent, fontWeight: '700', fontSize: 15 },
});
