import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
  const { getCategory } = useCategories();
  const [items, setItems] = useState<BudgetStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<BudgetStatus | 'new' | null>(null);
  const [category, setCategory] = useState<string | null>(null);
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

  const openNew = () => {
    setEditing('new');
    setIsNew(true);
    setCategory(null);
    setLimit('');
    setError(null);
  };

  const openEdit = (b: BudgetStatus) => {
    setEditing(b);
    setIsNew(false);
    setCategory(b.category);
    setLimit(String(b.monthly_limit));
    setError(null);
  };

  const onSave = async () => {
    const value = Number(limit);
    if (!category) {
      setError('Choose a category.');
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
      await setBudget(category, value);
      setEditing(null);
      await load();
    } catch (err) {
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
            <Ionicons name="add" size={22} color="#04140D" />
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
            <Text style={kit.muted}>Category</Text>
            <CategoryPicker type="expense" value={category} onChange={setCategory} />
            <Field label="Monthly limit" value={limit} onChangeText={setLimit} placeholder="0" keyboardType="numeric" />
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
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowStatus: { fontSize: 14, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
});
