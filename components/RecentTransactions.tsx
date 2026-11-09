import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import { getTransactionsPage, Transaction } from '../utils/database';
import { recentDateLabel, todayLocalIso } from '../utils/dates';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const ROWS = 3;

/** Home: the last few transactions, newest first. Hidden until there is one. */
export const RecentTransactions: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const [items, setItems] = useState<Transaction[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getTransactionsPage({ limit: ROWS })
        .then((page) => active && setItems(page.items.slice(0, ROWS)))
        .catch(() => active && setItems([]));
      return () => {
        active = false;
      };
    }, [user?.id, refreshKey])
  );

  if (items.length === 0) return null;
  const today = todayLocalIso();

  return (
    <>
      <Text style={styles.sectionTitle}>Recent transactions</Text>
      <Card>
        {items.map((t, i) => {
          const cat = getCategory(t.category);
          return (
            <Pressable
              key={t.id}
              style={[styles.row, i !== 0 && styles.rowBorder]}
              onPress={() => router.push('/(tabs)/transactions')}
              accessibilityRole="link"
              accessibilityLabel={`${cat?.label ?? t.category} ${fmt(t.amount)}, open transactions`}
            >
              <Text style={styles.icon}>{cat?.icon ?? '💰'}</Text>
              <View style={styles.mid}>
                <Text style={styles.label} numberOfLines={1}>
                  {cat?.label ?? t.category}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {recentDateLabel(t.date, today)}
                  {t.note ? ` · ${t.note}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: t.type === 'income' ? COLORS.accent : COLORS.red }]}>
                {t.type === 'income' ? '+' : '-'}
                {fmt(t.amount)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => router.push('/(tabs)/transactions')} accessibilityRole="link" style={styles.seeAll}>
          <Text style={styles.seeAllText}>See all ›</Text>
        </Pressable>
      </Card>
    </>
  );
};

const styles = StyleSheet.create({
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  icon: { fontSize: 18 },
  mid: { flex: 1 },
  label: { color: COLORS.text, fontSize: 14 },
  sub: { color: COLORS.textDim, fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '700' },
  seeAll: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: SPACING.sm, alignItems: 'flex-end' },
  seeAllText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
});
