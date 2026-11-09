import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Switch,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { CategoryPicker } from '../../components/CategoryPicker';
import { DateField } from '../../components/DateField';
import { RepeatingEntries } from '../../components/RepeatingEntries';
import { RepeatEndField } from '../../components/RepeatEndField';
import { RepeatEndChoice, endPayload, firstRepeatDate, repeatEndError } from '../../utils/repeatEnd';
import { useAuth } from '../../context/AuthContext';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import {
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getTransactionsPage,
  TransactionPageSummary,
  getRecurring,
  repeatTransactionMonthly,
  Transaction,
  RecurringTransaction,
  RepeatFrequency,
  TxnType,
} from '../../utils/database';
import { monthlyEquivalent, EntryPeriod } from '../../utils/calculations';
import { todayLocalIso, entryDateError, monthYearOf } from '../../utils/dates';
import { useCategories } from '../../context/CategoriesContext';
import { parseAmount } from '../../utils/amount';
import { filterFromParams, monthBounds } from '../../utils/txnLink';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

// 'once' logs the exact amount on the chosen date; the others convert a recurring bill to its monthly equivalent.
type TxnPeriod = 'once' | EntryPeriod;

const FREQUENCY_OPTIONS: { key: RepeatFrequency; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
];

type TypeFilter = 'all' | TxnType;
const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expense', label: 'Expenses' },
  { key: 'income', label: 'Income' },
];

const PAGE_SIZE = 50;

// Two slim tabs above the list show what was spent today and this month; tapping one lists only that period.
type PeriodTab = 'today' | 'month';
const PERIOD_TABS: { key: PeriodTab; label: string; shown: string }[] = [
  { key: 'today', label: 'Today', shown: 'today' },
  { key: 'month', label: 'This month', shown: 'this month' },
];
const periodRange = (tab: PeriodTab): { from: string; to: string } => {
  const today = todayLocalIso();
  if (tab === 'today') return { from: today, to: today };
  const [year, month] = today.split('-').map(Number);
  return monthBounds(year, month);
};

