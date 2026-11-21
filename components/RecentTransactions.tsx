import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './i18n';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { TourTarget } from '../context/TourTargetsContext';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import { getTransactionsPage, Transaction } from '../utils/database';
import { recentDateLabel, todayLocalIso } from '../utils/dates';

import { t } from '../utils/i18n';
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
    <TourTarget id="home-recent" style={{ gap: SPACING.md }}>
      <Text style={styles.sectionTitle}>Recent transactions</Text>
      <Card>
        {items.map((txn, i) => {
          const cat = getCategory(txn.category);
          return (
            <Pressable
              key={txn.id}
              style={[styles.row, i !== 0 && styles.rowBorder]}
              onPress={() => router.push('/(tabs)/transactions')}
              accessibilityRole="link"
              accessibilityLabel={t('{0} {1}, open transactions', { 0: cat?.label ?? txn.category, 1: fmt(txn.amount) })}
            >
              <Text style={styles.icon}>{cat?.icon ?? '💰'}</Text>
              <View style={styles.mid}>
                <Text style={styles.label} numberOfLines={1}>
                  {cat?.label ?? txn.category}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {recentDateLabel(txn.date, today)}
                  {txn.note ? ` · ${txn.note}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: txn.type === 'income' ? COLORS.accent : COLORS.red }]}>
                {txn.type === 'income' ? '+' : '-'}
                {fmt(txn.amount)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => router.push('/(tabs)/transactions')} accessibilityRole="link" style={styles.seeAll}>
          <Text style={styles.seeAllText}>See all ›</Text>
        </Pressable>
      </Card>
    </TourTarget>
  );
};

const styles = StyleSheet.create({
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  icon: { fontSize: 18 },
  mid: { flex: 1 },
  label: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  sub: { color: COLORS.textDim, fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '700', flexShrink: 0 },
  seeAll: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: SPACING.sm, alignItems: 'flex-end' },
  seeAllText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
});
