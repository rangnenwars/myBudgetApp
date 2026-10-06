import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, Modal, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../components/Card';
import { MiniBar } from '../components/MiniBar';
import { CategoryPicker } from '../components/CategoryPicker';
import { ScreenHeader, Field, Button, ErrorText, Notice, SectionTitle, fmtInr, kit } from '../components/ScreenKit';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { apiErrorMessage } from '../utils/api';
import { confirmAction } from '../utils/alert';
import {
  getBudgets,
  setBudget,
  deleteBudget,
  getOverallBudget,
  setOverallBudget,
  clearOverallBudget,
  countsTowardBudget,
  BudgetStatus,
  OverallBudget,
} from '../utils/database';

export const STATUS_COLOR: Record<BudgetStatus['status'], string> = { ok: COLORS.accent, warning: COLORS.yellow, over: COLORS.red };

// One overall monthly budget (e.g. ₹15,000) with optional category limits
// set aside inside it. Every month starts fresh — nothing carries over.
// The dashboard shows what is left and a per-day figure.
export default function BudgetsScreen() {
  const { user, isLoading } = useAuth();
  const { getCategory } = useCategories();
  const [items, setItems] = useState<BudgetStatus[]>([]);
  const [overall, setOverall] = useState<OverallBudget | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Overall budget sheet
  const [overallOpen, setOverallOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [includeCommitments, setIncludeCommitments] = useState(false);

  // Category limit sheet
  const [editing, setEditing] = useState<BudgetStatus | 'new' | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [limit, setLimit] = useState('');
  // Separate from `editing` so the sheet keeps its title while it animates closed.
  const [isNew, setIsNew] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [limits, total] = await Promise.all([getBudgets(), getOverallBudget()]);
    setItems(limits);
    setOverall(total);
    setLoaded(true);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setLoaded(true));
    }, [load])
  );

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const total = overall?.amount ?? null;
  const budgeted = new Set(items.map((b) => b.category));
  // Category limits whose spending is part of the overall total (EMI/investment
  // limits sit outside it unless the user counts those too).
  const counted = items.filter((b) => countsTowardBudget(getCategory(b.category)?.group ?? '', overall?.include_commitments ?? false));
  const otherLimit = total != null ? total - counted.reduce((s, b) => s + b.monthly_limit, 0) : 0;
  const otherSpent = overall ? Math.max(overall.spent - counted.reduce((s, b) => s + b.spent, 0), 0) : 0;
  const overAllocated = total != null && otherLimit < 0;

  const openOverall = () => {
    setAmount(total != null ? String(total) : '');
    setIncludeCommitments(overall?.include_commitments ?? false);
    setError(null);
    setOverallOpen(true);
  };

  const onSaveOverall = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a monthly budget above zero.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setOverallBudget(value, includeCommitments);
      setOverallOpen(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the budget.'));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveOverall = () => {
    confirmAction('Remove monthly budget', 'Stop tracking your monthly budget? Category limits stay.', 'Remove', async () => {
      await clearOverallBudget();
      setOverallOpen(false);
      await load();
    });
  };

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
    const replacing = editing && editing !== 'new' ? editing.category : null;
    if (category !== replacing && budgeted.has(category)) {
      setError(`${getCategory(category)?.label ?? 'That category'} already has a limit. Tap it in the list to change it.`);
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
      if (replacing && replacing !== category) await deleteBudget(replacing);
      await setBudget(category, value);
      setEditing(null);
      await load();
    } catch (err) {
      await load().catch(() => {});
      setError(apiErrorMessage(err, 'Could not save the limit.'));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    if (!editing || editing === 'new') return;
    const b = editing;
    confirmAction('Remove limit', `Stop tracking a limit for ${getCategory(b.category)?.label ?? b.category}?`, 'Remove', async () => {
      await deleteBudget(b.category);
      setEditing(null);
      await load();
    });
  };

  const overallColor = overall?.status ? STATUS_COLOR[overall.status] : COLORS.accent;
  const notSetAside = total != null ? Math.max(otherLimit, 0) : null;

  return (
    <View style={kit.screen}>
      <ScreenHeader
        title="Budgets"
        right={
          <Pressable style={styles.addBtn} onPress={openNew} accessibilityLabel="Add a category limit">
            <Ionicons name="add" size={22} color={COLORS.onAccent} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={kit.content}>
        {loaded && overall && total != null ? (
          <Pressable onPress={openOverall} accessibilityRole="button" accessibilityLabel="Edit monthly budget">
            <Card style={styles.summary}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabel}>Monthly budget · {monthLabel}</Text>
                <Ionicons name="pencil" size={16} color={COLORS.textMuted} />
              </View>
              <Text style={styles.summaryValue}>
                {fmtInr(overall.spent)} <Text style={kit.muted}>of {fmtInr(total)}</Text>
              </Text>
              <MiniBar percent={(overall.ratio ?? 0) * 100} color={overallColor} />
              <Text style={kit.dim}>
                {(overall.left ?? 0) >= 0
                  ? `${fmtInr(overall.left ?? 0)} left · ${overall.days_left} ${overall.days_left === 1 ? 'day' : 'days'} to go`
                  : `${fmtInr(-(overall.left ?? 0))} over this month`}
                {overall.include_commitments ? ' · includes EMIs and investments' : ''}
              </Text>
            </Card>
          </Pressable>
        ) : loaded ? (
          <Card style={styles.summary}>
            <Text style={styles.rowLabel}>Set one monthly number and we’ll track it for you.</Text>
            {overall?.suggested ? <Text style={kit.dim}>You spent about {fmtInr(overall.suggested)} a month over the last 3 months.</Text> : null}
            <Button label="Set monthly budget" onPress={openOverall} />
          </Card>
        ) : null}

        {overAllocated && (
          <Notice tone="warning">
            Your category limits add up to {fmtInr((total ?? 0) - otherLimit)}, more than your {fmtInr(total ?? 0)} monthly budget.
          </Notice>
        )}

        <SectionTitle>{total != null ? `Category limits (optional, inside the ${fmtInr(total)})` : 'Category limits (optional)'}</SectionTitle>

        {loaded && items.length === 0 ? (
          <Text style={kit.dim}>Want to keep an eye on one area, like eating out? Set aside part of your budget for it.</Text>
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
                    {total != null && !counted.includes(b) ? ' · not part of the monthly budget' : ''}
                  </Text>
                </Card>
              </Pressable>
            );
          })
        )}

        {total != null && items.length > 0 && otherLimit > 0 && (
          <View style={[styles.rowHeader, styles.otherRow]}>
            <Text style={kit.muted}>Everything else</Text>
            <Text style={kit.muted}>
              {fmtInr(otherSpent)} of {fmtInr(otherLimit)}
            </Text>
          </View>
        )}

        <Button label="+ Add a category limit" variant="outline" onPress={openNew} />
      </ScrollView>

      {/* Overall monthly budget */}
      <Modal visible={overallOpen} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setOverallOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Monthly budget</Text>
              <Pressable onPress={() => setOverallOpen(false)} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Field
              label="How much do you want to spend in a month?"
              value={amount}
              onChangeText={setAmount}
              placeholder="15000"
              keyboardType="numeric"
              hint="Applies every month. Each month starts fresh, so unspent money doesn't carry over."
            />
            {overall?.suggested ? (
              <Pressable onPress={() => setAmount(String(overall.suggested))} accessibilityRole="button">
                <Text style={styles.suggestion}>
                  You spent about {fmtInr(overall.suggested)} a month over the last 3 months. <Text style={styles.link}>Use this</Text>
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.rowLabel}>Count EMIs and investments too</Text>
                <Text style={kit.dim}>{includeCommitments ? 'Loan EMIs, credit-card bills and investments count toward the budget.' : 'Off: only day-to-day spending counts.'}</Text>
              </View>
              <Switch
                value={includeCommitments}
                onValueChange={setIncludeCommitments}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Count EMIs and investments too"
              />
            </View>
            <ErrorText message={error} />
            <Button label={busy ? 'Saving…' : 'Save budget'} onPress={onSaveOverall} disabled={busy} />
            {total != null && <Button label="Remove monthly budget" variant="danger" onPress={onRemoveOverall} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* One category limit */}
      <Modal visible={editing != null} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isNew ? 'Add a category limit' : 'Edit category limit'}</Text>
              <Pressable onPress={() => setEditing(null)} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Text style={kit.muted}>Category</Text>
            <CategoryPicker type="expense" value={category} onChange={setCategory} />
            <Field
              label="Monthly limit"
              value={limit}
              onChangeText={setLimit}
              placeholder="0"
              keyboardType="numeric"
              hint={notSetAside != null && isNew ? `${fmtInr(notSetAside)} of your ${fmtInr(total ?? 0)} monthly budget isn't set aside yet.` : undefined}
            />
            <ErrorText message={error} />
            <Button label={busy ? 'Saving…' : 'Save'} onPress={onSave} disabled={busy} />
            {!isNew && <Button label="Remove limit" variant="danger" onPress={onRemove} />}
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
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowStatus: { fontSize: 14, fontWeight: '700' },
  otherRow: { paddingHorizontal: SPACING.xs },
  suggestion: { color: COLORS.textMuted, fontSize: 12.5 },
  link: { color: COLORS.accent, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  switchText: { flex: 1, gap: 2 },
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
});