const ordinal = (n: number) => {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
};

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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // Set when a figure on Home or Reports was tapped: that category / date range, shown as chips.
  const [link, setLink] = useState<{ category?: string; from?: string; to?: string; label?: string } | null>(null);
  const [summary, setSummary] = useState<TransactionPageSummary | null>(null);
  const [tab, setTab] = useState<PeriodTab | null>(null);
  // Expense totals for the tabs, whatever the list below is showing.
  const [totals, setTotals] = useState<{ today: number; month: number } | null>(null);
  const params = useLocalSearchParams();
  const fromLink = filterFromParams(params);
  const linkId = fromLink?.n;
  // Bumped per reload so a slow response for an older search can't overwrite a newer one.
  const requestId = useRef(0);
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
  const [frequency, setFrequency] = useState<RepeatFrequency>('monthly');
  const [repeatEnd, setRepeatEnd] = useState<RepeatEndChoice | null>(null);
  const [endTried, setEndTried] = useState(false);
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [repeatingOpen, setRepeatingOpen] = useState(false);

  // First page for the current search/filter. Searching and filtering run on
  // the server, so only one page is ever held, however long the history.
  const load = useCallback(async () => {
    if (!user) return;
    const id = ++requestId.current;
    setListLoading(true);
    try {
      // Transactions first: the server posts any due repeating entries while serving this request.
      const range = tab ? periodRange(tab) : { from: link?.from, to: link?.to };
      const page = await getTransactionsPage({ q: search.trim(), type: typeFilter === 'all' ? undefined : typeFilter, category: link?.category, from: range.from, to: range.to, limit: PAGE_SIZE });
      if (id !== requestId.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setSummary(page.summary ?? null);
      setRules(await getRecurring());
    } finally {
      if (id === requestId.current) setListLoading(false);
    }
  }, [user, search, typeFilter, link, tab]);

  // The two tab totals: expenses only, one cheap query each. Refreshed after the list loads (so
  // repeating entries that just came due are included), and after every add, edit or delete.
  const loadTotals = useCallback(async () => {
    if (!user) return;
    try {
      const [today, month] = await Promise.all(
        (['today', 'month'] as const).map((key) => {
          const range = periodRange(key);
          return getTransactionsPage({ type: 'expense', from: range.from, to: range.to, limit: 1 });
        })
      );
      setTotals({ today: today.summary?.expense ?? 0, month: month.summary?.expense ?? 0 });
    } catch {
      // Keep the last figures; the list itself still loads.
    }
  }, [user]);
  const totalsRef = useRef(loadTotals);
  useEffect(() => {
    totalsRef.current = loadTotals;
  }, [loadTotals]);

  const loadMore = async () => {
    if (!nextCursor || listLoading) return;
    const id = requestId.current;
    setListLoading(true);
    try {
      const range = tab ? periodRange(tab) : { from: link?.from, to: link?.to };
      const page = await getTransactionsPage({ q: search.trim(), type: typeFilter === 'all' ? undefined : typeFilter, category: link?.category, from: range.from, to: range.to, limit: PAGE_SIZE, cursor: nextCursor });
      if (id !== requestId.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      if (id === requestId.current) setListLoading(false);
    }
  };

  // Typing waits 300 ms for a pause before asking the server.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => {
      loadRef.current().catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [search, typeFilter, link, tab]);

  // A tapped figure arrives as route params: apply its filters (a new `n` re-applies even the same ones).
  useEffect(() => {
    if (!fromLink) return;
    setTab(null);
    setLink({ category: fromLink.category, from: fromLink.from, to: fromLink.to, label: fromLink.label });
    setTypeFilter(fromLink.type ?? 'all');
    setSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  const clearLink = () => {
    setLink(null);
    setTypeFilter('all');
    router.setParams({ n: undefined, type: undefined, category: undefined, from: undefined, to: undefined, label: undefined });
  };

  useFocusEffect(
    useCallback(() => {
      loadRef.current().then(() => totalsRef.current()).catch(() => {});
    }, [])
  );

  // Tapping a tab lists only that period; tapping it again goes back to everything. A date range
  // that came in from Home or Reports is replaced by the tab.
  const onTab = (next: PeriodTab) => {
    setLink((l) => (l?.category ? { ...l, from: undefined, to: undefined, label: undefined } : null));
    setTab((current) => (current === next ? null : next));
  };

  const resetForm = () => {
    setEditingId(null);
    setType('expense');
    setPeriod('once');
    setRepeat(false);
    setFrequency('monthly');
    setRepeatEnd(null);
    setEndTried(false);
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
    setRepeatEnd(null);
    setEndTried(false);
    setAmount(String(item.amount));
    setCategory(item.category);
    setNote(item.note ?? '');
    setError(null);
    setModalOpen(true);
  };

  const onSave = async () => {
    if (!user) return;
    const value = parseAmount(amount);
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
    if (repeat) {
      const endError = repeatEndError(date, repeatEnd);
      if (endError) {
        setEndTried(true);
        setError(endError);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        // Editing works on the amount exactly as stored — period only
        // applies when logging a new bill, not when fixing an existing row.
        // Making it repeat keeps that amount: the rule posts it in full every period.
        await updateTransaction(editingId, {
          amount: value,
          type,
          category: category!,
          note: note.trim() || null,
          date,
        });
        if (repeat) await repeatTransactionMonthly(editingId, frequency, endPayload(date, repeatEnd!));
      } else {
        // A one-off Quarterly/Yearly bill is stored as its monthly equivalent (÷3 / ÷12) with the
        // original in the note. A repeating one is stored in full: the rule posts the whole bill
        // once every quarter/year (lib/recurringTransactions.ts), so dividing it would post a third
        // or a twelfth of the real amount.
        const spread = !repeat && period !== 'once' && period !== 'monthly';
        await addTransaction({
          amount: spread ? monthlyEquivalent(value, period as EntryPeriod) : value,
          type,
          category: category!,
          subcategory: null,
          note: note.trim() || (spread ? `${period} entry — original ${fmt(value)}` : null),
          date,
          ...monthYearOf(date),
          repeat_frequency: repeat ? frequency : undefined,
          ...(repeat && repeatEnd
            ? (() => {
                const end = endPayload(date, repeatEnd);
                return 'ends_on' in end ? { repeat_ends_on: end.ends_on } : { repeat_no_end: true };
              })()
            : {}),
        });
      }
      resetForm();
      setModalOpen(false);
      await load();
      await loadTotals();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the transaction.'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (item: Transaction) => {
    const repeats = rules.some((r) => r.type === item.type && r.category === item.category && r.amount === item.amount);
    const message = repeats ? 'Remove this transaction? It repeats automatically, so the repeat is stopped too.' : 'Remove this transaction?';
    confirmAction('Delete transaction', message, 'Delete', async () => {
      await deleteTransaction(item.id, repeats);
      await load();
      await loadTotals();
    });
  };

  const query = search.trim();
  const repeatDay = Number(date.slice(8, 10)) || 1;

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
            <Ionicons name="add" size={22} color={COLORS.onAccent} />
          </Pressable>
        </View>
      </View>

      <View style={styles.periodRow}>
        {PERIOD_TABS.map((t) => {
          const active = tab === t.key;
          const value = totals ? fmt(totals[t.key]) : '–';
          return (
            <Pressable
              key={t.key}
              style={[styles.periodTab, active && styles.periodTabActive]}
              onPress={() => onTab(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label} expenses ${value}${active ? ', showing, tap to clear' : ''}`}
            >
              <Text style={[styles.periodLabel, active && styles.periodLabelActive]}>{t.label}</Text>
              <Text style={[styles.periodAmount, active && styles.periodAmountActive]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textDim} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search notes, categories or amounts"
          placeholderTextColor={COLORS.textDim}
        />
        {search.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={COLORS.textDim} />
          </Pressable>
        )}
      </View>

      {link && (
        <View style={styles.linkBar}>
          <Pressable style={styles.linkBack} onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={18} color={COLORS.accent} />
            <Text style={styles.linkBackText}>Back</Text>
          </Pressable>
          {link.category && (
            <Pressable style={styles.linkChip} onPress={() => setLink((l) => (l ? { ...l, category: undefined } : l))} accessibilityLabel={`Remove ${getCategory(link.category)?.label ?? link.category} filter`}>
              <Text style={styles.linkChipText}>{getCategory(link.category)?.label ?? link.category} ✕</Text>
            </Pressable>
          )}
          {link.label && (
            <Pressable style={styles.linkChip} onPress={() => setLink((l) => (l ? { ...l, from: undefined, to: undefined, label: undefined } : l))} accessibilityLabel={`Remove ${link.label} filter`}>
              <Text style={styles.linkChipText}>{link.label} ✕</Text>
            </Pressable>
          )}
          <Pressable onPress={clearLink} hitSlop={8} accessibilityRole="button">
            <Text style={styles.linkClear}>Clear all</Text>
          </Pressable>
        </View>
      )}

      {summary && (link || query || tab || typeFilter !== 'all') && (
        <Text style={styles.summaryText}>
          {tab ? `Showing ${PERIOD_TABS.find((t) => t.key === tab)!.shown} · ` : ''}
          {summary.count} {summary.count === 1 ? 'entry' : 'entries'}
          {typeFilter === 'expense' ? ` · ${fmt(summary.expense)}` : typeFilter === 'income' ? ` · ${fmt(summary.income)}` : ''}
        </Text>
      )}

      <View style={styles.filterRow}>
        {TYPE_FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]} onPress={() => setTypeFilter(f.key)}>
            <Text style={[styles.filterChipText, typeFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={listLoading && items.length > 0 ? <ActivityIndicator color={COLORS.textMuted} style={styles.listFooter} /> : null}
        ListEmptyComponent={
          listLoading ? null : (
            <Text style={styles.emptyText}>
              {query || tab || typeFilter !== 'all' ? `No transactions match${query ? ` "${query}"` : ' this filter'}` : 'No transactions yet. Tap + to add one.'}
            </Text>
          )
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
                  onDelete(item);
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
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalSheet} keyboardShouldPersistTaps="handled">
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

            {editingId == null && !repeat && (
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
                <Text style={styles.repeatLabel}>Repeat</Text>
                <Text style={styles.hint}>
                  {repeat
                    ? `Added again on the ${ordinal(repeatDay)} ${frequency === 'monthly' ? 'of every month' : frequency === 'quarterly' ? 'every 3 months' : 'of this month every year'}, until the end date you choose below.`
                    : 'Turn on for salary, rent, insurance or any fixed amount that comes back.'}
                </Text>
              </View>
              <Switch
                value={repeat}
                onValueChange={setRepeat}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>

            {repeat && (
              <View style={styles.typeToggle}>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <Pressable key={opt.key} style={[styles.typeBtn, frequency === opt.key && styles.typeBtnActive]} onPress={() => setFrequency(opt.key)}>
                    <Text style={[styles.typeBtnText, frequency === opt.key && styles.typeBtnTextActive]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {repeat && frequency !== 'monthly' && (
              <Text style={styles.hint}>
                The full amount is added once every {frequency === 'quarterly' ? '3 months' : 'year'}, on this day of the month.
              </Text>
            )}

            {repeat && (
              <RepeatEndField
                base={date}
                firstDue={firstRepeatDate(date, frequency)}
                frequency={frequency}
                day={repeatDay}
                value={repeatEnd}
                onChange={(v) => {
                  setRepeatEnd(v);
                  setError(null);
                }}
                showError={endTried}
              />
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save transaction'}</Text>
            </Pressable>
          </ScrollView>
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
  linkBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.xs, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  linkBack: { flexDirection: 'row', alignItems: 'center', marginRight: SPACING.xs },
  linkBackText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  linkChip: { backgroundColor: COLORS.accent + '22', borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  linkChipText: { color: COLORS.accent, fontSize: 12, fontWeight: '600' },
  linkClear: { color: COLORS.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  summaryText: { color: COLORS.textMuted, fontSize: 13, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
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
  // Slim on purpose: one line each, since each is only a label and a number.
  periodRow: { flexDirection: 'row', gap: SPACING.xs, marginHorizontal: SPACING.lg, marginBottom: SPACING.xs },
  periodTab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    gap: SPACING.xs,
  },
  periodTabActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  periodLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  periodLabelActive: { color: COLORS.onAccent },
  periodAmount: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  periodAmountActive: { color: COLORS.onAccent },
  filterRow: { flexDirection: 'row', gap: SPACING.xs, marginHorizontal: SPACING.lg, marginTop: SPACING.sm },
  filterChip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 5 },
  filterChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  filterChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: COLORS.onAccent },
  listFooter: { paddingVertical: SPACING.md },
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
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '92%' },
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
  typeBtnTextActive: { color: COLORS.onAccent },
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
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});
