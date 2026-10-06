import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { CategoryPicker } from './CategoryPicker';
import { useCategories } from '../context/CategoriesContext';
import { apiErrorMessage } from '../utils/api';
import { addTransaction, getTransactionsPage, TxnType } from '../utils/database';
import { monthYearOf, todayLocalIso } from '../utils/dates';

const CHIP_COUNT = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

/** Appends a keypad press to the amount text: digits, one decimal point, at most 2 decimals and 9 integer digits. */
export const pressKey = (current: string, key: string): string => {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : (current || '0') + '.';
  const [whole, decimals] = current.split('.');
  if (decimals !== undefined && decimals.length >= 2) return current;
  if (decimals === undefined && whole.length >= 9) return current;
  if (current === '0') return key;
  return current + key;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Add today's income or expense in a few taps: amount keypad, one of your most-used categories, Save. */
export const QuickAddSheet: React.FC<Props> = ({ visible, onClose, onSaved }) => {
  const { categories, getCategory } = useCategories();
  const [type, setType] = useState<TxnType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Most-used categories come from the latest 100 entries.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    getTransactionsPage({ limit: 100 })
      .then((page) => {
        if (!active) return;
        const counts: Record<string, number> = {};
        for (const t of page.items) counts[`${t.type}:${t.category}`] = (counts[`${t.type}:${t.category}`] ?? 0) + 1;
        setUsage(counts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visible]);

  const chips = categories
    .filter((c) => c.type === type)
    .map((c, i) => ({ c, used: usage[`${type}:${c.key}`] ?? 0, i }))
    .sort((a, b) => b.used - a.used || a.i - b.i)
    .slice(0, CHIP_COUNT)
    .map((x) => x.c);

  const reset = () => {
    setType('expense');
    setAmount('');
    setCategory(null);
    setShowAll(false);
    setShowNote(false);
    setNote('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onSave = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) {
      setError('Enter an amount.');
      return;
    }
    if (!category) {
      setError('Pick a category.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const date = todayLocalIso();
      await addTransaction({ amount: value, type, category, subcategory: null, note: note.trim() || null, date, ...monthYearOf(date) });
      reset();
      onClose();
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this entry.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Quick add</Text>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          <View style={styles.toggle}>
            {(['expense', 'income'] as TxnType[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.toggleBtn, type === t && styles.toggleBtnActive]}
                onPress={() => {
                  setType(t);
                  setCategory(null);
                }}
              >
                <Text style={[styles.toggleText, type === t && styles.toggleTextActive]}>{t === 'expense' ? 'Expense' : 'Income'}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Amount</Text>
            <Text style={[styles.amount, !amount && styles.amountEmpty]} accessibilityLabel={`Amount ${amount || 0} rupees`}>
              ₹ {amount || '0'}
            </Text>
          </View>

          <View style={styles.chips}>
            {chips.map((c) => (
              <Pressable key={c.key} style={[styles.chip, category === c.key && styles.chipActive]} onPress={() => setCategory(c.key)}>
                <Text style={[styles.chipText, category === c.key && styles.chipTextActive]} numberOfLines={1}>
                  {c.icon} {c.label}
                </Text>
              </Pressable>
            ))}
            <Pressable style={[styles.chip, showAll && styles.chipActive]} onPress={() => setShowAll((v) => !v)}>
              <Text style={[styles.chipText, showAll && styles.chipTextActive]}>More</Text>
            </Pressable>
          </View>
          {(showAll || (category != null && !chips.some((c) => c.key === category))) && (
            <CategoryPicker type={type} value={category} onChange={setCategory} />
          )}

          <View style={styles.keypad}>
            {KEYS.map((k) => (
              <Pressable
                key={k}
                style={styles.key}
                onPress={() => setAmount((a) => pressKey(a, k))}
                accessibilityLabel={k === 'back' ? 'Delete last digit' : k}
              >
                {k === 'back' ? <Ionicons name="backspace-outline" size={22} color={COLORS.text} /> : <Text style={styles.keyText}>{k}</Text>}
              </Pressable>
            ))}
          </View>

          <View style={styles.links}>
            <Pressable onPress={() => setShowNote((v) => !v)} hitSlop={6}>
              <Text style={styles.link}>{showNote ? 'Hide note' : 'Add note'}</Text>
            </Pressable>
            <Text style={styles.today}>Today</Text>
          </View>
          {showNote && (
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Add a note" placeholderTextColor={COLORS.textDim} maxLength={500} />
          )}

          {category != null && (
            <Text style={styles.summary} numberOfLines={1}>
              {getCategory(category)?.icon} {getCategory(category)?.label}
            </Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={styles.save} onPress={onSave} disabled={saving} accessibilityRole="button">
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  scroll: { maxHeight: '94%' },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  toggle: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADIUS.sm },
  toggleBtnActive: { backgroundColor: COLORS.accent },
  toggleText: { color: COLORS.textMuted, fontWeight: '600' },
  toggleTextActive: { color: COLORS.onAccent },
  amountBox: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  amountLabel: { color: COLORS.textDim, fontSize: 12 },
  amount: { color: COLORS.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amountEmpty: { color: COLORS.textDim },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: {
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  key: {
    width: '32%',
    flexGrow: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
  },
  keyText: { color: COLORS.text, fontSize: 20, fontWeight: '500' },
  links: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  link: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  today: { color: COLORS.textDim, fontSize: 12, marginLeft: 'auto' },
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
  summary: { color: COLORS.textMuted, fontSize: 12 },
  error: { color: COLORS.red, fontSize: 13 },
  save: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.xs },
  saveText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});
