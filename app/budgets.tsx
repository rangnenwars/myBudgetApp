import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../components/Card';
import { MiniBar } from '../components/MiniBar';
import { CategoryPicker } from '../components/CategoryPicker';
import { ScreenHeader, Field, Button, ErrorText, fmtInr, kit } from '../components/ScreenKit';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { apiErrorMessage } from '../utils/api';
import { confirmAction } from '../utils/alert';
import { getBudgets, setBudget, deleteBudget, BudgetStatus } from '../utils/database';

export const STATUS_COLOR: Record<BudgetStatus['status'], string> = { ok: COLORS.accent, warning: COLORS.yellow, over: COLORS.red };

// Monthly spending limits per expense category, with this month's spending
// against each. The dashboard shows the ones at 80%+ as alerts.
export default function BudgetsScreen() {
  const { user, isLoading } = useAuth();
  const { getCategory, groupCategories } = useCategories();
  const [items, setItems] = useState<BudgetStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<BudgetStatus | 'new' | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  // New budgets can cover several categories at once (same limit for each).
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Separate from `editing` so the sheet keeps its title while it animates closed.
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(await getBudgets());
    setLoaded(true);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setLoaded(true));
    }, [load])
  );

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const totalLimit = items.reduce((s, b) => s + b.monthly_limit, 0);
  const totalSpent = items.reduce((s, b) => s + b.spent, 0);
  const budgeted = new Set(items.map((b) => b.category));

  const openNew = () => {
    setEditing('new');
    setIsNew(true);
    setCategory(null);
    setSelected([]);
    setLimit('');
    setError(null);
  };

  const toggle = (key: string) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const openEdit = (b: BudgetStatus) => {
    setEditing(b);
    setIsNew(false);
    setCategory(b.category);
    setLimit(String(b.monthly_limit));
    setError(null);
  };

  const onSave = async () => {
    const value = Number(limit);
    const keys = isNew ? selected : category ? [category] : [];
    if (keys.length === 0) {
      setError(isNew ? 'Choose at least one category.' : 'Choose a category.');
      return;
    }
    if (!value || value <= 0) {
      setError('Enter a monthly limit above zero.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Changing the category of an existing limit = remove the old one, set the new one.
      if (editing && editing !== 'new' && editing.category !== category) await deleteBudget(editing.category);
      for (const key of keys) await setBudget(key, value);
      setEditing(null);
      await load();
    } catch (err) {
      await load().catch(() => {}); // some of the selected categories may already be saved
      setError(apiErrorMessage(err, 'Could not save the budget.'));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    if (!editing || editing === 'new') return;
    const b = editing;
    confirmAction('Remove budget', `Stop tracking a limit for ${getCategory(b.category)?.label ?? b.category}?`, 'Remove', async () => {
      await deleteBudget(b.category);
      setEditing(null);
      await load();
    });
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader
        title="Budgets"
        right={
          <Pressable style={styles.addBtn} onPress={openNew} accessibilityLabel="Add budget">
            <Ionicons name="add" size={22} color={COLORS.onAccent} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={kit.content}>
        {items.length > 0 && (
          <Card style={styles.summary}>
            <Text style={kit.muted}>{monthLabel}</Text>
            <Text style={styles.summaryValue}>
              {fmtInr(totalSpent)} <Text style={kit.muted}>of {fmtInr(totalLimit)}</Text>
            </Text>
            <MiniBar percent={totalLimit ? (totalSpent / totalLimit) * 100 : 0} color={totalSpent > totalLimit ? COLORS.red : COLORS.accent} />
          </Card>
        )}

        {loaded && items.length === 0 ? (
          <Text style={kit.empty}>No budgets yet. Tap + to set a monthly limit for a category — you’ll be warned on the dashboard at 80%.</Text>
        ) : (
          items.map((b) => {
            const cat = getCategory(b.category);
            const left = b.monthly_limit - b.spent;
            return (
              <Pressable key={b.category} onPress={() => openEdit(b)}>
                <Card style={styles.row}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowLabel}>
                      {cat?.icon ?? '💰'} {cat?.label ?? b.category}
                    </Text>
                    <Text style={[styles.rowStatus, { color: STATUS_COLOR[b.status] }]}>{Math.round(b.ratio * 100)}%</Text>
                  </View>
                  <MiniBar percent={b.ratio * 100} color={STATUS_COLOR[b.status]} />
                  <Text style={kit.dim}>
                    {fmtInr(b.spent)} of {fmtInr(b.monthly_limit)} · {left >= 0 ? `${fmtInr(left)} left` : `${fmtInr(-left)} over`}
                  </Text>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={editing != null} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isNew ? 'New budget' : 'Edit budget'}</Text>
              <Pressable onPress={() => setEditing(null)} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Text style={kit.muted}>{isNew ? 'Categories (tick one or more)' : 'Category'}</Text>
            {isNew ? (
              <ScrollView style={styles.checkList} nestedScrollEnabled>
                {groupCategories('expense').map((g) => {
                  const free = g.items.filter((c) => !budgeted.has(c.key));
                  if (free.length === 0) return null;
                  return (
                    <View key={g.group}>
                      <Text style={styles.groupTitle}>{g.group}</Text>
                      {free.map((c) => {
                        const on = selected.includes(c.key);
                        return (
                          <Pressable key={c.key} style={styles.checkRow} onPress={() => toggle(c.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? COLORS.accent : COLORS.textMuted} />
                            <Text style={styles.checkLabel}>
                              {c.icon} {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <CategoryPicker type="expense" value={category} onChange={setCategory} />
            )}
            <Field label={isNew && selected.length > 1 ? `Monthly limit (applied to each of ${selected.length})` : 'Monthly limit'} value={limit} onChangeText={setLimit} placeholder="0" keyboardType="numeric" />
            <ErrorText message={error} />
            <Button label={busy ? 'Saving…' : 'Save'} onPress={onSave} disabled={busy} />
            {!isNew && <Button label="Remove budget" variant="danger" onPress={onRemove} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: { backgroundColor: COLORS.accent, width: 34, height: 34, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  summary: { gap: SPACING.xs },
  summaryValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  row: { gap: SPACING.xs },
  checkList: { maxHeight: 260 },
  groupTitle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: SPACING.sm, marginBottom: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8 },
  checkLabel: { color: COLORS.text, fontSize: 14 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowStatus: { fontSize: 14, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
});
