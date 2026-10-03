import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { useCategories } from '../context/CategoriesContext';
import { confirmAction } from '../utils/alert';
import { apiErrorMessage } from '../utils/api';
import { RecurringTransaction, updateRecurring, deleteRecurring } from '../utils/database';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

interface Props {
  visible: boolean;
  rules: RecurringTransaction[];
  onClose: () => void;
  /** Called after a rule was edited or stopped, so the caller can reload. */
  onChanged: () => void;
}

export const RepeatingEntries: React.FC<Props> = ({ visible, rules, onClose, onChanged }) => {
  const { getCategory } = useCategories();
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setEditing(null);
    setError(null);
    onClose();
  };

  const startEdit = (rule: RecurringTransaction) => {
    setEditing(rule);
    setAmount(String(rule.amount));
    setError(null);
  };

  const onSave = async () => {
    if (!editing) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateRecurring(editing.id, { amount: value });
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update this repeating entry.'));
    } finally {
      setBusy(false);
    }
  };

  const onStop = () => {
    if (!editing) return;
    const rule = editing;
    confirmAction('Stop repeating', 'Stop adding this every month? Entries already added stay.', 'Stop repeating', async () => {
      setBusy(true);
      try {
        await deleteRecurring(rule.id);
        setEditing(null);
        onChanged();
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not stop this repeating entry.'));
      } finally {
        setBusy(false);
      }
    });
  };

  const editingCat = editing ? getCategory(editing.category) : undefined;

  return (
    <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{editing ? 'Edit repeating entry' : 'Repeats every month'}</Text>
            <Pressable onPress={close}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          {editing ? (
            <>
              <Text style={styles.rowLabel}>
                {editingCat?.icon ?? '💰'} {editingCat?.label ?? editing.category}
                {editing.note ? ` · ${editing.note}` : ''}
              </Text>
              <Text style={styles.hint}>A new amount applies from the next month it is added. Entries already added keep their amount.</Text>

              <Text style={styles.label}>Amount per month</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={COLORS.textDim}
                keyboardType="numeric"
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable style={styles.saveBtn} onPress={onSave} disabled={busy}>
                <Text style={styles.saveBtnText}>{busy ? 'Saving…' : 'Save'}</Text>
              </Pressable>
              <Pressable style={styles.stopBtn} onPress={onStop} disabled={busy}>
                <Text style={styles.stopBtnText}>Stop repeating</Text>
              </Pressable>
              <Pressable style={styles.backLink} onPress={() => setEditing(null)}>
                <Text style={styles.backLinkText}>Back to list</Text>
              </Pressable>
            </>
          ) : rules.length === 0 ? (
            <Text style={styles.empty}>Nothing repeats monthly. Turn on "Repeat every month" when adding a transaction.</Text>
          ) : (
            <ScrollView style={styles.list}>
              {rules.map((rule) => {
                const cat = getCategory(rule.category);
                return (
                  <Pressable key={rule.id} style={styles.row} onPress={() => startEdit(rule)}>
                    <Text style={styles.rowIcon}>{cat?.icon ?? '💰'}</Text>
                    <View style={styles.rowMid}>
                      <Text style={styles.rowLabel}>{cat?.label ?? rule.category}</Text>
                      {rule.note ? <Text style={styles.rowNote}>{rule.note}</Text> : null}
                    </View>
                    <Text style={[styles.rowAmount, { color: rule.type === 'income' ? COLORS.accent : COLORS.red }]}>
                      {rule.type === 'income' ? '+' : '-'}{fmt(rule.amount)}/mo
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.xs },
  rowIcon: { fontSize: 20, marginRight: SPACING.sm },
  rowMid: { flex: 1 },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowNote: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700' },
  empty: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.lg },
  hint: { color: COLORS.textDim, fontSize: 12 },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.sm },
  saveBtnText: { color: '#04140D', fontWeight: '700', fontSize: 16 },
  stopBtn: { borderColor: COLORS.red, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  stopBtnText: { color: COLORS.red, fontWeight: '600', fontSize: 14 },
  backLink: { alignItems: 'center', paddingVertical: SPACING.xs },
  backLinkText: { color: COLORS.textMuted, fontSize: 13 },
});
