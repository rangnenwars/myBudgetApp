import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Switch,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { CategoryPicker } from '../../components/CategoryPicker';
import { DateField } from '../../components/DateField';
import { RepeatingEntries } from '../../components/RepeatingEntries';
import { useAuth } from '../../context/AuthContext';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import {
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getTransactions,
  getRecurring,
  repeatTransactionMonthly,
  Transaction,
  RecurringTransaction,
  TxnType,
} from '../../utils/database';
import { monthlyEquivalent, EntryPeriod } from '../../utils/calculations';
import { todayLocalIso, entryDateError, monthYearOf } from '../../utils/dates';
import { useCategories } from '../../context/CategoriesContext';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

// 'once' logs the exact amount on the chosen date; the others convert a recurring bill to its monthly equivalent.
type TxnPeriod = 'once' | EntryPeriod;

const PERIOD_OPTIONS: { key: TxnPeriod; label: string }[] = [
  { key: 'once', label: 'Once' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
];

export default function TransactionsScreen() {
  const { user } = useAuth();
  const { getCategory } = useCategories();
  const [items, setItems] = useState<Transaction[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [type, setType] = useState<TxnType>('expense');
  const [period, setPeriod] = useState<TxnPeriod>('once');
  const [date, setDate] = useState(todayLocalIso());
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [repeatingOpen, setRepeatingOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    // Transactions first: the server posts any due repeating entries while serving this request.
    setItems(await getTransactions());
    setRules(await getRecurring());
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const resetForm = () => {
    setEditingId(null);
    setType('expense');
    setPeriod('once');
    setRepeat(false);
    setDate(todayLocalIso());
    setAmount('');
    setCategory(null);
    setNote('');
    setError(null);
  };

  const openAdd = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (item: Transaction) => {
    setEditingId(item.id);
    setType(item.type);
    setPeriod('once'); // editing works on the amount as stored — see the period note below
    setDate(item.date);
    setRepeat(false);
    setAmount(String(item.amount));
    setCategory(item.category);
    setNote(item.note ?? '');
    setError(null);
    setModalOpen(true);
  };

  const onSave = async () => {
    if (!user) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!category) {
      setError('Choose a category.');
      return;
    }
    const dateError = entryDateError(date, todayLocalIso());
    if (dateError) {
      setError(dateError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        // Editing works on the amount exactly as stored — period only
        // applies when logging a new bill, not when fixing an existing row.
        await updateTransaction(editingId, {
          amount: value,
          type,
          category,
          note: note.trim() || null,
          date,
        });
        if (repeat) await repeatTransactionMonthly(editingId);
      } else {
        const recurring = period !== 'once' && period !== 'monthly';
        await addTransaction({
          amount: period === 'once' ? value : monthlyEquivalent(value, period),
          type,
          category,
          subcategory: null,
          note: note.trim() || (recurring ? `${period} entry — original ${fmt(value)}` : null),
          date,
          ...monthYearOf(date),
          repeat_monthly: repeat || undefined,
        });
      }
      resetForm();
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the transaction.'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (id: number) => {
    confirmAction('Delete transaction', 'Remove this transaction?', 'Delete', async () => {
      await deleteTransaction(id);
      await load();
    });
  };

  const query = search.trim().toLowerCase();
  const filteredItems = query
    ? items.filter((item) => {
        const cat = getCategory(item.category);
        return (
          (cat?.label ?? item.category).toLowerCase().includes(query) ||
          (item.note ?? '').toLowerCase().includes(query) ||
          item.date.includes(query) ||
          String(item.amount).includes(query)
        );
      })
    : items;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transactions</Text>
        <View style={styles.headerActions}>
          {rules.length > 0 && (
            <Pressable style={styles.repeatChip} onPress={() => setRepeatingOpen(true)}>
              <Ionicons name="repeat" size={14} color={COLORS.textMuted} />
              <Text style={styles.repeatChipText}>Repeating · {rules.length}</Text>
            </Pressable>
          )}
          <Pressable style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={22} color="#04140D" />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textDim} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions"
          placeholderTextColor={COLORS.textDim}
        />
        {search.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={COLORS.textDim} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {query ? `No transactions match "${search.trim()}"` : 'No transactions yet. Tap + to add one.'}
          </Text>
        }
        renderItem={({ item }) => {
          const cat = getCategory(item.category);
          return (
            <Pressable style={styles.row} onPress={() => openEdit(item)}>
              <Text style={styles.rowIcon}>{cat?.icon ?? '💰'}</Text>
              <View style={styles.rowMid}>
                <Text style={styles.rowLabel}>{cat?.label ?? item.category}</Text>
                <Text style={styles.rowDate}>{item.date}{item.note ? ` · ${item.note}` : ''}</Text>
              </View>
              <Text style={[styles.rowAmount, { color: item.type === 'income' ? COLORS.accent : COLORS.red }]}>
                {item.type === 'income' ? '+' : '-'}{fmt(item.amount)}
              </Text>
              <Pressable
                hitSlop={8}
                style={styles.rowDeleteBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
              >
                <Ionicons name="trash-outline" size={16} color={COLORS.red} />
              </Pressable>
            </Pressable>
          );
        }}
      />

      <Modal visible={modalOpen} animationType={MODAL_ANIMATION} transparent onRequestClose={() => { setModalOpen(false); resetForm(); }}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId != null ? 'Edit transaction' : 'Add transaction'}</Text>
              <Pressable onPress={() => { setModalOpen(false); resetForm(); }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <View style={styles.typeToggle}>
              {(['expense', 'income'] as TxnType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                  onPress={() => { setType(t); setCategory(null); }}
                >
                  <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                    {t === 'expense' ? 'Expense' : 'Income'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Date</Text>
            <DateField value={date} onChange={setDate} />

            {editingId == null && (
              <>
                <Text style={styles.label}>Period</Text>
                <View style={styles.typeToggle}>
                  {PERIOD_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.key}
                      style={[styles.typeBtn, period === opt.key && styles.typeBtnActive]}
                      onPress={() => setPeriod(opt.key)}
                    >
                      <Text style={[styles.typeBtnText, period === opt.key && styles.typeBtnTextActive]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {period !== 'once' && period !== 'monthly' && (
                  <Text style={styles.hint}>
                    Logged as the monthly equivalent ({period === 'quarterly' ? '÷3' : '÷12'}) — the original amount is kept in the note.
                  </Text>
                )}
              </>
            )}

            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={COLORS.textDim}
              keyboardType="numeric"
            />

            <Text style={styles.label}>Category</Text>
            <CategoryPicker type={type} value={category} onChange={setCategory} />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Add a note"
              placeholderTextColor={COLORS.textDim}
            />

            <View style={styles.repeatRow}>
              <View style={styles.repeatText}>
                <Text style={styles.repeatLabel}>Repeat every month</Text>
                <Text style={styles.hint}>
                  {repeat
                    ? 'Added again on the 1st of each following month, until you stop it under "Repeating".'
                    : 'Turn on for salary, rent or any fixed monthly amount.'}
                </Text>
              </View>
              <Switch
                value={repeat}
                onValueChange={setRepeat}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save transaction'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <RepeatingEntries
        visible={repeatingOpen}
        rules={rules}
        onClose={() => setRepeatingOpen(false)}
        onChanged={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  repeatChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  repeatChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  repeatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md, marginTop: SPACING.xs },
  repeatText: { flex: 1 },
  repeatLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  addBtn: {
    backgroundColor: COLORS.accent,
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, paddingVertical: 9 },
  listContent: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.xs },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  rowIcon: { fontSize: 20, marginRight: SPACING.sm },
  rowMid: { flex: 1 },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowDate: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  rowDeleteBtn: { marginLeft: SPACING.sm, padding: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  typeToggle: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADIUS.sm },
  typeBtnActive: { backgroundColor: COLORS.accent },
  typeBtnText: { color: COLORS.textMuted, fontWeight: '600' },
  typeBtnTextActive: { color: '#04140D' },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  hint: { color: COLORS.textDim, fontSize: 11.5, marginTop: -SPACING.xs },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  saveBtnText: { color: '#04140D', fontWeight: '700', fontSize: 16 },
});
