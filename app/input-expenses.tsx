import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { CategoryPicker } from '../components/CategoryPicker';
import { useAuth } from '../context/AuthContext';
import { addTransactionsBatch } from '../utils/database';
import { todayLocalIso } from '../utils/dates';
import { bucketForGroup, monthlyEquivalent, EntryPeriod, CategoryBucket } from '../utils/calculations';
import { useCategories } from '../context/CategoriesContext';
import { showAlert } from '../utils/alert';
import { apiErrorMessage } from '../utils/api';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

interface Row {
  id: number;
  category: string | null;
  amount: string;
}

const PERIOD_OPTIONS: { key: EntryPeriod; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
];

const BUCKET_LABEL: Record<CategoryBucket, string> = { expense: 'Expense', loan: 'Loan', investment: 'Investment' };
const BUCKET_COLOR: Record<CategoryBucket, string> = { expense: COLORS.textMuted, loan: COLORS.blue, investment: COLORS.purple };

let nextRowId = 1;
const emptyRow = (): Row => ({ id: nextRowId++, category: null, amount: '' });

export default function InputExpensesScreen() {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const [period, setPeriod] = useState<EntryPeriod>('monthly');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateRow = (id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (id: number) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const onSave = async () => {
    if (!user) return;
    setError(null);
    const valid = rows.filter((r) => r.category && parseFloat(r.amount) > 0);
    if (valid.length === 0) {
      setError('Add at least one row with a category and an amount.');
      return;
    }
    setSaving(true);
    // The device's local date — toISOString() is UTC, which in India is
    // still yesterday until 5:30 am and would file the entries in the wrong month.
    const date = todayLocalIso();
    try {
      // One all-or-nothing request: a failure saves nothing, so retrying can't duplicate rows.
      await addTransactionsBatch(
        valid.map((row) => {
          const original = parseFloat(row.amount);
          return {
            amount: monthlyEquivalent(original, period),
            type: 'expense' as const,
            category: row.category!,
            subcategory: null,
            note: period === 'monthly' ? null : `${period} entry — original ${fmt(original)}`,
            date,
          };
        })
      );
      showAlert('Saved', `Logged ${valid.length} expense${valid.length === 1 ? '' : 's'} for this month.`, () => router.back());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save these expenses.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Input expenses</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Period</Text>
        <View style={styles.periodToggle}>
          {PERIOD_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.periodBtn, period === opt.key && styles.periodBtnActive]}
              onPress={() => setPeriod(opt.key)}
            >
              <Text style={[styles.periodBtnText, period === opt.key && styles.periodBtnTextActive]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
        {period !== 'monthly' && (
          <Text style={styles.hint}>
            Amounts are divided ({period === 'quarterly' ? '÷3' : '÷12'}) and logged as this month’s equivalent expense.
          </Text>
        )}

        <Text style={[styles.label, { marginTop: SPACING.md }]}>Categories</Text>
        {rows.map((row) => {
          const cat = row.category ? getCategory(row.category) : undefined;
          const bucket = cat ? bucketForGroup(cat.group) : null;
          return (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <CategoryPicker type="expense" value={row.category} onChange={(v) => updateRow(row.id, { category: v })} />
                </View>
                <Pressable onPress={() => removeRow(row.id)} style={styles.removeBtn}>
                  <Ionicons name="close" size={18} color={COLORS.textMuted} />
                </Pressable>
              </View>
              <View style={styles.rowBottom}>
                <TextInput
                  style={[styles.input, styles.amountInput]}
                  value={row.amount}
                  onChangeText={(v) => updateRow(row.id, { amount: v })}
                  placeholder="Amount"
                  placeholderTextColor={COLORS.textDim}
                  keyboardType="numeric"
                />
                {bucket && (
                  <View style={[styles.bucketChip, { borderColor: BUCKET_COLOR[bucket] }]}>
                    <Text style={[styles.bucketChipText, { color: BUCKET_COLOR[bucket] }]}>{BUCKET_LABEL[bucket]}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <Pressable style={styles.addRowBtn} onPress={addRow}>
          <Ionicons name="add" size={18} color={COLORS.accent} />
          <Text style={styles.addRowBtnText}>Add row</Text>
        </Pressable>

        <Text style={styles.moveHint}>
          To move a row between Expense, Loan, and Investment, just change its category — the badge updates automatically (e.g. pick a credit card category to mark it as a Loan).
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  backBtn: { width: 30 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  container: { padding: SPACING.lg, gap: SPACING.xs, paddingBottom: SPACING.xl * 2 },
  label: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xs },
  periodToggle: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  periodBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADIUS.sm },
  periodBtnActive: { backgroundColor: COLORS.accent },
  periodBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  periodBtnTextActive: { color: COLORS.onAccent },
  hint: { color: COLORS.textDim, fontSize: 12, marginTop: SPACING.xs },
  row: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  removeBtn: { padding: 6 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
  },
  amountInput: { flex: 1 },
  bucketChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  bucketChipText: { fontSize: 11, fontWeight: '600' },
  addRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    marginTop: SPACING.md,
  },
  addRowBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: 13 },
  moveHint: { color: COLORS.textDim, fontSize: 11.5, marginTop: SPACING.md, lineHeight: 16 },
  error: { color: COLORS.red, fontSize: 13, marginTop: SPACING.sm },
  saveBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});
