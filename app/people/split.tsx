import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, ErrorText, ScreenHeader, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from '../../utils/api';
import { addPerson, addSplitWithPeople, getPeople, Person } from '../../utils/database';
import { todayLocalIso } from '../../utils/dates';
import { emptyPeopleSplit, fmtAmount, NEW_PERSON, PeopleSplitState, peopleSplitProblem, planPeopleSplit } from '../../utils/people';

/** Split a bill you paid with friends: how much, what for, who shared it. Only your own share counts as spending. */
export default function SplitBillScreen() {
  const { user } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [split, setSplit] = useState<PeopleSplitState>(() => emptyPeopleSplit());
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getPeople()
        .then((r) => active && setPeople(r.people))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  const total = parseFloat(amount) || 0;
  const plan = planPeopleSplit(total, split);
  const nameOf = (k: number) => (k === NEW_PERSON ? split.newName.trim() : people.find((p) => p.id === k)?.name ?? '');
  const toggle = (id: number) => setSplit({ ...split, picked: split.picked.includes(id) ? split.picked.filter((x) => x !== id) : [...split.picked, id] });
  const friendShares = plan.keys.map((k) => plan.shares[k]);
  const allEqual = friendShares.every((v) => v === friendShares[0]) && friendShares[0] === plan.myShare;

  const onSave = async () => {
    const problem = peopleSplitProblem(total, split);
    if (problem) return setError(problem);
    if (!category) return setError('Choose what it was for.');

    setSaving(true);
    setError(null);
    try {
      const ids = [...split.picked];
      if (split.newName.trim()) {
        const name = split.newName.trim();
        try {
          ids.push((await addPerson(name)).id);
        } catch (err) {
          // Already in the list under that name: use that person.
          const existing = (await getPeople()).people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (!existing) throw err;
          ids.push(existing.id);
        }
      }
      await addSplitWithPeople({
        date: todayLocalIso(),
        total,
        category,
        method: split.method,
        people: ids.map((personId, i) => ({ personId, amount: split.method === 'custom' ? plan.shares[i < split.picked.length ? personId : NEW_PERSON] : undefined })),
      });
      router.replace('/people');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this split.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Split a bill" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.question}>How much did you pay?</Text>
        <TextInput
          style={[styles.input, styles.amount]}
          value={amount}
          onChangeText={setAmount}
          placeholder="₹0"
          placeholderTextColor={COLORS.textDim}
          keyboardType="numeric"
          accessibilityLabel="How much did you pay"
        />

        <Text style={styles.question}>What was it for?</Text>
        <CategoryPicker type="expense" value={category} onChange={setCategory} />

        <Text style={styles.question}>Who shared it?</Text>
        <View style={styles.chips}>
          {people.map((p) => {
            const on = split.picked.includes(p.id);
            return (
              <Pressable key={p.id} style={[styles.chip, on && styles.chipActive]} onPress={() => toggle(p.id)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{p.name}</Text>
              </Pressable>
            );
          })}
          <Pressable style={[styles.chip, showNew && styles.chipActive]} onPress={() => setShowNew((v) => !v)} accessibilityRole="button">
            <Text style={[styles.chipText, showNew && styles.chipTextActive]}>+ New</Text>
          </Pressable>
        </View>
        {showNew && (
          <TextInput
            style={styles.input}
            value={split.newName}
            onChangeText={(newName) => setSplit({ ...split, newName })}
            placeholder="Name"
            placeholderTextColor={COLORS.textDim}
            maxLength={60}
            autoFocus
            accessibilityLabel="New person's name"
          />
        )}

        {plan.keys.length > 0 && total > 0 && (
          <Card style={styles.summary}>
            {split.method === 'equal' ? (
              <Text style={styles.summaryMain}>
                {allEqual ? (
                  <>
                    Everyone pays <Text style={styles.bold}>{fmtAmount(plan.myShare)}</Text>, including you.
                  </>
                ) : (
                  <>
                    Friends pay <Text style={styles.bold}>{fmtAmount(friendShares[0])}</Text> each and you pay <Text style={styles.bold}>{fmtAmount(plan.myShare)}</Text>.
                  </>
                )}
              </Text>
            ) : (
              <>
                {plan.keys.map((k) => (
                  <View key={k} style={styles.shareRow}>
                    <Text style={styles.shareName} numberOfLines={1}>
                      {nameOf(k)}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.shareInput]}
                      value={split.shares[k] ?? ''}
                      onChangeText={(v) => setSplit({ ...split, shares: { ...split.shares, [k]: v } })}
                      placeholder="0"
                      placeholderTextColor={COLORS.textDim}
                      keyboardType="numeric"
                      accessibilityLabel={`Amount for ${nameOf(k)}`}
                    />
                  </View>
                ))}
                <Text style={[styles.summaryMain, plan.myShare < 0 && { color: COLORS.red }]}>
                  You pay <Text style={styles.bold}>{fmtAmount(plan.myShare)}</Text>
                </Text>
              </>
            )}
            <Text style={kit.dim}>Only {fmtAmount(Math.max(plan.myShare, 0))} counts as your spending.</Text>
          </Card>
        )}

        {plan.keys.length > 0 && (
          <Pressable onPress={() => setSplit({ ...split, method: split.method === 'equal' ? 'custom' : 'equal' })} accessibilityRole="link">
            <Text style={styles.link}>{split.method === 'equal' ? 'Change the amounts' : 'Split equally again'}</Text>
          </Pressable>
        )}

        <ErrorText message={error} />
        <Button label={saving ? 'Saving…' : 'Save'} onPress={onSave} disabled={saving} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  question: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: SPACING.xs },
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
  amount: { fontSize: 24, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderColor: COLORS.cardBorder, borderWidth: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 14 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  summary: { gap: SPACING.sm },
  summaryMain: { color: COLORS.text, fontSize: 15 },
  bold: { fontWeight: '700' },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  shareName: { flex: 1, color: COLORS.text, fontSize: 14 },
  shareInput: { width: 120, textAlign: 'right' },
  link: { color: COLORS.accent, fontWeight: '600', fontSize: 14 },
});
