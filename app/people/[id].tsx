import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { DueDateField, dueDateError } from '../../components/DueDateField';
import { IouSheet } from '../../components/IouSheet';
import { Button, ErrorText, ScreenHeader, SectionTitle, kit } from '../../components/ScreenKit';
import { COLORS, MODAL_ANIMATION, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import { addPersonEntry, deletePerson, deletePersonEntry, getPerson, updatePerson, LedgerEntry, Person } from '../../utils/database';
import { fmtAmount, KIND_LABEL, shortDate } from '../../utils/people';

type Sheet = 'none' | 'payment' | 'lend' | 'due';

export default function PersonScreen() {
  const { user } = useAuth();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [person, setPerson] = useState<Person | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet>('none');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getPerson(id);
      setPerson(r.person);
      setEntries(r.entries);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
    }, [user?.id, load])
  );

  const owed = person ? person.balance > 0 : false;
  const owing = person ? person.balance < 0 : false;

  const openPayment = () => {
    if (!person) return;
    setAmount(String(Math.abs(person.balance)));
    setNote('');
    setError(null);
    setSheet('payment');
  };

  const openDue = () => {
    setDue(person?.dueDate ?? '');
    setError(null);
    setSheet('due');
  };

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      setSheet('none');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this.'));
    } finally {
      setSaving(false);
    }
  };

  const savePayment = () => {
    const value = parseFloat(amount);
    if (!(value > 0)) return setError('Enter an amount.');
    run(() => addPersonEntry(id, { kind: owed ? 'received' : 'repaid', amount: value, note: note.trim() || null }));
  };

  const saveDue = () => {
    const problem = dueDateError(due);
    if (problem) return setError(problem);
    run(() => updatePerson(id, { due_date: due || null }));
  };

  const writeOff = () => {
    if (!person) return;
    confirmAction('Write off', `Clear the ${fmtAmount(person.balance)} ${person.name} owes you? You won't be chasing it any more. It stays in the history.`, 'Write off', async () => {
      await addPersonEntry(id, { kind: 'written_off' });
      await load();
    });
  };

  const removeEntry = (e: LedgerEntry) => {
    confirmAction('Remove this entry', `${KIND_LABEL[e.kind]} ${fmtAmount(e.amount)} on ${shortDate(e.date)} will be removed and the balance recalculated.`, 'Remove', async () => {
      await deletePersonEntry(id, e.id);
      await load();
    });
  };

  const removePerson = () => {
    if (!person) return;
    confirmAction('Delete person', `Delete ${person.name} and their whole history? This can't be undone.`, 'Delete', async () => {
      await deletePerson(id);
      router.back();
    });
  };

  if (!person) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Person" />
        <View style={styles.center}>{failed ? <Text style={kit.muted}>Could not load this person.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      </View>
    );
  }

  const headline = owed ? `${person.name} owes you` : owing ? `You owe ${person.name}` : 'All settled';

  return (
    <View style={kit.screen}>
      <ScreenHeader title={person.name} />
      <ScrollView contentContainerStyle={kit.content}>
        <Card style={styles.hero}>
          <Text style={kit.dim}>{headline}</Text>
          <Text style={[styles.balance, { color: owed ? COLORS.positive : owing ? COLORS.red : COLORS.text }]}>{owed || owing ? fmtAmount(person.balance) : '₹0'}</Text>
          {person.dueDate && (owed || owing) && (
            <View style={styles.dueRow}>
              <Text style={kit.dim}>Pay back by {shortDate(person.dueDate)}</Text>
              {person.overdue && (
                <View style={styles.overdue}>
                  <Text style={styles.overdueText}>Overdue</Text>
                </View>
              )}
            </View>
          )}
        </Card>

        {(owed || owing) && <Button label={owed ? `They paid ${fmtAmount(person.balance)}` : `I paid ${fmtAmount(person.balance)}`} onPress={openPayment} />}
        <View style={styles.actions}>
          <Button label="Lend or borrow" variant="outline" style={styles.action} onPress={() => setSheet('lend')} />
          {(owed || owing) && <Button label="Due date" variant="outline" style={styles.action} onPress={openDue} />}
          {owed && <Button label="Write off" variant="outline" style={styles.action} onPress={writeOff} />}
        </View>

        <SectionTitle>History</SectionTitle>
        <Card style={styles.list}>
          {entries.length === 0 ? (
            <Text style={kit.empty}>Nothing recorded yet.</Text>
          ) : (
            entries.map((e, i) => (
              <View key={e.id} style={[styles.row, i !== 0 && styles.rowBorder]}>
                <View style={styles.rowMain}>
                  <Text style={styles.kind}>{KIND_LABEL[e.kind]}</Text>
                  <Text style={kit.dim} numberOfLines={2}>
                    {shortDate(e.date)}
                    {e.note ? ` · ${e.note}` : ''}
                  </Text>
                </View>
                <Text style={[styles.entryAmount, { color: e.amount > 0 ? COLORS.positive : COLORS.red }]}>
                  {e.amount > 0 ? '+' : '−'}
                  {fmtAmount(e.amount)}
                </Text>
                <Pressable onPress={() => removeEntry(e)} hitSlop={8} accessibilityLabel={`Remove entry from ${shortDate(e.date)}`}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.textDim} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        <Button label="Delete person" variant="danger" onPress={removePerson} />
      </ScrollView>

      <Modal visible={sheet === 'payment' || sheet === 'due'} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setSheet('none')}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{sheet === 'due' ? 'Pay back by' : owed ? `${person.name} paid you` : `You paid ${person.name}`}</Text>
              <Pressable onPress={() => setSheet('none')} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            {sheet === 'payment' ? (
              <>
                <Text style={styles.label}>Amount (part payments are fine)</Text>
                <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={COLORS.textDim} accessibilityLabel="Amount" />
                <Text style={styles.label}>Note (optional)</Text>
                <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="e.g. UPI" placeholderTextColor={COLORS.textDim} maxLength={500} />
                <ErrorText message={error} />
                <Button label={saving ? 'Saving…' : 'Save'} onPress={savePayment} disabled={saving} />
              </>
            ) : (
              <>
                <DueDateField value={due} onChange={setDue} />
                <ErrorText message={error} />
                <Button label={saving ? 'Saving…' : 'Save'} onPress={saveDue} disabled={saving} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <IouSheet visible={sheet === 'lend'} onClose={() => setSheet('none')} person={{ id: person.id, name: person.name }} onSaved={() => load()} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  hero: { alignItems: 'center', gap: 2 },
  balance: { fontSize: 32, fontWeight: '700' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs },
  overdue: { backgroundColor: '#FAEEDA', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  overdueText: { color: '#633806', fontSize: 11, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  action: { flexGrow: 1, flexBasis: '30%' },
  list: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowMain: { flex: 1, gap: 2 },
  kind: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  entryAmount: { fontSize: 14, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  label: { color: COLORS.textMuted, fontSize: 13 },
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
});
