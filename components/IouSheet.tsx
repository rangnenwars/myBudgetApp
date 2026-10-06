import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { DateField } from './DateField';
import { DueDateField, dueDateError } from './DueDateField';
import { Segmented } from './ScreenKit';
import { apiErrorMessage } from '../utils/api';
import { addPerson, addPersonEntry, Person } from '../utils/database';
import { entryDateError, todayLocalIso } from '../utils/dates';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the person's id once the IOU is saved. */
  onSaved: (personId: number) => void;
  /** People to pick from; ignored when `person` is fixed. */
  people?: Person[];
  /** Fixes the person (e.g. "Lend more" on their page). */
  person?: Pick<Person, 'id' | 'name'>;
}

type Kind = 'lent' | 'borrowed';

/** Add money lent to, or borrowed from, a person. Lending isn't spending, so nothing is added to Transactions. */
export const IouSheet: React.FC<Props> = ({ visible, onClose, onSaved, people = [], person }) => {
  const [kind, setKind] = useState<Kind>('lent');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocalIso());
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind('lent');
    setPickedId(person?.id ?? null);
    setNewName('');
    setAmount('');
    setDate(todayLocalIso());
    setDue('');
    setNote('');
    setError(null);
    setMore(false);
  }, [visible, person?.id]);

  const onSave = async () => {
    const value = parseFloat(amount);
    const name = newName.trim();
    if (pickedId == null && !name) return setError('Choose a person or type a name.');
    if (!(value > 0)) return setError('Enter an amount.');
    const dateProblem = entryDateError(date, todayLocalIso());
    if (dateProblem) return setError(dateProblem);
    const dueProblem = dueDateError(due);
    if (dueProblem) return setError(dueProblem);

    setSaving(true);
    setError(null);
    try {
      const personId = pickedId ?? (await addPerson(name)).id;
      await addPersonEntry(personId, { kind, amount: value, date, note: note.trim() || null, due_date: due || null });
      onSaved(personId);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{person ? `Lend or borrow: ${person.name}` : 'Lent or borrowed'}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          <Segmented
            options={[
              { key: 'lent', label: 'I lent' },
              { key: 'borrowed', label: 'I borrowed' },
            ]}
            value={kind}
            onChange={setKind}
          />

          {!person && (
            <>
              <Text style={styles.label}>Person</Text>
              {people.length > 0 && (
                <View style={styles.chips}>
                  {people.map((p) => (
                    <Pressable
                      key={p.id}
                      style={[styles.chip, pickedId === p.id && styles.chipActive]}
                      onPress={() => {
                        setPickedId(pickedId === p.id ? null : p.id);
                        setNewName('');
                      }}
                    >
                      <Text style={[styles.chipText, pickedId === p.id && styles.chipTextActive]}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={(v) => {
                  setNewName(v);
                  if (v) setPickedId(null);
                }}
                placeholder={people.length > 0 ? 'Or type a new name' : 'Name'}
                placeholderTextColor={COLORS.textDim}
                maxLength={60}
                accessibilityLabel="New person name"
              />
            </>
          )}

          <Text style={styles.label}>Amount</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" accessibilityLabel="Amount" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="What it was for" placeholderTextColor={COLORS.textDim} maxLength={500} />

          {more ? (
            <>
              <Text style={styles.label}>Date</Text>
              <DateField value={date} onChange={setDate} />

              <Text style={styles.label}>Pay back by (optional)</Text>
              <DueDateField value={due} onChange={setDue} />
            </>
          ) : (
            <Pressable onPress={() => setMore(true)} accessibilityRole="link">
              <Text style={styles.link}>Add a date or a pay-back date</Text>
            </Pressable>
          )}

          <Text style={styles.hint}>Lending isn't counted as spending. Update your balance under Accounts if you want it to match.</Text>
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
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderColor: COLORS.cardBorder, borderWidth: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
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
  hint: { color: COLORS.textDim, fontSize: 12 },
  link: { color: COLORS.accent, fontWeight: '600', fontSize: 14 },
  error: { color: COLORS.red, fontSize: 13 },
  save: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.xs },
  saveText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});
